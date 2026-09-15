/**
 * Prepares a caller-supplied search term for interpolation into a PostgREST
 * `.ilike()`/`.or()` filter.
 *
 * Two distinct risks, both closed here:
 *   1. `.or()` builds a filter EXPRESSION as a string — a `,` starts a new
 *      condition and `()` groups conditions, so an unescaped search term can
 *      inject additional filter clauses rather than just being matched
 *      against (still bounded by the caller's own RLS-scoped rows, but a
 *      real defect: a search value the app never intended becomes filter
 *      syntax).
 *   2. `%`/`_` are ILIKE wildcards — left alone, a search for "50%" would
 *      match anything, not the literal string "50%".
 *
 * Stripping rather than escaping: PostgREST's simple filter strings have no
 * caller-usable escape sequence for `,`/`()`  without switching to a
 * different query-building API, and a search box has no real need for those
 * characters to be significant — dropping them costs nothing a user would
 * notice and closes the injection outright.
 */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%_]/g, ' ').trim();
}
