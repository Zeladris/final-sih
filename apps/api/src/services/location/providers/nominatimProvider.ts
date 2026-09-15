import type { Location, LocationSearchResult } from '@kisansetu/shared';
import { logger } from '../../../lib/logger.js';
import type { GeocodingProvider } from './geocodingProvider.js';

/**
 * OpenStreetMap's Nominatim — free, keyless, and the only provider Phase 10
 * uses for both search and reverse geocoding (§2, §12).
 *
 * Every rule the public instance's usage policy asks for is enforced HERE,
 * not left to callers to remember (§34):
 *   - a real identifying User-Agent (never the default fetch one)
 *   - a bounded timeout, one retry at most
 *   - results cached, so the same query/coordinate is not fetched twice
 *   - never called per keystroke — callers only reach this on an explicit
 *     search submit or an explicit "use current location" (§11, §36)
 *
 * A failure here is never fatal to the caller: `search` returns `[]` and
 * `reverse` returns `null`, exactly like the weather provider's own contract
 * (services/quality/weatherProvider.ts) — a geocoding outage degrades to
 * "use manual entry", it does not break registration or booking (§26, §43).
 */
export class NominatimProvider implements GeocodingProvider {
  readonly name = 'nominatim';

  private readonly searchCache = new Map<string, { at: number; value: LocationSearchResult[] }>();
  private readonly reverseCache = new Map<string, { at: number; value: Location | null }>();
  private readonly cacheTtlMs = 24 * 60 * 60 * 1000; // place names rarely change (§33).

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly userAgent: string,
  ) {}

  private async fetchJson(url: string): Promise<unknown | null> {
    const attempt = async (): Promise<unknown> => {
      const response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };

    try {
      return await attempt();
    } catch (firstError) {
      // At most one retry (§36) — a public service is not hammered on failure.
      try {
        return await attempt();
      } catch (cause) {
        logger.warn('nominatim request failed', {
          reason: (cause as Error).message,
          firstReason: (firstError as Error).message,
        });
        return null;
      }
    }
  }

  async search(query: string): Promise<LocationSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const cached = this.searchCache.get(trimmed.toLowerCase());
    if (cached && Date.now() - cached.at < this.cacheTtlMs) return cached.value;

    const url =
      `${this.baseUrl}/search?format=jsonv2&limit=5&countrycodes=in` +
      `&addressdetails=1&q=${encodeURIComponent(trimmed)}`;

    const body = await this.fetchJson(url);
    const results = Array.isArray(body) ? body.map(toSearchResult).filter(isNotNull) : [];

    this.searchCache.set(trimmed.toLowerCase(), { at: Date.now(), value: results });
    return results;
  }

  async reverse(latitude: number, longitude: number): Promise<Location | null> {
    // ~11 m precision: enough to identify a place, not a person's exact step.
    const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const cached = this.reverseCache.get(key);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) return cached.value;

    const url = `${this.baseUrl}/reverse?format=jsonv2&addressdetails=1&lat=${latitude}&lon=${longitude}`;
    const body = await this.fetchJson(url);
    const value = toLocation(body, latitude, longitude);

    this.reverseCache.set(key, { at: Date.now(), value });
    return value;
  }
}

interface NominatimAddress {
  village?: string;
  hamlet?: string;
  town?: string;
  suburb?: string;
  county?: string;
  state_district?: string;
  state?: string;
  country?: string;
  postcode?: string;
}

interface NominatimRow {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: NominatimAddress;
}

function toSearchResult(row: unknown): LocationSearchResult | null {
  const r = row as NominatimRow;
  const lat = Number.parseFloat(r.lat ?? '');
  const lon = Number.parseFloat(r.lon ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !r.display_name) return null;

  return {
    latitude: lat,
    longitude: lon,
    district: r.address?.state_district ?? r.address?.county ?? null,
    state: r.address?.state ?? null,
    country: r.address?.country ?? null,
    displayName: r.display_name,
  };
}

function toLocation(body: unknown, latitude: number, longitude: number): Location | null {
  const r = body as NominatimRow;
  if (!r || !r.address) return null;

  const address = r.address;
  return {
    latitude,
    longitude,
    addressLine: r.display_name ?? null,
    village: address.village ?? address.hamlet ?? address.town ?? address.suburb ?? null,
    district: address.state_district ?? address.county ?? null,
    state: address.state ?? null,
    country: address.country ?? null,
    postalCode: address.postcode ?? null,
    source: 'REVERSE_GEOCODE',
    provider: 'nominatim',
    capturedAt: new Date().toISOString(),
  };
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}
