/**
 * The company's reading of the ground at a spot: what its evidence says about the depth to the
 * rock there, and what it rules out. An interpretation built only from evidence the company
 * holds (its own holes, a geologist's readings, settlers' accounts), never from truth. The
 * driller's counsel and the field notes use it; the player can check every line of it against
 * the evidence it names. Imports no truth.
 */
import type { AccountEvidence, Evidence, ReadingEvidence, WellRecordEvidence } from "./types";

/** Holes and readings within this distance (km) count as the same rise. */
export const SAME_RISE_KM = 1.0;

export interface Expectation {
  /** The rock is looked for between these depths (ft); an open upper end means "deeper than". */
  rockFt: [number, number | null];
  /** Where the expectation comes from, in words, naming the evidence. */
  basis: string;
  source: "hole" | "geologist" | "settler";
}

export interface SpotReading {
  expect: Expectation | null;
  /** A hole on this rise went through the rock to the salt with no show: words saying so. */
  rockDry: string | null;
}

const ft = (n: number) => Math.round(n).toLocaleString("en-US");
const near = (e: { x: number; y: number }, x: number, y: number, km: number) => Math.hypot(e.x - x, e.y - y) <= km;
const km = (e: { x: number; y: number }, x: number, y: number) => Math.hypot(e.x - x, e.y - y);

/**
 * What the company's evidence says about the rock at (x, y). The company's own holes come first
 * (it saw them itself), then the latest geologist's reading of the rise, then a settler's account
 * of hard rock in his well. Each names its source, so the player can weigh it.
 */
export function readSpot(evidence: readonly Evidence[], x: number, y: number): SpotReading {
  const holes = evidence.filter((e): e is AccountEvidence => e.kind === "account" && near(e, x, y, SAME_RISE_KM)).sort((a, b) => km(a, x, y) - km(b, x, y));
  const dry = holes.find((h) => h.rockDry);
  const rockDry = dry ? `the ${dry.name} went through the rock at ${ft(dry.rock!.topFt)} ft to the salt at ${ft(dry.saltFt!)} ft without a show` : null;
  const hole = holes.find((h) => h.rock);
  if (hole) {
    const top = hole.rock!.topFt, within = hole.rock!.withinFt;
    return { expect: { rockFt: [Math.max(0, top - within - 25), top + 40], basis: `the ${hole.name} met the rock at about ${ft(top)} ft, ${km(hole, x, y).toFixed(1)} km off`, source: "hole" }, rockDry };
  }
  const readings = evidence.filter((e): e is ReadingEvidence => e.kind === "reading" && near(e, x, y, SAME_RISE_KM + 0.2)).sort((a, b) => b.t - a.t);
  const reading = readings.find((r) => r.verdict === "range" || r.verdict === "deep");
  if (reading?.rockFt) {
    const [lo, hi] = reading.rockFt;
    return {
      expect: { rockFt: reading.verdict === "deep" || hi === null ? [lo, null] : [lo, hi], basis: reading.verdict === "deep" || hi === null ? `the geologist judged the rise too low to tell, and any rock deeper than ${ft(lo)} ft` : `the geologist put the rock at ${ft(lo)} to ${ft(hi)} ft`, source: "geologist" },
      rockDry: rockDry ?? (readings.some((r) => r.verdict === "dry") ? "the geologist holds that the rock on this rise is dry" : null),
    };
  }
  const settler = evidence
    .filter((e): e is WellRecordEvidence => e.kind === "wellRecord" && near(e, x, y, SAME_RISE_KM))
    .map((e) => ({ e, rock: e.intervals.find((iv) => iv.lith === "rock") }))
    .find((s) => s.rock);
  if (settler) {
    const top = settler.rock!.topFt;
    return { expect: { rockFt: [Math.max(0, top - 20), top + 40], basis: `${settler.e.owner} says his well struck hard rock at ${ft(top)} ft`, source: "settler" }, rockDry };
  }
  return { expect: null, rockDry };
}
