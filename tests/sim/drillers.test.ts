import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, fromCalendar, gameEngine, MINUTES_PER_DAY, operationsOf, type Driller, type WorldState } from "../../src/sim";
import { candidatesFor } from "../../src/sim/company/crew";
import { post } from "../../src/sim/company/ledger";
import { abilityOf } from "../../src/sim/hidden/drillers";
import { SURVEYS, centroid } from "../../src/content/geography/surveys";

/**
 * Hired drillers (docs/DESIGN.md §8): seeded men with hidden ability and an independent
 * temperament; hired between wells; their record holds outcomes, never ability; and ability
 * shows in the work: a good man makes hole with fewer stuck tools than a poor one.
 */
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rejected = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
const ops = (w: WorldState) => operationsOf(w);
const SEED = "5a7e0000000000d7";

/** Put a particular man in charge (test only), as if hired. */
function install(w: WorldState, man: Driller): void {
  const crew = (w.systems.operations as unknown as { crew: { driller: Driller } }).crew;
  crew.driller = man;
}

/** Plenty of capital, so a test measures drilling, not the purse. */
function fund(w: WorldState): void {
  const o = (w.systems as unknown as Record<string, { ledger: Parameters<typeof post>[0] }>).operations!;
  post(o.ledger, w.time, "opening", "Test: more capital", [{ account: "cash", cents: 1_000_000 }, { account: "equity", cents: -1_000_000 }]);
}

/** Let the driller drill a survey's middle for some days; fish when stuck. Returns his record. */
function shift(seed: string, man: Driller | null, surveyIndex: number, days: number) {
  const w = gameEngine.createWorld(seed, CAMPAIGN_START);
  fund(w);
  if (man) install(w, man);
  const s = SURVEYS[surveyIndex]!;
  cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
  const [x, y] = centroid(s.poly);
  cmd(w, "rig.spud", { x, y });
  cmd(w, "rig.auto", { on: true });
  const end = w.time + days * MINUTES_PER_DAY;
  while (w.time < end) {
    const st = ops(w).well!.status;
    if (st === "gusher" || st === "dry") break;
    gameEngine.advance(w, Math.min(end, w.time + 6 * 60));
    if (ops(w).well!.status === "stuck") cmd(w, "rig.fish");
  }
  return ops(w).crew.records[ops(w).well!.driller]!;
}

describe("hiring", () => {
  it("offers men each month, hires between wells only, and charges his wage from then on", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const jan = ops(w).crew.candidates;
    expect(jan.length).toBeGreaterThanOrEqual(2);
    const man = jan[0]!;
    expect(rejected(cmd(w, "crew.hire", { id: man.id }))).toBeUndefined();
    expect(ops(w).crew.driller.id).toBe(man.id);
    expect(ops(w).dayRate).toBe(9 + man.wageCents / 100);
    expect(ops(w).crew.candidates.map((d) => d.id)).not.toContain(man.id);
    // In the middle of a well, no change of driller.
    const s = SURVEYS[0]!;
    cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
    const [x, y] = centroid(s.poly);
    cmd(w, "rig.spud", { x, y });
    expect(ops(w).well!.driller).toBe(man.id);
    expect(rejected(cmd(w, "crew.hire", { id: ops(w).crew.candidates[0]!.id }))?.data).toMatchObject({ reason: expect.stringMatching(/between wells/) });
    // A new month brings new men.
    gameEngine.advance(w, fromCalendar(1890, 2, 1, 0, 30));
    expect(ops(w).crew.candidates.map((d) => d.id)).not.toEqual(jan.map((d) => d.id));
  });

  it("the record holds outcomes only, credited to the man in charge of the well", () => {
    const rec = shift(SEED, null, 2, 6);
    expect(rec.wells).toBe(1);
    expect(rec.feet).toBeGreaterThan(50);
    expect(rec.ticks).toBeGreaterThan(0);
    expect(Object.keys(rec).sort()).toEqual(["dry", "dryStrings", "feet", "fishing", "leakyStrings", "oil", "strings", "stuck", "ticks", "wells", "wet"]);
  });

  it("standing orders: ask, or his judgement within a monthly budget", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    expect(rejected(cmd(w, "crew.orders", { authority: "judgement", budgetCents: 20_000 }))).toBeUndefined();
    expect(ops(w).crew.orders).toMatchObject({ authority: "judgement", budgetCents: 20_000 });
    expect(rejected(cmd(w, "crew.orders", { authority: "spend it all" }))).toBeDefined();
    expect(rejected(cmd(w, "crew.orders", { authority: "ask" }))).toBeUndefined();
  });
});

describe("ability shows in the work", () => {
  /** The best and worst men by the hidden measure (test only), among many months' candidates. */
  function extremes(seed: string): { good: Driller; poor: Driller } {
    const all = Array.from({ length: 60 }, (_, m) => candidatesFor(seed, m)).flat().filter((d) => d.temperament === "methodical" || d.temperament === "economical");
    const score = (d: Driller) => { const a = abilityOf(seed, d.id); return a.feel + a.judgement + a.reliability; };
    all.sort((p, q) => score(q) - score(p));
    return { good: all[0]!, poor: all.at(-1)! };
  }

  it("a good driller makes more hole per day with fewer stuck tools than a poor one, over many grounds", () => {
    let goodFeet = 0, poorFeet = 0, goodStuck = 0, poorStuck = 0;
    for (let i = 0; i < 10; i++) {
      const seed = (0x5a7e0100 + i).toString(16).padStart(16, "0");
      const { good, poor } = extremes(seed);
      const g = shift(seed, good, 3 + (i % 5), 10), p = shift(seed, poor, 3 + (i % 5), 10);
      goodFeet += g.feet / Math.max(1, g.ticks); poorFeet += p.feet / Math.max(1, p.ticks);
      goodStuck += g.stuck; poorStuck += p.stuck;
    }
    expect(goodFeet).toBeGreaterThan(poorFeet * 1.1);
    expect(goodStuck).toBeLessThan(poorStuck);
  });

  it("temperament is a habit, not a skill: a methodical man bails more often than an aggressive one of the same ability", () => {
    const seed = SEED;
    const base = candidatesFor(seed, 5)[0]!;
    const bails = (t: Driller["temperament"]) => {
      const w = gameEngine.createWorld(seed, CAMPAIGN_START);
      fund(w);
      install(w, { ...base, temperament: t });
      const s = SURVEYS[4]!;
      cmd(w, "lease.take", { surveyId: s.id, offer: "asking" });
      const [x, y] = centroid(s.poly);
      cmd(w, "rig.spud", { x, y });
      cmd(w, "rig.auto", { on: true });
      gameEngine.advance(w, w.time + 9 * MINUTES_PER_DAY);
      return (w.systems.operations as unknown as { samples: { wellId: string }[] }).samples.length;
    };
    expect(bails("methodical")).toBeGreaterThan(bails("aggressive"));
  });
});

