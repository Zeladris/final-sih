import type { RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ZodTypeAny, z } from 'zod';
import { validationError } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

function toDetails(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Validates and REPLACES the request segment with the parsed value, so
 * handlers only ever see data that matched the schema — unknown keys are
 * stripped rather than passed through to a repository (§33).
 */
export function validate<T extends ZodTypeAny>(source: Source, schema: T): RequestHandler {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse(req[source]) as z.infer<T>;

      if (source === 'query') {
        // Express 5 makes req.query a getter; assigning to the property fails
        // silently there, so define it instead.
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      } else {
        req[source] = parsed as never;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(validationError('Some of the submitted values are not valid.', toDetails(error)));
        return;
      }
      next(error);
    }
  };
}

export const validateBody = <T extends ZodTypeAny>(schema: T): RequestHandler =>
  validate('body', schema);

export const validateParams = <T extends ZodTypeAny>(schema: T): RequestHandler =>
  validate('params', schema);

export const validateQuery = <T extends ZodTypeAny>(schema: T): RequestHandler =>
  validate('query', schema);
