import { createEngine } from "./core/engine";
import { fromCalendar } from "./core/time";
import { calendar } from "./systems/calendar";
import { geology } from "./systems/geology";
import { fieldwork } from "./systems/fieldwork";
import { rig } from "./systems/rig";

/**
 * The sim's public surface. It deliberately exports NO geological truth: the UI and app learn
 * about the ground only through `knowledgeOf` (evidence and interpretations) and `printedMap`
 * (the published survey). tests/arch/boundaries.test.ts checks this list.
 */
export * from "./core/engine";
export * from "./core/time";
export { hashState } from "./core/hash";
export { isSeed, type Seed } from "./core/rng";
export { ftToM, mToFt, wholeFeet } from "./math/units";
export { knowledgeOf, type KnowledgeView } from "./knowledge";
export type * from "./knowledge/types";
export { printedMap, PRINT_RELIEF_FT, type PrintedMap, type PrintedHill, type PrintedWell } from "./surface/print";
export { WALK_DAYS, CONSULT_DAYS, INQUIRE_DAYS } from "./systems/fieldwork";
export { GEOLOGY_VERSION } from "./geology/truth/model";
export { MIGRATIONS, worldProblem, type Migration } from "./migrations";
export { ACCRUAL_UNITS, creditLimitCents, collateralCents, netPerBarrelCents, OIL_ADVANCE, RIG_ADVANCE, RIG_BOOK, RIG_RESALE, RATE_PERCENT, BORROW_STEP_CENTS, USED_RIG_PRICE, STRIKES_TO_FORECLOSE, type BankState } from "./company/bank";
export { attemptCents, contractOffered, CONTRACT_DAYS, CONTRACT_PAY, CONTRACT_WAGES, MIN_ATTEMPT_DAYS, recoveryPaths, type Position, type RecoveryPath } from "./company/recovery";
export { DRIVE, DRIVE_ALLOWANCE_FT, drivePipeCents, MAX_STRINGS, MIN_STRING_FT, PIPE, pullDays, SALVAGE, salvageFraction, stringCostCents, waterCut, type CasingString, type DriveJob, type StringObserved } from "./company/casing";
export { CREW_DAY_CENTS, dayRateCents, TEMPERAMENTS, type Crew, type Driller, type DrillerNote, type DrillerRecord, type Orders, type Recommendation, type RecommendationKind, type Temperament } from "./company/crew";
export { CAP_COST, HAUL_LIMIT_BBL, OIL_PRICES, oilPriceCents, HAULING_CENTS, type Producer, type ProductionBook } from "./company/production";
export { activeLease, askingTerms, ROYALTY, TERM_DAYS, LOWER_OFFER, type Lease, type LeaseBook, type Terms, type PublicNews } from "./company/leases";
export { cashCents, debtCents, type Ledger, type Entry, type Category, type Account } from "./company/ledger";
export { operationsOf, COSTS, RIG_VALUE, STARTING_CASH, type CampaignOutcome, type Contract, type OperationsView, type Well, type WellStatus, type Operation } from "./operations";
export { ADVICE_LAPSE_MINUTES, FEED_RATE, SWEET_FT, MAX_DEPTH_FT, TICK_MINUTES, IDLE_WARN_TICKS, LOW_FUNDS_DAYS, LEAK_FT, contactFor, positionOf } from "./systems/rig";

/** Every system in the shipping game, in a fixed order (order is part of determinism). */
export const GAME_SYSTEMS = [calendar, geology, fieldwork, rig] as const;

/** The campaign opens at dawn on New Year's Day, 1890. */
export const CAMPAIGN_START = fromCalendar(1890, 1, 1, 6, 0);

export const gameEngine = createEngine(GAME_SYSTEMS);
