/**
 * Calendar-date helpers (§46).
 *
 * The rule: a procurement/slot date is a *local calendar date* in the
 * business timezone, not a UTC instant. `new Date().toISOString().slice(0,10)`
 * is wrong — in Asia/Kolkata it rolls the business day over at 05:30 local.
 * Always go through these helpers.
 */

export const DEFAULT_APP_TIMEZONE = 'Asia/Kolkata';

/** A calendar date with no time and no zone, formatted "YYYY-MM-DD". */
export type CalendarDate = string;

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): value is CalendarDate {
  return typeof value === 'string' && CALENDAR_DATE_PATTERN.test(value);
}

/**
 * The calendar date that `instant` falls on in `timeZone`.
 * Uses Intl rather than UTC arithmetic so DST and non-hour offsets (IST is
 * UTC+05:30) are handled by the platform.
 */
export function toCalendarDate(
  instant: Date = new Date(),
  timeZone: string = DEFAULT_APP_TIMEZONE,
): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's business date in the configured timezone. */
export function businessToday(timeZone: string = DEFAULT_APP_TIMEZONE): CalendarDate {
  return toCalendarDate(new Date(), timeZone);
}

/**
 * The instant at which local wall-clock `time` ("HH:MM" or "HH:MM:SS") on
 * calendar `date` occurs in `timeZone` — e.g. a slot's end, or closing time.
 * The zone offset is read from Intl at that moment, never assumed.
 */
export function zonedInstant(
  date: CalendarDate,
  time: string,
  timeZone: string = DEFAULT_APP_TIMEZONE,
): Date {
  const [hh = '0', mm = '0', ss = '0'] = time.split(':');
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const asUtc = Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss));

  const offsetAt = (instant: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return local - instant;
  };

  // Two passes settle the offset even across a DST boundary.
  let instant = asUtc - offsetAt(asUtc);
  instant = asUtc - offsetAt(instant);
  return new Date(instant);
}

/** Adds whole days to a calendar date without ever touching a timezone. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  // Date.UTC keeps the arithmetic zone-free; we only read UTC fields back out.
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
