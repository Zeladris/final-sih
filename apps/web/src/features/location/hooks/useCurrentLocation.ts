import { useCallback, useState } from 'react';
import { useT } from '../../../i18n/index.js';

export interface CurrentLocationCoords {
  latitude: number;
  longitude: number;
  /** GPS is an estimate, never exact (§9) — kept alongside the coordinate so
   *  a caller can show it, but never used to reject a farmer. */
  accuracyMeters: number | null;
}

export interface UseCurrentLocationResult {
  coords: CurrentLocationCoords | null;
  locating: boolean;
  /** Localized status: saved, denied, unsupported — or null before first use. */
  notice: string | null;
  request: () => void;
}

/**
 * Browser GPS, in one place (Phase 10 §8), extracted out of what used to be
 * near-identical copies in `AddressStep` and the booking `LocationStep`
 * (§37 — one implementation, not a pattern repeated per screen).
 *
 * Every exit — granted, denied, unavailable, timed out — resolves to a
 * `notice` and never throws: GPS is optional everywhere it is offered, and a
 * refusal is a normal outcome the farmer continues past, not an error (§8, §29).
 */
export function useCurrentLocation(): UseCurrentLocationResult {
  const t = useT();
  const [coords, setCoords] = useState<CurrentLocationCoords | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const request = useCallback((): void => {
    setNotice(null);

    if (!navigator.geolocation) {
      setNotice(t('registration.address.locationUnsupported'));
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : null,
        });
        setLocating(false);
        setNotice(t('registration.address.locationSaved'));
      },
      () => {
        // Denied, unavailable, or timed out all land here — the caller's
        // manual/search fallback is always available regardless of why (§8).
        setLocating(false);
        setNotice(t('registration.address.locationDenied'));
      },
      { timeout: 10_000 },
    );
  }, [t]);

  return { coords, locating, notice, request };
}
