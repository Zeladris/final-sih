/**
 * Seeds reference data (states, districts, procurement centres).
 *
 * Contains no accounts and no demo content — test accounts live in
 * `tests/fixtures/` and are seeded by `npm run seed:fixtures`.
 *
 * Run with: npm run seed -w @kisansetu/api
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { seedReferenceData } from './referenceData.js';

async function main(): Promise<void> {
  logger.info('seeding reference data', { supabaseHost: new URL(env.SUPABASE_URL).host });

  const { districtIds, centreIds } = await seedReferenceData();

  logger.info('reference data seeded', {
    states: 1,
    districts: districtIds.size,
    centres: centreIds.size,
  });
}

main().catch((error: unknown) => {
  logger.error('seed failed', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
