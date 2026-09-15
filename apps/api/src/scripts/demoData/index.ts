import { logger } from '../../lib/logger.js';
import { seedAccountsAndReferenceData } from './seedAccounts.js';
import { seedOperationalData } from './seedOperations.js';
import { DEMO_TOTALS } from './config.js';

export { DEMO_TOTALS };

/**
 * Seeds the complete KisanSetu demo dataset (§ user request "DEMO
 * HIERARCHY"): 2 states, 4 districts, 12 procurement centres, 24 staff
 * accounts, 4 district admins, 2 state admins, 20 farmers across the six
 * registration states, sample slots at every centre, and a real operational
 * history (bookings, quality, weighing, procurement, payment, queue) for two
 * farmers per district.
 *
 * Idempotent: every account and reference row is upserted or existence-
 * checked, so running this again updates the same rows rather than creating
 * duplicates. It does not remove anything — pair it with `npm run reset:demo`
 * for a clean slate first.
 */
export async function seedDemoData(): Promise<void> {
  // Deliberately does NOT also run the original single-state `seed.ts`
  // reference data: that would create a second, differently-coded
  // Thanjavur/Tiruchirappalli alongside this dataset's own — confusing
  // duplicates, not a clean demo. This dataset is self-contained.
  const seeded = await seedAccountsAndReferenceData();
  await seedOperationalData(seeded);

  logger.info('demo dataset ready', DEMO_TOTALS);
}
