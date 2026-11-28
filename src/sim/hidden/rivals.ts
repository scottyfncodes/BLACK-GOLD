/**
 * HIDDEN. What another operator's well finds: decided by the ground when it is spudded, and kept
 * here (in the hidden field) until the day it is known. Rival wells are resolved cheaply, a depth
 * and an outcome, not drilled tick by tick. They meet the same ground as the company: the first
 * oil or gas above the depth they can afford, or salt (where any driller stops), or nothing; and
 * some are lost to the hole, as the company's are. Only sim/ may import this (lint-enforced).
 */
import { generateGeology, columnAt } from "../geology/truth/model";
import { ftToM, mToFt } from "../math/units";

/** A rival well's fortunes (provisional): how deep it can afford to go, how often the hole is lost, how fast it is made. */
export const RIVAL = { minDepthFt: 1_400, extraDepthFt: 800, lossChance: 0.15, ftPerDay: 35, rigUpDays: 3 } as const;

export interface RivalOutcome {
  result: "oil" | "gas" | "dry";
  depthFt: number;
  days: number;
}

/** Resolve a rival well at (x, y), from three uniform draws (its purse, its luck with the hole, where it was lost). */
export function resolveRival(seed: string, x: number, y: number, purse: number, luck: number, lostAt: number): RivalOutcome {
  const maxFt = RIVAL.minDepthFt + RIVAL.extraDepthFt * purse;
  const col = columnAt(generateGeology(seed), x, y, Math.ceil(ftToM(maxFt)));
  const hc = col.find((iv) => iv.fluid === "oil" || iv.fluid === "gas");
  const salt = col.find((iv) => iv.lithology === "salt");
  let result: RivalOutcome["result"] = "dry";
  let depthFt = maxFt;
  if (hc && (!salt || hc.top < salt.top)) { result = hc.fluid === "oil" ? "oil" : "gas"; depthFt = mToFt(hc.top); }
  else if (salt) depthFt = Math.min(maxFt, mToFt(salt.top) + 20);
  if (luck < RIVAL.lossChance) { result = "dry"; depthFt = depthFt * (0.3 + 0.6 * lostAt); }
  depthFt = Math.round(depthFt);
  return { result, depthFt, days: Math.ceil(RIVAL.rigUpDays + depthFt / RIVAL.ftPerDay) };
}
