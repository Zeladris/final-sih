import type { Request, Response } from 'express';
import { REVIEW_DECISIONS } from '@kisansetu/shared';
import type { ReviewDecision } from '@kisansetu/shared';
import { authOf } from '../middleware/auth.js';
import { recordAudit } from '../services/audit/auditService.js';
import { createReviewDocumentUrl } from '../services/verification/documentAccessService.js';
import {
  claimSubmission,
  decide,
  getQueue,
  getSubmission,
  releaseSubmission,
} from '../services/verification/reviewService.js';

/**
 * District admin farmer verification (Phase 14).
 *
 * Administrative verification — profile, land, documents, photograph — is
 * this role's alone. Every handler resolves its district from the
 * authenticated district admin's own profile (via RLS + `app.admin_district_id()`
 * inside the service/repository layer) — never from a request parameter, so
 * there is no `districtId`/`adminId`/`farmerId`-as-scope to trust or distrust.
 */

/** GET /api/admin/district/verification-queue */
export async function getDistrictVerificationQueue(req: Request, res: Response): Promise<void> {
  res.json(await getQueue(authOf(req)));
}

/** GET /api/admin/district/verification/:farmerUserId */
export async function getDistrictVerificationSubmission(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const farmerUserId = req.params.farmerUserId as string;

  res.json(await getSubmission(auth, farmerUserId));
}

/** POST /api/admin/district/verification/:farmerUserId/claim */
export async function postDistrictVerificationClaim(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const farmerUserId = req.params.farmerUserId as string;

  const submission = await claimSubmission(auth, farmerUserId);

  await recordAudit(req, {
    action: 'REVIEW_STARTED',
    entityType: 'farmer_profiles',
    entityId: farmerUserId,
    metadata: { farmerReferenceId: submission.farmer.farmerReferenceId },
  });

  res.json(submission);
}

/** POST /api/admin/district/verification/:farmerUserId/release */
export async function postDistrictVerificationRelease(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const farmerUserId = req.params.farmerUserId as string;

  const submission = await releaseSubmission(auth, farmerUserId);

  await recordAudit(req, {
    action: 'REVIEW_RELEASED',
    entityType: 'farmer_profiles',
    entityId: farmerUserId,
  });

  res.json(submission);
}

/**
 * POST /api/admin/district/verification/:farmerUserId/decision
 *
 * One endpoint for all three outcomes (approve, request correction, reject),
 * because they share the same authorization, concurrency and audit
 * requirements. There is deliberately no generic status-update endpoint.
 *
 * Every decision is audited with the reviewer, their district (from
 * `auth.scope`, never the request), the previous and new status, the reason
 * and a timestamp — `recordAudit` fills the first three from the
 * authenticated context automatically.
 */
export async function postDistrictVerificationDecision(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const farmerUserId = req.params.farmerUserId as string;
  const body = req.body as { decision: ReviewDecision; reason?: string };

  const { submission, outcome, previousStatus } = await decide(auth, farmerUserId, {
    decision: body.decision,
    reason: body.reason ?? null,
  });

  const action =
    body.decision === REVIEW_DECISIONS.APPROVE
      ? 'VERIFICATION_APPROVED'
      : body.decision === REVIEW_DECISIONS.REQUEST_CORRECTION
        ? 'CORRECTION_REQUESTED'
        : 'VERIFICATION_REJECTED';

  await recordAudit(req, {
    action,
    entityType: 'farmer_profiles',
    entityId: farmerUserId,
    metadata: {
      farmerReferenceId: submission.farmer.farmerReferenceId,
      from: previousStatus,
      to: outcome,
      // The reason is shown to the farmer, so it is not sensitive — but it is
      // truncated here because an audit row is not a transcript.
      reason: body.reason ? body.reason.slice(0, 200) : null,
    },
  });

  await recordAudit(req, {
    action: 'VERIFICATION_STATUS_CHANGED',
    entityType: 'farmer_profiles',
    entityId: farmerUserId,
    metadata: { from: previousStatus, to: outcome },
  });

  res.json(submission);
}

/** GET /api/admin/district/documents/:id/url — short-lived signed URL (§13). */
export async function getDistrictVerificationDocumentUrl(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const documentId = req.params.id as string;

  const signed = await createReviewDocumentUrl(auth.db, documentId);

  await recordAudit(req, {
    action: 'DOCUMENT_ACCESSED',
    entityType: 'farmer_documents',
    entityId: documentId,
    metadata: { by: 'DISTRICT_ADMIN' },
  });

  res.json(signed);
}
