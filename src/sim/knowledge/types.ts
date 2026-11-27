/**
 * What the company knows (evidence) and what it believes (interpretations). Kept apart:
 * evidence is recorded by observation and never edited; interpretations are the player's
 * own pencil work and can be added or rubbed out. Neither is ever derived from truth at
 * render time. This module imports no truth (it is the UI's only window on the ground).
 */
import type { GameTime } from "../core/time";

export type Strength = "faint" | "clear" | "strong";
export type SignKind = "mound" | "gasSeep" | "sourSpring" | "paraffinDirt";
export type ReportedLith = "clay" | "sand" | "gravel" | "rock" | "salt";

/** How the company came by a piece of evidence. Drives how it is drawn. */
export type Provenance = "observed" | "hearsay" | "opinion";

interface Base {
  id: string;
  t: GameTime;
  provenance: Provenance;
}

export interface SignEvidence extends Base {
  kind: "surfaceSign";
  provenance: "observed";
  sign: SignKind;
  x: number;
  y: number;
  strength: Strength;
  surveyId: string | null;
  /** Observed rise in feet, for a mound. */
  reliefFt?: number;
}

/** A survey walked: positive or negative, it is knowledge either way. */
export interface WalkEvidence extends Base {
  kind: "walked";
  provenance: "observed";
  surveyId: string;
  found: number;
}

export interface ReportedInterval {
  topFt: number;
  baseFt: number;
  /** The owner's own words. */
  call: string;
  lith: ReportedLith;
  /** Something unusual was noted (gas, oil, sulphur). */
  show?: "gas" | "oil" | "sulphur";
}

export interface WellRecordEvidence extends Base {
  kind: "wellRecord";
  provenance: "hearsay";
  wellId: string;
  x: number;
  y: number;
  owner: string;
  year: number;
  depthFt: number;
  intervals: ReportedInterval[];
  /** 0–1: how well the owner remembers. Shown to the player as words, not numbers. */
  memory: number;
}

export interface OpinionEvidence extends Base {
  kind: "opinion";
  provenance: "opinion";
  surveyId: string;
  from: "geologist" | "gossip";
  stance: "favourable" | "doubtful" | "unfavourable";
  text: string;
}

/** A bailer sample from the company's own well: what came up, and from about where. */
export interface SampleEvidence extends Base {
  kind: "sample";
  provenance: "observed";
  wellId: string;
  x: number;
  y: number;
  /** The bail interval: depth is smeared over the hole drilled since the last bail. */
  topFt: number;
  baseFt: number;
  lith: ReportedLith;
  call: string;
  show?: "gas" | "oil" | "sulphur";
  /** Chips of gypsum came up with the cuttings: often a sign of rock below, not always. */
  gypsum?: boolean;
}

/**
 * A geologist's reading of the depth to the rock under a rise: an interpretation, not an
 * observation. It names what he based it on (his own rough measure of the rise, and the records
 * the company held), and it can be wrong even when every observation behind it was right.
 */
export interface ReadingEvidence extends Base {
  kind: "reading";
  provenance: "opinion";
  from: "geologist";
  surveyId: string;
  /** The rise he judged (km), roughly its crest. */
  x: number;
  y: number;
  /**
   * "range": he puts the rock between `rockFt[0]` and `rockFt[1]`.
   * "deep": the rise is too low to tell; if there is rock, it is deeper than `rockFt[0]`.
   * "flat": he sees nothing in the lie of the land to judge depth by.
   * "dry": the company's own hole found the rock dry through: he will not look for oil in it.
   */
  verdict: "range" | "deep" | "flat" | "dry";
  rockFt: [number, number | null] | null;
  /** What he went on, in words: each is an observation the company holds or that he made. */
  basis: string[];
  text: string;
}

/**
 * What one of the company's own holes proved, written when it ended. Built only from what the
 * crew saw: the bailer's calls (each known only to the bail interval), the pipe, the money.
 */
export interface AccountEvidence extends Base {
  kind: "account";
  provenance: "observed";
  wellId: string;
  name: string;
  surveyId: string;
  x: number;
  y: number;
  result: "oil" | "gas" | "dry";
  deepestFt: number;
  /** Where the bailer first brought up hard rock (to within its bail interval), and the salt below it. */
  rock: { topFt: number; withinFt: number } | null;
  /** The rock gave no show of oil or gas from its top to the salt below it. */
  rockDry: boolean;
  saltFt: number | null;
  shows: { kind: "gas" | "oil" | "sulphur"; ft: number }[];
  /** The deepest call of gypsum chips above the rock (or in the hole, if it met no rock). */
  gypsumFt: number | null;
  costCents: number;
  /** Plain statements: what the hole proved, what the company may make of it, and what it leaves unknown. */
  proved: string[];
  suggests: string[];
  unknown: string[];
}

export type Evidence = SignEvidence | WalkEvidence | WellRecordEvidence | OpinionEvidence | SampleEvidence | ReadingEvidence | AccountEvidence;

export interface SectionLine {
  id: string;
  /** Roman-numbered in order of drawing: A—A′, B—B′, … */
  letter: string;
  a: [number, number];
  b: [number, number];
}

export interface Prospect {
  id: string;
  numeral: string;
  x: number;
  y: number;
  /** Radius (km) of the pencilled outline. */
  r: number;
}

export interface Interpretations {
  sections: SectionLine[];
  prospects: Prospect[];
}

/** The knowledge system's saved state. Only `evidence`, `interp` and `task` are for the UI. */
export interface KnowledgeState {
  evidence: Evidence[];
  interp: Interpretations;
  task: FieldTask | null;
  /** Opaque keys of surface signs already recorded, so a sign is recorded once. */
  seen: string[];
  /** Times each survey has been walked. */
  visits: Record<string, number>;
  next: number;
}

export type FieldTask =
  | { kind: "walk"; surveyId: string; until: GameTime }
  | { kind: "inquire"; wellId: string; until: GameTime }
  | { kind: "consult"; surveyId: string; who: "geologist" | "gossip"; until: GameTime };
