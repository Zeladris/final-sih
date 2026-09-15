/**
 * Post-migration setup check.
 *
 * Answers "is this Supabase project actually configured the way Phase 0
 * assumes?" — schema present, RLS live, storage private, phone auth on, and
 * the privileged key really is privileged.
 *
 * Run after applying migrations, and again after seeding:
 *   npm run verify -w @kisansetu/api
 */
import { env } from '../config/env.js';
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';
import { supabaseAnonClient } from '../lib/supabase.js';

type Outcome = 'pass' | 'fail' | 'warn' | 'skip';

interface Check {
  name: string;
  outcome: Outcome;
  detail: string;
}

const results: Check[] = [];

function record(name: string, outcome: Outcome, detail: string): void {
  results.push({ name, outcome, detail });
}

const REQUIRED_TABLES = [
  'states',
  'districts',
  'procurement_centres',
  'profiles',
  'farmer_profiles',
  'staff_profiles',
  'district_admin_profiles',
  'state_admin_profiles',
  'farmer_documents',
  'audit_logs',
  // Phase 1
  'farmer_land_holdings',
  'farmer_verification_checks',
  'document_requirements',
];

async function checkTables(): Promise<boolean> {
  const missing: string[] = [];
  const errored: string[] = [];

  for (const table of REQUIRED_TABLES) {
    // A real GET, not a HEAD: a HEAD response carries no body for supabase-js
    // to parse, so `error.code` arrives undefined and a "missing table" test
    // that keys off the code silently passes for every table.
    const { error } = await supabaseAdminClient.from(table).select('*').limit(1);

    if (!error) continue;

    // PGRST205 is PostgREST's "not in schema cache"; 42P01 is undefined_table.
    if (error.code === 'PGRST205' || error.code === '42P01') {
      missing.push(table);
    } else {
      errored.push(`${table} (${error.code ?? 'unknown'}: ${error.message})`);
    }
  }

  if (missing.length > 0) {
    record(
      'schema applied',
      'fail',
      `missing ${missing.length}/${REQUIRED_TABLES.length} tables: ${missing.join(', ')}`,
    );
    return false;
  }

  if (errored.length > 0) {
    record('schema applied', 'fail', `tables present but unreadable: ${errored.join('; ')}`);
    return false;
  }

  record('schema applied', 'pass', `all ${REQUIRED_TABLES.length} tables present`);
  return true;
}

/**
 * Anonymous callers must see nothing. Every policy we wrote is scoped
 * `to authenticated`, so an anon read of a protected table should come back
 * empty (RLS filtering) rather than with rows.
 */
async function checkRlsBlocksAnon(): Promise<void> {
  const { data, error } = await supabaseAnonClient.from('profiles').select('id').limit(1);

  if (error) {
    record('RLS denies anonymous reads', 'pass', `profiles refused anon (${error.code})`);
    return;
  }

  if ((data ?? []).length === 0) {
    record('RLS denies anonymous reads', 'pass', 'profiles returned no rows to anon');
    return;
  }

  record(
    'RLS denies anonymous reads',
    'fail',
    `profiles returned ${data?.length} row(s) to an anonymous caller — RLS is not enabled`,
  );
}

async function checkStorageBucket(): Promise<void> {
  const { data, error } = await supabaseAdminClient.storage.getBucket('farmer-documents');

  if (error || !data) {
    record('private document bucket', 'fail', error?.message ?? 'bucket not found');
    return;
  }

  if (data.public) {
    record(
      'private document bucket',
      'fail',
      'farmer-documents is PUBLIC — every uploaded document is world-readable',
    );
    return;
  }

  record('private document bucket', 'pass', 'farmer-documents exists and is private');
}

async function checkPhoneAuth(): Promise<void> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: env.SUPABASE_ANON_KEY },
    });
    const settings = (await response.json()) as { external?: Record<string, boolean> };

    if (settings.external?.phone) {
      record('phone auth enabled', 'pass', 'phone provider is on');
    } else {
      record(
        'phone auth enabled',
        'fail',
        'phone provider is OFF — every login in this app is phone OTP, so nobody can sign in. ' +
          'Enable it under Authentication -> Sign In / Providers -> Phone.',
      );
    }
  } catch (error) {
    record('phone auth enabled', 'warn', `could not read auth settings: ${String(error)}`);
  }
}

/**
 * The privileged-key check that actually matters.
 *
 * Our column guards (app.protect_farmer_verification, app.protect_profile_privileges)
 * trust a writer only when `auth.role() = 'service_role'`. That was written for
 * the legacy service_role JWT; this project uses the newer `sb_secret_…` key
 * format, and whether PostgREST still resolves it to that role is a question of
 * fact, not of documentation.
 *
 * So: write a verification column with the secret key and read it back. If the
 * value sticks, the guard recognises the key as trusted. If it silently reverts,
 * it does not — which fails SAFE (more restrictive), but would leave the seed
 * and the verification flow quietly unable to record outcomes.
 */
async function checkSecretKeyIsPrivileged(): Promise<void> {
  const { data: farmer, error: findError } = await supabaseAdminClient
    .from('farmer_profiles')
    .select('user_id, review_notes')
    .limit(1)
    .maybeSingle();

  if (findError || !farmer) {
    record(
      'secret key resolves to service_role',
      'skip',
      'no farmer rows yet — re-run this check once a farmer has registered (locally: `npm run seed:fixtures`)',
    );
    return;
  }

  const original = (farmer.review_notes as string | null) ?? null;
  const probe = `setup-probe-${Date.now()}`;

  const { data: updated, error: updateError } = await supabaseAdminClient
    .from('farmer_profiles')
    .update({ review_notes: probe })
    .eq('user_id', farmer.user_id)
    .select('review_notes')
    .single();

  if (updateError) {
    record('secret key resolves to service_role', 'fail', updateError.message);
    return;
  }

  const stuck = updated?.review_notes === probe;

  // Put it back regardless of the outcome.
  await supabaseAdminClient
    .from('farmer_profiles')
    .update({ review_notes: original })
    .eq('user_id', farmer.user_id);

  if (stuck) {
    record(
      'secret key resolves to service_role',
      'pass',
      'column guards recognise the secret key as a trusted writer',
    );
  } else {
    record(
      'secret key resolves to service_role',
      'fail',
      'the write was silently discarded — app.is_service_role() does not recognise this key. ' +
        'Review outcomes and status transitions cannot be recorded. See migration 0009.',
    );
  }
}

/**
 * The registration state machine must refuse an illegal edge even for the
 * service role. Probes DRAFT -> VERIFIED, which the machine has no path for.
 */
async function checkStateMachineRefusesIllegalTransition(): Promise<void> {
  const { data: farmer } = await supabaseAdminClient
    .from('farmer_profiles')
    .select('user_id, registration_status')
    .eq('registration_status', 'DRAFT')
    .limit(1)
    .maybeSingle();

  if (!farmer) {
    record(
      'state machine refuses illegal transitions',
      'skip',
      'no DRAFT registration to probe with',
    );
    return;
  }

  const { error } = await supabaseAdminClient
    .from('farmer_profiles')
    .update({ registration_status: 'VERIFIED' })
    .eq('user_id', farmer.user_id);

  if (error) {
    record(
      'state machine refuses illegal transitions',
      'pass',
      'DRAFT -> VERIFIED was rejected by the database',
    );
    return;
  }

  // It went through. Put it back and fail loudly.
  await supabaseAdminClient
    .from('farmer_profiles')
    .update({ registration_status: 'DRAFT' })
    .eq('user_id', farmer.user_id);

  record(
    'state machine refuses illegal transitions',
    'fail',
    'DRAFT -> VERIFIED was ACCEPTED — app.assert_registration_transition() is not installed',
  );
}

const ICON: Record<Outcome, string> = { pass: '  ok  ', fail: ' FAIL ', warn: ' warn ', skip: ' skip ' };

async function main(): Promise<void> {
  process.stdout.write(`\nChecking ${new URL(env.SUPABASE_URL).host}\n\n`);

  const hasSchema = await checkTables();

  if (hasSchema) {
    await checkRlsBlocksAnon();
    await checkStorageBucket();
    await checkSecretKeyIsPrivileged();
    await checkStateMachineRefusesIllegalTransition();
  } else {
    record('RLS denies anonymous reads', 'skip', 'no schema');
    record('private document bucket', 'skip', 'no schema');
    record('secret key resolves to service_role', 'skip', 'no schema');
    record('state machine refuses illegal transitions', 'skip', 'no schema');
  }

  await checkPhoneAuth();

  for (const check of results) {
    process.stdout.write(`[${ICON[check.outcome]}] ${check.name}\n           ${check.detail}\n`);
  }

  const failures = results.filter((check) => check.outcome === 'fail');
  process.stdout.write(
    failures.length === 0
      ? '\nSetup looks correct.\n\n'
      : `\n${failures.length} check(s) failed. Phase 0 will not work until these are fixed.\n\n`,
  );

  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`\nverify-setup crashed: ${error instanceof Error ? error.message : String(error)}\n\n`);
  process.exitCode = 1;
});
