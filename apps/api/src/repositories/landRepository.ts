import type { SupabaseClient } from '@supabase/supabase-js';
import type { LandAreaUnit, LandHolding, LandOwnershipType } from '@kisansetu/shared';
import { LAND_HOLDING_COLUMNS, toLandHolding } from './rows.js';
import type { LandHoldingRow } from './rows.js';
import { unwrap, unwrapMaybe } from './postgrestError.js';

export interface LandHoldingInput {
  ownershipType: LandOwnershipType;
  area: number;
  areaUnit: LandAreaUnit;
  surveyNumber?: string | null;
  village?: string | null;
  districtId?: string | null;
  stateId?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  primaryCrop?: string | null;
}

function toColumns(input: Partial<LandHoldingInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const assign = <K extends keyof LandHoldingInput>(key: K, column: string): void => {
    if (input[key] !== undefined) payload[column] = input[key];
  };

  assign('ownershipType', 'ownership_type');
  assign('area', 'area');
  assign('areaUnit', 'area_unit');
  assign('surveyNumber', 'survey_number');
  assign('village', 'village');
  assign('districtId', 'district_id');
  assign('stateId', 'state_id');
  assign('pincode', 'pincode');
  assign('latitude', 'latitude');
  assign('longitude', 'longitude');
  assign('primaryCrop', 'primary_crop');

  return payload;
}

export async function listLandHoldings(
  db: SupabaseClient,
  farmerUserId: string,
): Promise<LandHolding[]> {
  const rows = unwrap<LandHoldingRow[]>(
    await db
      .from('farmer_land_holdings')
      .select(LAND_HOLDING_COLUMNS)
      .eq('farmer_user_id', farmerUserId)
      .order('created_at', { ascending: true }),
    'farmer_land_holdings.list',
  );
  return rows.map(toLandHolding);
}

export async function findLandHolding(
  db: SupabaseClient,
  holdingId: string,
): Promise<LandHolding | null> {
  const row = unwrapMaybe<LandHoldingRow>(
    await db
      .from('farmer_land_holdings')
      .select(LAND_HOLDING_COLUMNS)
      .eq('id', holdingId)
      .maybeSingle(),
    'farmer_land_holdings.findById',
  );
  return row ? toLandHolding(row) : null;
}

export async function insertLandHolding(
  db: SupabaseClient,
  farmerUserId: string,
  input: LandHoldingInput,
): Promise<LandHolding> {
  const row = unwrap<LandHoldingRow>(
    await db
      .from('farmer_land_holdings')
      .insert({ farmer_user_id: farmerUserId, ...toColumns(input) })
      .select(LAND_HOLDING_COLUMNS)
      .single(),
    'farmer_land_holdings.insert',
  );
  return toLandHolding(row);
}

export async function updateLandHolding(
  db: SupabaseClient,
  holdingId: string,
  input: Partial<LandHoldingInput>,
): Promise<LandHolding | null> {
  const payload = toColumns(input);
  if (Object.keys(payload).length === 0) return findLandHolding(db, holdingId);

  // .maybeSingle() rather than .single(): RLS filtering an out-of-scope or
  // locked row out must read as "not found", not as a 500.
  const row = unwrapMaybe<LandHoldingRow>(
    await db
      .from('farmer_land_holdings')
      .update(payload)
      .eq('id', holdingId)
      .select(LAND_HOLDING_COLUMNS)
      .maybeSingle(),
    'farmer_land_holdings.update',
  );
  return row ? toLandHolding(row) : null;
}

export async function deleteLandHolding(db: SupabaseClient, holdingId: string): Promise<boolean> {
  const rows = unwrap<{ id: string }[]>(
    await db.from('farmer_land_holdings').delete().eq('id', holdingId).select('id'),
    'farmer_land_holdings.delete',
  );
  return rows.length > 0;
}
