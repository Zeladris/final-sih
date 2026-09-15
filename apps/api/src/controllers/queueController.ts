import type { Request, Response } from 'express';
import { businessToday } from '@kisansetu/shared';
import { env } from '../config/env.js';
import { authOf } from '../middleware/auth.js';
import { validationError } from '../lib/errors.js';
import { recordAudit } from '../services/audit/auditService.js';
import { single } from '../services/procurement/operationsService.js';
import {
  getAssessment,
  overrideEstimate,
  runAiAssessment,
} from '../services/quality/qualityService.js';
import {
  getCandidate,
  getComparison,
  getExplanation,
  getMetrics,
  getQueueView,
  listWorkstationViews,
  recalculateQuietly,
  removeCandidate,
  requeueCandidate,
  selectCandidate,
  setWorkstationStatus,
} from '../services/queue/queueService.js';

/**
 * Queue and quality endpoints (Phase 7).
 *
 * As everywhere in the staff API, the centre comes from the staff profile.
 * No handler accepts a centre id, a farmer id, a rank or a score: the client
 * can ask to START someone, never to PLACE someone.
 */

const dateParam = (req: Request): string => {
  const date = (req.query.date as string | undefined) ?? businessToday(env.APP_TIMEZONE);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw validationError('Use a date like 2026-09-14.');
  return date;
};

const bookingIdOf = (req: Request): string => req.params.bookingId as string;

export async function getQueue(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  res.json(await getQueueView(authOf(req)));
}

export async function getQueueCandidates(req: Request, res: Response): Promise<void> {
  const view = await getQueueView(authOf(req));
  res.json({ candidates: view.candidates, ineligible: view.ineligible });
}

export async function getQueueNext(req: Request, res: Response): Promise<void> {
  const view = await getQueueView(authOf(req));
  res.json({ next: view.next, snapshotId: view.snapshotId, generatedAt: view.generatedAt });
}

export async function getQueueCandidate(req: Request, res: Response): Promise<void> {
  res.json({ candidate: await getCandidate(authOf(req), bookingIdOf(req)) });
}

export async function getQueueExplanation(req: Request, res: Response): Promise<void> {
  res.json(await getExplanation(authOf(req), bookingIdOf(req)));
}

export async function postQueueRecalculate(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  if (auth.scope.centreId) await recalculateQuietly(auth.scope.centreId, 'MANUAL');
  res.json(await getQueueView(auth));
}

export async function postQueueSelect(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = bookingIdOf(req);
  const body = req.body as { workstationId: string; overrideReason?: string };

  const { decision } = await selectCandidate(auth, bookingId, body);

  await recordAudit(req, {
    action: 'QUEUE_CANDIDATE_SELECTED',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: { decision, workstationId: body.workstationId, overrideReason: body.overrideReason ?? null },
  });

  res.json({ decision, booking: await single(auth, bookingId) });
}

export async function postQueueRemove(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = bookingIdOf(req);
  const { reason } = req.body as { reason: string };

  await removeCandidate(auth, bookingId, reason);

  await recordAudit(req, {
    action: 'QUEUE_CANDIDATE_REMOVED',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: { reason },
  });

  res.json({ booking: await single(auth, bookingId) });
}

export async function postQueueRequeue(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = bookingIdOf(req);

  await requeueCandidate(auth, bookingId);

  await recordAudit(req, {
    action: 'QUEUE_CANDIDATE_REQUEUED',
    entityType: 'bookings',
    entityId: bookingId,
  });

  res.json({ booking: await single(auth, bookingId) });
}

export async function getQueueMetrics(req: Request, res: Response): Promise<void> {
  res.json(await getMetrics(authOf(req), dateParam(req)));
}

export async function getQueueComparison(req: Request, res: Response): Promise<void> {
  res.json(await getComparison(authOf(req), dateParam(req)));
}

export async function getWorkstations(req: Request, res: Response): Promise<void> {
  res.json({ workstations: await listWorkstationViews(authOf(req)) });
}

export async function patchWorkstation(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { status } = req.body as { status: 'AVAILABLE' | 'OFFLINE' };
  const workstations = await setWorkstationStatus(auth, req.params.workstationId as string, status);

  await recordAudit(req, {
    action: 'WORKSTATION_STATUS_CHANGED',
    entityType: 'queue_workstations',
    entityId: req.params.workstationId as string,
    metadata: { status },
  });

  res.json({ workstations });
}

// --- Quality -----------------------------------------------------------------

export async function getQualityAssessment(req: Request, res: Response): Promise<void> {
  res.json({ assessment: await getAssessment(authOf(req), bookingIdOf(req)) });
}

export async function postQualityAssessment(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = bookingIdOf(req);
  const file = req.file;
  if (!file) throw validationError('Attach a photo of the produce sample in the "photo" field.');

  const assessment = await runAiAssessment(auth, bookingId, {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    buffer: file.buffer,
  });

  await recordAudit(req, {
    action: 'QUALITY_PREDICTION_REQUESTED',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: {
      status: assessment.latestPrediction?.status ?? null,
      modelVersion: assessment.latestPrediction?.modelVersion ?? null,
    },
  });

  res.status(201).json({ assessment });
}

export async function postQualityOverride(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = bookingIdOf(req);
  const { estimatedMinutes, reason } = req.body as { estimatedMinutes: number; reason: string };

  const { assessment, queued, centreId } = await overrideEstimate(auth, bookingId, estimatedMinutes, reason);
  if (queued) await recalculateQuietly(centreId, 'PROCESSING_TIME_UPDATED');

  await recordAudit(req, {
    action: 'PROCESSING_ESTIMATE_OVERRIDDEN',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: { estimatedMinutes, reason },
  });

  res.json({ assessment });
}
