import { createEngine } from "./core/engine";
import { fromCalendar } from "./core/time";
import { calendar } from "./systems/calendar";

export * from "./core/engine";
export * from "./core/time";
export { hashState } from "./core/hash";
export { isSeed, type Seed } from "./core/rng";

/** Every system in the shipping game, in a fixed order (order is part of determinism). */
export const GAME_SYSTEMS = [calendar] as const;

/** The campaign opens at dawn on New Year's Day, 1890. */
export const CAMPAIGN_START = fromCalendar(1890, 1, 1, 6, 0);

export const gameEngine = createEngine(GAME_SYSTEMS);
