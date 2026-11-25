/**
 * A driller's true ability. HIDDEN: sealed from ui/, render/ and app/ like geological truth
 * (eslint.config.js). The player learns a man only from what he says and does, and from his
 * record across wells; never from these numbers.
 *
 * Ability is a pure function of the world seed and the driller's id, so it is never stored in
 * a save and cannot leak through the state the UI reads.
 */
import { rngUnit } from "../core/rng";

export interface Ability {
  /** Rhythm and speed on the temper screw: how squarely he keeps the tools striking. */
  feel: number;
  /** Reading the hole: when to bail, dress, case, fish or quit, and where to seat pipe. */
  judgement: number;
  /** Steadiness: how seldom he lapses (a slack line, a careless hour). */
  reliability: number;
  /**
   * Prudence with money: how readily he speaks up when a hole is eating the company's capital.
   * Independent of the three above: a fine hand on the line may be reckless with a purse.
   */
  prudence: number;
}

/** The company's first driller is an ordinary hand: neither green nor gifted. */
const STARTING = { lo: 0.42, hi: 0.6 };
const HIRED = { lo: 0.15, hi: 0.95 };

export function abilityOf(seed: string, id: string): Ability {
  const band = id === "d0" ? STARTING : HIRED;
  const pick = (trait: string) => band.lo + (band.hi - band.lo) * rngUnit(seed, "driller", id, trait);
  return { feel: pick("feel"), judgement: pick("judgement"), reliability: pick("reliability"), prudence: pick("prudence") };
}
