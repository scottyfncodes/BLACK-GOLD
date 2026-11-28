/**
 * Save migrations: each upgrades a world one schema version, as plain data, deterministically.
 * Every migration is idempotent: applied to an already-migrated world it changes nothing.
 * Imports no truth.
 */
import { insertScheduled, type WorldState } from "./core/engine";
import { MINUTES_PER_DAY } from "./core/time";
import { emptyLedger, post, recompute, dollarsToCents, type Ledger } from "./company/ledger";
import { emptyOutcome } from "./operations";
import { emptyCrew } from "./company/crew";
import { emptyLeaseBook, ROYALTY, termEnd, type LeaseBook } from "./company/leases";
import { emptyProductionBook } from "./company/production";
import { RIG_BOOK, USED_RIG_PRICE } from "./company/bank";
import { accountOf } from "./company/account";
import type { OperationsState, Well } from "./operations";
import type { Evidence, KnowledgeState } from "./knowledge/types";

/** The rules as they stood when the v1 → v2 migration was written: it must keep producing a v2 world. */
const V2_RIG_VALUE = 400;
const v2Bank = () => ({ accrued: 0, strikes: 0, lien: false, rigOwned: true });
import { SURVEYS } from "../content/geography/surveys";

export type Migration = (world: Record<string, unknown>) => Record<string, unknown>;

const nextMidnight = (t: number) => (Math.floor(t / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY;

/**
 * v1 → v2: money moves from a single number into the company's books.
 * - Cash on hand becomes "Balance brought forward"; the owned rig is entered at its value.
 * - The daily posting of rig time is scheduled.
 * Everything else (the well, samples, evidence, the clock, random streams) is left untouched.
 */
export function v1ToV2(input: Record<string, unknown>): Record<string, unknown> {
  const world = structuredClone(input) as unknown as WorldState & Record<string, unknown>;
  const ops = world.systems.operations as Record<string, unknown> | undefined;
  if (!ops) return world;
  if (!("ledger" in ops)) {
    const cash = typeof ops.cash === "number" && Number.isFinite(ops.cash) ? Math.max(0, ops.cash) : 0;
    const ledger: Ledger = emptyLedger();
    post(ledger, world.time, "opening", "Balance brought forward", [{ account: "cash", cents: dollarsToCents(cash) }, { account: "equity", cents: -dollarsToCents(cash) }]);
    post(ledger, world.time, "opening", "Cable-tool rig and tools, owned", [{ account: "equipment", cents: dollarsToCents(V2_RIG_VALUE) }, { account: "equity", cents: -dollarsToCents(V2_RIG_VALUE) }]);
    ops.ledger = ledger as unknown as Record<string, unknown>;
    delete ops.cash;
  }
  if (!("accrued" in ops)) ops.accrued = { ticks: 0 };
  if (!("leases" in ops)) {
    // A well already being drilled keeps its land: the lease is granted from the day of migration.
    const book: LeaseBook = emptyLeaseBook();
    const well = ops.well as { surveyId?: string; status?: string } | null;
    const survey = well && well.status !== "gusher" && well.status !== "dry" ? SURVEYS.find((s) => s.id === well.surveyId) : undefined;
    if (survey) {
      const expiresAt = termEnd(world.time);
      book.leases.push({ surveyId: survey.id, signedAt: world.time, expiresAt, acres: survey.acres, bonusCents: 0, royalty: ROYALTY, status: "active", renewals: 0 });
      insertScheduled(world, expiresAt, "lease.term", { surveyId: survey.id });
    }
    ops.leases = book as unknown as Record<string, unknown>;
  }
  if (!("production" in ops)) ops.production = emptyProductionBook() as unknown as Record<string, unknown>;
  if (!("bank" in ops)) ops.bank = v2Bank() as unknown as Record<string, unknown>;
  if (!world.queue.some((e) => e.type === "company.day")) insertScheduled(world, nextMidnight(world.time), "company.day");
  return world;
}

/**
 * v2 → v3: the revision that guards the rig and makes the company's fate explicit.
 * - Each well tracks idle rig time and whether the low-money warning was given.
 * - Crew hire-out (which surrendered the rig) becomes contract drilling with the rig: a crew
 *   that was hired out simply comes home; nothing is owed either way.
 * - The campaign records its first producing well and whether it has ended. A save that
 *   already has a producing well is credited with it, from the day it was capped.
 */
export function v2ToV3(input: Record<string, unknown>): Record<string, unknown> {
  const world = structuredClone(input) as unknown as WorldState & Record<string, unknown>;
  const ops = world.systems.operations as Record<string, unknown> | undefined;
  if (!ops) return world;
  for (const w of [ops.well, ...((ops.past as unknown[]) ?? [])] as (Record<string, unknown> | null)[]) {
    if (!w) continue;
    if (!("idleTicks" in w)) w.idleTicks = 0;
    if (!("lowFundsWarned" in w)) w.lowFundsWarned = false;
  }
  const bank = ops.bank as Record<string, unknown> | undefined;
  if (bank && "hiredOutUntil" in bank) delete bank.hiredOutUntil;
  if (!("contract" in ops)) ops.contract = null;
  if (!("outcome" in ops)) {
    const outcome = emptyOutcome();
    const first = ((ops.production as { producers?: { since: number; name: string }[] } | undefined)?.producers ?? [])[0];
    if (first) { outcome.firstOilAt = first.since; outcome.firstOilWell = first.name; }
    ops.outcome = outcome as unknown as Record<string, unknown>;
  }
  return world;
}

/**
 * v3 → v4: casing strings and the company's driller.
 * - Each well gets its strings, the sand leaking under a shoe, and where the hole made water.
 *   Pipe already in a hole (the old single casing to `casedFt`) becomes one 10-inch string,
 *   already paid for, counted as sealed and seen to hold: the save keeps what it had.
 * - The company gets its first driller (the same ordinary hand a new game starts with, at the
 *   same day rate as before), standing orders to ask before spending, and no advice pending.
 */
export function v3ToV4(input: Record<string, unknown>): Record<string, unknown> {
  const world = structuredClone(input) as unknown as WorldState & Record<string, unknown>;
  const ops = world.systems.operations as Record<string, unknown> | undefined;
  if (!ops) return world;
  for (const w of [ops.well, ...((ops.past as unknown[]) ?? [])] as (Record<string, unknown> | null)[]) {
    if (!w) continue;
    if (!("strings" in w)) {
      const cased = typeof w.casedFt === "number" ? w.casedFt : 0;
      w.strings = cased > 0 ? [{ size: 0, seatFt: Math.round(cased), costCents: 0, setAt: world.time, seatCall: null, observed: "dry", pulled: false }] : [];
    }
    if (!("leakFt" in w)) w.leakFt = 0;
    if (!("waterFt" in w)) w.waterFt = [];
    if (!("driller" in w)) w.driller = "d0";
    if (!("fishCount" in w)) w.fishCount = 0;
  }
  if (!("crew" in ops) || ops.crew === null) ops.crew = emptyCrew(world.seed) as unknown as Record<string, unknown>;
  for (const p of ((ops.production as { producers?: Record<string, unknown>[] } | undefined)?.producers ?? [])) if (!("waterCut" in p)) p.waterCut = 0;
  return world;
}

/**
 * v4 → v5: the rig at period prices.
 * - The bank records the rig's value on the books. An owned rig is revalued, by an entry in
 *   the books against the company's capital: the outfit the company started with from $400 to
 *   $1,500; a used rig bought back from $300 to $900. The bank's advance on it falls from three
 *   quarters to a fifth, so a company's credit is about what it was ($300 on the opening rig).
 * - Interest, the oil price and the rig's resale value are rules, not saved state: they apply
 *   from the moment the save is loaded.
 */
export function v4ToV5(input: Record<string, unknown>): Record<string, unknown> {
  const world = structuredClone(input) as unknown as WorldState & Record<string, unknown>;
  const ops = world.systems.operations as Record<string, unknown> | undefined;
  if (!ops) return world;
  const bank = ops.bank as Record<string, unknown> | undefined;
  const ledger = ops.ledger as Ledger | undefined;
  if (!bank || !ledger || "rigBookCents" in bank) return world;
  if (!bank.rigOwned) { bank.rigBookCents = 0; return world; }
  // Which rig: the last rig event in the books decides (bought used, or the opening outfit).
  let used = false;
  for (const e of ledger.entries) {
    if (/^Used cable-tool rig and tools, bought/.test(e.memo)) used = true;
    else if (/^Rig seized/.test(e.memo)) used = false;
  }
  const was = used ? 30_000 : 40_000, now = used ? USED_RIG_PRICE * 100 : RIG_BOOK * 100;
  post(ledger, world.time, "opening", `Rig and tools revalued at period prices: $${was / 100} to $${now / 100}`, [{ account: "equipment", cents: now - was }, { account: "equity", cents: was - now }]);
  bank.rigBookCents = now;
  return world;
}

/**
 * v5 → v6: driven casing.
 * - The company owns no drive head yet. Wells gain no drive in progress, no collapse, and the
 *   bailer's sand measure starts afresh. Strings already set were let down ("run"), the
 *   default; nothing about them changes.
 * - Running sand is the ground's (sim/hidden/quicksand.ts), a pure function of the seed: an
 *   old save's ground now has it, as it always did; the crew learns it as it drills on.
 */
export function v5ToV6(input: Record<string, unknown>): Record<string, unknown> {
  const world = structuredClone(input) as unknown as WorldState & Record<string, unknown>;
  const ops = world.systems.operations as Record<string, unknown> | undefined;
  if (!ops) return world;
  if (!("tools" in ops) || ops.tools === null) ops.tools = { driveHead: false };
  for (const w of [ops.well, ...((ops.past as unknown[]) ?? [])] as (Record<string, unknown> | null)[]) {
    if (!w) continue;
    if (!("drive" in w)) w.drive = null;
    if (!("collapse" in w)) w.collapse = null;
    if (!("lastInflow" in w)) w.lastInflow = 0;
    if (!("lastBailAt" in w)) w.lastBailAt = world.time;
    if (!("sandInFt" in w)) w.sandInFt = 0;
  }
  return world;
}

/**
 * v6 → v7: reading the ground.
 * - The driller's notebook starts with what the company already holds that bears on its holes:
 *   the settlers' accounts it has collected, and an account of each of its ended holes, written
 *   from their bailer samples as they would have been when each ended. The accounts also join the
 *   company's evidence. (Old geologist opinions carry no depth reading; a new consultation gives one.)
 * - Fieldwork costs money from now on; errands already under way were paid for by the old rules.
 */
export function v6ToV7(input: Record<string, unknown>): Record<string, unknown> {
  const world = structuredClone(input) as unknown as WorldState & Record<string, unknown>;
  const ops = world.systems.operations as unknown as OperationsState | undefined;
  const k = world.systems.knowledge as unknown as KnowledgeState | undefined;
  if (!ops || (ops as unknown as Record<string, unknown>).notebook) return world;
  ops.notebook = [];
  for (const e of k?.evidence ?? []) if (e.kind === "wellRecord") ops.notebook.push(e);
  const ended = [...(ops.past ?? []), ...(ops.well && (ops.well.status === "dry" || ops.well.status === "gusher") ? [ops.well] : [])] as Well[];
  for (const w of ended) {
    const acct = accountOf(ops, w, w.status === "dry" ? "dry" : w.outcome?.startsWith("OIL") ? "oil" : "gas");
    const t = world.time;
    ops.notebook.push({ ...acct, id: `acct-${w.id}`, t });
    if (k) k.evidence.push({ ...acct, id: `ev-${k.next++}`, t } as Evidence);
  }
  return world;
}

/**
 * v7 → v8: the field (M8a). Production moves onto authoritative tanks shared by every well.
 * - Each capped well's hidden figures (its trap's key, the trap's recoverable oil, its opening
 *   flow) leave the company's production book for the hidden field, with the barrels already drawn
 *   from each trap: production continues exactly where it was.
 * - The company keeps what it saw: each well's first day's barrels (taken as its opening flow
 *   within the haul, less its water) and, from now on, its sales month by month.
 */
export function v7ToV8(input: Record<string, unknown>): Record<string, unknown> {
  const world = structuredClone(input) as unknown as WorldState & Record<string, unknown>;
  const ops = world.systems.operations as Record<string, unknown> | undefined;
  if (!ops || ops.field) return world;
  const field = { tanks: {} as Record<string, { originalBbl: number; drawnBbl: number }>, taps: [] as { wellId: string; tank: string; q0: number }[] };
  const book = (ops.production ?? { producers: [] }) as { producers: Record<string, unknown>[]; drawn?: Record<string, number> };
  for (const p of book.producers) {
    const trap = String(p.trap), q0 = Number(p.initialBbl), reserve = Number(p.reserveBbl);
    field.tanks[trap] ??= { originalBbl: reserve, drawnBbl: Math.min(reserve, book.drawn?.[trap] ?? 0) };
    field.taps.push({ wellId: String(p.wellId), tank: trap, q0 });
    p.firstDayBbl = Math.floor(Math.min(150, q0) * (1 - Number(p.waterCut ?? 0)));
    p.months = [];
    delete p.trap; delete p.initialBbl; delete p.reserveBbl;
  }
  delete book.drawn;
  ops.production = book;
  ops.field = field;
  return world;
}

/**
 * v8 → v9: the Rush (M8b). No other operator has come yet: the field is empty of rivals, and
 * none has a well pending. They come with the next public strike.
 */
export function v8ToV9(input: Record<string, unknown>): Record<string, unknown> {
  const world = structuredClone(input) as unknown as WorldState & Record<string, unknown>;
  const ops = world.systems.operations as Record<string, unknown> | undefined;
  if (!ops) return world;
  if (!ops.rush) ops.rush = { wells: [], leases: [], operators: [], monthOthersBbl: 0, lastMonthOthersBbl: 0, next: 1 };
  const field = ops.field as Record<string, unknown> | undefined;
  if (field && !field.pending) field.pending = {};
  return world;
}

export const MIGRATIONS: Readonly<Record<number, Migration>> = { 1: v1ToV2, 2: v2ToV3, 3: v3ToV4, 4: v4ToV5, 5: v5ToV6, 6: v6ToV7, 7: v7ToV8, 8: v8ToV9 };

/** Invariants a loaded world must hold beyond its shape. Returns a reason, or null. */
export function worldProblem(world: WorldState): string | null {
  const ops = world.systems.operations as unknown as { ledger?: Ledger } | undefined;
  if (!ops?.ledger) return "the company's books are missing";
  for (const e of ops.ledger.entries) {
    if (e.lines.reduce((a, l) => a + l.cents, 0) !== 0) return `ledger entry ${e.id} does not balance`;
  }
  const re = recompute(ops.ledger);
  for (const [k, v] of Object.entries(re)) if ((ops.ledger.balances as Record<string, number>)[k] !== v) return `the ${k} balance does not match its entries`;
  return null;
}
