/**
 * The company's operations as the player sees them: money and the well being drilled.
 * Everything here is observable on the rig floor (depth, cuttings, how the line feels, how
 * fast the bit is cutting). Nothing here is geological truth; rock type is known only from
 * bailed samples (knowledge). Imports no truth.
 */
import type { WorldState } from "./core/engine";
import type { GameTime } from "./core/time";
import type { AccountEvidence, ReadingEvidence, SampleEvidence, WellRecordEvidence } from "./knowledge/types";
import { cashCents, debtCents, type Ledger } from "./company/ledger";
import type { LeaseBook } from "./company/leases";
import type { ProductionBook } from "./company/production";
import { RIG_BOOK, type BankState } from "./company/bank";
import { oilPriceCents } from "./company/production";
import type { CasingString, DriveJob } from "./company/casing";
import { dayRateCents, type Crew } from "./company/crew";
import type { FieldState } from "./hidden/reservoir";
import type { RushState } from "./rush/types";

export type WellStatus = "rigging" | "drilling" | "stuck" | "gusher" | "dry";
export type Operation = "rigup" | "bail" | "dress" | "case" | "fish" | "drive" | "swage";

export interface Well {
  id: string;
  name: string;
  x: number;
  y: number;
  surveyId: string;
  spudAt: GameTime;
  status: WellStatus;
  /** Depth of the hole (ft). */
  depthFt: number;
  /** How far the temper screw has let the tools down (ft). Ideal: just past bottom. */
  reachFt: number;
  /** Cuttings in the hole above the bit (ft). Cushions every blow. */
  fillFt: number;
  /** 1 = freshly dressed bit, 0 = blunt. */
  sharp: number;
  /** Casing set to this depth (ft): the deepest shoe. */
  casedFt: number;
  /** The strings in the hole, largest first (at most three). */
  strings: CasingString[];
  /** Sand working in beneath a shoe seated in sand (ft of open sand it is equivalent to). */
  leakFt: number;
  /** Where the hole made water as it was drilled (top, base in ft): what the crew saw, nothing deeper. */
  waterFt: [number, number][];
  /** Fishing jobs run on this hole. */
  fishCount: number;
  /** The company's driller in charge of this well (his record answers for it). */
  driller: string;
  /** The rig is pulling this hole's casing until then. */
  pullingUntil?: number | null;
  /** Drive pipe going down, if any. */
  drive?: DriveJob | null;
  /** A string has collapsed in the hole: about where, and how many swaging jobs have been tried. */
  collapse?: { atFt: number; attempts: number } | null;
  /** Sand the bailer brought up beyond the cuttings, per hour since the bail before (ft/hour): what the crew sees of sand running in. */
  lastInflow?: number;
  /** When the hole was last bailed, and the sand come in since (ft). */
  lastBailAt?: number;
  sandInFt?: number;
  /** Feet of uncased sand open to the hole. Sands heave in. */
  openSandFt: number;
  feeding: boolean;
  auto: boolean;
  /** An operation in progress, and when it ends. */
  busy: { op: Operation; until: GameTime } | null;
  lastBailFt: number;
  /** Penetration last tick (ft/hour) and how squarely the bit struck (0–1): the driller's "feel". */
  rop: number;
  contact: number;
  /** Why the well ended, in words. */
  outcome?: string;
  /** Rig ticks in a row with nobody working: no hole made by hand, or stuck tools left waiting. */
  idleTicks: number;
  /** The low-money warning has been given for this well. */
  lowFundsWarned: boolean;
}

/** A month's contract drilling for another operator, with the company's own rig. */
export interface Contract {
  until: number;
}

/** How the campaign has gone: its first producing well, and whether it has ended. */
export interface CampaignOutcome {
  firstOilAt: number | null;
  firstOilWell: string | null;
  endedAt: number | null;
  ended: "bankrupt" | null;
}

export const emptyOutcome = (): CampaignOutcome => ({ firstOilAt: null, firstOilWell: null, endedAt: null, ended: null });

export interface OperationsState {
  /** The company's books: the only record of money (see company/ledger.ts). */
  ledger: Ledger;
  /** Rig time run today and not yet entered in the books (posted at midnight). */
  accrued: { ticks: number };
  /** The company's land: leases taken, lapsed or released. */
  leases: LeaseBook;
  /** Capped oil wells selling their oil. */
  production: ProductionBook;
  /** The bank: interest accrued, warnings, lien, and whether the company owns a rig. */
  bank: BankState;
  /** The rig is out on contract to another operator. */
  contract: Contract | null;
  /** The company's driller, the men it might hire, his standing orders and his advice. */
  crew: Crew;
  /** Tools the company owns besides the rig: the drive head and clamps for driving pipe. */
  tools: { driveHead: boolean };
  outcome: CampaignOutcome;
  well: Well | null;
  /** Earlier wells (finished). */
  past: Well[];
  samples: SampleEvidence[];
  /**
   * What the company knows that bears on its holes, kept where its driller can read it: the
   * geologist's readings and settlers' accounts (told him as they come in), and the accounts of
   * the company's own ended holes.
   */
  notebook: (ReadingEvidence | WellRecordEvidence | AccountEvidence)[];
  /** HIDDEN: the oil in the ground as it is drawn (sim/hidden/reservoir.ts). Never in the view. */
  field: FieldState;
  /** The Rush: other operators' wells and leases, as Beaumont knows them (public). */
  rush: RushState;
  next: number;
}

export const STARTING_CASH = 1500;
/** The rig and tools the company starts with, carried in the books at this value (see company/bank.ts). */
export const RIG_VALUE = RIG_BOOK;
export const COSTS = { rigUp: 350, fishing: 60 } as const;

export interface OperationsView {
  /** Cash in hand (dollars), from the books, less rig time not yet entered. */
  cash: number;
  /** Owed to the bank (dollars). */
  debt: number;
  ledger: Ledger;
  leases: LeaseBook;
  production: ProductionBook;
  bank: BankState;
  contract: Contract | null;
  outcome: CampaignOutcome;
  crew: Crew;
  tools: { driveHead: boolean };
  /** What a day of rig time costs now: the crew and the driller's wage (dollars). */
  dayRate: number;
  /** This year's price of a barrel of crude at the railhead (cents). */
  oilPriceCents: number;
  well: Well | null;
  past: Well[];
  /** Other operators in the field: their wells and leases as Beaumont knows them. */
  rush: RushState;
}

/** Rig time accrued today, in cents (whole cents, rounded once). */
export function accruedCents(o: OperationsState): number {
  return Math.round((dayRateCents(o.crew) * o.accrued.ticks) / 288);
}

export function operationsOf(world: Readonly<WorldState>): OperationsView {
  const o = world.systems.operations as unknown as OperationsState;
  return { cash: (cashCents(o.ledger) - accruedCents(o)) / 100, debt: debtCents(o.ledger) / 100, ledger: o.ledger, leases: o.leases, production: o.production, bank: o.bank, contract: o.contract, outcome: o.outcome, crew: o.crew, tools: o.tools, dayRate: dayRateCents(o.crew) / 100, oilPriceCents: oilPriceCents(world.time), well: o.well, past: o.past, rush: o.rush };
}

/** Samples are evidence like any other; they join the knowledge view. */
export function samplesOf(world: Readonly<WorldState>): SampleEvidence[] {
  return (world.systems.operations as unknown as OperationsState).samples;
}
