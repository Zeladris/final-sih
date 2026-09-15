import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';

/**
 * Recent weather at the produce's storage location (§5, §7).
 *
 * Context for a quality indication, never proof of damage — see the ML
 * service's inference/context.py for the bounded, one-directional way it is
 * allowed to matter.
 *
 * Three rules hold whatever provider is behind this:
 *   1. FAILURE IS NEVER FATAL. Every call returns null rather than throwing,
 *      and a null context means the assessment simply runs without it (§13).
 *   2. IT IS CACHED. Weather at a 0.1° square changes slowly; a booking rush
 *      in one village must not become a burst of identical outbound calls.
 *   3. IT IS REPLACEABLE. Nothing outside this file knows which service (or
 *      whether any service) answers.
 */

export interface WeatherContext {
  available: boolean;
  temperatureC: number | null;
  humidityPercent: number | null;
  /** Total rainfall over the recent window the provider reports. */
  rainfallRecentMm: number | null;
  /** Which provider answered, for provenance. */
  source: string;
}

export interface WeatherProvider {
  readonly name: string;
  getRecentContext(latitude: number, longitude: number): Promise<WeatherContext | null>;
}

/** Nothing configured: says so by answering null, every time. */
export class NullWeatherProvider implements WeatherProvider {
  readonly name = 'none';
  async getRecentContext(): Promise<WeatherContext | null> {
    return null;
  }
}

interface CacheEntry {
  at: number;
  value: WeatherContext | null;
}

/**
 * Open-Meteo: free, no API key, no account (§7). Past 24 hours of rainfall
 * plus current temperature and humidity — enough for storage context, and
 * nothing about the farmer is sent: only a rounded coordinate.
 */
export class OpenMeteoProvider implements WeatherProvider {
  readonly name = 'open-meteo';

  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly timeoutMs: number,
    private readonly cacheTtlMs = 60 * 60 * 1000,
    private readonly baseUrl = 'https://api.open-meteo.com/v1/forecast',
  ) {}

  /** ~11 km squares: precise enough for weather, coarse enough not to locate a person. */
  private key(latitude: number, longitude: number): string {
    return `${latitude.toFixed(1)},${longitude.toFixed(1)}`;
  }

  async getRecentContext(latitude: number, longitude: number): Promise<WeatherContext | null> {
    const key = this.key(latitude, longitude);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) return cached.value;

    const url =
      `${this.baseUrl}?latitude=${key.split(',')[0]}&longitude=${key.split(',')[1]}` +
      '&current=temperature_2m,relative_humidity_2m&past_days=1' +
      '&daily=precipitation_sum&timezone=UTC';

    let value: WeatherContext | null = null;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const body = (await response.json()) as {
        current?: { temperature_2m?: number; relative_humidity_2m?: number };
        daily?: { precipitation_sum?: Array<number | null> };
      };

      const rainfall = (body.daily?.precipitation_sum ?? [])
        .filter((mm): mm is number => typeof mm === 'number')
        .reduce((sum, mm) => sum + mm, 0);

      value = {
        available: true,
        temperatureC: numberOrNull(body.current?.temperature_2m),
        humidityPercent: numberOrNull(body.current?.relative_humidity_2m),
        rainfallRecentMm: Number.isFinite(rainfall) ? Math.round(rainfall * 10) / 10 : null,
        source: this.name,
      };
    } catch (cause) {
      // A weather outage is not a booking outage (§13). Cached as null so a
      // provider that is down is not called again for every farmer.
      logger.warn('weather context unavailable', { reason: (cause as Error).message });
      value = null;
    }

    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

let provider: WeatherProvider | null = null;

export function activeWeatherProvider(): WeatherProvider {
  provider ??=
    env.WEATHER_PROVIDER === 'open-meteo'
      ? new OpenMeteoProvider(env.WEATHER_TIMEOUT_MS)
      : new NullWeatherProvider();
  return provider;
}

/** For tests. */
export function setWeatherProvider(next: WeatherProvider | null): void {
  provider = next;
}
