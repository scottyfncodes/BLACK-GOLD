import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, knowledgeOf, MINUTES_PER_DAY, operationsOf, positionOf, recoveryPaths, type WorldState } from "../../src/sim";
import { SURVEYS, centroid } from "../../src/content/geography/surveys";
import { nextStep } from "../../src/ui/advice";

/**
 * The plate's advice never offers what the company cannot do: "borrow" only when a path needs
 * the bank, "contract" only when contract work is open, "drill again" only when a well can be
 * paid for. Checked over random play, after every step.
 */
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const paths = (w: WorldState) => (operationsOf(w).outcome.endedAt === null ? recoveryPaths(positionOf(w.systems.operations as never, w.seed, w.time)) : []);
const advice = (w: WorldState) => nextStep({ ops: operationsOf(w), paths: paths(w), knowledge: knowledgeOf(w), formatDate: (t) => String(t), surveyName: (id) => SURVEYS.find((s) => s.id === id)?.name ?? "" });

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
}

describe("the plate's advice", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("only recommends what the company can do (sequence %i)", (n) => {
    const r = lcg(0xad1ce + n * 104_729);
    const w = gameEngine.createWorld((0x5a7e1000 + n).toString(16).padStart(16, "0"), CAMPAIGN_START);
    const ids = SURVEYS.slice(0, 10).map((s) => s.id);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
    for (let step = 0; step < 120; step++) {
      const k = r();
      if (k < 0.3) gameEngine.advance(w, w.time + Math.floor(r() * 40 * MINUTES_PER_DAY) + 1);
      else if (k < 0.4) cmd(w, "lease.take", { surveyId: pick(ids), offer: "asking" });
      else if (k < 0.5) cmd(w, "bank.borrow", { cents: pick([5_000, 15_000, 30_000]) });
      else if (k < 0.55) cmd(w, "bank.repay", { cents: 1_000_000 });
      else if (k < 0.7) { const id = pick(ids); const [x, y] = centroid(SURVEYS.find((s) => s.id === id)!.poly); cmd(w, "rig.spud", { x, y }); }
      else if (k < 0.8) cmd(w, "rig.auto", { on: true });
      else if (k < 0.85) cmd(w, "rig.fish");
      else if (k < 0.9) cmd(w, "rig.abandon");
      else if (k < 0.95) cmd(w, "company.contract");
      else cmd(w, "prod.cap");
      const ps = paths(w), text = advice(w);
      const kinds = ps.map((p) => p.kind);
      if (/borrow/i.test(text)) { expect(ps.some((p) => "borrowCents" in p && p.borrowCents > 0), text).toBe(true); }
      if (/Take a contract/.test(text)) expect(kinds, text).toContain("contract");
      if (/drill again/.test(text)) expect(kinds.some((k2) => k2 === "drill" || k2 === "leaseAndDrill"), text).toBe(true);
      if (/used rig/.test(text)) expect(kinds, text).toContain("buyRig");
      if (operationsOf(w).outcome.ended) expect(text).toMatch(/company is finished/);
    }
  });

  it("names the way back after the review's failure: broke, with the rig, no debt", () => {
    const w = gameEngine.createWorld("e459b94df4abf2ce", CAMPAIGN_START);
    // Spend down to nothing the way a failed well does: lease, drill, run out.
    const s = SURVEYS[3]!;
    cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
    const [x, y] = centroid(s.poly);
    cmd(w, "rig.spud", { x, y });
    cmd(w, "rig.auto", { on: true });
    for (let d = 0; d < 400 && operationsOf(w).well!.status !== "dry" && operationsOf(w).well!.status !== "gusher"; d++) {
      gameEngine.advance(w, w.time + MINUTES_PER_DAY);
      if (operationsOf(w).well!.status === "stuck") cmd(w, "rig.fish");
    }
    expect(operationsOf(w).well!.status).toBe("dry"); // this ground (survey 3 of this world) holds no oil within reach
    const text = advice(w);
    expect(text).toMatch(/Take a contract with the rig/);
    expect(text).not.toMatch(/bank will lend against the rig/);
  });
});
