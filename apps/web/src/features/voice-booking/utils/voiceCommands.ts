const AFFIRMATIVE = [/\byes\b/i, /\bconfirm\b/i, /\bok(ay)?\b/i, /ஆம்/, /உறுதி/, /சரி/];

/** "yes" / "confirm" / "ஆம்" / "உறுதி", in either language (§22). */
export function isAffirmative(transcript: string): boolean {
  return AFFIRMATIVE.some((pattern) => pattern.test(transcript));
}

const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

/**
 * Matches a spoken answer against a short visible list — "Centre A", "the
 * first one", "one" — by name or by position (§19–§21). Never invents a
 * choice: a transcript matching nothing, or matching more than one item
 * ambiguously by substring, returns `null` and the caller falls back to the
 * visual list, which is always present alongside voice (§28).
 */
export function matchByNameOrOrdinal<T>(
  transcript: string,
  items: readonly T[],
  nameOf: (item: T) => string,
): T | null {
  const needle = transcript.trim().toLowerCase();
  if (!needle || items.length === 0) return null;

  const byName = items.filter((item) => nameOf(item).toLowerCase().includes(needle));
  if (byName.length === 1) return byName[0]!;

  const digitMatch = needle.match(/\d+/);
  if (digitMatch) {
    const index = Number.parseInt(digitMatch[0], 10) - 1;
    if (index >= 0 && index < items.length) return items[index]!;
  }

  const ordinalIndex = ORDINAL_WORDS.findIndex((word) => needle.includes(word));
  if (ordinalIndex >= 0 && ordinalIndex < items.length) return items[ordinalIndex]!;

  return null;
}
