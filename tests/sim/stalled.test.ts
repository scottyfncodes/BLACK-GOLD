import { describe, expect, it } from "vitest";
import { gameEngine, MINUTES_PER_DAY, operationsOf, type WorldState } from "../../src/sim";
import { assess, NO_HOLE, noHoleDays, type Observations } from "../../src/sim/company/judgement";
import type { Ability } from "../../src/sim/hidden/drillers";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";

/**
 * M9a-0: a hole that makes no footage. Found by the M9.0 harness: in running sand with every
 * size of pipe in the hole, the bailer comes up from the same bottom over and over, and a hired
 * driller trusted with his own judgement bailed on for years at a rich company's cost, saying
 * nothing. Now he recognises it from what the crew sees (bails from the same bottom, days of it),
 * says what he sees and what could still be tried, recommends plugging, and asks. He never plugs
 * the hole himself, and told to keep at it, he raises it again a week later.
 */
const DAY = MINUTES_PER_DAY;
const cmd = (w: WorldState, type: string, payload: unknown = null) => gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const OBS: Observations = { depthFt: 347, casedFt: 300, stringsLeft: 0, nextPipe: null, nextCostCents: 0, openSandFt: 40, bottom: null, waterSeen: true, waterShutOff: false, stuck: false, fishCount: 0, cashCents: 5_000_000, dayCents: 1_200, fishingCents: 6_000, creditRoomCents: 0, wellSpentCents: 90_000, lastShow: null, inflowFtHr: 20, driving: null, collapse: null, driveHead: true, nextDriveCents: 0, swageCents: 15_000, expect: null, rockDry: null, rockFt: null, inSalt: false, gypsumFt: null, sheenFt: null, paceFtDay: 40, noHole: { bails: 0, days: 0 } };
const GOOD: Ability = { feel: 0.8, judgement: 0.9, reliability: 0.8, prudence: 0.5 };
const POOR: Ability = { feel: 0.3, judgement: 0.1, reliability: 0.3, prudence: 0.5 };

describe("assess: a hole that makes no footage", () => {
  it("says so, names the sand and that no pipe is left, and recommends plugging", () => {
    const a = assess({ ...OBS, noHole: { bails: 300, days: 6 } }, GOOD, "methodical", 0.5, 0.5)!;
    expect(a.kind).toBe("stalled");
    expect(a.text).toMatch(/made no hole/);
    expect(a.text).toMatch(/as fast as we bail it/);
    expect(a.text).toMatch(/nothing smaller to drive/);
    expect(a.text).toMatch(/I'd plug it/);
  });
  it("names the pipe that could still be driven when there is one", () => {
    const a = assess({ ...OBS, stringsLeft: 1, nextPipe: "6⅝-inch", nextDriveCents: 12_800, openSandFt: 5, noHole: { bails: 300, days: 6 } }, GOOD, "methodical", 0.5, 0.5)!;
    expect(a.kind).toBe("stalled");
    expect(a.text).toMatch(/The 6⅝-inch could still be driven through it \(about \$128\)/);
  });
  it("needs both: bails from the same bottom, and days of it; a poor judge or a hard driver takes longer", () => {
    expect(assess({ ...OBS, noHole: { bails: NO_HOLE.bails - 1, days: 10 } }, GOOD, "methodical", 0.5, 0.5)?.kind).not.toBe("stalled");
    expect(assess({ ...OBS, noHole: { bails: 300, days: 4 } }, GOOD, "methodical", 0.5, 0.5)?.kind).not.toBe("stalled");
    expect(noHoleDays(GOOD, "methodical")).toBeLessThan(noHoleDays(POOR, "methodical"));
    expect(noHoleDays(GOOD, "methodical")).toBeLessThan(noHoleDays(GOOD, "aggressive"));
    // Running sand slows far more holes than it stops: about five days for a good judge, never more than nine.
    expect(noHoleDays(GOOD, "methodical")).toBeGreaterThanOrEqual(5);
    expect(noHoleDays(POOR, "aggressive")).toBeLessThanOrEqual(9);
    expect(assess({ ...OBS, noHole: { bails: 300, days: 6 } }, POOR, "methodical", 0.5, 0.5)?.kind).not.toBe("stalled");
    expect(assess({ ...OBS, noHole: { bails: 300, days: 9 } }, POOR, "aggressive", 0.5, 0.5)?.kind).toBe("stalled");
  });
  it("comes before any talk of money: it is a fact about the hole, not a guess about the ground", () => {
    expect(assess({ ...OBS, cashCents: 1_000, noHole: { bails: 300, days: 7 } }, GOOD, "methodical", 0.5, 0.5)?.kind).toBe("stalled");
  });
});

/** The world M9.0 found it in: seed ab99a, running sand at 347 ft, all three strings driven. */
function stallWorld(): WorldState {
  const at = { x: 19.18983450497219, y: 10.780159621720504 };
  const w = gameEngine.createWorld("00000000000ab99a", 0);
  (w.systems.operations as unknown as { ledger: { balances: Record<string, number> } }).ledger.balances.cash = 5_000_000;
  cmd(w, "crew.orders", { authority: "judgement", budgetCents: 100_000 });
  cmd(w, "lease.take", { surveyId: SURVEYS.find((s) => insidePoly(s.poly, at.x, at.y))!.id, offer: "asking" });
  expect(cmd(w, "rig.spud", at).events.find((e) => e.type === "command.rejected")).toBeUndefined();
  gameEngine.advance(w, w.time + 3 * DAY + 10);
  cmd(w, "rig.auto", { on: true });
  return w;
}

describe("in the game: the driller trusted with his own judgement, a rich company, running sand", () => {
  it("raises it within days, never plugs it himself, raises it again a week after being told to keep at it, and plugs it when told", () => {
    const w = stallWorld();
    const raised: number[] = [];
    let declined = 0;
    for (let q = 0; q < 200; q++) {
      gameEngine.advance(w, w.time + DAY / 4, { stopOnInterrupt: true });
      const o = operationsOf(w);
      expect(["rigging", "drilling", "stuck"]).toContain(o.well!.status);
      const p = o.crew.pending;
      if (p?.kind === "stalled") {
        raised.push(w.time);
        expect(p.text).toMatch(/made no hole/);
        if (declined < 2) { cmd(w, "crew.decline", { id: p.id }); declined++; }
        else {
          cmd(w, "crew.accept", { id: p.id });
          break;
        }
      } else if (p) cmd(w, "crew.decline", { id: p.id });
    }
    expect(raised.length).toBe(3);
    // The first time after about a week of the hole standing still; then a week apart.
    const stood = operationsOf(w).well!.spudAt + 7 * DAY;
    expect(raised[0]! - stood).toBeGreaterThan(4 * DAY);
    expect(raised[0]! - stood).toBeLessThan(11 * DAY);
    expect(raised[1]! - raised[0]!).toBeGreaterThanOrEqual(7 * DAY);
    expect(raised[1]! - raised[0]!).toBeLessThan(8 * DAY);
    const well = operationsOf(w).well!;
    expect(well.status).toBe("dry");
    expect(well.outcome).toMatch(/where no hole could be made/);
  });
  it("left alone, he keeps bailing (the choice is the owner's) but keeps saying so", () => {
    const w = stallWorld();
    let raised = 0;
    for (let d = 0; d < 30; d++) {
      const r = gameEngine.advance(w, w.time + DAY);
      raised += r.events.filter((e) => e.type === "driller.advice" && (e.data as { kind: string }).kind === "stalled").length;
    }
    expect(operationsOf(w).well!.status).toBe("drilling");
    // Unanswered advice lapses as "keep at it"; he says it again each week.
    expect(raised).toBeGreaterThanOrEqual(2);
    expect(raised).toBeLessThanOrEqual(4);
  });
});
