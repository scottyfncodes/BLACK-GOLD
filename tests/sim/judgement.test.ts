import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { noRunningSand } from "../helpers/ground";
import { ADVICE_LAPSE_MINUTES, CAMPAIGN_START, fromCalendar, gameEngine, MINUTES_PER_DAY, operationsOf, type Driller, type WorldState } from "../../src/sim";
import { candidatesFor } from "../../src/sim/company/crew";
import { assess, type Observations } from "../../src/sim/company/judgement";
import { post } from "../../src/sim/company/ledger";
import { abilityOf, type Ability } from "../../src/sim/hidden/drillers";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { columnAt, generateGeology } from "../../src/sim/geology/truth/model";

/**
 * Driller judgement (docs/DESIGN.md §8): advice from observations only, asking by default,
 * acting within a monthly budget when trusted, never below the recovery reserve, and never
 * repeating a declined recommendation until the hole has materially changed.
 */
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rejected = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
const ops = (w: WorldState) => operationsOf(w);

/** Counsel about the money: a recommendation to quit, or (with nothing seen either way) a decision put to the owner. */
const COUNSEL = /^(quit|decide)$/;
const OBS: Observations = { depthFt: 400, casedFt: 0, stringsLeft: 3, nextPipe: "10-inch", nextCostCents: 20_000, openSandFt: 0, bottom: null, waterSeen: false, waterShutOff: false, stuck: false, fishCount: 0, cashCents: 100_000, dayCents: 1_200, fishingCents: 6_000, creditRoomCents: 0, wellSpentCents: 0, lastShow: null, inflowFtHr: 0, driving: null, collapse: null, driveHead: false, nextDriveCents: 0, swageCents: 15_000, expect: null, rockDry: null, rockFt: null, inSalt: false, gypsumFt: null, sheenFt: null, paceFtDay: 40, noHole: { bails: 0, days: 0 } };
const GOOD: Ability = { feel: 0.8, judgement: 0.9, reliability: 0.8, prudence: 0.5 };
const POOR: Ability = { feel: 0.3, judgement: 0.1, reliability: 0.3, prudence: 0.5 };

describe("assess: what he would recommend, from what he can see", () => {
  it("fishes stuck tools while it makes sense, and says plug it when it does not", () => {
    expect(assess({ ...OBS, stuck: true }, GOOD, "methodical", 0.5, 0.5)?.kind).toBe("fish");
    expect(assess({ ...OBS, stuck: true, fishCount: 2 }, GOOD, "cautious", 0.5, 0.5)?.kind).toBe("abandon");
    expect(assess({ ...OBS, stuck: true, fishCount: 2 }, GOOD, "aggressive", 0.5, 0.5)?.kind).toBe("fish");
    expect(assess({ ...OBS, stuck: true, cashCents: 7_000 }, GOOD, "aggressive", 0.5, 0.5)?.kind).toBe("abandon");
  });

  it("wants pipe on a seat that seals when sand stands open, naming what the bailer saw", () => {
    const a = assess({ ...OBS, openSandFt: 120, bottom: { lith: "clay", call: "blue clay", ft: 395 } }, GOOD, "methodical", 0.5, 0.5);
    expect(a).toMatchObject({ kind: "case", reason: "seat", costCents: 20_000 });
    expect(a!.text).toMatch(/blue clay/);
  });

  it("a good judge waits for clay where a poor one runs pipe in sand, and says what that pipe will not do", () => {
    const o = { ...OBS, openSandFt: 100, bottom: { lith: "sand", call: "grey sand, water", ft: 398 } };
    expect(assess(o, GOOD, "methodical", 0.5, 0.5)).toBeNull();
    const poor = assess(o, POOR, "methodical", 0.5, 0.5);
    expect(poor).toMatchObject({ kind: "case", reason: "sand" });
    expect(poor!.text).toMatch(/hold the walls up, not the water/);
  });

  it("wants pipe landed on hard rock under water sands, before going deeper", () => {
    const a = assess({ ...OBS, waterSeen: true, bottom: { lith: "rock", call: "hard rock, gypsum and lime", ft: 398 } }, GOOD, "economical", 0.5, 0.1);
    expect(a).toMatchObject({ kind: "case", reason: "cap" });
  });

  it("has nothing to recommend when no pipe is left, or the hole is cased near bottom", () => {
    expect(assess({ ...OBS, openSandFt: 300, stringsLeft: 0, nextPipe: null }, POOR, "cautious", 0.5, 0.5)).toBeNull();
    expect(assess({ ...OBS, openSandFt: 300, casedFt: 390 }, POOR, "cautious", 0.5, 0.5)).toBeNull();
  });

  it("says a hole is costing more than it promises, from what it cost, the money left and the shows", () => {
    // $700 spent on this hole, $250 left: about 20 days of rig time, too little to start another hole.
    const o = { ...OBS, depthFt: 900, wellSpentCents: 70_000, cashCents: 25_000 };
    const a = assess(o, { ...GOOD, prudence: 0.7 }, "cautious", 0.5, 0.5);
    expect(a?.kind).toMatch(COUNSEL);
    expect(a!.text).toMatch(/\$700 to 900 ft/);
    expect(a!.text).toMatch(/no show of oil or gas/);
    expect(a!.text).toMatch(/\$250 in hand: about 20 days of rig time\./);
  });

  it("judges by cash in hand: unborrowed credit does not keep the rig running, so it does not hide a shortage", () => {
    // The rig stops when cash runs out; credit is drawn only if the owner borrows. A methodical,
    // fairly prudent man with $150 in hand and $300 of unused credit must still speak.
    const o = { ...OBS, depthFt: 900, wellSpentCents: 70_000, cashCents: 15_000, creditRoomCents: 30_000 };
    const a = assess(o, { ...GOOD, prudence: 0.67 }, "methodical", 0.5, 0.5);
    expect(a?.kind).toMatch(COUNSEL);
    expect(a!.text).toMatch(/\$150 in hand: about 12 days of rig time, and \$300 more only if you borrow\./);
  });

  it("technical skill is not financial judgement: a fine hand may be reckless, an ordinary one prudent", () => {
    const o = { ...OBS, depthFt: 900, wellSpentCents: 70_000, cashCents: 25_000 };
    const fineButReckless: Ability = { feel: 0.95, judgement: 0.95, reliability: 0.95, prudence: 0.1 };
    const ordinaryButPrudent: Ability = { feel: 0.4, judgement: 0.35, reliability: 0.4, prudence: 0.9 };
    expect(assess(o, fineButReckless, "methodical", 0.5, 0.5)?.kind ?? "").not.toMatch(COUNSEL);
    expect(assess(o, ordinaryButPrudent, "methodical", 0.5, 0.5)?.kind).toMatch(COUNSEL);
  });

  it("temperament sets when he speaks: an aggressive man only when the money is nearly gone", () => {
    const mid = { ...OBS, depthFt: 900, wellSpentCents: 70_000, cashCents: 25_000 };
    expect(assess(mid, GOOD, "aggressive", 0.5, 0.5)?.kind ?? "").not.toMatch(COUNSEL);
    expect(assess(mid, GOOD, "cautious", 0.5, 0.5)?.kind).toMatch(COUNSEL);
    // Not even another hundred feet in cash and credit: a fact about the money, so he recommends stopping.
    const broke = { ...OBS, depthFt: 900, wellSpentCents: 110_000, cashCents: 2_000 };
    const a = assess(broke, GOOD, "aggressive", 0.5, 0.5);
    expect(a?.kind).toBe("quit");
    expect(a!.text).toMatch(/I hate to quit a hole/);
  });

  it("a show of oil or gas near the bottom is reason to keep on; sulphur water is not", () => {
    const o = { ...OBS, depthFt: 900, wellSpentCents: 70_000, cashCents: 25_000 };
    expect(assess({ ...o, lastShow: { kind: "gas", ft: 860 } }, GOOD, "cautious", 0.5, 0.5)?.kind ?? "").not.toMatch(COUNSEL);
    expect(assess({ ...o, lastShow: { kind: "sulphur", ft: 860 } }, GOOD, "cautious", 0.5, 0.5)?.kind).toMatch(COUNSEL);
    expect(assess({ ...o, lastShow: { kind: "gas", ft: 500 } }, GOOD, "cautious", 0.5, 0.5)?.kind).toMatch(COUNSEL);
  });

  it("is built so it cannot see the ground: its module imports no geological truth and no hidden casing", () => {
    const src = readFileSync(new URL("../../src/sim/company/judgement.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/geology\/truth|hidden\/casing/);
  });
});

/** A site with a water sand over clay over oil (truth used only to pick the test ground). */
function site(): { seed: string; x: number; y: number } {
  for (let i = 0; i < 200; i++) {
    const seed = (0xa0000 + i * 7919).toString(16).padStart(16, "0");
    const t = generateGeology(seed);
    for (const s of SURVEYS) {
      const [x, y] = [s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length, s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length];
      if (!insidePoly(s.poly, x, y)) continue;
      const col = columnAt(t, x, y, 300).map((iv) => ({ ...iv, topFt: iv.top * 3.28, baseFt: iv.base * 3.28 }));
      const sand = col.find((iv) => iv.lithology === "sand" && iv.fluid === "water" && iv.baseFt - iv.topFt > 80 && iv.baseFt < 700);
      if (sand && col.some((iv) => iv.lithology === "clay" && iv.topFt >= sand.baseFt - 1 && iv.baseFt - iv.topFt > 40) && noRunningSand(seed, x, y, 1500)) return { seed, x, y };
    }
  }
  throw new Error("no site");
}

/** The best judge among many months' men (hidden measure, test only). */
function judge(seed: string): Driller {
  const all = Array.from({ length: 60 }, (_, m) => candidatesFor(seed, m)).flat().filter((d) => d.temperament === "methodical");
  return all.sort((p, q) => abilityOf(seed, q.id).judgement - abilityOf(seed, p.id).judgement)[0]!;
}

function start(man: Driller | null, capitalCents = 0): WorldState {
  const s = site();
  const w = gameEngine.createWorld(s.seed, CAMPAIGN_START);
  if (capitalCents) {
    const o = (w.systems as unknown as Record<string, { ledger: Parameters<typeof post>[0] }>).operations!;
    post(o.ledger, w.time, "opening", "Test: more capital", [{ account: "cash", cents: capitalCents }, { account: "equity", cents: -capitalCents }]);
  }
  if (man) (w.systems.operations as unknown as { crew: { driller: Driller } }).crew.driller = man;
  cmd(w, "lease.take", { surveyId: SURVEYS.find((x) => insidePoly(x.poly, s.x, s.y))!.id, offer: "asking" });
  expect(rejected(cmd(w, "rig.spud", { x: s.x, y: s.y }))).toBeUndefined();
  cmd(w, "rig.auto", { on: true });
  return w;
}

type Ev = { type: string; t: number; data?: unknown };
/** Run the driller until he speaks (an advice interrupt), or the well ends. */
function untilAdvice(w: WorldState, days = 60): Ev | null {
  const end = w.time + days * MINUTES_PER_DAY;
  while (w.time < end) {
    const r = gameEngine.advance(w, end, { stopOnInterrupt: true });
    const a = r.events.find((e) => e.type === "driller.advice");
    if (a) return a as Ev;
    const st = ops(w).well!.status;
    if (st === "gusher" || st === "dry") return null;
    if (!r.interrupted) return null;
  }
  return null;
}

describe("asking, accepting, declining", () => {
  it("asks before spending, and the clock stops on his advice", () => {
    const w = start(judge(site().seed));
    const ev = untilAdvice(w)!;
    expect(ev).not.toBeNull();
    const p = ops(w).crew.pending!;
    expect(p).toMatchObject({ t: ev.t, wellId: ops(w).well!.id });
    expect(ops(w).crew.notes.at(-1)!.kind).toBe("advice");
    // Accepting does what he said; it is the player's spending, not his.
    const strings = ops(w).well!.strings.length, spent = ops(w).crew.orders.spentCents;
    expect(rejected(cmd(w, "crew.accept", { id: p.id }))).toBeUndefined();
    expect(ops(w).crew.pending).toBeNull();
    if (p.kind === "case") {
      gameEngine.advance(w, ops(w).well!.busy!.until + 5);
      expect(ops(w).well!.strings.length).toBe(strings + 1);
    }
    expect(ops(w).crew.orders.spentCents).toBe(spent);
  });

  it("a declined recommendation is not raised again until the hole has materially changed", () => {
    const w = start(judge(site().seed));
    let firstCase: { depth: number; sand: number; strings: number } | null = null;
    for (let k = 0; k < 12; k++) {
      const ev = untilAdvice(w, 30);
      if (!ev) break;
      const p = ops(w).crew.pending!;
      const well = ops(w).well!;
      if (p.kind === "case") {
        if (firstCase) {
          const changed = well.strings.length !== firstCase.strings || well.depthFt >= firstCase.depth + 100 || well.openSandFt >= firstCase.sand + 50;
          expect(changed, `re-raised at ${well.depthFt} ft, sand ${well.openSandFt}`).toBe(true);
        }
        firstCase = { depth: well.depthFt, sand: well.openSandFt, strings: well.strings.length };
      }
      if (p.kind === "fish") cmd(w, "crew.accept", { id: p.id });
      else cmd(w, "crew.decline", { id: p.id });
    }
    expect(firstCase).not.toBeNull();
  });

  it("advice left unanswered lapses after an hour of play and is remembered as declined", () => {
    const w = start(judge(site().seed));
    untilAdvice(w);
    const p = ops(w).crew.pending!;
    gameEngine.advance(w, w.time + ADVICE_LAPSE_MINUTES + 15);
    expect(ops(w).crew.pending?.id ?? null).not.toBe(p.id);
    expect(ops(w).crew.declined[p.kind]).toBeDefined();
  });

  it("never names a depth below the bit: every foot it mentions has been drilled", () => {
    const w = start(null);
    for (let k = 0; k < 10; k++) {
      const ev = untilAdvice(w, 30);
      if (!ev) break;
      const depth = ops(w).well!.depthFt;
      const text = (ev.data as { message: string }).message;
      for (const m of text.matchAll(/(\d[\d,]*) ft/g)) expect(Number(m[1]!.replace(/,/g, "")), text).toBeLessThanOrEqual(depth + 1);
      const p = ops(w).crew.pending!;
      cmd(w, p.kind === "fish" ? "crew.accept" : "crew.decline", { id: p.id });
    }
  });
});

describe("his own judgement, within limits", () => {
  it("acts without asking inside the month's budget, and counts what he spends cumulatively", () => {
    const w = start(judge(site().seed), 500_000);
    cmd(w, "crew.orders", { authority: "judgement", budgetCents: 100_000 });
    const end = w.time + 40 * MINUTES_PER_DAY;
    let acted = 0;
    while (w.time < end) {
      const r = gameEngine.advance(w, end, { stopOnInterrupt: true });
      acted += r.events.filter((e) => e.type === "company.notice" && /on his own judgement/.test((e.data as { message: string }).message)).length;
      const p = ops(w).crew.pending;
      if (p) cmd(w, "crew.decline", { id: p.id });
      const st = ops(w).well!.status;
      if (st === "gusher" || st === "dry" || !r.interrupted) break;
    }
    expect(acted).toBeGreaterThan(0);
    const o = ops(w).crew.orders;
    expect(o.spentCents).toBeGreaterThan(0);
    expect(o.spentCents).toBeLessThanOrEqual(o.budgetCents);
    expect(ops(w).crew.notes.some((n) => n.kind === "acted")).toBe(true);
  });

  it("asks instead when the spending would pass the month's allowance, and the allowance resets with the month", () => {
    const w = start(judge(site().seed), 500_000);
    cmd(w, "crew.orders", { authority: "judgement", budgetCents: 1_000 }); // $10: less than any pipe or fishing job
    const ev = untilAdvice(w)!;
    expect((ev.data as { message: string }).message).toMatch(/past this month's allowance/);
    expect(ops(w).crew.orders.spentCents).toBe(0);
    const p = ops(w).crew.pending!;
    cmd(w, "crew.decline", { id: p.id });
    gameEngine.advance(w, fromCalendar(1890, 3, 1, 1, 0));
    expect(ops(w).crew.orders.spentCents).toBe(0);
  });

  it("never spends the company below its recovery reserve on his own: he asks", () => {
    const w = start(judge(site().seed));
    cmd(w, "crew.orders", { authority: "judgement", budgetCents: 100_000 });
    // Leave about the reserve in hand (test only).
    const o = (w.systems as unknown as Record<string, { ledger: Parameters<typeof post>[0] }>).operations!;
    const spare = Math.round(ops(w).cash * 100) - 20_000;
    post(o.ledger, w.time, "operating", "Test: spent elsewhere", [{ account: "operating", cents: spare }, { account: "cash", cents: -spare }]);
    const ev = untilAdvice(w)!;
    const kind = (ev.data as { kind: string }).kind;
    // He either asks before spending, or counsels plugging the hole: he never spends below the reserve himself.
    if (kind !== "abandon" && kind !== "quit" && kind !== "decide") expect((ev.data as { message: string }).message).toMatch(/too little in hand|past this month's allowance/);
    expect(ops(w).crew.orders.spentCents).toBe(0);
  });
});

describe("counsel to quit a costly hole", () => {
  /** A cautious, prudent man (hidden measure, test only). */
  function prudent(seed: string): Driller {
    const all = Array.from({ length: 80 }, (_, m) => candidatesFor(seed, m)).flat().filter((d) => d.temperament === "cautious");
    return all.sort((p, q) => abilityOf(seed, q.id).prudence - abilityOf(seed, p.id).prudence)[0]!;
  }

  /** A company already down to its last few hundred dollars (spent elsewhere, test only). */
  function lean(w: WorldState, keepCents = 40_000): WorldState {
    const o = (w.systems as unknown as Record<string, { ledger: Parameters<typeof post>[0] }>).operations!;
    const spare = Math.round(ops(w).cash * 100) - keepCents;
    post(o.ledger, w.time, "operating", "Test: spent elsewhere", [{ account: "operating", cents: spare }, { account: "cash", cents: -spare }]);
    return w;
  }

  /** Drill on, declining everything but fishing, until he counsels quitting or the well ends. */
  function untilQuit(w: WorldState): { id: number; t: number } | null {
    for (let k = 0; k < 40; k++) {
      const ev = untilAdvice(w, 30);
      if (!ev) return null;
      const p = ops(w).crew.pending!;
      if (p.kind === "quit" || p.kind === "decide") return { id: p.id, t: ev.t };
      cmd(w, p.kind === "fish" ? "crew.accept" : "crew.decline", { id: p.id });
    }
    return null;
  }

  it("raises it from what the hole has cost; declined, not again until money or depth changes materially", () => {
    const w = lean(start(prudent(site().seed)));
    const q = untilQuit(w);
    expect(q).not.toBeNull();
    const at = { depth: ops(w).well!.depthFt, cash: ops(w).cash };
    cmd(w, "crew.decline", { id: q!.id });
    const again = untilQuit(w);
    if (again) {
      const deeper = ops(w).well!.depthFt >= at.depth + 300;
      expect(deeper || ops(w).cash < at.cash).toBe(true);
    }
  });

  it("standing orders never plug a hole: even trusted with a budget, he asks", () => {
    const w = lean(start(prudent(site().seed)));
    cmd(w, "crew.orders", { authority: "judgement", budgetCents: 100_000 });
    const q = untilQuit(w);
    expect(q).not.toBeNull();
    expect(ops(w).well!.status === "drilling" || ops(w).well!.status === "stuck").toBe(true);
    expect(ops(w).crew.pending!.kind).toMatch(COUNSEL);
  });

  it("accepting it ends the well with the company's remaining capital kept", () => {
    const w = lean(start(prudent(site().seed)));
    const q = untilQuit(w)!;
    const cash = ops(w).cash;
    expect(rejected(cmd(w, "crew.accept", { id: q.id }))).toBeUndefined();
    expect(ops(w).well!.status).toBe("dry");
    expect(ops(w).well!.outcome).toMatch(/to save the company's money|chose to keep its money/);
    expect(ops(w).cash).toBeCloseTo(cash, 0);
    expect(cash).toBeGreaterThan(50);
  });
});
