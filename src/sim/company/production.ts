/**
 * Minimal production (a slice of DESIGN §4.4, not M4): enough to close the economic loop.
 *
 * A capped oil well flows each day. What it can sell is limited by what teamsters can haul to
 * the railhead at Beaumont; its own capacity falls as the trap it drains is depleted (wells in
 * one trap share the depletion). Sales post once a month: oil sold, hauling, and the
 * landowner's royalty. All money in whole cents; all barrels in whole barrels.
 *
 * Gas has no market in 1890: a gas well cannot be capped for sale. Imports no truth; the system
 * that owns this state supplies each well's capacity from the ground.
 */
import type { GameTime } from "../core/time";

/** Railhead price and wagon hauling, per barrel, in cents. */
export const OIL_PRICE_CENTS = 60;
export const HAULING_CENTS = 20;
/** What the teamsters can carry from one well in a day (bbl). */
export const HAUL_LIMIT_BBL = 150;
export const CAP_COST = 80;

export interface Producer {
  wellId: string;
  name: string;
  surveyId: string;
  x: number;
  y: number;
  since: GameTime;
  /** Opaque key of the reservoir drained (wells in one trap share depletion). */
  trap: string;
  /** Flowing capacity when first capped (bbl/day), and the trap's recoverable oil (bbl). */
  initialBbl: number;
  reserveBbl: number;
  /** Barrels produced in total, and since the last monthly sale. */
  cumBbl: number;
  monthBbl: number;
  /** Most recent day's barrels (for the notes). */
  lastDayBbl: number;
}

export interface ProductionBook {
  producers: Producer[];
  /** Barrels drawn from each trap by all the company's wells. */
  drawn: Record<string, number>;
}

export const emptyProductionBook = (): ProductionBook => ({ producers: [], drawn: {} });

/** One day's barrels for a producer: its depleting capacity, capped by what can be hauled. */
export function dayBarrels(p: Producer, drawnFromTrap: number): number {
  // Integer arithmetic: capacity falls in proportion to the oil left in the trap.
  const left = Math.max(0, p.reserveBbl - drawnFromTrap);
  return Math.min(HAUL_LIMIT_BBL, Math.floor((p.initialBbl * left) / p.reserveBbl));
}
