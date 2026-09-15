import { isApiError } from '@kisansetu/shared';
import type { ApiErrorCode } from '@kisansetu/shared';
import { config } from './env.js';
import { supabase } from './supabase.js';

/** An API error the UI can branch on, carrying the request id for support. */
export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: Array<{ path: string; message: string }>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    requestId: string | null,
    details: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  // getSession refreshes an expired access token when it can, so a long-idle
  // tab recovers instead of bouncing the user to the login screen.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function toError(response: Response): Promise<ApiRequestError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error body (a proxy error page, say).
  }

  if (isApiError(body)) {
    return new ApiRequestError(
      response.status,
      body.error.code,
      body.error.message,
      body.error.requestId ?? null,
      body.error.details ?? [],
    );
  }

  return new ApiRequestError(
    response.status,
    'INTERNAL_ERROR',
    response.status === 0 ? 'Could not reach the server.' : 'Something went wrong.',
    response.headers.get('x-request-id'),
  );
}

async function send<T>(
  method: string,
  path: string,
  options: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeader()), ...(options.headers ?? {}) };
  let body: BodyInit | undefined;

  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.body !== undefined) {
    // FormData: let the browser set the multipart boundary.
    body = options.body;
  }

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, { method, headers, body });
  } catch {
    throw new ApiRequestError(0, 'INTERNAL_ERROR', 'Could not reach the server.', null);
  }

  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, json?: unknown) => send<T>('POST', path, { json }),
  put: <T>(path: string, json?: unknown) => send<T>('PUT', path, { json }),
  patch: <T>(path: string, json?: unknown) => send<T>('PATCH', path, { json }),
  del: <T>(path: string) => send<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => send<T>('POST', path, { body: form }),
  /**
   * A request that must not be applied twice (payments). The caller keeps the
   * key for one intent and re-sends it on retry, so a timed-out request that
   * actually succeeded is recognised rather than repeated (Phase 8 §16).
   */
  postIdempotent: <T>(path: string, idempotencyKey: string, json?: unknown) =>
    send<T>('POST', path, { json: json ?? {}, headers: { 'Idempotency-Key': idempotencyKey } }),
};

/**
 * Maps an API failure onto an i18n key, so error copy is localised rather than
 * whatever the server happened to say (§24). Falls back to the server's
 * message only when it is a deliberate, user-facing one.
 */
export function errorMessageKey(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return 'error.generic';
  if (error.status === 0) return 'error.network';
  if (error.code === 'UNAUTHENTICATED') return 'error.session';
  if (error.code === 'INTERNAL_ERROR') return 'error.generic';
  // VALIDATION_ERROR / CONFLICT / FORBIDDEN / NOT_FOUND carry a message that
  // was written for the user; show it rather than a generic key.
  return null;
}
