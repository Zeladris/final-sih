import { z } from 'zod';
import {
  ALL_FEEDBACK_CATEGORIES,
  ALL_GRIEVANCE_CATEGORIES,
  ALL_GRIEVANCE_STATUSES,
  ALL_SUPPORT_SCOPE_TYPES,
} from '@kisansetu/shared';
import { httpUrlSchema, uuidSchema } from './common.js';

const enumOf = <T extends string>(values: readonly T[]) => z.enum(values as [T, ...T[]]);

// ---------------------------------------------------------------------------
// Feedback (§4, §5)
// ---------------------------------------------------------------------------

export const submitFeedbackSchema = z
  .object({
    category: enumOf(ALL_FEEDBACK_CATEGORIES),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    message: z.string().trim().max(2000).nullable().optional(),
    bookingId: uuidSchema.nullable().optional(),
    procurementId: uuidSchema.nullable().optional(),
    centreId: uuidSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.rating != null || (value.message ?? '').trim().length > 0,
    { message: 'Add a rating or a message.', path: ['message'] },
  );

// ---------------------------------------------------------------------------
// Grievances (§6, §11)
// ---------------------------------------------------------------------------

export const submitGrievanceSchema = z
  .object({
    category: enumOf(ALL_GRIEVANCE_CATEGORIES),
    subCategory: z.string().trim().max(120).nullable().optional(),
    subject: z.string().trim().min(3).max(200),
    description: z.string().trim().min(10).max(4000),
    bookingId: uuidSchema.nullable().optional(),
    procurementId: uuidSchema.nullable().optional(),
  })
  .strict();

export const grievanceListQuerySchema = z.object({
  status: enumOf(ALL_GRIEVANCE_STATUSES).optional(),
  category: enumOf(ALL_GRIEVANCE_CATEGORIES).optional(),
  centreId: uuidSchema.optional(),
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const changeGrievanceStatusSchema = z
  .object({
    status: enumOf(ALL_GRIEVANCE_STATUSES),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();

export const grievanceResponseSchema = z
  .object({ message: z.string().trim().min(1).max(4000) })
  .strict();

export const grievanceNoteSchema = z.object({ note: z.string().trim().min(1).max(4000) }).strict();

export const grievanceAssignSchema = z
  .object({ userId: uuidSchema })
  .strict();

export const grievanceEscalateSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();

// ---------------------------------------------------------------------------
// Helpline (§18, §21)
// ---------------------------------------------------------------------------

const localizedProseField = (max: number) => z.string().trim().max(max).nullable().optional();

const helplineBaseSchema = z
  .object({
    titleEn: z.string().trim().min(1).max(200),
    titleTa: localizedProseField(200),
    titleKn: localizedProseField(200),
    titleHi: localizedProseField(200),
    titleMl: localizedProseField(200),
    descriptionEn: localizedProseField(1000),
    descriptionTa: localizedProseField(1000),
    descriptionKn: localizedProseField(1000),
    descriptionHi: localizedProseField(1000),
    descriptionMl: localizedProseField(1000),
    phoneNumber: z.string().trim().max(30).nullable().optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    officeName: z.string().trim().max(200).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    scopeType: enumOf(ALL_SUPPORT_SCOPE_TYPES),
    stateId: uuidSchema.nullable().optional(),
    districtId: uuidSchema.nullable().optional(),
    centreId: uuidSchema.nullable().optional(),
    category: z.string().trim().min(1).max(60),
    officialUrl: httpUrlSchema.nullable().optional(),
    sourceReference: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const createHelplineSchema = helplineBaseSchema.refine(
  (v) => v.phoneNumber || v.email || v.officialUrl,
  { message: 'Add a phone number, email, or official link.', path: ['phoneNumber'] },
);

export const updateHelplineSchema = helplineBaseSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Government schemes (§23, §31)
// ---------------------------------------------------------------------------

export const createSchemeSchema = z
  .object({
    schemeCode: z.string().trim().max(60).nullable().optional(),
    nameEn: z.string().trim().min(1).max(200),
    nameTa: localizedProseField(200),
    nameKn: localizedProseField(200),
    nameHi: localizedProseField(200),
    nameMl: localizedProseField(200),
    shortDescriptionEn: localizedProseField(300),
    descriptionEn: localizedProseField(4000),
    authorityName: z.string().trim().min(1).max(200),
    departmentName: z.string().trim().max(200).nullable().optional(),
    level: enumOf(['NATIONAL', 'STATE', 'DISTRICT'] as const),
    stateId: uuidSchema.nullable().optional(),
    districtId: uuidSchema.nullable().optional(),
    category: z.string().trim().min(1).max(60),
    benefitSummaryEn: localizedProseField(2000),
    eligibilitySummaryEn: localizedProseField(2000),
    documentsSummaryEn: localizedProseField(2000),
    applicationMethodEn: localizedProseField(2000),
    relevantCropCodes: z.array(z.string().trim().max(40)).max(50).optional(),
    officialUrl: httpUrlSchema.nullable().optional(),
    sourceReference: z.string().trim().min(1).max(500),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .strict();

export const updateSchemeSchema = createSchemeSchema.partial();

export const schemeListQuerySchema = z.object({
  category: z.string().trim().max(60).optional(),
  search: z.string().trim().max(80).optional(),
  savedOnly: z.coerce.boolean().optional(),
});

// ---------------------------------------------------------------------------
// FAQs (§34)
// ---------------------------------------------------------------------------

export const createFaqSchema = z
  .object({
    category: z.string().trim().min(1).max(60),
    questionEn: z.string().trim().min(1).max(300),
    questionTa: localizedProseField(300),
    questionKn: localizedProseField(300),
    questionHi: localizedProseField(300),
    questionMl: localizedProseField(300),
    answerEn: z.string().trim().min(1).max(2000),
    answerTa: localizedProseField(2000),
    answerKn: localizedProseField(2000),
    answerHi: localizedProseField(2000),
    answerMl: localizedProseField(2000),
    scopeType: enumOf(ALL_SUPPORT_SCOPE_TYPES).optional(),
    stateId: uuidSchema.nullable().optional(),
    districtId: uuidSchema.nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

export const updateFaqSchema = createFaqSchema.partial().extend({ isActive: z.boolean().optional() });
