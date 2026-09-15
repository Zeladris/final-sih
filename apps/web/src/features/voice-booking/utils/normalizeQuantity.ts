/**
 * Spoken quantity → kilograms, or `null` when nothing readable was said
 * (§10). Never guessed silently: the caller reads the number back to the
 * farmer for a yes/no before it is stored (§10, §6).
 */

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/**
 * A modest English number-word parser ("five hundred", "two hundred fifty").
 * Tamil is not parsed as words here: browser speech recognition for Tamil
 * consistently transcribes spoken numbers as Arabic numerals already (the
 * digit-extraction pass below handles it), so a Tamil word parser would be
 * dead code rather than a real capability — stated honestly instead of
 * pretending full coverage.
 */
function wordsToNumber(text: string): number | null {
  const words = text
    .toLowerCase()
    .replace(/[,-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let total = 0;
  let current = 0;
  let matchedAny = false;

  for (const word of words) {
    if (word in ONES) {
      current += ONES[word]!;
      matchedAny = true;
    } else if (word in TENS) {
      current += TENS[word]!;
      matchedAny = true;
    } else if (word === 'hundred') {
      current = (current || 1) * 100;
      matchedAny = true;
    } else if (word === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
      matchedAny = true;
    }
    // Any other word (kilo, kilograms, kg, please, "about") is simply
    // skipped rather than treated as a parse failure.
  }

  return matchedAny ? total + current : null;
}

export function normalizeQuantity(transcript: string): number | null {
  const digitMatch = transcript.match(/\d+(\.\d+)?/);
  if (digitMatch) {
    const value = Number.parseFloat(digitMatch[0]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const fromWords = wordsToNumber(transcript);
  return fromWords !== null && fromWords > 0 ? fromWords : null;
}
