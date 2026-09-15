import type { VoiceLanguage, VoiceProvider, VoiceRecognitionResult } from '../types.js';

/**
 * The initial provider (§5): the Web Speech API already in the browser, no
 * key, no deployment, no server round trip for recognition itself.
 *
 * Not every browser implements `SpeechRecognition` (notably: no Firefox, no
 * desktop Safari as of this build). `isSupported()` is checked before this is
 * offered at all — the standard form is never blocked on it (§27, §28).
 */

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>>;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * BCP-47 tags recognised by both SpeechRecognition and SpeechSynthesis
 * (§36) — kept separate from the product's own `Language` codes, which are
 * a database/UI concern, not a provider configuration value.
 */
const VOICE_LOCALE: Record<VoiceLanguage, string> = {
  en: 'en-IN',
  ta: 'ta-IN',
  kn: 'kn-IN',
  hi: 'hi-IN',
  ml: 'ml-IN',
};

export class BrowserSpeechProvider implements VoiceProvider {
  readonly name = 'BrowserSpeechProvider';

  private recognition: SpeechRecognitionLike | null = null;

  isSupported(): boolean {
    return getRecognitionCtor() !== null && 'speechSynthesis' in window;
  }

  speak(text: string, language: VoiceLanguage): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = VOICE_LOCALE[language];
      utterance.rate = 0.95;

      // A voice that never resolves would freeze the whole conversation, so
      // every exit path — finished, interrupted, or errored — resolves.
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }

  cancelSpeech(): void {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  listenOnce(language: VoiceLanguage, timeoutMs = 8000): Promise<VoiceRecognitionResult | null> {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return Promise.resolve(null);

    this.stopListening();

    return new Promise((resolve) => {
      const recognition = new Ctor();
      recognition.lang = VOICE_LOCALE[language];
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      this.recognition = recognition;

      let settled = false;
      const finish = (result: VoiceRecognitionResult | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        resolve(result);
      };

      const timer = window.setTimeout(() => {
        recognition.stop();
        finish(null);
      }, timeoutMs);

      recognition.onresult = (event) => {
        const alt = event.results[0]?.[0];
        finish(alt ? { transcript: alt.transcript.trim(), confidence: alt.confidence ?? null } : null);
      };
      recognition.onerror = () => finish(null);
      recognition.onend = () => finish(null);

      try {
        recognition.start();
      } catch {
        finish(null);
      }
    });
  }

  stopListening(): void {
    this.recognition?.abort();
    this.recognition = null;
  }
}

let shared: BrowserSpeechProvider | null = null;

/** One instance per tab: two live recognisers fighting the same microphone
 *  is a real failure mode, not a hypothetical one. */
export function browserVoiceProvider(): BrowserSpeechProvider {
  shared ??= new BrowserSpeechProvider();
  return shared;
}
