import { z } from 'zod';
import {
  ALL_SLOT_STATUSES,
  MIN_REMARKS_LENGTH,
  QUALITY_RESULTS,
  SESSION_STATUSES,
} from '@kisansetu/shared';
import type { QualityResult, SessionStatus, SlotStatus } from '@kisansetu/shared';
import { calendarDateSchema } from './common.js';

const enumOf = <T extends string>(values: readonly T[], message: string) =>
  z.enum([...values] as [T, ...T[]], { errorMap: () => ({ message }) });

/** "HH:MM", 24-hour, local wall clock. */
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00.');

export const sessionTransitionSchema = z
  .object({
    status: enumOf<SessionStatus>(
      Object.values(SESSION_STATUSES),
      'Unknown session status.',
    ),
  })
  .strict();

export const createSlotSchema = z
  .object({
    slotDate: calendarDateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    capacity: z
      .number()
      .int('Capacity must be a whole number.')
      .positive('Capacity must be at least 1.')
      .max(500, 'That capacity is unrealistically high.'),
  })
  .strict()
  .refine((value) => value.startTime < value.endTime, {
    message: 'The slot must end after it starts.',
    path: ['endTime'],
  });

export const updateSlotSchema = z
  .object({
    capacity: z.number().int().positive().max(500).optional(),
    status: enumOf<SlotStatus>([...ALL_SLOT_STATUSES], 'Unknown slot status.').optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to update.',
  });

/** A produce mismatch must be described, never waved through (§19). */
export const verifyCropSchema = z
  .object({
    matches: z.boolean(),
    issue: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.matches && (!value.issue || value.issue.length < MIN_REMARKS_LENGTH)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['issue'],
        message: 'Describe the problem with the produce.',
      });
    }
  });

/** A failed or conditional quality result must carry a reason (§21). */
export const qualitySchema = z
  .object({
    result: enumOf<QualityResult>(
      [QUALITY_RESULTS.PASSED, QUALITY_RESULTS.FAILED, QUALITY_RESULTS.CONDITIONAL],
      'Choose a quality result.',
    ),
    observedCrop: z.string().trim().max(120).optional(),
    remarks: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.result !== QUALITY_RESULTS.PASSED) {
      if (!value.remarks || value.remarks.length < MIN_REMARKS_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['remarks'],
          message: 'Record why the produce did not pass.',
        });
      }
    }
  });

/** At most three decimals: scales report grams, and more would be invented precision. */
const kilograms = z
  .number()
  .max(1_000_000, 'Check the weight entered.')
  .refine((value) => Number.isInteger(Math.round(value * 1000)) && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, {
    message: 'Weights are recorded to the nearest gram (three decimals).',
  });

export const weighSchema = z
  .object({
    receivedQuantityKg: kilograms.refine((value) => value > 0, 'Enter the weight received.'),
    rejectedQuantityKg: kilograms.refine((value) => value >= 0, 'The rejected quantity cannot be negative.').optional(),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .strict();

export const slotRangeSchema = z
  .object({
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .strict();
