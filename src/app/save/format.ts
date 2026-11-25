import { GEOLOGY_VERSION, isSeed, MIGRATIONS as SIM_MIGRATIONS, worldProblem, type Engine, type WorldState } from "../../sim";

/**
 * The save file format. Pure (no I/O) so it is fully testable in Node.
 *
 * A save is a snapshot of world state, never a replay of inputs, so a save can never be
 * corrupted by floating-point differences between JavaScript engines.
 *
 * Changing the shape of WorldState in a way old saves don't satisfy means:
 *   1. bump SCHEMA_VERSION,
 *   2. add MIGRATIONS[old] that upgrades a world from `old` to `old + 1`,
 *   3. add a test that loads a fixture saved at the old version.
 */
export const SAVE_FORMAT = "black-gold-save";
export const SCHEMA_VERSION = 3;

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  schemaVersion: number;
  /** The build that wrote the file. Metadata only. */
  buildId: string;
  /** Real-world time the file was written (ISO 8601). Metadata only, never read by the sim. */
  savedAt: string;
  world: WorldState;
}

export type Migration = (world: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] upgrades a world saved at schema version n to version n + 1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = SIM_MIGRATIONS;

export class SaveError extends Error {}

export function createSave(world: WorldState, buildId: string, savedAt: string): SaveFile {
  return { format: SAVE_FORMAT, schemaVersion: SCHEMA_VERSION, buildId, savedAt, world: structuredClone(world) };
}

export function encodeSave(save: SaveFile): string {
  return JSON.stringify(save);
}

export function decodeSave(
  text: string,
  engine: Engine,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  currentVersion: number = SCHEMA_VERSION,
): SaveFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError("This file is not a BLACK GOLD save (it is not valid JSON).");
  }
  if (!isRecord(raw) || raw.format !== SAVE_FORMAT) throw new SaveError("This file is not a BLACK GOLD save.");
  const version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new SaveError("The save has no valid schema version.");
  }
  if (version > currentVersion) {
    throw new SaveError(`This save was made by a newer version of the game (schema ${version}; this build reads up to ${currentVersion}).`);
  }
  if (!isRecord(raw.world)) throw new SaveError("The save contains no world.");

  let world = raw.world;
  for (let v = version; v < currentVersion; v++) {
    const migrate = migrations[v];
    if (!migrate) throw new SaveError(`No migration from schema ${v} to ${v + 1}.`);
    world = migrate(world);
  }

  assertLoadable(world, engine);
  const problem = worldProblem(world as unknown as WorldState);
  if (problem) throw new SaveError(`The save is damaged: ${problem}.`);
  return {
    format: SAVE_FORMAT,
    schemaVersion: currentVersion,
    buildId: typeof raw.buildId === "string" ? raw.buildId : "unknown",
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
    world,
  };
}

/** Checks the world has the shape and contents this build can run. */
function assertLoadable(w: Record<string, unknown>, engine: Engine): asserts w is WorldState & Record<string, unknown> {
  const fail = (why: string): never => {
    throw new SaveError(`The save is damaged: ${why}.`);
  };
  if (typeof w.seed !== "string" || !isSeed(w.seed)) fail("bad seed");
  if (!Number.isSafeInteger(w.time) || (w.time as number) < 0) fail("bad time");
  if (!Number.isSafeInteger(w.seq)) fail("bad sequence counter");
  if (!Array.isArray(w.queue) || !Array.isArray(w.log)) fail("bad queue or log");
  if (!isRecord(w.rng) || !isRecord(w.systems)) fail("bad rng or systems");

  const eventTypes = new Set(engine.systems.flatMap((s) => Object.keys(s.events ?? {})));
  for (const e of w.queue as unknown[]) {
    if (!isRecord(e) || !Number.isSafeInteger(e.at) || !Number.isSafeInteger(e.seq) || typeof e.type !== "string") {
      fail("bad scheduled event");
    }
    const ev = e as { type: string; at: number };
    if (!eventTypes.has(ev.type)) fail(`unknown scheduled event "${ev.type}"`);
    if (ev.at < (w.time as number)) fail("scheduled event in the past");
  }
  for (const s of engine.systems) {
    if (!(s.id in (w.systems as Record<string, unknown>))) fail(`missing state for system "${s.id}"`);
  }
  const geo = (w.systems as Record<string, unknown>).geology as { version?: unknown } | undefined;
  if (geo && geo.version !== GEOLOGY_VERSION) {
    throw new SaveError(`This save's ground was made by a different version of the geology (version ${String(geo.version)}; this build has ${GEOLOGY_VERSION}).`);
  }
  for (const st of Object.values(w.rng as Record<string, unknown>)) {
    if (!Array.isArray(st) || st.length !== 4 || !st.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff)) {
      fail("bad random stream");
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
