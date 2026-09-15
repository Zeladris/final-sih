import { z } from 'zod';

/** GET /api/location/search?q=... (Phase 10 §14). One explicit query — no
 *  autocomplete, so there is nothing here for partial keystrokes to hit. */
export const locationSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Enter at least 2 characters to search.').max(200),
});

/** GET /api/location/reverse?lat=...&lng=... */
export const locationReverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
