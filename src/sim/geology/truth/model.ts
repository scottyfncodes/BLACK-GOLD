/**
 * GEOLOGICAL TRUTH. Sealed: only sim/ may import this (lint-enforced). The renderer, UI and
 * app never see it; they see what the company has observed (sim/knowledge) and the published
 * map (sim/surface).
 *
 * Model (docs/DESIGN.md §4.1): a layer cake over the region, domed and pierced by salt stocks.
 * Truth is a pure function of the world seed and GEOLOGY_VERSION. It is regenerated on demand
 * and never stored in saves.
 *
 * Units: km in plan (x east, y south from the region's north-west corner), metres in depth.
 */
import { rngKey, rngUnit, type Seed } from "../../core/rng";
import { SURVEYS } from "../../../content/geography/surveys";

export const GEOLOGY_VERSION = 1;

export type Lithology = "clay" | "sand" | "gravel" | "caprock" | "salt";
export type Fluid = "none" | "water" | "sulphurWater" | "gas" | "oil";

export interface FormationDef {
  id: string;
  name: string;
  lithology: Lithology;
  /** Regional top (m) at the region's north-west corner, before dip. */
  top: number;
  /** Dip in metres of extra depth per km south and per km east. */
  dipS: number;
  dipE: number;
  /** Can hold oil or gas where trapped. */
  reservoir: boolean;
}

/** Gulf Coast shallow section near Beaumont, simplified. Deepest unit is open-ended. */
export const STACK: readonly FormationDef[] = [
  { id: "beaumont", name: "Beaumont clay", lithology: "clay", top: 0, dipS: 0, dipE: 0, reservoir: false },
  { id: "lissie", name: "Lissie sand and gravel", lithology: "gravel", top: 34, dipS: 0.6, dipE: 0.2, reservoir: false },
  { id: "willis", name: "Willis sand", lithology: "sand", top: 92, dipS: 1.4, dipE: 0.5, reservoir: true },
  { id: "fleming", name: "Fleming clay", lithology: "clay", top: 170, dipS: 3.2, dipE: 1.2, reservoir: false },
  { id: "oakville", name: "Oakville sand", lithology: "sand", top: 480, dipS: 6.5, dipE: 2.4, reservoir: true },
  { id: "frio", name: "Frio sands and clays", lithology: "sand", top: 640, dipS: 8.5, dipE: 3.1, reservoir: true },
];

export interface Charge {
  /** 0 = barren, 1 = filled to spill point. */
  fill: number;
  gasProne: boolean;
}

export interface Dome {
  id: string;
  x: number;
  y: number;
  /** Radius of the salt stock (km). */
  saltR: number;
  /** Radius of doming in the sediments around it (km). */
  upliftR: number;
  /** Depth (m) to the top of the caprock. */
  crest: number;
  capThickness: number;
  /** Cavernous caprock can hold oil and sulphur water; tight caprock cannot. */
  cavernous: boolean;
  /** Width (km) of the sealed flank annulus where sands are trapped against salt. */
  flankW: number;
  /** Surface relief in metres (the mound). */
  relief: number;
  charge: Charge;
}

export interface GeologyTruth {
  version: number;
  seed: Seed;
  domes: Dome[];
}

export const CHARGE_THRESHOLD = 0.2;
export const isCharged = (d: Dome): boolean => d.charge.fill >= CHARGE_THRESHOLD;

/** Region of interest for domes: the surveyed prairie, so every structure can be explored. */
function surveyedBox(): [number, number, number, number] {
  const xs = SURVEYS.flatMap((s) => s.poly.map((p) => p[0]));
  const ys = SURVEYS.flatMap((s) => s.poly.map((p) => p[1]));
  return [Math.min(...xs) + 0.8, Math.min(...ys) + 0.8, Math.max(...xs) - 0.8, Math.max(...ys) - 0.8];
}

const cache = new Map<Seed, GeologyTruth>();

export function generateGeology(seed: Seed): GeologyTruth {
  const hit = cache.get(seed);
  if (hit) return hit;
  const u = (...k: (string | number)[]) => rngUnit(seed, "geology", ...k);
  const [x0, y0, x1, y1] = surveyedBox();
  const count = 6 + (u("count") < 0.5 ? 0 : 1);
  const domes: Dome[] = [];
  for (let attempt = 0; domes.length < count && attempt < 400; attempt++) {
    const x = x0 + u("x", attempt) * (x1 - x0);
    const y = y0 + u("y", attempt) * (y1 - y0);
    if (!SURVEYS.some((s) => insideLoose(s.poly, x, y))) continue;
    if (domes.some((d) => Math.hypot(d.x - x, d.y - y) < 2.6)) continue;
    const i = domes.length;
    const saltR = 0.45 + u("saltR", i) * 0.6;
    const crest = 150 + u("crest", i) ** 1.2 * 650;
    // Shallow crests heave the prairie into a low mound; deep ones leave no mark.
    const relief = Math.max(0, 5.2 * Math.exp(-(crest - 150) / 190) * (0.75 + u("relief", i) * 0.5));
    // Charge: regional source maturity (smooth, richer to the south) × migration efficiency.
    const maturity = 0.45 + 0.4 * smooth(seed, x / 9, y / 9) + 0.15 * Math.min(1, y / 25);
    const efficiency = u("eff", i) ** 3.5;
    domes.push({
      id: `dome-${i}`,
      x, y, saltR,
      upliftR: saltR * (2.4 + u("upR", i) * 1.0),
      crest,
      capThickness: 25 + u("cap", i) * 110,
      cavernous: u("cav", i) < 0.6,
      flankW: 0.35 + u("flank", i) * 0.45,
      relief,
      charge: { fill: Math.min(1, maturity * efficiency), gasProne: u("gas", i) < 0.3 },
    });
  }
  const truth: GeologyTruth = { version: GEOLOGY_VERSION, seed, domes };
  cache.set(seed, truth);
  return truth;
}

function insideLoose(poly: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Smooth value noise in [0, 1] keyed on the seed (for regional fields). */
function smooth(seed: Seed, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a: number, b: number) => rngKey(seed, "geology:field", a, b) / 0x100000000;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  const ux = s(xf), uy = s(yf);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// ---------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------

const bump = (r: number, R: number) => Math.exp(-((r / R) ** 2));

/** Regional (undomed) top of formation i at (x, y). */
function regionalTop(i: number, x: number, y: number): number {
  const f = STACK[i]!;
  return f.top + f.dipS * y + f.dipE * x;
}

/** Top (m) of formation i at (x, y), domed by every salt stock nearby. */
export function formationTop(t: GeologyTruth, i: number, x: number, y: number): number {
  if (i === 0) return 0;
  let top = regionalTop(i, x, y);
  for (const d of t.domes) {
    const r = Math.hypot(x - d.x, y - d.y);
    if (r > d.upliftR * 2.5) continue;
    const base = regionalTop(i, d.x, d.y);
    // Beds deeper than the crest are dragged up toward it; shallower beds arch gently.
    const lift = base > d.crest ? (base - d.crest) * 0.62 : base * (0.18 + 0.4 * (d.crest < 300 ? 1 : 0.4));
    top -= lift * bump(r, d.upliftR);
  }
  // Keep the stack in order with a minimum thickness for each bed.
  const above = formationTop(t, i - 1, x, y);
  return Math.max(top, above + 4);
}

export interface DomeHit {
  dome: Dome;
  r: number;
}

function domeAt(t: GeologyTruth, x: number, y: number): DomeHit | undefined {
  for (const d of t.domes) {
    const r = Math.hypot(x - d.x, y - d.y);
    if (r < d.saltR) return { dome: d, r };
  }
  return undefined;
}

export interface RockAt {
  formation: string;
  name: string;
  lithology: Lithology;
  fluid: Fluid;
  /** Present when the rock is inside a trap (oil, gas, or the water leg of a trap). */
  trap?: TrapInfo;
}

export interface TrapInfo {
  kind: "caprock" | "flank";
  domeId: string;
  formation: string;
  /** Oil-water contact (m). Hydrocarbons only above it. */
  owc: number;
  /** Gas-oil contact (m) if a gas cap; else equal to the top of structure. */
  goc: number;
}

/** What rock and fluid is at (x, y, depth). The single truth query everything else builds on. */
export function rockAt(t: GeologyTruth, x: number, y: number, depth: number): RockAt {
  const hit = domeAt(t, x, y);
  if (hit && depth >= hit.dome.crest) {
    const d = hit.dome;
    if (depth < d.crest + d.capThickness) {
      const trap = caprockTrap(d);
      let fluid: Fluid = d.cavernous ? "sulphurWater" : "none";
      if (trap && depth < trap.owc) fluid = depth < trap.goc ? "gas" : "oil";
      return { formation: "caprock", name: "Caprock (gypsum, anhydrite, limestone)", lithology: "caprock", fluid, ...(trap ? { trap } : {}) };
    }
    return { formation: "salt", name: "Rock salt", lithology: "salt", fluid: "none" };
  }
  let i = 0;
  while (i + 1 < STACK.length && formationTop(t, i + 1, x, y) <= depth) i++;
  const f = STACK[i]!;
  const base: RockAt = { formation: f.id, name: f.name, lithology: f.lithology, fluid: f.lithology === "clay" ? "none" : "water" };
  if (!f.reservoir) return base;
  const trap = flankTrapAt(t, i, x, y);
  if (!trap) return base;
  if (depth < trap.owc) return { ...base, fluid: depth < trap.goc ? "gas" : "oil", trap };
  return { ...base, trap };
}

function caprockTrap(d: Dome): TrapInfo | undefined {
  if (!d.cavernous || !isCharged(d)) return undefined;
  const owc = d.crest + d.capThickness * Math.min(1, d.charge.fill);
  const goc = d.charge.gasProne ? d.crest + (owc - d.crest) * 0.3 : d.crest;
  return { kind: "caprock", domeId: d.id, formation: "caprock", owc, goc };
}

/** A flank trap: a reservoir sand sealed against the salt, closing within the flank annulus. */
export function flankTrapAt(t: GeologyTruth, i: number, x: number, y: number): TrapInfo | undefined {
  const f = STACK[i]!;
  if (!f.reservoir) return undefined;
  for (const d of t.domes) {
    if (!isCharged(d)) continue;
    const r = Math.hypot(x - d.x, y - d.y);
    if (r < d.saltR || r > d.saltR + d.flankW) continue;
    // Reservoir must lie below the crest (sealed by the dome's flank), not arched over it.
    const ux = (x - d.x) / (r || 1), uy = (y - d.y) / (r || 1);
    const inner = formationTop(t, i, d.x + ux * d.saltR, d.y + uy * d.saltR);
    const spill = formationTop(t, i, d.x + ux * (d.saltR + d.flankW), d.y + uy * (d.saltR + d.flankW));
    if (inner < d.crest || spill <= inner) continue;
    const owc = spill - (1 - d.charge.fill) * (spill - inner);
    const goc = d.charge.gasProne ? inner + (owc - inner) * 0.3 : inner;
    return { kind: "flank", domeId: d.id, formation: f.id, owc, goc };
  }
  return undefined;
}

export interface Interval {
  top: number;
  base: number;
  formation: string;
  name: string;
  lithology: Lithology;
  fluid: Fluid;
}

/** The true column at (x, y) from surface to `maxDepth`, sampled every metre and merged. */
export function columnAt(t: GeologyTruth, x: number, y: number, maxDepth: number): Interval[] {
  const out: Interval[] = [];
  for (let z = 0; z < maxDepth; z += 1) {
    const r = rockAt(t, x, y, z + 0.5);
    const last = out[out.length - 1];
    if (last && last.formation === r.formation && last.fluid === r.fluid) last.base = z + 1;
    else out.push({ top: z, base: z + 1, formation: r.formation, name: r.name, lithology: r.lithology, fluid: r.fluid });
  }
  return out;
}

/** The shallowest oil anywhere in the dome's traps, or undefined (for balance tests and the dev view). */
export function shallowestOil(t: GeologyTruth, d: Dome): number | undefined {
  if (!isCharged(d)) return undefined;
  const cap = caprockTrap(d);
  let best = cap && cap.owc > cap.goc ? cap.goc : undefined;
  for (let i = 0; i < STACK.length; i++) {
    if (!STACK[i]!.reservoir) continue;
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * Math.PI * 2, r = d.saltR + 0.02;
      const x = d.x + Math.cos(th) * r, y = d.y + Math.sin(th) * r;
      const trap = flankTrapAt(t, i, x, y);
      if (!trap) continue;
      const top = formationTop(t, i, x, y);
      if (top < trap.owc) best = Math.min(best ?? Infinity, Math.max(top, trap.goc));
    }
  }
  return best;
}
