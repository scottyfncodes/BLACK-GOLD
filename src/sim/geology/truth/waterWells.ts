/**
 * Settlers' water wells drilled before 1890: real holes in the ground with true logs.
 * Their positions are visible to anyone (a windmill or a well-house); their logs are truth
 * until someone asks the owner, and then only as the owner remembers them (sim/knowledge).
 */
import { rngUnit } from "../../core/rng";
import { SURVEYS, centroid } from "../../../content/geography/surveys";
import { columnAt, type GeologyTruth, type Interval } from "./model";

export interface WaterWell {
  id: string;
  x: number;
  y: number;
  owner: string;
  year: number;
  depth: number;
  log: Interval[];
}

const SETTLERS = ["Gilbert", "Hebert", "McKinley", "Broussard", "Sutton", "Dugat", "Pipkin", "Lanier", "Gauthier", "Ware", "Spurlock", "Moye"];
const cache = new Map<string, WaterWell[]>();

export function waterWells(t: GeologyTruth): WaterWell[] {
  const hit = cache.get(t.seed);
  if (hit) return hit;
  const u = (...k: (string | number)[]) => rngUnit(t.seed, "wells", ...k);
  const n = 9 + Math.floor(u("n") * 4);
  const out: WaterWell[] = [];
  for (let i = 0; i < n; i++) {
    const s = SURVEYS[Math.floor(u("survey", i) * SURVEYS.length)]!;
    const [cx, cy] = centroid(s.poly);
    const x = cx + (u("dx", i) - 0.5) * 0.6, y = cy + (u("dy", i) - 0.5) * 0.6;
    // Drilled until they found a good water sand, or gave up.
    const depth = Math.round(40 + u("depth", i) ** 1.3 * 140);
    out.push({ id: `well-${i}`, x, y, owner: SETTLERS[i % SETTLERS.length]!, year: 1874 + Math.floor(u("year", i) * 15), depth, log: columnAt(t, x, y, depth) });
  }
  cache.set(t.seed, out);
  return out;
}
