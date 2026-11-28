/**
 * What the other operators decide, and on what: only public facts. A strike draws them, the
 * nearer the better; a run of dry holes around it cools them; the county's printed hills catch
 * their eye; they offset the wells they hear of and avoid ground already leased or drilled.
 * They never see the ground below: lint forbids this module any truth (eslint.config.js), and
 * a rival's well finds whatever is there only when it is drilled (sim/hidden/rivals.ts).
 * Imports no truth.
 */
import { SURVEYS, insidePoly } from "../../content/geography/surveys";
import type { PrintedMap } from "../surface/print";
import { MINUTES_PER_DAY, type GameTime } from "../core/time";
import type { PublicWell, RivalLease } from "./types";

/** How the Rush behaves (provisional gameplay values: measured, not balanced). */
export const RUSH = {
  /** How fast the excitement of a strike fades (days, e-folding). */
  fadeDays: 240,
  /** A gas strike draws less than oil: gas has no buyer. */
  gasWeight: 0.3,
  /** Each dry hole within this distance of a strike (km) cools the field by this much. */
  dryKm: 2.5,
  dryCooling: 0.15,
  /** The chance a day that a new rival well is spudded, per unit of excitement, and its cap. */
  perDay: 0.06,
  maxPerDay: 0.5,
  /** At most this many rival wells drilling at once, and in all. */
  maxActive: 6,
  maxWells: 60,
  /** The chance a new well is a newcomer's rather than an operator already in the field. */
  newcomer: 0.4,
  /** A rival lease runs a year, and is held while the operator has a well drilling or producing on it. */
  leaseDays: 365,
} as const;

/** Fictional operators of the period (real places, fictional people and companies). */
export const OPERATORS = [
  "the Gulf Coast Oil Co.", "the Neches Valley Oil Co.", "the Sabine Petroleum Co.", "Hardesty & Pruett",
  "the Jefferson County Oil Co.", "Bledsoe Brothers", "the Calcasieu Oil Co.", "the Texas & Louisiana Oil Co.",
  "Ware, Dugat & Co.", "the Beaumont Pioneer Oil Co.",
] as const;

/** How much the field draws operators now: strikes, fading with time, cooled by dry holes around them. */
export function excitement(wells: readonly PublicWell[], now: GameTime): number {
  let heat = 0;
  for (const s of wells) {
    if (s.result === "dry") continue;
    const age = Math.max(0, now - s.t) / MINUTES_PER_DAY;
    const fresh = Math.exp(-age / RUSH.fadeDays) * (s.result === "oil" ? 1 : RUSH.gasWeight);
    const dry = wells.filter((d) => d.result === "dry" && d.t >= s.t && Math.hypot(d.x - s.x, d.y - s.y) <= RUSH.dryKm).length;
    heat += fresh * Math.max(0, 1 - RUSH.dryCooling * dry);
  }
  return heat;
}

export interface SiteChoice {
  surveyId: string;
  x: number;
  y: number;
}

/**
 * Where an operator would put its next well, from public facts: around the oil strikes (offsets
 * at a few hundred yards to a mile), on printed hills near them, away from dry holes, never on
 * ground the company or another operator holds, never on top of an existing well.
 */
export function chooseSite(
  args: { wells: readonly PublicWell[]; allWells: readonly { x: number; y: number }[]; print: PrintedMap; companyLeased: readonly string[]; rivalLeases: readonly RivalLease[]; operator: string },
  rand: () => number,
): SiteChoice | null {
  const strikes = args.wells.filter((w) => w.result === "oil");
  if (!strikes.length) return null;
  const candidates: (SiteChoice & { weight: number })[] = [];
  const consider = (x: number, y: number, near: { x: number; y: number }, bonus: number) => {
    const s = SURVEYS.find((v) => insidePoly(v.poly, x, y));
    if (!s || args.companyLeased.includes(s.id)) return;
    const holder = args.rivalLeases.find((l) => l.surveyId === s.id);
    if (holder && holder.operator !== args.operator) return;
    if (args.allWells.some((w) => Math.hypot(w.x - x, w.y - y) < 0.25)) return;
    const dryNear = args.wells.filter((w) => w.result === "dry" && Math.hypot(w.x - x, w.y - y) < 0.6).length;
    const d = Math.hypot(x - near.x, y - near.y);
    candidates.push({ surveyId: s.id, x, y, weight: (bonus * Math.exp(-d / 0.8)) / (1 + 3 * dryNear) });
  };
  for (const s of strikes) {
    for (const r of [0.35, 0.7, 1.1, 1.5]) for (let a = 0; a < 8; a++) consider(s.x + Math.cos((a * Math.PI) / 4) * r, s.y + Math.sin((a * Math.PI) / 4) * r, s, 1);
    for (const h of args.print.hills) if (Math.hypot(h.x - s.x, h.y - s.y) < 3) consider(h.x, h.y, s, 1.2);
  }
  const total = candidates.reduce((a, c) => a + c.weight, 0);
  if (total <= 0) return null;
  let pick = rand() * total;
  for (const c of candidates) { pick -= c.weight; if (pick <= 0) return { surveyId: c.surveyId, x: c.x, y: c.y }; }
  const last = candidates[candidates.length - 1]!;
  return { surveyId: last.surveyId, x: last.x, y: last.y };
}
