import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, fromCalendar, gameEngine, MINUTES_PER_DAY, operationsOf, startOfNextMonth, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { recompute } from "../../src/sim/company/ledger";
import { dayBarrels, HAUL_LIMIT_BBL, HAULING_CENTS, OIL_PRICE_CENTS, type Producer } from "../../src/sim/company/production";
import { creditLimitCents } from "../../src/sim/company/bank";
import { columnAt, generateGeology, isCharged } from "../../src/sim/geology/truth/model";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";

const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const ops = (w: WorldState) => operationsOf(w);

/** A seed and a leaseable site over shallow oil (found with truth, for the test only). */
function oilSite(fluid: "oil" | "gas"): { seed: string; x: number; y: number } {
  for (let i = 0; i < 400; i++) {
    const seed = (0x0b10000 + i).toString(16).padStart(16, "0");
    const t = generateGeology(seed);
    for (const d of t.domes.filter(isCharged))
      for (let a = 0; a < 16; a++)
        for (const r of [0, d.saltR + 0.05]) {
          const x = d.x + Math.cos((a / 16) * Math.PI * 2) * r, y = d.y + Math.sin((a / 16) * Math.PI * 2) * r;
          if (!SURVEYS.some((s) => insidePoly(s.poly, x, y))) continue;
          const hc = columnAt(t, x, y, 180).find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
          if (hc?.fluid === fluid) return { seed, x, y };
        }
  }
  throw new Error("no site");
}

/** Lease, drill with the driller until the well comes in. */
function strike(site: { seed: string; x: number; y: number }): WorldState {
  const w = gameEngine.createWorld(site.seed, CAMPAIGN_START);
  const s = SURVEYS.find((x) => insidePoly(x.poly, site.x, site.y))!;
  cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
  cmd(w, "rig.spud", { x: site.x, y: site.y });
  gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
  cmd(w, "rig.auto", { on: true });
  for (let d = 0; d < 120 && ops(w).well!.status !== "gusher" && ops(w).well!.status !== "dry"; d++) {
    gameEngine.advance(w, w.time + MINUTES_PER_DAY);
    if (ops(w).well!.status === "stuck") cmd(w, "rig.fish");
  }
  return w;
}

describe("production", () => {
  const oil = oilSite("oil");

  it("an uncapped gusher earns nothing; capping it costs money and starts the flow", () => {
    const w = strike(oil);
    expect(ops(w).well!.status).toBe("gusher");
    const cash = ops(w).cash;
    gameEngine.advance(w, w.time + 40 * MINUTES_PER_DAY);
    expect(ops(w).ledger.entries.some((e) => e.category === "production")).toBe(false);
    expect(ops(w).cash).toBe(cash);
    cmd(w, "prod.cap");
    expect(ops(w).production.producers).toHaveLength(1);
    expect(ops(w).cash).toBe(cash - 80);
  });

  it("the first producing well is acknowledged once, and recorded", () => {
    const w = strike(oil);
    expect(ops(w).outcome.firstOilAt).toBeNull();
    const r = gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type: "prod.cap", payload: null }] });
    const m = r.events.filter((e) => e.type === "company.milestone");
    expect(m).toHaveLength(1);
    expect(m[0]!.interrupt).toBe(true);
    expect(m[0]!.data).toMatchObject({ kind: "firstOil", message: expect.stringMatching(/first producing well/) });
    expect(ops(w).outcome.firstOilAt).toBe(w.time);
    expect(ops(w).outcome.firstOilWell).toBe(ops(w).well!.name);
    const later = gameEngine.advance(w, w.time + 60 * MINUTES_PER_DAY);
    expect(later.events.some((e) => e.type === "company.milestone")).toBe(false);
    expect(ops(w).outcome.endedAt).toBeNull();
  });

  it("a producing well raises what the bank will lend", () => {
    const w = strike(oil);
    const before = creditLimitCents(ops(w).bank, ops(w).production, 40_000);
    expect(before).toBe(30_000); // three quarters of the rig's $400
    cmd(w, "prod.cap");
    gameEngine.advance(w, w.time + 2 * MINUTES_PER_DAY);
    expect(creditLimitCents(ops(w).bank, ops(w).production, 40_000)).toBeGreaterThan(before);
  });

  it("sells each month in whole cents: oil at the railhead, hauling, one-eighth royalty", () => {
    const w = strike(oil);
    cmd(w, "prod.cap");
    gameEngine.advance(w, w.time + 70 * MINUTES_PER_DAY);
    const sales = ops(w).ledger.entries.filter((e) => e.memo.startsWith("Oil sold"));
    expect(sales.length).toBeGreaterThanOrEqual(2);
    for (const sale of sales) {
      const gross = sale.lines.find((l) => l.account === "oilSales")!.cents * -1;
      expect(gross % OIL_PRICE_CENTS).toBe(0);
      const bbl = gross / OIL_PRICE_CENTS;
      const hauling = ops(w).ledger.entries.find((e) => e.t === sale.t && e.memo.startsWith("Hauling"))!;
      expect(hauling.lines.find((l) => l.account === "hauling")!.cents).toBe(bbl * HAULING_CENTS);
      const royalty = ops(w).ledger.entries.find((e) => e.t === sale.t && e.memo.startsWith("Royalty"))!;
      expect(royalty.lines.find((l) => l.account === "royalty")!.cents).toBe(Math.round(gross / 8));
    }
    expect(recompute(ops(w).ledger)).toEqual(ops(w).ledger.balances);
  });

  it("counts the last day of a month in that month's sale", () => {
    const w = strike(oil);
    cmd(w, "prod.cap");
    // Run to just before a month boundary, note the month's barrels, then cross it.
    const now = w.time;
    let boundary = fromCalendar(1890, 1, 1);
    while (boundary <= now + 2 * MINUTES_PER_DAY) boundary = startOfNextMonth(boundary);
    gameEngine.advance(w, boundary - 1);
    const p = ops(w).production.producers[0]!;
    const expected = p.monthBbl + dayBarrels(p, ops(w).production.drawn[p.trap]!);
    gameEngine.advance(w, boundary);
    const sale = ops(w).ledger.entries.filter((e) => e.memo.startsWith("Oil sold")).at(-1)!;
    expect(sale.t).toBe(boundary);
    expect(-sale.lines.find((l) => l.account === "oilSales")!.cents).toBe(expected * OIL_PRICE_CENTS);
  });

  it("gives identical books however time is stepped, including a two-year jump", () => {
    const run = (step: number) => {
      const w = strike(oil);
      cmd(w, "prod.cap");
      const until = w.time + 730 * MINUTES_PER_DAY;
      while (w.time < until) gameEngine.advance(w, Math.min(until, w.time + step));
      return w;
    };
    const a = run(730 * MINUTES_PER_DAY), b = run(MINUTES_PER_DAY), c = run(4321);
    expect(canonicalJson(ops(b).ledger)).toBe(canonicalJson(ops(a).ledger));
    expect(canonicalJson(ops(c).production)).toBe(canonicalJson(ops(a).production));
    // Two years of sales, each month, and the lease held by production all along.
    expect(ops(a).ledger.entries.filter((e) => e.memo.startsWith("Oil sold")).length).toBeGreaterThanOrEqual(23);
    const lease = ops(a).leases.leases[0]!;
    expect(lease.status).toBe("active");
    expect(lease.renewals).toBeGreaterThanOrEqual(1);
    expect(ops(a).ledger.entries.some((e) => e.memo.startsWith("Delay rental"))).toBe(false);
  });

  it("a gas well cannot be capped for sale", () => {
    const w = strike(oilSite("gas"));
    expect(ops(w).well!.outcome).toMatch(/^GAS/);
    expect(cmd(w, "prod.cap").events[0]!.type).toBe("command.rejected");
  });
});

describe("depletion", () => {
  const p: Producer = { wellId: "w", name: "W", surveyId: "s", x: 0, y: 0, since: 0, trap: "t", initialBbl: 900, reserveBbl: 100_000, cumBbl: 0, monthBbl: 0, lastDayBbl: 0 };
  it("is limited by hauling until the trap is drawn down, then falls", () => {
    expect(dayBarrels(p, 0)).toBe(HAUL_LIMIT_BBL);
    expect(dayBarrels(p, 90_000)).toBe(90);
    expect(dayBarrels(p, 100_000)).toBe(0);
    let last = Infinity;
    for (let d = 0; d <= 100_000; d += 5_000) { const q = dayBarrels(p, d); expect(q).toBeLessThanOrEqual(last); last = q; }
  });
  it("wells in one trap share it", () => {
    expect(dayBarrels(p, 85_000)).toBeLessThan(dayBarrels(p, 40_000));
  });
});

