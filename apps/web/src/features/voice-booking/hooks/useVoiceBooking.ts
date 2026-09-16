import { useCallback, useMemo, useRef, useState } from 'react';
import type { Crop, StorageDurationBand, StorageType } from '@kisansetu/shared';
import type { Translate } from '../../../i18n/index.js';
import type { VoiceLanguage, VoiceProvider, VoiceStepId, VoiceTurnPhase } from '../types.js';
import { normalizeCrop } from '../utils/normalizeCrop.js';
import { normalizeQuantity } from '../utils/normalizeQuantity.js';
import { normalizeStorageDuration, normalizeStorageType } from '../utils/normalizeStorage.js';
import { isAffirmative } from '../utils/voiceCommands.js';

const MAX_ATTEMPTS = 3;

export interface VoiceBookingCallbacks {
  onCropSelected: (crop: Crop) => void;
  onQuantity: (kg: number) => void;
  onStorageDuration: (band: StorageDurationBand) => void;
  onStorageType: (type: StorageType) => void;
  onStorageLocation: (text: string) => void;
  /** Every field this session drives has been collected — hand off to the
   *  existing visual photo/centre/date/slot/review steps (§8, §36). */
  onHandoff: () => void;
}

export interface UseVoiceBookingOptions extends VoiceBookingCallbacks {
  provider: VoiceProvider;
  language: VoiceLanguage;
  t: Translate;
  crops: Crop[] | null;
}

export interface VoiceBookingState {
  supported: boolean;
  running: boolean;
  paused: boolean;
  phase: VoiceTurnPhase;
  currentStep: VoiceStepId | null;
  transcript: string | null;
  promptText: string | null;
  micDenied: boolean;
  start: () => void;
  pause: () => void;
  resume: () => void;
  repeat: () => void;
  stop: () => void;
  /** Starts listening for this turn's answer — only ever called by the
   *  farmer tapping the mic while `phase === 'ready'`; a no-op otherwise. */
  tapMic: () => void;
}

/**
 * The turn-by-turn conversation engine (§6, §7).
 *
 * Each turn is SPEAK_PROMPT → LISTENING → VALIDATE → STORE → NEXT, exactly
 * as specified. It drives CROP, QUANTITY, STORAGE_DURATION, STORAGE_TYPE and
 * STORAGE_LOCATION — the steps deterministic parsing genuinely serves — then
 * calls `onHandoff` and stops. Centre/date/slot/photo/review stay the
 * existing visual steps (§8); this hook never reaches into them.
 *
 * Nothing here writes to `Draft` directly. Every recognised value goes back
 * through the same `onChange`-shaped callbacks the visual steps already use,
 * so voice cannot diverge from what tapping would have produced (§2).
 */
export function useVoiceBooking(options: UseVoiceBookingOptions): VoiceBookingState {
  const { provider, language, t, crops } = options;
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<VoiceTurnPhase>('idle');
  const [currentStep, setCurrentStep] = useState<VoiceStepId | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);

  // A generation token: stop()/unmount bumps it, so an in-flight speak/listen
  // that resolves late knows its session is dead and does nothing.
  const generationRef = useRef(0);
  const pausedRef = useRef(false);
  const resumeWaiters = useRef<Array<() => void>>([]);
  const lastPromptKeyRef = useRef<{ key: string; values?: Record<string, string | number> } | null>(
    null,
  );
  // Resolved by tapMic() (or by stop(), so a session ended mid-wait never
  // hangs forever on a tap that will now never come).
  const micTapResolveRef = useRef<(() => void) | null>(null);

  const waitIfPaused = useCallback(async (): Promise<void> => {
    if (!pausedRef.current) return;
    await new Promise<void>((resolve) => resumeWaiters.current.push(resolve));
  }, []);

  const releaseMicTapWait = useCallback((): void => {
    micTapResolveRef.current?.();
    micTapResolveRef.current = null;
  }, []);

  const speak = useCallback(
    async (generation: number, key: string, values?: Record<string, string | number>) => {
      lastPromptKeyRef.current = { key, values };
      const text = t(key, values);
      setPromptText(text);
      if (generation !== generationRef.current) return;
      setPhase('speaking');
      await provider.speak(text, language);
    },
    [provider, language, t],
  );

  const listen = useCallback(
    async (generation: number) => {
      if (generation !== generationRef.current) return null;

      // Push-to-talk: the mic only opens once the farmer taps it, never
      // automatically the instant the prompt finishes speaking. This is also
      // what closed the earlier "it isn't taking my voice" gap — recognition
      // starting in the same instant audio playback ends was a known source
      // of it missing the very start of what the farmer says, or picking up
      // the tail of the prompt itself; a farmer-initiated tap has neither
      // problem, since it can only happen after they've decided to speak.
      setPhase('ready');
      await new Promise<void>((resolve) => {
        micTapResolveRef.current = resolve;
      });
      if (generation !== generationRef.current) return null;

      // The recognizer has real startup latency between being asked to
      // start and actually capturing audio — a farmer who taps and speaks
      // immediately (most likely for a short word like "yes", far less
      // likely for a longer number they have to think through saying) can
      // have the very start of what they say clipped before capture has
      // truly begun. This gives it a moment to be ready first.
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (generation !== generationRef.current) return null;

      setPhase('listening');
      setTranscript(null);
      const result = await provider.listenOnce(language, 8000);
      if (generation !== generationRef.current) return null;
      if (result) setTranscript(result.transcript);
      return result;
    },
    [provider, language],
  );

  const tapMic = useCallback(() => {
    if (phase !== 'ready') return;
    releaseMicTapWait();
  }, [phase, releaseMicTapWait]);

  const runSession = useCallback(async () => {
    const generation = generationRef.current;
    const cb = (): VoiceBookingCallbacks => callbacksRef.current;
    const alive = (): boolean => generation === generationRef.current;

    // --- CROP -----------------------------------------------------------
    setCurrentStep('crop');
    let chosenCrop: Crop | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && alive() && !chosenCrop; attempt++) {
      await waitIfPaused();
      await speak(generation, attempt === 0 ? 'voice.prompt.crop' : 'voice.prompt.cropRetry');
      if (!alive()) return;
      const result = await listen(generation);
      if (!alive()) return;
      if (!result) continue;
      setPhase('thinking');
      chosenCrop = normalizeCrop(result.transcript, crops ?? []);
    }
    if (!chosenCrop) {
      // Three misses: stop guessing and let the visual list take over (§27).
      setCurrentStep(null);
      setRunning(false);
      setPhase('idle');
      return;
    }
    cb().onCropSelected(chosenCrop);

    // --- QUANTITY ---------------------------------------------------------
    setCurrentStep('quantity');
    let quantity: number | null = null;
    // Tracks whether the PREVIOUS attempt heard a number fine and only
    // failed at the yes/no confirmation — so the retry prompt below never
    // falsely claims "I didn't catch a number" when it plainly did (§ a
    // confirmed bug: that wrong claim made a confirmation failure look like
    // a hearing failure, which is worse than the failure itself).
    let lastCandidateRejected = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && alive() && quantity === null; attempt++) {
      await waitIfPaused();
      await speak(
        generation,
        attempt === 0
          ? 'voice.prompt.quantity'
          : lastCandidateRejected
            ? 'voice.prompt.quantityNotConfirmed'
            : 'voice.prompt.quantityRetry',
      );
      if (!alive()) return;
      const result = await listen(generation);
      if (!alive()) return;
      if (!result) {
        lastCandidateRejected = false;
        continue;
      }
      setPhase('thinking');
      const candidate = normalizeQuantity(result.transcript);
      if (candidate === null) {
        lastCandidateRejected = false;
        continue;
      }

      // §10: never store an ambiguous number silently — read it back first.
      await waitIfPaused();
      await speak(generation, 'voice.prompt.quantityConfirm', { quantity: candidate });
      if (!alive()) return;
      const confirmResult = await listen(generation);
      if (!alive()) return;
      if (confirmResult && isAffirmative(confirmResult.transcript)) {
        quantity = candidate;
      } else {
        // The confirm prompt itself invites "say the number again" as an
        // alternative to the word "yes" — so a restated number (the SAME
        // one, most often, since that's the natural way to confirm a
        // number in speech) has to be accepted here too. Without this, a
        // farmer who answers exactly as instructed loops forever: nothing
        // they say is ever "yes", so nothing is ever confirmed (§ the bug
        // this fixes — confirmed by a real farmer hitting it on "20 kg").
        const restated = confirmResult ? normalizeQuantity(confirmResult.transcript) : null;
        if (restated !== null) {
          quantity = restated;
        } else {
          lastCandidateRejected = true;
        }
      }
    }
    if (quantity === null) {
      setCurrentStep(null);
      setRunning(false);
      setPhase('idle');
      return;
    }
    cb().onQuantity(quantity);

    // --- STORAGE_DURATION ---------------------------------------------------
    setCurrentStep('storageDuration');
    let durationBand: StorageDurationBand | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && alive() && !durationBand; attempt++) {
      await waitIfPaused();
      await speak(
        generation,
        attempt === 0 ? 'voice.prompt.storageDuration' : 'voice.prompt.storageDurationRetry',
      );
      if (!alive()) return;
      const result = await listen(generation);
      if (!alive()) return;
      if (!result) continue;
      setPhase('thinking');
      durationBand = normalizeStorageDuration(result.transcript);
    }
    // Optional field (§11): three misses moves on rather than blocking.
    if (durationBand) cb().onStorageDuration(durationBand);

    // --- STORAGE_TYPE -------------------------------------------------------
    setCurrentStep('storageType');
    let storageType: StorageType | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && alive() && !storageType; attempt++) {
      await waitIfPaused();
      await speak(generation, attempt === 0 ? 'voice.prompt.storageType' : 'voice.prompt.storageTypeRetry');
      if (!alive()) return;
      const result = await listen(generation);
      if (!alive()) return;
      if (!result) continue;
      setPhase('thinking');
      storageType = normalizeStorageType(result.transcript);
    }
    if (storageType) cb().onStorageType(storageType);

    // --- STORAGE_LOCATION ----------------------------------------------------
    setCurrentStep('storageLocation');
    let locationText: string | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && alive() && !locationText; attempt++) {
      await waitIfPaused();
      await speak(
        generation,
        attempt === 0 ? 'voice.prompt.storageLocation' : 'voice.prompt.storageLocationRetry',
      );
      if (!alive()) return;
      const result = await listen(generation);
      if (!alive()) return;
      if (result && result.transcript.trim().length >= 2) locationText = result.transcript.trim();
    }
    if (locationText) cb().onStorageLocation(locationText);

    // --- HANDOFF -------------------------------------------------------------
    if (!alive()) return;
    setCurrentStep('handoff');
    await speak(generation, 'voice.prompt.handoff');
    if (!alive()) return;
    cb().onHandoff();
    setRunning(false);
    setPhase('idle');
    setCurrentStep(null);
  }, [crops, listen, speak, waitIfPaused]);

  const start = useCallback(() => {
    if (!provider.isSupported()) return;
    generationRef.current += 1;
    pausedRef.current = false;
    setPaused(false);
    setMicDenied(false);
    setRunning(true);
    setPhase('idle');
    void runSession().catch(() => {
      setMicDenied(true);
      setRunning(false);
      setPhase('error');
    });
  }, [provider, runSession]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    provider.stopListening();
    provider.cancelSpeech();
    pausedRef.current = false;
    resumeWaiters.current.splice(0).forEach((resolve) => resolve());
    releaseMicTapWait(); // a wait for a tap that will now never come
    setRunning(false);
    setPaused(false);
    setPhase('idle');
    setCurrentStep(null);
  }, [provider, releaseMicTapWait]);

  const pause = useCallback(() => {
    if (!running) return;
    pausedRef.current = true;
    setPaused(true);
    provider.stopListening();
    provider.cancelSpeech();
  }, [provider, running]);

  const resume = useCallback(() => {
    if (!running || !pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    resumeWaiters.current.splice(0).forEach((resolve) => resolve());
  }, [running]);

  const repeat = useCallback(() => {
    const last = lastPromptKeyRef.current;
    if (!last || !running) return;
    provider.cancelSpeech();
    void provider.speak(t(last.key, last.values), language);
  }, [language, provider, running, t]);

  return useMemo(
    () => ({
      supported: provider.isSupported(),
      running,
      paused,
      phase,
      currentStep,
      transcript,
      promptText,
      micDenied,
      start,
      pause,
      resume,
      repeat,
      stop,
      tapMic,
    }),
    [
      provider,
      running,
      paused,
      phase,
      currentStep,
      transcript,
      promptText,
      micDenied,
      start,
      pause,
      resume,
      repeat,
      stop,
      tapMic,
    ],
  );
}
