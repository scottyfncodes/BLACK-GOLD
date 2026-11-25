import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gameEngine, MINUTES_PER_DAY, operationsOf, PIPE, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { recompute } from "../../src/sim/company/ledger";
import { startingDriller } from "../../src/sim/company/crew";
import { MIGRATIONS, worldProblem } from "../../src/sim/migrations";
import { decodeSave, SCHEMA_VERSION } from "../../src/app/save/format";

/**
 * A real schema-3 save, made by the production build (main at bd7d227): a well drilling at
 * 585 ft with the old continuous casing to 486 ft, a $100 loan and a lease. It must load into
 * the current schema with the game state preserved, and play on.
 */
const text = readFileSync(new URL("../fixtures/save-v3.json", import.meta.url), "utf8");
const raw = JSON.parse(text) as { schemaVersion: number; world: WorldState };
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });

describe("a production schema-3 save", () => {
  it("loads into the current schema with the books, land, loan, clock and well preserved", () => {
    expect(raw.schemaVersion).toBe(3);
    const before = raw.world.systems.operations as unknown as Record<string, unknown> & { well: Record<string, unknown> };
    const save = decodeSave(text, gameEngine);
    expect(save.schemaVersion).toBe(SCHEMA_VERSION);
    const w = save.world;
    expect(worldProblem(w)).toBeNull();
    const o = operationsOf(w);
    for (const k of ["leases", "production", "contract", "outcome", "samples", "past"]) expect(canonicalJson((w.systems.operations as unknown as Record<string, unknown>)[k] as never), k).toBe(canonicalJson(before[k] as never));
    // The books keep every entry, with one more at the end: the rig revalued at period prices (v4 → v5).
    const ledger = (w.systems.operations as unknown as { ledger: { entries: unknown[] } }).ledger;
    const was = before.ledger as { entries: unknown[] };
    expect(canonicalJson(ledger.entries.slice(0, was.entries.length) as never)).toBe(canonicalJson(was.entries as never));
    expect(ledger.entries).toHaveLength(was.entries.length + 1);
    expect(o.ledger.entries.at(-1)!.memo).toBe("Rig and tools revalued at period prices: $400 to $1500");
    expect(o.bank).toEqual({ ...(before.bank as object), rigBookCents: 150_000 });
    expect(recompute(o.ledger)).toEqual(o.ledger.balances);
    expect(w.time).toBe(raw.world.time);
    expect(canonicalJson(w.rng as never)).toBe(canonicalJson(raw.world.rng as never));
    expect(canonicalJson(w.systems.knowledge as never)).toBe(canonicalJson(raw.world.systems.knowledge as never));
    // The well keeps every field it had; the old casing becomes one 10-inch string, already paid for.
    for (const [k, v] of Object.entries(before.well)) expect(canonicalJson((o.well as unknown as Record<string, unknown>)[k] as never), k).toBe(canonicalJson(v as never));
    expect(o.well!.strings).toEqual([{ size: 0, seatFt: Math.round(before.well.casedFt as number), costCents: 0, setAt: w.time, seatCall: null, observed: "dry", pulled: false }]);
    // The company has the ordinary driller a new game starts with, at the same $12 a day.
    expect(o.crew.driller).toEqual(startingDriller(w.seed));
    expect(o.dayRate).toBe(12);
  });

  it("migrates idempotently, at each step", () => {
    const once = MIGRATIONS[3]!(structuredClone(raw.world) as never);
    expect(canonicalJson(MIGRATIONS[3]!(once) as never)).toBe(canonicalJson(once as never));
    const five = MIGRATIONS[4]!(once);
    expect(canonicalJson(MIGRATIONS[4]!(five) as never)).toBe(canonicalJson(five as never));
  });

  it("plays on: the driller drills, advises, and the next string is the 8¼-inch", () => {
    const w = decodeSave(text, gameEngine).world;
    const end = w.time + 20 * MINUTES_PER_DAY;
    for (let k = 0; k < 400 && w.time < end; k++) {
      const st = operationsOf(w).well!.status;
      if (st === "gusher" || st === "dry") break;
      gameEngine.advance(w, end, { stopOnInterrupt: true });
      const p = operationsOf(w).crew.pending;
      if (p) cmd(w, "crew.accept", { id: p.id });
      if (operationsOf(w).well!.status === "stuck" && !operationsOf(w).crew.pending && !operationsOf(w).well!.busy) cmd(w, "rig.fish");
    }
    const o = operationsOf(w);
    expect(o.well!.depthFt).toBeGreaterThan(585);
    expect(recompute(o.ledger)).toEqual(o.ledger.balances);
    expect(worldProblem(w)).toBeNull();
    if (o.well!.strings.length > 1) expect(o.well!.strings[1]!.size).toBe(1);
    else if (o.well!.status === "drilling" && !o.well!.busy) {
      o.well!.auto = false;
      expect(cmd(w, "rig.case").events.find((e) => e.type === "command.rejected")).toBeUndefined();
      gameEngine.advance(w, operationsOf(w).well!.busy!.until + 5);
      expect(operationsOf(w).well!.strings[1]).toMatchObject({ size: 1 });
      expect(PIPE[1]!.name).toBe("8¼-inch");
    }
  });
});
