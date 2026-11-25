import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, MINUTES_PER_DAY, operationsOf, positionOf, printedMap, recoveryPaths, type Driller, type WorldState } from "../../src/sim";
import { candidatesFor } from "../../src/sim/company/crew";
import { abilityOf } from "../../src/sim/hidden/drillers";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { columnAt, generateGeology } from "../../src/sim/geology/truth/model";
import { noRunningSand } from "../helpers/ground";

/**
 * A small seeded balance harness (docs/DESIGN.md R6), run in CI. Its full-size sibling is the
 * stage-6 harness recorded in DESIGN.md §8; this one keeps the guarantees from regressing:
 * - a capable driller, following his technical advice, costs less per foot and fails less than
 *   a poor one, measured over several grounds (not strike counts on a handful of sites);
 * - the PR #5 recovery requirement: a first well that runs out of money, the company still
 *   owning its rig, leads to a second well by the game's own paths.
 * Truth is used only to choose test ground.
 */
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const ops = (w: WorldState) => operationsOf(w);
const seedN = (i: number) => (0xa0000 + i * 7919).toString(16).padStart(16, "0");
const surveyAt = (x: number, y: number) => SURVEYS.find((s) => insidePoly(s.poly, x, y));

function bestOil(seed: string) {
  const t = generateGeology(seed);
  let best: { x: number; y: number; ft: number } | null = null;
  for (const s of SURVEYS) {
    const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.25)
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.25) {
        if (!insidePoly(s.poly, x, y)) continue;
        const hc = columnAt(t, x, y, 500).find((iv) => iv.fluid === "oil");
        // Quiet ground: drilling skill is measured where running sand does not decide the hole (see the quicksand test).
        if (hc && (!best || hc.top * 3.2808 < best.ft) && noRunningSand(seed, x, y, hc.top * 3.2808)) best = { x, y, ft: hc.top * 3.2808 };
      }
  }
  return best;
}

function extremes(seed: string): { good: Driller; poor: Driller } {
  const all = Array.from({ length: 24 }, (_, m) => candidatesFor(seed, m)).flat();
  const score = (d: Driller) => { const a = abilityOf(seed, d.id); return a.feel + a.judgement + a.reliability; };
  all.sort((p, q) => score(q) - score(p));
  return { good: all[0]!, poor: all.at(-1)! };
}

/**
 * The driller drills, the player says yes to his advice. Returns the well's tally. With
 * `drillOn`, counsel to quit is declined: the well is drilled out, to measure drilling skill
 * over the same holes (money sense is a separate, independent trait).
 */
function play(seed: string, at: { x: number; y: number }, man: Driller | null, drillOn = false) {
  const w = gameEngine.createWorld(seed, CAMPAIGN_START);
  if (man) (w.systems.operations as unknown as { crew: { driller: Driller } }).crew.driller = man;
  cmd(w, "lease.take", { surveyId: surveyAt(at.x, at.y)!.id, offer: "asking" });
  const cash0 = ops(w).cash;
  cmd(w, "rig.spud", at);
  cmd(w, "rig.auto", { on: true });
  let stuck = 0;
  for (let k = 0; k < 2000; k++) {
    const st = ops(w).well!.status;
    if (st === "gusher" || st === "dry") break;
    const r = gameEngine.advance(w, w.time + 30 * MINUTES_PER_DAY, { stopOnInterrupt: true });
    if (r.events.some((e) => e.type === "rig.report" && (e.data as { kind?: string }).kind === "stuck")) stuck++;
    const p = ops(w).crew.pending;
    if (p) cmd(w, drillOn && p.kind === "quit" ? "crew.decline" : "crew.accept", { id: p.id });
    if (ops(w).well!.status === "stuck" && !ops(w).crew.pending && !ops(w).well!.busy) cmd(w, "rig.fish");
  }
  return { w, feet: ops(w).well!.depthFt, cost: cash0 - ops(w).cash, stuck };
}

describe("balance (seeded)", () => {
  it("a capable driller costs less per foot and gets stuck less than a poor one, across grounds", () => {
    let goodCost = 0, poorCost = 0, goodFeet = 0, poorFeet = 0, goodStuck = 0, poorStuck = 0;
    let n = 0;
    for (let i = 0; i < 30 && n < 10; i++) {
      const seed = seedN(i);
      const at = bestOil(seed);
      if (!at) continue;
      n++;
      const { good, poor } = extremes(seed);
      const g = play(seed, at, good, true), p = play(seed, at, poor, true);
      goodCost += g.cost; goodFeet += g.feet; goodStuck += g.stuck;
      poorCost += p.cost; poorFeet += p.feet; poorStuck += p.stuck;
    }
    expect(goodCost / goodFeet).toBeLessThan(poorCost / poorFeet);
    expect(goodStuck / goodFeet).toBeLessThan(poorStuck / poorFeet);
  }, 240_000);

  it("PR #5's recovery requirement: a first well that ran out of money leads to a second well", () => {
    let failed = 0, recovered = 0;
    for (let i = 0; i < 20 && failed < 6; i++) {
      const seed = seedN(i);
      const hill = printedMap(seed).hills[0];
      if (!hill) continue;
      const at = { x: hill.x + 0.15, y: hill.y + 0.1 };
      if (!surveyAt(at.x, at.y)) continue;
      const { w } = play(seed, at, null, true); // the owner drills on past his counsel, to the last dollar
      if (!ops(w).well!.outcome?.startsWith("The money")) continue;
      failed++;
      expect(ops(w).outcome.endedAt).toBeNull();
      for (let k = 0; k < 12; k++) {
        const ps = recoveryPaths(positionOf(w.systems.operations as never, w.seed, w.time));
        const drill = ps.find((p) => p.kind === "drill" || p.kind === "leaseAndDrill");
        const borrow = (c: number) => { if (c > 0) cmd(w, "bank.borrow", { cents: c }); };
        if (drill) {
          borrow(drill.borrowCents);
          if (drill.kind === "leaseAndDrill") cmd(w, "lease.take", { surveyId: drill.surveyId, offer: "asking" });
          const s = SURVEYS.find((x) => x.id === drill.surveyId)!;
          const [x, y] = [s.poly.reduce((a, q) => a + q[0], 0) / s.poly.length, s.poly.reduce((a, q) => a + q[1], 0) / s.poly.length];
          if (!cmd(w, "rig.spud", { x, y }).events.some((e) => e.type === "command.rejected")) { recovered++; break; }
        }
        const pull = ps.find((p) => p.kind === "pull");
        if (pull) { borrow(pull.borrowCents); cmd(w, "rig.pull"); gameEngine.advance(w, w.time + 6 * MINUTES_PER_DAY); continue; }
        const c = ps.find((p) => p.kind === "contract");
        if (c) { borrow(c.borrowCents); cmd(w, "company.contract"); gameEngine.advance(w, w.time + 31 * MINUTES_PER_DAY); continue; }
        break;
      }
    }
    expect(failed).toBeGreaterThan(2);
    expect(recovered).toBe(failed);
  }, 240_000);
});
