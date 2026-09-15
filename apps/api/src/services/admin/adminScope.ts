import { addDays, businessToday } from '@kisansetu/shared';
import type { AdminPeriod, AdminScopeKind } from '@kisansetu/shared';
import { env } from '../../config/env.js';
import { forbidden, notFound, validationError } from '../../lib/errors.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { unwrap } from '../../repositories/postgrestError.js';
import type { AuthContext } from '../../types/request.js';

/**
 * Administrative scope (§4).
 *
 * The scope is resolved from the authenticated admin's PROFILE (auth.scope,
 * derived server-side at sign-in) and nothing else. Request filters — a
 * district, a centre — can only NARROW it: a filter outside the scope is a
 * 403 (district) or a 404 (centre, so its existence is not confirmed).
 *
 * The service-role client is used for aggregation because admins have no
 * row-level read access to operational tables; every query below is pinned to
 * the centre ids resolved here.
 */

export interface ScopeCentre {
  id: string;
  code: string;
  name: string;
  village: string | null;
  districtId: string;
  districtName: string | null;
  isActive: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export interface ResolvedScope {
  kind: AdminScopeKind;
  stateId: string | null;
  districtId: string | null;
  districts: Array<{ id: string; name: string }>;
  centres: ScopeCentre[];
}

export async function resolveScope(
  auth: AuthContext,
  filters: { districtId?: string; centreId?: string } = {},
): Promise<ResolvedScope> {
  const db = supabaseAdminClient;
  let kind: AdminScopeKind;
  let districts: Array<{ id: string; name: string; state_id: string }>;

  if (auth.role === 'DISTRICT_ADMIN') {
    if (!auth.scope.districtId) throw forbidden('No district is assigned to this account.');
    kind = 'DISTRICT';
    districts = unwrap(
      await db.from('districts').select('id, name, state_id').eq('id', auth.scope.districtId),
      'admin.district',
    );
  } else if (auth.role === 'STATE_ADMIN') {
    if (!auth.scope.stateId) throw forbidden('No state is assigned to this account.');
    kind = 'STATE';
    districts = unwrap(
      await db.from('districts').select('id, name, state_id').eq('state_id', auth.scope.stateId).order('name'),
      'admin.districts',
    );
  } else {
    throw forbidden('Administrative dashboards are for district and state admins.');
  }

  if (filters.districtId) {
    // A state admin may narrow to one of their districts; nobody may widen.
    if (!districts.some((d) => d.id === filters.districtId)) {
      throw forbidden('That district is outside your administrative area.');
    }
    districts = districts.filter((d) => d.id === filters.districtId);
  }

  const districtName = new Map(districts.map((d) => [d.id, d.name]));
  const rows = districts.length
    ? unwrap<Array<{ id: string; code: string; name: string; village: string | null; district_id: string; is_active: boolean; open_time: string | null; close_time: string | null }>>(
        await db
          .from('procurement_centres')
          .select('id, code, name, village, district_id, is_active, open_time, close_time')
          .in('district_id', districts.map((d) => d.id))
          .order('name'),
        'admin.centres',
      )
    : [];

  let centres: ScopeCentre[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    village: row.village,
    districtId: row.district_id,
    districtName: districtName.get(row.district_id) ?? null,
    isActive: row.is_active,
    openTime: row.open_time ? row.open_time.slice(0, 5) : null,
    closeTime: row.close_time ? row.close_time.slice(0, 5) : null,
  }));

  if (filters.centreId) {
    centres = centres.filter((c) => c.id === filters.centreId);
    if (centres.length === 0) throw notFound('That procurement centre is not in your administrative area.');
  }

  return {
    kind,
    stateId: districts[0]?.state_id ?? auth.scope.stateId,
    districtId: kind === 'DISTRICT' ? auth.scope.districtId : (filters.districtId ?? null),
    districts: districts.map((d) => ({ id: d.id, name: d.name })),
    centres,
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * The reporting period (§9). Inclusive calendar dates in the business
 * timezone; default the last 7 days. The comparison period is the same
 * length, immediately before.
 */
export function resolvePeriod(from?: string, to?: string): AdminPeriod {
  const today = businessToday(env.APP_TIMEZONE);
  const end = to ?? today;
  const start = from ?? addDays(end, -6);

  if (!DATE.test(start) || !DATE.test(end)) throw validationError('Dates must look like 2026-09-14.');
  if (start > end) throw validationError('The start date must be on or before the end date.');
  if (end > today) throw validationError('The period cannot end in the future.');

  const days = daysBetween(start, end);
  if (days > env.ADMIN_MAX_RANGE_DAYS) {
    throw validationError(`Choose a period of at most ${env.ADMIN_MAX_RANGE_DAYS} days.`);
  }

  return {
    from: start,
    to: end,
    previousFrom: addDays(start, -days),
    previousTo: addDays(start, -1),
    days,
  };
}
