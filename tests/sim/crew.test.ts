import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, operationsOf, positionOf, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { candidatesFor, CREW_DAY_CENTS, dayRateCents, startingDriller, TEMPERAMENTS } from "../../src/sim/company/crew";
import { abilityOf } from "../../src/sim/hidden/drillers";
import { MIGRATIONS, worldProblem } from "../../src/sim/migrations";

const SEED = "5a7e0000000000c1";
const ops = (w: WorldState) => operationsOf(w);

describe("the crew", () => {
  it("starts with an ordinary driller at the old day rate of $12", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    expect(ops(w).crew.driller).toEqual(startingDriller(SEED));
    expect(dayRateCents(ops(w).crew)).toBe(1_200);
    expect(ops(w).dayRate).toBe(12);
    expect(CREW_DAY_CENTS + startingDriller(SEED).wageCents).toBe(1_200);
    expect(ops(w).crew.orders.authority).toBe("ask");
  });

  it("offers seeded candidates with a reputation and a temperament, deterministically", () => {
    const a = candidatesFor(SEED, 1890 * 12 + 2), b = candidatesFor(SEED, 1890 * 12 + 2);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    for (const d of a) {
      expect(TEMPERAMENTS).toContain(d.temperament);
      expect(d.wageCents % 25).toBe(0);
      expect(d.wageCents).toBeGreaterThanOrEqual(200);
      expect(d.remark.length).toBeGreaterThan(10);
    }
    expect(candidatesFor(SEED, 1890 * 12 + 3).map((d) => d.id)).not.toEqual(a.map((d) => d.id));
  });

  it("keeps a driller's true ability out of everything the UI reads", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const a = abilityOf(SEED, ops(w).crew.driller.id);
    const seen = canonicalJson({ ops: ops(w), position: positionOf(w.systems.operations as never, w.seed, w.time) } as never);
    expect(seen).not.toMatch(/feel|judgement|reliability/);
    for (const v of Object.values(a)) expect(seen).not.toContain(String(v));
  });

  it("temperament is independent of ability: every temperament appears among good and poor men", () => {
    const seen = new Map<string, Set<string>>();
    for (let m = 0; m < 400; m++) {
      for (const d of candidatesFor(SEED, m)) {
        const a = abilityOf(SEED, d.id);
        const band = a.judgement > 0.6 ? "good" : a.judgement < 0.4 ? "poor" : "mid";
        if (!seen.has(d.temperament)) seen.set(d.temperament, new Set());
        seen.get(d.temperament)!.add(band);
      }
    }
    for (const t of TEMPERAMENTS) expect([...seen.get(t)!].sort()).toEqual(["good", "mid", "poor"]);
  });
});

describe("schema 4", () => {
  it("v3 → v4 turns old casing into one string, adds the crew, keeps the day rate, and is idempotent", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const v3 = structuredClone(w) as unknown as { systems: { operations: Record<string, unknown> } };
    const o = v3.systems.operations;
    delete o.crew;
    o.well = { id: "ours-1", name: "Test No. 1", x: 1, y: 1, surveyId: "s", spudAt: 0, status: "drilling", depthFt: 300, reachFt: 301, fillFt: 0, sharp: 1, casedFt: 220, openSandFt: 0, feeding: false, auto: true, busy: null, lastBailFt: 290, rop: 0, contact: 1, idleTicks: 0, lowFundsWarned: false };
    const once = MIGRATIONS[3]!(v3 as never);
    expect(canonicalJson(MIGRATIONS[3]!(once) as never)).toBe(canonicalJson(once as never));
    const m = once as unknown as WorldState;
    expect(ops(m).crew.driller).toEqual(startingDriller(SEED));
    expect(ops(m).dayRate).toBe(12);
    expect(ops(m).well!.strings).toEqual([{ size: 0, seatFt: 220, costCents: 0, setAt: m.time, seatCall: null, observed: "dry", pulled: false }]);
    expect(ops(m).well!.leakFt).toBe(0);
    expect(ops(m).well!.waterFt).toEqual([]);
    expect(worldProblem(m)).toBeNull();
  });
});
