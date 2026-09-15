import type { SupabaseClient } from '@supabase/supabase-js';
import { SECTION_STATUSES } from '@kisansetu/shared';
import type {
  Language,
  NotificationListItem,
  NotificationListResponse,
  NotificationSummary,
  NotificationSummaryItem,
} from '@kisansetu/shared';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { unwrap } from '../../repositories/postgrestError.js';
import type { NotificationSummaryProvider } from '../dashboard/summaryProviders.js';

/**
 * In-app notifications (Phase 8 §24; the Phase 11 store, completed here).
 *
 * Rows are written by the database — from real triggers on payments,
 * bookings, booking_operations and farmer_profiles (see the notifications
 * migration) — never by a client, and carry i18n keys plus parameters rather
 * than prose, so each farmer reads them in their own language. A government
 * message is the one exception and carries prose directly (§16).
 */

const NOTIFICATION_COLUMNS =
  'id, category, event_type, priority, title_key, body_key, params, ' +
  'title_en, title_ta, title_kn, title_hi, title_ml, ' +
  'body_en, body_ta, body_kn, body_hi, body_ml, ' +
  'booking_id, payment_id, read_at, created_at';

interface NotificationRow {
  id: string;
  category: string;
  event_type: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  title_key: string;
  body_key: string | null;
  params: Record<string, string | number | boolean> | null;
  title_en: string | null;
  title_ta: string | null;
  title_kn: string | null;
  title_hi: string | null;
  title_ml: string | null;
  body_en: string | null;
  body_ta: string | null;
  body_kn: string | null;
  body_hi: string | null;
  body_ml: string | null;
  booking_id: string | null;
  payment_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** Picks the prose in the caller's language, falling back to English (§16,
 *  §50): a language with no author-supplied variant for this one message —
 *  most commonly kn/hi/ml on an older or partially-translated message — reads
 *  it in English rather than showing nothing. */
function localizedProse(language: Language, row: NotificationRow, field: 'title' | 'body'): string | null {
  const en = field === 'title' ? row.title_en : row.body_en;
  if (en === null) return null;
  const byLanguage: Record<Language, string | null> = {
    en,
    ta: field === 'title' ? row.title_ta : row.body_ta,
    kn: field === 'title' ? row.title_kn : row.body_kn,
    hi: field === 'title' ? row.title_hi : row.body_hi,
    ml: field === 'title' ? row.title_ml : row.body_ml,
  };
  return byLanguage[language] ?? en;
}

function toListItem(row: NotificationRow, language: Language): NotificationListItem {
  return {
    id: row.id,
    category: row.category as NotificationListItem['category'],
    eventType: row.event_type,
    priority: row.priority,
    titleKey: row.title_key,
    bodyKey: row.body_key,
    params: row.params ?? {},
    title: localizedProse(language, row, 'title'),
    body: localizedProse(language, row, 'body'),
    bookingId: row.booking_id,
    paymentId: row.payment_id,
    read: row.read_at !== null,
    createdAt: row.created_at,
  };
}

function toSummaryItem(row: NotificationRow, language: Language): NotificationSummaryItem {
  return {
    id: row.id,
    titleKey: row.title_key,
    body: localizedProse(language, row, 'body'),
    bodyKey: row.body_key,
    params: row.params ?? {},
    bookingId: row.booking_id,
    createdAt: row.created_at,
    read: row.read_at !== null,
    title: localizedProse(language, row, 'title'),
    priority: row.priority,
  };
}

/** GET /api/farmer/notifications — cursor-paginated, newest first (§19). */
export async function listNotificationsPage(
  db: SupabaseClient,
  userId: string,
  language: Language,
  limit: number,
  before: string | null,
): Promise<NotificationListResponse> {
  let query = db
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (before) query = query.lt('created_at', before);

  const [rows, unread] = await Promise.all([
    unwrap<NotificationRow[]>(await query, 'notifications.listPage'),
    db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map((row) => toListItem(row, language)),
    unreadCount: unread.count ?? 0,
    nextCursor: hasMore ? page[page.length - 1]!.created_at : null,
  };
}

/** For the farmer dashboard card — the most recent few, summary shape. */
export async function listNotifications(
  db: SupabaseClient,
  userId: string,
  limit: number,
  language: Language = 'en',
): Promise<{ items: NotificationSummaryItem[]; unreadCount: number }> {
  const [rows, unread] = await Promise.all([
    unwrap<NotificationRow[]>(
      await db
        .from('notifications')
        .select(NOTIFICATION_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
      'notifications.list',
    ),
    db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null),
  ]);

  return {
    items: rows.map((row) => toSummaryItem(row, language)),
    unreadCount: unread.count ?? 0,
  };
}

/** Marks one of the CALLER'S OWN notifications read. Ownership is enforced
 *  by the `.eq('user_id', userId)` guard, never by trusting the caller. */
export async function markOneRead(userId: string, notificationId: string): Promise<void> {
  await supabaseAdminClient
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId)
    .is('read_at', null);
}

/** Marks all of the caller's own notifications read. Nothing else is writable. */
export async function markAllRead(userId: string): Promise<void> {
  await supabaseAdminClient
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
}

/** Replaces the Phase 3 placeholder on the farmer dashboard. */
export class SupabaseNotificationProvider implements NotificationSummaryProvider {
  readonly name = 'SupabaseNotificationProvider';

  async forFarmer(farmerUserId: string, language: Language = 'en'): Promise<NotificationSummary> {
    // Service role, pinned to this farmer — the same reasoning as the booking provider.
    const { items, unreadCount } = await listNotifications(
      supabaseAdminClient,
      farmerUserId,
      5,
      language,
    );
    return {
      status: items.length > 0 ? SECTION_STATUSES.OK : SECTION_STATUSES.EMPTY,
      unreadCount,
      recent: items,
    };
  }
}
