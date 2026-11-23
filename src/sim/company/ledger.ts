/**
 * The company's books: the single authority on money.
 *
 * - Whole cents only (integers): no floating-point drift, ever.
 * - Append-only double entry: every entry's lines sum to zero. Debits are positive.
 *   Assets and expenses carry debit (positive) balances; equity, revenue and the bank loan
 *   carry credit (negative) balances.
 * - Cash, debt and everything else are balances derived from the entries. A running total is
 *   cached for speed; tests recompute it from scratch.
 *
 * Imports no truth. Every system that touches money goes through `post`.
 */
import type { GameTime } from "../core/time";

export type Account =
  | "cash"
  | "equipment"
  | "equity"
  | "leaseBonus"
  | "delayRental"
  | "drilling"
  | "operating"
  | "oilSales"
  | "royalty"
  | "hauling"
  | "wages"
  | "interest"
  | "loan";

/** What an entry is about, for the ledger book's grouping. */
export type Category = "opening" | "lease" | "drilling" | "equipment" | "operating" | "production" | "bank";

export interface Line {
  account: Account;
  /** Debit positive, credit negative. */
  cents: number;
}

export interface Entry {
  id: number;
  t: GameTime;
  category: Category;
  memo: string;
  lines: Line[];
  ref?: { surveyId?: string; wellId?: string };
}

export interface Ledger {
  entries: Entry[];
  /** Running balances per account (cents), derived from entries. */
  balances: Partial<Record<Account, number>>;
  next: number;
}

export const emptyLedger = (): Ledger => ({ entries: [], balances: {}, next: 1 });

export class LedgerError extends Error {}

export function post(l: Ledger, t: GameTime, category: Category, memo: string, lines: Line[], ref?: Entry["ref"]): Entry {
  let sum = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.cents)) throw new LedgerError(`Ledger amounts are whole cents, got ${line.cents} on ${line.account}`);
    sum += line.cents;
  }
  if (sum !== 0) throw new LedgerError(`Entry "${memo}" does not balance (${sum} cents)`);
  const lines2 = lines.filter((x) => x.cents !== 0);
  const entry: Entry = { id: l.next++, t, category, memo, lines: lines2, ...(ref ? { ref } : {}) };
  l.entries.push(entry);
  for (const line of lines2) l.balances[line.account] = (l.balances[line.account] ?? 0) + line.cents;
  return entry;
}

/** Pay cash out against an expense or asset account. */
export function pay(l: Ledger, t: GameTime, category: Category, memo: string, account: Account, cents: number, ref?: Entry["ref"]): Entry {
  return post(l, t, category, memo, [{ account, cents }, { account: "cash", cents: -cents }], ref);
}

/** Take cash in against a revenue, liability or equity account. */
export function receive(l: Ledger, t: GameTime, category: Category, memo: string, account: Account, cents: number, ref?: Entry["ref"]): Entry {
  return post(l, t, category, memo, [{ account: "cash", cents }, { account, cents: -cents }], ref);
}

export const balance = (l: Ledger, a: Account): number => l.balances[a] ?? 0;
export const cashCents = (l: Ledger): number => balance(l, "cash");
/** What the company owes the bank (cents, positive). */
export const debtCents = (l: Ledger): number => 0 - balance(l, "loan");

/** Recompute every balance from the entries (for tests and save validation). */
export function recompute(l: Ledger): Partial<Record<Account, number>> {
  const out: Partial<Record<Account, number>> = {};
  for (const e of l.entries) for (const line of e.lines) out[line.account] = (out[line.account] ?? 0) + line.cents;
  return out;
}

export const dollarsToCents = (d: number): number => Math.round(d * 100);
