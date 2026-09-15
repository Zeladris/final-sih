import type { Location, LocationSearchResult } from '@kisansetu/shared';
import { env } from '../../config/env.js';
import type { GeocodingProvider } from './providers/geocodingProvider.js';
import { NominatimProvider } from './providers/nominatimProvider.js';

/**
 * The one place that knows which geocoding provider is active (Phase 10
 * §13). Controllers call this, never a provider directly.
 */
let provider: GeocodingProvider | null = null;

function activeProvider(): GeocodingProvider {
  provider ??= new NominatimProvider(
    env.NOMINATIM_BASE_URL,
    env.NOMINATIM_TIMEOUT_MS,
    env.NOMINATIM_USER_AGENT,
  );
  return provider;
}

/** For tests. */
export function setGeocodingProvider(next: GeocodingProvider | null): void {
  provider = next;
}

export async function searchLocation(query: string): Promise<LocationSearchResult[]> {
  return activeProvider().search(query);
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<Location | null> {
  return activeProvider().reverse(latitude, longitude);
}
