import type { PostgrestError } from '@supabase/supabase-js';
import { AppError, conflict, forbidden, internalError, validationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** PostgREST surfaces an RLS denial on write as 42501 (insufficient_privilege). */
const RLS_DENIED = '42501';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
/** PostgREST's "no rows returned" when .single() was requested. */
export const NO_ROWS = 'PGRST116';

/**
 * Translates a database error into the API error contract.
 *
 * The database is the second authorization layer, so an RLS denial reaching
 * here is meaningful: either middleware let something through it shouldn't
 * have, or a policy is stricter than the route. Both are worth a warn line.
 */
export function translatePostgrestError(
  error: PostgrestError,
  context: { operation: string; requestId?: string },
): AppError {
  switch (error.code) {
    case RLS_DENIED:
      logger.warn('database refused operation under RLS', {
        operation: context.operation,
        requestId: context.requestId,
        pgCode: error.code,
      });
      return forbidden('You do not have access to this resource.', { operation: context.operation });

    case UNIQUE_VIOLATION:
      return conflict('That record already exists.', { operation: context.operation });

    case FOREIGN_KEY_VIOLATION:
      return validationError('A referenced record does not exist.');

    case CHECK_VIOLATION:
    case NOT_NULL_VIOLATION:
      return validationError('The submitted values were rejected by the database.');

    default:
      logger.error('unexpected database error', {
        operation: context.operation,
        requestId: context.requestId,
        pgCode: error.code,
        // `message` can include column names but never row values.
        pgMessage: error.message,
      });
      return internalError();
  }
}

/**
 * A PostgREST result with its payload left open.
 *
 * The Supabase clients here are untyped (no generated Database generic), so a
 * multi-column `select('a, b, c')` infers an opaque row type. The row shapes
 * we actually rely on are declared explicitly in `rows.ts` and asserted at the
 * unwrap boundary, which keeps the assertion in one reviewable place instead
 * of scattering `as` through every repository.
 */
interface RawResult {
  data: unknown;
  error: PostgrestError | null;
}

/** Throws on error, otherwise returns data. Use for queries that must succeed. */
export function unwrap<T>(result: RawResult, operation: string): T {
  if (result.error) throw translatePostgrestError(result.error, { operation });
  if (result.data === null || result.data === undefined) {
    throw internalError(`${operation} returned no data`);
  }
  return result.data as T;
}

/** Returns null instead of throwing when the row simply is not there. */
export function unwrapMaybe<T>(result: RawResult, operation: string): T | null {
  if (result.error) {
    if (result.error.code === NO_ROWS) return null;
    throw translatePostgrestError(result.error, { operation });
  }
  return (result.data ?? null) as T | null;
}
