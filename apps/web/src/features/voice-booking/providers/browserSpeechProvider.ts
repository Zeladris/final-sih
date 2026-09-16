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
 * `speechSynthesis.getVoices()` returns `[]` on the very first call in
 * Chrome — voices load asynchronously, sometime after the API itself already
 * reports as present, and `speak()` called before they arrive was the single
 * most common reason "voice booking says nothing at all" (§43).
 */
function getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish);
    // A browser that never fires the event would otherwise hang this forever.
    window.setTimeout(finish, 1000);
  });
}

/**
 * Best voice for the requested language, degrading gracefully — a machine
 * with only English voices installed (common: Windows ships none of the
 * other four out of the box) should still SPEAK something in a Tamil/
 * Kannada/Hindi/Malayalam session rather than go silent because nothing
 * matched exactly (§43). Mispronounced audio is a worse voice, not a broken
 * feature; true silence looks identical to "voice booking doesn't work."
 */
function pickVoice(voices: SpeechSynthesisVoice[], localeTag: string): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const lower = localeTag.toLowerCase();
  const exact = voices.find((voice) => voice.lang.toLowerCase() === lower);
  if (exact) return exact;
  const prefix = lower.split('-')[0]!;
  const samePrefix = voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix));
  return samePrefix ?? voices[0] ?? null;
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

  async speak(text: string, language: VoiceLanguage): Promise<void> {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const voices = await getVoicesAsync();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        resolve();
      };

      // A voice that never resolves would freeze the whole conversation, so
      // every exit path — finished, interrupted, errored, or simply never
      // firing an event at all (a real Chrome failure mode right after
      // `cancel()`) — resolves. The ceiling is generous: real speech is
      // rarely more than a few seconds per prompt.
      const safetyTimer = window.setTimeout(finish, Math.max(4000, text.length * 120));

      const speakNow = (): void => {
        const utterance = new SpeechSynthesisUtterance(text);
        const localeTag = VOICE_LOCALE[language];
        utterance.lang = localeTag;
        const voice = pickVoice(voices, localeTag);
        if (voice) utterance.voice = voice;
        utterance.rate = 0.95;

        utterance.onend = finish;
        utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
      };

      // Calling speak() in the same tick as cancel() is a known source of
      // silently-dropped utterances in Chrome; yielding one tick first is
      // the documented workaround.
      window.setTimeout(speakNow, 0);
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
