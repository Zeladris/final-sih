import type { AuditAction } from '@kisansetu/shared';
import { supabaseAdminClient } from '../lib/supabaseAdmin.js';
import { logger, redact } from '../lib/logger.js';

export interface AuditLogInput {
  actorUserId: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  centreId?: string | null;
  districtId?: string | null;
  stateId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * audit_logs has RLS on and no client-facing policy, so this is the one path
 * that can write it — hence the service-role client.
 *
 * Metadata goes through the same redactor as the logs, so an OTP, token or
 * identity number handed in by a careless caller never reaches the row (§31).
 */
export async function insertAuditLog(input: AuditLogInput): Promise<void> {
  const { error } = await supabaseAdminClient.from('audit_logs').insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    centre_id: input.centreId ?? null,
    district_id: input.districtId ?? null,
    state_id: input.stateId ?? null,
    metadata: input.metadata ? (redact(input.metadata) as Record<string, unknown>) : {},
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
    request_id: input.requestId ?? null,
  });

  if (error) {
    // Auditing must never take a request down with it, but a silent failure
    // would be worse — so it is loud in the logs and swallowed for the caller.
    logger.error('failed to write audit log', {
      action: input.action,
      requestId: input.requestId,
      pgCode: error.code,
      pgMessage: error.message,
    });
  }
}
