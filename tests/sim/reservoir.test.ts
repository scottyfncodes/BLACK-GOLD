import { describe, expect, it } from "vitest";
import { drawDay, emptyField, flowToday, type FieldState, type Tap } from "../../src/sim/hidden/reservoir";
import { HAUL_LIMIT_BBL } from "../../src/sim/company/production";

/**
 * M8a: the oil in the ground as it is drawn. One tank per trap, shared by every well on it;
 * exact material accounting; interference from the accounting alone; a lone well as before M8.
 */
function field(originalBbl: number, ...q0s: number[]): { f: FieldState; taps: Tap[] } {
  const f = emptyField();
  f.tanks.t = { originalBbl, drawnBbl: 0 };
  const taps = q0s.map((q0, i) => ({ wellId: `w${i}`, tank: "t", q0 }));
  f.taps.push(...taps);
  return { f, taps };
}
const day = (f: FieldState, taps: Tap[]) => { const out = drawDay(f); return taps.map((t) => out[t.wellId]!); };

describe("the reservoir", () => {
  it("never yields more than it held, whatever the wells and however long they flow", () => {
    for (const [orig, q0s] of [[100_000, [900]], [36_000, [1820, 1820, 1820]], [500, [400, 220]], [7, [5000]]] as const) {
      const { f, taps } = field(orig, ...q0s);
      let total = 0;
      for (let d = 0; d < 20_000; d++) total += day(f, taps).reduce((a, b) => a + b, 0);
      expect(total).toBe(f.tanks.t!.drawnBbl);
      expect(f.tanks.t!.drawnBbl).toBeLessThanOrEqual(orig);
      for (const t of taps) expect(flowToday(f, t)).toBeGreaterThanOrEqual(0);
    }
  });

  it("a lone well flows as before M8: the haul limit, then in proportion to the oil left", () => {
    const { f, taps } = field(100_000, 900);
    expect(flowToday(f, taps[0]!)).toBe(HAUL_LIMIT_BBL);
    f.tanks.t!.drawnBbl = 90_000;
    expect(flowToday(f, taps[0]!)).toBe(90); // floor(900 × 10,000 / 100,000)
    f.tanks.t!.drawnBbl = 100_000;
    expect(flowToday(f, taps[0]!)).toBe(0);
  });

  it("two wells on one tank empty it faster, and each flows less than a lone well would", () => {
    const lone = field(60_000, 900), pair = field(60_000, 900, 900);
    const loneRate: number[] = [], pairRate: number[] = [];
    let loneAt200 = 0, pairAt200 = 0;
    for (let d = 0; d < 900; d++) {
      loneRate.push(day(lone.f, lone.taps)[0]!); pairRate.push(day(pair.f, pair.taps)[0]!);
      if (d === 199) { loneAt200 = lone.f.tanks.t!.drawnBbl; pairAt200 = pair.f.tanks.t!.drawnBbl; }
    }
    expect(pairAt200).toBeGreaterThan(loneAt200);
    // Once the haul limit no longer binds, the first well of the pair flows less than the lone well, day for day.
    const late = (r: number[]) => r.slice(400).reduce((a, b) => a + b, 0);
    expect(late(pairRate)).toBeLessThan(late(loneRate));
    // Interference is the accounting itself: the first well alone gets less of the tank than a lone well does.
    expect(pairRate.reduce((a, b) => a + b, 0)).toBeLessThan(loneRate.reduce((a, b) => a + b, 0));
  });

  it("is order-free within a day: wells listed in any order draw the same barrels, even from a nearly empty tank", () => {
    for (const orig of [1_000_000, 300]) {
      const a = field(orig, 500, 800, 220), b = field(orig, 500, 800, 220);
      a.f.tanks.t!.drawnBbl = b.f.tanks.t!.drawnBbl = orig - 120;
      b.f.taps.reverse();
      const ra = drawDay(a.f), rb = drawDay(b.f);
      expect(ra).toEqual(rb);
      expect(a.f.tanks.t!.drawnBbl).toBeLessThanOrEqual(orig);
    }
  });
});
