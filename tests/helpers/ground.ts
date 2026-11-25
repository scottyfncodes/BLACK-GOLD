import { runningProfile, RUN_STEP_FT } from "../../src/sim/hidden/quicksand";

/**
 * Test ground without running sand above `toFt` (found with hidden truth, for tests only): for
 * tests about something else, so quicksand does not decide them. The quicksand tests pick the
 * opposite.
 */
export function noRunningSand(seed: string, x: number, y: number, toFt = 2500): boolean {
  const p = runningProfile(seed, x, y);
  for (let i = 0; i * RUN_STEP_FT < toFt && i < p.length; i++) if (p[i]! > 0.2) return false;
  return true;
}

/** The thickest run of strong running sand (strength over 0.35) above `toFt`, in ft, and where it starts. */
export function runningLens(seed: string, x: number, y: number, toFt = 2500): { ft: number; top: number } {
  const p = runningProfile(seed, x, y);
  let best = { ft: 0, top: -1 }, run = 0, top = -1;
  for (let i = 0; i * RUN_STEP_FT < toFt && i < p.length; i++) {
    if (p[i]! > 0.35) { if (!run) top = i * RUN_STEP_FT; run += RUN_STEP_FT; if (run > best.ft) best = { ft: run, top }; } else run = 0;
  }
  return best;
}
