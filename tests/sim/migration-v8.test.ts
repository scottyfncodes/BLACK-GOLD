import { describe, expect, it } from "vitest";
import { gameEngine, MINUTES_PER_DAY, operationsOf, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { v7ToV8 } from "../../src/sim/migrations";
import type { FieldState } from "../../src/sim/hidden/reservoir";
import { columnAt, generateGeology, isCharged } from "../../src/sim/geology/truth/model";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { noRunningSand } from "../helpers/ground";

/**
 * v7 → v8 (M8a): production moves onto the hidden field's tanks. A producing well in an old save
 * must go on producing exactly as it would have.
 */
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });

function producing(): WorldState {
  for (let i = 0; i < 400; i++) {
    const seed = (0x0b10000 + i).toString(16).padStart(16, "0");
    const t = generateGeology(seed);
    for (const d of t.domes.filter(isCharged)) for (const r of [0, d.saltR + 0.05]) {
      const x = d.x + r, y = d.y;
      if (!SURVEYS.some((s) => insidePoly(s.poly, x, y))) continue;
      const hc = columnAt(t, x, y, 180).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
      if (hc?.fluid !== "oil" || !noRunningSand(seed, x, y, hc.top * 3.2808)) continue;
      const w = gameEngine.createWorld(seed, 0);
      cmd(w, "lease.take", { surveyId: SURVEYS.find((s) => insidePoly(s.poly, x, y))!.id, offer: "asking" });
      if (cmd(w, "rig.spud", { x, y }).events.some((e) => e.type === "command.rejected")) continue;
      gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
      cmd(w, "rig.auto", { on: true });
      for (let k = 0; k < 300 && operationsOf(w).well!.status !== "gusher" && operationsOf(w).well!.status !== "dry"; k++) {
        gameEngine.advance(w, w.time + MINUTES_PER_DAY, { stopOnInterrupt: true });
        const p = operationsOf(w).crew.pending;
        if (p) cmd(w, p.kind === "quit" || p.kind === "decide" ? "crew.decline" : "crew.accept", { id: p.id });
        if (operationsOf(w).well!.status === "stuck" && !operationsOf(w).crew.pending) cmd(w, "rig.fish");
      }
      if (!operationsOf(w).well!.outcome?.startsWith("OIL")) continue;
      cmd(w, "prod.cap");
      if (!operationsOf(w).production.producers.length) continue;
      gameEngine.advance(w, w.time + 400 * MINUTES_PER_DAY);
      return w;
    }
  }
  throw new Error("no producing world");
}

/** The same world as a v7 save held it: the hidden figures on the producer, the counts per trap in the book. */
function asV7(w: WorldState): Record<string, unknown> {
  const old = structuredClone(w) as unknown as { systems: { operations: Record<string, unknown> & { field: FieldState; production: { producers: Record<string, unknown>[] } } } };
  const ops = old.systems.operations;
  const drawn: Record<string, number> = {};
  for (const p of ops.production.producers) {
    const tap = ops.field.taps.find((t) => t.wellId === p.wellId)!;
    p.trap = tap.tank; p.initialBbl = tap.q0; p.reserveBbl = ops.field.tanks[tap.tank]!.originalBbl;
    drawn[tap.tank] = ops.field.tanks[tap.tank]!.drawnBbl;
    delete p.firstDayBbl; delete p.months;
  }
  (ops.production as Record<string, unknown>).drawn = drawn;
  delete (ops as Record<string, unknown>).field;
  return old as never;
}

describe("what the UI can read of production (M8a)", () => {
  it("is the company's own barrels only: no field, no tank, no reserve, no opening flow, no key shared between wells", () => {
    const w = producing();
    const view = operationsOf(w) as unknown as Record<string, unknown>;
    expect(view).not.toHaveProperty("field");
    for (const p of operationsOf(w).production.producers) {
      expect(Object.keys(p).sort()).toEqual(["cumBbl", "firstDayBbl", "lastDayBbl", "monthBbl", "months", "name", "since", "surveyId", "waterCut", "wellId", "x", "y"]);
    }
    expect(Object.keys(operationsOf(w).production)).toEqual(["producers"]);
  });
});

describe("v7 → v8", () => {
  it("moves the hidden figures to the field and production goes on exactly as before", () => {
    const w = producing();
    const up = v7ToV8(asV7(w)) as unknown as WorldState;
    const ops = (x: WorldState) => x.systems.operations as unknown as { field: FieldState; production: { producers: { cumBbl: number; firstDayBbl: number; months: number[] }[] } };
    expect(canonicalJson(ops(up).field as never)).toBe(canonicalJson(ops(w).field as never));
    // The visible book carries no trap, reserve or opening flow.
    for (const p of ops(up).production.producers) for (const k of ["trap", "initialBbl", "reserveBbl"]) expect(p).not.toHaveProperty(k);
    expect(v7ToV8(up as never)).toEqual(up);
    // Another two years: the migrated world produces barrel for barrel as the original.
    gameEngine.advance(w, w.time + 730 * MINUTES_PER_DAY);
    gameEngine.advance(up, up.time + 730 * MINUTES_PER_DAY);
    expect(ops(up).production.producers.map((p) => p.cumBbl)).toEqual(ops(w).production.producers.map((p) => p.cumBbl));
    expect(canonicalJson(ops(up).field as never)).toBe(canonicalJson(ops(w).field as never));
    expect(canonicalJson(operationsOf(up).ledger as never)).toBe(canonicalJson(operationsOf(w).ledger as never));
  });
});
