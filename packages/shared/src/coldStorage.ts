/**
 * Cold storage (demo addition).
 *
 * A sibling fact about ONE booking, not a new step in the farmer status
 * machine (see procurementStatus.ts) or the procurement/queue pipeline. A
 * booking either has no offer (fully procured, or not weighed yet), an open
 * offer (some crop could not be procured today and no reservation exists
 * yet), or a reservation (the farmer already chose a facility).
 */

export interface ColdStorageFacility {
  id: string;
  name: string;
  location: string;
  capacityKg: number;
  availableCapacityKg: number;
}

/**
 * Present only when this booking's own procurement, once weighed, left crop
 * that was not procured — never derived from any other farmer's data.
 */
export interface ColdStorageOffer {
  cropName: string;
  remainingQuantityKg: number;
}

export type ColdStorageBookingStatus = 'RESERVED' | 'CANCELLED';

export interface ColdStorageBooking {
  id: string;
  bookingReference: string;
  facilityName: string;
  facilityLocation: string;
  cropName: string;
  quantityKg: number;
  status: ColdStorageBookingStatus;
  createdAt: string;
}

/** GET /api/farmer/bookings/:bookingId/cold-storage */
export interface ColdStorageStatusResponse {
  /** Non-null only when there is crop to store AND no reservation yet. */
  offer: ColdStorageOffer | null;
  /** Non-null once the farmer has reserved a facility for this booking. */
  reservation: ColdStorageBooking | null;
}

/** POST /api/farmer/bookings/:bookingId/cold-storage */
export interface ReserveColdStorageRequest {
  facilityId: string;
}
