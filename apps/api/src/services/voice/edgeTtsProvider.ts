import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EdgeTTS } from 'node-edge-tts';
import type { Language } from '@kisansetu/shared';
import { logger } from '../../lib/logger.js';

/**
 * Free fallback text-to-speech (Phase 9 voice booking), using Microsoft
 * Edge's own "Read Aloud" cloud service — no API key, the same service
 * Edge's browser feature calls, reachable from a plain server-side request.
 *
 * This exists only because Bhashini — this app's real production TTS, see
 * bhashiniProvider.ts — needs an approved key that may not exist yet in a
 * given deployment. It is not a replacement: Bhashini is always tried
 * first (see voiceController.ts), and this only fills the gap. It matters
 * because the OTHER fallback — a browser's own built-in speech engine — has
 * a real hole no amount of client-side code can close: a machine with no
 * Tamil/Kannada/Hindi/Malayalam voice installed at the OS level produces
 * true silence for those languages, no matter what voice-selection logic
 * runs client-side (see browserSpeechProvider.ts's pickVoice). This service
 * has real voices for all five of the app's languages unconditionally.
 *
 * Same rule as every provider here: never throws, resolves null on any
 * failure (no network, the service is down, whatever) — the caller already
 * treats "no audio" as a normal, silent outcome.
 */

const EDGE_VOICE: Record<Language, string> = {
  en: 'en-IN-NeerjaNeural',
  ta: 'ta-IN-PallaviNeural',
  kn: 'kn-IN-SapnaNeural',
  hi: 'hi-IN-SwaraNeural',
  ml: 'ml-IN-SobhanaNeural',
};

export interface EdgeTtsResult {
  audioBase64: string;
  audioFormat: 'mp3';
}

export async function synthesizeWithEdgeTts(text: string, language: Language): Promise<EdgeTtsResult | null> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), 'edge-tts-'));
    const outputPath = join(dir, 'speech.mp3');

    const tts = new EdgeTTS({ voice: EDGE_VOICE[language], lang: `${language}-IN` });
    await tts.ttsPromise(text, outputPath);

    const buffer = await readFile(outputPath);
    return { audioBase64: buffer.toString('base64'), audioFormat: 'mp3' };
  } catch (cause) {
    logger.warn('edge tts fallback unavailable', { language, reason: (cause as Error).message });
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
