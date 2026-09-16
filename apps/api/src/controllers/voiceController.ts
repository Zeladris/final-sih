import type { Request, Response } from 'express';
import type { Language } from '@kisansetu/shared';
import { validationError } from '../lib/errors.js';
import {
  isBhashiniConfigured,
  synthesizeSpeech,
  transcribeAudio,
} from '../services/voice/bhashiniProvider.js';
import { synthesizeWithEdgeTts } from '../services/voice/edgeTtsProvider.js';

/**
 * GET /api/voice/config — lets the frontend decide, once, which provider mix
 * to use (§43, see apps/web/.../providers/activeProvider.ts):
 *   - `bhashiniAvailable`: real ASR+TTS is configured — safe to use
 *     BhashiniProvider for BOTH listening and speaking.
 *   - `ttsAvailable`: /api/voice/synthesize has a real chance of returning
 *     audio even without Bhashini (the Edge-TTS fallback below needs no
 *     key), but /api/voice/transcribe does NOT have an equivalent free
 *     fallback — so this must never be read as "safe for listening too."
 */
export async function getVoiceConfig(_req: Request, res: Response): Promise<void> {
  const bhashiniAvailable = isBhashiniConfigured();
  res.json({ bhashiniAvailable, ttsAvailable: true, available: bhashiniAvailable });
}

/**
 * POST /api/voice/transcribe — multipart, `audio` file + `language` field
 * (routes/voice.ts runs multer before this). Always 200: a provider outage
 * or unrecognised speech both mean "nothing heard," which the voice-booking
 * turn engine already retries or hands off from — never an error the farmer
 * needs to see (§27).
 */
export async function postTranscribe(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) throw validationError('Attach the recording in the "audio" field.');

  const { language } = req.body as { language: Language };
  const result = await transcribeAudio(
    file.buffer.toString('base64'),
    language,
    'wav',
    16_000,
  );

  res.json({ transcript: result?.transcript ?? null, confidence: result?.confidence ?? null });
}

/**
 * POST /api/voice/synthesize — JSON `{ text, language }`. Always 200; a null
 * `audio` means the caller's own text-to-speech (or silence) takes over.
 * Tries Bhashini first (this app's real production TTS), then the free
 * Edge-TTS fallback (edgeTtsProvider.ts) — audioFormat tells the caller
 * which one answered, since they return different formats (wav vs mp3).
 */
export async function postSynthesize(req: Request, res: Response): Promise<void> {
  const { text, language } = req.body as { text: string; language: Language };

  const bhashini = await synthesizeSpeech(text, language);
  if (bhashini) {
    res.json({ audio: bhashini.audioBase64, audioFormat: bhashini.audioFormat });
    return;
  }

  const fallback = await synthesizeWithEdgeTts(text, language);
  res.json({ audio: fallback?.audioBase64 ?? null, audioFormat: fallback?.audioFormat ?? null });
}
