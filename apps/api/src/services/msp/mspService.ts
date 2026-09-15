import type { SupabaseClient } from '@supabase/supabase-js';
import { ratePerQuintal } from '@kisansetu/shared';
import type { ProcurementRate } from '@kisansetu/shared';
import { notFound } from '../../lib/errors.js';
import { unwrap, unwrapMaybe } from '../../repositories/postgrestError.js';

/**
 * MSP rate resolution (§8, §9).
 *
 * The SERVER picks the rate — a client never sends one. Among active rates
 * for the crop in force on the procurement date, the most specific scope
 * wins: this centre, then this state, then national. Ties go to the most
 * recent effective date.
 *
 * No rate configured means no procurement. Guessing a price would put a wrong
 * number on a real payment to a farmer, so this refuses instead.
 */

interface MspRateRow {
  id: string;
  crop_id: string;
  rate_per_quintal: string | number;
  rate_per_kg: string | number;
  effective_from: string;
  effective_to: string | null;
  state_id: string | null;
  centre_id: string | null;
  source_type: string;
  source_reference: string | null;
}

/** Numeric as returned by PostgREST, normalised to a plain decimal string. */
const decimalText = (value: string | number): string =>
  typeof value === 'string' ? value : String(value);

export async function resolveMspRate(
  db: SupabaseClient,
  input: { cropId: string; onDate: string; centreId: string },
): Promise<ProcurementRate> {
  const centre = unwrap<{ district_id: string }>(
    await db.from('procurement_centres').select('district_id').eq('id', input.centreId).single(),
    'msp.centre',
  );
  const district = unwrapMaybe<{ state_id: string }>(
    await db.from('districts').select('state_id').eq('id', centre.district_id).maybeSingle(),
    'msp.district',
  );
  const stateId = district?.state_id ?? null;

  const rows = unwrap<MspRateRow[]>(
    await db
      .from('msp_rates')
      .select('id, crop_id, rate_per_quintal, rate_per_kg, effective_from, effective_to, state_id, centre_id, source_type, source_reference')
      .eq('crop_id', input.cropId)
      .eq('is_active', true)
      .lte('effective_from', input.onDate),
    'msp.rates',
  );

  const applicable = rows
    .filter((row) => row.effective_to === null || row.effective_to >= input.onDate)
    .filter((row) => row.centre_id === null || row.centre_id === input.centreId)
    .filter((row) => row.state_id === null || row.state_id === stateId);

  const specificity = (row: MspRateRow): number => (row.centre_id ? 2 : row.state_id ? 1 : 0);

  const chosen = applicable.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      b.effective_from.localeCompare(a.effective_from) ||
      a.id.localeCompare(b.id),
  )[0];

  if (!chosen) {
    throw notFound('No MSP rate is configured for this crop on this date. Procurement cannot be priced.');
  }

  const perKg = decimalText(chosen.rate_per_kg);
  return {
    mspRateId: chosen.id,
    cropId: chosen.crop_id,
    ratePerKg: perKg,
    ratePerQuintal: ratePerQuintal(perKg),
    source: chosen.source_type,
    sourceReference: chosen.source_reference,
    effectiveFrom: chosen.effective_from,
  };
}
