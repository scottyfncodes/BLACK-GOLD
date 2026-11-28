/**
 * HIDDEN. The oil in the ground, as it is drawn: one tank per trap, shared by every well that
 * taps it, whoever owns the well (DESIGN §4.4, the rule of capture). Only sim/ may import this
 * (lint-enforced): the UI sees a well's own barrels, never its tank, its reserve or which other
 * wells share it.
 *
 * Material accounting is exact and in whole barrels: a tank starts with the oil its wells can
 * recover, and every barrel any well produces is drawn from it, so no tank ever yields more than
 * it held. A well's flow falls in proportion to the oil left in its tank (the same rule as the
 * slice of production before M8), so two wells in one trap empty it faster and each flows less:
 * interference follows from the accounting, not from a special case.
 * Future recovery mechanics (pressure drive, water encroachment, pumping) are deliberately absent.
 */
import { rngKey, type Seed } from "../core/rng";
import { generateGeology, rockAt } from "../geology/truth/model";
import { ftToM } from "../math/units";
import { HAUL_LIMIT_BBL } from "../company/production";

export interface Tank {
  /** Recoverable oil when first tapped (bbl). */
  originalBbl: number;
  /** Drawn by all wells since (bbl). */
  drawnBbl: number;
}

/** A producing well's connection to its tank. */
export interface Tap {
  wellId: string;
  tank: string;
  /** Flow when first opened, with the tank full (bbl/day). */
  q0: number;
}

export interface FieldState {
  tanks: Record<string, Tank>;
  taps: Tap[];
}

export const emptyField = (): FieldState => ({ tanks: {}, taps: [] });

/**
 * Open a well on the oil at the bottom of a hole: its tank (created on first tap, from the trap's
 * charge and kind) and its flow. The figures are those production used before M8, so a lone well
 * produces exactly as it did.
 */
export function openTap(field: FieldState, seed: Seed, wellId: string, x: number, y: number, depthFt: number): Tap {
  const r = rockAt(generateGeology(seed), x, y, ftToM(depthFt));
  const t = r.trap;
  const dome = generateGeology(seed).domes.find((d) => d.id === t?.domeId);
  const fill = dome?.charge.fill ?? 0.3;
  const key = rngKey(seed, "trap", t ? `${t.domeId}:${t.formation}` : wellId).toString(16);
  field.tanks[key] ??= { originalBbl: Math.round((t?.kind === "caprock" ? 160_000 : 90_000) * (0.4 + fill)), drawnBbl: 0 };
  const tap: Tap = { wellId, tank: key, q0: Math.round(220 + 1600 * fill) };
  field.taps.push(tap);
  return tap;
}

/** What a well can flow today: its opening flow, in proportion to the oil left in its tank, within the haul. */
export function flowToday(field: FieldState, tap: Tap): number {
  const tank = field.tanks[tap.tank]!;
  const left = Math.max(0, tank.originalBbl - tank.drawnBbl);
  return Math.min(HAUL_LIMIT_BBL, left, Math.floor((tap.q0 * left) / tank.originalBbl));
}

/**
 * One day for every open well on the field, company's and others' alike: each well's flow is set
 * from its tank as the day began, then all are drawn together (never more than a tank holds, the
 * shortfall shared in proportion). So who draws first changes nothing. Returns barrels by well.
 */
export function drawDay(field: FieldState): Record<string, number> {
  const want = field.taps.map((t) => ({ t, q: flowToday(field, t) }));
  const byTank: Record<string, number> = {};
  for (const { t, q } of want) byTank[t.tank] = (byTank[t.tank] ?? 0) + q;
  const out: Record<string, number> = {};
  for (const { t, q } of want) {
    const tank = field.tanks[t.tank]!;
    const left = Math.max(0, tank.originalBbl - tank.drawnBbl), asked = byTank[t.tank]!;
    out[t.wellId] = asked <= left ? q : Math.floor((q * left) / asked);
  }
  for (const { t } of want) field.tanks[t.tank]!.drawnBbl += out[t.wellId]!;
  return out;
}

/** Draw a day's flow from a well's tank. Never more than is left. */
export function draw(field: FieldState, tap: Tap, bbl: number): number {
  const tank = field.tanks[tap.tank]!;
  const take = Math.max(0, Math.min(bbl, tank.originalBbl - tank.drawnBbl));
  tank.drawnBbl += take;
  return take;
}
