/**
 * The company's operations as the player sees them: money and the well being drilled.
 * Everything here is observable on the rig floor (depth, cuttings, how the line feels, how
 * fast the bit is cutting). Nothing here is geological truth; rock type is known only from
 * bailed samples (knowledge). Imports no truth.
 */
import type { WorldState } from "./core/engine";
import type { GameTime } from "./core/time";
import type { SampleEvidence } from "./knowledge/types";

export type WellStatus = "rigging" | "drilling" | "stuck" | "gusher" | "dry";
export type Operation = "rigup" | "bail" | "dress" | "case" | "fish";

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
  /** Casing set to this depth (ft). */
  casedFt: number;
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
}

export interface OperationsState {
  cash: number;
  well: Well | null;
  /** Earlier wells (finished). */
  past: Well[];
  samples: SampleEvidence[];
  next: number;
}

export const STARTING_CASH = 1500;
export const COSTS = { rigUp: 350, perDay: 12, casingPerFt: 1.1, fishing: 60 } as const;

export interface OperationsView {
  cash: number;
  well: Well | null;
  past: Well[];
}

export function operationsOf(world: Readonly<WorldState>): OperationsView {
  const o = world.systems.operations as unknown as OperationsState;
  return { cash: o.cash, well: o.well, past: o.past };
}

/** Samples are evidence like any other; they join the knowledge view. */
export function samplesOf(world: Readonly<WorldState>): SampleEvidence[] {
  return (world.systems.operations as unknown as OperationsState).samples;
}
