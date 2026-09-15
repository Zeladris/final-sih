import { cropMatches } from '@kisansetu/shared';
import type { Crop } from '@kisansetu/shared';

/**
 * Common English words for a crop the real catalogue names differently
 * (§9's example: "rice" for paddy). Tamil rarely needs this layer because
 * `cropMatches` already does substring matching against the Tamil name, and
 * a spoken alternate Tamil word for a crop is uncommon enough not to guess
 * at. This is a normalization aid on top of the real, fetched crop list —
 * never a second catalogue: an alias that matches no crop in the response
 * simply falls through to "not understood" (§9, §32).
 */
const ENGLISH_ALIASES: Record<string, string> = {
  rice: 'PADDY',
  corn: 'MAIZE',
  peanut: 'GROUNDNUT',
  peanuts: 'GROUNDNUT',
  groundnuts: 'GROUNDNUT',
  urad: 'BLACK_GRAM',
  'urad dal': 'BLACK_GRAM',
  'black gram dal': 'BLACK_GRAM',
  moong: 'GREEN_GRAM',
  'moong dal': 'GREEN_GRAM',
  'green gram dal': 'GREEN_GRAM',
};

/**
 * Turns a spoken transcript into one crop from the real, fetched list — or
 * `null` when the match is not confident enough to accept silently (§9). The
 * caller re-asks or falls back to the visual list on `null`; it must never
 * guess.
 */
export function normalizeCrop(transcript: string, crops: readonly Crop[]): Crop | null {
  const needle = transcript.trim().toLowerCase();
  if (!needle) return null;

  const exact = crops.find(
    (crop) => crop.nameEn.toLowerCase() === needle || crop.nameTa === transcript.trim(),
  );
  if (exact) return exact;

  const aliasCode =
    ENGLISH_ALIASES[needle] ??
    Object.entries(ENGLISH_ALIASES).find(([alias]) => needle.includes(alias))?.[1];
  if (aliasCode) {
    const byCode = crops.find((crop) => crop.code === aliasCode);
    if (byCode) return byCode;
  }

  const matches = crops.filter((crop) => cropMatches(crop, needle));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;

  // Several varieties share a stem (Paddy / Paddy (Samba) / Paddy (Kuruvai)):
  // prefer the one whose name starts with what was said, i.e. the more
  // general variety, rather than guessing a specific one the farmer never
  // named.
  const starts = matches.find(
    (crop) =>
      crop.nameEn.toLowerCase().startsWith(needle) || crop.nameTa.startsWith(transcript.trim()),
  );
  return starts ?? matches[0]!;
}
