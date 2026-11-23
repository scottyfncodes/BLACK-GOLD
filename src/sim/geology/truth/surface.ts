/**
 * Surface expression of the hidden geology: what is physically there to be noticed.
 * Still TRUTH (it says which signs exist, including ones nobody has seen). Only the sim reads
 * it: observation commands sample it into evidence, and the published map takes its most
 * prominent hills (sim/surface/print.ts).
 */
import { rngUnit } from "../../core/rng";
import { JEFFERSON_1890, projectKm } from "../../../content/geography/jefferson1890";
import { generateGeology, isCharged, type GeologyTruth } from "./model";

export type SignKind = "mound" | "gasSeep" | "sourSpring" | "paraffinDirt";

export interface SurfaceSign {
  id: string;
  kind: SignKind;
  x: number;
  y: number;
  /** 0–1: how pronounced the sign is. For a mound, relief in metres / 5. */
  strength: number;
  /** 0–1: how easily a walker notices it (marsh and scrub hide things). */
  visibility: number;
  /** For a mound: radius (km) and relief (m). */
  radius?: number;
  relief?: number;
  /** Marsh gas looks exactly like a petroleum seep to an 1890 eye. */
  falsePositive?: boolean;
}

const cache = new Map<string, SurfaceSign[]>();

export function surfaceSigns(t: GeologyTruth): SurfaceSign[] {
  const hit = cache.get(t.seed);
  if (hit) return hit;
  const u = (...k: (string | number)[]) => rngUnit(t.seed, "surface", ...k);
  const out: SurfaceSign[] = [];
  for (const d of t.domes) {
    if (d.relief > 0.4) {
      out.push({ id: `${d.id}:mound`, kind: "mound", x: d.x, y: d.y, strength: Math.min(1, d.relief / 5), visibility: 0.9, radius: d.saltR * 1.5, relief: d.relief });
    }
    // Sour (sulphur) springs come from cavernous caprock near the surface, charged or not.
    if (d.cavernous && d.crest < 480 && u(d.id, "spring") < 0.75) {
      const [x, y] = around(d.x, d.y, d.saltR * (0.4 + u(d.id, "springR") * 0.7), u(d.id, "springA"));
      out.push({ id: `${d.id}:spring`, kind: "sourSpring", x, y, strength: 0.4 + 0.5 * (1 - d.crest / 480), visibility: 0.7 });
    }
    // Gas seeps and paraffin dirt only leak from charged structures, and not always.
    if (isCharged(d) && d.crest < 620 && u(d.id, "seep") < 0.4 + 0.5 * d.charge.fill) {
      const n = 1 + Math.floor(u(d.id, "seepN") * 3);
      for (let k = 0; k < n; k++) {
        const [x, y] = around(d.x, d.y, d.saltR * (0.2 + u(d.id, "seepR", k) * 0.9), u(d.id, "seepA", k));
        out.push({ id: `${d.id}:seep${k}`, kind: "gasSeep", x, y, strength: Math.min(1, 0.25 + d.charge.fill * 0.6 * (1 - d.crest / 900)), visibility: 0.55 });
      }
    }
    if (isCharged(d) && !d.charge.gasProne && d.crest < 360 && u(d.id, "paraffin") < 0.6) {
      const [x, y] = around(d.x, d.y, d.saltR * 0.5, u(d.id, "parA"));
      out.push({ id: `${d.id}:paraffin`, kind: "paraffinDirt", x, y, strength: 0.5 + d.charge.fill * 0.4, visibility: 0.45 });
    }
  }
  // Marsh gas: bubbles in the southern marsh, unrelated to any structure.
  const marshN = 2 + Math.floor(u("marshN") * 3);
  for (let k = 0; k < marshN; k++) {
    const p = projectKm(JEFFERSON_1890, [29.94 + u("mlat", k) * 0.03, -94.2 + u("mlon", k) * 0.22]);
    out.push({ id: `marsh:${k}`, kind: "gasSeep", x: p.x, y: p.y, strength: 0.3 + u("ms", k) * 0.4, visibility: 0.6, falsePositive: true });
  }
  cache.set(t.seed, out);
  return out;
}

function around(cx: number, cy: number, r: number, a: number): [number, number] {
  const th = a * Math.PI * 2;
  return [cx + Math.cos(th) * r, cy + Math.sin(th) * r];
}

export const signsForSeed = (seed: string) => surfaceSigns(generateGeology(seed));
