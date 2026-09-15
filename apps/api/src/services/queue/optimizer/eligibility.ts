import type { IneligibleReasonCode } from '@kisansetu/shared';
import { isCompatible } from './scores.js';
import type { CandidateInput, WorkstationInput } from './types.js';

/**
 * Hard queue eligibility (§10).
 *
 * Applied BEFORE any scoring. A candidate that fails here is not ranked at
 * all — no weight, however large, can buy past a missing quality check or a
 * cancelled booking. Centre scope is not re-checked here because candidates
 * are loaded for one centre, resolved from the staff profile, by the service.
 */
export function ineligibleReasons(
  candidate: CandidateInput,
  stations: WorkstationInput[],
): IneligibleReasonCode[] {
  const reasons: IneligibleReasonCode[] = [];

  if (candidate.entryState !== 'QUEUED') reasons.push('NOT_QUEUED');
  if (candidate.bookingStatus !== 'BOOKED') reasons.push('BOOKING_NOT_ACTIVE');
  if (candidate.operationState !== 'WAITING') reasons.push('NOT_WAITING');

  // Verification happened (a mismatch is recorded, not skipped) — Phase 5 §19.
  if (candidate.cropVerified === null) reasons.push('CROP_NOT_VERIFIED');

  if (candidate.qualityResult === null) reasons.push('QUALITY_NOT_READY');
  else if (candidate.qualityResult === 'FAILED') reasons.push('QUALITY_FAILED');

  if (candidate.estimatedProcessingMinutes === null) reasons.push('NO_PROCESSING_ESTIMATE');

  const usable = stations.some(
    (station) => station.status !== 'OFFLINE' && isCompatible(station, candidate.cropId),
  );
  if (!usable) reasons.push('NO_COMPATIBLE_WORKSTATION');

  return reasons;
}
