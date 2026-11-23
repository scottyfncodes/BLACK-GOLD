import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, knowledgeOf, MINUTES_PER_DAY, type Command, type WorldState } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { generateGeology } from "../../src/sim/geology/truth/model";
import { surfaceSigns } from "../../src/sim/geology/truth/surface";
import { waterWells } from "../../src/sim/geology/truth/waterWells";

const SEED = "00b16b111890aaaa";
const cmd = (w: WorldState, type: string, payload: unknown): Command => ({ t: w.time, actor: "player", type, payload: payload as never });

function run(w: WorldState, type: string, payload: unknown) {
  return gameEngine.advance(w, w.time, { commands: [cmd(w, type, payload)] });
}
function untilReport(w: WorldState) {
  return gameEngine.advance(w, w.time + 10 * MINUTES_PER_DAY, { stopOnInterrupt: true });
}

describe("fieldwork", () => {
  it("never changes geological truth (M1 acceptance)", () => {
    const before = canonicalJson({ g: generateGeology(SEED), s: surfaceSigns(generateGeology(SEED)), w: waterWells(generateGeology(SEED)) });
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    for (const s of SURVEYS.slice(0, 12)) { run(w, "fieldwork.walk", { surveyId: s.id }); untilReport(w); }
    for (const well of waterWells(generateGeology(SEED)).slice(0, 4)) { run(w, "fieldwork.inquire", { wellId: well.id }); untilReport(w); }
    run(w, "fieldwork.consult", { surveyId: SURVEYS[0]!.id, who: "geologist" }); untilReport(w);
    expect(knowledgeOf(w).evidence.length).toBeGreaterThan(15);
    expect(canonicalJson({ g: generateGeology(SEED), s: surfaceSigns(generateGeology(SEED)), w: waterWells(generateGeology(SEED)) })).toBe(before);
  });

  it("a walk takes days, ends at evening with an interrupt, and records what was seen and that it was walked", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const survey = SURVEYS[5]!;
    run(w, "fieldwork.walk", { surveyId: survey.id });
    expect(knowledgeOf(w).task?.kind).toBe("walk");
    const { interrupted, events } = untilReport(w);
    expect(interrupted).toBe(true);
    expect(events.at(-1)!.type).toBe("fieldwork.report");
    expect((w.time % MINUTES_PER_DAY) / 60).toBe(18);
    expect(knowledgeOf(w).task).toBeNull();
    expect(knowledgeOf(w).evidence.some((e) => e.kind === "walked" && e.surveyId === survey.id)).toBe(true);
  });

  it("finds a prominent mound on the first walk and never records a sign twice", () => {
    for (const seed of ["0000000000000001", "0000000000000002", "0000000000000003", "0000000000000004"]) {
      const t = generateGeology(seed);
      const big = surfaceSigns(t).find((s) => s.kind === "mound" && (s.relief ?? 0) > 3.2);
      if (!big) continue;
      const survey = SURVEYS.find((s) => insidePoly(s.poly, big.x, big.y));
      if (!survey) continue;
      const w = gameEngine.createWorld(seed, CAMPAIGN_START);
      for (let i = 0; i < 4; i++) { run(w, "fieldwork.walk", { surveyId: survey.id }); untilReport(w); }
      const mounds = knowledgeOf(w).evidence.filter((e) => e.kind === "surfaceSign" && e.sign === "mound" && e.surveyId === survey.id);
      expect(mounds).toHaveLength(1);
    }
  });

  it("rejects a second errand while the party is out", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    run(w, "fieldwork.walk", { surveyId: SURVEYS[0]!.id });
    const { events } = run(w, "fieldwork.walk", { surveyId: SURVEYS[1]!.id });
    expect(events[0]!.type).toBe("command.rejected");
  });

  it("well records are the owner's memory: ordered, rounded to 5 ft, in his words", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    const well = waterWells(generateGeology(SEED))[0]!;
    run(w, "fieldwork.inquire", { wellId: well.id });
    untilReport(w);
    const rec = knowledgeOf(w).evidence.find((e) => e.kind === "wellRecord")!;
    if (rec.kind !== "wellRecord") throw new Error("expected a well record");
    expect(rec.intervals[0]!.topFt).toBe(0);
    for (const iv of rec.intervals) {
      expect(iv.topFt % 5).toBe(0);
      expect(iv.baseFt).toBeGreaterThan(iv.topFt);
      expect(iv.call.length).toBeGreaterThan(2);
    }
    for (let i = 1; i < rec.intervals.length; i++) expect(rec.intervals[i]!.topFt).toBeGreaterThanOrEqual(rec.intervals[i - 1]!.topFt);
    const again = run(w, "fieldwork.inquire", { wellId: well.id });
    expect(again.events[0]!.type).toBe("command.rejected");
  });

  it("interpretations are the player's own: drawing and rubbing out never touches evidence", () => {
    const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
    run(w, "fieldwork.walk", { surveyId: SURVEYS[2]!.id });
    untilReport(w);
    const evidence = canonicalJson(knowledgeOf(w).evidence);
    run(w, "interp.section.add", { a: [10, 12], b: [14, 15] });
    run(w, "interp.prospect.add", { at: [12, 13], r: 0.8 });
    expect(knowledgeOf(w).interp.sections[0]!.letter).toBe("A");
    expect(knowledgeOf(w).interp.prospects[0]!.numeral).toBe("I");
    run(w, "interp.section.remove", { id: knowledgeOf(w).interp.sections[0]!.id });
    expect(knowledgeOf(w).interp.sections).toHaveLength(0);
    expect(canonicalJson(knowledgeOf(w).evidence)).toBe(evidence);
    const tooShort = run(w, "interp.section.add", { a: [10, 12], b: [10.1, 12] });
    expect(tooShort.events[0]!.type).toBe("command.rejected");
  });
});
