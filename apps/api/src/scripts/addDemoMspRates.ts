/**
 * Adds a demo MSP rate for every procurable crop — national scope (no
 * state/centre restriction), open-ended from a safely-past date, so nothing
 * ever blocks "Confirm procurement" with "No MSP rate is configured" during
 * a demo. Safe to re-run: skips any crop that already has an active,
 * currently-applicable rate rather than inserting a duplicate.
 *
 * Run with: npx tsx apps/api/src/scripts/addDemoMspRates.ts
 */
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';

// Approximate real MSP figures (₹/quintal) — close enough for a demo; never
// claimed as a live government feed (source_type stays 'CONFIGURED', exactly
// what that column already means for a manually entered rate).
const RATE_PER_QUINTAL_BY_CODE: Record<string, number> = {
  PADDY_SAMBA: 2300,
  PADDY_KURUVAI: 2300,
  PADDY_THALADI: 2300,
  PADDY: 2300,
  WHEAT: 2425,
  MAIZE: 2225,
  GROUNDNUT: 6783,
  BLACK_GRAM: 7400,
  GREEN_GRAM: 8682,
};
const FALLBACK_RATE_PER_QUINTAL = 2500;

async function main(): Promise<void> {
  const { data: crops, error: cropsError } = await supabaseAdminClient
    .from('crops')
    .select('id, code, name_en')
    .eq('is_procurable', true);
  if (cropsError || !crops) throw new Error(`Could not list crops: ${cropsError?.message}`);

  const today = new Date().toISOString().slice(0, 10);

  for (const crop of crops) {
    const { data: existing } = await supabaseAdminClient
      .from('msp_rates')
      .select('id')
      .eq('crop_id', crop.id)
      .eq('is_active', true)
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .limit(1)
      .maybeSingle();

    if (existing) {
      console.log(`  skip  ${crop.name_en} — already has an applicable rate`);
      continue;
    }

    const ratePerQuintal = RATE_PER_QUINTAL_BY_CODE[crop.code] ?? FALLBACK_RATE_PER_QUINTAL;
    const { error: insertError } = await supabaseAdminClient.from('msp_rates').insert({
      crop_id: crop.id,
      rate_per_quintal: ratePerQuintal,
      effective_from: '2024-01-01',
      effective_to: null,
      state_id: null,
      centre_id: null,
      source_type: 'CONFIGURED',
      source_reference: 'Demo MSP rate',
      is_active: true,
    });
    if (insertError) throw new Error(`Could not insert rate for ${crop.name_en}: ${insertError.message}`);

    console.log(`  added ${crop.name_en}: ₹${ratePerQuintal}/quintal`);
  }
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
