import type { System } from "../core/engine";
import { startOfNextMonth, toCalendar } from "../core/time";

/**
 * The calendar: marks the start of every month. Monthly statements, delay rentals and
 * autosaves all hang off this event in later milestones; in M0 the app autosaves on it.
 */
export const calendar: System<null> = {
  id: "calendar",
  initialState: () => null,
  init(ctx) {
    ctx.schedule(startOfNextMonth(ctx.now), "calendar.monthStart");
  },
  events: {
    "calendar.monthStart"(ctx) {
      const { year, month } = toCalendar(ctx.now);
      ctx.emit({ type: "calendar.newMonth", severity: "info", interrupt: false, data: { year, month } });
      ctx.schedule(startOfNextMonth(ctx.now), "calendar.monthStart");
    },
  },
};
