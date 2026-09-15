import { isCompatible } from './scores.js';
import type { WorkstationInput } from './types.js';

/**
 * Estimated wait (§37).
 *
 * Not "position × fixed minutes". The ranked queue is replayed onto the
 * compatible, non-offline workstations: each farmer starts on whichever
 * compatible station frees up first, and occupies it for their own estimated
 * processing time. A busy station starts from its remaining time.
 *
 * A farmer with no compatible station gets null — "unknown" is honest; a
 * number would not be.
 */
export function estimateWaits(
  ordered: Array<{ bookingId: string; cropId: string | null; estimatedMinutes: number }>,
  stations: WorkstationInput[],
  fallbackRemainingMinutes: number,
): Map<string, number | null> {
  const free = stations
    .filter((station) => station.status !== 'OFFLINE')
    .map((station) => ({
      station,
      freeInMinutes:
        station.status === 'AVAILABLE'
          ? 0
          : Math.max(0, station.remainingMinutes ?? fallbackRemainingMinutes),
    }));

  const waits = new Map<string, number | null>();

  for (const job of ordered) {
    const options = free
      .filter((slot) => isCompatible(slot.station, job.cropId))
      .sort(
        (a, b) =>
          a.freeInMinutes - b.freeInMinutes || a.station.code.localeCompare(b.station.code),
      );

    const chosen = options[0];
    if (!chosen) {
      waits.set(job.bookingId, null);
      continue;
    }

    waits.set(job.bookingId, Math.ceil(chosen.freeInMinutes));
    chosen.freeInMinutes += job.estimatedMinutes;
  }

  return waits;
}
