import type { Language } from '@kisansetu/shared';

/**
 * Voice booking (Phase 9; five languages per the Language & Accessibility
 * Rework §34–§36).
 *
 * `VoiceLanguage` is simply `Language` — every UI language voice can be
 * offered in, never a narrower set the product language type has to be
 * cast down to. Browser speech-recognition quality genuinely varies by
 * language and browser; that is handled in `browserSpeechProvider.ts`
 * (`isSupported()`), not by pretending the type system enforces equal
 * quality (§35).
 */
export type VoiceLanguage = Language;

export interface VoiceRecognitionResult {
  transcript: string;
  /** 0–1 where the browser provides one; null where it does not (Web Speech
   *  API support for this varies by engine and is never invented here). */
  confidence: number | null;
}

/**
 * A provider owns exactly two things: turning speech into text, and text into
 * speech. Everything else — what question to ask, how to parse the answer,
 * which endpoint to call — lives outside it (§4).
 *
 * `BrowserSpeechProvider` is the only implementation today. A future
 * `BhashiniProvider` records audio, sends it to Bhashini, and resolves the
 * same promise shape — nothing above this interface would change (§4, §43).
 */
export interface VoiceProvider {
  readonly name: string;
  isSupported(): boolean;
  /** Speaks `text` and resolves once playback finishes (or is cancelled). */
  speak(text: string, language: VoiceLanguage): Promise<void>;
  /** Stops any speech currently playing. */
  cancelSpeech(): void;
  /**
   * Listens once and resolves with what was understood. Resolves with `null`
   * on silence/timeout/no-match — never rejects for "didn't hear anything",
   * because that is a normal outcome a conversational flow retries (§27).
   */
  listenOnce(language: VoiceLanguage, timeoutMs?: number): Promise<VoiceRecognitionResult | null>;
  /** Stops listening early (farmer tapped Stop, or a turn is abandoned). */
  stopListening(): void;
}

/** What the turn-by-turn conversation is doing right now (§6, §34). */
export type VoiceTurnPhase = 'idle' | 'speaking' | 'listening' | 'thinking' | 'error';

/** The steps voice actively drives (§7). Centre/date/slot/photo/review stay
 *  primarily visual (§8) — voice hands off to the existing form there. */
export type VoiceStepId =
  | 'crop'
  | 'quantity'
  | 'storageDuration'
  | 'storageType'
  | 'storageLocation'
  | 'handoff';

/** Non-sensitive session draft (§29). No tokens, no raw audio. */
export interface VoiceBookingDraft {
  language: VoiceLanguage;
  cropId?: string;
  quantityKg?: number;
  storageDurationBand?: string;
  storageType?: string;
  storageLocationText?: string;
}
