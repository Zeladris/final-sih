import type { VoiceLanguage, VoiceProvider, VoiceRecognitionResult } from '../types.js';
import { browserVoiceProvider } from './browserSpeechProvider.js';
import { bhashiniVoiceProvider } from './bhashiniSpeechProvider.js';

/**
 * Speaks via the server (Bhashini, or — see edgeTtsProvider.ts on the API —
 * the free Edge-TTS fallback behind it) but LISTENS via the browser's own
 * recognizer.
 *
 * Why split it: a browser with no Tamil/Kannada/Hindi/Malayalam voice
 * installed at the OS level produces true silence for `speak()` no matter
 * what voice-selection logic runs client-side (browserSpeechProvider.ts's
 * pickVoice already degrades as gracefully as it can — there is simply
 * nothing installed to select). Server TTS has a real voice for all five of
 * the app's languages unconditionally. Listening has no equivalent gap
 * today — the browser's own recognizer already works — and no free
 * server-side ASR fallback is wired up, so it stays on the browser.
 */
export class HybridSpeechProvider implements VoiceProvider {
  readonly name = 'HybridSpeechProvider';

  private readonly speaker = bhashiniVoiceProvider();
  private readonly listener = browserVoiceProvider();

  isSupported(): boolean {
    return this.listener.isSupported();
  }

  speak(text: string, language: VoiceLanguage): Promise<void> {
    return this.speaker.speak(text, language);
  }

  cancelSpeech(): void {
    this.speaker.cancelSpeech();
  }

  listenOnce(language: VoiceLanguage, timeoutMs?: number): Promise<VoiceRecognitionResult | null> {
    return this.listener.listenOnce(language, timeoutMs);
  }

  stopListening(): void {
    this.listener.stopListening();
  }
}

let shared: HybridSpeechProvider | null = null;

export function hybridVoiceProvider(): HybridSpeechProvider {
  shared ??= new HybridSpeechProvider();
  return shared;
}
