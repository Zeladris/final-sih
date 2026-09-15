/** Mirrors the PostgreSQL enum `verification_status`. Used by component checks and land. */
export const VERIFICATION_STATUSES = {
  PENDING: 'PENDING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;

export type VerificationStatus =
  (typeof VERIFICATION_STATUSES)[keyof typeof VERIFICATION_STATUSES];

export const ALL_VERIFICATION_STATUSES: readonly VerificationStatus[] =
  Object.values(VERIFICATION_STATUSES);

/** Mirrors the PostgreSQL enum `profile_status`. */
export const PROFILE_STATUSES = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DISABLED: 'DISABLED',
} as const;

export type ProfileStatus = (typeof PROFILE_STATUSES)[keyof typeof PROFILE_STATUSES];

/**
 * Mirrors the PostgreSQL enum `document_kind` — what a document *is*.
 * Distinct from `DocumentStatus`, which is where it is in review.
 */
export const DOCUMENT_KINDS = {
  LAND_RECORD: 'LAND_RECORD',
  BANK_PASSBOOK: 'BANK_PASSBOOK',
  IDENTITY_PROOF: 'IDENTITY_PROOF',
  ADDRESS_PROOF: 'ADDRESS_PROOF',
  CROP_PHOTO: 'CROP_PHOTO',
  FARMER_PHOTO: 'FARMER_PHOTO',
  OTHER: 'OTHER',
} as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[keyof typeof DOCUMENT_KINDS];

export const ALL_DOCUMENT_KINDS: readonly DocumentKind[] = Object.values(DOCUMENT_KINDS);

/** Mirrors the PostgreSQL enum `document_status` (§17). */
export const DOCUMENT_STATUSES = {
  UPLOADED: 'UPLOADED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  REPLACEMENT_REQUIRED: 'REPLACEMENT_REQUIRED',
} as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[keyof typeof DOCUMENT_STATUSES];

/** A document the farmer must act on before the registration can move forward. */
export function documentNeedsAction(status: DocumentStatus): boolean {
  return status === DOCUMENT_STATUSES.REJECTED || status === DOCUMENT_STATUSES.REPLACEMENT_REQUIRED;
}

/** Mirrors the PostgreSQL enum `verification_check_type` (§18). */
export const VERIFICATION_CHECK_TYPES = {
  IDENTITY: 'IDENTITY',
  ADDRESS: 'ADDRESS',
  LAND: 'LAND',
  DOCUMENTS: 'DOCUMENTS',
  PHOTO: 'PHOTO',
} as const;

export type VerificationCheckType =
  (typeof VERIFICATION_CHECK_TYPES)[keyof typeof VERIFICATION_CHECK_TYPES];

export const ALL_VERIFICATION_CHECK_TYPES: readonly VerificationCheckType[] =
  Object.values(VERIFICATION_CHECK_TYPES);

/** Mirrors the PostgreSQL enum `land_ownership_type`. */
export const LAND_OWNERSHIP_TYPES = {
  OWNED: 'OWNED',
  LEASED: 'LEASED',
  SHARECROPPED: 'SHARECROPPED',
  TENANT: 'TENANT',
  FAMILY_OWNED: 'FAMILY_OWNED',
  OTHER: 'OTHER',
} as const;

export type LandOwnershipType =
  (typeof LAND_OWNERSHIP_TYPES)[keyof typeof LAND_OWNERSHIP_TYPES];

export const ALL_LAND_OWNERSHIP_TYPES: readonly LandOwnershipType[] =
  Object.values(LAND_OWNERSHIP_TYPES);

/** Mirrors the PostgreSQL enum `land_area_unit`. */
export const LAND_AREA_UNITS = {
  ACRE: 'ACRE',
  HECTARE: 'HECTARE',
  CENT: 'CENT',
} as const;

export type LandAreaUnit = (typeof LAND_AREA_UNITS)[keyof typeof LAND_AREA_UNITS];

export const ALL_LAND_AREA_UNITS: readonly LandAreaUnit[] = Object.values(LAND_AREA_UNITS);

/** Conversion to acres, for totals. Cent is 1/100 acre; hectare is 2.47105 acres. */
const ACRES_PER_UNIT: Record<LandAreaUnit, number> = {
  ACRE: 1,
  HECTARE: 2.471_05,
  CENT: 0.01,
};

export function toAcres(area: number, unit: LandAreaUnit): number {
  return area * ACRES_PER_UNIT[unit];
}

/** Mirrors the PostgreSQL enum `gender`. */
export const GENDERS = {
  FEMALE: 'FEMALE',
  MALE: 'MALE',
  OTHER: 'OTHER',
  PREFER_NOT_TO_SAY: 'PREFER_NOT_TO_SAY',
} as const;

export type Gender = (typeof GENDERS)[keyof typeof GENDERS];

export const ALL_GENDERS: readonly Gender[] = Object.values(GENDERS);
