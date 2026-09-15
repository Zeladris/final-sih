import { NEVER_LOG_KEYS } from '@kisansetu/shared';
import { env, isProduction } from '../config/env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level = env.NODE_ENV === 'test' ? 'error' : isProduction ? 'info' : 'debug';

const REDACTED = '[redacted]';
const DENYLIST = new Set(NEVER_LOG_KEYS.map((key) => key.toLowerCase()));

/**
 * Recursively strips values whose key is on the denylist (§31, §47).
 * Applied to everything that reaches a log line or an audit row, so a
 * careless `logger.info('x', req.body)` cannot leak an OTP or a token.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value.toISOString();

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = DENYLIST.has(key.toLowerCase()) ? REDACTED : redact(nested, depth + 1);
  }
  return output;
}

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const line = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const serialised = JSON.stringify(line);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${serialised}\n`);
  } else {
    process.stdout.write(`${serialised}\n`);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};

/** Phone numbers appear in logs for support purposes; keep only the last 4 digits. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
