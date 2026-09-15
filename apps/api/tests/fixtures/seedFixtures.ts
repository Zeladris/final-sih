/**
 * TEST FIXTURE SEEDER — not part of the product.
 *
 * Creates the accounts the integration and RLS suites need. Refuses to run
 * against NODE_ENV=production, and refuses any Supabase that is not local
 * unless that exact host is named in ALLOW_REMOTE_FIXTURES (fixtures/target.ts).
 * Fixture accounts must never be mixed into a real deployment.
 *
 * Run with: npm run seed:fixtures -w @kisansetu/api
 */
import { env } from '../../src/config/env.js';
import { logger } from '../../src/lib/logger.js';
import { supabaseAdminClient } from '../../src/lib/supabaseAdmin.js';
import { seedReferenceData } from '../../src/scripts/referenceData.js';
import { provisionAccount } from '../../src/services/provisioning/provisioningService.js';
import { FIXTURE_ACCOUNTS, FIXTURE_FARMER_DETAILS } from './accounts.js';
import { fixtureTarget } from './target.js';

async function seedFarmer(
  userId: string,
  phone: string,
  stateId: string,
  districtIds: Map<string, string>,
): Promise<void> {
  const details = FIXTURE_FARMER_DETAILS[phone];
  if (!details) return;

  const districtId = districtIds.get(details.districtCode);

  const { error: profileError } = await supabaseAdminClient.from('farmer_profiles').upsert(
    {
      user_id: userId,
      village: details.village,
      district_id: districtId,
      state_id: stateId,
      pincode: details.pincode,
      date_of_birth: '1980-06-15',
      gender: 'PREFER_NOT_TO_SAY',
    },
    { onConflict: 'user_id' },
  );

  if (profileError) {
    throw new Error(`Could not seed farmer profile for ${phone}: ${profileError.message}`);
  }

  // One land holding each, so the land-scoped tests have something to act on.
  const { data: existing } = await supabaseAdminClient
    .from('farmer_land_holdings')
    .select('id')
    .eq('farmer_user_id', userId)
    .limit(1);

  if ((existing ?? []).length === 0) {
    const { error: landError } = await supabaseAdminClient.from('farmer_land_holdings').insert({
      farmer_user_id: userId,
      ownership_type: 'OWNED',
      area: details.areaAcres,
      area_unit: 'ACRE',
      village: details.village,
      district_id: districtId,
      state_id: stateId,
      pincode: details.pincode,
      primary_crop: details.crop,
    });

    if (landError) {
      throw new Error(`Could not seed land holding for ${phone}: ${landError.message}`);
    }
  }
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed test fixtures into a production environment.');
  }

  const target = fixtureTarget(env.SUPABASE_URL);
  if (!target.allowed) {
    throw new Error(`Refusing to seed test fixtures: ${target.reason}`);
  }

  logger.info('seeding test fixtures', { supabaseHost: new URL(env.SUPABASE_URL).host });

  const { stateId, districtIds, centreIds } = await seedReferenceData();

  for (const account of FIXTURE_ACCOUNTS) {
    switch (account.role) {
      case 'FARMER': {
        const userId = await provisionAccount(
          {
            phone: account.phone,
            role: 'FARMER',
            fullName: account.fullName,
            preferredLanguage: account.preferredLanguage,
          },
          { kind: 'none' },
        );
        await seedFarmer(userId, account.phone, stateId, districtIds);
        break;
      }

      case 'CENTRE_STAFF': {
        const centreId = centreIds.get(account.scopeCode ?? '');
        if (!centreId) throw new Error(`Unknown centre code ${account.scopeCode}`);
        await provisionAccount(
          { phone: account.phone, role: 'CENTRE_STAFF', fullName: account.fullName },
          {
            kind: 'centre',
            centreId,
            employeeReferenceId: account.employeeReferenceId ?? '',
            designation: account.designation ?? 'Staff',
          },
        );
        break;
      }

      case 'DISTRICT_ADMIN': {
        const districtId = districtIds.get(account.scopeCode ?? '');
        if (!districtId) throw new Error(`Unknown district code ${account.scopeCode}`);
        await provisionAccount(
          { phone: account.phone, role: 'DISTRICT_ADMIN', fullName: account.fullName },
          { kind: 'district', districtId, employeeReferenceId: account.employeeReferenceId ?? '' },
        );
        break;
      }

      case 'STATE_ADMIN': {
        await provisionAccount(
          { phone: account.phone, role: 'STATE_ADMIN', fullName: account.fullName },
          { kind: 'state', stateId, employeeReferenceId: account.employeeReferenceId ?? '' },
        );
        break;
      }
    }
  }

  logger.info('fixtures seeded', { accounts: FIXTURE_ACCOUNTS.length });
}

main().catch((error: unknown) => {
  logger.error('fixture seed failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
