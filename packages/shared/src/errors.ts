/** The API error contract (§34). Every non-2xx response has this shape. */
export const API_ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /**
   * Authenticated, and a profile exists, but it cannot be used: inactive, an
   * unknown role, or a government role with no active centre/district/state
   * assignment. Distinct from FORBIDDEN so the client can show "Account not
   * configured" instead of guessing where to send the user.
   */
  ACCOUNT_NOT_CONFIGURED: 'ACCOUNT_NOT_CONFIGURED',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    /** Field-level detail, only ever set for VALIDATION_ERROR. */
    details?: Array<{ path: string; message: string }>;
  };
}

export const HTTP_STATUS_BY_ERROR_CODE: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  ACCOUNT_NOT_CONFIGURED: 403,
};

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { error?: unknown }).error;
  if (typeof candidate !== 'object' || candidate === null) return false;
  return typeof (candidate as { code?: unknown }).code === 'string';
}
