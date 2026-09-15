/**
 * Empties the application's storage buckets — the file half of a development
 * reset (the row half is supabase/maintenance/reset_development_data.sql).
 *
 * DESTRUCTIVE, development/staging only. Removes every uploaded farmer
 * document and produce photo; the buckets themselves and their policies stay.
 *
 * Usage:
 *   npm run reset:storage -w @kisansetu/api -- --confirm <project-host>
 *
 * `<project-host>` must equal the host in SUPABASE_URL (e.g.
 * abcd1234.supabase.co, or 127.0.0.1 locally), so the command cannot be
 * pointed at the wrong project by a stray .env. Refuses NODE_ENV=production.
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';

const BUCKETS = ['farmer-documents', 'produce-photos'] as const;
const PAGE = 100;

function confirmArg(argv: string[]): string | null {
  const index = argv.indexOf('--confirm');
  return index >= 0 ? (argv[index + 1] ?? null) : null;
}

/** Every object path under `prefix`, walking folders (entries without an id). */
async function listAll(bucket: string, prefix = ''): Promise<string[]> {
  const paths: string[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdminClient.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Could not list ${bucket}/${prefix}: ${error.message}`);

    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) paths.push(...(await listAll(bucket, path)));
      else paths.push(path);
    }

    if ((data ?? []).length < PAGE) return paths;
  }
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to empty storage in a production environment.');
  }

  const host = new URL(env.SUPABASE_URL).hostname;
  const confirm = confirmArg(process.argv.slice(2));
  if (confirm !== host) {
    throw new Error(`Refusing to run: pass --confirm ${host} to empty storage on that project.`);
  }

  for (const bucket of BUCKETS) {
    const paths = await listAll(bucket);
    for (let i = 0; i < paths.length; i += PAGE) {
      const { error } = await supabaseAdminClient.storage.from(bucket).remove(paths.slice(i, i + PAGE));
      if (error) throw new Error(`Could not remove objects from ${bucket}: ${error.message}`);
    }
    logger.info('bucket emptied', { bucket, removed: paths.length });
  }
}

main().catch((error: unknown) => {
  logger.error('storage reset failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
