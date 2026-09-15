import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth.js';
import { recordAudit } from '../services/audit/auditService.js';
import { submitFeedback, listOwnFeedback } from '../services/support/feedbackService.js';
import {
  submitGrievance,
  listOwnGrievances,
  getGrievanceDetail,
  respondToGrievance,
} from '../services/support/grievanceService.js';
import { listHelpline } from '../services/support/helplineService.js';
import {
  listSchemes,
  getSchemeDetail,
  saveScheme,
  unsaveScheme,
  listSavedSchemes,
} from '../services/support/schemeService.js';
import { listFaqs } from '../services/support/faqService.js';

/**
 * Farmer (and any-authenticated) facing endpoints (§4, §11, §17, §26, §35).
 * Everything a District/State Admin does lives in governmentSupportController.ts —
 * the two are separated by audience, not by table, so a route file can never
 * accidentally give a farmer an admin action just by being on the same router.
 */

// --- Feedback (§4, §5) -------------------------------------------------------

export async function postFeedback(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const feedback = await submitFeedback(auth.db, auth.userId, auth.preferredLanguage, req.body);
  await recordAudit(req, { action: 'FEEDBACK_CREATED', entityType: 'feedback', entityId: feedback.id });
  res.status(201).json({ feedback });
}

export async function getMyFeedback(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ feedback: await listOwnFeedback(auth.db, auth.userId) });
}

// --- Grievances (§6–§14) ------------------------------------------------------

export async function postGrievance(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const grievance = await submitGrievance(auth, req.body);
  await recordAudit(req, {
    action: 'GRIEVANCE_CREATED',
    entityType: 'grievances',
    entityId: grievance.id,
    metadata: { category: grievance.category, reference: grievance.reference },
  });
  res.status(201).json({ grievance });
}

export async function getMyGrievances(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ grievances: await listOwnGrievances(auth.db, auth.userId) });
}

export async function getMyGrievanceDetail(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const grievance = await getGrievanceDetail(auth, req.params.id as string);
  // A farmer's own client can already reach this row via getGrievanceDetail's
  // RLS-bound select, but notes must never leave this layer even so — the
  // service only attaches them for staff/admin callers, this just documents
  // the intent at the boundary a farmer actually hits.
  delete grievance.notes;
  res.json({ grievance });
}

export async function postMyGrievanceResponse(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { message } = req.body as { message: string };
  await respondToGrievance(auth, req.params.id as string, message);
  res.status(201).json({ ok: true });
}

// --- Helpline (§16–§22) -------------------------------------------------------

export async function getHelpline(req: Request, res: Response): Promise<void> {
  res.json({ helpline: await listHelpline(authOf(req)) });
}

// --- Government schemes (§23–§32) --------------------------------------------

export async function getSchemes(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const query = req.query as { category?: string; search?: string; savedOnly?: boolean };
  res.json({ schemes: await listSchemes(auth, query) });
}

export async function getSchemeById(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ scheme: await getSchemeDetail(auth, req.params.id as string) });
}

export async function postSaveScheme(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  await saveScheme(auth, req.params.id as string);
  res.status(201).json({ ok: true });
}

export async function deleteSaveScheme(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  await unsaveScheme(auth, req.params.id as string);
  res.status(204).send();
}

export async function getSavedSchemes(req: Request, res: Response): Promise<void> {
  res.json({ schemes: await listSavedSchemes(authOf(req)) });
}

// --- FAQs (§33–§37) -----------------------------------------------------------

export async function getFaqs(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { category } = req.query as { category?: string };
  res.json({ faqs: await listFaqs(auth, category) });
}
