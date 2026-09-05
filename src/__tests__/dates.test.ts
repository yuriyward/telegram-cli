import { describe, expect, test } from "bun:test";

import { dateRange, historyOffset, parseDate } from "../dates.ts";

describe("date range semantics", () => {
  const now = new Date("2026-03-29T12:00:00Z");

  test("calendar days use the selected timezone across DST", () => {
    const range = dateRange("2026-03-29", "2026-03-30", "Europe/Warsaw", now);
    expect(range.since.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(range.until.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(range.until.getTime() - range.since.getTime()).toBe(
      23 * 3600 * 1000
    );
  });

  test("today means midnight, while 1d is a rolling 24 hours", () => {
    expect(parseDate("today", "Europe/Warsaw", now).toISOString()).toBe(
      "2026-03-28T23:00:00.000Z"
    );
    expect(parseDate("1d", "Europe/Warsaw", now).toISOString()).toBe(
      "2026-03-28T12:00:00.000Z"
    );
  });

  test("offset timestamps identify an instant independently of display timezone", () => {
    expect(parseDate("2026-03-29T14:00:00+02:00", "UTC", now)).toEqual(now);
  });

  test.each(["2026-02-30", "2026-03-29T12:00:00", "yesterday", "-1d"])(
    "rejects invalid or ambiguous input %s",
    (value) => {
      expect(() => parseDate(value, "UTC", now)).toThrow();
    }
  );

  test("rejects reversed ranges and invalid timezones", () => {
    expect(() => dateRange("2026-04-01", "2026-03-01", "UTC", now)).toThrow();
    expect(() => dateRange("today", undefined, "Not/AZone", now)).toThrow();
    expect(() => dateRange("all", undefined, "Not/AZone", now)).toThrow();
    expect(() => dateRange("today", "all", "UTC", now)).toThrow();
  });

  test("all starts at the epoch regardless of timezone and uses the oldest cursor", () => {
    const range = dateRange("all", undefined, "Europe/Warsaw", now);
    expect(range.since.toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(range.until).toEqual(now);
    expect(historyOffset(range.since)).toEqual({ date: 0, id: 1 });
    expect(historyOffset(new Date(-3_600_000))).toEqual({ date: 0, id: 1 });
  });

  test("dated history starts one second before the inclusive boundary", () => {
    expect(historyOffset(now)).toEqual({
      date: Math.floor(now.getTime() / 1000) - 1,
      id: 0,
    });
  });
});
