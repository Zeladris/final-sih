import type { Request, Response } from 'express';
import { searchLocation, reverseGeocode } from '../services/location/locationService.js';

/** GET /api/location/search?q=... (Phase 10 §14). Always 200 — a provider
 *  outage or a no-match query both mean "no results", not an error the
 *  farmer needs to see; the manual-entry fallback is always right there. */
export async function getLocationSearch(req: Request, res: Response): Promise<void> {
  const { q } = req.query as unknown as { q: string };
  const results = await searchLocation(q);
  res.json({ results });
}

/** GET /api/location/reverse?lat=...&lng=... */
export async function getLocationReverse(req: Request, res: Response): Promise<void> {
  const { lat, lng } = req.query as unknown as { lat: number; lng: number };
  const location = await reverseGeocode(lat, lng);
  res.json({ location });
}
