// Brand-font fuzzy matcher (docs/estudio-design.md §7 "Brand matching"). Resolves a client's
// free-text brand font name (hub_brand.font_primary/font_secondary — user-typed, no
// validation) to a curated manifest key, or null on no/ambiguous match — NEVER guesses.
//
// Deliberately import-free (no imports, not even type-only) so this module can be consumed
// identically from the CRM (via the @mesaas/fonts alias) and from Deno edge functions without
// any resolution machinery — it operates on a minimal inline shape, not the full FontFamily
// type from types.ts.

export interface MatchableFamily {
  key: string;
  name: string;
  aliases: string[];
}

// Combining-diacritical-marks range (U+0300-U+036F), built from character codes rather than a
// \uXXXX regex escape literal — keeps the exact codepoints unambiguous in source regardless of
// how any intermediate text-handling layer treats escape sequences embedded in a string.
const COMBINING_MARKS_RE = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, "g");

/** Lowercase, strip diacritics, strip everything but a-z0-9 — "DM Sans", "dm-sans", "dmsans"
 * and "Dm Sâns" all normalize identically. */
export function normalizeFontName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "")
    .replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Resolves a free-text brand font name to a manifest key.
 * T1: exact match (normalized) against key, display name, or any alias.
 * T2: unique prefix match — the normalized query is a prefix of, or is prefixed by, a
 *     candidate's normalized name (e.g. "Playfair" -> "Playfair Display").
 * T3: unique fuzzy match within edit-distance 2, only for queries of normalized length >= 5
 *     (short strings produce too many spurious close matches).
 * Any tier with more than one candidate returns null rather than guessing between them.
 */
export function matchBrandFont(rawName: string, families: MatchableFamily[]): string | null {
  const query = normalizeFontName(rawName);
  if (!query) return null;

  const candidateNames = (f: MatchableFamily): string[] => [f.key, f.name, ...f.aliases].map(normalizeFontName);

  // T1 — exact.
  const exact = families.filter((f) => candidateNames(f).includes(query));
  if (exact.length === 1) return exact[0].key;
  if (exact.length > 1) return null; // ambiguous exact match across families — should not happen, but never guess

  // T2 — unique prefix (either direction).
  const prefixMatches = families.filter((f) =>
    candidateNames(f).some((name) => name.startsWith(query) || query.startsWith(name))
  );
  if (prefixMatches.length === 1) return prefixMatches[0].key;
  if (prefixMatches.length > 1) return null;

  // T3 — unique fuzzy match, guarded by a minimum query length to avoid noisy short-string matches.
  if (query.length >= 5) {
    const fuzzyMatches = families.filter((f) => candidateNames(f).some((name) => levenshtein(query, name) <= 2));
    if (fuzzyMatches.length === 1) return fuzzyMatches[0].key;
  }

  return null;
}
