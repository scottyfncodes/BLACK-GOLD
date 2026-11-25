import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, fromCalendar, gameEngine, MINUTES_PER_DAY, operationsOf, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { balance, debtCents, post, recompute } from "../../src/sim/company/ledger";
import { SURVEYS } from "../../src/content/geography/surveys";
import { MIGRATIONS, worldProblem } from "../../src/sim/migrations";
import v1 from "../fixtures/save-v1.json";

const SEED = "5a7e0000000000b1";
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rejected = (r: ReturnType<typeof cmd>) => r.events.some((e) => e.type === "command.rejected");
const ops = (w: WorldState) => operationsOf(w);
const interest = (w: WorldState) => ops(w).ledger.entries.filter((e) => e.memo.startsWith("Interest to the bank"));
const books = (w: WorldState) => canonicalJson(ops(w).ledger as never);

/** Spend the company's cash outside the game, to put it in arrears (test only). */
function drain(w: WorldState, leaveCents = 0): void {
  const o = (w.systems as unknown as Record<string, { ledger: Parameters<typeof post>[0] }>).operations!;
  const cash = balance(o.ledger, "cash");
  post(o.ledger, w.time, "operating", "Test: cash spent elsewhere", [{ account: "operating", cents: cash - leaveCents }, { account: "cash", cents: leaveCents - cash }]);
}

describe("bank", () => {
  it("lends against the rig in steps of $50, and no further", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    expect(rejected(cmd(w, "bank.borrow", { cents: 2_500 }))).toBe(true); // not a $50 step
    expect(rejected(cmd(w, "bank.borrow", { cents: 35_000 }))).toBe(true); // over three quarters of the rig's $400
    expect(rejected(cmd(w, "bank.borrow", { cents: 30_000 }))).toBe(false);
    expect(ops(w).debt).toBe(300);
    expect(ops(w).cash).toBe(1800);
    expect(rejected(cmd(w, "bank.borrow", { cents: 5_000 }))).toBe(true);
  });

  it("charges exactly 8% a year in whole cents, the fractions carried month to month", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    cmd(w, "bank.borrow", { cents: 20_000 });
    gameEngine.advance(w, fromCalendar(1890, 2, 1, 0, 1));
    // 31 midnights (Jan 2 … Feb 1) on $200: 31 × 20,000 × 8 / 36,500 = 135.89 → 135 cents.
    expect(interest(w).map((e) => e.lines.find((l) => l.account === "interest")!.cents)).toEqual([135]);
    gameEngine.advance(w, fromCalendar(1891, 1, 1, 0, 1));
    const charged = interest(w).map((e) => e.lines.find((l) => l.account === "interest")!.cents);
    expect(charged).toHaveLength(12);
    expect(charged.reduce((a, b) => a + b, 0)).toBe(1_600); // $16 = 8% of $200, to the cent
    expect(ops(w).bank.accrued).toBe(0);
    expect(recompute(ops(w).ledger)).toEqual(ops(w).ledger.balances);
  });

  it("keeps identical books whatever the step size, across month ends and a long jump", () => {
    const run = (step: number) => {
      const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
      cmd(w, "bank.borrow", { cents: 20_000 });
      const end = fromCalendar(1891, 3, 15, 12, 0);
      while (w.time < end) gameEngine.advance(w, Math.min(end, w.time + step));
      return w;
    };
    const ref = books(run(MINUTES_PER_DAY));
    for (const step of [1_439, 1_441, 61 * 7, 9 * MINUTES_PER_DAY, 500 * MINUTES_PER_DAY]) expect(books(run(step))).toBe(ref);
  });

  it("takes repayment at any time, never more than is owed", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    expect(rejected(cmd(w, "bank.repay", { cents: 100 }))).toBe(true); // owes nothing
    cmd(w, "bank.borrow", { cents: 20_000 });
    cmd(w, "bank.repay", { cents: 5_025 });
    expect(debtCents(ops(w).ledger)).toBe(14_975);
    cmd(w, "bank.repay", { cents: 1_000_000 });
    expect(ops(w).debt).toBe(0);
    expect(ops(w).cash).toBe(1500);
    gameEngine.advance(w, fromCalendar(1890, 3, 1, 1, 0));
    expect(interest(w)).toHaveLength(0); // repaid the same day: no midnight on the books
  });

  it("warns after one unpaid month and forecloses on the rig after two; the land stays (mechanics)", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const s = SURVEYS[0]!;
    cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
    cmd(w, "bank.borrow", { cents: 20_000 });
    drain(w);
    const r1 = gameEngine.advance(w, fromCalendar(1890, 2, 1, 0, 1));
    expect(r1.events.some((e) => e.type === "company.notice" && e.severity === "warning")).toBe(true);
    expect(ops(w).bank.strikes).toBe(1);
    expect(debtCents(ops(w).ledger)).toBe(20_135); // the unpaid interest is added to the loan
    const r2 = gameEngine.advance(w, fromCalendar(1890, 3, 1, 0, 1));
    expect(r2.events.some((e) => e.type === "company.notice" && e.severity === "critical")).toBe(true);
    expect(ops(w).bank.rigOwned).toBe(false);
    expect(balance(ops(w).ledger, "equipment")).toBe(0);
    // The rig's $400 clears the loan; the bank pays back the difference.
    expect(ops(w).debt).toBe(0);
    expect(ops(w).bank.lien).toBe(false);
    expect(ops(w).cash).toBeGreaterThan(190);
    expect(ops(w).leases.leases.find((l) => l.surveyId === s.id)!.status).toBe("active");
    // With no cash and the credit spent, the company had no way forward: the campaign ended first.
    expect(ops(w).outcome.ended).toBe("bankrupt");
    expect(worldProblem(w)).toBeNull();
  });

  it("abandons a well being drilled when the rig is taken, and keeps a lien when the rig does not cover the loan", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const s = SURVEYS[0]!;
    cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
    cmd(w, "bank.borrow", { cents: 20_000 });
    const [x, y] = s.poly[0]!;
    const cx = s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length, cy = s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length;
    expect(rejected(cmd(w, "rig.spud", { x: (x + cx * 3) / 4, y: (y + cy * 3) / 4 }))).toBe(false);
    // A larger old debt (test only), so the rig does not clear it.
    const o = (w.systems as unknown as Record<string, { ledger: Parameters<typeof post>[0] }>).operations!;
    post(o.ledger, w.time, "bank", "Test: older loan", [{ account: "operating", cents: 60_000 }, { account: "loan", cents: -60_000 }]);
    gameEngine.advance(w, w.time + 4 * MINUTES_PER_DAY);
    drain(w);
    gameEngine.advance(w, fromCalendar(1890, 3, 1, 0, 1));
    expect(ops(w).bank.rigOwned).toBe(false);
    expect(ops(w).well?.status ?? ops(w).past.at(-1)!.status).toBe("dry");
    expect(ops(w).bank.lien).toBe(true);
    expect(ops(w).debt).toBeGreaterThan(400);
    expect(rejected(cmd(w, "bank.borrow", { cents: 5_000 }))).toBe(true);
    expect(worldProblem(w)).toBeNull();
  });

  it("gives a version-1 save an empty account at the bank, idempotently", () => {
    const all = (w: unknown) => MIGRATIONS[3]!(MIGRATIONS[2]!(MIGRATIONS[1]!(w as never)));
    const world = all(structuredClone(v1.world)) as unknown as WorldState;
    const once = canonicalJson(world as never);
    expect(canonicalJson(all(world) as never)).toBe(once);
    expect(ops(world).bank).toEqual({ accrued: 0, strikes: 0, lien: false, rigOwned: true });
  });
});
