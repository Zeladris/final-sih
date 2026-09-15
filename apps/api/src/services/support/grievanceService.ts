import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canTransitionGrievance,
  DOCUMENT_SIGNED_URL_TTL_SECONDS,
  isTerminalGrievanceStatus,
} from '@kisansetu/shared';
import type {
  GrievanceCategory,
  GrievanceDetail,
  GrievanceListItem,
  GrievancePriority,
  GrievanceStatus,
  Language,
  Role,
} from '@kisansetu/shared';
import { conflict, forbidden, internalError, notFound, validationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { sanitizeSearchTerm } from '../../lib/textSearch.js';
import { unwrap, unwrapMaybe } from '../../repositories/postgrestError.js';
import { findFarmerProfile } from '../../repositories/farmersRepository.js';
import { findCentreById, findDistrictById } from '../../repositories/centresRepository.js';
import {
  findDistrictAdminProfile,
  findProfileById,
  findStaffProfile,
  findStateAdminProfile,
} from '../../repositories/profilesRepository.js';
import type { AuthContext } from '../../types/request.js';

/**
 * Grievances (§6–§14) — a real case-management workflow, not a chat.
 *
 * Two rules hold everywhere in this file:
 *   1. Scope (centre/district/state) is computed HERE from real rows —
 *      a booking's centre, or the farmer's own profile — never accepted
 *      from the request body (§39).
 *   2. Every status/assignment WRITE goes through the service-role RPC from
 *      §29's migration, after this file validates the transition — RLS on
 *      `grievances` intentionally has no UPDATE policy, so a write that
 *      skips this file cannot happen even by accident.
 */

export interface SubmitGrievanceInput {
  category: GrievanceCategory;
  subCategory?: string | null;
  subject: string;
  description: string;
  bookingId?: string | null;
  procurementId?: string | null;
}

interface GrievanceRow {
  id: string;
  reference: string;
  farmer_user_id: string;
  booking_id: string | null;
  procurement_id: string | null;
  centre_id: string | null;
  district_id: string | null;
  state_id: string | null;
  category: GrievanceCategory;
  subject: string;
  description: string;
  priority: GrievancePriority;
  status: GrievanceStatus;
  assigned_user_id: string | null;
  assigned_role: Role | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
}

const GRIEVANCE_SELECT =
  'id, reference, farmer_user_id, booking_id, procurement_id, centre_id, district_id, state_id, ' +
  'category, subject, description, priority, status, assigned_user_id, assigned_role, ' +
  'created_at, updated_at, resolved_at, closed_at';

/** Real scope, resolved from real data — never a client-supplied id (§39). */
async function resolveScope(
  db: SupabaseClient,
  farmerUserId: string,
  bookingId: string | null | undefined,
): Promise<{ centreId: string | null; districtId: string | null; stateId: string | null }> {
  if (bookingId) {
    const booking = unwrapMaybe<{ centre_id: string; farmer_user_id: string }>(
      await db.from('bookings').select('centre_id, farmer_user_id').eq('id', bookingId).maybeSingle(),
      'bookings.forGrievanceScope',
    );
    if (booking && booking.farmer_user_id === farmerUserId) {
      const centre = await findCentreById(db, booking.centre_id);
      if (centre) {
        const district = await findDistrictById(db, centre.districtId);
        return { centreId: centre.id, districtId: centre.districtId, stateId: district?.stateId ?? null };
      }
    }
  }

  const farmer = await findFarmerProfile(db, farmerUserId);
  return { centreId: null, districtId: farmer?.districtId ?? null, stateId: farmer?.stateId ?? null };
}

function toListItem(row: GrievanceRow, latestResponse: string | null): GrievanceListItem {
  return {
    id: row.id,
    reference: row.reference,
    category: row.category,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    bookingId: row.booking_id,
    procurementId: row.procurement_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestResponse,
  };
}

export async function submitGrievance(
  auth: AuthContext,
  input: SubmitGrievanceInput,
): Promise<GrievanceListItem> {
  const { db, userId, preferredLanguage } = auth;

  // §45: a real, cheap duplicate check — same farmer, same transaction,
  // same category, still open. Never silently discards the new complaint,
  // only surfaces the existing one first (handled by the controller).
  if (input.bookingId) {
    const existing = unwrapMaybe<{ id: string; reference: string }>(
      await db
        .from('grievances')
        .select('id, reference')
        .eq('farmer_user_id', userId)
        .eq('booking_id', input.bookingId)
        .eq('category', input.category)
        .not('status', 'in', '("CLOSED","CLOSED_INVALID")')
        .maybeSingle(),
      'grievances.duplicateCheck',
    );
    if (existing) {
      throw conflict(
        `You already have an open complaint (${existing.reference}) about this transaction.`,
        { existingGrievanceId: existing.id },
      );
    }
  }

  const scope = await resolveScope(db, userId, input.bookingId);

  const row = unwrapMaybe<GrievanceRow>(
    await db
      .from('grievances')
      .insert({
        farmer_user_id: userId,
        booking_id: input.bookingId ?? null,
        procurement_id: input.procurementId ?? null,
        centre_id: scope.centreId,
        district_id: scope.districtId,
        state_id: scope.stateId,
        category: input.category,
        sub_category: input.subCategory ?? null,
        subject: input.subject.trim(),
        description: input.description.trim(),
        language_code: preferredLanguage,
      })
      .select(GRIEVANCE_SELECT)
      .single(),
    'grievances.insert',
  );

  if (!row) throw validationError('Could not submit that complaint.');
  return toListItem(row, null);
}

async function latestResponsesFor(
  db: SupabaseClient,
  grievanceIds: string[],
): Promise<Map<string, string>> {
  if (grievanceIds.length === 0) return new Map();
  const rows = unwrap<Array<{ grievance_id: string; message: string; created_at: string }>>(
    await db
      .from('grievance_responses')
      .select('grievance_id, message, created_at')
      .in('grievance_id', grievanceIds)
      .order('created_at', { ascending: false }),
    'grievanceResponses.latestFor',
  );
  const out = new Map<string, string>();
  for (const row of rows) {
    if (!out.has(row.grievance_id)) out.set(row.grievance_id, row.message);
  }
  return out;
}

export async function listOwnGrievances(db: SupabaseClient, farmerUserId: string): Promise<GrievanceListItem[]> {
  const rows = unwrap<GrievanceRow[]>(
    await db
      .from('grievances')
      .select(GRIEVANCE_SELECT)
      .eq('farmer_user_id', farmerUserId)
      .order('created_at', { ascending: false })
      .limit(100),
    'grievances.listOwn',
  );
  const latest = await latestResponsesFor(db, rows.map((r) => r.id));
  return rows.map((row) => toListItem(row, latest.get(row.id) ?? null));
}

export interface GovernmentGrievanceFilters {
  status?: GrievanceStatus;
  category?: GrievanceCategory;
  centreId?: string;
  search?: string;
  limit?: number;
}

/** The caller's own RLS-bound client already narrows this to their scope
 *  (centre for staff, district for district admin, state for state admin) —
 *  filters here only narrow further, they are never how scope is granted. */
export async function listGovernmentGrievances(
  db: SupabaseClient,
  filters: GovernmentGrievanceFilters,
): Promise<GrievanceListItem[]> {
  let query = db.from('grievances').select(GRIEVANCE_SELECT).order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.centreId) query = query.eq('centre_id', filters.centreId);
  const search = filters.search ? sanitizeSearchTerm(filters.search) : '';
  if (search) query = query.or(`reference.ilike.%${search}%,subject.ilike.%${search}%`);

  const rows = unwrap<GrievanceRow[]>(await query.limit(filters.limit ?? 100), 'grievances.listGovernment');
  const latest = await latestResponsesFor(db, rows.map((r) => r.id));
  return rows.map((row) => toListItem(row, latest.get(row.id) ?? null));
}

async function loadGrievanceRow(db: SupabaseClient, id: string): Promise<GrievanceRow> {
  const row = unwrapMaybe<GrievanceRow>(
    await db.from('grievances').select(GRIEVANCE_SELECT).eq('id', id).maybeSingle(),
    'grievances.findById',
  );
  if (!row) throw notFound('That complaint could not be found.');
  return row;
}

export async function getGrievanceDetail(
  auth: AuthContext,
  id: string,
): Promise<GrievanceDetail> {
  const { db, role } = auth;
  const row = await loadGrievanceRow(db, id);

  const [history, responses, attachments] = await Promise.all([
    unwrap<Array<{ from_status: GrievanceStatus | null; to_status: GrievanceStatus; changed_by_role: string | null; change_reason: string | null; created_at: string }>>(
      await db
        .from('grievance_status_history')
        .select('from_status, to_status, changed_by_role, change_reason, created_at')
        .eq('grievance_id', id)
        .order('created_at', { ascending: true }),
      'grievanceStatusHistory.forGrievance',
    ),
    unwrap<Array<{ id: string; message: string; created_at: string }>>(
      await db
        .from('grievance_responses')
        .select('id, message, created_at')
        .eq('grievance_id', id)
        .order('created_at', { ascending: true }),
      'grievanceResponses.forGrievance',
    ),
    unwrap<Array<{ id: string; file_name: string; mime_type: string; file_size: number; created_at: string }>>(
      await db
        .from('grievance_attachments')
        .select('id, file_name, mime_type, file_size, created_at')
        .eq('grievance_id', id),
      'grievanceAttachments.forGrievance',
    ),
  ]);

  const detail: GrievanceDetail = {
    ...toListItem(row, responses.length > 0 ? responses[responses.length - 1]!.message : null),
    description: row.description,
    farmerUserId: row.farmer_user_id,
    centreId: row.centre_id,
    districtId: row.district_id,
    stateId: row.state_id,
    assignedUserId: row.assigned_user_id,
    assignedRole: row.assigned_role,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    history: history.map((h) => ({
      fromStatus: h.from_status,
      toStatus: h.to_status,
      changedByRole: h.changed_by_role,
      changeReason: h.change_reason,
      createdAt: h.created_at,
    })),
    responses: responses.map((r) => ({ id: r.id, message: r.message, createdAt: r.created_at })),
    attachments: attachments.map((a) => ({
      id: a.id,
      fileName: a.file_name,
      mimeType: a.mime_type,
      fileSize: a.file_size,
      createdAt: a.created_at,
    })),
  };

  // Internal notes are additive and role-gated in Node too, on top of the
  // fact that a farmer's own RLS-bound client cannot read grievance_notes at
  // all (no policy exists for that role) — belt and suspenders (§9).
  if (role === 'CENTRE_STAFF' || role === 'DISTRICT_ADMIN' || role === 'STATE_ADMIN') {
    const notes = unwrap<Array<{ id: string; note: string; author_id: string; created_at: string }>>(
      await db
        .from('grievance_notes')
        .select('id, note, author_id, created_at')
        .eq('grievance_id', id)
        .order('created_at', { ascending: true }),
      'grievanceNotes.forGrievance',
    );
    detail.notes = notes.map((n) => ({ id: n.id, note: n.note, authorId: n.author_id, createdAt: n.created_at }));
  }

  return detail;
}

/** Every write below re-checks the caller's scope against the row's real
 *  scope in Node — the RLS SELECT policy already used to load `row` proves
 *  the caller could see it, but seeing a case and being allowed to act on it
 *  are different questions for staff (read/respond only, no status changes
 *  outside acknowledgement) and for assignment (district/state only). */
function assertCanAct(auth: AuthContext, row: GrievanceRow, action: 'respond' | 'transition' | 'assign'): void {
  const { role, scope } = auth;
  const inScope =
    (role === 'CENTRE_STAFF' && row.centre_id === scope.centreId) ||
    (role === 'DISTRICT_ADMIN' && row.district_id === scope.districtId) ||
    (role === 'STATE_ADMIN' && row.state_id === scope.stateId);

  if (!inScope) throw forbidden('You do not have access to this complaint.');

  if (action === 'assign' && role === 'CENTRE_STAFF') {
    throw forbidden('Only a district or state admin can assign a complaint.');
  }
}

export async function respondToGrievance(
  auth: AuthContext,
  grievanceId: string,
  message: string,
): Promise<void> {
  const row = await loadGrievanceRow(auth.db, grievanceId);
  assertCanAct(auth, row, 'respond');

  unwrap(
    await supabaseAdminClient
      .from('grievance_responses')
      .insert({
        grievance_id: grievanceId,
        author_id: auth.userId,
        message: message.trim(),
        language_code: auth.preferredLanguage,
      })
      .select('id'),
    'grievanceResponses.insert',
  );
}

export async function addGrievanceNote(auth: AuthContext, grievanceId: string, note: string): Promise<void> {
  const row = await loadGrievanceRow(auth.db, grievanceId);
  assertCanAct(auth, row, 'respond');

  unwrap(
    await supabaseAdminClient
      .from('grievance_notes')
      .insert({ grievance_id: grievanceId, author_id: auth.userId, note: note.trim() })
      .select('id'),
    'grievanceNotes.insert',
  );
}

export async function changeGrievanceStatus(
  auth: AuthContext,
  grievanceId: string,
  nextStatus: GrievanceStatus,
  reason: string | undefined,
): Promise<void> {
  const row = await loadGrievanceRow(auth.db, grievanceId);
  assertCanAct(auth, row, 'transition');

  if (isTerminalGrievanceStatus(row.status)) {
    throw conflict('This complaint is already closed.');
  }
  if (!canTransitionGrievance(row.status, nextStatus)) {
    throw validationError(`Cannot move a complaint from ${row.status} to ${nextStatus}.`);
  }

  const { error } = await supabaseAdminClient.rpc('change_grievance_status', {
    p_grievance_id: grievanceId,
    p_new_status: nextStatus,
    p_reason: reason ?? null,
  });
  if (error) {
    logger.error('grievance status change failed', { grievanceId, reason: error.message });
    throw internalError('Could not update this complaint.');
  }
}

export async function assignGrievance(auth: AuthContext, grievanceId: string, targetUserId: string): Promise<void> {
  const row = await loadGrievanceRow(auth.db, grievanceId);
  assertCanAct(auth, row, 'assign');

  const targetProfile = await findProfileById(supabaseAdminClient, targetUserId);
  if (!targetProfile) throw notFound('That user does not exist.');

  let targetInScope = false;
  if (targetProfile.role === 'CENTRE_STAFF') {
    const staff = await findStaffProfile(supabaseAdminClient, targetUserId);
    targetInScope = staff?.centreId === row.centre_id;
  } else if (targetProfile.role === 'DISTRICT_ADMIN') {
    const admin = await findDistrictAdminProfile(supabaseAdminClient, targetUserId);
    targetInScope = admin?.districtId === row.district_id;
  } else if (targetProfile.role === 'STATE_ADMIN') {
    const admin = await findStateAdminProfile(supabaseAdminClient, targetUserId);
    targetInScope = admin?.stateId === row.state_id;
  }
  if (!targetInScope) {
    throw validationError('That user does not have access to this complaint’s scope.');
  }

  const { error } = await supabaseAdminClient.rpc('change_grievance_status', {
    p_grievance_id: grievanceId,
    p_new_status: row.status,
    p_reason: null,
    p_assigned_user_id: targetUserId,
    p_assigned_role: targetProfile.role,
  });
  if (error) {
    logger.error('grievance assignment failed', { grievanceId, reason: error.message });
    throw internalError('Could not assign this complaint.');
  }
}

const ESCALATION_TARGET: Partial<Record<Role, Role>> = {
  CENTRE_STAFF: 'DISTRICT_ADMIN',
  DISTRICT_ADMIN: 'STATE_ADMIN',
};

export async function escalateGrievance(auth: AuthContext, grievanceId: string, reason: string): Promise<void> {
  const row = await loadGrievanceRow(auth.db, grievanceId);
  assertCanAct(auth, row, 'transition');

  const targetRole = ESCALATION_TARGET[auth.role];
  if (!targetRole) throw forbidden('A state admin case cannot be escalated further.');
  if (isTerminalGrievanceStatus(row.status)) throw conflict('This complaint is already closed.');

  const { error } = await supabaseAdminClient.rpc('change_grievance_status', {
    p_grievance_id: grievanceId,
    p_new_status: 'ESCALATED',
    p_reason: reason,
    p_assigned_user_id: null,
    p_assigned_role: targetRole,
  });
  if (error) {
    logger.error('grievance escalation failed', { grievanceId, reason: error.message });
    throw internalError('Could not escalate this complaint.');
  }
}

export const GRIEVANCE_ATTACHMENT_TTL_SECONDS = DOCUMENT_SIGNED_URL_TTL_SECONDS;
