import type { Role } from './roles.js';
import type { Language } from './language.js';
import type { FarmerAccountSummary } from './account.js';
import type { RegistrationStatus, RegistrationStep } from './registration.js';
import type {
  DocumentKind,
  DocumentStatus,
  Gender,
  LandAreaUnit,
  LandOwnershipType,
  ProfileStatus,
  VerificationCheckType,
  VerificationStatus,
} from './status.js';

export interface Profile {
  id: string;
  role: Role;
  fullName: string | null;
  phone: string | null;
  preferredLanguage: Language;
  status: ProfileStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * The farmer's own record. Residence lives here; agricultural land lives in
 * LandHolding, because the two are genuinely different places (§12).
 */
export interface FarmerProfile {
  userId: string;
  farmerReferenceId: string;

  // Personal
  dateOfBirth: string | null;
  gender: Gender | null;
  /** Name in the farmer's own script. Never a translation of the Latin name. */
  fullNameLocal: string | null;

  // Residence
  village: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  stateId: string | null;
  districtId: string | null;

  // Registration state machine
  registrationStatus: RegistrationStatus;
  currentStep: RegistrationStep;
  lastSavedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  verifiedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface LandHolding {
  id: string;
  farmerUserId: string;
  ownershipType: LandOwnershipType;
  area: number;
  areaUnit: LandAreaUnit;
  surveyNumber: string | null;
  village: string | null;
  districtId: string | null;
  stateId: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  primaryCrop: string | null;
  /**
   * Independent of any document status (§14). A submitted land record does not
   * make this VERIFIED — only an authorised review does.
   */
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FarmerDocument {
  id: string;
  farmerUserId: string;
  documentKind: DocumentKind;
  status: DocumentStatus;
  originalFilename: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  rejectionReason: string | null;
  reviewedAt: string | null;
  replacesDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Component verification outcome (§18). One row per check type. */
export interface VerificationCheck {
  checkType: VerificationCheckType;
  status: VerificationStatus;
  notes: string | null;
  reviewedAt: string | null;
}

/** Configurable registration document policy (§14, §15). */
export interface DocumentRequirement {
  documentKind: DocumentKind;
  isRequired: boolean;
  displayOrder: number;
  /** Key into the i18n bundles; labels are never stored in the database (§4). */
  translationKey: string;
}

// --- Government role profiles (Phase 0; unchanged in Phase 1) --------------

export interface StaffProfile {
  userId: string;
  employeeReferenceId: string;
  centreId: string;
  designation: string | null;
  isActive: boolean;
}

export interface DistrictAdminProfile {
  userId: string;
  employeeReferenceId: string;
  districtId: string;
  isActive: boolean;
}

export interface StateAdminProfile {
  userId: string;
  employeeReferenceId: string;
  stateId: string;
  isActive: boolean;
}

export interface State {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface District {
  id: string;
  stateId: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface ProcurementCentre {
  id: string;
  code: string;
  name: string;
  districtId: string;
  addressLine1: string | null;
  addressLine2: string | null;
  village: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  /** "HH:MM" local to APP_TIMEZONE, not a UTC instant. */
  openTime: string | null;
  closeTime: string | null;
  dailyCapacityQtl: number | null;
  isActive: boolean;
}

/**
 * Everything the registration UI needs in one call, so a resumed session can
 * render the right step without a waterfall of requests (§21).
 */
export interface RegistrationView {
  profile: Profile;
  farmer: FarmerProfile;
  landHoldings: LandHolding[];
  documents: FarmerDocument[];
  requirements: DocumentRequirement[];
  checks: VerificationCheck[];
  /** Steps the server considers satisfied, for the progress indicator (§22). */
  completedSteps: RegistrationStep[];
  /** Server's view of whether Submit should be offered at all. */
  canSubmit: boolean;
  /** Human-readable reasons Submit is unavailable. Already localised keys. */
  blockingReasons: string[];
  editable: boolean;
}

/**
 * The authorisation scope the server derived for the caller. Always
 * server-derived from role-specific profile rows (§29).
 */
export interface AccessScope {
  centreId: string | null;
  districtId: string | null;
  stateId: string | null;
}

export interface AuthenticatedUser {
  id: string;
  role: Role;
  name: string | null;
  phone: string | null;
  status: ProfileStatus;
  preferredLanguage: Language;
}

export interface MeResponse {
  user: AuthenticatedUser;
  scope: AccessScope;
  /**
   * Farmer registration/verification state (§21). Present only for FARMER
   * accounts, so the client can route after login without a second request.
   */
  account: FarmerAccountSummary | null;
}

/**
 * What a farmer is shown about their verification (§42).
 * Deliberately carries no raw state names — the UI maps `status` to plain
 * language and the technical value never reaches the screen.
 */
export interface VerificationStatusView {
  status: RegistrationStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  verifiedAt: string | null;
  /** Reviewer's explanation, when one exists (§20). */
  reviewNotes: string | null;
  checks: VerificationCheck[];
  /** Documents the farmer must replace or correct before resubmitting. */
  actionableDocuments: FarmerDocument[];
  /** Land holdings a reviewer rejected. */
  actionableLandHoldings: LandHolding[];
}
