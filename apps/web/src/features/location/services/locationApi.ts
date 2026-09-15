import type { Location, LocationSearchResult } from '@kisansetu/shared';
import { api } from '../../../lib/api.js';

/**
 * Thin wrapper over the backend's location endpoints (Phase 10 §13, §37).
 * Every screen that needs search or reverse geocoding calls these two
 * functions — never a provider, never a raw fetch to a third party.
 */

export async function searchLocation(query: string): Promise<LocationSearchResult[]> {
  const data = await api.get<{ results: LocationSearchResult[] }>(
    `/api/location/search?q=${encodeURIComponent(query)}`,
  );
  return data.results;
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<Location | null> {
  const data = await api.get<{ location: Location | null }>(
    `/api/location/reverse?lat=${latitude}&lng=${longitude}`,
  );
  return data.location;
}
