import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, FIELD_COSTS, gameEngine, knowledgeOf, MINUTES_PER_DAY, operationsOf, printedMap, readSpot, type AccountEvidence, type Evidence, type ReadingEvidence, type WorldState } from "../../src/sim";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { assess, moneyConcern, type Observations } from "../../src/sim/company/judgement";
import { rockRule } from "../../src/sim/systems/fieldwork";
import { v6ToV7 } from "../../src/sim/migrations";
import { generateGeology } from "../../src/sim/geology/truth/model";

/**
 * M7, Reading the Ground: depth evidence that is honest and imprecise, the accounts of the
 * company's own holes, counsel that weighs the evidence, and fieldwork that costs money.
 * Truth is read here only to check the evidence against it.
 */
const cmd = (w: WorldState, type: string, payload: unknown = null) =>
  gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
const rejected = (r: ReturnType<typeof cmd>) => r.events.find((e) => e.type === "command.rejected");
const seedN = (i: number) => (0xa0000 + i * 7919).toString(16).padStart(16, "0");
const FT = 3.2808;
const hillSeeds = (n: number) => { const out: string[] = []; for (let i = 0; out.length < n && i < n * 4; i++) if (printedMap(seedN(i)).hills[0]) out.push(seedN(i)); return out; };
const surveyOf = (x: number, y: number) => SURVEYS.find((s) => insidePoly(s.poly, x, y))!;
function consult(w: WorldState, surveyId: string): ReadingEvidence {
  expect(rejected(cmd(w, "fieldwork.consult", { surveyId, who: "geologist" }))).toBeUndefined();
  gameEngine.advance(w, w.time + 8 * MINUTES_PER_DAY);
  return knowledgeOf(w).evidence.filter((e): e is ReadingEvidence => e.kind === "reading").at(-1)!;
}
/** Drill with the driller on a printed hill's crest, accepting his advice, until the hole ends. */
function drillHill(w: WorldState, x: number, y: number): AccountEvidence | undefined {
  cmd(w, "lease.take", { surveyId: surveyOf(x, y).id, offer: "asking" });
  if (rejected(cmd(w, "rig.spud", { x, y }))) return undefined;
  gameEngine.advance(w, w.time + 3 * MINUTES_PER_DAY + 10);
  cmd(w, "rig.auto", { on: true });
  for (let i = 0; i < 400; i++) {
    gameEngine.advance(w, w.time + 2 * MINUTES_PER_DAY, { stopOnInterrupt: true });
    const o = operationsOf(w);
    if (o.crew.pending) cmd(w, "crew.accept", { id: o.crew.pending.id });
    if (o.well?.status === "stuck" && !o.crew.pending) cmd(w, "rig.fish");
    if (o.well?.status === "gusher" || o.well?.status === "dry") break;
  }
  gameEngine.advance(w, w.time + 1);
  return knowledgeOf(w).evidence.filter((e): e is AccountEvidence => e.kind === "account").at(-1);
}

describe("the geologist's reading of the depth to the rock", () => {
  it("is a range from his rule of thumb: lower rises, deeper rock, and never a single figure", () => {
    const [lo20, hi20] = rockRule(20), [lo5, hi5] = rockRule(5);
    expect(lo5).toBeGreaterThan(lo20);
    expect(hi5 - lo5).toBeGreaterThanOrEqual(200);
    expect(hi20).toBeGreaterThan(lo20);
  });

  it("is honest across many worlds: it contains the true depth most of the time, and misses sometimes", () => {
    let readings = 0, contained = 0;
    for (const seed of hillSeeds(40)) {
      const w = gameEngine.createWorld(seed, CAMPAIGN_START);
      const hill = printedMap(seed).hills[0]!;
      const r = consult(w, surveyOf(hill.x, hill.y).id);
      if (r.verdict !== "range" || !r.rockFt) continue;
      const dome = generateGeology(seed).domes.find((d) => Math.hypot(d.x - r.x, d.y - r.y) < 1.2)!;
      readings++;
      if (dome.crest * FT >= r.rockFt[0] && dome.crest * FT <= r.rockFt[1]!) contained++;
    }
    expect(readings).toBeGreaterThan(25);
    expect(contained / readings).toBeGreaterThan(0.5);
    expect(contained / readings).toBeLessThan(0.97);
  });

  it("names what he based it on, costs his fee, and is told to the driller", () => {
    const seed = hillSeeds(1)[0]!;
    const w = gameEngine.createWorld(seed, CAMPAIGN_START);
    const hill = printedMap(seed).hills[0]!;
    const r = consult(w, surveyOf(hill.x, hill.y).id);
    expect(r.basis.join(" ")).toMatch(/rise he measured/);
    expect(r.text).toMatch(/no promise of oil|guess/);
    expect(operationsOf(w).cash).toBe(1_500 - FIELD_COSTS.geologistCents / 100);
    const books = operationsOf(w).ledger.entries.filter((e) => e.category === "fieldwork");
    expect(books).toHaveLength(1);
    expect((w.systems.operations as unknown as { notebook: Evidence[] }).notebook.some((e) => e.kind === "reading")).toBe(true);
  });

  it("trusts the company's own log over his guess once a hole on the rise has met the rock", () => {
    for (const seed of hillSeeds(12)) {
      const w = gameEngine.createWorld(seed, CAMPAIGN_START);
      const hill = printedMap(seed).hills[0]!;
      const acct = drillHill(w, hill.x, hill.y);
      if (!acct?.rock) continue;
      const r = consult(w, surveyOf(hill.x, hill.y).id);
      if (acct.rockDry) {
        expect(r.verdict).toBe("dry");
        expect(r.text).toMatch(/flanks/);
      } else {
        expect(r.basis[0]).toMatch(new RegExp(acct.name));
        expect(r.rockFt![0]).toBeLessThanOrEqual(acct.rock.topFt);
        expect(r.rockFt![1]).toBeGreaterThanOrEqual(acct.rock.topFt);
      }
      return;
    }
    throw new Error("no hole met the rock in these worlds");
  });
});

describe("the account of an ended hole", () => {
  it("states what the hole proved, what the company may make of it, and what it leaves unknown, from the bailer alone", () => {
    for (const seed of hillSeeds(12)) {
      const w = gameEngine.createWorld(seed, CAMPAIGN_START);
      const hill = printedMap(seed).hills[0]!;
      const acct = drillHill(w, hill.x, hill.y);
      if (!acct?.rock || acct.result !== "dry") continue;
      const samples = knowledgeOf(w).evidence.filter((e) => e.kind === "sample" && e.wellId === acct.wellId);
      const first = samples.find((s) => s.kind === "sample" && s.lith === "rock")!;
      // The rock's top is given to within the bail interval it came up in: no truer than the bailer.
      expect(first.kind === "sample" && Math.abs(acct.rock.topFt - (first.topFt + first.baseFt) / 2)).toBeLessThanOrEqual(1);
      expect(acct.proved[0]).toMatch(/No oil or gas came into the hole/);
      expect(acct.unknown.length).toBeGreaterThan(0);
      if (acct.rockDry) expect(acct.suggests.join(" ")).toMatch(/a reading, not a proof/);
      // The driller's notebook keeps it too: the next hole on the rise is judged by it.
      expect(readSpot((w.systems.operations as unknown as { notebook: Evidence[] }).notebook, hill.x + 0.2, hill.y).expect?.source).toBe("hole");
      return;
    }
    throw new Error("no dry hole met the rock in these worlds");
  });
});

describe("readSpot: the company's reading of the rock at a spot", () => {
  const base = { id: "e", t: 0 };
  const hole: AccountEvidence = { ...base, kind: "account", provenance: "observed", wellId: "w1", name: "Smith No. 1", surveyId: "s", x: 0, y: 0, result: "dry", deepestFt: 900, rock: { topFt: 800, withinFt: 5 }, rockDry: false, saltFt: null, shows: [], gypsumFt: null, costCents: 0, proved: [], suggests: [], unknown: [] };
  const reading: ReadingEvidence = { ...base, id: "r", kind: "reading", provenance: "opinion", from: "geologist", surveyId: "s", x: 0.1, y: 0, verdict: "range", rockFt: [500, 900], basis: [], text: "" };
  it("puts the company's own holes first, then the geologist, and names its source", () => {
    expect(readSpot([reading, hole], 0.3, 0).expect).toMatchObject({ rockFt: [770, 840], source: "hole" });
    expect(readSpot([reading], 0.3, 0).expect).toMatchObject({ rockFt: [500, 900], source: "geologist" });
    expect(readSpot([reading], 3, 0).expect).toBeNull();
    expect(readSpot([{ ...hole, rockDry: true, saltFt: 950 }], 0.2, 0).rockDry).toMatch(/without a show/);
  });
});

describe("counsel that weighs the evidence", () => {
  const OBS: Observations = { depthFt: 700, casedFt: 0, stringsLeft: 3, nextPipe: "10-inch", nextCostCents: 20_000, openSandFt: 0, bottom: null, waterSeen: false, waterShutOff: false, stuck: false, fishCount: 0, cashCents: 10_000, dayCents: 1_200, fishingCents: 6_000, creditRoomCents: 0, wellSpentCents: 90_000, lastShow: null, inflowFtHr: 0, driving: null, collapse: null, driveHead: false, nextDriveCents: 0, swageCents: 15_000, expect: null, rockDry: null, rockFt: null, inSalt: false, gypsumFt: null, sheenFt: null, paceFtDay: 40, noHole: { bails: 0, days: 0 } };
  const A = { feel: 0.6, judgement: 0.6, reliability: 0.6, prudence: 0.5 };
  it("with nothing seen either way, makes no recommendation: it says so, and what another hundred feet would cost", () => {
    const c = moneyConcern(OBS, A, "methodical")!;
    expect(c).toMatchObject({ kind: "decide", grounds: "none" });
    expect(c.text).toMatch(/no proof there is nothing below: I can't tell you either way/);
    expect(c.text).toMatch(/Each hundred feet more is about 3 days and \$30/);
  });
  it("says to stop when the money cannot pay for another hundred feet: a fact, not a reading", () => {
    expect(moneyConcern({ ...OBS, cashCents: 2_000 }, A, "methodical")).toMatchObject({ kind: "quit", grounds: "money" });
  });
  it("a rainbow of oil on the bailer water is a reason to keep on", () => {
    expect(moneyConcern({ ...OBS, sheenFt: 640 }, A, "cautious")).toBeNull();
    expect(moneyConcern({ ...OBS, sheenFt: 400 }, A, "cautious")).not.toBeNull();
  });
  it("in the salt, says plainly the hole is finished", () => {
    expect(assess({ ...OBS, inSalt: true, rockFt: 600, cashCents: 500_000 }, A, "aggressive", 0.5, 0.5)).toMatchObject({ kind: "quit" });
  });
  it("does not counsel quitting when the evidence puts the rock within the company's means, cash and credit", () => {
    expect(moneyConcern({ ...OBS, expect: { lo: 700, hi: 900, basis: "the geologist put the rock at 700 to 900 ft" }, creditRoomCents: 20_000 }, A, "methodical")).toBeNull();
    expect(moneyConcern({ ...OBS, expect: { lo: 700, hi: 1_400, basis: "x" } }, A, "methodical")).toMatchObject({ kind: "quit", grounds: "negative", text: expect.stringMatching(/Reaching 1,400 ft at this pace is about 18 days and \$210 more/) });
  });
  it("says when the hole is past where the rock was looked for", () => {
    expect(moneyConcern({ ...OBS, depthFt: 1_100, cashCents: 500_000, expect: { lo: 600, hi: 900, basis: "the geologist put the rock at 600 to 900 ft" } }, A, "aggressive")).toMatchObject({ kind: "quit", grounds: "negative", text: expect.stringMatching(/not met it: that reading was wrong here, or this spot is off the rock/) });
  });
  it("does not counsel quitting in the rock, or with gypsum in the cuttings just above", () => {
    expect(moneyConcern({ ...OBS, rockFt: 650 }, A, "cautious")).toBeNull();
    expect(moneyConcern({ ...OBS, gypsumFt: 680 }, A, "cautious")).toBeNull();
  });
});

describe("fieldwork costs money", () => {
  it("is paid as the party sets out, under Fieldwork in the books; without the money, the party stays home", () => {
    const seed = hillSeeds(1)[0]!;
    const w = gameEngine.createWorld(seed, CAMPAIGN_START);
    const s = SURVEYS[0]!;
    cmd(w, "fieldwork.walk", { surveyId: s.id });
    const paid = operationsOf(w).ledger.entries.filter((e) => e.category === "fieldwork");
    expect(paid).toHaveLength(1);
    expect(paid[0]!.memo).toMatch(/Field party walking/);
    gameEngine.advance(w, w.time + 4 * MINUTES_PER_DAY);
    // With less in hand than a geologist's fee, he is not sent for.
    const ops = w.systems.operations as unknown as { ledger: { balances: Record<string, number> } };
    ops.ledger.balances.cash = FIELD_COSTS.geologistCents - 100; // test only: a dollar short of his fee
    const r = cmd(w, "fieldwork.consult", { surveyId: s.id, who: "geologist" });
    expect(r.events.some((e) => e.type === "fieldwork.report" && /stays at home/.test(String((e.data as { message?: string }).message)))).toBe(true);
    expect(knowledgeOf(w).task).toBeNull();
  });
});

describe("v6 → v7", () => {
  it("gives the driller a notebook of what the company holds, and an account of each ended hole", () => {
    const seed = hillSeeds(1)[0]!;
    const w = gameEngine.createWorld(seed, CAMPAIGN_START);
    const hill = printedMap(seed).hills[0]!;
    drillHill(w, hill.x, hill.y);
    const old = structuredClone(w) as unknown as { systems: { operations: Record<string, unknown>; knowledge: { evidence: Evidence[] } } };
    delete old.systems.operations.notebook;
    old.systems.knowledge.evidence = old.systems.knowledge.evidence.filter((e) => e.kind !== "account" && e.kind !== "reading");
    const up = v6ToV7(old as never) as unknown as typeof old & { systems: { operations: { notebook: Evidence[] } } };
    expect(up.systems.operations.notebook.filter((e) => e.kind === "account")).toHaveLength(1);
    expect(up.systems.knowledge.evidence.filter((e) => e.kind === "account")).toHaveLength(1);
    expect(v6ToV7(up as never)).toEqual(up);
  });
});
