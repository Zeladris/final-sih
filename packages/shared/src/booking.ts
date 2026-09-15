import type { BookingStatus, ProcurementSlot } from './operations.js';
import type { FarmerAccountState } from './account.js';
import type { Language } from './language.js';
import type { FarmerProcurementStatus } from './procurementStatus.js';

/**
 * Farmer crop & slot booking (Phase 4).
 *
 * The farmer's half of the loop: choose a crop, say how much and where it is
 * stored, pick a centre, a date and a slot. Everything after arrival belongs
 * to Phase 5 (§3).
 */

export interface Crop {
  id: string;
  code: string;
  nameEn: string;
  nameTa: string;
  unit: string;
  isProcurable: boolean;
}

/** The crop's name in the reader's language — never machine-translated. */
export function cropName(crop: Crop, language: Language): string {
  return language === 'ta' ? crop.nameTa : crop.nameEn;
}

/** Matches in either script, so "நெல்" finds Paddy and so does "padd" (§10). */
export function cropMatches(crop: Crop, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;

  return (
    crop.nameEn.toLowerCase().includes(needle) ||
    crop.nameTa.includes(query.trim()) ||
    crop.code.toLowerCase().includes(needle)
  );
}

export interface BookableCentre {
  id: string;
  code: string;
  name: string;
  village: string | null;
  districtName: string | null;
  openTime: string | null;
  closeTime: string | null;
  /** Slots with capacity left, across the bookable horizon. */
  availableSlotCount: number;
  /** Straight-line km from the produce location, when one was given. */
  distanceKm: number | null;
}

export interface AvailableDate {
  date: string;
  slotCount: number;
  remainingCapacity: number;
}

export interface AvailabilityResponse {
  centre: { id: string; name: string };
  crop: { id: string; name: string };
  dates: AvailableDate[];
}

export interface SlotAvailability {
  date: string;
  slots: ProcurementSlot[];
}

// ---------------------------------------------------------------------------
// Eligibility (§4)
// ---------------------------------------------------------------------------

export const BOOKING_ELIGIBILITY = {
  ELIGIBLE: 'ELIGIBLE',
  REGISTRATION_INCOMPLETE: 'REGISTRATION_INCOMPLETE',
  AWAITING_VERIFICATION: 'AWAITING_VERIFICATION',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  NO_PROFILE: 'NO_PROFILE',
} as const;

export type BookingEligibility =
  (typeof BOOKING_ELIGIBILITY)[keyof typeof BOOKING_ELIGIBILITY];

/**
 * Only a verified farmer may book.
 *
 * Derived from the same account state the dashboard uses, so the rule cannot
 * drift between the two — and the server applies it again on creation, because
 * a UI that hides a button is not a control (§4).
 */
export function eligibilityFor(state: FarmerAccountState): BookingEligibility {
  switch (state) {
    case 'VERIFIED':
      return BOOKING_ELIGIBILITY.ELIGIBLE;
    case 'REGISTRATION_INCOMPLETE':
      return BOOKING_ELIGIBILITY.REGISTRATION_INCOMPLETE;
    case 'AWAITING_REVIEW':
      return BOOKING_ELIGIBILITY.AWAITING_VERIFICATION;
    case 'ACTION_REQUIRED':
      return BOOKING_ELIGIBILITY.ACTION_REQUIRED;
    default:
      return BOOKING_ELIGIBILITY.NO_PROFILE;
  }
}

export function isEligibleToBook(eligibility: BookingEligibility): boolean {
  return eligibility === BOOKING_ELIGIBILITY.ELIGIBLE;
}

/** Where an ineligible farmer should be sent to fix it. */
export const ELIGIBILITY_DESTINATION: Record<BookingEligibility, string | null> = {
  ELIGIBLE: null,
  REGISTRATION_INCOMPLETE: '/farmer/welcome',
  AWAITING_VERIFICATION: '/farmer/status',
  ACTION_REQUIRED: '/farmer/status',
  NO_PROFILE: '/farmer/registration/start',
};

// ---------------------------------------------------------------------------
// The booking itself
// ---------------------------------------------------------------------------

/**
 * How long the produce has been in storage (§6).
 *
 * Bands, not a number the farmer has to compute: "about a week" is a question
 * a person can answer standing in their field. The representative day count
 * below is what the model is given as context.
 */
export const STORAGE_DURATION_BANDS = {
  DAYS_0_3: 'DAYS_0_3',
  DAYS_4_7: 'DAYS_4_7',
  DAYS_8_14: 'DAYS_8_14',
  DAYS_15_30: 'DAYS_15_30',
  DAYS_30_PLUS: 'DAYS_30_PLUS',
} as const;

export type StorageDurationBand =
  (typeof STORAGE_DURATION_BANDS)[keyof typeof STORAGE_DURATION_BANDS];

export const ALL_STORAGE_DURATION_BANDS: readonly StorageDurationBand[] =
  Object.values(STORAGE_DURATION_BANDS);

/** The representative day count for a band, for contextual assessment only. */
export const STORAGE_DURATION_DAYS: Record<StorageDurationBand, number> = {
  DAYS_0_3: 2,
  DAYS_4_7: 6,
  DAYS_8_14: 11,
  DAYS_15_30: 22,
  DAYS_30_PLUS: 45,
};

export const STORAGE_TYPES = {
  OPEN: 'OPEN',
  COVERED: 'COVERED',
  WAREHOUSE: 'WAREHOUSE',
  OTHER: 'OTHER',
} as const;

export type StorageType = (typeof STORAGE_TYPES)[keyof typeof STORAGE_TYPES];
export const ALL_STORAGE_TYPES: readonly StorageType[] = Object.values(STORAGE_TYPES);

export interface FarmerBooking {
  id: string;
  bookingReference: string;
  cropId: string | null;
  cropName: string;
  expectedQuantityKg: number;
  quantityUnit: string;
  harvestDate: string | null;

  storageLocationText: string | null;
  storagePlaceName: string | null;
  hasStorageCoordinates: boolean;
  storageDurationBand: StorageDurationBand | null;
  storageType: StorageType | null;

  centreId: string;
  centreName: string;
  centreVillage: string | null;

  slotDate: string;
  slotStart: string;
  slotEnd: string;

  status: BookingStatus;
  hasProducePhoto: boolean;

  /** Where the centre has got to, once Phase 5 starts processing it. */
  operationState: string | null;
  /** The farmer-facing status (Phase 6), derived by the database. */
  farmerStatus: FarmerProcurementStatus;

  createdAt: string;
  cancelledAt: string | null;
}

export interface CreateBookingRequest {
  cropId: string;
  expectedQuantityKg: number;
  harvestDate?: string | null;
  storageLocationText: string;
  storagePlaceName?: string | null;
  storageLatitude?: number | null;
  storageLongitude?: number | null;
  storageDurationBand?: StorageDurationBand | null;
  storageType?: StorageType | null;
  /**
   * The pre-arrival assessment made earlier in this booking (§34). Optional:
   * if the AI was unavailable there is none, and the booking still stands.
   */
  qualityAssessmentId?: string | null;
  slotId: string;
  /** Generated once when the review screen opens, so a retry is safe (§51). */
  idempotencyKey: string;
  /**
   * How the farmer filled this in (Phase 9). Observability only — it changes
   * nothing about validation, eligibility or persistence, and voice gets no
   * queue or booking advantage from it. Defaults to 'standard' so an older
   * client needs no change.
   */
  bookingMethod?: 'standard' | 'voice';
}

/** Quantity bounds. Generous, because a co-operative delivery can be large. */
export const MIN_QUANTITY_KG = 1;
export const MAX_QUANTITY_KG = 100_000;

/** How far ahead a farmer may book. */
export const BOOKING_HORIZON_DAYS = 14;

export function isCancellable(booking: FarmerBooking): boolean {
  // Once the centre has started work the farmer no longer owns the outcome (§35).
  if (booking.status !== 'BOOKED') return false;
  return booking.operationState === null || booking.operationState === 'BOOKED';
}
