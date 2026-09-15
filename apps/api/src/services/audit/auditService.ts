import type { Request } from 'express';
import type { AuditAction } from '@kisansetu/shared';
import { insertAuditLog } from '../../repositories/auditRepository.js';

/**
 * Pulls the network context off the request so call sites only describe
 * *what* happened, not *who* over *which* connection.
 */
function requestContext(req: Request): {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
} {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
    requestId: req.requestId,
  };
}

export async function recordAudit(
  req: Request,
  event: {
    action: AuditAction;
    entityType?: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    /** Overrides the actor; defaults to the authenticated user. */
    actorUserId?: string | null;
  },
): Promise<void> {
  const auth = req.auth;
  await insertAuditLog({
    actorUserId: event.actorUserId !== undefined ? event.actorUserId : (auth?.userId ?? null),
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    centreId: auth?.scope.centreId ?? null,
    districtId: auth?.scope.districtId ?? null,
    stateId: auth?.scope.stateId ?? null,
    metadata: event.metadata,
    ...requestContext(req),
  });
}

/**
 * Records a denied access attempt (§31 ACCESS_DENIED).
 *
 * Deliberately fire-and-forget from the caller's perspective: a 403 is
 * returned whether or not the log lands.
 */
export function recordAccessDenied(
  req: Request,
  reason: string,
  metadata: Record<string, unknown> = {},
): void {
  void recordAudit(req, {
    action: 'ACCESS_DENIED',
    entityType: 'endpoint',
    metadata: { reason, method: req.method, path: req.originalUrl, ...metadata },
    actorUserId: req.auth?.userId ?? req.session?.userId ?? null,
  });
}
