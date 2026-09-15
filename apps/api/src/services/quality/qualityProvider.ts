import type { AssessmentSource, QualityRisk, QualityWeatherContext } from '@kisansetu/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * AI pre-quality assessment provider (§4–§6).
 *
 * Node owns authorization, business rules and persistence; the Python service
 * owns inference (§35). This file is the only place that knows the service
 * exists, so a real model — or a different vendor — replaces the development
 * model by changing what is behind `ML_SERVICE_URL`, not the queue.
 */

export interface QualityAssessInput {
  cropCode: string;
  quantityKg: number;
  image: Buffer;
  mimeType: string;
  filename: string;
  /** Storage context (§6) — how long, and in what. */
  storageDurationDays?: number | null;
  storageType?: string | null;
  /** Weather context (§5), when a provider answered. Optional, always. */
  temperatureC?: number | null;
  humidityPercent?: number | null;
  rainfallRecentMm?: number | null;
}

export interface QualityModelOutput {
  modelName: string;
  modelVersion: string;
  cropCode: string;
  qualityScore: number;
  qualityRisk: QualityRisk;
  confidence: number;
  manualInspectionRequired: boolean;
  estimatedProcessingMinutes: number;
  reasonCodes: string[];
  inferenceTimestamp: string;
  trainingData: string;
  assessmentSource: AssessmentSource;
  weatherContext: QualityWeatherContext | null;
}

export class QualityModelUnavailable extends Error {
  constructor(readonly code: 'NOT_CONFIGURED' | 'UNREACHABLE' | 'TIMEOUT' | 'BAD_RESPONSE', detail?: string) {
    super(detail ?? code);
  }
}

export class UnsupportedCrop extends Error {}

export interface QualityProvider {
  readonly name: string;
  assess(input: QualityAssessInput): Promise<QualityModelOutput>;
}

const RISKS: readonly QualityRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

/** Talks to apps/ml over HTTP. Everything it returns is validated before use. */
export class HttpQualityProvider implements QualityProvider {
  readonly name = 'HttpQualityProvider';

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async assess(input: QualityAssessInput): Promise<QualityModelOutput> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(input.image)], { type: input.mimeType }), input.filename);
    // §11's contract. Note what is NOT sent: no farmer, no booking, no
    // location — the model is given a photograph and the little context it
    // needs to read it (§11 "Do not send unnecessary farmer PII").
    form.append('crop_id', input.cropCode);
    form.append('quantity_kg', String(input.quantityKg));
    appendIfPresent(form, 'storage_duration_days', input.storageDurationDays);
    appendIfPresent(form, 'storage_type', input.storageType);
    appendIfPresent(form, 'temperature_c', input.temperatureC);
    appendIfPresent(form, 'humidity_percent', input.humidityPercent);
    appendIfPresent(form, 'rainfall_recent_mm', input.rainfallRecentMm);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/predict/quality`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
      logger.warn('quality model unreachable', { reason: (cause as Error).message });
      throw new QualityModelUnavailable(timedOut ? 'TIMEOUT' : 'UNREACHABLE');
    }

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (response.status === 422 && JSON.stringify(body ?? {}).includes('UNSUPPORTED_CROP')) {
      throw new UnsupportedCrop(input.cropCode);
    }

    if (!response.ok || !body) {
      throw new QualityModelUnavailable('BAD_RESPONSE', `HTTP ${response.status}`);
    }

    return validateOutput(body);
  }
}

/** A malformed model response is treated as no response — never guessed at. */
function validateOutput(body: Record<string, unknown>): QualityModelOutput {
  const num = (key: string, min: number, max: number): number => {
    const value = body[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new QualityModelUnavailable('BAD_RESPONSE', `invalid ${key}`);
    }
    return value;
  };
  const str = (key: string): string => {
    const value = body[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new QualityModelUnavailable('BAD_RESPONSE', `invalid ${key}`);
    }
    return value;
  };

  const risk = body.qualityRisk;
  if (typeof risk !== 'string' || !RISKS.includes(risk as QualityRisk)) {
    throw new QualityModelUnavailable('BAD_RESPONSE', 'invalid qualityRisk');
  }

  const source = body.assessmentSource;

  return {
    modelName: str('modelName'),
    modelVersion: str('modelVersion'),
    cropCode: str('cropId'),
    qualityScore: num('qualityScore', 0, 100),
    qualityRisk: risk as QualityRisk,
    confidence: num('confidence', 0, 1),
    manualInspectionRequired: body.manualInspectionRequired === true,
    estimatedProcessingMinutes: num('estimatedProcessingMinutes', 0, 600),
    reasonCodes: Array.isArray(body.reasonCodes)
      ? body.reasonCodes.filter((code): code is string => typeof code === 'string').slice(0, 20)
      : [],
    inferenceTimestamp: str('inferenceTimestamp'),
    trainingData: typeof body.trainingData === 'string' ? body.trainingData : 'UNSPECIFIED',
    assessmentSource: source === 'AI_WITH_WEATHER_CONTEXT' ? 'AI_WITH_WEATHER_CONTEXT' : 'AI',
    weatherContext: weatherContextOf(body.weatherContext),
  };
}

/** The context the model says it used. Unreadable context is simply absent. */
function weatherContextOf(value: unknown): QualityWeatherContext | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const optional = (key: string): number | null =>
    typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? (raw[key] as number) : null;

  const relevance = raw.relevance;
  return {
    available: raw.available === true,
    temperatureC: optional('temperatureC'),
    humidityPercent: optional('humidityPercent'),
    rainfallRecentMm: optional('rainfallRecentMm'),
    storageDurationDays: optional('storageDurationDays'),
    storageType: typeof raw.storageType === 'string' ? raw.storageType : null,
    relevance:
      relevance === 'LOW' || relevance === 'MEDIUM' || relevance === 'HIGH' ? relevance : 'NONE',
  };
}

function appendIfPresent(form: FormData, field: string, value: number | string | null | undefined): void {
  if (value === null || value === undefined) return;
  form.append(field, String(value));
}

/** No service configured: says so, every time, rather than inventing an answer. */
export class UnconfiguredQualityProvider implements QualityProvider {
  readonly name = 'UnconfiguredQualityProvider';
  async assess(): Promise<QualityModelOutput> {
    throw new QualityModelUnavailable('NOT_CONFIGURED');
  }
}

let provider: QualityProvider | null = null;

export function activeQualityProvider(): QualityProvider {
  provider ??= env.ML_SERVICE_URL
    ? new HttpQualityProvider(env.ML_SERVICE_URL, env.ML_TIMEOUT_MS)
    : new UnconfiguredQualityProvider();
  return provider;
}

/** For tests. */
export function setQualityProvider(next: QualityProvider | null): void {
  provider = next;
}

export const isQualityModelConfigured = (): boolean => Boolean(env.ML_SERVICE_URL);
