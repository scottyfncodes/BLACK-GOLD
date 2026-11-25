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
  /** What the bank would still lend: with cash in hand, the company's remaining capital. */
  creditRoomCents: number;
  /** What this hole has cost the company so far: derrick, rig time, pipe, fishing (cents). */
  wellSpentCents: number;
  /** The deepest show the bailer has brought up in this hole, if any. */
  lastShow: { kind: "gas" | "oil" | "sulphur"; ft: number } | null;
}

export type Advice =
  | { kind: "case"; reason: "seat" | "sand" | "cap"; text: string; costCents: number }
  | { kind: "fish"; text: string; costCents: number }
  | { kind: "abandon"; text: string; costCents: 0 }
  | { kind: "quit"; text: string; costCents: 0 };

/** How much open sand he will stand before he wants pipe (ft): a habit of temperament. */
const PATIENCE: Record<Temperament, number> = { cautious: 45, methodical: 60, economical: 85, aggressive: 110 };
/**
 * When he says a hole is costing more than it promises: a habit of temperament. `share` is the
 * part of the company's money (spent on this hole, plus what is left) that this hole has eaten;
 * `days` is how many days of rig time the remaining capital would pay for; `dry` is how far he
 * will drill past the last show before that alone worries him (with half the share).
 */
const MONEY_SENSE: Record<Temperament, { days: number; dry: number }> = {
  cautious: { days: 30, dry: 800 },
  economical: { days: 24, dry: 900 },
  methodical: { days: 16, dry: 1100 },
  aggressive: { days: 5, dry: Infinity },
};

const usd = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-US");

const QUIT_WORDS: Record<Temperament, string> = {
  cautious: "I'd plug it now and keep what's left for better ground.",
  economical: "I'd not spend more on it: plug it and save the money.",
  methodical: "By my log there is nothing here yet worth the rest of the money. I'd plug it.",
  aggressive: "I hate to quit a hole, but the money is nearly gone. I'd plug it.",
};

/**
 * Whether he would tell you this hole is costing more than it promises. Only what he can see:
 * what the hole has cost, the money and credit left, how deep it is, and what the bailer has
 * shown. Prudence (hidden, independent of skill) moves when he speaks; temperament how.
 */
export function moneyConcern(o: Observations, a: Ability, t: Temperament): string | null {
  if (o.depthFt < 150 || o.wellSpentCents <= 0) return null;
  // The rig runs on cash in hand: credit keeps it going only if the owner chooses to borrow.
  const cash = Math.max(0, o.cashCents), credit = Math.max(0, o.creditRoomCents);
  const days = cash / o.dayCents;
  const share = o.wellSpentCents / (o.wellSpentCents + cash + credit);
  // A show of oil or gas near the bottom is reason to keep on: he will not counsel quitting then.
  if (o.lastShow && o.lastShow.kind !== "sulphur" && o.depthFt - o.lastShow.ft < 150) return null;
  const m = MONEY_SENSE[t];
  const p = a.prudence;
  // Running short: the cash in hand would barely start another hole. A prudent man says so sooner.
  const short = days <= m.days * (0.3 + 0.9 * p);
  // A long run of dry hole that has eaten most of the money: he begins to doubt it.
  const sinceShow = o.depthFt - (o.lastShow?.ft ?? 0);
  const longDry = sinceShow >= m.dry * (1.5 - p) && share >= 0.65 - (p - 0.5) * 0.2;
  if (!short && !longDry) return null;
  const shown = o.lastShow ? `the last show was ${o.lastShow.kind === "sulphur" ? "sulphur water" : o.lastShow.kind} at ${Math.round(o.lastShow.ft)} ft` : "no show of oil or gas yet";
  return `This hole has cost ${usd(o.wellSpentCents)} to ${Math.round(o.depthFt)} ft, and ${shown}. The company has ${usd(cash)} in hand: about ${Math.floor(days)} days of rig time${credit > 0 ? `, and ${usd(credit)} more only if you borrow` : ""}. ${QUIT_WORDS[t]}`;
}

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
  const quit = moneyConcern(o, a, t);
  if (quit) return { kind: "quit", text: quit, costCents: 0 };
  if (o.stringsLeft <= 0 || !o.nextPipe || o.depthFt - o.casedFt < 20) return null;
  // What he sees, blurred by how well he reads a hole.
  const sand = o.openSandFt * (1 + (noise - 0.5) * (1 - a.judgement) * 1.4);
  const patience = PATIENCE[t];
  const fresh = !!o.bottom && o.depthFt - o.bottom.ft <= 15;
  const seat = fresh && (o.bottom!.lith === "clay" || o.bottom!.lith === "rock");
  const pipe = o.nextPipe, cost = o.nextCostCents;
  // He names the rock as the bailer called it, without the trailing remarks ("grey sand", not "grey sand, water").
  const rock = o.bottom ? o.bottom.call.split(",")[0]! : "sand";
  // Hard rock under water sands: land the pipe on it before drilling into whatever is below.
  if (fresh && o.bottom!.lith === "rock" && o.waterSeen && !o.waterShutOff && noise2 < 0.35 + 0.65 * a.judgement) {
    return { kind: "case", reason: "cap", text: `The bailer brings up ${rock} at ${Math.round(o.depthFt)} ft, under the water sands. I'd land the ${pipe} on this rock before we go deeper, to keep the water off whatever is below.`, costCents: cost };
  }
  if (seat && sand >= patience * 0.4 && a.judgement > 0.45) {
    return { kind: "case", reason: "seat", text: `We're into ${rock} at ${Math.round(o.depthFt)} ft, below ${Math.round(o.openSandFt)} ft of open sand. A good place to land the ${pipe}: it should shut off the water above.`, costCents: cost };
  }
  if (sand >= patience) {
    if (seat) return { kind: "case", reason: "seat", text: `${Math.round(o.openSandFt)} ft of sand is standing open, and we're into ${rock} at ${Math.round(o.depthFt)} ft. I'd land the ${pipe} here.`, costCents: cost };
    // A good judge waits longer for a seat that seals; a poor one runs pipe wherever he is.
    if (sand >= patience * (1 + 2.4 * a.judgement)) return { kind: "case", reason: "sand", text: `The sand is caving in on us: ${Math.round(o.openSandFt)} ft open. I'd run the ${pipe} now, though the shoe will sit in ${rock}: it will hold the walls up, not the water.`, costCents: cost };
  }
  return null;
}
