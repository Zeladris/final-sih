import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth.js';
import {
  listNotificationsPage,
  markAllRead,
  markOneRead,
} from '../services/notifications/notificationService.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** GET /api/farmer/notifications?limit=&before= — the full notification
 *  centre, cursor-paginated newest-first (§19). */
export async function getMyNotifications(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { limit, before } = req.query as unknown as { limit?: string; before?: string };

  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(limit ?? '', 10) || DEFAULT_PAGE_SIZE),
  );

  res.set('Cache-Control', 'no-store');
  res.json(
    await listNotificationsPage(auth.db, auth.userId, auth.preferredLanguage, pageSize, before ?? null),
  );
}

/** POST /api/farmer/notifications/:id/read */
export async function postReadNotification(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { id } = req.params as { id: string };
  await markOneRead(auth.userId, id);
  res.json({ ok: true });
}

/** POST /api/farmer/notifications/read-all */
export async function postReadAllNotifications(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  await markAllRead(auth.userId);
  res.json({ ok: true });
}
