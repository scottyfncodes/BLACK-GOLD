import { describe, expect, it } from "vitest";
import { CAMPAIGN_START, gameEngine, knowledgeOf, MINUTES_PER_DAY, type KnowledgeView, type PrintedMap } from "../../src/sim";
import { canonicalJson } from "../../src/sim/core/hash";
import { generateGeology, type GeologyTruth } from "../../src/sim/geology/truth/model";
import { surfaceSigns } from "../../src/sim/geology/truth/surface";
import { buildPrintedMap } from "../../src/sim/surface/print";
import { SURVEYS, insidePoly } from "../../src/content/geography/surveys";
import { drawManuscript, drawPrint, type MapView } from "../../src/render/plate/map";
import { drawSection } from "../../src/render/plate/section";
import { setCanvasFactory } from "../../src/render/plate/paper";
import { recorder } from "./recorder";

/**
 * M1 acceptance: "the player-facing map shows only evidence-derived information" — and the
 * ART-DIRECTION rule "never reveal hidden geology through the renderer". The same knowledge,
 * rendered over two different hidden geologies, must produce identical draw calls.
 */
setCanvasFactory((w, h) => { const r = recorder(); return Object.assign({ width: w, height: h, getContext: () => r.ctx }) as never; });

const SEED = "7e57ab1e18900001";

/** Same surface, different underground: charge, trap widths, caprock porosity and gas all changed. */
function alteredTruth(t: GeologyTruth): GeologyTruth {
  const c = structuredClone(t);
  c.domes.forEach((d, i) => {
    d.charge = { fill: i % 2 ? 0.95 : 0, gasProne: !d.charge.gasProne };
    d.flankW *= 1.7;
    d.capThickness *= 0.5;
  });
  return c;
}

function knowledgeAfterFieldwork(): KnowledgeView {
  const w = gameEngine.createWorld(SEED, CAMPAIGN_START);
  const t = generateGeology(SEED);
  const step = (type: string, payload: unknown) => {
    gameEngine.advance(w, w.time, { commands: [{ t: w.time, actor: "player", type, payload: payload as never }] });
    gameEngine.advance(w, w.time + 10 * MINUTES_PER_DAY, { stopOnInterrupt: true });
  };
  for (const d of t.domes.slice(0, 3)) {
    const s = SURVEYS.find((x) => insidePoly(x.poly, d.x, d.y));
    if (s) step("fieldwork.walk", { surveyId: s.id });
  }
  step("fieldwork.inquire", { wellId: "well-0" });
  step("fieldwork.inquire", { wellId: "well-1" });
  const k = knowledgeOf(w);
  return structuredClone({ evidence: k.evidence, interp: k.interp, task: k.task });
}

function render(print: PrintedMap, k: KnowledgeView): string[] {
  const view: MapView = { w: 900, h: 600, cx: 13, cy: 13, scale: 48 };
  const map = recorder();
  drawPrint(map.ctx, view, print);
  drawManuscript(map.ctx, view, { knowledge: k, print, selection: null, draft: null });
  const sec = recorder();
  const line = { id: "s", letter: "A", a: [8, 10] as [number, number], b: [18, 16] as [number, number] };
  drawSection(sec.ctx, 900, 360, line, k, print);
  return [...map.log, "--- section ---", ...sec.log];
}

describe("the renderer cannot reveal hidden geology", () => {
  const truth = generateGeology(SEED);
  const altered = alteredTruth(truth);
  const knowledge = knowledgeAfterFieldwork();

  it("the published map is the same whatever lies underground", () => {
    // Surface signs are physical facts recorded at generation; the altered truth keeps the surface.
    const signs = surfaceSigns(truth);
    expect(canonicalJson(buildPrintedMap(altered, signs))).toBe(canonicalJson(buildPrintedMap(truth, signs)));
    expect(altered.domes.map((d) => d.charge.fill)).not.toEqual(truth.domes.map((d) => d.charge.fill));
  });

  it("draws identically over two different geologies given the same knowledge", () => {
    expect(knowledge.evidence.length).toBeGreaterThan(3);
    const a = render(buildPrintedMap(truth, surfaceSigns(truth)), knowledge);
    const b = render(buildPrintedMap(altered, surfaceSigns(truth)), knowledge);
    expect(a.length).toBeGreaterThan(2000);
    expect(b).toEqual(a);
  });

  it("and the recorder is sensitive: different knowledge draws differently", () => {
    const print = buildPrintedMap(truth, surfaceSigns(truth));
    const less = { ...knowledge, evidence: knowledge.evidence.slice(0, 1) };
    expect(render(print, less)).not.toEqual(render(print, knowledge));
  });

  it("leaves unknown ground as blank paper: a section with no records draws no rock", () => {
    const print = buildPrintedMap(truth, surfaceSigns(truth));
    const empty = { evidence: [], interp: { sections: [], prospects: [] }, task: null };
    const r = recorder();
    drawSection(r.ctx, 900, 360, { id: "s", letter: "A", a: [8, 10], b: [18, 16] }, empty, print);
    expect(r.log.some((l) => l.includes("Nothing is known below the surface"))).toBe(true);
    // No lithology tint was laid down anywhere.
    expect(r.log.filter((l) => /^fillStyle="#(d6aa52|788c80|c9a25e|b9a37a|e3c6c0)"/.test(l))).toHaveLength(0);
  });
});
