import { supabaseAdminClient } from '../lib/supabaseAdmin.js';

/**
 * Reference data — states, districts and procurement centres.
 *
 * Operational data the product genuinely needs: a farmer cannot choose a
 * district that does not exist. No accounts, no demo content.
 *
 * Idempotent, so it is safe to re-run on every deploy.
 */

interface SeedCentre {
  code: string;
  name: string;
  districtCode: string;
  village: string;
  pincode: string;
  latitude: number;
  longitude: number;
  openTime: string;
  closeTime: string;
  dailyCapacityQtl: number;
}

const STATE = { code: 'TN', name: 'Tamil Nadu' };

const DISTRICTS = [
  { code: 'TNJ', name: 'Thanjavur' },
  { code: 'TRY', name: 'Tiruchirappalli' },
];

const CENTRES: SeedCentre[] = [
  {
    code: 'TNJ-PPC-01',
    name: 'Thanjavur Central Paddy Procurement Centre',
    districtCode: 'TNJ',
    village: 'Thanjavur',
    pincode: '613001',
    latitude: 10.787,
    longitude: 79.1378,
    openTime: '08:00',
    closeTime: '17:00',
    dailyCapacityQtl: 1200,
  },
  {
    code: 'TNJ-PPC-02',
    name: 'Kumbakonam Paddy Procurement Centre',
    districtCode: 'TNJ',
    village: 'Kumbakonam',
    pincode: '612001',
    latitude: 10.9601,
    longitude: 79.3788,
    openTime: '08:00',
    closeTime: '17:00',
    dailyCapacityQtl: 900,
  },
  {
    code: 'TNJ-PPC-03',
    name: 'Pattukkottai Paddy Procurement Centre',
    districtCode: 'TNJ',
    village: 'Pattukkottai',
    pincode: '614601',
    latitude: 10.4254,
    longitude: 79.3181,
    openTime: '08:30',
    closeTime: '16:30',
    dailyCapacityQtl: 700,
  },
  {
    code: 'TRY-PPC-01',
    name: 'Trichy Main Paddy Procurement Centre',
    districtCode: 'TRY',
    village: 'Tiruchirappalli',
    pincode: '620001',
    latitude: 10.7905,
    longitude: 78.7047,
    openTime: '08:00',
    closeTime: '17:00',
    dailyCapacityQtl: 1100,
  },
  {
    code: 'TRY-PPC-02',
    name: 'Manapparai Paddy Procurement Centre',
    districtCode: 'TRY',
    village: 'Manapparai',
    pincode: '621306',
    latitude: 10.6072,
    longitude: 78.4256,
    openTime: '08:30',
    closeTime: '16:30',
    dailyCapacityQtl: 600,
  },
];

export interface ReferenceIds {
  stateId: string;
  districtIds: Map<string, string>;
  centreIds: Map<string, string>;
}

export async function seedReferenceData(): Promise<ReferenceIds> {
  const stateResult = await supabaseAdminClient
    .from('states')
    .upsert({ code: STATE.code, name: STATE.name, is_active: true }, { onConflict: 'code' })
    .select('id')
    .single();

  if (stateResult.error) throw new Error(`Could not seed state: ${stateResult.error.message}`);
  const stateId = stateResult.data.id as string;

  const districtResult = await supabaseAdminClient
    .from('districts')
    .upsert(
      DISTRICTS.map((district) => ({
        state_id: stateId,
        code: district.code,
        name: district.name,
        is_active: true,
      })),
      { onConflict: 'state_id,code' },
    )
    .select('id, code');

  if (districtResult.error) {
    throw new Error(`Could not seed districts: ${districtResult.error.message}`);
  }
  const districtIds = new Map(
    (districtResult.data as Array<{ id: string; code: string }>).map((row) => [row.code, row.id]),
  );

  const centreResult = await supabaseAdminClient
    .from('procurement_centres')
    .upsert(
      CENTRES.map((centre) => ({
        code: centre.code,
        name: centre.name,
        district_id: districtIds.get(centre.districtCode),
        village: centre.village,
        pincode: centre.pincode,
        latitude: centre.latitude,
        longitude: centre.longitude,
        open_time: centre.openTime,
        close_time: centre.closeTime,
        daily_capacity_qtl: centre.dailyCapacityQtl,
        is_active: true,
      })),
      { onConflict: 'code' },
    )
    .select('id, code');

  if (centreResult.error) {
    throw new Error(`Could not seed centres: ${centreResult.error.message}`);
  }
  const centreIds = new Map(
    (centreResult.data as Array<{ id: string; code: string }>).map((row) => [row.code, row.id]),
  );

  return { stateId, districtIds, centreIds };
}
