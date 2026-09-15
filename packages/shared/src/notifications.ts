/**
 * Notifications & farmer messages (Phase: Notifications).
 *
 * System notifications are stored as i18n KEY + params (see
 * `NotificationListItem.titleKey`) so wording lives in one place — the
 * translation bundles — never duplicated into rows. A government message is
 * the one deliberate exception: it is free text a human typed in each
 * language, so it carries `title`/`body` prose directly instead of a key.
 */

export const NOTIFICATION_CATEGORIES = {
  VERIFICATION: 'VERIFICATION',
  BOOKING: 'BOOKING',
  QUEUE: 'QUEUE',
  PROCUREMENT: 'PROCUREMENT',
  PAYMENT: 'PAYMENT',
  SYSTEM: 'SYSTEM',
  GOVERNMENT_MESSAGE: 'GOVERNMENT_MESSAGE',
} as const;
export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORIES)[keyof typeof NOTIFICATION_CATEGORIES];

export const NOTIFICATION_PRIORITIES = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type NotificationPriority =
  (typeof NOTIFICATION_PRIORITIES)[keyof typeof NOTIFICATION_PRIORITIES];

export const NOTIFICATION_EVENT_TYPES = {
  VERIFICATION_APPROVED: 'VERIFICATION_APPROVED',
  VERIFICATION_REJECTED: 'VERIFICATION_REJECTED',
  VERIFICATION_ACTION_REQUIRED: 'VERIFICATION_ACTION_REQUIRED',
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  ARRIVAL_RECORDED: 'ARRIVAL_RECORDED',
  QUEUE_JOINED: 'QUEUE_JOINED',
  QUEUE_POSITION_CHANGED: 'QUEUE_POSITION_CHANGED',
  PROCUREMENT_STARTED: 'PROCUREMENT_STARTED',
  PROCUREMENT_COMPLETED: 'PROCUREMENT_COMPLETED',
  PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_RETRY: 'PAYMENT_RETRY',
  GOVERNMENT_MESSAGE: 'GOVERNMENT_MESSAGE',
  GRIEVANCE_RESPONSE_ADDED: 'GRIEVANCE_RESPONSE_ADDED',
} as const;
export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];

/** One row in the full notification centre (`/farmer/notifications`), as
 *  opposed to the lighter `NotificationSummaryItem` the dashboard card uses. */
export interface NotificationListItem {
  id: string;
  category: NotificationCategory;
  eventType: string;
  priority: NotificationPriority;
  /** i18n key + params — used for every category except GOVERNMENT_MESSAGE. */
  titleKey: string;
  bodyKey: string | null;
  params: Record<string, string | number | boolean>;
  /** Free-text prose, present only for GOVERNMENT_MESSAGE. */
  title: string | null;
  body: string | null;
  bookingId: string | null;
  paymentId: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationListItem[];
  unreadCount: number;
  /** Pass back as `?before=` to fetch the next page; null on the last page. */
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Government messages (§7)
// ---------------------------------------------------------------------------

export const MESSAGE_AUDIENCE_TYPES = {
  FARMER: 'FARMER',
  CENTRE: 'CENTRE',
  DISTRICT: 'DISTRICT',
  STATE: 'STATE',
} as const;
export type MessageAudienceType =
  (typeof MESSAGE_AUDIENCE_TYPES)[keyof typeof MESSAGE_AUDIENCE_TYPES];

export interface CreateFarmerMessageRequest {
  audienceType: MessageAudienceType;
  audienceStateId?: string | null;
  audienceDistrictId?: string | null;
  audienceCentreId?: string | null;
  audienceFarmerId?: string | null;
  titleEn: string;
  bodyEn: string;
  titleTa?: string | null;
  bodyTa?: string | null;
  titleKn?: string | null;
  bodyKn?: string | null;
  titleHi?: string | null;
  bodyHi?: string | null;
  titleMl?: string | null;
  bodyMl?: string | null;
  priority?: NotificationPriority;
  /** Optional; open-ended — no scheduling lifecycle in this phase (§23). */
  expiresAt?: string | null;
}

/** Which of the five languages this message was actually authored in (§95,
 *  §96) — a composer shows this rather than pretending completeness. */
export interface MessageTranslationStatus {
  en: boolean;
  ta: boolean;
  kn: boolean;
  hi: boolean;
  ml: boolean;
}

export interface FarmerMessageHistoryItem {
  id: string;
  audienceType: MessageAudienceType;
  audienceLabel: string;
  titleEn: string;
  bodyEn: string;
  titleTa: string | null;
  bodyTa: string | null;
  titleKn: string | null;
  bodyKn: string | null;
  titleHi: string | null;
  bodyHi: string | null;
  titleMl: string | null;
  bodyMl: string | null;
  translationStatus: MessageTranslationStatus;
  priority: NotificationPriority;
  status: 'PUBLISHED' | 'EXPIRED';
  publishedAt: string;
  expiresAt: string | null;
  recipientCount: number;
  readCount: number;
}
