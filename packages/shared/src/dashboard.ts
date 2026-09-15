import type { FarmerAccountState } from './account.js';
import type { RegistrationStatus, RegistrationStep } from './registration.js';
import type { VerificationCheck } from './models.js';
import type { Gender } from './status.js';
import type { FarmerProcurementStatus } from './procurementStatus.js';

/**
 * Farmer dashboard contract (§30).
 *
 * One request feeds the whole page, because these sections are always shown
 * together and three parallel fetches would produce three independent loading
 * states for one screen.
 */

/**
 * Whether a dashboard section has anything to say.
 *
 * `NOT_AVAILABLE` is distinct from `EMPTY` on purpose. "You have no bookings"
 * and "booking does not exist yet" are different facts, and collapsing them
 * would mean the UI quietly asserts something untrue about the system (§37).
 * Later phases flip these to `OK` by supplying a real provider.
 */
export const SECTION_STATUSES = {
  /** The subsystem is not implemented yet. */
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  /** Implemented, and this farmer genuinely has nothing. */
  EMPTY: 'EMPTY',
  OK: 'OK',
} as const;

export type SectionStatus = (typeof SECTION_STATUSES)[keyof typeof SECTION_STATUSES];

/**
 * A procurement booking as the dashboard needs it.
 *
 * Declared now so Phase 4 has a contract to satisfy; nothing populates it yet
 * and nothing fabricates it.
 */
export interface BookingSummaryItem {
  /** For linking to the live status page. */
  bookingId: string;
  reference: string;
  crop: string;
  quantityQtl: number;
  centreName: string;
  /** Calendar date in the business timezone, "YYYY-MM-DD". */
  date: string;
  /** Local wall-clock "HH:MM". */
  slotStart: string | null;
  slotEnd: string | null;
  status: string;
  /** Farmer-facing status (Phase 6); see procurementStatus.ts. */
  farmerStatus: FarmerProcurementStatus;
  /** Only when the queue module has published real figures (§20). */
  queuePosition: number | null;
  estimatedWaitMinutes: number | null;

  /** Phase 8 — present once the procurement is confirmed. */
  procurementReference: string | null;
  acceptedQuantityKg: string | null;
  netAmount: string | null;
  paymentStatus: string | null;
  paymentIsDemo: boolean | null;
}

export interface BookingSummary {
  status: SectionStatus;
  upcoming: BookingSummaryItem | null;
  active: BookingSummaryItem | null;
  mostRecentCompleted: BookingSummaryItem | null;
}

export interface NotificationSummaryItem {
  id: string;
  /** i18n key, so a message is readable in the farmer's language. */
  titleKey: string;
  body: string | null;
  /** Localised body, interpolated with `params` on the client. */
  bodyKey: string | null;
  params: Record<string, string | number | boolean>;
  /** Where tapping the notification should go, when it has somewhere to go. */
  bookingId: string | null;
  createdAt: string;
  read: boolean;
  /** Free-text prose title — set only for a GOVERNMENT_MESSAGE, where
   *  `titleKey` still resolves but is not what should be shown (§16). */
  title: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

export interface NotificationSummary {
  status: SectionStatus;
  unreadCount: number;
  recent: NotificationSummaryItem[];
}

/** The identity and farm details the dashboard shows. Never documents or ids. */
export interface DashboardFarmer {
  farmerReferenceId: string;
  name: string | null;
  nameLocal: string | null;
  phone: string | null;
  gender: Gender | null;
  village: string | null;
  districtName: string | null;
  stateName: string | null;
  primaryCrop: string | null;
  landAreaAcres: number | null;
  landHoldingCount: number;
  /** Whether coordinates were recorded — never the coordinates themselves. */
  hasFarmLocation: boolean;
}

export interface DashboardVerification {
  state: FarmerAccountState;
  registrationStatus: RegistrationStatus;
  submittedAt: string | null;
  verifiedAt: string | null;
  reviewNotes: string | null;
  checks: VerificationCheck[];
  /** Set when the farmer still has registration work to do. */
  resumeStep: RegistrationStep | null;
  completedSteps: RegistrationStep[];
  remainingSteps: RegistrationStep[];
  /** How many documents or land entries a reviewer sent back. */
  itemsNeedingAction: number;
}

export interface DashboardResponse {
  farmer: DashboardFarmer;
  verification: DashboardVerification;
  bookingSummary: BookingSummary;
  notificationSummary: NotificationSummary;
}

// ---------------------------------------------------------------------------
// Context-aware primary action (§10, §36)
// ---------------------------------------------------------------------------

/**
 * The single most useful next thing, derived from real state.
 *
 * `available: false` means the destination belongs to a phase that does not
 * exist yet. The UI renders it disabled with an honest explanation rather than
 * linking to a page that would 404 or, worse, pretending it works.
 */
export interface PrimaryAction {
  labelKey: string;
  /** Null when the action is not available yet. */
  to: string | null;
  available: boolean;
  /** Optional explanation shown under an unavailable action. */
  noteKey?: string;
}

export function primaryActionFor(
  state: FarmerAccountState,
  booking: BookingSummary,
): PrimaryAction {
  switch (state) {
    case 'NO_PROFILE':
      return {
        labelKey: 'dashboard.action.startRegistration',
        to: '/farmer/registration/start',
        available: true,
      };

    case 'REGISTRATION_INCOMPLETE':
      return {
        labelKey: 'dashboard.action.continueRegistration',
        to: '/farmer/welcome',
        available: true,
      };

    case 'AWAITING_REVIEW':
      return {
        labelKey: 'dashboard.action.viewVerification',
        to: '/farmer/status',
        available: true,
      };

    case 'ACTION_REQUIRED':
      return {
        labelKey: 'dashboard.action.updateInformation',
        to: '/farmer/status',
        available: true,
      };

    case 'VERIFIED': {
      // Phase 3 left both of these inert because booking did not exist yet.
      // Phase 4 implemented it, so they are live.
      const current = booking.active ?? booking.upcoming;

      return current
        ? {
            labelKey: 'dashboard.action.viewBooking',
            to: '/farmer/bookings',
            available: true,
          }
        : {
            labelKey: 'dashboard.action.bookSlot',
            to: '/farmer/book',
            available: true,
          };
    }

    default:
      return {
        labelKey: 'dashboard.action.viewVerification',
        to: '/farmer/status',
        available: true,
      };
  }
}
