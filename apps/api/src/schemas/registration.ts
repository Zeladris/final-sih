import { z } from 'zod';
import {
  ALL_DOCUMENT_KINDS,
  ALL_GENDERS,
  ALL_LAND_AREA_UNITS,
  ALL_LAND_OWNERSHIP_TYPES,
  ALL_LANGUAGES,
  STEP_SEQUENCE,
} from '@kisansetu/shared';
import type {
  DocumentKind,
  Gender,
  Language,
  LandAreaUnit,
  LandOwnershipType,
  RegistrationStep,
} from '@kisansetu/shared';
import {
  fullNameSchema,
  latitudeSchema,
  longitudeSchema,
  optionalText,
  pastCalendarDateSchema,
  pincodeSchema,
  uuidSchema,
} from './common.js';

/** Helper: turn a readonly union list into a zod enum without a lossy cast. */
const enumOf = <T extends string>(values: readonly T[], message: string) =>
  z.enum([...values] as [T, ...T[]], { errorMap: () => ({ message }) });

export const languageSchema = enumOf<Language>([...ALL_LANGUAGES], 'Choose English or Tamil.');
const genderSchema = enumOf<Gender>([...ALL_GENDERS], 'Choose an option.');
const ownershipSchema = enumOf<LandOwnershipType>(
  [...ALL_LAND_OWNERSHIP_TYPES],
  'Choose how you hold this land.',
);
const areaUnitSchema = enumOf<LandAreaUnit>([...ALL_LAND_AREA_UNITS], 'Choose a unit.');
const documentKindSchema = enumOf<DocumentKind>(
  [...ALL_DOCUMENT_KINDS],
  'Choose a document type.',
);
const stepSchema = enumOf<RegistrationStep>([...STEP_SEQUENCE], 'Unknown step.');

/** Coordinates are only meaningful together (§12). */
const coordinatesArePaired = (value: {
  latitude?: number | null;
  longitude?: number | null;
}): boolean =>
  (value.latitude === null || value.latitude === undefined) ===
  (value.longitude === null || value.longitude === undefined);

const COORDINATE_MESSAGE = {
  message: 'Provide both latitude and longitude, or neither.',
  path: ['latitude'],
};

// --- Start registration ----------------------------------------------------

export const startRegistrationSchema = z
  .object({
    fullName: fullNameSchema,
    preferredLanguage: languageSchema,
  })
  .strict();

// --- Personal details (§41.4) ----------------------------------------------

export const personalDetailsSchema = z
  .object({
    fullName: fullNameSchema,
    /** Optional name in the farmer's own script. Never machine-translated. */
    fullNameLocal: optionalText(120),
    // Age determines eligibility for several procurement and pension schemes,
    // which is why a date of birth is collected at all (§11).
    dateOfBirth: pastCalendarDateSchema.nullable().optional(),
    // Collected for women-farmer scheme reporting; PREFER_NOT_TO_SAY exists so
    // it is never a forced disclosure.
    gender: genderSchema.nullable().optional(),
    preferredLanguage: languageSchema.optional(),
  })
  .strict();

// --- Address (§41.5) — residence, not land ---------------------------------

export const addressSchema = z
  .object({
    village: z.string().trim().min(1, 'Enter your village or locality.').max(120),
    addressLine1: optionalText(160),
    addressLine2: optionalText(160),
    pincode: pincodeSchema,
    stateId: uuidSchema,
    districtId: uuidSchema,
    // Optional throughout: device location is never required (§12).
    latitude: latitudeSchema.nullable().optional(),
    longitude: longitudeSchema.nullable().optional(),
  })
  .strict()
  .refine(coordinatesArePaired, COORDINATE_MESSAGE);

// --- Land holdings (§41.6) -------------------------------------------------

const landHoldingFields = {
  ownershipType: ownershipSchema,
  area: z
    .number()
    .positive('Enter the land area.')
    .max(100_000, 'Check the area you entered.'),
  areaUnit: areaUnitSchema,
  surveyNumber: optionalText(60),
  village: optionalText(120),
  districtId: uuidSchema.nullable().optional(),
  stateId: uuidSchema.nullable().optional(),
  pincode: pincodeSchema.nullable().optional(),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
  primaryCrop: optionalText(80),
};

export const createLandHoldingSchema = z
  .object(landHoldingFields)
  .strict()
  .refine(coordinatesArePaired, COORDINATE_MESSAGE);

export const updateLandHoldingSchema = z
  .object({
    ownershipType: ownershipSchema.optional(),
    area: landHoldingFields.area.optional(),
    areaUnit: areaUnitSchema.optional(),
    surveyNumber: landHoldingFields.surveyNumber,
    village: landHoldingFields.village,
    districtId: landHoldingFields.districtId,
    stateId: landHoldingFields.stateId,
    pincode: landHoldingFields.pincode,
    latitude: landHoldingFields.latitude,
    longitude: landHoldingFields.longitude,
    primaryCrop: landHoldingFields.primaryCrop,
  })
  .strict()
  .refine(coordinatesArePaired, COORDINATE_MESSAGE)
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to update.',
  });

// --- Documents (§41.7, §41.8) ----------------------------------------------

export const uploadDocumentSchema = z
  .object({ documentKind: documentKindSchema })
  .strict();

// --- Navigation / preferences ----------------------------------------------

export const saveStepSchema = z.object({ currentStep: stepSchema }).strict();

export const setLanguageSchema = z.object({ preferredLanguage: languageSchema }).strict();

export type StartRegistrationBody = z.infer<typeof startRegistrationSchema>;
export type PersonalDetailsBody = z.infer<typeof personalDetailsSchema>;
export type AddressBody = z.infer<typeof addressSchema>;
export type CreateLandHoldingBody = z.infer<typeof createLandHoldingSchema>;
export type UpdateLandHoldingBody = z.infer<typeof updateLandHoldingSchema>;
