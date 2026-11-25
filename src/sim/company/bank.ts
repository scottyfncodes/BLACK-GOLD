/**
 * The First National Bank of Beaumont: loans secured on what the company owns.
 *
 * - Credit limit: a fifth of the rig's value on the books (if owned), and three quarters of each
 *   producing well's next half-year of net oil at this year's price.
 * - Interest: 10% a year (a credible period rate; provisional, no 1890 Texas source read yet), on
 *   the balance, accrued daily in exact integer units (1/36,500 cent), charged at month end after the month's oil is sold.
 * - An unpaid month: a warning, and the interest is added to the loan. Two in a row:
 *   foreclosure. The bank takes the rig and sells it for what a used outfit fetches in
 *   Beaumont; the proceeds go against the debt and any surplus to the company. The bank keeps
 *   first claim on oil revenue until the loan is clear. The company keeps its land and wells.
 *
 * The rig has three different values, kept apart on purpose:
 * - its value on the books: what the outfit cost ($1,500 new; $900 if bought used);
 * - what it fetches if sold: $750, whoever sells it (the company or the bank);
 * - what a replacement costs: $900 for a used outfit.
 * Selling is a real loss (half the book value) and buying back costs more than a sale brings,
 * so the rig is never a cheap source of cash. The bank lends against the book value, but only a
 * fifth of it: $300 on a new outfit, less than the rig would fetch at a forced sale.
 * Sources: rig, engine and boiler, and tools priced in a supply house's list printed in
 * Whiteshot, The Oil-Well Driller (1905): rig $600–750 framed (irons alone $50–275), boiler and
 * engine $580–900, tools from $500. The resale and used prices are estimates (provisional).
 * Borrowing is a real risk: a company that borrows to the limit and spends it all can be
 * finished (see company/recovery.ts). Imports no truth.
 */
import { HAULING_CENTS, type ProductionBook } from "./production";

export const RATE_PERCENT = 10;
/** Accrual units per cent: interest per day = balance × RATE_PERCENT / ACCRUAL_UNITS. */
export const ACCRUAL_UNITS = 36_500;
export const BORROW_STEP_CENTS = 5_000;
/** The share of the rig's book value the bank will lend against. */
export const RIG_ADVANCE = 0.2;
/** The share of a producing well's next half-year of net oil the bank will lend against. */
export const OIL_ADVANCE = 0.75;
/** A new cable-tool outfit: rig, boiler and engine, tools and cable (dollars, on the books). */
export const RIG_BOOK = 1500;
/** What a used outfit costs to buy in Beaumont (dollars; estimate). */
export const USED_RIG_PRICE = 900;
/** What a used outfit fetches when sold, by the company or the bank (dollars; estimate). */
export const RIG_RESALE = 750;
/** Months of unpaid interest before foreclosure. */
export const STRIKES_TO_FORECLOSE = 2;

export interface BankState {
  /** Interest accrued and not yet charged, in 1/36,500 of a cent. */
  accrued: number;
  /** Consecutive months interest went unpaid. */
  strikes: number;
  /** After foreclosure: the bank takes oil revenue first until the loan is clear. */
  lien: boolean;
  /** Does the company own a rig? (The bank can take it.) */
  rigOwned: boolean;
  /** The rig's value on the books (cents): what it cost. Zero without a rig. */
  rigBookCents: number;
}

export const emptyBank = (): BankState => ({ accrued: 0, strikes: 0, lien: false, rigOwned: true, rigBookCents: RIG_BOOK * 100 });

/** Net cents a barrel earns the company after hauling and royalty, at a price per barrel. */
export const netPerBarrelCents = (priceCents: number, royalty = 1 / 8) => priceCents - HAULING_CENTS - Math.round(priceCents * royalty);

/** Collateral (cents): the rig at its book value, and a half-year of each producing well's net oil. */
export function collateralCents(bank: Pick<BankState, "rigOwned" | "rigBookCents">, production: ProductionBook, oilPriceCents: number): { rig: number; oil: number } {
  const oil = production.producers.reduce((a, p) => a + p.lastDayBbl * 182 * Math.max(0, netPerBarrelCents(oilPriceCents)), 0);
  return { rig: bank.rigOwned ? bank.rigBookCents : 0, oil };
}

/** What the bank will lend in total (cents), rounded down to the borrowing step. */
export function creditLimitCents(bank: Pick<BankState, "rigOwned" | "rigBookCents" | "lien">, production: ProductionBook, oilPriceCents: number): number {
  if (bank.lien) return 0;
  const c = collateralCents(bank, production, oilPriceCents);
  const lendable = Math.floor(c.rig * RIG_ADVANCE + c.oil * OIL_ADVANCE);
  return Math.floor(lendable / BORROW_STEP_CENTS) * BORROW_STEP_CENTS;
}

/** One day's interest accrual on a balance (cents), in accrual units. */
export const dayAccrual = (debtCents: number) => debtCents * RATE_PERCENT;
