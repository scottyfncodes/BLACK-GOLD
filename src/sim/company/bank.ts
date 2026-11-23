/**
 * The First National Bank of Beaumont: loans secured on what the company owns.
 *
 * - Credit limit: half the value of the collateral — the rig (if owned) and each producing
 *   well, valued at a half-year of its current net oil.
 * - Interest: 8% a year on the balance, accrued daily in exact integer units (1/36,500 cent),
 *   charged at month end after the month's oil is sold.
 * - An unpaid month: a warning, and the interest is added to the loan. Two in a row:
 *   foreclosure. The bank takes the rig (its value set against the debt) and keeps first claim
 *   on oil revenue until the loan is clear. The company keeps its land and wells.
 * - Recovery: buy a used rig; with no rig, no oil and no money, hire the crew out for wages.
 * Imports no truth.
 */
import { HAULING_CENTS, OIL_PRICE_CENTS, type ProductionBook } from "./production";

export const RATE_PERCENT = 8;
/** Accrual units per cent: interest per day = balance × RATE_PERCENT / ACCRUAL_UNITS. */
export const ACCRUAL_UNITS = 36_500;
export const BORROW_STEP_CENTS = 5_000;
export const USED_RIG_PRICE = 300;
export const HIRE_OUT_DAYS = 30;
export const HIRE_OUT_WAGES = 90;
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
  /** The crew is hired out to another operator until then. */
  hiredOutUntil: number | null;
}

export const emptyBank = (): BankState => ({ accrued: 0, strikes: 0, lien: false, rigOwned: true, hiredOutUntil: null });

/** Net cents a barrel earns the company after hauling and royalty. */
export const netPerBarrelCents = (royalty = 1 / 8) => OIL_PRICE_CENTS - HAULING_CENTS - Math.round(OIL_PRICE_CENTS * royalty);

/** Collateral (cents): the rig and a half-year of each producing well's net oil. */
export function collateralCents(bank: BankState, production: ProductionBook, rigValueCents: number): number {
  const oil = production.producers.reduce((a, p) => a + p.lastDayBbl * 182 * netPerBarrelCents(), 0);
  return (bank.rigOwned ? rigValueCents : 0) + oil;
}

/** What the bank will lend in total (cents), rounded down to the borrowing step. */
export function creditLimitCents(bank: BankState, production: ProductionBook, rigValueCents: number): number {
  if (bank.lien) return 0;
  const half = Math.floor(collateralCents(bank, production, rigValueCents) / 2);
  return Math.floor(half / BORROW_STEP_CENTS) * BORROW_STEP_CENTS;
}

/** One day's interest accrual on a balance (cents), in accrual units. */
export const dayAccrual = (debtCents: number) => debtCents * RATE_PERCENT;
