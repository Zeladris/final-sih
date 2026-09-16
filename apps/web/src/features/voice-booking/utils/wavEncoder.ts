/**
 * Raw PCM (from `AudioContext`/`ScriptProcessorNode`) → a 16 kHz mono 16-bit
 * WAV `Blob`, for Bhashini's ASR (§43). Not MediaRecorder's own codec output
 * (webm/opus): ASR services are given a specific format/sampling rate up
 * front (see bhashiniProvider.ts), so encoding to a format we control is
 * simpler than guessing what a browser's MediaRecorder happened to produce.
 */

const TARGET_SAMPLE_RATE = 16_000;

function downsample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (outputRate >= inputRate) return input;

  const ratio = inputRate / outputRate;
  const outLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outLength);

  for (let i = 0; i < outLength; i++) {
    // Averages the samples a simple decimation would skip, rather than
    // aliasing them away — cheap, and good enough for speech.
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < input.length; j++) {
      sum += input[j]!;
      count++;
    }
    output[i] = count > 0 ? sum / count : 0;
  }

  return output;
}

function floatTo16BitPCM(input: Float32Array): DataView {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]!));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return view;
}

function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Concatenates the recorded chunks, downsamples to 16 kHz mono, and wraps
 *  them in a WAV header. Returns `null` for an empty/near-silent recording. */
export function encodeWav(chunks: Float32Array[], inputSampleRate: number): Blob | null {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (totalLength === 0) return null;

  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const resampled = downsample(merged, inputSampleRate, TARGET_SAMPLE_RATE);
  if (resampled.length < TARGET_SAMPLE_RATE * 0.2) return null; // under ~200ms: nothing said

  const pcm = floatTo16BitPCM(resampled);
  const dataSize = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  return new Blob([header, pcm.buffer as ArrayBuffer], { type: 'audio/wav' });
}
