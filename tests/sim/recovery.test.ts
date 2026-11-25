import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, CONTRACT_DAYS, CONTRACT_PAY, CONTRACT_WAGES, gameEngine, IDLE_WARN_TICKS, MINUTES_PER_DAY, operationsOf, positionOf, printedMap, recoveryPaths, TICK_MINUTES, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { balance, post } from "../../src/sim/company/ledger";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { MIGRATIONS, worldProblem } from "../../src/sim/migrations";

/**
 * Regressions for the PR #5 gameplay review: an unattended rig must not eat the company, a
 * failed first well must leave a way back, and a company with no way forward is told so.
 */
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rejected = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
const ops = (w: WorldState) => operationsOf(w);
const paths = (w: WorldState) => recoveryPaths(positionOf(w.systems.operations as never, w.seed, w.time));
const kinds = (w: WorldState) => paths(w).map((p) => p.kind);
const reports = (r: { events: { type: string; data?: unknown }[] }, kind: string) => r.events.filter((e) => e.type === "rig.report" && (e.data as { kind?: string }).kind === kind);

/** The world from the review: Big Hill straddles a line; the leased Delacroix survey takes the well. */
const REVIEW_SEED = "e459b94df4abf2ce";
function rigged(): WorldState {
  const w = gameEngine.createWorld(REVIEW_SEED, CAMPAIGN_START);
  const hill = printedMap(REVIEW_SEED).hills[0]!;
  const at = { x: hill.x - 0.15, y: hill.y - 0.1 };
  const s = SURVEYS.find((x) => insidePoly(x.poly, at.x, at.y))!;
  cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
  expect(rejected(cmd(w, "rig.spud", at))).toBeUndefined();
  // Skip through the rig-up: it stops when the derrick is up.
  const r = gameEngine.advance(w, w.time + 40 * MINUTES_PER_DAY, { stopOnInterrupt: true });
  expect(reports(r, "rigged")).toHaveLength(1);
  expect(ops(w).well!.status).toBe("drilling");
  return w;
}

/** Spend the company's cash outside the game, leaving `leaveCents` spendable (test only). */
function drain(w: WorldState, leaveCents = 0): void {
  const o = (w.systems as unknown as Record<string, { ledger: Parameters<typeof post>[0] }>).operations!;
  const cash = balance(o.ledger, "cash");
  const accrued = cash - Math.round(ops(w).cash * 100); // rig time run today, entered at midnight
  const spend = cash - accrued - leaveCents;
  post(o.ledger, w.time, "operating", "Test: cash spent elsewhere", [{ account: "operating", cents: spend }, { account: "cash", cents: -spend }]);
}

describe("the idle rig", () => {
  it("review scenario: Skip twice after the derrick is up no longer abandons the well at 2 ft", () => {
    const w = rigged();
    const cash = ops(w).cash;
    for (let k = 1; k <= 2; k++) {
      const t0 = w.time;
      const r = gameEngine.advance(w, w.time + 40 * MINUTES_PER_DAY, { stopOnInterrupt: true });
      expect(r.interrupted).toBe(true);
      expect(reports(r, "idle")).toHaveLength(1);
      // Three idle hours (the first Skip also lets the bit settle the few inches the line allows).
      expect(w.time - t0).toBeLessThanOrEqual((IDLE_WARN_TICKS + 4) * TICK_MINUTES);
      expect(ops(w).well!.status).toBe("drilling");
    }
    // Two Skips cost about six hours of rig time (75 ticks, $3.13), not the campaign.
    expect(cash - ops(w).cash).toBeLessThan(3.25);
  });

  it("review scenario: at fast speed with nobody on the line, the clock is stopped every three idle hours", () => {
    const w = rigged();
    // The runtime pauses on these interrupts; without pausing, 38 days would bring a warning every three hours.
    const r = gameEngine.advance(w, w.time + 38 * MINUTES_PER_DAY);
    expect(reports(r, "idle").length).toBeGreaterThanOrEqual(38 * 8 - 1);
    expect(reports(r, "idle")[0]!.data).toMatchObject({ message: expect.stringMatching(/Nobody is working the line.*let the driller work/) });
  });

  it("stuck tools left waiting stop the clock too", () => {
    const w = rigged();
    cmd(w, "rig.auto", { on: true });
    for (let i = 0; i < 40 && ops(w).well!.status !== "stuck"; i++) gameEngine.advance(w, w.time + 60 * MINUTES_PER_DAY, { stopOnInterrupt: true });
    expect(ops(w).well!.status).toBe("stuck");
    const t0 = w.time;
    const r = gameEngine.advance(w, w.time + 30 * MINUTES_PER_DAY, { stopOnInterrupt: true });
    expect(reports(r, "idle")[0]!.data).toMatchObject({ message: expect.stringMatching(/still stuck/) });
    expect(w.time - t0).toBeLessThanOrEqual(IDLE_WARN_TICKS * TICK_MINUTES + TICK_MINUTES);
  });

  it("the driller can be engaged while the derrick goes up, and then the rig is never idle", () => {
    const w = gameEngine.createWorld(REVIEW_SEED, CAMPAIGN_START);
    const hill = printedMap(REVIEW_SEED).hills[0]!;
    const at = { x: hill.x - 0.15, y: hill.y - 0.1 };
    cmd(w, "lease.take", { surveyId: SURVEYS.find((x) => insidePoly(x.poly, at.x, at.y))!.id, offer: "asking" });
    cmd(w, "rig.spud", at);
    expect(ops(w).well!.status).toBe("rigging");
    expect(rejected(cmd(w, "rig.auto", { on: true }))).toBeUndefined();
    const r = gameEngine.advance(w, w.time + 6 * MINUTES_PER_DAY);
    expect(reports(r, "rigged")[0]!.data).toMatchObject({ message: expect.stringMatching(/driller is making hole/) });
    expect(reports(r, "idle")).toHaveLength(0);
    expect(ops(w).well!.depthFt).toBeGreaterThan(20);
  });

  it("warns once, with the bank in mind, when only a few days of rig time are left", () => {
    const w = rigged();
    cmd(w, "rig.auto", { on: true });
    drain(w, 5_000); // $50: four days of rig time
    const r = gameEngine.advance(w, w.time + 2 * MINUTES_PER_DAY, { stopOnInterrupt: true });
    const warn = reports(r, "lowfunds");
    expect(warn).toHaveLength(1);
    expect(warn[0]!.data).toMatchObject({ message: expect.stringMatching(/Borrow from the bank/) });
    gameEngine.advance(w, w.time + 2 * MINUTES_PER_DAY);
    expect(ops(w).well!.lowFundsWarned).toBe(true);
  });
});

describe("recovery after a failed well", () => {
  it("review scenario: broke with the rig and no debt is no longer a dead end; contract work leads to a second well", () => {
    const w = rigged();
    cmd(w, "rig.auto", { on: true });
    drain(w, 100); // the money runs out while drilling: the review's most common failure
    gameEngine.advance(w, w.time + MINUTES_PER_DAY);
    expect(ops(w).well!.status).toBe("dry");
    expect(ops(w).bank.rigOwned).toBe(true);
    expect(ops(w).outcome.endedAt).toBeNull();
    expect(kinds(w)).toEqual(["contract"]);
    // The game's own path: borrow the wages, take the contract, keep the rig.
    const path = paths(w)[0]!;
    expect(path).toMatchObject({ kind: "contract", borrowCents: 15_000 });
    expect(rejected(cmd(w, "bank.borrow", { cents: 15_000 }))).toBeUndefined();
    expect(rejected(cmd(w, "company.contract"))).toBeUndefined();
    expect(ops(w).contract).not.toBeNull();
    expect(ops(w).bank.rigOwned).toBe(true);
    const s = SURVEYS.find((x) => x.id === ops(w).well!.surveyId)!;
    expect(rejected(cmd(w, "rig.spud", { x: s.poly[0]![0], y: s.poly[0]![1] }))?.data).toMatchObject({ reason: expect.stringMatching(/out on contract/) });
    let contracts = 1;
    for (; contracts < 6 && !kinds(w).includes("drill"); contracts++) {
      gameEngine.advance(w, w.time + (CONTRACT_DAYS + 1) * MINUTES_PER_DAY);
      if (kinds(w).includes("drill")) break;
      expect(rejected(cmd(w, "company.contract"))).toBeUndefined();
    }
    gameEngine.advance(w, w.time + (CONTRACT_DAYS + 1) * MINUTES_PER_DAY);
    expect(kinds(w)).toContain("drill");
    expect(contracts).toBeLessThanOrEqual(3);
    const drill = paths(w).find((p) => p.kind === "drill")!;
    if (drill.borrowCents) cmd(w, "bank.borrow", { cents: drill.borrowCents });
    const cx = s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length, cy = s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length;
    expect(rejected(cmd(w, "rig.spud", { x: cx, y: cy }))).toBeUndefined();
    expect(ops(w).well!.name).toMatch(/No\. 2$/);
    expect(worldProblem(w)).toBeNull();
  });

  it("contract work pays wages up front and the fee at the end, and is only for lean times", () => {
    const w = gameEngine.createWorld(REVIEW_SEED, CAMPAIGN_START);
    expect(rejected(cmd(w, "company.contract"))?.data).toMatchObject({ reason: expect.stringMatching(/lean times/) });
    drain(w, 20_000);
    const before = ops(w).cash;
    expect(rejected(cmd(w, "company.contract"))).toBeUndefined();
    expect(ops(w).cash).toBe(before - CONTRACT_WAGES);
    expect(rejected(cmd(w, "company.contract"))).toBeDefined(); // already out
    const r = gameEngine.advance(w, w.time + (CONTRACT_DAYS + 1) * MINUTES_PER_DAY, { stopOnInterrupt: true });
    expect(r.interrupted).toBe(true);
    expect(ops(w).contract).toBeNull();
    expect(ops(w).cash).toBe(before - CONTRACT_WAGES + CONTRACT_PAY);
  });

  it("borrowing to the limit and spending it ends the campaign, says so, and refuses further commands", () => {
    const w = gameEngine.createWorld(REVIEW_SEED, CAMPAIGN_START);
    cmd(w, "bank.borrow", { cents: 30_000 });
    drain(w);
    const r = gameEngine.advance(w, w.time + 2 * MINUTES_PER_DAY, { stopOnInterrupt: true });
    expect(r.events.some((e) => e.type === "company.concluded")).toBe(true);
    expect(ops(w).outcome).toMatchObject({ ended: "bankrupt" });
    expect(paths(w)).toEqual([]);
    expect(rejected(cmd(w, "company.contract"))?.data).toMatchObject({ reason: expect.stringMatching(/company is finished/) });
  });

  it("never ends a campaign while a well is being drilled or oil is selling", () => {
    const w = rigged();
    cmd(w, "bank.borrow", { cents: 30_000 });
    cmd(w, "rig.auto", { on: true });
    drain(w, 3_000);
    gameEngine.advance(w, w.time + 12 * 60);
    expect(ops(w).well!.status === "drilling" || ops(w).well!.status === "stuck").toBe(true);
    expect(ops(w).outcome.endedAt).toBeNull();
    gameEngine.advance(w, w.time + 10 * MINUTES_PER_DAY);
    // The money ran out with the credit spent: now, and only now, the company is finished.
    expect(ops(w).well!.status).toBe("dry");
    expect(ops(w).outcome.ended).toBe("bankrupt");
  });
});

describe("schema 3", () => {
  it("v2 → v3 adds the guard and outcome fields, drops crew hire-out, and is idempotent", () => {
    const w = rigged();
    const v2 = structuredClone(w) as unknown as Record<string, Record<string, Record<string, unknown>>>;
    const o = v2.systems!.operations!;
    delete o.contract; delete o.outcome;
    delete (o.well as Record<string, unknown>).idleTicks; delete (o.well as Record<string, unknown>).lowFundsWarned;
    (o.bank as Record<string, unknown>).hiredOutUntil = null;
    const once = MIGRATIONS[2]!(v2 as never);
    expect(canonicalJson(MIGRATIONS[2]!(once) as never)).toBe(canonicalJson(once as never));
    const m = once as unknown as WorldState;
    expect(ops(m).contract).toBeNull();
    expect(ops(m).outcome).toEqual({ firstOilAt: null, firstOilWell: null, endedAt: null, ended: null });
    expect(ops(m).well).toMatchObject({ idleTicks: 0, lowFundsWarned: false });
    expect("hiredOutUntil" in ops(m).bank).toBe(false);
    expect(worldProblem(m)).toBeNull();
    // The migrated game plays on.
    expect(rejected(cmd(m, "rig.auto", { on: true }))).toBeUndefined();
  });
});
