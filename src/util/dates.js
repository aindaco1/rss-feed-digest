import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_PATTERN = /(?:z|[+-]\d{2}:?\d{2})$/i;

export function parseDateInput(value, timezone) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const text = String(value).trim();
  const date = OFFSET_PATTERN.test(text) ? new Date(text) : fromZonedTime(text, timezone);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date input: ${value}`);
  }

  return date;
}

export function resolveDigestWindow(args, digestConfig) {
  const timezone = digestConfig.timezone || "America/Denver";
  const sendTime = digestConfig.sendTime || "07:00";

  if (args["test-window"]) {
    const start = fromZonedTime("2026-05-30T07:00:00", timezone);
    const end = fromZonedTime("2026-06-01T07:00:00", timezone);
    return describeWindow(start, end, timezone, digestConfig.dateFormat);
  }

  const explicitStart = parseDateInput(args.start, timezone);
  const explicitEnd = parseDateInput(args.end, timezone);

  if (explicitStart || explicitEnd) {
    if (!explicitStart || !explicitEnd) {
      throw new Error("Provide both --start and --end, or neither.");
    }

    return describeWindow(explicitStart, explicitEnd, timezone, digestConfig.dateFormat);
  }

  const now = new Date();
  const localDate = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  let end = fromZonedTime(`${localDate}T${sendTime}:00`, timezone);

  if (now < end) {
    end = new Date(end.getTime() - DAY_MS);
  }

  const start = new Date(end.getTime() - DAY_MS);
  return describeWindow(start, end, timezone, digestConfig.dateFormat);
}

function describeWindow(start, end, timezone, dateFormat = "MM/dd/yyyy") {
  if (start >= end) {
    throw new Error("--start must be before --end.");
  }

  return {
    start,
    end,
    timezone,
    dateLabel: formatInTimeZone(end, timezone, dateFormat),
    slug: formatInTimeZone(end, timezone, "yyyy-MM-dd"),
    startLabel: formatInTimeZone(start, timezone, "yyyy-MM-dd HH:mm zzz"),
    endLabel: formatInTimeZone(end, timezone, "yyyy-MM-dd HH:mm zzz")
  };
}
