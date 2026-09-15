import type { AuthError } from '@supabase/supabase-js';

/**
 * Authentication failure categories (§9).
 *
 * The farmer needs a different action for each of these — check the digits,
 * request a new code, wait, or fix their connection — so collapsing them into
 * one "login failed" message would be actively unhelpful.
 *
 * Raw Supabase messages are never shown; each category maps to an i18n key.
 */
export const AUTH_ERROR_KINDS = {
  INVALID_CODE: 'INVALID_CODE',
  EXPIRED_CODE: 'EXPIRED_CODE',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  NETWORK: 'NETWORK',
  /** Reached the server, but it could not send — e.g. no SMS provider. */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  SEND_FAILED: 'SEND_FAILED',
  UNKNOWN: 'UNKNOWN',
} as const;

export type AuthErrorKind = (typeof AUTH_ERROR_KINDS)[keyof typeof AUTH_ERROR_KINDS];

export const AUTH_ERROR_MESSAGE_KEY: Record<AuthErrorKind, string> = {
  INVALID_CODE: 'login.error.invalidCode',
  EXPIRED_CODE: 'login.error.expiredCode',
  TOO_MANY_ATTEMPTS: 'login.error.tooManyRequests',
  NETWORK: 'login.error.network',
  SERVICE_UNAVAILABLE: 'login.error.serviceUnavailable',
  SEND_FAILED: 'login.error.sendFailed',
  UNKNOWN: 'login.error.unknown',
};

/** Carries the category so the UI can both message and react correctly. */
export class AuthFailure extends Error {
  readonly kind: AuthErrorKind;
  /** Seconds the caller should wait, when the provider told us. */
  readonly retryAfterSeconds: number | null;

  constructor(kind: AuthErrorKind, retryAfterSeconds: number | null = null) {
    super(kind);
    this.name = 'AuthFailure';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  get messageKey(): string {
    return AUTH_ERROR_MESSAGE_KEY[this.kind];
  }
}

/** Supabase puts the wait in the message rather than a field. */
function parseRetryAfter(message: string): number | null {
  const match = /after (\d+) seconds?/i.exec(message);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

/**
 * True only for an actual connectivity failure.
 *
 * `AuthRetryableFetchError` is NOT sufficient on its own: supabase-js wraps
 * any 5xx in it as well, so a server-side problem (a missing SMS provider,
 * say) would otherwise be reported as "check your internet connection" to
 * somebody whose internet is fine. The status is what separates them — 0 when
 * the request never landed, 5xx when it landed and the server failed.
 */
function isNetworkFailure(error: AuthError | Error): boolean {
  if (error.name === 'TypeError' && /fetch|network/i.test(error.message)) return true;

  const status = 'status' in error ? (error as AuthError).status : undefined;
  if (status === undefined) return error.name === 'AuthRetryableFetchError';
  return status === 0;
}

/** Reached the server, but it could not complete the request. */
function isServiceFailure(error: AuthError | Error): boolean {
  const status = 'status' in error ? (error as AuthError).status : undefined;
  return typeof status === 'number' && status >= 500;
}

/**
 * Classifies a verify-OTP failure.
 *
 * Supabase reports a wrong code and an expired code with the same generic
 * "Token has expired or is invalid" on some versions, so the explicit
 * `otp_expired` code is checked first and the generic message falls back to
 * INVALID_CODE — the more common case, and the one whose advice ("check the
 * code") is harmless if we guessed wrong.
 */
export function classifyVerifyError(error: unknown): AuthFailure {
  if (!(error instanceof Error)) return new AuthFailure(AUTH_ERROR_KINDS.UNKNOWN);

  if (isNetworkFailure(error)) return new AuthFailure(AUTH_ERROR_KINDS.NETWORK);
  if (isServiceFailure(error)) return new AuthFailure(AUTH_ERROR_KINDS.SERVICE_UNAVAILABLE);

  const authError = error as AuthError;
  const code = (authError.code ?? '').toLowerCase();
  const message = error.message ?? '';

  if (authError.status === 429 || /rate limit|too many/i.test(message)) {
    return new AuthFailure(AUTH_ERROR_KINDS.TOO_MANY_ATTEMPTS, parseRetryAfter(message));
  }

  if (code === 'otp_expired' || /expired/i.test(code)) {
    return new AuthFailure(AUTH_ERROR_KINDS.EXPIRED_CODE);
  }

  if (/invalid|incorrect|token has expired or is invalid/i.test(message)) {
    return new AuthFailure(AUTH_ERROR_KINDS.INVALID_CODE);
  }

  return new AuthFailure(AUTH_ERROR_KINDS.UNKNOWN);
}

/** Classifies a send-OTP failure. */
export function classifySendError(error: unknown): AuthFailure {
  if (!(error instanceof Error)) return new AuthFailure(AUTH_ERROR_KINDS.SEND_FAILED);

  if (isNetworkFailure(error)) return new AuthFailure(AUTH_ERROR_KINDS.NETWORK);
  if (isServiceFailure(error)) return new AuthFailure(AUTH_ERROR_KINDS.SERVICE_UNAVAILABLE);

  const authError = error as AuthError;
  const message = error.message ?? '';

  if (authError.status === 429 || /rate limit|too many|only request this after/i.test(message)) {
    return new AuthFailure(AUTH_ERROR_KINDS.TOO_MANY_ATTEMPTS, parseRetryAfter(message));
  }

  return new AuthFailure(AUTH_ERROR_KINDS.SEND_FAILED);
}
