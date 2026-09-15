import type { SupabaseClient } from '@supabase/supabase-js';
import type { FarmerMessageHistoryItem, MessageAudienceType, Role } from '@kisansetu/shared';
import { forbidden, notFound, validationError } from '../../lib/errors.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { unwrap, unwrapMaybe } from '../../repositories/postgrestError.js';
import { findCentreById, findDistrictById } from '../../repositories/centresRepository.js';
import type { AuthContext } from '../../types/request.js';
import type { CreateFarmerMessageBody } from '../../schemas/farmerMessage.js';

/**
 * Government messages (§7, §21, §22).
 *
 * Every scope check here is re-done at the database by
 * `farmer_messages_insert_scoped` (§26) — this is not the only guard, it is
 * the one that produces a message a composer can show next to a field,
 * before the request even reaches Postgres.
 */

async function assertFarmerInScope(
  farmerUserId: string,
  role: Role,
  districtId: string | null,
  stateId: string | null,
): Promise<void> {
  const row = unwrapMaybe<{ district_id: string | null; state_id: string | null }>(
    await supabaseAdminClient
      .from('farmer_profiles')
      .select('district_id, state_id')
      .eq('user_id', farmerUserId)
      .maybeSingle(),
    'farmerProfiles.forMessageScope',
  );

  if (!row) throw notFound('That farmer account does not exist.');

  const inScope =
    role === 'DISTRICT_ADMIN' ? row.district_id === districtId : row.state_id === stateId;

  if (!inScope) {
    throw forbidden('That farmer is outside your district or state.');
  }
}

async function assertCentreInScope(
  db: SupabaseClient,
  centreId: string,
  role: Role,
  districtId: string | null,
  stateId: string | null,
): Promise<void> {
  const centre = await findCentreById(db, centreId);
  if (!centre) throw notFound('That procurement centre does not exist.');

  if (role === 'DISTRICT_ADMIN') {
    if (centre.districtId !== districtId) throw forbidden('That centre is outside your district.');
    return;
  }

  const district = await findDistrictById(db, centre.districtId);
  if (!district || district.stateId !== stateId) {
    throw forbidden('That centre is outside your state.');
  }
}

async function assertDistrictInScope(
  db: SupabaseClient,
  targetDistrictId: string,
  role: Role,
  districtId: string | null,
  stateId: string | null,
): Promise<void> {
  if (role === 'DISTRICT_ADMIN') {
    if (targetDistrictId !== districtId) throw forbidden('You do not have access to that district.');
    return;
  }

  const district = await findDistrictById(db, targetDistrictId);
  if (!district || district.stateId !== stateId) {
    throw forbidden('That district is outside your state.');
  }
}

/** Resolves the real recipient user ids for an audience. Bulk, no N+1 (§33). */
async function resolveRecipients(input: CreateFarmerMessageBody): Promise<string[]> {
  if (input.audienceType === 'FARMER') {
    return [input.audienceFarmerId!];
  }

  if (input.audienceType === 'CENTRE') {
    const rows = unwrap<Array<{ farmer_user_id: string }>>(
      await supabaseAdminClient
        .from('bookings')
        .select('farmer_user_id')
        .eq('centre_id', input.audienceCentreId!),
      'bookings.recipientsForCentre',
    );
    return [...new Set(rows.map((row) => row.farmer_user_id))];
  }

  const column = input.audienceType === 'DISTRICT' ? 'district_id' : 'state_id';
  const value = input.audienceType === 'DISTRICT' ? input.audienceDistrictId : input.audienceStateId;

  const rows = unwrap<Array<{ user_id: string }>>(
    await supabaseAdminClient.from('farmer_profiles').select('user_id').eq(column, value!),
    'farmerProfiles.recipientsForAudience',
  );
  return rows.map((row) => row.user_id);
}

interface PublishedMessageRow {
  id: string;
  audience_type: MessageAudienceType;
  title_en: string;
  body_en: string;
  title_ta: string | null;
  body_ta: string | null;
  title_kn: string | null;
  body_kn: string | null;
  title_hi: string | null;
  body_hi: string | null;
  title_ml: string | null;
  body_ml: string | null;
  priority: FarmerMessageHistoryItem['priority'];
  status: FarmerMessageHistoryItem['status'];
  published_at: string;
  expires_at: string | null;
  recipient_count: number;
}

const MESSAGE_SELECT =
  'id, audience_type, title_en, body_en, title_ta, body_ta, title_kn, body_kn, ' +
  'title_hi, body_hi, title_ml, body_ml, priority, status, published_at, expires_at, recipient_count';

function toHistoryItem(row: PublishedMessageRow, readCount: number): FarmerMessageHistoryItem {
  return {
    id: row.id,
    audienceType: row.audience_type,
    audienceLabel: row.audience_type,
    titleEn: row.title_en,
    bodyEn: row.body_en,
    titleTa: row.title_ta,
    bodyTa: row.body_ta,
    titleKn: row.title_kn,
    bodyKn: row.body_kn,
    titleHi: row.title_hi,
    bodyHi: row.body_hi,
    titleMl: row.title_ml,
    bodyMl: row.body_ml,
    // §95: shown to the sender so an incomplete message is never mistaken
    // for a fully localized one.
    translationStatus: {
      en: true,
      ta: row.title_ta !== null,
      kn: row.title_kn !== null,
      hi: row.title_hi !== null,
      ml: row.title_ml !== null,
    },
    priority: row.priority,
    status: row.status,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    recipientCount: row.recipient_count,
    readCount,
  };
}

export async function publishFarmerMessage(
  auth: AuthContext,
  input: CreateFarmerMessageBody,
): Promise<FarmerMessageHistoryItem> {
  const { role, scope, db, userId } = auth;

  if (role !== 'DISTRICT_ADMIN' && role !== 'STATE_ADMIN') {
    throw forbidden('Only a district or state admin can send farmer messages.');
  }
  if (input.audienceType === 'STATE' && role !== 'STATE_ADMIN') {
    throw forbidden('Only a state admin can send a state-wide message.');
  }

  // §22: verify the specific target before anything is created.
  if (input.audienceType === 'FARMER') {
    await assertFarmerInScope(input.audienceFarmerId!, role, scope.districtId, scope.stateId);
  } else if (input.audienceType === 'CENTRE') {
    await assertCentreInScope(db, input.audienceCentreId!, role, scope.districtId, scope.stateId);
  } else if (input.audienceType === 'DISTRICT') {
    await assertDistrictInScope(db, input.audienceDistrictId!, role, scope.districtId, scope.stateId);
  } else if (input.audienceStateId !== scope.stateId) {
    throw forbidden('You do not have access to that state.');
  }

  const recipients = await resolveRecipients(input);

  const message = unwrapMaybe<PublishedMessageRow>(
    await db
      .from('farmer_messages')
      .insert({
        sender_user_id: userId,
        sender_role: role,
        audience_type: input.audienceType,
        audience_state_id: input.audienceStateId ?? null,
        audience_district_id: input.audienceDistrictId ?? null,
        audience_centre_id: input.audienceCentreId ?? null,
        audience_farmer_id: input.audienceFarmerId ?? null,
        title_en: input.titleEn,
        body_en: input.bodyEn,
        title_ta: input.titleTa ?? null,
        body_ta: input.bodyTa ?? null,
        title_kn: input.titleKn ?? null,
        body_kn: input.bodyKn ?? null,
        title_hi: input.titleHi ?? null,
        body_hi: input.bodyHi ?? null,
        title_ml: input.titleMl ?? null,
        body_ml: input.bodyMl ?? null,
        priority: input.priority ?? 'NORMAL',
        expires_at: input.expiresAt ?? null,
        recipient_count: recipients.length,
      })
      .select(MESSAGE_SELECT)
      .single(),
    'farmerMessages.insert',
  );

  if (!message) throw validationError('Could not publish that message.');

  if (recipients.length > 0) {
    const rows = recipients.map((recipientUserId) => ({
      user_id: recipientUserId,
      category: 'GOVERNMENT_MESSAGE',
      event_type: 'GOVERNMENT_MESSAGE',
      title_key: 'notification.GOVERNMENT_MESSAGE.title',
      body_key: null,
      params: {},
      title_en: message.title_en,
      title_ta: message.title_ta,
      title_kn: message.title_kn,
      title_hi: message.title_hi,
      title_ml: message.title_ml,
      body_en: message.body_en,
      body_ta: message.body_ta,
      body_kn: message.body_kn,
      body_hi: message.body_hi,
      body_ml: message.body_ml,
      priority: message.priority,
      message_id: message.id,
    }));

    // One statement, not a loop (§33). Supabase batches this as a single
    // multi-row insert. `.select('id')` is required here, not decoration —
    // without it PostgREST returns no representation and `unwrap()` (which
    // every write in this codebase relies on to detect a silently-failed
    // insert) treats that as an error.
    unwrap(
      await supabaseAdminClient.from('notifications').insert(rows).select('id'),
      'notifications.bulkInsertForMessage',
    );
  }

  return toHistoryItem(message, 0);
}

/** The sender's own message history, with real read counts (§43). */
export async function listSentMessages(
  db: SupabaseClient,
  senderUserId: string,
  limit: number,
): Promise<FarmerMessageHistoryItem[]> {
  const messages = unwrap<PublishedMessageRow[]>(
    await db
      .from('farmer_messages')
      .select(MESSAGE_SELECT)
      .eq('sender_user_id', senderUserId)
      .order('published_at', { ascending: false })
      .limit(limit),
    'farmerMessages.listSent',
  );

  if (messages.length === 0) return [];

  // One query for every message's read count, not one query per message.
  const readCounts = unwrap<Array<{ message_id: string }>>(
    await supabaseAdminClient
      .from('notifications')
      .select('message_id')
      .in(
        'message_id',
        messages.map((message) => message.id),
      )
      .not('read_at', 'is', null),
    'notifications.readCountsForMessages',
  );

  const countByMessage = new Map<string, number>();
  for (const row of readCounts) {
    countByMessage.set(row.message_id, (countByMessage.get(row.message_id) ?? 0) + 1);
  }

  return messages.map((message) => toHistoryItem(message, countByMessage.get(message.id) ?? 0));
}
