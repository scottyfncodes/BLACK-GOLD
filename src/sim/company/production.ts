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
import { toCalendar, type GameTime } from "../core/time";

/**
 * Crude oil, cents per 42-gallon barrel, by calendar year: the US average first-purchase price
 * (US Energy Information Administration, series F000000__3, annual; verified November 2026).
 * The company is paid the year's price at the railhead. Before the first year and after the
 * last, the nearest year's price holds. A Gulf Coast discount is not applied: none is
 * documented for these years (Corsicana's 50¢ contract of 1897–98 is the nearest evidence).
 */
export const OIL_PRICES: Readonly<Record<number, number>> = {
  1890: 77, 1891: 56, 1892: 51, 1893: 60, 1894: 72, 1895: 109, 1896: 96, 1897: 68, 1898: 80, 1899: 113,
  1900: 119, 1901: 96, 1902: 80, 1903: 94, 1904: 86, 1905: 62,
};
const PRICE_YEARS = Object.keys(OIL_PRICES).map(Number);
const FIRST_PRICE_YEAR = Math.min(...PRICE_YEARS), LAST_PRICE_YEAR = Math.max(...PRICE_YEARS);

/** The price of a barrel at the railhead at time `t` (cents). */
export function oilPriceCents(t: GameTime): number {
  const y = Math.min(LAST_PRICE_YEAR, Math.max(FIRST_PRICE_YEAR, toCalendar(Math.max(0, t)).year));
  return OIL_PRICES[y]!;
}

/** Wagon hauling to the railhead, per barrel, in cents (provisional). */
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
  /** Most recent day's barrels of oil sold (for the notes). */
  lastDayBbl: number;
  /** The share of what flows that is water from sands above the pay never shut off (0 when sealed). */
  waterCut: number;
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
