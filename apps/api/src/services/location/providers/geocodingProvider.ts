import type { Location, LocationSearchResult } from '@kisansetu/shared';

/**
 * Search and reverse geocoding, behind one interface (Phase 10 §12).
 *
 * `NominatimProvider` is the only implementation today. A commercial or
 * government provider drops in later by implementing this same interface —
 * nothing in `locationService.ts` or the routes would change.
 */
export interface GeocodingProvider {
  readonly name: string;
  /** Explicit, user-triggered search only — never called per keystroke (§11). */
  search(query: string): Promise<LocationSearchResult[]>;
  reverse(latitude: number, longitude: number): Promise<Location | null>;
}
