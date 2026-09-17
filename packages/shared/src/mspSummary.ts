/**
 * Demo/indicative MSP information for a farmer's OWN booking (demo addition).
 *
 * Never an official government MSP — `source_type` on the underlying rate is
 * always 'CONFIGURED' (a manually entered demo figure), the exact same rate
 * `confirmProcurement` itself resolves at settlement (see mspService.ts).
 * This is a read-only preview of that same number, shown earlier and kept
 * updated — it never decides or overrides the real payment.
 */
export interface MspSummary {
  cropName: string;
  /** ₹ per kg, as a decimal string (matches ProcurementRate.ratePerKg). */
  ratePerKg: string;
  bookedQuantityKg: number;
  /** Null until this booking has actually been weighed. */
  procuredQuantityKg: number | null;
  /** bookedQuantityKg - procuredQuantityKg once known; 0 once fully procured. */
  remainingQuantityKg: number | null;
  /**
   * (procuredQuantityKg ?? bookedQuantityKg) × ratePerKg — never the booked
   * figure once a smaller procured figure is known (as a decimal string).
   */
  estimatedValue: string;
  /** True once procuredQuantityKg is the final settled figure (booking COMPLETED). */
  isFinal: boolean;
}

/** GET /api/farmer/bookings/:bookingId/msp-summary */
export interface MspSummaryResponse {
  /** Null when the crop has no catalogue entry or no MSP rate is configured. */
  summary: MspSummary | null;
}
