import type { Language } from '@kisansetu/shared';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';

/**
 * Bhashini ASR/TTS for voice booking (Phase 9) — server side, because the
 * ULCA/Dhruva API needs a secret key that must never reach the browser.
 *
 * Same three rules as `weatherProvider.ts`:
 *   1. FAILURE IS NEVER FATAL. Every call resolves null rather than throwing;
 *      the frontend's BhashiniProvider falls back to BrowserSpeechProvider,
 *      and the caller never has to distinguish "not configured" from "Bhashini
 *      is briefly down" from "no speech recognised."
 *   2. PIPELINE CONFIG IS CACHED. `getModelsPipeline` returns a serviceId,
 *      callbackUrl and inference key that do not change per request — asking
 *      again for every farmer would be pure waste.
 *   3. NOTHING FROM THE FARMER IS LOGGED. Only outcome/timing, never
 *      transcript text or audio.
 */

interface PipelineTaskConfig {
  serviceId: string;
}

interface PipelineConfig {
  callbackUrl: string;
  authName: string;
  authValue: string;
  asr: PipelineTaskConfig | null;
  tts: PipelineTaskConfig | null;
  cachedAt: number;
}

const CONFIG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const configCache = new Map<Language, PipelineConfig>();

export function isBhashiniConfigured(): boolean {
  return Boolean(env.BHASHINI_USER_ID && env.BHASHINI_API_KEY);
}

interface RawPipelineConfigResponse {
  pipelineResponseConfig?: Array<{
    taskType?: string;
    config?: Array<{ serviceId?: string }>;
  }>;
  pipelineInferenceAPIEndPoint?: {
    callbackUrl?: string;
    inferenceApiKey?: { name?: string; value?: string };
  };
}

async function fetchPipelineConfig(language: Language): Promise<PipelineConfig | null> {
  const cached = configCache.get(language);
  if (cached && Date.now() - cached.cachedAt < CONFIG_CACHE_TTL_MS) return cached;

  try {
    const response = await fetch(env.BHASHINI_CONFIG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        userID: env.BHASHINI_USER_ID as string,
        ulcaApiKey: env.BHASHINI_API_KEY as string,
      },
      body: JSON.stringify({
        pipelineTasks: [
          { taskType: 'asr', config: { language: { sourceLanguage: language } } },
          { taskType: 'tts', config: { language: { sourceLanguage: language } } },
        ],
        pipelineRequestConfig: { pipelineId: env.BHASHINI_PIPELINE_ID },
      }),
      signal: AbortSignal.timeout(env.BHASHINI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = (await response.json()) as RawPipelineConfigResponse;
    const endpoint = body.pipelineInferenceAPIEndPoint;
    const authName = endpoint?.inferenceApiKey?.name;
    const authValue = endpoint?.inferenceApiKey?.value;
    if (!endpoint?.callbackUrl || !authName || !authValue) {
      throw new Error('pipeline config response is missing the inference endpoint or key');
    }

    const serviceIdFor = (taskType: string): PipelineTaskConfig | null => {
      const serviceId = body.pipelineResponseConfig?.find((t) => t.taskType === taskType)?.config?.[0]
        ?.serviceId;
      return serviceId ? { serviceId } : null;
    };

    const config: PipelineConfig = {
      callbackUrl: endpoint.callbackUrl,
      authName,
      authValue,
      asr: serviceIdFor('asr'),
      tts: serviceIdFor('tts'),
      cachedAt: Date.now(),
    };
    configCache.set(language, config);
    return config;
  } catch (cause) {
    logger.warn('bhashini pipeline config unavailable', { language, reason: (cause as Error).message });
    return null;
  }
}

export interface TranscribeResult {
  transcript: string;
  confidence: null;
}

/** `audioBase64` is a single utterance, never persisted or logged. */
export async function transcribeAudio(
  audioBase64: string,
  language: Language,
  audioFormat: string,
  samplingRate: number,
): Promise<TranscribeResult | null> {
  if (!isBhashiniConfigured()) return null;
  const config = await fetchPipelineConfig(language);
  if (!config?.asr) return null;

  try {
    const response = await fetch(config.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [config.authName]: config.authValue,
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: 'asr',
            config: {
              language: { sourceLanguage: language },
              serviceId: config.asr.serviceId,
              audioFormat,
              samplingRate,
            },
          },
        ],
        inputData: { audio: [{ audioContent: audioBase64 }] },
      }),
      signal: AbortSignal.timeout(env.BHASHINI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = (await response.json()) as {
      pipelineResponse?: Array<{ output?: Array<{ source?: string }> }>;
    };
    const transcript = body.pipelineResponse?.[0]?.output?.[0]?.source?.trim();
    if (!transcript) return null;

    return { transcript, confidence: null };
  } catch (cause) {
    logger.warn('bhashini transcription failed', { language, reason: (cause as Error).message });
    return null;
  }
}

export interface SynthesizeResult {
  audioBase64: string;
  audioFormat: 'wav';
}

export async function synthesizeSpeech(text: string, language: Language): Promise<SynthesizeResult | null> {
  if (!isBhashiniConfigured()) return null;
  const config = await fetchPipelineConfig(language);
  if (!config?.tts) return null;

  try {
    const response = await fetch(config.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [config.authName]: config.authValue,
      },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: 'tts',
            config: {
              language: { sourceLanguage: language },
              serviceId: config.tts.serviceId,
              gender: 'female',
              samplingRate: 22050,
            },
          },
        ],
        inputData: { input: [{ source: text }] },
      }),
      signal: AbortSignal.timeout(env.BHASHINI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = (await response.json()) as {
      pipelineResponse?: Array<{ audio?: Array<{ audioContent?: string }> }>;
    };
    const audioBase64 = body.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
    if (!audioBase64) return null;

    return { audioBase64, audioFormat: 'wav' };
  } catch (cause) {
    logger.warn('bhashini speech synthesis failed', { language, reason: (cause as Error).message });
    return null;
  }
}

/** For tests. */
export function clearBhashiniConfigCache(): void {
  configCache.clear();
}
