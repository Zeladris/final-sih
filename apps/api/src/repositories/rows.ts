import type {
  District,
  DocumentKind,
  DocumentRequirement,
  DocumentStatus,
  FarmerDocument,
  FarmerProfile,
  Gender,
  Language,
  LandAreaUnit,
  LandHolding,
  LandOwnershipType,
  ProcurementCentre,
  Profile,
  ProfileStatus,
  RegistrationStatus,
  RegistrationStep,
  Role,
  State,
  StaffProfile,
  StateAdminProfile,
  DistrictAdminProfile,
  VerificationCheck,
  VerificationCheckType,
  VerificationStatus,
} from '@kisansetu/shared';

/**
 * Database row shapes and their mappers.
 *
 * PostgreSQL is snake_case, the API contract is camelCase. Doing the
 * translation in exactly one place keeps `select('*')` results from leaking
 * column names — notably farmer_documents.storage_path, which must never be
 * serialised to a client (§16).
 */

/** PostgREST returns `numeric` as a string to preserve precision. */
const num = (value: string | number | null): number | null => {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// --- profiles --------------------------------------------------------------

export interface ProfileRow {
  id: string;
  role: Role;
  full_name: string | null;
  phone: string | null;
  preferred_language: Language;
  status: ProfileStatus;
  created_at: string;
  updated_at: string;
}

export const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  role: row.role,
  fullName: row.full_name,
  phone: row.phone,
  preferredLanguage: row.preferred_language,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const PROFILE_COLUMNS =
  'id, role, full_name, phone, preferred_language, status, created_at, updated_at';

// --- farmer_profiles -------------------------------------------------------

export interface FarmerProfileRow {
  user_id: string;
  farmer_reference_id: string;
  date_of_birth: string | null;
  gender: Gender | null;
  full_name_local: string | null;
  village: string | null;
  address_line1: string | null;
  address_line2: string | null;
  pincode: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  state_id: string | null;
  district_id: string | null;
  registration_status: RegistrationStatus;
  current_step: RegistrationStep;
  last_saved_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export const toFarmerProfile = (row: FarmerProfileRow): FarmerProfile => ({
  userId: row.user_id,
  farmerReferenceId: row.farmer_reference_id,
  dateOfBirth: row.date_of_birth,
  gender: row.gender,
  fullNameLocal: row.full_name_local,
  village: row.village,
  addressLine1: row.address_line1,
  addressLine2: row.address_line2,
  pincode: row.pincode,
  latitude: num(row.latitude),
  longitude: num(row.longitude),
  stateId: row.state_id,
  districtId: row.district_id,
  registrationStatus: row.registration_status,
  currentStep: row.current_step,
  lastSavedAt: row.last_saved_at,
  submittedAt: row.submitted_at,
  reviewedAt: row.reviewed_at,
  reviewNotes: row.review_notes,
  verifiedAt: row.verified_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const FARMER_COLUMNS =
  'user_id, farmer_reference_id, date_of_birth, gender, full_name_local, village, ' +
  'address_line1, address_line2, pincode, latitude, longitude, state_id, district_id, ' +
  'registration_status, current_step, last_saved_at, submitted_at, reviewed_at, ' +
  'review_notes, verified_at, created_at, updated_at';

// --- farmer_land_holdings --------------------------------------------------

export interface LandHoldingRow {
  id: string;
  farmer_user_id: string;
  ownership_type: LandOwnershipType;
  area: string | number;
  area_unit: LandAreaUnit;
  survey_number: string | null;
  village: string | null;
  district_id: string | null;
  state_id: string | null;
  pincode: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  primary_crop: string | null;
  verification_status: VerificationStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export const toLandHolding = (row: LandHoldingRow): LandHolding => ({
  id: row.id,
  farmerUserId: row.farmer_user_id,
  ownershipType: row.ownership_type,
  area: num(row.area) ?? 0,
  areaUnit: row.area_unit,
  surveyNumber: row.survey_number,
  village: row.village,
  districtId: row.district_id,
  stateId: row.state_id,
  pincode: row.pincode,
  latitude: num(row.latitude),
  longitude: num(row.longitude),
  primaryCrop: row.primary_crop,
  verificationStatus: row.verification_status,
  rejectionReason: row.rejection_reason,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const LAND_HOLDING_COLUMNS =
  'id, farmer_user_id, ownership_type, area, area_unit, survey_number, village, ' +
  'district_id, state_id, pincode, latitude, longitude, primary_crop, ' +
  'verification_status, rejection_reason, created_at, updated_at';

// --- farmer_documents ------------------------------------------------------

export interface FarmerDocumentRow {
  id: string;
  farmer_user_id: string;
  document_type: DocumentKind;
  storage_bucket: string;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  status: DocumentStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  replaces_document_id: string | null;
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Note the omission of storage_bucket/storage_path — that omission is the point. */
export const toFarmerDocument = (row: FarmerDocumentRow): FarmerDocument => ({
  id: row.id,
  farmerUserId: row.farmer_user_id,
  documentKind: row.document_type,
  status: row.status,
  originalFilename: row.original_filename,
  mimeType: row.mime_type,
  fileSizeBytes: row.file_size_bytes,
  rejectionReason: row.rejection_reason,
  reviewedAt: row.reviewed_at,
  replacesDocumentId: row.replaces_document_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Columns that are safe to return for a document. */
export const FARMER_DOCUMENT_PUBLIC_COLUMNS =
  'id, farmer_user_id, document_type, original_filename, mime_type, file_size_bytes, ' +
  'status, reviewed_by, reviewed_at, rejection_reason, replaces_document_id, ' +
  'superseded_at, created_at, updated_at';

// --- farmer_verification_checks --------------------------------------------

export interface VerificationCheckRow {
  check_type: VerificationCheckType;
  status: VerificationStatus;
  notes: string | null;
  reviewed_at: string | null;
}

export const toVerificationCheck = (row: VerificationCheckRow): VerificationCheck => ({
  checkType: row.check_type,
  status: row.status,
  notes: row.notes,
  reviewedAt: row.reviewed_at,
});

// --- document_requirements -------------------------------------------------

export interface DocumentRequirementRow {
  document_kind: DocumentKind;
  is_required: boolean;
  display_order: number;
  translation_key: string;
}

export const toDocumentRequirement = (row: DocumentRequirementRow): DocumentRequirement => ({
  documentKind: row.document_kind,
  isRequired: row.is_required,
  displayOrder: row.display_order,
  translationKey: row.translation_key,
});

// --- organizational hierarchy ----------------------------------------------

export interface StaffProfileRow {
  user_id: string;
  employee_reference_id: string;
  centre_id: string;
  designation: string | null;
  is_active: boolean;
}

export const toStaffProfile = (row: StaffProfileRow): StaffProfile => ({
  userId: row.user_id,
  employeeReferenceId: row.employee_reference_id,
  centreId: row.centre_id,
  designation: row.designation,
  isActive: row.is_active,
});

export interface DistrictAdminProfileRow {
  user_id: string;
  employee_reference_id: string;
  district_id: string;
  is_active: boolean;
}

export const toDistrictAdminProfile = (row: DistrictAdminProfileRow): DistrictAdminProfile => ({
  userId: row.user_id,
  employeeReferenceId: row.employee_reference_id,
  districtId: row.district_id,
  isActive: row.is_active,
});

export interface StateAdminProfileRow {
  user_id: string;
  employee_reference_id: string;
  state_id: string;
  is_active: boolean;
}

export const toStateAdminProfile = (row: StateAdminProfileRow): StateAdminProfile => ({
  userId: row.user_id,
  employeeReferenceId: row.employee_reference_id,
  stateId: row.state_id,
  isActive: row.is_active,
});

export interface StateRow {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export const toState = (row: StateRow): State => ({
  id: row.id,
  code: row.code,
  name: row.name,
  isActive: row.is_active,
});

export interface DistrictRow {
  id: string;
  state_id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export const toDistrict = (row: DistrictRow): District => ({
  id: row.id,
  stateId: row.state_id,
  code: row.code,
  name: row.name,
  isActive: row.is_active,
});

export interface ProcurementCentreRow {
  id: string;
  code: string;
  name: string;
  district_id: string;
  address_line1: string | null;
  address_line2: string | null;
  village: string | null;
  pincode: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  open_time: string | null;
  close_time: string | null;
  daily_capacity_qtl: string | number | null;
  is_active: boolean;
}

/** `time` comes back as HH:MM:SS; the contract is HH:MM local wall clock. */
const hhmm = (value: string | null): string | null => (value ? value.slice(0, 5) : null);

export const toProcurementCentre = (row: ProcurementCentreRow): ProcurementCentre => ({
  id: row.id,
  code: row.code,
  name: row.name,
  districtId: row.district_id,
  addressLine1: row.address_line1,
  addressLine2: row.address_line2,
  village: row.village,
  pincode: row.pincode,
  latitude: num(row.latitude),
  longitude: num(row.longitude),
  openTime: hhmm(row.open_time),
  closeTime: hhmm(row.close_time),
  dailyCapacityQtl: num(row.daily_capacity_qtl),
  isActive: row.is_active,
});
