import { api } from '../../../lib/api.js';
import { browserVoiceProvider } from './browserSpeechProvider.js';
import { bhashiniVoiceProvider } from './bhashiniSpeechProvider.js';
import { hybridVoiceProvider } from './hybridSpeechProvider.js';
import type { VoiceProvider } from '../types.js';

/**
 * Which `VoiceProvider` the app actually uses (§43), in preference order:
 *
 *   1. BhashiniSpeechProvider — full ASR+TTS — when the backend confirms
 *      real Bhashini credentials are configured AND this browser can record
 *      audio for it. Best accuracy for all five languages, both ways.
 *   2. HybridSpeechProvider — browser listens, server speaks — whenever
 *      server-side TTS is worth trying (Bhashini, or the free Edge-TTS
 *      fallback behind it: see the API's voiceController.ts/
 *      edgeTtsProvider.ts) even though Bhashini itself isn't configured.
 *      This is what actually fixes a real gap: a browser with no Tamil/
 *      Kannada/Hindi/Malayalam voice installed at the OS level produces true
 *      silence for those languages no matter how BrowserSpeechProvider picks
 *      a voice — there's nothing installed to pick.
 *   3. BrowserSpeechProvider — both from the browser — the original,
 *      always-available fallback if neither of the above applies.
 *
 * The check is async (one GET to the backend) but `VoiceProvider.isSupported`
 * must answer synchronously, so callers read `getActiveVoiceProvider()` for
 * "the best answer right now" and call `primeVoiceProvider()` once, early
 * (FarmerBooking mounts it), to make that answer ready by the time the
 * farmer actually taps the mic.
 */

let resolved: VoiceProvider | null = null;
let checking: Promise<VoiceProvider> | null = null;

export function getActiveVoiceProvider(): VoiceProvider {
  return resolved ?? browserVoiceProvider();
}

export function primeVoiceProvider(): Promise<VoiceProvider> {
  checking ??= api
    .get<{ bhashiniAvailable: boolean; ttsAvailable: boolean }>('/api/voice/config')
    .then((config) => {
      const bhashini = bhashiniVoiceProvider();
      if (config.bhashiniAvailable && bhashini.isSupported()) {
        resolved = bhashini;
        return resolved;
      }

      const hybrid = hybridVoiceProvider();
      resolved = config.ttsAvailable && hybrid.isSupported() ? hybrid : browserVoiceProvider();
      return resolved;
    })
    .catch(() => {
      resolved = browserVoiceProvider();
      return resolved;
    });
  return checking;
}
