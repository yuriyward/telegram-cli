import { Temporal } from "@js-temporal/polyfill";

export interface DateRange {
  since: Date;
  until: Date;
  timezone: string;
}

export const parseDate = (value: string, timezone: string, now: Date): Date => {
  const instant = Temporal.Instant.from(now.toISOString());
  const zoned = instant.toZonedDateTimeISO(timezone);
  if (value === "today") {
    return new Date(zoned.startOfDay().epochMilliseconds);
  }
  const days = /^(?<days>\d+)d$/u.exec(value)?.groups?.days;
  if (days !== undefined) {
    return new Date(
      instant.subtract({ hours: Number(days) * 24 }).epochMilliseconds
    );
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return new Date(
      Temporal.PlainDate.from(value).toZonedDateTime(timezone).epochMilliseconds
    );
  }
  return new Date(Temporal.Instant.from(value).epochMilliseconds);
};

export const dateRange = (
  since: string,
  until: string | undefined,
  timezone: string,
  now = new Date()
): DateRange => {
  const range = {
    since: parseDate(
      since === "all" ? "1970-01-01T00:00:00Z" : since,
      timezone,
      now
    ),
    timezone,
    until: until === undefined ? now : parseDate(until, timezone, now),
  };
  if (range.since >= range.until) {
    throw new RangeError(
      "--since must precede --until (start inclusive, end exclusive)."
    );
  }
  return range;
};

export const historyOffset = (since: Date) => {
  const date = Math.max(0, Math.floor(since.getTime() / 1000) - 1);
  // Telegram interprets an all-zero cursor as the newest end, even in reverse mode.
  return { date, id: date === 0 ? 1 : 0 };
};
