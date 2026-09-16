import { api } from '../../../lib/api.js';
import { encodeWav } from '../utils/wavEncoder.js';
import type { VoiceLanguage, VoiceProvider, VoiceRecognitionResult } from '../types.js';

/**
 * Bhashini-backed ASR/TTS (§43) — the provider `types.ts` was written to
 * expect: records audio, sends it to the backend's Bhashini proxy, resolves
 * the same promise shape as BrowserSpeechProvider. Better Tamil/Kannada/
 * Hindi/Malayalam accuracy than a browser's built-in engine, at the cost of a
 * server round trip and a real key — see bhashiniProvider.ts.
 *
 * `getUserMedia`/`AudioContext` capture raw PCM, not MediaRecorder's own
 * codec output: the ASR call sends a fixed format (16 kHz mono WAV, see
 * wavEncoder.ts) rather than whatever codec a given browser happened to pick.
 *
 * Same contract as every provider: `listenOnce` never rejects, `speak`
 * always resolves. A backend that is not configured, or briefly down, comes
 * back as "nothing heard" — indistinguishable from silence, which the voice
 * session already retries (§27).
 */

interface TranscribeResponse {
  transcript: string | null;
  confidence: number | null;
}

interface SynthesizeResponse {
  audio: string | null;
  audioFormat: string | null;
}

const SILENCE_HOLD_MS = 1500;
const MIN_RECORDING_MS = 300;
const SILENCE_RMS_THRESHOLD = 0.01;
const PROCESSOR_BUFFER_SIZE = 4096;

function getAudioContextCtor(): typeof AudioContext | null {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class BhashiniSpeechProvider implements VoiceProvider {
  readonly name = 'BhashiniSpeechProvider';

  private currentAudio: HTMLAudioElement | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stopHandler: (() => void) | null = null;
  // Bumped by every speak()/cancelSpeech() call, so a call whose fetch is
  // still in flight when a newer one starts (e.g. two quick taps of
  // "Repeat") knows it has been superseded and never plays — without this,
  // both calls eventually create their own <audio> element and play at
  // once, since `cancelSpeech()` only ever cancels whichever one HAS
  // already started, not one still mid-fetch (§ the actual bug: two prompts
  // audible simultaneously after a double-click).
  private speakGeneration = 0;

  isSupported(): boolean {
    return Boolean(
      typeof navigator !== 'undefined' && navigator.mediaDevices && getAudioContextCtor(),
    );
  }

  async speak(text: string, language: VoiceLanguage): Promise<void> {
    // Claims this generation, then stops whatever was already playing —
    // WITHOUT going through cancelSpeech() below, which bumps the generation
    // AGAIN and would make every call invalidate itself before its own
    // fetch even returns (the actual bug: no audio played at all).
    const generation = ++this.speakGeneration;
    this.stopCurrentAudio();

    let audioBase64: string | null = null;
    let mimeType = 'audio/wav';
    try {
      const result = await api.post<SynthesizeResponse>('/api/voice/synthesize', { text, language });
      audioBase64 = result.audio;
      // Bhashini returns wav; the free Edge-TTS fallback (edgeTtsProvider.ts)
      // returns mp3 — the data URI's MIME has to match whichever it was.
      if (result.audioFormat === 'mp3') mimeType = 'audio/mpeg';
    } catch {
      audioBase64 = null;
    }

    // Superseded by a newer speak()/cancelSpeech() call while the fetch was
    // in flight: never start audio for a prompt that is no longer current.
    if (generation !== this.speakGeneration) return;
    if (!audioBase64) return; // Nothing configured/available: silence, not an error (§13).

    return new Promise((resolve) => {
      if (generation !== this.speakGeneration) {
        resolve();
        return;
      }

      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
      this.currentAudio = audio;
      const finish = (): void => {
        if (this.currentAudio === audio) this.currentAudio = null;
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
    });
  }

  cancelSpeech(): void {
    this.speakGeneration += 1; // invalidates any speak() still mid-fetch
    this.stopCurrentAudio();
  }

  private stopCurrentAudio(): void {
    if (!this.currentAudio) return;
    this.currentAudio.pause();
    this.currentAudio.currentTime = 0;
    this.currentAudio = null;
  }

  listenOnce(language: VoiceLanguage, timeoutMs = 8000): Promise<VoiceRecognitionResult | null> {
    this.stopListening();

    return new Promise((resolve) => {
      let settled = false;
      let finishing = false;
      const chunks: Float32Array[] = [];

      const teardown = (): void => {
        this.processor?.disconnect();
        this.source?.disconnect();
        void this.audioContext?.close().catch(() => undefined);
        this.stream?.getTracks().forEach((track) => track.stop());
        this.processor = null;
        this.source = null;
        this.audioContext = null;
        this.stream = null;
        this.stopHandler = null;
      };

      const settle = (result: VoiceRecognitionResult | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        teardown();
        resolve(result);
      };

      const finishRecording = (): void => {
        if (finishing || settled) return;
        finishing = true;
        const sampleRate = this.audioContext?.sampleRate ?? 44_100;
        const wav = encodeWav(chunks, sampleRate);
        if (!wav) {
          settle(null);
          return;
        }

        const form = new FormData();
        form.append('audio', wav, 'utterance.wav');
        form.append('language', language);

        api
          .upload<TranscribeResponse>('/api/voice/transcribe', form)
          .then((result) =>
            settle(result.transcript ? { transcript: result.transcript, confidence: result.confidence } : null),
          )
          .catch(() => settle(null));
      };

      const hardTimer = window.setTimeout(finishRecording, timeoutMs);
      this.stopHandler = finishRecording;

      navigator.mediaDevices
        .getUserMedia({ audio: { channelCount: 1 } })
        .then((stream) => {
          if (settled) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          this.stream = stream;

          const AudioCtx = getAudioContextCtor();
          if (!AudioCtx) {
            settle(null);
            return;
          }
          const audioContext = new AudioCtx();
          this.audioContext = audioContext;
          this.source = audioContext.createMediaStreamSource(stream);
          // Deprecated but universally supported; an AudioWorklet module
          // would need its own build/load step for a few dozen lines of DSP.
          this.processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);

          let recordedSamples = 0;
          let silentMs = 0;
          let heardSpeech = false;

          this.processor.onaudioprocess = (event) => {
            if (settled || finishing) return;
            const input = event.inputBuffer.getChannelData(0);
            chunks.push(new Float32Array(input));
            recordedSamples += input.length;

            let sumSquares = 0;
            for (let i = 0; i < input.length; i++) sumSquares += input[i]! * input[i]!;
            const rms = Math.sqrt(sumSquares / input.length);
            const chunkMs = (input.length / audioContext.sampleRate) * 1000;

            if (rms > SILENCE_RMS_THRESHOLD) {
              heardSpeech = true;
              silentMs = 0;
            } else {
              silentMs += chunkMs;
            }

            const recordedMs = (recordedSamples / audioContext.sampleRate) * 1000;
            if (heardSpeech && silentMs >= SILENCE_HOLD_MS && recordedMs >= MIN_RECORDING_MS) {
              finishRecording();
            }
          };

          this.source.connect(this.processor);
          // Output is never written to, so nothing is heard through it — the
          // connection exists only because onaudioprocess needs a live graph.
          this.processor.connect(audioContext.destination);
        })
        .catch(() => settle(null)); // mic denied/unavailable
    });
  }

  stopListening(): void {
    this.stopHandler?.();
  }
}

let shared: BhashiniSpeechProvider | null = null;

export function bhashiniVoiceProvider(): BhashiniSpeechProvider {
  shared ??= new BhashiniSpeechProvider();
  return shared;
}
