/**
 * Game time is an integer count of minutes since 1890-01-01 00:00.
 * The calendar is proleptic Gregorian, computed arithmetically: no `Date`, so it is
 * deterministic everywhere and has no time zones.
 */
export type GameTime = number;

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
export const EPOCH_YEAR = 1890;

export interface CalendarDate {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

// Days from 1970-01-01 to a civil date (Howard Hinnant's algorithm).
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): { year: number; month: number; day: number } {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const EPOCH_DAYS = daysFromCivil(EPOCH_YEAR, 1, 1);

export function toCalendar(t: GameTime): CalendarDate {
  assertGameTime(t);
  const dayIndex = Math.floor(t / MINUTES_PER_DAY);
  const minuteOfDay = t - dayIndex * MINUTES_PER_DAY;
  const absDays = EPOCH_DAYS + dayIndex;
  // 1970-01-01 was a Thursday (4).
  const weekday = (((absDays + 4) % 7) + 7) % 7;
  return {
    ...civilFromDays(absDays),
    hour: Math.floor(minuteOfDay / MINUTES_PER_HOUR),
    minute: minuteOfDay % MINUTES_PER_HOUR,
    weekday,
  };
}

export function fromCalendar(year: number, month: number, day: number, hour = 0, minute = 0): GameTime {
  return (daysFromCivil(year, month, day) - EPOCH_DAYS) * MINUTES_PER_DAY + hour * MINUTES_PER_HOUR + minute;
}

/** The first minute of the month after the one containing `t`. */
export function startOfNextMonth(t: GameTime): GameTime {
  const { year, month } = toCalendar(t);
  return month === 12 ? fromCalendar(year + 1, 1, 1) : fromCalendar(year, month + 1, 1);
}

export function assertGameTime(t: number): asserts t is GameTime {
  if (!Number.isSafeInteger(t) || t < 0) throw new RangeError(`Invalid game time: ${t}`);
}
