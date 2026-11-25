import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, operationsOf, type WorldState } from "../../src/sim";
import { creditLimitCents, RIG_ADVANCE, RIG_BOOK, RIG_RESALE, USED_RIG_PRICE } from "../../src/sim/company/bank";
import { balance, debtCents, post, recompute } from "../../src/sim/company/ledger";
import { OIL_PRICES, oilPriceCents } from "../../src/sim/company/production";
import { fromCalendar } from "../../src/sim/core/time";
import { MIGRATIONS, worldProblem } from "../../src/sim/migrations";
import { SURVEYS } from "../../src/content/geography/surveys";

/**
 * Historical economics (docs/DESIGN.md §8): the rig's book value, its resale value and the
 * price of a replacement are kept apart, so the rig is never a cheap source of cash; the bank
 * lends a fifth of the book value; crude follows the year's documented price.
 */
const SEED = "5a7e0000000000c1";
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rejected = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
const ops = (w: WorldState) => operationsOf(w);
const ledgerOf = (w: WorldState) => (w.systems.operations as unknown as { ledger: Parameters<typeof post>[0] }).ledger;

describe("crude by the year", () => {
  it("follows the documented US average price (EIA), holding the nearest year outside the table", () => {
    expect(OIL_PRICES[1890]).toBe(77);
    expect(OIL_PRICES[1892]).toBe(51);
    expect(OIL_PRICES[1895]).toBe(109);
    expect(oilPriceCents(fromCalendar(1890, 6, 1))).toBe(77);
    expect(oilPriceCents(fromCalendar(1891, 1, 1))).toBe(56);
    expect(oilPriceCents(fromCalendar(1891, 1, 1) - 1)).toBe(77); // the last minute of 1890
    expect(oilPriceCents(fromCalendar(1920, 1, 1))).toBe(OIL_PRICES[1905]);
  });

  it("is shown to the player as this year's price", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    expect(ops(w).oilPriceCents).toBe(77);
  });
});

describe("the rig: book value, resale value and replacement kept apart", () => {
  it("starts on the books at $1,500, and the bank lends a fifth of it: $300", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    expect(balance(ledgerOf(w), "equipment")).toBe(RIG_BOOK * 100);
    expect(ops(w).bank.rigBookCents).toBe(RIG_BOOK * 100);
    expect(creditLimitCents(ops(w).bank, ops(w).production, ops(w).oilPriceCents)).toBe(RIG_BOOK * 100 * RIG_ADVANCE);
    expect(RIG_BOOK * RIG_ADVANCE).toBe(300);
  });

  it("sells for $750, half its book value, the bank paid first; buying back costs more than a sale brings", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    cmd(w, "bank.borrow", { cents: 30_000 });
    const cash = ops(w).cash;
    expect(rejected(cmd(w, "company.sellRig"))).toBeUndefined();
    expect(ops(w).bank.rigOwned).toBe(false);
    expect(ops(w).debt).toBe(0); // $300 of the $750 went to the bank
    expect(ops(w).cash).toBeCloseTo(cash + RIG_RESALE - 300, 2);
    const sale = ops(w).ledger.entries.at(-1)!;
    expect(sale.lines.find((l) => l.account === "equity")!.cents).toBe((RIG_BOOK - RIG_RESALE) * 100); // the loss
    expect(balance(ledgerOf(w), "equipment")).toBe(0);
    // No round trip makes money: the used rig costs more than this one fetched.
    expect(USED_RIG_PRICE).toBeGreaterThan(RIG_RESALE);
    expect(rejected(cmd(w, "company.sellRig"))).toBeDefined();
    expect(rejected(cmd(w, "company.buyRig"))).toBeUndefined();
    expect(ops(w).bank.rigBookCents).toBe(USED_RIG_PRICE * 100);
    expect(ops(w).cash).toBeCloseTo(cash + RIG_RESALE - 300 - USED_RIG_PRICE, 2);
    // A used rig carries less credit: a fifth of $900 is $180, rounded down to the $50 step.
    expect(creditLimitCents(ops(w).bank, ops(w).production, ops(w).oilPriceCents)).toBe(15_000);
    expect(recompute(ops(w).ledger)).toEqual(ops(w).ledger.balances);
    expect(worldProblem(w)).toBeNull();
  });

  it("cannot be sold while it works: drilling, on contract", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const s = SURVEYS[0]!;
    cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
    const cx = s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length, cy = s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length;
    expect(rejected(cmd(w, "rig.spud", { x: cx, y: cy }))).toBeUndefined();
    expect((rejected(cmd(w, "company.sellRig"))!.data as { reason: string }).reason).toMatch(/at work/);
  });

  it("borrowing against the rig and defaulting is no way to sell it at book value", () => {
    // Borrow the $300, leave nothing to pay the interest: the bank forecloses and sells the rig
    // for $750. The company ends up with $750 less what it owed, never the $1,500 book value.
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    cmd(w, "bank.borrow", { cents: 30_000 });
    const l = ledgerOf(w);
    const spend = Math.round(ops(w).cash * 100);
    post(l, w.time, "operating", "Test: spent elsewhere", [{ account: "operating", cents: spend }, { account: "cash", cents: -spend }]);
    gameEngine.advance(w, fromCalendar(1890, 3, 1, 0, 1));
    expect(ops(w).bank.rigOwned).toBe(false);
    const owed = 30_000 + ops(w).ledger.entries.filter((e) => e.memo.startsWith("Interest unpaid")).reduce((a, e) => a + e.lines.find((x) => x.account === "interest")!.cents, 0);
    expect(debtCents(ops(w).ledger)).toBe(0);
    expect(Math.round(ops(w).cash * 100)).toBe(RIG_RESALE * 100 - owed);
    expect(worldProblem(w)).toBeNull();
  });

  it("a foreclosure without a rig to take does not take it twice", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    cmd(w, "bank.borrow", { cents: 30_000 });
    cmd(w, "company.sellRig"); // $300 of the price repays the loan
    const l = ledgerOf(w);
    post(l, w.time, "bank", "Test: an older loan", [{ account: "operating", cents: 10_000 }, { account: "loan", cents: -10_000 }]);
    const spend = Math.round(ops(w).cash * 100);
    post(l, w.time, "operating", "Test: spent elsewhere", [{ account: "operating", cents: spend }, { account: "cash", cents: -spend }]);
    gameEngine.advance(w, fromCalendar(1890, 3, 1, 0, 1));
    expect(balance(ledgerOf(w), "equipment")).toBe(0);
    expect(worldProblem(w)).toBeNull();
  });
});

describe("schema 5", () => {
  it("revalues a used rig bought back from $300 to $900, and a sold one not at all", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const v4 = structuredClone(w) as unknown as { systems: { operations: { bank: Record<string, unknown>; ledger: Parameters<typeof post>[0] } } };
    const o = v4.systems.operations;
    delete o.bank.rigBookCents;
    // The opening rig at the old $400, seized, then a used one bought at the old $300.
    o.ledger.entries.length = 0; o.ledger.balances = {}; o.ledger.next = 1;
    post(o.ledger, 0, "opening", "Capital paid in", [{ account: "cash", cents: 150_000 }, { account: "equity", cents: -150_000 }]);
    post(o.ledger, 0, "opening", "Cable-tool rig and tools, owned", [{ account: "equipment", cents: 40_000 }, { account: "equity", cents: -40_000 }]);
    post(o.ledger, 1, "bank", "Rig seized by the bank and set against the loan", [{ account: "cash", cents: 40_000 }, { account: "equipment", cents: -40_000 }]);
    post(o.ledger, 2, "equipment", "Used cable-tool rig and tools, bought", [{ account: "equipment", cents: 30_000 }, { account: "cash", cents: -30_000 }]);
    const m = MIGRATIONS[4]!(v4 as never) as unknown as WorldState;
    expect(ops(m).bank.rigBookCents).toBe(90_000);
    expect(balance(ledgerOf(m), "equipment")).toBe(90_000);
    expect(worldProblem(m)).toBeNull();

    const sold = structuredClone(v4);
    sold.systems.operations.bank.rigOwned = false;
    const n = MIGRATIONS[4]!(sold as never) as unknown as WorldState;
    expect(ops(n).bank.rigBookCents).toBe(0);
    expect(ops(n).ledger.entries).toHaveLength(4);
  });
});
