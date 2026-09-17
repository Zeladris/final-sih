/**
 * Seeds the two demo cold-storage facilities. Safe to re-run: upserts on the
 * facility `code`, so it never creates duplicates and never resets a
 * facility's `available_capacity_kg` back up after real reservations have
 * eaten into it (only inserted once; an existing row is left alone).
 *
 * Run with: npx tsx apps/api/src/scripts/addDemoColdStorage.ts
 */
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';

const FACILITIES = [
  {
    code: 'CS-YEL-01',
    name: 'Yelahanka Agri Cold Storage',
    location: 'Yelahanka, Bengaluru',
    capacity_kg: 5000,
    available_capacity_kg: 1850,
  },
  {
    code: 'CS-DBP-01',
    name: 'Bengaluru Fresh Storage Hub',
    location: 'Doddaballapur',
    capacity_kg: 8000,
    available_capacity_kg: 3200,
  },
];

async function main(): Promise<void> {
  for (const facility of FACILITIES) {
    const { data: existing } = await supabaseAdminClient
      .from('cold_storage_facilities')
      .select('id')
      .eq('code', facility.code)
      .maybeSingle();

    if (existing) {
      console.log(`  skip  ${facility.name} — already exists`);
      continue;
    }

    const { error } = await supabaseAdminClient.from('cold_storage_facilities').insert(facility);
    if (error) throw new Error(`Could not insert ${facility.name}: ${error.message}`);

    console.log(`  added ${facility.name} (${facility.location})`);
  }
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
