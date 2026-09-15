import type { Request, Response } from 'express';
import type { DocumentKind } from '@kisansetu/shared';
import { authOf, sessionOf } from '../middleware/auth.js';
import { conflict, validationError } from '../lib/errors.js';
import { recordAudit } from '../services/audit/auditService.js';
import {
  buildView,
  findExistingRegistration,
  getVerificationStatus,
  saveAddress,
  saveCurrentStep,
  savePersonalDetails,
  savePreferredLanguage,
  startRegistration,
  submitRegistration,
} from '../services/farmers/registrationService.js';
import {
  addLandHolding,
  editLandHolding,
  listOwnLandHoldings,
  removeLandHolding,
} from '../services/farmers/landService.js';
import {
  createDocumentSignedUrl,
  deleteOwnDocument,
  listOwnDocuments,
  uploadDocument,
} from '../services/documents/documentService.js';
import { buildDashboard } from '../services/dashboard/dashboardService.js';
import { listDistrictsByState, listStates } from '../repositories/centresRepository.js';
import { listDocumentRequirements } from '../repositories/registrationPolicyRepository.js';
import type {
  AddressBody,
  CreateLandHoldingBody,
  PersonalDetailsBody,
  StartRegistrationBody,
  UpdateLandHoldingBody,
} from '../schemas/registration.js';

/**
 * GET /api/farmer/registration
 *
 * The one call the registration UI needs to render any step, including after a
 * refresh or a re-login (§21). Returns 404 when there is no registration yet,
 * which is how the client distinguishes a new farmer from a returning one (§10).
 */
export async function getRegistration(req: Request, res: Response): Promise<void> {
  const session = sessionOf(req);
  const view = await findExistingRegistration(session.db, session.userId);

  if (!view) {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'No registration has been started for this account.',
        requestId: req.requestId,
      },
    });
    return;
  }

  res.json(view);
}

/** POST /api/farmer/registration — begins a DRAFT registration (§10). */
export async function beginRegistration(req: Request, res: Response): Promise<void> {
  const session = sessionOf(req);

  if (req.auth) {
    throw conflict('This account is already registered.');
  }

  const body = req.body as StartRegistrationBody;
  const view = await startRegistration(session.db, session.userId, body);

  await recordAudit(req, {
    action: 'REGISTRATION_STARTED',
    entityType: 'farmer_profiles',
    entityId: session.userId,
    actorUserId: session.userId,
    metadata: { farmerReferenceId: view.farmer.farmerReferenceId },
  });

  res.status(201).json(view);
}

/** PUT /api/farmer/profile */
export async function putPersonalDetails(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const body = req.body as PersonalDetailsBody;

  const view = await savePersonalDetails(auth.db, auth.userId, body);

  await recordAudit(req, {
    action: 'REGISTRATION_SECTION_SAVED',
    entityType: 'farmer_profiles',
    entityId: auth.userId,
    metadata: { section: 'PERSONAL_DETAILS' },
  });

  res.json(view);
}

/** PUT /api/farmer/address */
export async function putAddress(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const body = req.body as AddressBody;

  const view = await saveAddress(auth.db, auth.userId, body);

  await recordAudit(req, {
    action: 'REGISTRATION_SECTION_SAVED',
    entityType: 'farmer_profiles',
    entityId: auth.userId,
    metadata: { section: 'ADDRESS' },
  });

  res.json(view);
}

// --- Land -------------------------------------------------------------------

/** GET /api/farmer/land */
export async function getLand(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ landHoldings: await listOwnLandHoldings(auth.db, auth.userId) });
}

/** POST /api/farmer/land */
export async function postLand(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const body = req.body as CreateLandHoldingBody;

  const holding = await addLandHolding(auth.db, auth.userId, body);

  await recordAudit(req, {
    action: 'LAND_HOLDING_ADDED',
    entityType: 'farmer_land_holdings',
    entityId: holding.id,
    metadata: { ownershipType: holding.ownershipType, areaUnit: holding.areaUnit },
  });

  res.status(201).json(await buildView(auth.db, auth.userId));
}

/** PUT /api/farmer/land/:id */
export async function putLand(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const holdingId = req.params.id as string;
  const body = req.body as UpdateLandHoldingBody;

  await editLandHolding(auth.db, auth.userId, holdingId, body);

  await recordAudit(req, {
    action: 'LAND_HOLDING_UPDATED',
    entityType: 'farmer_land_holdings',
    entityId: holdingId,
  });

  res.json(await buildView(auth.db, auth.userId));
}

/** DELETE /api/farmer/land/:id */
export async function deleteLand(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const holdingId = req.params.id as string;

  await removeLandHolding(auth.db, auth.userId, holdingId);

  await recordAudit(req, {
    action: 'LAND_HOLDING_REMOVED',
    entityType: 'farmer_land_holdings',
    entityId: holdingId,
  });

  res.json(await buildView(auth.db, auth.userId));
}

// --- Documents ---------------------------------------------------------------

/** GET /api/farmer/documents */
export async function getDocuments(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const [documents, requirements] = await Promise.all([
    listOwnDocuments(auth.db, auth.userId),
    listDocumentRequirements(auth.db),
  ]);
  res.json({ documents, requirements });
}

/** POST /api/farmer/documents (multipart: file + documentKind) */
export async function postDocument(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const file = req.file;

  if (!file) throw validationError('Attach a file in the "file" field.');

  const documentKind = (req.body as { documentKind?: string }).documentKind;
  if (!documentKind) throw validationError('Choose a document type.');

  const document = await uploadDocument(
    auth.db,
    auth.userId,
    documentKind as DocumentKind,
    {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    },
  );

  await recordAudit(req, {
    action: document.replacesDocumentId ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED',
    entityType: 'farmer_documents',
    entityId: document.id,
    // Filename and size are fine to record; the contents and path are not.
    metadata: {
      documentKind: document.documentKind,
      mimeType: document.mimeType,
      fileSizeBytes: document.fileSizeBytes,
      replaces: document.replacesDocumentId,
    },
  });

  res.status(201).json(await buildView(auth.db, auth.userId));
}

/** GET /api/farmer/documents/:id/url — short-lived signed URL (§16). */
export async function getDocumentUrl(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const documentId = req.params.id as string;

  const signed = await createDocumentSignedUrl(auth.db, documentId);

  await recordAudit(req, {
    action: 'DOCUMENT_ACCESSED',
    entityType: 'farmer_documents',
    entityId: documentId,
  });

  res.json(signed);
}

/** DELETE /api/farmer/documents/:id */
export async function deleteDocument(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const documentId = req.params.id as string;

  await deleteOwnDocument(auth.db, documentId);

  await recordAudit(req, {
    action: 'DOCUMENT_DELETED',
    entityType: 'farmer_documents',
    entityId: documentId,
  });

  res.json(await buildView(auth.db, auth.userId));
}

// --- Submission and status ----------------------------------------------------

/** POST /api/farmer/registration/submit */
export async function postSubmit(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);

  const { view, wasResubmission } = await submitRegistration(auth.db, auth.userId);

  await recordAudit(req, {
    action: wasResubmission ? 'REGISTRATION_RESUBMITTED' : 'REGISTRATION_SUBMITTED',
    entityType: 'farmer_profiles',
    entityId: auth.userId,
  });

  await recordAudit(req, {
    action: 'VERIFICATION_STATUS_CHANGED',
    entityType: 'farmer_profiles',
    entityId: auth.userId,
    metadata: { to: view.farmer.registrationStatus },
  });

  res.json(view);
}

/** GET /api/farmer/verification-status */
export async function getStatus(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json(await getVerificationStatus(auth.db, auth.userId));
}

/**
 * GET /api/farmer/dashboard
 *
 * One request for the whole page (§30). The farmer identity comes from the
 * session, so there is no id to supply and none to tamper with (§16, §17).
 */
export async function getDashboard(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json(await buildDashboard(auth.db, auth.userId));
}

/** PUT /api/farmer/registration/step — save/resume position (§21). */
export async function putStep(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { currentStep } = req.body as { currentStep: Parameters<typeof saveCurrentStep>[2] };

  await saveCurrentStep(auth.db, auth.userId, currentStep);
  res.status(204).end();
}

/**
 * PUT /api/farmer/language
 *
 * Allowed even while a registration is locked: language is a display
 * preference, not registration content (§4).
 */
export async function putLanguage(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { preferredLanguage } = req.body as { preferredLanguage: 'en' | 'ta' };

  await savePreferredLanguage(auth.db, auth.userId, preferredLanguage);
  res.status(204).end();
}

// --- Reference data -----------------------------------------------------------

export async function getStates(req: Request, res: Response): Promise<void> {
  const db = req.auth?.db ?? sessionOf(req).db;
  res.json({ states: await listStates(db) });
}

export async function getDistricts(req: Request, res: Response): Promise<void> {
  const db = req.auth?.db ?? sessionOf(req).db;
  const stateId = req.params.stateId as string;
  res.json({ districts: await listDistrictsByState(db, stateId) });
}

export async function getRequirements(req: Request, res: Response): Promise<void> {
  const db = req.auth?.db ?? sessionOf(req).db;
  res.json({ requirements: await listDocumentRequirements(db) });
}
