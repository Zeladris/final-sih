/**
 * Minimal TwiML (Twilio's call-control XML) builder (Phase 9 IVR).
 *
 * Hand-written rather than the `twilio` npm SDK: everything this feature
 * needs is `<Say>`, `<Gather>` and `<Hangup>` — a few string templates — and
 * the SDK's own REST client is unused weight neither this file nor
 * twilioSignature.ts needs (§ minimal dependencies, matching the rest of the
 * API's preference for `fetch` over provider SDKs — see weatherProvider.ts).
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const DEFAULT_LANGUAGE_TAG = 'en-IN';

/** Text content only — this never writes into an XML attribute. */
export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function say(text: string, languageTag: string): string {
  return `<Say language="${escapeXml(languageTag)}">${escapeXml(text)}</Say>`;
}

/**
 * A spoken prompt that collects DTMF digits and posts them back to
 * `actionPath`. Twilio calls `actionPath` both when the caller finishes
 * entering digits AND on a silent timeout (with no `Digits` at all) — so
 * every step's retry/timeout handling is the same "was Digits usable?"
 * branch in ivrService.ts, never a second TwiML path here.
 */
export function gatherDigits(options: {
  prompt: string;
  actionPath: string;
  languageTag?: string;
  numDigits?: number;
  finishOnKey?: string;
  timeoutSeconds?: number;
}): string {
  const {
    prompt,
    actionPath,
    languageTag = DEFAULT_LANGUAGE_TAG,
    numDigits,
    finishOnKey,
    timeoutSeconds = 6,
  } = options;
  const attrs = [
    'input="dtmf"',
    `action="${escapeXml(actionPath)}"`,
    'method="POST"',
    `timeout="${timeoutSeconds}"`,
    numDigits !== undefined ? `numDigits="${numDigits}"` : null,
    finishOnKey !== undefined ? `finishOnKey="${escapeXml(finishOnKey)}"` : null,
  ]
    .filter((attr): attr is string => attr !== null)
    .join(' ');

  return `${XML_HEADER}<Response><Gather ${attrs}>${say(prompt, languageTag)}</Gather></Response>`;
}

/**
 * Like `gatherDigits`, but each line of the prompt can be spoken in its own
 * language — used only for the very first menu, where the caller's language
 * isn't known yet (see ivrPrompts.ts's LANGUAGE_MENU).
 */
export function gatherDigitsMultiLanguage(options: {
  verses: Array<{ text: string; languageTag: string }>;
  actionPath: string;
  numDigits?: number;
  timeoutSeconds?: number;
}): string {
  const { verses, actionPath, numDigits, timeoutSeconds = 8 } = options;
  const attrs = [
    'input="dtmf"',
    `action="${escapeXml(actionPath)}"`,
    'method="POST"',
    `timeout="${timeoutSeconds}"`,
    numDigits !== undefined ? `numDigits="${numDigits}"` : null,
  ]
    .filter((attr): attr is string => attr !== null)
    .join(' ');

  const spoken = verses.map((verse) => say(verse.text, verse.languageTag)).join('');
  return `${XML_HEADER}<Response><Gather ${attrs}>${spoken}</Gather></Response>`;
}

/** Ends the call after one final spoken line. */
export function sayAndHangup(prompt: string, languageTag: string = DEFAULT_LANGUAGE_TAG): string {
  return `${XML_HEADER}<Response>${say(prompt, languageTag)}<Hangup/></Response>`;
}
