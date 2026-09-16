import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env.js';

async function main(): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.log(
      'SUPABASE_ACCESS_TOKEN not set. Apply this migration yourself instead:\n' +
        '  supabase db push\n' +
        'or paste supabase/migrations/20261001000031_arrival_otp.sql into the Supabase Dashboard SQL Editor.',
    );
    return;
  }

  const sql = readFileSync(
    resolve(process.cwd(), '../../supabase/migrations/20261001000031_arrival_otp.sql'),
    'utf8',
  );
  const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];

  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });

  if (!response.ok) {
    throw new Error(`Migration failed (HTTP ${response.status}): ${await response.text()}`);
  }

  console.log('Migration applied: bookings.arrival_otp_code / arrival_otp_verified_at now exist.');
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
