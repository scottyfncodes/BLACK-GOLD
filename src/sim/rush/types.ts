/**
 * The Rush (M8b): other operators come when oil comes in, and their wells are part of the world.
 * Everything here is public: what anyone in Beaumont could see or hear. A rival's derrick going
 * up, its well coming in or being abandoned, its leases. A rival well's outcome is hidden until
 * it is known (sim/hidden/rivals.ts keeps it); this state only ever holds what has happened.
 * Imports no truth.
 */
import type { GameTime } from "../core/time";

export type RivalStatus = "drilling" | "oil" | "gas" | "dry";

export interface RivalWell {
  id: string;
  /** "The Gulf Coast Oil Co.'s No. 2" */
  name: string;
  operator: string;
  surveyId: string;
  x: number;
  y: number;
  spudAt: GameTime;
  /** When it is known to have finished (public once reached). */
  doneAt: GameTime;
  status: RivalStatus;
  /** The depth it ended at, once known. */
  depthFt: number | null;
}

export interface RivalLease {
  surveyId: string;
  operator: string;
  since: GameTime;
  until: GameTime;
}

export interface RushState {
  wells: RivalWell[];
  leases: RivalLease[];
  /** Names of the operators that have come, in order of arrival. */
  operators: string[];
  /** Barrels the other operators sent to the railhead this month and last (public: Beaumont's shipments). */
  monthOthersBbl: number;
  lastMonthOthersBbl: number;
  next: number;
}

export const emptyRush = (): RushState => ({ wells: [], leases: [], operators: [], monthOthersBbl: 0, lastMonthOthersBbl: 0, next: 1 });

/** A public strike or dry hole, as Beaumont hears of it: the company's or another operator's. */
export interface PublicWell {
  x: number;
  y: number;
  t: GameTime;
  result: "oil" | "gas" | "dry";
  depthFt: number;
}

/** Who holds a survey's lease now, if anyone other than the company. */
export function rivalHolder(rush: RushState, surveyId: string, now: GameTime): RivalLease | undefined {
  return rush.leases.find((l) => l.surveyId === surveyId && l.until > now);
}
