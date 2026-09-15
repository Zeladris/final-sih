import type { Request, Response } from 'express';
import type { GrievanceStatus } from '@kisansetu/shared';
import { authOf } from '../middleware/auth.js';
import { recordAudit } from '../services/audit/auditService.js';
import {
  listGovernmentGrievances,
  getGrievanceDetail,
  changeGrievanceStatus,
  respondToGrievance,
  addGrievanceNote,
  assignGrievance,
  escalateGrievance,
} from '../services/support/grievanceService.js';
import {
  listGovernmentHelpline,
  createHelpline,
  updateHelpline,
  verifyHelpline,
} from '../services/support/helplineService.js';
import {
  listGovernmentSchemes,
  getSchemeDetail,
  createScheme,
  updateScheme,
  publishScheme,
  archiveScheme,
} from '../services/support/schemeService.js';
import { listGovernmentFaqs, createFaq, updateFaq } from '../services/support/faqService.js';

/**
 * District/State Admin (and, for grievances, Centre Staff) workspace
 * endpoints — mounted separately from supportController.ts so the audience
 * split is visible at the route table, not just in `requireRole` calls.
 */

// --- Grievances (§10–§14) -----------------------------------------------------

export async function getGovernmentGrievances(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const query = req.query as { status?: GrievanceStatus; category?: string; centreId?: string; search?: string; limit?: number };
  res.json({
    grievances: await listGovernmentGrievances(auth.db, query as Parameters<typeof listGovernmentGrievances>[1]),
  });
}

export async function getGovernmentGrievanceDetail(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ grievance: await getGrievanceDetail(auth, req.params.id as string) });
}

export async function patchGrievanceStatus(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { status, reason } = req.body as { status: GrievanceStatus; reason?: string };
  await changeGrievanceStatus(auth, req.params.id as string, status, reason);
  await recordAudit(req, {
    action: 'GRIEVANCE_STATUS_CHANGED',
    entityType: 'grievances',
    entityId: req.params.id as string,
    metadata: { status, reason: reason ?? null },
  });
  res.json({ grievance: await getGrievanceDetail(auth, req.params.id as string) });
}

export async function postGrievanceResponse(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { message } = req.body as { message: string };
  await respondToGrievance(auth, req.params.id as string, message);
  await recordAudit(req, {
    action: 'GRIEVANCE_RESPONSE_ADDED',
    entityType: 'grievances',
    entityId: req.params.id as string,
  });
  res.status(201).json({ ok: true });
}

export async function postGrievanceNote(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { note } = req.body as { note: string };
  await addGrievanceNote(auth, req.params.id as string, note);
  await recordAudit(req, {
    action: 'GRIEVANCE_NOTE_ADDED',
    entityType: 'grievances',
    entityId: req.params.id as string,
  });
  res.status(201).json({ ok: true });
}

export async function postGrievanceAssign(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { userId } = req.body as { userId: string };
  await assignGrievance(auth, req.params.id as string, userId);
  await recordAudit(req, {
    action: 'GRIEVANCE_ASSIGNED',
    entityType: 'grievances',
    entityId: req.params.id as string,
    metadata: { assignedTo: userId },
  });
  res.json({ grievance: await getGrievanceDetail(auth, req.params.id as string) });
}

export async function postGrievanceEscalate(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { reason } = req.body as { reason: string };
  await escalateGrievance(auth, req.params.id as string, reason);
  await recordAudit(req, {
    action: 'GRIEVANCE_ESCALATED',
    entityType: 'grievances',
    entityId: req.params.id as string,
    metadata: { reason },
  });
  res.json({ grievance: await getGrievanceDetail(auth, req.params.id as string) });
}

// --- Helpline (§18–§21) --------------------------------------------------------

export async function getGovernmentHelpline(req: Request, res: Response): Promise<void> {
  res.json({ helpline: await listGovernmentHelpline(authOf(req).db) });
}

export async function postHelpline(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const entry = await createHelpline(auth, req.body);
  await recordAudit(req, { action: 'HELPLINE_CREATED', entityType: 'helpline_entries', entityId: entry.id });
  res.status(201).json({ helpline: entry });
}

export async function patchHelpline(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const entry = await updateHelpline(auth, req.params.id as string, req.body);
  await recordAudit(req, { action: 'HELPLINE_UPDATED', entityType: 'helpline_entries', entityId: entry.id });
  res.json({ helpline: entry });
}

export async function postHelplineVerify(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const entry = await verifyHelpline(auth, req.params.id as string);
  await recordAudit(req, { action: 'HELPLINE_VERIFIED', entityType: 'helpline_entries', entityId: entry.id });
  res.json({ helpline: entry });
}

// --- Government schemes (§23–§32) ----------------------------------------------

export async function getGovernmentSchemes(req: Request, res: Response): Promise<void> {
  res.json({ schemes: await listGovernmentSchemes(authOf(req).db) });
}

export async function getGovernmentSchemeById(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ scheme: await getSchemeDetail(auth, req.params.id as string) });
}

export async function postScheme(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const scheme = await createScheme(auth, req.body);
  await recordAudit(req, { action: 'SCHEME_CREATED', entityType: 'government_schemes', entityId: scheme.id });
  res.status(201).json({ scheme });
}

export async function patchScheme(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const scheme = await updateScheme(auth, req.params.id as string, req.body);
  await recordAudit(req, { action: 'SCHEME_UPDATED', entityType: 'government_schemes', entityId: scheme.id });
  res.json({ scheme });
}

export async function postSchemePublish(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const scheme = await publishScheme(auth, req.params.id as string);
  await recordAudit(req, { action: 'SCHEME_PUBLISHED', entityType: 'government_schemes', entityId: scheme.id });
  res.json({ scheme });
}

export async function postSchemeArchive(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const scheme = await archiveScheme(auth, req.params.id as string);
  await recordAudit(req, { action: 'SCHEME_ARCHIVED', entityType: 'government_schemes', entityId: scheme.id });
  res.json({ scheme });
}

// --- FAQs (§33–§37) --------------------------------------------------------------

export async function getGovernmentFaqs(req: Request, res: Response): Promise<void> {
  res.json({ faqs: await listGovernmentFaqs(authOf(req).db) });
}

export async function postFaq(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const faq = await createFaq(auth, req.body);
  await recordAudit(req, { action: 'FAQ_CREATED', entityType: 'support_faqs', entityId: faq.id });
  res.status(201).json({ faq });
}

export async function patchFaq(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const faq = await updateFaq(auth, req.params.id as string, req.body);
  await recordAudit(req, { action: 'FAQ_UPDATED', entityType: 'support_faqs', entityId: faq.id });
  res.json({ faq });
}
