import { describe, expect, it } from 'vitest';
import type {
  DocumentRequirement,
  FarmerDocument,
  FarmerProfile,
  LandHolding,
  Profile,
} from '@kisansetu/shared';
import {
  evaluateCompleteness,
  photoRequired,
  resolveResumeStep,
} from '../../src/services/farmers/registrationCompleteness.js';
import type { CompletenessInput } from '../../src/services/farmers/registrationCompleteness.js';

/**
 * Completeness and resume rules (§19, §21, §22).
 *
 * These decide when Submit appears and where a returning farmer lands, so they
 * are worth testing directly rather than only through the API.
 */

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: 'user-1',
  role: 'FARMER',
  fullName: 'Arumugam Selvaraj',
  phone: '+919000000001',
  preferredLanguage: 'ta',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const farmer = (overrides: Partial<FarmerProfile> = {}): FarmerProfile => ({
  userId: 'user-1',
  farmerReferenceId: 'KS-100001',
  dateOfBirth: '1980-06-15',
  gender: 'MALE',
  fullNameLocal: null,
  village: 'Orathanadu',
  addressLine1: null,
  addressLine2: null,
  pincode: '614625',
  latitude: null,
  longitude: null,
  stateId: 'state-1',
  districtId: 'district-1',
  registrationStatus: 'DRAFT',
  currentStep: 'PERSONAL_DETAILS',
  lastSavedAt: '2026-01-01T00:00:00Z',
  submittedAt: null,
  reviewedAt: null,
  reviewNotes: null,
  verifiedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const land = (overrides: Partial<LandHolding> = {}): LandHolding => ({
  id: 'land-1',
  farmerUserId: 'user-1',
  ownershipType: 'OWNED',
  area: 3.5,
  areaUnit: 'ACRE',
  surveyNumber: '123/4',
  village: 'Orathanadu',
  districtId: 'district-1',
  stateId: 'state-1',
  pincode: '614625',
  latitude: null,
  longitude: null,
  primaryCrop: 'Paddy (Samba)',
  verificationStatus: 'PENDING',
  rejectionReason: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const doc = (overrides: Partial<FarmerDocument>): FarmerDocument => ({
  id: 'doc-1',
  farmerUserId: 'user-1',
  documentKind: 'LAND_RECORD',
  status: 'UPLOADED',
  originalFilename: 'patta.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1024,
  rejectionReason: null,
  reviewedAt: null,
  replacesDocumentId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const REQUIREMENTS: DocumentRequirement[] = [
  { documentKind: 'LAND_RECORD', isRequired: true, displayOrder: 10, translationKey: 'k.land' },
  { documentKind: 'IDENTITY_PROOF', isRequired: true, displayOrder: 20, translationKey: 'k.id' },
  { documentKind: 'ADDRESS_PROOF', isRequired: false, displayOrder: 40, translationKey: 'k.addr' },
  { documentKind: 'FARMER_PHOTO', isRequired: true, displayOrder: 50, translationKey: 'k.photo' },
];

const REQUIRED_DOCS: FarmerDocument[] = [
  doc({ id: 'd1', documentKind: 'LAND_RECORD' }),
  doc({ id: 'd2', documentKind: 'IDENTITY_PROOF' }),
  doc({ id: 'd3', documentKind: 'FARMER_PHOTO', mimeType: 'image/jpeg' }),
];

const complete = (overrides: Partial<CompletenessInput> = {}): CompletenessInput => ({
  profile: profile(),
  farmer: farmer(),
  landHoldings: [land()],
  documents: REQUIRED_DOCS,
  requirements: REQUIREMENTS,
  ...overrides,
});

describe('completeness', () => {
  it('allows submission when everything required is present', () => {
    const result = evaluateCompleteness(complete());
    expect(result.canSubmit).toBe(true);
    expect(result.blockingReasons).toEqual([]);
    expect(result.completedSteps).toContain('PERSONAL_DETAILS');
    expect(result.completedSteps).toContain('DOCUMENTS');
    expect(result.completedSteps).toContain('PHOTO');
  });

  it('blocks on missing personal details', () => {
    const result = evaluateCompleteness(
      complete({ farmer: farmer({ dateOfBirth: null }) }),
    );
    expect(result.canSubmit).toBe(false);
    expect(result.blockingReasons).toContain('registration.blocking.personalDetails');
  });

  it('blocks on an incomplete address', () => {
    const result = evaluateCompleteness(complete({ farmer: farmer({ districtId: null }) }));
    expect(result.blockingReasons).toContain('registration.blocking.address');
  });

  it('blocks when no land has been declared', () => {
    const result = evaluateCompleteness(complete({ landHoldings: [] }));
    expect(result.blockingReasons).toContain('registration.blocking.land');
  });

  it('blocks on a missing required document but not a missing optional one', () => {
    const withoutIdentity = REQUIRED_DOCS.filter((d) => d.documentKind !== 'IDENTITY_PROOF');
    expect(
      evaluateCompleteness(complete({ documents: withoutIdentity })).blockingReasons,
    ).toContain('registration.blocking.documents');

    // ADDRESS_PROOF is optional — its absence must not block.
    expect(evaluateCompleteness(complete()).canSubmit).toBe(true);
  });

  it('blocks resubmission while a document is marked for replacement', () => {
    // The case that matters for §20: everything is present, but a reviewer
    // sent one back. Resubmitting unchanged must not be possible.
    const documents = [
      doc({ id: 'd1', documentKind: 'LAND_RECORD', status: 'REJECTED', rejectionReason: 'Unreadable' }),
      doc({ id: 'd2', documentKind: 'IDENTITY_PROOF' }),
      doc({ id: 'd3', documentKind: 'FARMER_PHOTO' }),
    ];

    const result = evaluateCompleteness(complete({ documents }));
    expect(result.canSubmit).toBe(false);
    expect(result.blockingReasons).toContain('registration.blocking.documentsNeedReplacement');
    // A rejected document also fails to satisfy its requirement.
    expect(result.blockingReasons).toContain('registration.blocking.documents');
  });

  it('blocks while a land holding has been rejected', () => {
    const result = evaluateCompleteness(
      complete({
        landHoldings: [land({ verificationStatus: 'REJECTED', rejectionReason: 'Survey mismatch' })],
      }),
    );
    expect(result.blockingReasons).toContain('registration.blocking.landNeedsCorrection');
  });

  it('skips the photo entirely when policy does not require one', () => {
    const requirements = REQUIREMENTS.map((requirement) =>
      requirement.documentKind === 'FARMER_PHOTO'
        ? { ...requirement, isRequired: false }
        : requirement,
    );
    const withoutPhoto = REQUIRED_DOCS.filter((d) => d.documentKind !== 'FARMER_PHOTO');

    expect(photoRequired(requirements)).toBe(false);

    const result = evaluateCompleteness(complete({ requirements, documents: withoutPhoto }));
    expect(result.canSubmit).toBe(true);
    expect(result.completedSteps).toContain('PHOTO');
  });

  it('returns i18n keys, never English sentences', () => {
    // A farmer reading Tamil must not be handed an English blocking reason.
    const result = evaluateCompleteness(
      complete({ farmer: farmer({ dateOfBirth: null, village: null }), landHoldings: [] }),
    );
    for (const reason of result.blockingReasons) {
      expect(reason).toMatch(/^registration\.blocking\./);
    }
  });
});

describe('resume', () => {
  it('sends a brand-new registration to the first step', () => {
    const input = complete({
      farmer: farmer({ dateOfBirth: null, village: null, districtId: null, stateId: null }),
      landHoldings: [],
      documents: [],
    });
    const { completedSteps } = evaluateCompleteness(input);
    expect(resolveResumeStep(input, completedSteps)).toBe('PERSONAL_DETAILS');
  });

  it('sends a finished registration to review', () => {
    const input = complete();
    const { completedSteps } = evaluateCompleteness(input);
    expect(resolveResumeStep(input, completedSteps)).toBe('REVIEW');
  });

  it('keeps the farmer where they left off rather than jumping backwards', () => {
    // Personal details and address are done; the stored step is LAND_DETAILS,
    // which is still incomplete — so that is where they resume.
    const input = complete({
      farmer: farmer({ currentStep: 'LAND_DETAILS' }),
      landHoldings: [],
      documents: [],
    });
    const { completedSteps } = evaluateCompleteness(input);
    expect(resolveResumeStep(input, completedSteps)).toBe('LAND_DETAILS');
  });

  it('moves past a stored step that is already satisfied', () => {
    const input = complete({ farmer: farmer({ currentStep: 'PERSONAL_DETAILS' }), documents: [] });
    const { completedSteps } = evaluateCompleteness(input);
    expect(resolveResumeStep(input, completedSteps)).toBe('DOCUMENTS');
  });

  it('never resumes onto the photo step when no photo is required', () => {
    const requirements = REQUIREMENTS.map((requirement) =>
      requirement.documentKind === 'FARMER_PHOTO'
        ? { ...requirement, isRequired: false }
        : requirement,
    );
    const input = complete({ requirements, farmer: farmer({ currentStep: 'PHOTO' }) });
    const { completedSteps } = evaluateCompleteness(input);
    expect(resolveResumeStep(input, completedSteps)).not.toBe('PHOTO');
  });
});
