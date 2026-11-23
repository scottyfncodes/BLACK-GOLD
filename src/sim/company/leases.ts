/**
 * Oil and gas leases on the original land grants (docs/DESIGN.md §4.5).
 *
 * A lease covers a whole survey: a bonus paid up front, a one-eighth royalty to the owner on
 * any oil sold, and a one-year primary term. At the end of the term a lease being drilled or
 * producing is held; an idle one renews on a delay rental if the company can pay, else lapses.
 *
 * Prices use PUBLIC facts only: acreage, the published map's named hills, nearness to Beaumont,
 * and the company's own wells that came in (news travels). Never the hidden geology.
 * Owners' temperament is keyed on the survey alone, in its own namespace. Imports no truth.
 */
import { rngUnit, type Seed } from "../core/rng";
import { MINUTES_PER_DAY, type GameTime } from "../core/time";
import { JEFFERSON_1890, projectKm } from "../../content/geography/jefferson1890";
import { SURVEYS, centroid, type Survey } from "../../content/geography/surveys";
import type { PrintedMap } from "../surface/print";

export const ROYALTY = 1 / 8;
export const TERM_DAYS = 365;
export const BASE_PER_ACRE = 0.4;
export const DELAY_RENTAL_PER_ACRE = 0.1;
/** A lower offer is this share of the asking bonus. */
export const LOWER_OFFER = 0.75;
export const REFUSAL_DAYS = 30;

export type LeaseStatus = "active" | "lapsed" | "released";

export interface Lease {
  surveyId: string;
  signedAt: GameTime;
  expiresAt: GameTime;
  acres: number;
  bonusCents: number;
  royalty: number;
  status: LeaseStatus;
  /** How many times the term has been extended (by delay rental or by operations). */
  renewals: number;
}

export interface LeaseBook {
  leases: Lease[];
  /** Surveys whose owner refused a lower offer, until when. */
  refusedUntil: Record<string, GameTime>;
}

export const emptyLeaseBook = (): LeaseBook => ({ leases: [], refusedUntil: {} });

const BEAUMONT = (() => {
  const b = JEFFERSON_1890.places.find((p) => p.id === "beaumont")!;
  const p = projectKm(JEFFERSON_1890, b.at);
  return [p.x, p.y] as const;
})();

/** Public news that moves prices: wells of ours that came in, and where. */
export interface PublicNews {
  strikes: { x: number; y: number }[];
}

export interface Terms {
  surveyId: string;
  acres: number;
  perAcre: number;
  askingCents: number;
  lowerCents: number;
  rentalCents: number;
  royalty: number;
  /** Why the price is what it is, in words (public reasons only). */
  reasons: string[];
}

const round5 = (dollars: number) => Math.max(5, Math.round(dollars / 5) * 5);

/** The owner's asking terms, from public facts only. */
export function askingTerms(survey: Survey, print: PrintedMap, news: PublicNews): Terms {
  const [cx, cy] = centroid(survey.poly);
  let per = BASE_PER_ACRE;
  const reasons: string[] = [];
  const hill = print.hills.map((h) => ({ h, d: Math.hypot(h.x - cx, h.y - cy) })).sort((a, b) => a.d - b.d)[0];
  if (hill && hill.d < 2.5) {
    per *= 1 + 1.6 * (1 - hill.d / 2.5);
    reasons.push(`near ${hill.h.name}`);
  }
  const town = Math.hypot(BEAUMONT[0] - cx, BEAUMONT[1] - cy);
  if (town < 4) {
    per *= 1 + 0.4 * (1 - town / 4);
    reasons.push("close to Beaumont");
  }
  const strike = news.strikes.map((s) => Math.hypot(s.x - cx, s.y - cy)).sort((a, b) => a - b)[0];
  if (strike !== undefined && strike < 3) {
    per *= 1 + 2 * (1 - strike / 3);
    reasons.push("oil has come in nearby");
  }
  const asking = round5(survey.acres * per);
  return {
    surveyId: survey.id,
    acres: survey.acres,
    perAcre: per,
    askingCents: asking * 100,
    lowerCents: round5(asking * LOWER_OFFER) * 100,
    rentalCents: round5(survey.acres * DELAY_RENTAL_PER_ACRE) * 100,
    royalty: ROYALTY,
    reasons,
  };
}

/** Whether this owner takes a lower offer. Keyed on the survey alone, never on geology. */
export function ownerAccepts(seed: Seed, surveyId: string): boolean {
  return rngUnit(seed, "lease:owner", surveyId) < 0.5;
}

export function activeLease(book: LeaseBook, surveyId: string, now: GameTime): Lease | undefined {
  return book.leases.find((l) => l.surveyId === surveyId && l.status === "active" && l.expiresAt > now);
}

export function surveyById(id: string): Survey | undefined {
  return SURVEYS.find((s) => s.id === id);
}

export const termEnd = (from: GameTime) => from + TERM_DAYS * MINUTES_PER_DAY;
