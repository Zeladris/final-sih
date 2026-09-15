import { z } from 'zod';
import { MAX_REASON_LENGTH, MIN_REASON_LENGTH, REVIEW_DECISIONS } from '@kisansetu/shared';

/**
 * Review decision payload (§15, §38).
 *
 * The reason requirement is expressed in the schema rather than only in the
 * service, so an empty rejection is refused before any business logic runs.
 * The service checks it again — this is validation, not authorization.
 */
export const reviewDecisionSchema = z
  .object({
    decision: z.enum([
      REVIEW_DECISIONS.APPROVE,
      REVIEW_DECISIONS.REQUEST_CORRECTION,
      REVIEW_DECISIONS.REJECT,
    ]),
    reason: z.string().trim().max(MAX_REASON_LENGTH).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === REVIEW_DECISIONS.APPROVE) return;

    if (!value.reason || value.reason.length < MIN_REASON_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: `Explain what the farmer needs to do, in at least ${MIN_REASON_LENGTH} characters.`,
      });
    }
  });

export type ReviewDecisionBody = z.infer<typeof reviewDecisionSchema>;
