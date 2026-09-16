/**
 * A free, no-telephony stand-in for a real phone call (Phase 9 IVR).
 *
 * Talks to the exact same `POST /api/ivr/voice` webhook a real Twilio call
 * would hit — same session state (ivrSession.ts), same booking logic
 * (ivrService.ts calling straight into bookingService.ts) — just typed
 * digits instead of a keypad, and printed/spoken prompts instead of a real
 * phone line. Lets the whole phone-booking flow be demoed and tested with
 * no telephony account, no phone number, and no cost.
 *
 * The API dev server must already be running. Run:
 *   npm run ivr:simulate -w @kisansetu/api
 *
 * For scripted/non-interactive runs (or piped input, which a plain
 * `readline` interface does not handle well across multiple awaited
 * questions), pass the phone number and every answer as CLI args instead:
 *   npm run ivr:simulate -w @kisansetu/api -- +917910000001 1 500 1 1 1 1 1 1
 * It still falls back to prompting interactively for anything the arg list
 * runs out of.
 *
 * Every prompt is also spoken aloud, in the correct language, using
 * Microsoft Edge's free "Read Aloud" text-to-speech service (via the
 * `node-edge-tts` package) — the same neural voices Edge's own browser
 * feature uses, reachable with no Microsoft account, no API key, and no
 * Edge/Windows dependency. This exists because this project's actual
 * production TTS (Bhashini — see services/voice/bhashiniProvider.ts) needs
 * an approved API key; this is a stand-in for local demoing before that
 * approval lands, not a replacement for it — Bhashini is still what the real
 * app (and a real phone call, eventually) should use.
 *
 * Set IVR_SIMULATOR_SPEAK=0 to disable audio and just print. Needs network
 * access to Microsoft's TTS endpoint; a network failure only disables audio
 * for that turn; the call keeps going either way.
 *
 * Barge-in: when you're actually typing (not pre-supplying answers via CLI
 * args), the prompt to enter digits appears immediately — you don't have to
 * wait for the audio to finish, exactly like a real call, and answering
 * early cuts the remaining audio off. Pre-supplied/scripted runs skip this
 * (each prompt plays out fully) so a recorded demo isn't cut short.
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { EdgeTTS } from 'node-edge-tts';

const API_URL = process.env.IVR_SIMULATOR_API_URL ?? 'http://localhost:4000';
const SPEAK_ALOUD = process.env.IVR_SIMULATOR_SPEAK !== '0';

/** Microsoft neural voices for the app's five languages, Indian locale. */
const EDGE_VOICE_BY_LANGUAGE_PREFIX: Record<string, string> = {
  en: 'en-IN-NeerjaNeural',
  ta: 'ta-IN-PallaviNeural',
  kn: 'kn-IN-SapnaNeural',
  hi: 'hi-IN-SwaraNeural',
  ml: 'ml-IN-SobhanaNeural',
};

interface SpokenVerse {
  languageTag: string; // e.g. "ta-IN", from the TwiML <Say language="...">
  text: string;
}

function extractVerses(twiml: string): SpokenVerse[] {
  return [...twiml.matchAll(/<Say language="([^"]*)"[^>]*>([\s\S]*?)<\/Say>/g)].map((match) => ({
    languageTag: match[1] ?? 'en-IN',
    text: match[2]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  }));
}

function isStillGathering(twiml: string): boolean {
  return twiml.includes('<Gather');
}

/**
 * Plays a local audio file (Windows only, via WPF's MediaPlayer — unlike
 * System.Media.SoundPlayer, this plays MP3 directly). Never throws: a
 * playback failure just means this turn stays silent. Exposes `cancel()` so
 * a caller "pressing a key" mid-sentence can kill it immediately (barge-in).
 */
function playAudioFile(path: string): { done: Promise<void>; cancel: () => void } {
  if (process.platform !== 'win32') return { done: Promise.resolve(), cancel: () => undefined };

  const script = `
try {
  Add-Type -AssemblyName PresentationCore
  $player = New-Object System.Windows.Media.MediaPlayer
  $player.Open([Uri]::new('${path.replace(/'/g, "''")}'))
  $player.Play()
  Start-Sleep -Milliseconds 400
  $deadline = (Get-Date).AddSeconds(20)
  while (-not $player.NaturalDuration.HasTimeSpan -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if ($player.NaturalDuration.HasTimeSpan) {
    Start-Sleep -Milliseconds ([int]$player.NaturalDuration.TimeSpan.TotalMilliseconds + 300)
  } else {
    Start-Sleep -Seconds 4
  }
  $player.Close()
} catch {}
`.trim();

  const child: ChildProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
  });
  const done = new Promise<void>((resolve) => {
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
  return { done, cancel: () => child.kill() };
}

/**
 * Speaks every verse of one turn in sequence, in the background — the
 * caller gets a handle back immediately rather than waiting. `cancel()`
 * stops whichever verse is currently playing and skips the rest.
 */
function startSpeaking(
  verses: SpokenVerse[],
  tempDir: string,
  turnIndex: number,
): { done: Promise<void>; cancel: () => void } {
  let cancelled = false;
  let cancelCurrent: (() => void) | null = null;

  const done = (async () => {
    for (const [i, verse] of verses.entries()) {
      if (cancelled) return;
      if (!SPEAK_ALOUD || !verse.text.trim()) continue;

      const prefix = verse.languageTag.split('-')[0]!.toLowerCase();
      const voice = EDGE_VOICE_BY_LANGUAGE_PREFIX[prefix];
      if (!voice) continue; // an unsupported language just stays print-only

      const outputPath = join(tempDir, `verse-${turnIndex}-${i}.mp3`);
      try {
        const tts = new EdgeTTS({ voice, lang: verse.languageTag });
        await tts.ttsPromise(verse.text, outputPath);
        if (cancelled) return;

        const playback = playAudioFile(outputPath);
        cancelCurrent = playback.cancel;
        await playback.done;
      } catch (error) {
        console.error(`  (voice unavailable for ${verse.languageTag}: ${(error as Error).message})`);
      } finally {
        await rm(outputPath, { force: true }).catch(() => undefined);
      }
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      cancelCurrent?.();
    },
  };
}

async function postTurn(callSid: string, from: string, digits: string | null): Promise<string> {
  const body = new URLSearchParams({
    CallSid: callSid,
    From: from,
    To: '+10000000000',
    CallStatus: digits === null ? 'ringing' : 'in-progress',
  });
  if (digits !== null) body.set('Digits', digits);

  const response = await fetch(`${API_URL}/api/ivr/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`IVR webhook returned HTTP ${response.status}. Is the API dev server running?`);
  }
  return response.text();
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const queuedAnswers = [...process.argv.slice(2)];

  const tempDir = SPEAK_ALOUD ? await mkdtemp(join(tmpdir(), 'ivr-sim-')) : null;

  console.log('--- ProcureMintra IVR call simulator (no Twilio needed) ---');
  console.log(`Talking to ${API_URL}/api/ivr/voice`);
  console.log('This only works for a phone number that matches a VERIFIED farmer account.');
  if (SPEAK_ALOUD) console.log('Speaking aloud via Microsoft Edge\'s free TTS (needs network access).');
  console.log('');

  // The phone number is always read before anything can be speaking yet, so
  // there is nothing to barge in on for this one prompt.
  const from = (queuedAnswers.shift() ?? (await rl.question("Calling farmer's phone number (E.164, e.g. +917910000001): "))).trim();
  const callSid = `CASIM${randomBytes(8).toString('hex')}`;

  let digits: string | null = null;
  let turn = 0;
  try {
    for (;;) {
      const twiml = await postTurn(callSid, from, digits);
      const verses = extractVerses(twiml);
      console.log(`\nIVR: ${verses.map((verse) => verse.text).join(' ')}\n`);

      const speech = tempDir ? startSpeaking(verses, tempDir, turn) : null;
      turn += 1;

      if (!isStillGathering(twiml)) {
        await speech?.done; // let the final line finish before the process exits
        console.log('--- call ended ---');
        break;
      }

      if (queuedAnswers.length > 0) {
        // Scripted run: play this prompt out fully before moving on.
        await speech?.done;
        digits = queuedAnswers.shift()!.trim();
      } else {
        // Real typing: the prompt is available immediately; answering early
        // is barge-in and cuts off whatever is still playing.
        digits = (await rl.question('Press digits: ')).trim();
        speech?.cancel();
      }
    }
  } finally {
    rl.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('Simulator failed:', error);
  process.exitCode = 1;
});
