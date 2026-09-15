/**
 * Reporting-period presets (§9). Dates are calendar days in the business
 * timezone (Asia/Kolkata) — the same dates the server aggregates by — never
 * the browser's local midnight.
 */

export type PeriodPreset = 'TODAY' | 'YESTERDAY' | 'LAST_7' | 'LAST_30' | 'THIS_MONTH' | 'CUSTOM';

export interface PeriodSelection {
  preset: PeriodPreset;
  from: string;
  to: string;
}

const TZ = 'Asia/Kolkata';

export function businessToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

export function presetRange(preset: Exclude<PeriodPreset, 'CUSTOM'>): PeriodSelection {
  const today = businessToday();
  switch (preset) {
    case 'TODAY':
      return { preset, from: today, to: today };
    case 'YESTERDAY':
      return { preset, from: addDays(today, -1), to: addDays(today, -1) };
    case 'LAST_7':
      return { preset, from: addDays(today, -6), to: today };
    case 'LAST_30':
      return { preset, from: addDays(today, -29), to: today };
    case 'THIS_MONTH':
      return { preset, from: `${today.slice(0, 8)}01`, to: today };
  }
}

export const PRESETS: Array<Exclude<PeriodPreset, 'CUSTOM'>> = ['TODAY', 'YESTERDAY', 'LAST_7', 'LAST_30', 'THIS_MONTH'];

export function queryString(params: Record<string, string | number | null | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return entries.length ? `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
}
