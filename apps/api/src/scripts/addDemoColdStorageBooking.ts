/**
 * Creates one demo farmer account with a COMPLETED, PAID booking that has a
 * real cold-storage shortfall — i.e. the centre accepted less than the
 * farmer booked (some produce was rejected at weighing), so the farmer's
 * booking-status page offers to reserve the remaining quantity at a cold
 * storage facility. This is the fastest way to demo the cold storage feature
 * live: log in as the printed phone number and open that booking's status
 * page.
 *
 * Reuses the same centre/staff/crop demo data `npm run seed:demo` creates
 * (Thanjavur Central Paddy Procurement Centre) and the same cold storage
 * facilities `addDemoColdStorage.ts` creates — run those first if this
 * script reports it can't find them.
 *
 * Safe to re-run: upserts the farmer account; skips booking creation if this
 * phone number already has one.
 *
 * Run with: npx tsx apps/api/src/scripts/addDemoColdStorageBooking.ts [phone] ["Full Name"]
 */
import { businessToday } from '@kisansetu/shared';
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';
import { ensureAuthUser } from '../services/provisioning/provisioningService.js';
import { createBooking, newIdempotencyKey } from '../services/booking/bookingService.js';
import * as ops from '../services/procurement/operationsService.js';
import * as queueService from '../services/queue/queueService.js';
import * as paymentService from '../services/payments/paymentService.js';
import { env } from '../config/env.js';
import type { AuthContext } from '../types/request.js';

const FIXED_OTP = '123456';
const DEFAULT_PHONE = '9000090001';
const CENTRE_CODE = 'DTNJ-PPC-01';
const EXPECTED_QUANTITY_KG = 1200;
const REJECTED_QUANTITY_KG = 300; // leaves a 300 kg shortfall for cold storage to offer

/** Same rule addMyPhoneAsFarmer.ts uses for every phone this app accepts. */
function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let national: string | null = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2);
  if (!national || !/^[6-9]\d{9}$/.test(national)) return null;
  return `91${national}`;
}

async function addTestOtp(phone: string): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.log(
      '\nSUPABASE_ACCESS_TOKEN not set — skipping the automatic Test OTP update.\n' +
        'Add this pair by hand in Authentication -> Providers -> Phone -> Test Phone Numbers and OTPs:\n' +
        `  ${phone}=${FIXED_OTP}\n`,
    );
    return;
  }

  const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];
  const base = `https://api.supabase.com/v1/projects/${ref}/config/auth`;

  const current = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
  if (!current.ok) {
    throw new Error(`Could not read auth config (HTTP ${current.status}). Check SUPABASE_ACCESS_TOKEN.`);
  }
  const config = (await current.json()) as {
    sms_test_otp?: string | null;
    sms_test_otp_valid_until?: string | null;
  };

  const pairs = (config.sms_test_otp ?? '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean);

  if (pairs.some((pair) => pair.startsWith(`${phone}=`))) {
    console.log(`\n${phone} is already registered as a test OTP number.`);
    return;
  }

  pairs.push(`${phone}=${FIXED_OTP}`);

  const update = await fetch(base, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sms_test_otp: pairs.join(','),
      sms_test_otp_valid_until: config.sms_test_otp_valid_until ?? '2030-01-01T00:00:00Z',
    }),
  });
  if (!update.ok) {
    console.warn(
      `\nCould not update auth config automatically (HTTP ${update.status}): ${await update.text()}\n` +
        `Add this pair by hand in Authentication -> Providers -> Phone -> Test Phone Numbers and OTPs:\n` +
        `  ${phone}=${FIXED_OTP}\n`,
    );
    return;
  }

  console.log(`\nAdded ${phone}=${FIXED_OTP} to Supabase's Test Phone Numbers and OTPs.`);
}

function staffAuthContext(userId: string, centreId: string): AuthContext {
  return {
    userId,
    phone: null,
    role: 'CENTRE_STAFF',
    status: 'ACTIVE',
    fullName: null,
    preferredLanguage: 'en',
    scope: { centreId, districtId: null, stateId: null },
    db: supabaseAdminClient,
  };
}

async function main(): Promise<void> {
  const phone = normalisePhone(process.argv[2] ?? DEFAULT_PHONE);
  const fullName = process.argv[3] ?? 'Demo Cold Storage Farmer';
  if (!phone) {
    console.error('That is not a valid Indian mobile number (must start with 6-9, 10 digits).');
    process.exitCode = 1;
    return;
  }

  await addTestOtp(phone);

  const { userId: farmerUserId } = await ensureAuthUser(phone);

  const { error: profileError } = await supabaseAdminClient.from('profiles').upsert(
    { id: farmerUserId, role: 'FARMER', full_name: fullName, preferred_language: 'en', status: 'ACTIVE' },
    { onConflict: 'id' },
  );
  if (profileError) throw new Error(`profiles upsert failed: ${profileError.message}`);

  const { data: district, error: districtError } = await supabaseAdminClient
    .from('districts')
    .select('id, state_id')
    .limit(1)
    .single();
  if (districtError || !district) throw new Error(`No district found: ${districtError?.message}`);

  const now = new Date().toISOString();
  const { data: existingFarmer } = await supabaseAdminClient
    .from('farmer_profiles')
    .select('user_id')
    .eq('user_id', farmerUserId)
    .maybeSingle();

  const farmerRow = {
    user_id: farmerUserId,
    date_of_birth: '1990-01-01',
    gender: 'OTHER',
    village: 'Demo Village',
    pincode: '600001',
    state_id: (district as { state_id: string }).state_id,
    district_id: (district as { id: string }).id,
    registration_status: 'VERIFIED',
    current_step: 'REVIEW',
    submitted_at: now,
    reviewed_at: now,
    verified_at: now,
  };

  const { error: farmerError } = existingFarmer
    ? await supabaseAdminClient.from('farmer_profiles').update(farmerRow).eq('user_id', farmerUserId)
    : await supabaseAdminClient.from('farmer_profiles').insert(farmerRow);
  if (farmerError) throw new Error(`farmer_profiles upsert failed: ${farmerError.message}`);

  const { data: centre, error: centreError } = await supabaseAdminClient
    .from('procurement_centres')
    .select('id')
    .eq('code', CENTRE_CODE)
    .maybeSingle();
  if (centreError || !centre) {
    throw new Error(
      `Demo centre ${CENTRE_CODE} not found (${centreError?.message ?? 'no row'}). Run "npm run seed:demo -w @kisansetu/api" first.`,
    );
  }
  const centreId = (centre as { id: string }).id;

  const { data: staffProfile, error: staffError } = await supabaseAdminClient
    .from('staff_profiles')
    .select('user_id')
    .eq('centre_id', centreId)
    .limit(1)
    .maybeSingle();
  if (staffError || !staffProfile) {
    throw new Error(
      `No staff found at ${CENTRE_CODE} (${staffError?.message ?? 'no row'}). Run "npm run seed:demo -w @kisansetu/api" first.`,
    );
  }
  const staffAuth = staffAuthContext((staffProfile as { user_id: string }).user_id, centreId);

  const { data: paddyCrop, error: cropError } = await supabaseAdminClient
    .from('crops')
    .select('id')
    .eq('code', 'PADDY')
    .maybeSingle();
  if (cropError || !paddyCrop) throw new Error(`PADDY crop not found: ${cropError?.message}`);
  const cropId = (paddyCrop as { id: string }).id;

  const { data: cold } = await supabaseAdminClient.from('cold_storage_facilities').select('id').limit(1);
  if (!cold || cold.length === 0) {
    console.warn(
      '\nWarning: no cold storage facilities found. Run "npx tsx apps/api/src/scripts/addDemoColdStorage.ts" ' +
        'as well, or the farmer will see a shortfall offer with nothing to reserve it against.\n',
    );
  }

  // Reuse an open slot at the demo centre — seed:demo creates 5 days of
  // slots for every demo centre. Prefer today, but a same-day slot may have
  // already started by the time this script runs, so fall through to
  // whichever open slot is soonest.
  const todayDate = businessToday(env.APP_TIMEZONE);
  const { data: candidateSlots, error: slotError } = await supabaseAdminClient
    .from('procurement_slots')
    .select('id')
    .eq('centre_id', centreId)
    .eq('status', 'OPEN')
    .gte('slot_date', todayDate)
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(10);
  if (slotError || !candidateSlots || candidateSlots.length === 0) {
    throw new Error(
      `No open slots at ${CENTRE_CODE} (${slotError?.message ?? 'none'}). Run "npm run seed:demo -w @kisansetu/api" first.`,
    );
  }

  let bookingId: string | null = null;
  for (const { id: slotId } of candidateSlots as Array<{ id: string }>) {
    const { data: existingBooking } = await supabaseAdminClient
      .from('bookings')
      .select('id')
      .eq('farmer_user_id', farmerUserId)
      .eq('slot_id', slotId)
      .neq('status', 'CANCELLED')
      .maybeSingle();

    if (existingBooking) {
      bookingId = (existingBooking as { id: string }).id;
      break;
    }

    try {
      const booking = await createBooking(supabaseAdminClient, farmerUserId, {
        cropId,
        slotId,
        expectedQuantityKg: EXPECTED_QUANTITY_KG,
        storageLocationText: 'On-farm storage shed',
        idempotencyKey: newIdempotencyKey(),
      });
      bookingId = booking.id;
      break;
    } catch (cause) {
      const message = (cause as Error).message ?? '';
      if (/already started|full/i.test(message)) continue; // try the next candidate slot
      throw cause;
    }
  }
  if (!bookingId) throw new Error('Could not book any of the available slots — try again.');

  const state = (await ops.single(staffAuth, bookingId)).state;

  if (state === 'BOOKED') {
    await ops.getOrCreateTodaySession(staffAuth);
    await ops.transitionTodaySession(staffAuth, 'OPEN').catch(() => undefined);

    const { data: bookingRow } = await supabaseAdminClient
      .from('bookings')
      .select('arrival_otp_code')
      .eq('id', bookingId)
      .single();
    const arrivalOtp = (bookingRow as { arrival_otp_code: string }).arrival_otp_code;

    await ops.markArrived(staffAuth, bookingId, arrivalOtp);
    await ops.checkIn(staffAuth, bookingId);
    await ops.verifyCrop(staffAuth, bookingId, { matches: true });
    await ops.recordQuality(staffAuth, bookingId, { result: 'PASSED' });

    const stations = await queueService.listWorkstationViews(staffAuth);
    const available = stations.find((s) => s.status === 'AVAILABLE');
    if (!available) throw new Error('No available workstation at the demo centre right now — try again shortly.');
    await queueService.selectCandidate(staffAuth, bookingId, { workstationId: available.id });

    await ops.recordWeight(staffAuth, bookingId, {
      receivedQuantityKg: EXPECTED_QUANTITY_KG,
      rejectedQuantityKg: REJECTED_QUANTITY_KG,
      rejectionReason: 'Partial moisture damage found in one sack during weighing',
    });
    await ops.confirmProcurement(staffAuth, bookingId);

    const single = await ops.single(staffAuth, bookingId);
    if (single.procurementId) {
      const { outcome } = await paymentService.initiatePayment(
        staffAuth,
        single.procurementId,
        newIdempotencyKey(),
        'SUCCESS',
      );
      if (outcome !== 'ALREADY_PAID') {
        await new Promise((resolve) => setTimeout(resolve, (env.PAYMENT_DEMO_SETTLE_SECONDS + 1) * 1000));
        const paymentId = (await ops.single(staffAuth, bookingId)).paymentId;
        if (paymentId) await paymentService.refreshPayment(paymentId, staffAuth.userId);
      }
    }
  } else {
    console.log(`Booking already at state ${state} — leaving it as-is.`);
  }

  console.log('\n--- Demo cold storage booking ready ---');
  console.log(`Farmer: ${fullName}`);
  console.log(`Log in with ${phone.slice(2)} and OTP ${FIXED_OTP} (if the Test OTP step above ran).`);
  console.log(`Booking: ${bookingId}`);
  console.log(
    `Expected ${EXPECTED_QUANTITY_KG} kg, accepted ${EXPECTED_QUANTITY_KG - REJECTED_QUANTITY_KG} kg — ` +
      `open that booking's status page to see the ${REJECTED_QUANTITY_KG} kg cold storage offer.`,
  );
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
