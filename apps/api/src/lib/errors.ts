import { API_ERROR_CODES, HTTP_STATUS_BY_ERROR_CODE } from '@kisansetu/shared';
import type { ApiErrorCode } from '@kisansetu/shared';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

/**
 * The only error type route/service code should throw. The error handler
 * turns it into the §34 response shape; anything else becomes INTERNAL_ERROR
 * with its message withheld.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: ApiErrorDetail[];
  /** Extra context for the server log only. Never serialised to the client. */
  readonly logContext?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: ApiErrorDetail[]; logContext?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = HTTP_STATUS_BY_ERROR_CODE[code];
    this.details = options.details;
    this.logContext = options.logContext;
  }
}

export const unauthenticated = (
  message = 'Sign in to continue.',
  logContext?: Record<string, unknown>,
): AppError => new AppError(API_ERROR_CODES.UNAUTHENTICATED, message, { logContext });

export const forbidden = (message: string, logContext?: Record<string, unknown>): AppError =>
  new AppError(API_ERROR_CODES.FORBIDDEN, message, { logContext });

/** A profile exists but cannot be used — see API_ERROR_CODES.ACCOUNT_NOT_CONFIGURED. */
export const accountNotConfigured = (message: string, logContext?: Record<string, unknown>): AppError =>
  new AppError(API_ERROR_CODES.ACCOUNT_NOT_CONFIGURED, message, { logContext });

export const notFound = (message = 'Not found.', logContext?: Record<string, unknown>): AppError =>
  new AppError(API_ERROR_CODES.NOT_FOUND, message, { logContext });

export const conflict = (message: string, logContext?: Record<string, unknown>): AppError =>
  new AppError(API_ERROR_CODES.CONFLICT, message, { logContext });

export const validationError = (message: string, details?: ApiErrorDetail[]): AppError =>
  new AppError(API_ERROR_CODES.VALIDATION_ERROR, message, { details });

export const internalError = (message = 'Something went wrong.', cause?: unknown): AppError =>
  new AppError(API_ERROR_CODES.INTERNAL_ERROR, message, { cause });
