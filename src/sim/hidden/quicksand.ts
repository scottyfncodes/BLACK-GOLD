/**
 * Running sand ("quicksand", as the drillers called the Beaumont sands). HIDDEN: sealed from ui/,
 * render/ and app/ like geological truth (eslint.config.js).
 *
 * A pure function of the seed and the place, never saved. The company learns it only as
 * evidence: sand that comes back into the hole as fast as it is bailed, sand heaving up when the
 * tools move, pipe that hangs up, and how driven pipe goes down.
 *
 * Strength 0–1: 0 is ordinary sand that stands or caves slowly; 1 is sand that flows like
 * water. It is found in water-bearing sands and gravels, chiefly the shallow Lissie gravels and
 * Willis sands, in lenses tens of feet to a hundred or more feet thick, patchy from place to
 * place. The lens and patch scales are provisional gameplay values; the phenomenon is
 * documented (USGS Bulletin 212, 1903; Isler, Well-Boring, 1902; docs/research).
 */
import { rngUnit } from "../core/rng";
import { ftToM } from "../math/units";
import { generateGeology, rockAt } from "../geology/truth/model";

/** Profile resolution (ft) and depth (ft). */
export const RUN_STEP_FT = 5;
const MAX_FT = 2500;
/** How readily each formation runs where it does (provisional). */
const BASE: Readonly<Record<string, number>> = { lissie: 0.55, willis: 0.95, oakville: 0.4, frio: 0.25 };
/** Patch size across the country (km) and lens spacing down the hole (ft) (provisional). */
const PATCH_KM = 1.6;
const LENS_FT = 45;

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Smooth value noise over the map for a formation (0–1). */
function patch(seed: string, f: string, x: number, y: number): number {
  const gx = x / PATCH_KM, gy = y / PATCH_KM;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = smooth(gx - ix), fy = smooth(gy - iy);
  const v = (i: number, j: number) => rngUnit(seed, "quicksand", "patch", f, ix + i, iy + j);
  return (v(0, 0) * (1 - fx) + v(1, 0) * fx) * (1 - fy) + (v(0, 1) * (1 - fx) + v(1, 1) * fx) * fy;
}

/** Smooth value noise down the hole: where the running lenses lie (0–1). */
function lens(seed: string, f: string, x: number, y: number, ft: number): number {
  const cx = Math.floor(x / PATCH_KM), cy = Math.floor(y / PATCH_KM);
  const g = ft / LENS_FT, k = Math.floor(g), t = smooth(g - k);
  const v = (i: number) => rngUnit(seed, "quicksand", "lens", f, cx, cy, k + i);
  return v(0) * (1 - t) + v(1) * t;
}

const cache = new Map<string, Float32Array>();

/** Running strength at every 5 ft of a hole at (x, y), to 2,500 ft. Memoized; never stored. */
export function runningProfile(seed: string, x: number, y: number): Float32Array {
  const key = `${seed}|${x.toFixed(4)}|${y.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = generateGeology(seed);
  const out = new Float32Array(Math.ceil(MAX_FT / RUN_STEP_FT) + 1);
  for (let i = 0; i < out.length; i++) {
    const ft = i * RUN_STEP_FT + RUN_STEP_FT / 2;
    const r = rockAt(t, x, y, ftToM(ft));
    const base = BASE[r.formation] ?? 0;
    if (!base || (r.lithology !== "sand" && r.lithology !== "gravel") || r.fluid === "oil" || r.fluid === "gas") continue;
    const p = clamp01((patch(seed, r.formation, x, y) - 0.35) / 0.45);
    const l = clamp01((lens(seed, r.formation, x, y, ft) - 0.3) / 0.4);
    out[i] = base * p * l;
  }
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}

/** Running strength at a depth (ft). */
export function runningAt(seed: string, x: number, y: number, ft: number): number {
  return runningProfile(seed, x, y)[Math.max(0, Math.floor(ft / RUN_STEP_FT))] ?? 0;
}

/**
 * Running sand standing open between two depths: total strength-feet (Σ strength × 5 ft) and the
 * strongest lens. What the hole feels; the company sees only its effects.
 */
export function openRunning(seed: string, x: number, y: number, fromFt: number, toFt: number): { ft: number; peak: number; top: number | null } {
  const prof = runningProfile(seed, x, y);
  let ft = 0, peak = 0, top: number | null = null;
  for (let i = Math.max(0, Math.floor(fromFt / RUN_STEP_FT)); i * RUN_STEP_FT < toFt && i < prof.length; i++) {
    const s = prof[i]!;
    if (s <= 0) continue;
    ft += s * RUN_STEP_FT;
    peak = Math.max(peak, s);
    if (top === null && s > 0.35) top = Math.max(fromFt, i * RUN_STEP_FT);
  }
  return { ft, peak, top };
}

/**
 * How badly a collapsed string is crushed (0–1). A pure function of the hole and the collapse;
 * above about three quarters nothing will open it again.
 */
export function collapseSeverity(seed: string, wellId: string, atFt: number, running: number): number {
  return clamp01(0.25 + 0.5 * rngUnit(seed, "quicksand", "collapse", wellId, Math.round(atFt)) + 0.35 * running + atFt / 4000);
}
