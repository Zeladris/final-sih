import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { API_ERROR_CODES } from '@kisansetu/shared';
import type { ApiError } from '@kisansetu/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env, isProduction } from '../config/env.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiError = {
    error: {
      code: API_ERROR_CODES.NOT_FOUND,
      message: `No route matches ${req.method} ${req.path}.`,
      requestId: req.requestId,
    },
  };
  res.status(404).json(body);
};

function fromMulterError(error: MulterError): AppError {
  if (error.code === 'LIMIT_FILE_SIZE') {
    const limitMb = Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024));
    return new AppError(API_ERROR_CODES.VALIDATION_ERROR, `Files must be ${limitMb} MB or smaller.`);
  }
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new AppError(API_ERROR_CODES.VALIDATION_ERROR, 'Send exactly one file in the "file" field.');
  }
  return new AppError(API_ERROR_CODES.VALIDATION_ERROR, 'The upload could not be read.');
}

/**
 * The single place an error becomes a response (§34).
 *
 * Two rules it exists to enforce:
 *   1. Every error body has the same shape and carries the request id.
 *   2. Only AppError messages reach the client. Anything else becomes a
 *      generic INTERNAL_ERROR, so a database message or a stack trace can
 *      never be served to a caller — in any environment, not just production.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const normalised =
    error instanceof AppError
      ? error
      : error instanceof MulterError
        ? fromMulterError(error)
        : null;

  if (normalised) {
    const level = normalised.status >= 500 ? 'error' : 'warn';
    logger[level]('request failed', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: normalised.status,
      code: normalised.code,
      userId: req.auth?.userId ?? req.session?.userId,
      ...normalised.logContext,
    });

    const body: ApiError = {
      error: {
        code: normalised.code,
        message: normalised.message,
        requestId: req.requestId,
        ...(normalised.details ? { details: normalised.details } : {}),
      },
    };
    res.status(normalised.status).json(body);
    return;
  }

  // Unexpected. Log everything we have; tell the client nothing.
  logger.error('unhandled error', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    userId: req.auth?.userId ?? req.session?.userId,
    error: error instanceof Error ? error.message : String(error),
    stack: isProduction ? undefined : error instanceof Error ? error.stack : undefined,
  });

  const body: ApiError = {
    error: {
      code: API_ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong. Quote the request id if you contact support.',
      requestId: req.requestId,
    },
  };
  res.status(500).json(body);
};
