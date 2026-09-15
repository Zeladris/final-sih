import type { SupabaseClient } from '@supabase/supabase-js';
import type { District, ProcurementCentre, State } from '@kisansetu/shared';
import { toDistrict, toProcurementCentre, toState } from './rows.js';
import type { DistrictRow, ProcurementCentreRow, StateRow } from './rows.js';
import { unwrap, unwrapMaybe } from './postgrestError.js';

const CENTRE_COLUMNS =
  'id, code, name, district_id, address_line1, address_line2, village, pincode, ' +
  'latitude, longitude, open_time, close_time, daily_capacity_qtl, is_active';

const DISTRICT_COLUMNS = 'id, state_id, code, name, is_active';
const STATE_COLUMNS = 'id, code, name, is_active';

/**
 * Every function here takes the caller's RLS-bound client. That is deliberate:
 * a query that returns another district's centres is impossible even if a
 * caller manages to reach this layer with the wrong filter.
 */

export async function findCentreById(
  db: SupabaseClient,
  centreId: string,
): Promise<ProcurementCentre | null> {
  const row = unwrapMaybe<ProcurementCentreRow>(
    await db.from('procurement_centres').select(CENTRE_COLUMNS).eq('id', centreId).maybeSingle(),
    'procurement_centres.findById',
  );
  return row ? toProcurementCentre(row) : null;
}

export async function listCentresByDistrict(
  db: SupabaseClient,
  districtId: string,
): Promise<ProcurementCentre[]> {
  const rows = unwrap<ProcurementCentreRow[]>(
    await db
      .from('procurement_centres')
      .select(CENTRE_COLUMNS)
      .eq('district_id', districtId)
      .order('name', { ascending: true }),
    'procurement_centres.listByDistrict',
  );
  return rows.map(toProcurementCentre);
}

export async function listCentresByDistrictIds(
  db: SupabaseClient,
  districtIds: string[],
): Promise<ProcurementCentre[]> {
  if (districtIds.length === 0) return [];
  const rows = unwrap<ProcurementCentreRow[]>(
    await db
      .from('procurement_centres')
      .select(CENTRE_COLUMNS)
      .in('district_id', districtIds)
      .order('name', { ascending: true }),
    'procurement_centres.listByDistrictIds',
  );
  return rows.map(toProcurementCentre);
}

export async function findDistrictById(
  db: SupabaseClient,
  districtId: string,
): Promise<District | null> {
  const row = unwrapMaybe<DistrictRow>(
    await db.from('districts').select(DISTRICT_COLUMNS).eq('id', districtId).maybeSingle(),
    'districts.findById',
  );
  return row ? toDistrict(row) : null;
}

export async function listDistrictsByState(
  db: SupabaseClient,
  stateId: string,
): Promise<District[]> {
  const rows = unwrap<DistrictRow[]>(
    await db
      .from('districts')
      .select(DISTRICT_COLUMNS)
      .eq('state_id', stateId)
      .order('name', { ascending: true }),
    'districts.listByState',
  );
  return rows.map(toDistrict);
}

export async function findStateById(db: SupabaseClient, stateId: string): Promise<State | null> {
  const row = unwrapMaybe<StateRow>(
    await db.from('states').select(STATE_COLUMNS).eq('id', stateId).maybeSingle(),
    'states.findById',
  );
  return row ? toState(row) : null;
}

export async function listStates(db: SupabaseClient): Promise<State[]> {
  const rows = unwrap<StateRow[]>(
    await db.from('states').select(STATE_COLUMNS).order('name', { ascending: true }),
    'states.list',
  );
  return rows.map(toState);
}
