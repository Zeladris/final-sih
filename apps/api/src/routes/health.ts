import { Router } from 'express';
import { env } from '../config/env.js';
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';
import { asyncHandler } from '../middleware/auth.js';

export const healthRouter = Router();

/**
 * GET /api/health (§32).
 *
 * Reports liveness of the API and reachability of the database, and nothing
 * else — no versions, no connection strings, no key material.
 */
healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    let database: 'ok' | 'error' = 'ok';

    try {
      // A real GET, not a HEAD. A HEAD response has no body for supabase-js to
      // parse, so a missing table comes back with an unpopulated error and the
      // check reports a false green against an un-migrated database.
      const { error } = await supabaseAdminClient.from('states').select('id').limit(1);
      if (error) database = 'error';
    } catch {
      database = 'error';
    }

    const status = database === 'ok' ? 'ok' : 'degraded';

    res.status(database === 'ok' ? 200 : 503).json({
      status,
      api: 'ok',
      database,
      environment: env.NODE_ENV,
    });
  }),
);
