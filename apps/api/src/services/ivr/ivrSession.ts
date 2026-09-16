import type {
  AvailableDate,
  BookableCentre,
  Crop,
  Language,
  ProcurementSlot,
  StorageDurationBand,
  StorageType,
} from '@kisansetu/shared';

/**
 * Per-call state (Phase 9 IVR), keyed by Twilio's `CallSid`.
 *
 * Twilio's webhook is stateless HTTP — every `<Gather>` result is a fresh
 * POST, so the call's progress has to live somewhere between requests. A
 * process-local `Map` is enough for a single-instance deployment (mirrors
 * the config caches in bhashiniProvider.ts/weatherProvider.ts); a
 * multi-instance deployment would need this in Redis/the database instead,
 * keyed the same way.
 */
export type IvrStep =
  | 'LANGUAGE'
  | 'CROP'
  | 'QUANTITY'
  | 'STORAGE_DURATION'
  | 'STORAGE_TYPE'
  | 'CENTRE'
  | 'DATE'
  | 'SLOT'
  | 'CONFIRM';

export interface IvrSession {
  callSid: string;
  /** The caller's number as Twilio sent it, E.164 with '+'. Kept as-is (not
   *  normalized) since the LANGUAGE step is the one place that needs it, to
   *  look the farmer up only once the caller's language is known. */
  fromPhone: string;
  userId: string;
  farmerName: string | null;
  step: IvrStep;
  retries: number;

  /** Chosen in the LANGUAGE step; null only while that step is still live. */
  language: Language | null;

  crops: Crop[];
  cropId: string | null;
  cropLabel: string | null;

  quantityKg: number | null;
  storageDurationBand: StorageDurationBand | null;
  storageType: StorageType | null;

  centres: BookableCentre[];
  centreId: string | null;
  centreLabel: string | null;

  dates: AvailableDate[];
  date: string | null;

  slots: ProcurementSlot[];
  slotId: string | null;
  slotLabel: string | null;

  idempotencyKey: string;
  createdAt: number;
}

const MAX_SESSION_AGE_MS = 20 * 60 * 1000; // no real call runs anywhere near this long
const sessions = new Map<string, IvrSession>();

/** Sweeps abandoned calls (hung up without a final POST) before every access,
 *  so the map never grows unbounded across a long-running server process. */
function sweep(): void {
  const cutoff = Date.now() - MAX_SESSION_AGE_MS;
  for (const [callSid, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(callSid);
  }
}

export function getSession(callSid: string): IvrSession | null {
  sweep();
  return sessions.get(callSid) ?? null;
}

export function saveSession(session: IvrSession): void {
  sessions.set(session.callSid, session);
}

export function endSession(callSid: string): void {
  sessions.delete(callSid);
}
