/**
 * Casing: up to three telescoping strings of pipe, each run from the surface to where it is
 * set, each smaller than the last (docs/DESIGN.md §8, "Casing and hired drillers").
 *
 * Two jobs are kept apart:
 *  - mechanical stabilization: any string holds up the walls above its shoe;
 *  - hydraulic isolation: only a string landed in an impermeable bed shuts off water.
 * What a string seals is decided by the ground at its shoe (sim/hidden/casing.ts); what the
 * company knows of it is only what the bailer and the hole have shown. This module holds the
 * public side. Imports no truth.
 *
 * PROVISIONAL: pipe sizes, prices, salvage fractions and the time to run and pull pipe are
 * gameplay abstractions, not verified 1890s figures.
 */

export interface PipeSize {
  name: string;
  /** Dollars per foot, in cents (provisional). */
  centsPerFt: number;
}

/** The three strings, largest first. Three is a maximum, not a program. */
export const PIPE: readonly PipeSize[] = [
  { name: "10-inch", centsPerFt: 50 },
  { name: "8¼-inch", centsPerFt: 35 },
  { name: "6⅝-inch", centsPerFt: 22 },
];
export const MAX_STRINGS = PIPE.length;
/** A new string must reach at least this far below the last shoe to be worth running. */
export const MIN_STRING_FT = 20;

/** What the crew has seen of a string since it was set. */
export type StringObserved =
  /** Not yet tested: the next bail will tell. */
  | "pending"
  /** The hole bails dry above the shoe: the water behind the pipe is shut off. */
  | "dry"
  /** Water still comes into the hole: the pipe steadies the walls but does not shut it off. */
  | "water"
  /** Sand keeps working in beneath the shoe. */
  | "sand";

export interface CasingString {
  /** Index into PIPE. */
  size: number;
  seatFt: number;
  costCents: number;
  setAt: number;
  /** The rock at the shoe as the bailer last described it, or null when that depth was never bailed. */
  seatCall: string | null;
  observed: StringObserved;
  /** Pulled from a dead hole and sold. */
  pulled: boolean;
  /** How it went in: let down into the hole ("run", the default) or driven with the maul. */
  method?: "run" | "driven";
  /** Feet of it driven, for drive pipe. */
  drivenFt?: number;
  /** Let-down pipe that hung up in the hole short of bottom. */
  hung?: boolean;
  /** Harm done to it: a joint parted under the maul, or the pipe collapsed in the hole. */
  damage?: "parted" | "collapsed" | null;
}

/**
 * Driving pipe (docs/DESIGN.md §8, "Driven casing through quicksand"). Heavy drive pipe is
 * driven down with the rig's maul on a drive head, a steel shoe on the bottom joint, the bit
 * clearing the sand inside it. Documented practice (Isler 1902; Whiteshot 1905); the prices and
 * rates below are PROVISIONAL gameplay values.
 */
export const DRIVE = {
  /** Drive pipe costs this many times ordinary casing per foot (approved; provisional). */
  priceFactor: 1.6,
  /** The drive head and clamps: reusable equipment, bought once (cents; provisional). */
  headCents: 4_000,
  /** A steel drive shoe for each driven string, by size (cents; provisional): consumed with the string. */
  shoeCents: [600, 500, 400] as readonly number[],
  /** A collapsed string: a swaging and fishing job (cents and days; provisional). */
  swageCents: 15_000,
  swageDays: 4,
  /** After this many failed attempts there is nothing left to take hold of. */
  swageAttempts: 3,
} as const;

/** Drive pipe from the surface to `shoeFt`, with its shoe (cents). */
export const drivePipeCents = (size: number, shoeFt: number) =>
  Math.round(Math.max(0, shoeFt) * PIPE[size]!.centsPerFt * DRIVE.priceFactor) + DRIVE.shoeCents[size]!;

/** Pipe being driven: where its shoe is, how far it has gone, and how it has been going. */
export interface DriveJob {
  size: number;
  /** Where the shoe started from (ft): where the pipe stood when driving began. */
  startFt: number;
  shoeFt: number;
  drivenFt: number;
  /** The shoe's depth each hour of driving, latest last (a short log, as the driller keeps it). */
  log: { t: number; ft: number }[];
  /** The driller has called refusal: the pipe has all but stopped. */
  refused: boolean;
  /** Told to drive on past refusal. */
  pounding: boolean;
  /** The best two hours of going the pipe has made: the driller judges refusal against it. */
  peak?: number;
  /** What was paid for the pipe brought out (cents): pipe for about 100 ft of driving, and the shoe. */
  paidCents: number;
}

/** Drive pipe is bought for this much driving below where it stands; unused joints go back to the supply house. */
export const DRIVE_ALLOWANCE_FT = 100;

export const stringCostCents = (size: number, seatFt: number) => Math.round(Math.max(0, seatFt) * PIPE[size]!.centsPerFt);

/** Pulling casing from a dead hole (provisional): rig days, and the share of the pipe's cost recovered. */
export const SALVAGE = {
  /** Days of rig time per string, plus a day per this many feet of pipe. */
  daysPerString: 1,
  feetPerDay: 700,
  /** Pipe from a sealed seat comes out clean; pipe seated in sand is gripped and battered. */
  sealedFraction: 0.5,
  sandFraction: 0.3,
  /** Driven pipe is held fast by the sand it was driven through; damaged pipe is junk. */
  drivenFraction: 0.1,
} as const;

/** What pulling a string can be expected to fetch, from what the crew has seen of it. */
export const salvageFraction = (s: CasingString) =>
  s.damage ? 0 : s.method === "driven" ? SALVAGE.drivenFraction : s.observed === "dry" ? SALVAGE.sealedFraction : SALVAGE.sandFraction;

/** Rig days to pull every string still in a hole. */
export function pullDays(strings: readonly CasingString[]): number {
  const left = strings.filter((s) => !s.pulled);
  if (!left.length) return 0;
  return left.length * SALVAGE.daysPerString + Math.ceil(left.reduce((a, s) => a + s.seatFt, 0) / SALVAGE.feetPerDay);
}

/** The share of oil that comes up as water when water sands above the pay were never shut off (provisional). */
export function waterCut(unisolatedSands: number): number {
  return unisolatedSands <= 0 ? 0 : unisolatedSands === 1 ? 0.35 : 0.55;
}
