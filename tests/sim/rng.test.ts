import { describe, expect, it } from "vitest";
import { createEngine } from "../../src/sim";
import { parseSeed, rngKey, rngUnit, streamInit, streamNextU32 } from "../../src/sim/core/rng";

const SEED = "00c0ffee1890beef";

describe("counter-based randomness", () => {
  it("is a pure function of its key", () => {
    expect(rngKey(SEED, "geology", "gulf", 3, 4)).toBe(rngKey(SEED, "geology", "gulf", 3, 4));
  });

  it("does not depend on the order values are generated in", () => {
    const keys = Array.from({ length: 200 }, (_, i) => [i % 20, Math.floor(i / 20)] as const);
    const forward = keys.map(([x, y]) => rngKey(SEED, "cell", x, y));
    const backward = [...keys].reverse().map(([x, y]) => rngKey(SEED, "cell", x, y)).reverse();
    expect(backward).toEqual(forward);
  });

  it("separates neighbouring keys, seeds and namespaces", () => {
    const a = rngKey(SEED, "cell", 1, 2);
    expect(rngKey(SEED, "cell", 2, 1)).not.toBe(a);
    expect(rngKey("00c0ffee1890bef0", "cell", 1, 2)).not.toBe(a);
    expect(rngKey(SEED, "other", 1, 2)).not.toBe(a);
  });

  it("is roughly uniform (chi-square over 20 buckets)", () => {
    const n = 100_000;
    const buckets = new Array<number>(20).fill(0);
    for (let i = 0; i < n; i++) buckets[Math.floor(rngUnit(SEED, "uniform", i) * 20)]!++;
    const expected = n / 20;
    const chi2 = buckets.reduce((acc, b) => acc + (b - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(43.8); // p = 0.001 for 19 degrees of freedom
  });

  it("validates seeds", () => {
    expect(parseSeed("ffffffff00000001")).toEqual([0xffffffff, 1]);
    expect(() => parseSeed("xyz")).toThrow();
    expect(() => parseSeed("FFFFFFFF00000001")).toThrow();
  });
});

describe("named streams", () => {
  it("produce a reproducible uniform sequence", () => {
    const a = streamInit(SEED, "s");
    const b = streamInit(SEED, "s");
    const xs = Array.from({ length: 1000 }, () => streamNextU32(a));
    expect(Array.from({ length: 1000 }, () => streamNextU32(b))).toEqual(xs);
    const mean = xs.reduce((m, x) => m + x / 0x100000000, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("are isolated: drawing from one stream never shifts another", () => {
    const draws: number[][] = [];
    for (const extraDraws of [0, 1, 500]) {
      const engine = createEngine([
        {
          id: "probe",
          initialState: () => ({ values: [] as number[] }),
          init(ctx) {
            for (let i = 0; i < extraDraws; i++) ctx.random("noisy-neighbour");
            for (let i = 0; i < 5; i++) (ctx.state.values as number[]).push(ctx.random("geology"));
          },
        },
      ]);
      draws.push((engine.createWorld(SEED, 0).systems.probe as { values: number[] }).values);
    }
    expect(draws[1]).toEqual(draws[0]);
    expect(draws[2]).toEqual(draws[0]);
  });
});
