import { z } from 'zod';
import {
  ALL_STORAGE_DURATION_BANDS,
  ALL_STORAGE_TYPES,
  MAX_QUANTITY_KG,
  MIN_QUANTITY_KG,
} from '@kisansetu/shared';
import { calendarDateSchema, latitudeSchema, longitudeSchema, uuidSchema } from './common.js';

const storageDurationBandSchema = z.enum(
  ALL_STORAGE_DURATION_BANDS as unknown as [string, ...string[]],
);
const storageTypeSchema = z.enum(ALL_STORAGE_TYPES as unknown as [string, ...string[]]);

/**
 * Booking request validation (§39).
 *
 * Mirrors the service checks rather than replacing them: this rejects
 * malformed input early, the service enforces the business rules, and the
 * database enforces capacity. All three are deliberate.
 */
export const createBookingSchema = z
  .object({
    cropId: uuidSchema,
    expectedQuantityKg: z
      .number()
      .min(MIN_QUANTITY_KG, 'Enter how much produce you plan to bring.')
      .max(MAX_QUANTITY_KG, 'Check the quantity entered.'),
    harvestDate: calendarDateSchema.nullable().optional(),

    // Required: assuming the produce sits at the farm is exactly the guess
    // §14 forbids.
    storageLocationText: z
      .string()
      .trim()
      .min(2, 'Tell us where the produce is currently stored.')
      .max(300),
    storagePlaceName: z.string().trim().max(200).nullable().optional(),
    storageLatitude: latitudeSchema.nullable().optional(),
    storageLongitude: longitudeSchema.nullable().optional(),

    // Storage context (§6). Optional: an older client, or a farmer who
    // skipped it, still books.
    storageDurationBand: storageDurationBandSchema.nullable().optional(),
    storageType: storageTypeSchema.nullable().optional(),

    // The pre-arrival assessment, if one was made (§34). Optional by design:
    // a failed or skipped assessment never blocks a booking (§13).
    qualityAssessmentId: uuidSchema.nullable().optional(),

    slotId: uuidSchema,
    idempotencyKey: z.string().uuid('A booking key is required.'),

    // Observability only (Phase 9 §46) — never read by eligibility, capacity
    // or the queue. A missing value means an older client, treated the same
    // as 'standard'.
    bookingMethod: z.enum(['standard', 'voice', 'ivr']).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.storageLatitude === null || value.storageLatitude === undefined) ===
      (value.storageLongitude === null || value.storageLongitude === undefined),
    { message: 'Provide both latitude and longitude, or neither.', path: ['storageLatitude'] },
  );

export const cancelBookingSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();

/** Multipart companion for the pre-arrival assessment: everything but the photo. */
export const assessProduceSchema = z
  .object({
    cropId: uuidSchema,
    expectedQuantityKg: z.coerce
      .number()
      .min(MIN_QUANTITY_KG, 'Enter how much produce you plan to bring.')
      .max(MAX_QUANTITY_KG, 'Check the quantity entered.'),
    storageDurationBand: storageDurationBandSchema.optional(),
    storageType: storageTypeSchema.optional(),
    storageLatitude: z.coerce.number().min(-90).max(90).optional(),
    storageLongitude: z.coerce.number().min(-180).max(180).optional(),
  })
  .strict();

export const cropQuerySchema = z
  .object({
    cropId: uuidSchema,
    lat: z.string().optional(),
    lon: z.string().optional(),
  })
  .strict();

export const datesQuerySchema = z
  .object({ cropId: uuidSchema, centreId: uuidSchema })
  .strict();

export const slotsQuerySchema = z
  .object({ cropId: uuidSchema, centreId: uuidSchema, date: calendarDateSchema })
  .strict();
