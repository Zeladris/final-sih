import { z } from 'zod';
import { uuidSchema } from './common.js';

const audienceTypeSchema = z.enum(['FARMER', 'CENTRE', 'DISTRICT', 'STATE']);
const prioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const proseSchema = (max: number) => z.string().trim().min(1).max(max);

/**
 * POST /api/farmer-messages (§21, §22).
 *
 * Mirrors the database's own `farmer_messages_audience_consistency` check —
 * rejected here with a message the composer can show next to the right
 * field, and rejected again at the database if this layer is ever bypassed.
 */
export const createFarmerMessageSchema = z
  .object({
    audienceType: audienceTypeSchema,
    audienceStateId: uuidSchema.nullable().optional(),
    audienceDistrictId: uuidSchema.nullable().optional(),
    audienceCentreId: uuidSchema.nullable().optional(),
    audienceFarmerId: uuidSchema.nullable().optional(),

    titleEn: proseSchema(200),
    bodyEn: proseSchema(2000),
    titleTa: proseSchema(200).nullable().optional(),
    bodyTa: proseSchema(2000).nullable().optional(),
    titleKn: proseSchema(200).nullable().optional(),
    bodyKn: proseSchema(2000).nullable().optional(),
    titleHi: proseSchema(200).nullable().optional(),
    bodyHi: proseSchema(2000).nullable().optional(),
    titleMl: proseSchema(200).nullable().optional(),
    bodyMl: proseSchema(2000).nullable().optional(),

    priority: prioritySchema.optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fields = {
      FARMER: value.audienceFarmerId,
      CENTRE: value.audienceCentreId,
      DISTRICT: value.audienceDistrictId,
      STATE: value.audienceStateId,
    } as const;

    for (const [type, id] of Object.entries(fields)) {
      const shouldBeSet = type === value.audienceType;
      if (shouldBeSet && !id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [`audience${type[0]}${type.slice(1).toLowerCase()}Id`],
          message: `Required when the audience is ${value.audienceType}.`,
        });
      }
      if (!shouldBeSet && id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [`audience${type[0]}${type.slice(1).toLowerCase()}Id`],
          message: `Must be empty unless the audience is ${type}.`,
        });
      }
    }
  });

export type CreateFarmerMessageBody = z.infer<typeof createFarmerMessageSchema>;

export const messageHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
});
