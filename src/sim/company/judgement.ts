/**
 * A driller's judgement: what he would recommend, from what he can see.
 *
 * `assess` takes only Observations: the bailer's calls for this hole, how the hole has behaved,
 * the pipe set and left, the money in hand. It cannot see the ground below the bit or any
 * reservoir: its input has no way to carry them. His hidden ability decides how well he reads
 * what he sees; his temperament decides what he tends to do about it.
 * Evidence and interpretation stay distinct: each piece of advice names what he saw, then what
 * he makes of it. Imports no truth.
 */
import type { Ability } from "../hidden/drillers";
import type { Temperament } from "./crew";

export interface Observations {
  depthFt: number;
  casedFt: number;
  stringsLeft: number;
  /** The next string's name and what it would cost to run to bottom (cents). */
  nextPipe: string | null;
  nextCostCents: number;
  /** Feet of uncased sand standing open in the hole: the heave and the bailer show it. */
  openSandFt: number;
  /** The last bailer sample from this hole: what it was called, and from what depth. */
  bottom: { lith: string; call: string; ft: number } | null;
  /** The hole made water somewhere above, and whether a string has been seen to shut it off. */
  waterSeen: boolean;
  waterShutOff: boolean;
  stuck: boolean;
  fishCount: number;
  cashCents: number;
  dayCents: number;
  fishingCents: number;
}

export type Advice =
  | { kind: "case"; reason: "seat" | "sand" | "cap"; text: string; costCents: number }
  | { kind: "fish"; text: string; costCents: number }
  | { kind: "abandon"; text: string; costCents: 0 };

/** How much open sand he will stand before he wants pipe (ft): a habit of temperament. */
const PATIENCE: Record<Temperament, number> = { cautious: 45, methodical: 60, economical: 85, aggressive: 110 };
/** How many fishing jobs on one hole before he would rather plug it. */
const FISH_LIMIT: Record<Temperament, number> = { cautious: 2, economical: 2, methodical: 3, aggressive: 5 };

/**
 * His recommendation now, or null. `noise` (0–1, seeded per hole and depth) blurs how he
 * reads the hole: a poor judge is blurred more.
 */
export function assess(o: Observations, a: Ability, t: Temperament, noise: number, noise2: number): Advice | null {
  if (o.stuck) {
    if (o.cashCents < o.fishingCents + 3 * o.dayCents) return { kind: "abandon", text: `The tools are fast at ${Math.round(o.depthFt)} ft, and there is too little in hand for a fishing job and the days after it. I'd plug the hole.`, costCents: 0 };
    if (o.fishCount >= FISH_LIMIT[t]) return { kind: "abandon", text: `Fast again at ${Math.round(o.depthFt)} ft, after ${o.fishCount} fishing job${o.fishCount > 1 ? "s" : ""} on this hole. I would not throw more money after it: I'd plug it.`, costCents: 0 };
    return { kind: "fish", text: `The tools are fast at ${Math.round(o.depthFt)} ft. A fishing job is a fair chance of freeing them.`, costCents: o.fishingCents };
  }
  if (o.stringsLeft <= 0 || !o.nextPipe || o.depthFt - o.casedFt < 20) return null;
  // What he sees, blurred by how well he reads a hole.
  const sand = o.openSandFt * (1 + (noise - 0.5) * (1 - a.judgement) * 1.4);
  const patience = PATIENCE[t];
  const fresh = !!o.bottom && o.depthFt - o.bottom.ft <= 15;
  const seat = fresh && (o.bottom!.lith === "clay" || o.bottom!.lith === "rock");
  const pipe = o.nextPipe, cost = o.nextCostCents;
  // Hard rock under water sands: land the pipe on it before drilling into whatever is below.
  if (fresh && o.bottom!.lith === "rock" && o.waterSeen && !o.waterShutOff && noise2 < 0.35 + 0.65 * a.judgement) {
    return { kind: "case", reason: "cap", text: `The bailer brings up ${o.bottom!.call} at ${Math.round(o.depthFt)} ft, under the water sands. I'd land the ${pipe} on this rock before we go deeper, to keep the water off whatever is below.`, costCents: cost };
  }
  if (seat && sand >= patience * 0.5 && a.judgement > 0.55) {
    return { kind: "case", reason: "seat", text: `We're into ${o.bottom!.call} at ${Math.round(o.depthFt)} ft, below ${Math.round(o.openSandFt)} ft of open sand. A good place to land the ${pipe}: it should shut off the water above.`, costCents: cost };
  }
  if (sand >= patience) {
    if (seat) return { kind: "case", reason: "seat", text: `${Math.round(o.openSandFt)} ft of sand is standing open, and we're into ${o.bottom!.call} at ${Math.round(o.depthFt)} ft. I'd land the ${pipe} here.`, costCents: cost };
    // A good judge waits longer for a seat that seals; a poor one runs pipe wherever he is.
    if (sand >= patience * (1 + 1.2 * a.judgement)) return { kind: "case", reason: "sand", text: `The sand is caving in on us: ${Math.round(o.openSandFt)} ft open. I'd run the ${pipe} now, though the shoe will sit in ${o.bottom?.call ?? "sand"}: it will hold the walls up, not the water.`, costCents: cost };
  }
  return null;
}
