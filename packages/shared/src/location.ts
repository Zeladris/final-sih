/**
 * Location (Phase 10, §4, §5, §40).
 *
 * One normalized representation, used for a farmer's farm location, a
 * booking's produce storage location, and a search/reverse-geocode result
 * alike — never separate incompatible shapes per screen.
 */

/** How a coordinate was obtained. Never guessed after the fact. */
export const LOCATION_SOURCES = {
  GPS: 'GPS',
  SEARCH: 'SEARCH',
  MANUAL: 'MANUAL',
  REVERSE_GEOCODE: 'REVERSE_GEOCODE',
  ADMIN_DEFINED: 'ADMIN_DEFINED',
} as const;
export type LocationSource = (typeof LOCATION_SOURCES)[keyof typeof LOCATION_SOURCES];
export const ALL_LOCATION_SOURCES: readonly LocationSource[] = Object.values(LOCATION_SOURCES);

/** What the location is FOR — deliberately explicit rather than one vague
 *  `location` field, because a farmer's current position, farm and produce
 *  storage point are three different places (§5, §7). */
export const LOCATION_TYPES = {
  CURRENT: 'CURRENT',
  FARM: 'FARM',
  STORAGE: 'STORAGE',
  PROCUREMENT_CENTRE: 'PROCUREMENT_CENTRE',
} as const;
export type LocationType = (typeof LOCATION_TYPES)[keyof typeof LOCATION_TYPES];

export interface Location {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;

  addressLine?: string | null;
  village?: string | null;
  locality?: string | null;
  taluk?: string | null;
  district?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;

  source: LocationSource;
  /** Which adapter produced this (e.g. "nominatim"), for provenance. */
  provider?: string | null;
  capturedAt?: string | null;
}

/** One row from an explicit location search (§11, §14). */
export interface LocationSearchResult {
  latitude: number;
  longitude: number;
  district?: string | null;
  state?: string | null;
  country?: string | null;
  /** The provider's own label — shown as-is, never translated (§42). */
  displayName: string;
}

/** Weather at a stored coordinate, for AI quality context (§23–§26). Kept
 *  deliberately small: only what plausibly matters for stored produce. */
export interface WeatherContext {
  temperature?: number | null;
  relativeHumidity?: number | null;
  precipitation?: number | null;
  weatherCode?: number | null;
  observedAt: string;
  source: string;
}

/** Haversine straight-line distance in kilometres, rounded to 0.1 km for
 *  display. Deterministic, no external call — routing/road distance is a
 *  deliberately separate, later concern (§18, §19). */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}
