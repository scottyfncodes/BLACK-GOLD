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
  /** Sand the bailer brought up beyond the cuttings, per hour since the bail before (ft/hour). */
  inflowFtHr: number;
  /** Drive pipe going down: where its shoe is, how far driven, feet made in the last two hours, and whether he has called refusal. */
  driving: { pipe: string; shoeFt: number; drivenFt: number; lastTwoHoursFt: number; refused: boolean } | null;
  /** A string collapsed in the hole: about where, and how many swaging jobs have been tried. */
  collapse: { atFt: number; attempts: number } | null;
  /** The company owns a drive head; what driving the next pipe through about 60 ft more would cost (cents, with the head if needed). */
  driveHead: boolean;
  nextDriveCents: number;
  swageCents: number;
  /**
   * What the company's evidence says of the rock at this spot (its own holes, a geologist's
   * reading, a settler's account), with the evidence named; an open `hi` means "deeper than lo".
   */
  expect: { lo: number; hi: number | null; basis: string } | null;
  /** A hole on this rise went through the rock to the salt without a show, in words. */
  rockDry: string | null;
  /** Where this hole's bailer first brought up hard rock, and whether it is in salt now. */
  rockFt: number | null;
  inSalt: boolean;
  /** The deepest call of gypsum chips in this hole. */
  gypsumFt: number | null;
  /** The deepest rainbow of oil on the bailer water in this hole. */
  sheenFt: number | null;
  /** Feet a day this hole has made since the derrick was up. */
  paceFtDay: number;
  /**
   * The hole has stopped making footage: bails in a row from about the same bottom (within 5 ft
   * of where the run began), and the days since the run began.
   */
  noHole: { bails: number; days: number };
}

export type Advice =
  | { kind: "case"; reason: "seat" | "sand" | "cap"; text: string; costCents: number }
  | { kind: "drive"; text: string; costCents: number }
  | { kind: "setdrive"; text: string; costCents: 0 }
  | { kind: "fish"; text: string; costCents: number }
  | { kind: "abandon"; text: string; costCents: 0 }
  | { kind: "quit"; text: string; costCents: 0 }
  | { kind: "decide"; text: string; costCents: 0 }
  | { kind: "stalled"; text: string; costCents: 0 };

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

/**
 * His counsel about the money, and what it rests on: "negative" evidence seen in the ground, the
 * "money" alone (not enough for another hundred feet), or "none" (nothing seen either way, so no
 * recommendation, only the cost of going on).
 */
export interface Counsel {
  kind: "quit" | "decide";
  grounds: "negative" | "money" | "none";
  text: string;
}

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
export function moneyConcern(o: Observations, a: Ability, t: Temperament): Counsel | null {
  if (o.depthFt < 150 || o.wellSpentCents <= 0) return null;
  // The rig runs on cash in hand: credit keeps it going only if the owner chooses to borrow.
  const cash = Math.max(0, o.cashCents), credit = Math.max(0, o.creditRoomCents);
  const days = cash / o.dayCents;
  const d = Math.round(o.depthFt);
  const per100 = (100 / o.paceFtDay) * o.dayCents;
  const costTo = (ft: number) => ({ days: Math.max(0, ft - o.depthFt) / o.paceFtDay, cents: (Math.max(0, ft - o.depthFt) / o.paceFtDay) * o.dayCents });
  const ft = (n: number) => n.toLocaleString("en-US");

  // ── Negative evidence: something seen in the ground says stop. He recommends it, and says what he saw.
  if (o.inSalt) return { kind: "quit", grounds: "negative", text: `We're in rock salt at ${d} ft${o.rockFt !== null ? `, under the rock we met at ${o.rockFt} ft, and the rock gave no oil` : ""}. Nobody has found anything under the salt in this country. Every foot more is money thrown away: I'd plug it.` };
  if (o.expect && o.rockFt === null && o.expect.hi !== null && o.depthFt > o.expect.hi + 150) {
    const { lo, hi, basis } = o.expect;
    return { kind: "quit", grounds: "negative", text: `We're at ${d} ft. The rock was looked for at ${ft(lo)} to ${ft(hi)} ft (${basis}), and we have not met it: that reading was wrong here, or this spot is off the rock. This hole has cost ${usd(o.wellSpentCents)}. ${QUIT_WORDS[t]}` };
  }

  // ── Positive evidence: something seen says oil, or the rock that holds it, may be near. He does not counsel stopping.
  if (o.lastShow && o.lastShow.kind !== "sulphur" && o.depthFt - o.lastShow.ft < 150) return null;
  if (o.sheenFt !== null && o.depthFt - o.sheenFt < 150) return null;
  if (o.rockFt !== null && o.depthFt - o.rockFt < 200) return null;
  if (o.gypsumFt !== null && o.rockFt === null && o.depthFt - o.gypsumFt < 100) return null;
  if (o.expect && o.rockFt === null) {
    const { lo, hi, basis } = o.expect;
    const range = hi === null ? `deeper than ${ft(lo)} ft` : `at ${ft(lo)} to ${ft(hi)} ft`;
    const target = hi ?? lo + 300;
    const need = costTo(target);
    if (o.depthFt < target && need.cents <= cash + credit) return null;
    // The evidence puts the rock beyond the company's means: that is a reason to stop, and he gives it.
    if (o.depthFt < target) return { kind: "quit", grounds: "negative", text: `The rock is looked for ${range} (${basis}). Reaching ${ft(target)} ft at this pace is about ${Math.ceil(need.days)} days and ${usd(need.cents)} more; the company has ${usd(cash)} in hand${credit > 0 ? ` and ${usd(credit)} of credit` : ""}. ${QUIT_WORDS[t]}` };
  }

  // ── Insufficient evidence: nothing seen says oil, and nothing says no oil. He speaks only of the money.
  const share = o.wellSpentCents / (o.wellSpentCents + cash + credit);
  const m = MONEY_SENSE[t];
  const p = a.prudence;
  // Running short: the cash in hand would barely start another hole. A prudent man says so sooner.
  const short = days <= m.days * (0.3 + 0.9 * p);
  // A long run of hole that has eaten most of the money: he raises it, without calling it barren.
  const sinceShow = o.depthFt - (o.lastShow?.ft ?? 0);
  const longDry = sinceShow >= m.dry * (1.5 - p) && share >= 0.65 - (p - 0.5) * 0.2;
  if (!short && !longDry) return null;
  const shown = o.lastShow ? `the last show was ${o.lastShow.kind === "sulphur" ? "sulphur water" : o.lastShow.kind} at ${Math.round(o.lastShow.ft)} ft` : "no show of oil or gas";
  const costs = `Each hundred feet more is about ${Math.ceil(100 / o.paceFtDay)} days and ${usd(per100)} at this pace. The company has ${usd(cash)} in hand: about ${Math.floor(days)} days of rig time${credit > 0 ? `, and ${usd(credit)} more only if you borrow` : ""}.`;
  // Not even another hundred feet left, cash and credit together: that is a fact about the money, and he says to stop.
  if (cash + credit < per100) return { kind: "quit", grounds: "money", text: `This hole has cost ${usd(o.wellSpentCents)} to ${d} ft, and ${shown}. ${costs} There is not the money for another hundred feet. ${QUIT_WORDS[t]}` };
  return { kind: "decide", grounds: "none", text: `This hole has cost ${usd(o.wellSpentCents)} to ${d} ft, and ${shown}; nor any sign of rock. That is no proof there is nothing below: I can't tell you either way. ${costs} It's your money: plug it and keep the rest, or drill on.` };
}

/** How many swaging jobs on a collapsed string before he would rather plug the hole. */
const SWAGE_LIMIT: Record<Temperament, number> = { cautious: 1, economical: 1, methodical: 2, aggressive: 3 };

/** How he puts refusal to you: a matter of temperament. */
const REFUSAL_WORDS: Record<Temperament, string> = {
  cautious: "I'd not pound on it: a parted joint or a crushed pipe would cost us the hole.",
  economical: "More pounding is more rig time for inches, and a risk to the pipe.",
  methodical: "By the log that's refusal.",
  aggressive: "I'd as soon give her a few more licks, but that's refusal by any fair count.",
};

/**
 * When he says the hole is making no footage: bails in a row from about the same bottom, and days
 * of it. Running sand slows a hole far more often than it stops one, and a driller knows it: most
 * such runs break through within a day or two. Measured over 635 holes in running sand
 * (tools/analysis/stall.harness.ts), of the runs still standing after 5 days, 36% broke through
 * later; after 6 days, 15%; after 7, 4%; after 10, none; and none that broke through after 5 days
 * went on to oil. So a good judge says so after about five days, a poor one after about eight,
 * and a hard driver a day later still. (Calibrated on the simulation; no period source puts a
 * number on it.)
 */
export const NO_HOLE = { bails: 8, days: 5, poorDays: 3, aggressiveDays: 1 } as const;
export function noHoleDays(a: Ability, t: Temperament): number {
  return NO_HOLE.days + NO_HOLE.poorDays * (1 - a.judgement) + (t === "aggressive" ? NO_HOLE.aggressiveDays : 0);
}

/** How many fishing jobs on one hole before he would rather plug it. */
const FISH_LIMIT: Record<Temperament, number> = { cautious: 2, economical: 2, methodical: 3, aggressive: 5 };

/**
 * His recommendation now, or null. `noise` (0–1, seeded per hole and depth) blurs how he
 * reads the hole: a poor judge is blurred more.
 */
export function assess(o: Observations, a: Ability, t: Temperament, noise: number, noise2: number): Advice | null {
  // A crushed string: a swaging job is slow and dear, and he says plainly it may not work.
  if (o.stuck && o.collapse) {
    const at = Math.round(o.collapse.atFt);
    if (o.cashCents < o.swageCents + 5 * o.dayCents) return { kind: "abandon", text: `The pipe is crushed at about ${at} ft, and there is not the money for a swaging job and the days it takes. I'd plug the hole.`, costCents: 0 };
    if (o.collapse.attempts >= SWAGE_LIMIT[t]) return { kind: "abandon", text: `${o.collapse.attempts} swaging job${o.collapse.attempts > 1 ? "s" : ""} and the pipe at ${at} ft is still shut. I would not throw more money after it: I'd plug the hole.`, costCents: 0 };
    return { kind: "fish", text: `The pipe has collapsed at about ${at} ft. A swage might open it out and let us on down inside, but it is days of work and no promise. ${o.collapse.attempts ? "The last one did not take." : "It is worth one try."}`, costCents: o.swageCents };
  }
  if (o.stuck) {
    if (o.cashCents < o.fishingCents + 3 * o.dayCents) return { kind: "abandon", text: `The tools are fast at ${Math.round(o.depthFt)} ft, and there is too little in hand for a fishing job and the days after it. I'd plug the hole.`, costCents: 0 };
    if (o.fishCount >= FISH_LIMIT[t]) return { kind: "abandon", text: `Fast again at ${Math.round(o.depthFt)} ft, after ${o.fishCount} fishing job${o.fishCount > 1 ? "s" : ""} on this hole. I would not throw more money after it: I'd plug it.`, costCents: 0 };
    return { kind: "fish", text: `The tools are fast at ${Math.round(o.depthFt)} ft. A fishing job is a fair chance of freeing them.`, costCents: o.fishingCents };
  }
  // Driving: he calls refusal (when, depends on his judgement and temper: see the rig), and says so.
  if (o.driving) {
    if (!o.driving.refused) return null;
    const made = o.driving.lastTwoHoursFt < 1 ? `${Math.max(1, Math.round(o.driving.lastTwoHoursFt * 12))} inches` : `${o.driving.lastTwoHoursFt.toFixed(1)} ft`;
    return { kind: "setdrive", text: `The ${o.driving.pipe} has about stopped: ${made} in the last two hours with the maul going steady, ${Math.round(o.driving.drivenFt)} ft driven. ${REFUSAL_WORDS[t]} Set it here at ${Math.round(o.driving.shoeFt)} ft.`, costCents: 0 };
  }
  // No footage: the hole is filling as fast as it is cleaned. A mechanical fact, not a guess about
  // the ground, so it comes before any talk of money. He never plugs it himself: he says what he
  // sees and what could still be tried, and asks.
  if (o.noHole.bails >= NO_HOLE.bails && o.noHole.days >= noHoleDays(a, t)) {
    const d = Math.round(o.depthFt), days = Math.floor(o.noHole.days);
    const sand = o.inflowFtHr >= 4 ? "the sand comes back in as fast as we bail it" : o.inflowFtHr >= 1.5 ? "sand keeps running back in" : "the hole fills as fast as we clean it";
    const left = o.stringsLeft > 0 && o.nextPipe
      ? `The ${o.nextPipe} could still be driven through it (about ${usd(o.nextDriveCents)}); without it, nothing I know of will make hole here.`
      : `Every size of pipe we have is in the hole already: there is nothing smaller to drive through it, and nothing I know of will make hole here.`;
    return { kind: "stalled", text: `We've bailed ${o.noHole.bails} times from ${d} ft in ${days === 1 ? "a day" : `${days} days`} and made no hole: ${sand}. ${left} Every day of it is wages for nothing. I'd plug it, unless you want something else tried.`, costCents: 0 };
  }
  const counsel = moneyConcern(o, a, t);
  if (counsel) return { kind: counsel.kind, text: counsel.text, costCents: 0 };
  // Sand that runs back in as fast as it is bailed: let-down pipe will hang in it. He knows it
  // by the bailer; a poor judge mistakes it either way.
  if (o.stringsLeft > 0 && o.nextPipe && o.openSandFt >= 10 && o.inflowFtHr > 3.6 + (noise2 - 0.5) * 4.4 * (1 - a.judgement)) {
    const head = o.driveHead ? "" : ", and for that we need a drive head and clamps";
    return { kind: "drive", text: `The sand comes back in as fast as we bail it: about ${Math.max(1, Math.round(o.inflowFtHr))} ft an hour, and it heaves when the tools move. It's running sand. Pipe let down won't go through it; it will hang. I'd drive the ${o.nextPipe} through it${head}.`, costCents: o.nextDriveCents };
  }
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
