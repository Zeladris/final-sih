import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth.js';
import { recordAudit } from '../services/audit/auditService.js';
import { listSentMessages, publishFarmerMessage } from '../services/notifications/farmerMessageService.js';
import type { CreateFarmerMessageBody } from '../schemas/farmerMessage.js';

/** POST /api/farmer-messages — District/State Admin compose+publish (§21). */
export async function postFarmerMessage(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const body = req.body as CreateFarmerMessageBody;

  const message = await publishFarmerMessage(auth, body);

  await recordAudit(req, {
    action: 'FARMER_MESSAGE_PUBLISHED',
    entityType: 'farmer_messages',
    entityId: message.id,
    metadata: {
      audienceType: message.audienceType,
      recipientCount: message.recipientCount,
      priority: message.priority,
    },
  });

  res.status(201).json({ message });
}

/** GET /api/farmer-messages — the sender's own history, with real stats (§43). */
export async function getSentMessages(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { limit } = req.query as unknown as { limit?: number };
  const messages = await listSentMessages(auth.db, auth.userId, limit ?? 50);
  res.json({ messages });
}
