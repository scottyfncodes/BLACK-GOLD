import { describe, expect, it } from "vitest";
import { fromCalendar, startOfNextMonth, toCalendar, MINUTES_PER_DAY } from "../../src/sim";

describe("game calendar", () => {
  it("starts at midnight on Wednesday 1 January 1890", () => {
    expect(toCalendar(0)).toEqual({ year: 1890, month: 1, day: 1, hour: 0, minute: 0, weekday: 3 });
  });

  it("treats 1900 as a common year and 1892 and 2000 as leap years", () => {
    expect(toCalendar(fromCalendar(1900, 2, 28) + MINUTES_PER_DAY)).toMatchObject({ month: 3, day: 1 });
    expect(toCalendar(fromCalendar(1892, 2, 28) + MINUTES_PER_DAY)).toMatchObject({ month: 2, day: 29 });
    expect(toCalendar(fromCalendar(2000, 2, 28) + MINUTES_PER_DAY)).toMatchObject({ month: 2, day: 29 });
  });

  it("round-trips every day from 1890 to 2200", () => {
    const end = fromCalendar(2200, 1, 1);
    for (let t = 0; t < end; t += MINUTES_PER_DAY * 3 + 37) {
      const c = toCalendar(t);
      expect(fromCalendar(c.year, c.month, c.day, c.hour, c.minute)).toBe(t);
    }
  });

  it("knows historical weekdays (10 January 1901 was a Thursday)", () => {
    expect(toCalendar(fromCalendar(1901, 1, 10)).weekday).toBe(4);
  });

  it("finds the start of next month, across year ends", () => {
    expect(startOfNextMonth(fromCalendar(1890, 12, 31, 23, 59))).toBe(fromCalendar(1891, 1, 1));
    expect(startOfNextMonth(fromCalendar(1890, 2, 1))).toBe(fromCalendar(1890, 3, 1));
  });

  it("rejects non-integer and negative times", () => {
    expect(() => toCalendar(1.5)).toThrow();
    expect(() => toCalendar(-1)).toThrow();
  });
});
