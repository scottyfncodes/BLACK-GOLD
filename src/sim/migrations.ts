/**
 * Save migrations: each upgrades a world one schema version, as plain data, deterministically.
 * Every migration is idempotent: applied to an already-migrated world it changes nothing.
 * Imports no truth.
 */
import { insertScheduled, type WorldState } from "./core/engine";
import { MINUTES_PER_DAY } from "./core/time";
import { emptyLedger, post, recompute, dollarsToCents, type Ledger } from "./company/ledger";
import { emptyOutcome, RIG_VALUE } from "./operations";
import { emptyLeaseBook, ROYALTY, termEnd, type LeaseBook } from "./company/leases";
import { emptyProductionBook } from "./company/production";
import { emptyBank } from "./company/bank";
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
    post(ledger, world.time, "opening", "Cable-tool rig and tools, owned", [{ account: "equipment", cents: dollarsToCents(RIG_VALUE) }, { account: "equity", cents: -dollarsToCents(RIG_VALUE) }]);
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
  if (!("bank" in ops)) ops.bank = emptyBank() as unknown as Record<string, unknown>;
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

export const MIGRATIONS: Readonly<Record<number, Migration>> = { 1: v1ToV2, 2: v2ToV3 };

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
