/**
 * Seeds the KisanSetu demo dataset — see apps/api/src/scripts/demoData/.
 *
 * Run with: npm run seed:demo -w @kisansetu/api
 *
 * Safe to re-run: every row is upserted or existence-checked, so this never
 * creates duplicate accounts or duplicate demo data.
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { seedDemoData } from './demoData/index.js';

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data into a production environment.');
  }

  logger.info('seeding demo dataset', { supabaseHost: new URL(env.SUPABASE_URL).host });
  await seedDemoData();
}

main().catch((error: unknown) => {
  logger.error('demo seed failed', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
