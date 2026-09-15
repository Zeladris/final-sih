import type { Language } from './language.js';

/**
 * Feedback, Grievances, Helpline & Government Schemes.
 *
 * Five sub-features sharing one rule throughout: real information only.
 * Nothing here fabricates a helpline number, a scheme benefit, or an
 * eligibility decision — every published record carries a source and a
 * verification date, and the UI says so.
 */

// ---------------------------------------------------------------------------
// Feedback (§4)
// ---------------------------------------------------------------------------

export const FEEDBACK_CATEGORIES = {
  APP_EXPERIENCE: 'APP_EXPERIENCE',
  BOOKING: 'BOOKING',
  CENTRE_SERVICE: 'CENTRE_SERVICE',
  QUEUE: 'QUEUE',
  PROCUREMENT: 'PROCUREMENT',
  PAYMENT: 'PAYMENT',
  VOICE: 'VOICE',
  AI_ASSESSMENT: 'AI_ASSESSMENT',
  GENERAL: 'GENERAL',
  OTHER: 'OTHER',
} as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[keyof typeof FEEDBACK_CATEGORIES];
export const ALL_FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = Object.values(FEEDBACK_CATEGORIES);

export interface SubmitFeedbackRequest {
  category: FeedbackCategory;
  rating?: number | null;
  message?: string | null;
  bookingId?: string | null;
  procurementId?: string | null;
  centreId?: string | null;
}

export interface FeedbackView {
  id: string;
  category: FeedbackCategory;
  rating: number | null;
  message: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Grievances (§6, §7)
// ---------------------------------------------------------------------------

export const GRIEVANCE_CATEGORIES = {
  BOOKING: 'BOOKING',
  CENTRE_SERVICE: 'CENTRE_SERVICE',
  QUEUE_DELAY: 'QUEUE_DELAY',
  WEIGHING: 'WEIGHING',
  QUALITY_ASSESSMENT: 'QUALITY_ASSESSMENT',
  PROCUREMENT: 'PROCUREMENT',
  PAYMENT: 'PAYMENT',
  DOCUMENT_VERIFICATION: 'DOCUMENT_VERIFICATION',
  APP_TECHNICAL: 'APP_TECHNICAL',
  VOICE_BOOKING: 'VOICE_BOOKING',
  OTHER: 'OTHER',
} as const;
export type GrievanceCategory = (typeof GRIEVANCE_CATEGORIES)[keyof typeof GRIEVANCE_CATEGORIES];
export const ALL_GRIEVANCE_CATEGORIES: readonly GrievanceCategory[] = Object.values(GRIEVANCE_CATEGORIES);

export const GRIEVANCE_PRIORITIES = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type GrievancePriority = (typeof GRIEVANCE_PRIORITIES)[keyof typeof GRIEVANCE_PRIORITIES];
export const ALL_GRIEVANCE_PRIORITIES: readonly GrievancePriority[] = Object.values(GRIEVANCE_PRIORITIES);

export const GRIEVANCE_STATUSES = {
  SUBMITTED: 'SUBMITTED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ESCALATED: 'ESCALATED',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  CLOSED_INVALID: 'CLOSED_INVALID',
} as const;
export type GrievanceStatus = (typeof GRIEVANCE_STATUSES)[keyof typeof GRIEVANCE_STATUSES];
export const ALL_GRIEVANCE_STATUSES: readonly GrievanceStatus[] = Object.values(GRIEVANCE_STATUSES);

/** Where the case currently sits. Not a fairness signal — §6 is explicit
 *  that priority here must never touch the procurement queue. */
export const GRIEVANCE_TRANSITIONS: Record<GrievanceStatus, readonly GrievanceStatus[]> = {
  SUBMITTED: ['ACKNOWLEDGED', 'UNDER_REVIEW', 'CLOSED_INVALID'],
  ACKNOWLEDGED: ['UNDER_REVIEW', 'CLOSED_INVALID'],
  UNDER_REVIEW: ['ESCALATED', 'ACTION_REQUIRED', 'RESOLVED', 'CLOSED_INVALID'],
  ESCALATED: ['UNDER_REVIEW', 'ACTION_REQUIRED', 'RESOLVED', 'CLOSED_INVALID'],
  ACTION_REQUIRED: ['UNDER_REVIEW', 'RESOLVED', 'CLOSED_INVALID'],
  RESOLVED: ['CLOSED', 'UNDER_REVIEW'],
  CLOSED: [],
  CLOSED_INVALID: [],
};

export function canTransitionGrievance(from: GrievanceStatus, to: GrievanceStatus): boolean {
  return GRIEVANCE_TRANSITIONS[from].includes(to);
}

export const TERMINAL_GRIEVANCE_STATUSES: readonly GrievanceStatus[] = ['CLOSED', 'CLOSED_INVALID'];
export function isTerminalGrievanceStatus(status: GrievanceStatus): boolean {
  return TERMINAL_GRIEVANCE_STATUSES.includes(status);
}

export interface SubmitGrievanceRequest {
  category: GrievanceCategory;
  subCategory?: string | null;
  subject: string;
  description: string;
  bookingId?: string | null;
  procurementId?: string | null;
}

export interface GrievanceListItem {
  id: string;
  reference: string;
  category: GrievanceCategory;
  subject: string;
  status: GrievanceStatus;
  priority: GrievancePriority;
  bookingId: string | null;
  procurementId: string | null;
  createdAt: string;
  updatedAt: string;
  /** The most recent farmer-visible response, if any — shown on the card
   *  without a second request (§12). */
  latestResponse: string | null;
}

export interface GrievanceStatusHistoryItem {
  fromStatus: GrievanceStatus | null;
  toStatus: GrievanceStatus;
  changedByRole: string | null;
  changeReason: string | null;
  createdAt: string;
}

export interface GrievanceResponseItem {
  id: string;
  message: string;
  createdAt: string;
}

export interface GrievanceNoteItem {
  id: string;
  note: string;
  authorId: string;
  createdAt: string;
}

export interface GrievanceAttachmentItem {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

export interface GrievanceDetail extends GrievanceListItem {
  description: string;
  farmerUserId: string;
  centreId: string | null;
  districtId: string | null;
  stateId: string | null;
  assignedUserId: string | null;
  assignedRole: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  history: GrievanceStatusHistoryItem[];
  responses: GrievanceResponseItem[];
  attachments: GrievanceAttachmentItem[];
  /** Present only for a staff/admin caller — never returned to the farmer,
   *  enforced at the database as well as here (§9). */
  notes?: GrievanceNoteItem[];
}

// ---------------------------------------------------------------------------
// Shared scope model (§18, §25)
// ---------------------------------------------------------------------------

export const SUPPORT_SCOPE_TYPES = {
  NATIONAL: 'NATIONAL',
  STATE: 'STATE',
  DISTRICT: 'DISTRICT',
  CENTRE: 'CENTRE',
} as const;
export type SupportScopeType = (typeof SUPPORT_SCOPE_TYPES)[keyof typeof SUPPORT_SCOPE_TYPES];
export const ALL_SUPPORT_SCOPE_TYPES: readonly SupportScopeType[] = Object.values(SUPPORT_SCOPE_TYPES);

/** One string per supported language — used for helpline/FAQ prose, which
 *  (unlike system notifications) is human-authored free text, not an i18n
 *  key (the same exception made for government messages). */
export interface LocalizedText {
  en: string;
  ta?: string | null;
  kn?: string | null;
  hi?: string | null;
  ml?: string | null;
}

export function pickLocalized(text: LocalizedText, language: Language): string {
  return (text[language] as string | null | undefined) ?? text.en;
}

// ---------------------------------------------------------------------------
// Helpline (§18)
// ---------------------------------------------------------------------------

export interface HelplineEntry {
  id: string;
  title: LocalizedText;
  description: LocalizedText | null;
  phoneNumber: string | null;
  email: string | null;
  officeName: string | null;
  address: string | null;
  scopeType: SupportScopeType;
  stateId: string | null;
  districtId: string | null;
  centreId: string | null;
  category: string;
  officialUrl: string | null;
  sourceReference: string | null;
  isActive: boolean;
  lastVerifiedAt: string | null;
}

export interface CreateHelplineRequest {
  titleEn: string;
  titleTa?: string | null;
  titleKn?: string | null;
  titleHi?: string | null;
  titleMl?: string | null;
  descriptionEn?: string | null;
  descriptionTa?: string | null;
  descriptionKn?: string | null;
  descriptionHi?: string | null;
  descriptionMl?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  officeName?: string | null;
  address?: string | null;
  scopeType: SupportScopeType;
  stateId?: string | null;
  districtId?: string | null;
  centreId?: string | null;
  category: string;
  officialUrl?: string | null;
  sourceReference?: string | null;
}

// ---------------------------------------------------------------------------
// Government schemes (§23, §24, §28)
// ---------------------------------------------------------------------------

export const SCHEME_CATEGORIES = {
  INCOME_SUPPORT: 'INCOME_SUPPORT',
  CROP_INSURANCE: 'CROP_INSURANCE',
  CREDIT: 'CREDIT',
  IRRIGATION: 'IRRIGATION',
  SEEDS: 'SEEDS',
  FERTILIZER: 'FERTILIZER',
  EQUIPMENT: 'EQUIPMENT',
  MECHANIZATION: 'MECHANIZATION',
  SOIL_HEALTH: 'SOIL_HEALTH',
  HORTICULTURE: 'HORTICULTURE',
  LIVESTOCK: 'LIVESTOCK',
  FISHERIES: 'FISHERIES',
  STORAGE: 'STORAGE',
  MARKET_ACCESS: 'MARKET_ACCESS',
  TRAINING: 'TRAINING',
  OTHER: 'OTHER',
} as const;
/** Data-driven per §24 — this list is a display-order suggestion for the
 *  filter UI, not a closed enum the database enforces. A new category can
 *  ship in a scheme record without a migration. */
export type SchemeCategory = (typeof SCHEME_CATEGORIES)[keyof typeof SCHEME_CATEGORIES];
export const ALL_SCHEME_CATEGORIES: readonly SchemeCategory[] = Object.values(SCHEME_CATEGORIES);

export const SCHEME_LEVELS = { NATIONAL: 'NATIONAL', STATE: 'STATE', DISTRICT: 'DISTRICT' } as const;
export type SchemeLevel = (typeof SCHEME_LEVELS)[keyof typeof SCHEME_LEVELS];

export const SCHEME_STATUSES = { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED', ARCHIVED: 'ARCHIVED' } as const;
export type SchemeStatus = (typeof SCHEME_STATUSES)[keyof typeof SCHEME_STATUSES];

export interface SchemeListItem {
  id: string;
  schemeCode: string | null;
  name: LocalizedText;
  shortDescription: LocalizedText | null;
  authorityName: string;
  category: string;
  level: SchemeLevel;
  /** Set only when the caller's own farmer profile was used to rank this
   *  list — never a claim of eligibility (§28). */
  relevanceReasons: string[];
  isSaved: boolean;
}

export interface SchemeDetail extends SchemeListItem {
  description: LocalizedText | null;
  departmentName: string | null;
  benefitSummary: LocalizedText | null;
  eligibilitySummary: LocalizedText | null;
  documentsSummary: LocalizedText | null;
  applicationMethod: LocalizedText | null;
  officialUrl: string | null;
  sourceReference: string;
  lastVerifiedAt: string | null;
  validFrom: string | null;
  validUntil: string | null;
  status: SchemeStatus;
}

export interface CreateSchemeRequest {
  schemeCode?: string | null;
  nameEn: string;
  nameTa?: string | null;
  nameKn?: string | null;
  nameHi?: string | null;
  nameMl?: string | null;
  shortDescriptionEn?: string | null;
  descriptionEn?: string | null;
  authorityName: string;
  departmentName?: string | null;
  level: SchemeLevel;
  stateId?: string | null;
  districtId?: string | null;
  category: string;
  benefitSummaryEn?: string | null;
  eligibilitySummaryEn?: string | null;
  documentsSummaryEn?: string | null;
  applicationMethodEn?: string | null;
  relevantCropCodes?: string[];
  officialUrl?: string | null;
  sourceReference: string;
  validFrom?: string | null;
  validUntil?: string | null;
}

// ---------------------------------------------------------------------------
// FAQs (§34)
// ---------------------------------------------------------------------------

export interface FaqItem {
  id: string;
  category: string;
  question: LocalizedText;
  answer: LocalizedText;
  sortOrder: number;
}
