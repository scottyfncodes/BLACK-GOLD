import { describe, expect, it } from "vitest";
import { createEngine, GAME_SYSTEMS, hashState, MINUTES_PER_DAY, operationsOf, type Command, type WorldState } from "../../src/sim";
import { createSave, decodeSave, encodeSave } from "../../src/app/save/format";
import { gunzip, gzip } from "../../src/app/save/gzip";
import type { FieldState } from "../../src/sim/hidden/reservoir";

/**
 * M8's golden run: a strike, an offset beside it, and the Rush the strike brings, over five
 * years, on a seed whose dome has oil at 1,335 ft under ground free of running sand (A-121-7-5,
 * found once from truth for this test and fixed here as numbers). Same seed and commands, same
 * world; a save taken mid-rush continues exactly; however time is sliced, the same field.
 */
const SEED = "0000000000b10005";
const engine = createEngine(GAME_SYSTEMS);
const DAY = MINUTES_PER_DAY;
const STRIKE = { surveyId: "A-121-7-5", x: 19.5791, y: 11.4509 };
const OFFSET = { x: 19.6791, y: 11.4509 };
const FIVE_YEARS = 5 * 365 * DAY;

const script: Command[] = ([
  // The driller may case and fish on his own judgement, within a budget: the company does not answer him by script.
  [1, "crew.orders", { authority: "judgement", budgetCents: 100_000 }],
  [1, "lease.take", { surveyId: STRIKE.surveyId, offer: "asking" }],
  [1, "rig.spud", { x: STRIKE.x, y: STRIKE.y }],
  [5, "rig.auto", { on: true }],
  [10, "bank.borrow", { cents: 30_000 }],
  ...Array.from({ length: 40 }, (_, i) => [6 + i * 4, "rig.fish", null] as const),
  ...Array.from({ length: 20 }, (_, i) => [30 + i * 6, "prod.cap", null] as const),
  [200, "rig.spud", OFFSET],
  [204, "rig.auto", { on: true }],
  ...Array.from({ length: 40 }, (_, i) => [206 + i * 4, "rig.fish", null] as const),
  ...Array.from({ length: 20 }, (_, i) => [230 + i * 6, "prod.cap", null] as const),
] as const).map(([d, type, payload]) => ({ t: d * DAY + 7 * 60, actor: "player", type, payload: payload as Command["payload"] })).sort((a, b) => a.t - b.t);

function run(until: number): WorldState {
  const w = engine.createWorld(SEED, 0);
  engine.advance(w, until, { commands: script.filter((c) => c.t <= until) });
  return w;
}

describe("the field's golden run (M8)", () => {
  it("strikes, offsets, draws the Rush, and matches its golden hash after five years", () => {
    const w = run(FIVE_YEARS);
    const o = operationsOf(w);
    expect(o.production.producers.length).toBe(2);
    expect(o.rush.wells.length).toBeGreaterThan(3);
    expect(o.rush.wells.some((x) => x.status === "dry")).toBe(true);
    expect(o.rush.wells.some((x) => x.status === "oil")).toBe(true);
    const field = (w.systems.operations as unknown as { field: FieldState }).field;
    for (const t of Object.values(field.tanks)) expect(t.drawnBbl).toBeLessThanOrEqual(t.originalBbl);
    // If this changes, the field's behaviour changed. Update it only on purpose.
    expect(hashState(w)).toBe(GOLDEN_FIELD_HASH);
  });

  it("gives the identical field however time is sliced", () => {
    const whole = run(FIVE_YEARS);
    const w = engine.createWorld(SEED, 0);
    const pending = [...script];
    let i = 0;
    while (w.time < FIVE_YEARS) {
      const to = Math.min(FIVE_YEARS, w.time + 1 + ((i++ * 7919) % (9 * DAY)));
      const due: Command[] = [];
      while (pending.length && pending[0]!.t <= to) due.push(pending.shift()!);
      engine.advance(w, to, { commands: due });
    }
    expect(hashState(w)).toBe(hashState(whole));
  });

  it("continues identically after save → gzip → load in the middle of the Rush", async () => {
    const mid = 420 * DAY + 13;
    const saved = run(mid);
    expect(operationsOf(saved).rush.wells.length).toBeGreaterThan(0);
    const loaded = decodeSave(await gunzip(await gzip(encodeSave(createSave(saved, "test", "1890-01-01T00:00:00Z")))), engine).world;
    engine.advance(loaded, FIVE_YEARS, { commands: script.filter((c) => c.t > mid) });
    expect(hashState(loaded)).toBe(hashState(run(FIVE_YEARS)));
  });
});

// Pinned on purpose for M8b: the strike, the offset and the Rush on this seed.
const GOLDEN_FIELD_HASH = "0f035f101b1cbb";
