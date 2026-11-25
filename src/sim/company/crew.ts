/**
 * The company's driller and the men it might hire (docs/DESIGN.md §8).
 *
 * What is public is what Beaumont says of a man: his years, where he has worked, his wage, and
 * a word on his habits. His temperament (cautious, aggressive, economical, methodical) is a
 * tendency, independent of how good he is. His true ability is hidden (sim/hidden/drillers.ts)
 * and is learned only from his record across wells.
 *
 * PROVISIONAL: wages and the crew's day rate are gameplay abstractions, not verified history.
 */
import { rngUnit } from "../core/rng";
import { abilityOf } from "../hidden/drillers";

export type Temperament = "cautious" | "aggressive" | "economical" | "methodical";
export const TEMPERAMENTS: readonly Temperament[] = ["cautious", "aggressive", "economical", "methodical"];

export interface Driller {
  id: string;
  name: string;
  years: number;
  from: string;
  temperament: Temperament;
  /** Day wage on top of the crew's (cents, provisional). */
  wageCents: number;
  /** What is said of him in Beaumont. Reputation, not truth. */
  remark: string;
}

/** What the company has seen a driller do: outcomes only, never his ability. */
export interface DrillerRecord {
  wells: number;
  /** Feet he made with the tools in his hands, and the five-minute spells he had them. */
  feet: number;
  ticks: number;
  stuck: number;
  fishing: number;
  strings: number;
  /** Strings that shut off the water, and strings the crew saw leak. */
  dryStrings: number;
  leakyStrings: number;
  oil: number;
  wet: number;
  dry: number;
}

export const emptyRecord = (): DrillerRecord => ({ wells: 0, feet: 0, ticks: 0, stuck: 0, fishing: 0, strings: 0, dryStrings: 0, leakyStrings: 0, oil: 0, wet: 0, dry: 0 });

/** Standing orders: ask before spending, or act on his own judgement within a monthly budget. */
export interface Orders {
  authority: "ask" | "judgement";
  /** What he may spend without asking in a calendar month (cents). */
  budgetCents: number;
  /** The calendar month (year × 12 + month) the spending below belongs to. */
  month: number;
  spentCents: number;
}

export type RecommendationKind = "case" | "fish" | "abandon";

export interface Recommendation {
  id: number;
  kind: RecommendationKind;
  t: number;
  wellId: string;
  /** In his words: what he has seen, and what he would do. */
  text: string;
  costCents: number;
}

/** The circumstances when a recommendation was declined; it is not raised again until they change. */
export interface DeclineMemo {
  depthFt: number;
  openSandFt: number;
  strings: number;
  stuckCount: number;
}

export interface DrillerNote {
  t: number;
  wellId: string;
  text: string;
  kind: "seen" | "advice" | "acted";
}

export interface Crew {
  driller: Driller;
  candidates: Driller[];
  /** The month the candidates were found for. */
  candidatesMonth: number | null;
  records: Record<string, DrillerRecord>;
  orders: Orders;
  pending: Recommendation | null;
  declined: Partial<Record<RecommendationKind, DeclineMemo>>;
  notes: DrillerNote[];
  nextId: number;
}

/** The rest of the crew (tool dresser, firing the boiler, fuel and water), per day (cents, provisional). */
export const CREW_DAY_CENTS = 900;
export const MAX_NOTES = 14;

export const dayRateCents = (crew: Pick<Crew, "driller">) => CREW_DAY_CENTS + crew.driller.wageCents;

const FIRST = ["Amos", "Jed", "Silas", "Wash", "Hiram", "Ezra", "Tom", "Abner", "Cyrus", "Luke", "Josiah", "Dutch", "Elam", "Gus", "Noah", "Pat"];
const LAST = ["Hanley", "Kittredge", "Mabry", "Dunlap", "Pruett", "Shoemaker", "Rourke", "Vance", "Tolliver", "Beasley", "McCune", "Strickland", "Oakes", "Fenwick", "Gaither", "Lusk"];
const FROM = ["the Bradford field, Pennsylvania", "Oil City, Pennsylvania", "Butler County, Pennsylvania", "the Lima field, Ohio", "Macksburg, Ohio", "the Volcano field, West Virginia", "Pico Canyon, California", "water wells around Houston", "salt wells on the Kanawha"];
const HABIT: Record<Temperament, string> = {
  cautious: "They say he never takes a chance he can see coming.",
  aggressive: "Known for making hole fast, and for not liking to stop.",
  economical: "Spends the company's money as if it were his own.",
  methodical: "Keeps a close log and bails more often than most.",
};

function make(seed: string, id: string, starting: boolean): Driller {
  const a = abilityOf(seed, id);
  const u = (k: string) => rngUnit(seed, "driller", id, k);
  // Reputation is ability seen through talk: honest on average, never exact.
  const rep = Math.max(0, Math.min(1, 0.45 * a.feel + 0.35 * a.judgement + 0.2 * a.reliability + (u("rep") - 0.5) * 0.4));
  const temperament = TEMPERAMENTS[Math.floor(u("temperament") * TEMPERAMENTS.length)]!;
  const years = starting ? 6 : Math.max(1, Math.round(1 + 19 * rep + (u("years") - 0.5) * 6));
  const word = rep > 0.68 ? "Well spoken of where he has worked." : rep > 0.4 ? "An ordinary hand, by the talk." : "Not much known of him; he is new to oil.";
  const wageCents = starting ? 300 : Math.round((250 + 300 * rep + (u("wage") - 0.5) * 80) / 25) * 25;
  return {
    id,
    name: `${FIRST[Math.floor(u("first") * FIRST.length)]} ${LAST[Math.floor(u("last") * LAST.length)]}`,
    years,
    from: FROM[Math.floor(u("from") * FROM.length)]!,
    temperament,
    wageCents,
    remark: `${word} ${HABIT[temperament]}`,
  };
}

/** The company's first driller: an ordinary hand, three dollars a day. */
export const startingDriller = (seed: string): Driller => make(seed, "d0", true);

/** Three men looking for work in Beaumont this month. */
export function candidatesFor(seed: string, month: number): Driller[] {
  return [0, 1, 2].map((k) => make(seed, `m${month}-${k}`, false));
}

export function emptyCrew(seed: string): Crew {
  const driller = startingDriller(seed);
  return {
    driller,
    candidates: [],
    candidatesMonth: null,
    records: { [driller.id]: emptyRecord() },
    orders: { authority: "ask", budgetCents: 15_000, month: 0, spentCents: 0 },
    pending: null,
    declined: {},
    notes: [],
    nextId: 1,
  };
}
