import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { REQUEST_ID_HEADER } from '../config/constants.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Creates or propagates X-Request-ID (§35).
 *
 * An inbound id is echoed so a trace spans client and server, but only if it
 * looks sane — an arbitrary client string would otherwise end up in response
 * headers and log lines.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.header(REQUEST_ID_HEADER);
  req.requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.requestId);
  next();
};
