import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, MINUTES_PER_DAY, operationsOf, type WorldState } from "../../src/sim";
import { cashCents, debtCents, recompute } from "../../src/sim/company/ledger";
import { worldProblem } from "../../src/sim/migrations";
import { SURVEYS, centroid } from "../../src/content/geography/surveys";

/**
 * Property: whatever the player does, in whatever order, the books balance after every
 * transaction, cash never goes below zero and the debt never below zero.
 */
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });

/** A small deterministic generator, so a failure names its sequence. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
}

const SURVEY_IDS = SURVEYS.slice(0, 8).map((s) => s.id);

function randomAction(r: () => number): [string, unknown] | ["wait", number] {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const k = r();
  if (k < 0.3) return ["wait", Math.floor(r() * 45 * MINUTES_PER_DAY)];
  if (k < 0.42) return ["lease.take", { surveyId: pick(SURVEY_IDS), offer: r() < 0.5 ? "asking" : "lower" }];
  if (k < 0.48) return ["lease.release", { surveyId: pick(SURVEY_IDS) }];
  if (k < 0.58) return ["bank.borrow", { cents: pick([5_000, 10_000, 20_000, 50_000]) }];
  if (k < 0.66) return ["bank.repay", { cents: pick([5_000, 1_000_000]) }];
  if (k < 0.76) {
    const id = pick(SURVEY_IDS);
    const s = SURVEYS.find((x) => x.id === id)!;
    const [x, y] = centroid(s.poly);
    return ["rig.spud", { x, y }];
  }
  if (k < 0.82) return ["rig.auto", { on: true }];
  if (k < 0.86) return ["rig.fish", null];
  if (k < 0.9) return ["prod.cap", null];
  if (k < 0.92) return ["company.contract", null];
  if (k < 0.93) return ["company.buyRig", null];
  if (k < 0.95) return ["rig.case", null];
  if (k < 0.96) return ["rig.abandon", null];
  if (k < 0.97) return ["rig.pull", null];
  if (k < 0.98) return ["crew.orders", { authority: r() < 0.5 ? "ask" : "judgement", budgetCents: pick([0, 10_000, 50_000]) }];
  if (k < 0.99) return ["hire", null];
  return ["answer", r() < 0.5];
}

describe("the books under any sequence of play", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("balance after every transaction (sequence %i)", (n) => {
    const r = lcg(0xb1ac + n * 7919);
    const w = gameEngine.createWorld((0x5a7e0000 + n).toString(16).padStart(16, "0"), CAMPAIGN_START);
    for (let step = 0; step < 90; step++) {
      const [type, arg] = randomAction(r);
      const o0 = operationsOf(w);
      if (type === "wait") gameEngine.advance(w, w.time + (arg as number) + 1);
      else if (type === "answer") { if (o0.crew.pending) cmd(w, arg ? "crew.accept" : "crew.decline", { id: o0.crew.pending.id }); }
      else if (type === "hire") { if (o0.crew.candidates[0]) cmd(w, "crew.hire", { id: o0.crew.candidates[0].id }); }
      else cmd(w, type, arg);
      const problem = worldProblem(w);
      expect(problem, `step ${step} (${type})`).toBeNull();
      const o = operationsOf(w);
      expect(cashCents(o.ledger), `step ${step} (${type})`).toBeGreaterThanOrEqual(0);
      expect(debtCents(o.ledger)).toBeGreaterThanOrEqual(0);
      expect(o.bank.accrued).toBeGreaterThanOrEqual(0);
      expect(recompute(o.ledger)).toEqual(o.ledger.balances);
    }
  });
});
