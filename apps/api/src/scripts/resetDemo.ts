/**
 * Resets the database to a clean demo state: wipes every account and all
 * activity (keeping reference/configuration data), empties uploaded-document
 * storage, then seeds the demo dataset fresh.
 *
 * Run with: npm run reset:demo -w @kisansetu/api
 *
 * Uses `public.dev_reset_all_data()` (supabase/migrations/
 * 20261001000019_dev_data_reset.sql), which itself refuses to run unless
 * `app.environment_flags.allow_data_reset = true` on THIS database. This
 * script arms that flag immediately before the reset and disarms it
 * immediately after, via `public.dev_set_reset_flag()` — also service-role
 * only — so the capability is not left armed between runs.
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';
import { seedDemoData } from './demoData/index.js';

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset data in a production environment.');
  }

  logger.warn('DESTRUCTIVE: resetting all accounts and activity, then reseeding the demo dataset', {
    supabaseHost: new URL(env.SUPABASE_URL).host,
  });

  const { error: armError } = await supabaseAdminClient.rpc('dev_set_reset_flag', { p_allowed: true });
  if (armError) {
    throw new Error(
      `Could not arm the reset flag — has supabase/migrations/20261001000019_dev_data_reset.sql been ` +
        `applied to this project? (${armError.message})`,
    );
  }

  const { data, error } = await supabaseAdminClient.rpc('dev_reset_all_data');

  await supabaseAdminClient.rpc('dev_set_reset_flag', { p_allowed: false }).then(
    ({ error: disarmError }) => {
      if (disarmError) {
        logger.warn('Could not disarm the reset flag; disable it manually in SQL when convenient.', {
          reason: disarmError.message,
        });
      }
    },
  );

  if (error) throw new Error(`dev_reset_all_data failed: ${error.message}`);
  logger.info('data reset complete', data as Record<string, unknown>);

  await seedDemoData();
}

main().catch((error: unknown) => {
  logger.error('demo reset failed', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
