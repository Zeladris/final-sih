import { describe, expect, it } from 'vitest';
import { addDays, isCalendarDate, toCalendarDate } from '@kisansetu/shared';

/**
 * Business calendar dates.
 *
 * The prototype this replaced had a timezone bug where a business date was
 * derived with `toISOString().slice(0, 10)`. In Asia/Kolkata that rolls the
 * day over at 05:30 local, so these are regression tests, not hypotheticals.
 */
describe('business calendar dates', () => {
  it('resolves the Asia/Kolkata date for an instant UTC would place a day earlier', () => {
    // 2026-03-15T20:00Z is 2026-03-16 01:30 IST.
    const instant = new Date('2026-03-15T20:00:00.000Z');

    expect(toCalendarDate(instant, 'Asia/Kolkata')).toBe('2026-03-16');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('resolves the boundary just after midnight IST', () => {
    // 2026-03-15T18:45Z is 2026-03-16 00:15 IST.
    expect(toCalendarDate(new Date('2026-03-15T18:45:00.000Z'), 'Asia/Kolkata')).toBe('2026-03-16');
  });

  it('keeps early-morning IST on the same calendar day', () => {
    // 2026-03-16T02:00Z is 2026-03-16 07:30 IST.
    expect(toCalendarDate(new Date('2026-03-16T02:00:00.000Z'), 'Asia/Kolkata')).toBe('2026-03-16');
  });

  it('adds days without drifting across a timezone', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    // 2028 is a leap year.
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('recognises calendar dates and rejects timestamps', () => {
    expect(isCalendarDate('2026-03-16')).toBe(true);
    expect(isCalendarDate('2026-03-16T00:00:00Z')).toBe(false);
  });
});
