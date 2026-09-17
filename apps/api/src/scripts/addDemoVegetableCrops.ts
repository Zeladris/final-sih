/**
 * Adds three demo vegetable crops (Tomato, Onion, Potato) with DEMO MSP
 * rates, using the existing crops/centre_crops/msp_rates tables — no new
 * schema. Links each to every active procurement centre so a farmer can
 * actually book one and see the demo-MSP flow end to end.
 *
 * source_type stays 'CONFIGURED' (a manually entered rate), exactly what it
 * already means for every other demo MSP rate — never claimed as a live
 * government feed. Safe to re-run: skips anything that already exists.
 *
 * Run with: npx tsx apps/api/src/scripts/addDemoVegetableCrops.ts
 */
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';

const CROPS = [
  { code: 'TOMATO', name_en: 'Tomato', name_ta: 'தக்காளி', ratePerQuintal: 2000 },
  { code: 'ONION', name_en: 'Onion', name_ta: 'வெங்காயம்', ratePerQuintal: 2500 },
  { code: 'POTATO', name_en: 'Potato', name_ta: 'உருளைக்கிழங்கு', ratePerQuintal: 1800 },
];

async function main(): Promise<void> {
  const { data: centres, error: centresError } = await supabaseAdminClient
    .from('procurement_centres')
    .select('id')
    .eq('is_active', true);
  if (centresError || !centres) throw new Error(`Could not list centres: ${centresError?.message}`);

  const today = new Date().toISOString().slice(0, 10);

  for (const crop of CROPS) {
    const { data: existing } = await supabaseAdminClient
      .from('crops')
      .select('id')
      .eq('code', crop.code)
      .maybeSingle();

    let cropId: string;
    if (existing) {
      cropId = existing.id as string;
      console.log(`  skip  ${crop.name_en} — crop already exists`);
    } else {
      const { data: inserted, error: insertError } = await supabaseAdminClient
        .from('crops')
        .insert({
          code: crop.code,
          name_en: crop.name_en,
          name_ta: crop.name_ta,
          unit: 'kg',
          is_procurable: true,
        })
        .select('id')
        .single();
      if (insertError || !inserted) throw new Error(`Could not insert ${crop.name_en}: ${insertError?.message}`);
      cropId = inserted.id as string;
      console.log(`  added crop ${crop.name_en}`);
    }

    const { error: linkError } = await supabaseAdminClient
      .from('centre_crops')
      .upsert(
        centres.map((centre) => ({ centre_id: centre.id, crop_id: cropId, is_active: true })),
        { onConflict: 'centre_id,crop_id', ignoreDuplicates: true },
      );
    if (linkError) throw new Error(`Could not link ${crop.name_en} to centres: ${linkError.message}`);

    const { data: existingRate } = await supabaseAdminClient
      .from('msp_rates')
      .select('id')
      .eq('crop_id', cropId)
      .eq('is_active', true)
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .limit(1)
      .maybeSingle();

    if (existingRate) {
      console.log(`  skip  ${crop.name_en} MSP — already has an applicable rate`);
      continue;
    }

    const { error: rateError } = await supabaseAdminClient.from('msp_rates').insert({
      crop_id: cropId,
      rate_per_quintal: crop.ratePerQuintal,
      effective_from: '2024-01-01',
      effective_to: null,
      state_id: null,
      centre_id: null,
      source_type: 'CONFIGURED',
      source_reference: 'Demo MSP rate',
      is_active: true,
    });
    if (rateError) throw new Error(`Could not insert MSP rate for ${crop.name_en}: ${rateError.message}`);

    console.log(`  added ${crop.name_en} demo MSP: ₹${crop.ratePerQuintal / 100}/kg, linked to ${centres.length} centres`);
  }
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
