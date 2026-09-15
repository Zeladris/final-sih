import type { StorageDurationBand, StorageType } from '@kisansetu/shared';

/**
 * Storage duration and type (§11, §12), parsed deterministically. A spoken
 * day count is the reliable path in both languages — the browser transcribes
 * spoken numbers as digits far more consistently than it transcribes English
 * or Tamil number *words* — so it is tried first, and a keyword layer catches
 * common phrasing ("a week", "a month", "ஒரு வாரம்") when no number was said.
 */

const DURATION_KEYWORDS: Array<{ band: StorageDurationBand; patterns: RegExp[] }> = [
  {
    band: 'DAYS_0_3',
    patterns: [/\bfew days\b/i, /\btoday\b/i, /\byesterday\b/i, /சில நாட்கள்/, /இன்று/],
  },
  { band: 'DAYS_4_7', patterns: [/\bweek\b/i, /வாரம்/] },
  { band: 'DAYS_8_14', patterns: [/\btwo weeks\b/i, /\bfortnight\b/i, /இரண்டு வாரம்/] },
  { band: 'DAYS_15_30', patterns: [/\bmonth\b/i, /மாதம்/] },
  {
    band: 'DAYS_30_PLUS',
    patterns: [/\blong time\b/i, /\bmany months\b/i, /\bover a month\b/i, /நீண்ட காலம்/, /மாதங்கள்/],
  },
];

function bandForDays(days: number): StorageDurationBand {
  if (days <= 3) return 'DAYS_0_3';
  if (days <= 7) return 'DAYS_4_7';
  if (days <= 14) return 'DAYS_8_14';
  if (days <= 30) return 'DAYS_15_30';
  return 'DAYS_30_PLUS';
}

export function normalizeStorageDuration(transcript: string): StorageDurationBand | null {
  const digitMatch = transcript.match(/\d+(\.\d+)?/);
  if (digitMatch) {
    const days = Number.parseFloat(digitMatch[0]);
    if (Number.isFinite(days) && days >= 0) return bandForDays(days);
  }

  for (const { band, patterns } of DURATION_KEYWORDS) {
    if (patterns.some((pattern) => pattern.test(transcript))) return band;
  }

  return null;
}

const TYPE_KEYWORDS: Array<{ type: StorageType; patterns: RegExp[] }> = [
  { type: 'OPEN', patterns: [/\bopen\b/i, /திறந்த/] },
  { type: 'COVERED', patterns: [/\bcover/i, /\btarp/i, /மூடிய/, /மூடி/] },
  { type: 'WAREHOUSE', patterns: [/\bwarehouse\b/i, /\bgodown\b/i, /கிடங்கு/] },
  { type: 'OTHER', patterns: [/\bother\b/i, /மற்றவை/, /வேறு/] },
];

export function normalizeStorageType(transcript: string): StorageType | null {
  for (const { type, patterns } of TYPE_KEYWORDS) {
    if (patterns.some((pattern) => pattern.test(transcript))) return type;
  }
  return null;
}
