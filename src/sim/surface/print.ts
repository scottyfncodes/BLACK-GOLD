/**
 * The published map: what any buyer of the 1890 county survey could see. This is the only
 * path from the generated world to the renderer's print layer, and it carries surface facts
 * only: hills prominent enough to be named (≥ 10 ft) and the settlers' well-houses.
 * Lesser rises, springs, seeps and everything underground must be found by observation.
 */
import { generateGeology, type GeologyTruth } from "../geology/truth/model";
import { surfaceSigns } from "../geology/truth/surface";
import { waterWells } from "../geology/truth/waterWells";
import { mToFt } from "../math/units";

export interface PrintedHill {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Plan radius (km). */
  radius: number;
  reliefFt: number;
}

export interface PrintedWell {
  id: string;
  x: number;
  y: number;
  owner: string;
}

export interface PrintedMap {
  hills: PrintedHill[];
  wells: PrintedWell[];
}

/** Minimum relief for a hill to appear on the published survey. */
export const PRINT_RELIEF_FT = 10;

const cache = new Map<string, PrintedMap>();

export function printedMap(seed: string): PrintedMap {
  const hit = cache.get(seed);
  if (hit) return hit;
  const out = buildPrintedMap(generateGeology(seed));
  cache.set(seed, out);
  return out;
}

/** Uncached, from an explicit truth (tests use it to prove the print carries nothing hidden). */
export function buildPrintedMap(t: GeologyTruth, signs = surfaceSigns(t)): PrintedMap {
  const mounds = signs
    .filter((s) => s.kind === "mound" && mToFt(s.relief ?? 0) >= PRINT_RELIEF_FT)
    .sort((a, b) => (b.relief ?? 0) - (a.relief ?? 0));
  const names = ["Big Hill", "Gum Mound", "Round Hill"];
  const hills = mounds.map((m, i) => ({
    id: `hill-${i}`,
    name: names[i] ?? "the Mound",
    x: m.x,
    y: m.y,
    radius: m.radius ?? 1,
    // Surveyors rounded to the nearest 5 ft.
    reliefFt: Math.round(mToFt(m.relief ?? 0) / 5) * 5,
  }));
  const wells = waterWells(t).map((w) => ({ id: w.id, x: w.x, y: w.y, owner: w.owner }));
  return { hills, wells };
}
