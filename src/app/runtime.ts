import { CAMPAIGN_START, gameEngine, knowledgeOf, operationsOf, printedMap, type OperationsView, startOfNextMonth, toCalendar, type Json, type KnowledgeView, type PrintedMap, type Seed, type SimEvent, type WorldState } from "../sim";
import { createSave, decodeSave, encodeSave, SaveError, type SaveFile } from "./save/format";
import { gunzip, gzip } from "./save/gzip";
import { autosaveId, saveStore, type SaveSummary } from "./save/store";

/**
 * The bridge between the simulation and the browser: owns the world, turns real time
 * into game time, and handles saving. The UI reads `snapshot()` and calls methods;
 * it never touches the world directly.
 */

export type Speed = "paused" | "1x" | "4x" | "16x" | "skip";

/** Game minutes per real second. 1× is one game hour per second. */
export const SPEED_RATE: Record<Speed, number> = {
  paused: 0,
  "1x": 60,
  "4x": 240,
  "16x": 960,
  // "Until something happens": fast enough that a month passes in about half a second.
  skip: 86_400,
};

/** At the rig, time runs slower so the driller's rhythm is playable: 1× is ten minutes a second. */
export const RIG_RATE: Record<Speed, number> = { paused: 0, "1x": 10, "4x": 40, "16x": 160, skip: 1440 };
/** Rigging up and operations (bailing, dressing, casing, fishing) pass quickly. */
const RIG_BUSY_RATE = 300;

/** Longest real-time gap one frame may simulate (a backgrounded tab must not lurch). */
const MAX_FRAME_MS = 250;

export interface Snapshot {
  time: number;
  /** What the company knows and believes. Arrays are live; `rev` changes when they do. */
  knowledge: KnowledgeView;
  /** The published 1890 survey for this world. */
  print: PrintedMap;
  rev: number;
  /** Money and the well being drilled. */
  ops: OperationsView;
  /** The rig view is open (time runs at rig pace). */
  atRig: boolean;
  speed: Speed;
  seed: Seed;
  status: string;
  saves: SaveSummary[];
  busy: boolean;
}

declare const __BUILD_ID__: string;
const BUILD_ID = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

export function randomSeed(): Seed {
  const b = new Uint32Array(2);
  crypto.getRandomValues(b);
  return [...b].map((n) => n.toString(16).padStart(8, "0")).join("");
}

export class GameRuntime {
  private world: WorldState;
  private speed: Speed = "paused";
  private carry = 0;
  private skipTarget = 0;
  private status = "";
  private saves: SaveSummary[] = [];
  private busy = false;
  private listeners = new Set<() => void>();
  private snap: Snapshot;
  private rev = 0;
  private atRig = false;

  constructor(seed: Seed = randomSeed()) {
    this.world = gameEngine.createWorld(seed, CAMPAIGN_START);
    this.snap = this.makeSnapshot();
  }

  /** Resume the most recent save if there is one. */
  async boot(): Promise<void> {
    await this.refreshSaves();
    const latest = this.saves[0];
    if (latest) {
      const ok = await this.loadSlot(latest.id);
      if (ok) this.setStatus(`Resumed your ${latest.kind === "auto" ? "autosave" : "save"} from ${formatDate(latest.gameTime)}.`);
    } else {
      this.setStatus("A new campaign. The year is 1890.");
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): Snapshot {
    return this.snap;
  }

  /** Read-only view for debugging and tests. */
  get currentWorld(): Readonly<WorldState> {
    return this.world;
  }

  setSpeed(speed: Speed): void {
    if (speed === "skip") this.skipTarget = startOfNextMonth(this.world.time);
    this.speed = speed;
    this.carry = 0;
    this.changed();
  }

  /** Open or close the rig view; time runs at rig pace while it is open. */
  setAtRig(on: boolean): void {
    this.atRig = on;
    this.carry = 0;
    this.changed();
  }

  togglePause(): void {
    this.setSpeed(this.speed === "paused" ? "1x" : "paused");
  }

  /** Called once per animation frame with the real milliseconds since the last frame. */
  tick(dtMs: number): void {
    let rate = this.atRig ? RIG_RATE[this.speed] : SPEED_RATE[this.speed];
    if (rate === 0) return;
    const well = operationsOf(this.world).well;
    if (this.atRig && well && (well.busy || well.status === "rigging")) rate = Math.max(rate, RIG_BUSY_RATE);
    this.carry += (Math.min(dtMs, MAX_FRAME_MS) / 1000) * rate;
    const whole = Math.floor(this.carry);
    if (whole === 0) return;
    this.carry -= whole;

    let until = this.world.time + whole;
    const skipping = this.speed === "skip";
    if (skipping) until = Math.min(until, this.skipTarget);

    const result = gameEngine.advance(this.world, until, { stopOnInterrupt: skipping });
    if (skipping && (result.interrupted || this.world.time >= this.skipTarget)) {
      this.speed = "paused";
      this.carry = 0;
    }
    this.handleEvents(result.events);
    this.changed();
  }

  /** Issue a player command now. Returns the rejection reason, if any. */
  command(type: string, payload: Json): string | null {
    const result = gameEngine.advance(this.world, this.world.time, { commands: [{ t: this.world.time, actor: "player", type, payload }] });
    this.rev++;
    this.handleEvents(result.events);
    const rejected = result.events.find((e) => e.type === "command.rejected");
    const reason = rejected ? String((rejected.data as { reason?: string } | undefined)?.reason ?? "Not possible.") : null;
    if (reason) this.setStatus(reason);
    else this.changed();
    return reason;
  }

  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === "calendar.newMonth") void this.autosave();
      if (e.type === "rig.report") {
        this.rev++;
        this.status = String((e.data as { message?: string } | undefined)?.message ?? "");
        // Stuck tools, a gusher or a dry hole: stop the clock so the player can act.
        if (e.interrupt) { this.speed = "paused"; this.carry = 0; }
      }
      if (e.type === "fieldwork.report") {
        this.rev++;
        this.status = String((e.data as { message?: string } | undefined)?.message ?? "The party is back.");
      }
    }
  }

  async newCampaign(seed: Seed): Promise<void> {
    this.world = gameEngine.createWorld(seed, CAMPAIGN_START);
    this.rev++;
    this.speed = "paused";
    this.carry = 0;
    this.setStatus(`New campaign started with seed ${seed}.`);
  }

  async saveManual(): Promise<void> {
    await this.writeSlot(`manual-${Date.now()}`, "manual");
    this.setStatus(`Saved: ${formatDate(this.world.time)}.`);
  }

  private async autosave(): Promise<void> {
    const { year, month } = toCalendar(this.world.time);
    await this.writeSlot(autosaveId(year * 12 + month), "auto");
  }

  private async writeSlot(id: string, kind: "auto" | "manual"): Promise<void> {
    try {
      const save = createSave(this.world, BUILD_ID, new Date().toISOString());
      await saveStore.put({ id, kind, gameTime: save.world.time, seed: save.world.seed, savedAt: Date.now(), data: await gzip(encodeSave(save)) });
      await this.refreshSaves();
    } catch (err) {
      this.setStatus(`Could not save: ${messageOf(err)}`);
    }
  }

  async loadSlot(id: string): Promise<boolean> {
    return this.withBusy(async () => {
      const record = await saveStore.get(id);
      if (!record) throw new SaveError("That save no longer exists.");
      this.adopt(decodeSave(await gunzip(record.data), gameEngine));
      this.setStatus(`Loaded: ${formatDate(this.world.time)}.`);
    });
  }

  async deleteSlot(id: string): Promise<void> {
    await saveStore.delete(id);
    await this.refreshSaves();
  }

  /** The current world as a downloadable `.blackgold` file (gzipped JSON). */
  async exportFile(): Promise<{ name: string; blob: Blob }> {
    const save = createSave(this.world, BUILD_ID, new Date().toISOString());
    const { year, month, day } = toCalendar(this.world.time);
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const bytes = await gzip(encodeSave(save));
    return { name: `black-gold-${date}-${save.world.seed}.blackgold`, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/gzip" }) };
  }

  async importFile(file: Blob): Promise<boolean> {
    return this.withBusy(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text: string;
      try {
        text = await gunzip(bytes);
      } catch {
        throw new SaveError("This file is not a BLACK GOLD save.");
      }
      this.adopt(decodeSave(text, gameEngine));
      this.setStatus(`Imported: ${formatDate(this.world.time)}.`);
    });
  }

  private adopt(save: SaveFile): void {
    this.world = save.world;
    this.rev++;
    this.speed = "paused";
    this.carry = 0;
  }

  private async withBusy(fn: () => Promise<void>): Promise<boolean> {
    this.busy = true;
    this.changed();
    try {
      await fn();
      return true;
    } catch (err) {
      this.setStatus(err instanceof SaveError ? err.message : `Something went wrong: ${messageOf(err)}`);
      return false;
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  private async refreshSaves(): Promise<void> {
    try {
      this.saves = await saveStore.list();
    } catch {
      this.saves = [];
      this.setStatus("Saving is unavailable in this browser (storage is blocked). You can still export a save file.");
    }
    this.changed();
  }

  private setStatus(status: string): void {
    this.status = status;
    this.changed();
  }

  private makeSnapshot(): Snapshot {
    return { time: this.world.time, knowledge: knowledgeOf(this.world), print: printedMap(this.world.seed), rev: this.rev, ops: operationsOf(this.world), atRig: this.atRig, speed: this.speed, seed: this.world.seed, status: this.status, saves: this.saves, busy: this.busy };
  }

  private changed(): void {
    this.snap = this.makeSnapshot();
    for (const fn of this.listeners) fn();
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatDate(t: number, style: "long" | "short" = "short"): string {
  const c = toCalendar(t);
  return style === "long" ? `${WEEKDAYS[c.weekday]}, ${c.day} ${MONTHS[c.month - 1]} ${c.year}` : `${c.day} ${MONTHS_SHORT[c.month - 1]} ${c.year}`;
}

export function formatClock(t: number): string {
  const { hour, minute } = toCalendar(t);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
