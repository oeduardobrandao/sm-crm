import { describe, expect, it } from 'vitest';
import { matchBrandFont, normalizeFontName, type MatchableFamily } from '@mesaas/fonts/match';
import familiesJson from '../scripts/fonts/families.json';

// Uses the real curated catalog (scripts/fonts/families.json) rather than synthetic fixtures —
// the matcher's tiers (exact/prefix/fuzzy ambiguity) depend on the actual name/alias overlaps
// across all 26 families, and a hand-picked mini-catalog could hide collisions that only show
// up against the real set.
const FAMILIES: MatchableFamily[] = familiesJson.families.map((f) => ({
  key: f.key,
  name: f.name,
  aliases: f.aliases,
}));

describe('normalizeFontName', () => {
  it('lowercases, strips diacritics, and strips everything but a-z0-9', () => {
    expect(normalizeFontName('DM Sans')).toBe('dmsans');
    expect(normalizeFontName('dm-sans')).toBe('dmsans');
    expect(normalizeFontName('dmsans')).toBe('dmsans');
    expect(normalizeFontName('Dm Sâns')).toBe('dmsans');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeFontName('   ')).toBe('');
  });
});

describe('matchBrandFont — T1 exact', () => {
  it('matches on the normalized display name', () => {
    expect(matchBrandFont('Playfair Display', FAMILIES)).toBe('playfair-display');
  });

  it('matches on the normalized key, case-insensitively', () => {
    expect(matchBrandFont('DM SANS', FAMILIES)).toBe('dm-sans');
  });

  it('matches on an alias', () => {
    expect(matchBrandFont('playfair', FAMILIES)).toBe('playfair-display');
    expect(matchBrandFont('Bebas', FAMILIES)).toBe('bebas-neue');
  });

  it('ignores diacritics and punctuation noise', () => {
    expect(matchBrandFont('Dm Sâns', FAMILIES)).toBe('dm-sans');
    expect(matchBrandFont('bebas neue', FAMILIES)).toBe('bebas-neue');
  });
});

describe('matchBrandFont — T2 unique prefix', () => {
  it('matches a partial word that uniquely prefixes one family', () => {
    expect(matchBrandFont('Cormo', FAMILIES)).toBe('cormorant-garamond');
    expect(matchBrandFont('Instr', FAMILIES)).toBe('instrument-serif');
  });

  it('matches when the full alias is a prefix of a longer query', () => {
    expect(matchBrandFont('dm serif', FAMILIES)).toBe('dm-serif-display');
  });

  it('returns null when the prefix is ambiguous across families', () => {
    // "dms" prefixes both "dmserifdisplay" (dm-serif-display) and "dmsans" (dm-sans).
    expect(matchBrandFont('dms', FAMILIES)).toBeNull();
    expect(matchBrandFont('DMS', FAMILIES)).toBeNull();
  });
});

describe('matchBrandFont — T3 fuzzy (edit distance <= 2, query length >= 5)', () => {
  it('matches a single-character typo of a unique family name', () => {
    expect(matchBrandFont('Motserrat', FAMILIES)).toBe('montserrat');
  });

  it('does not apply fuzzy matching below the length-5 floor', () => {
    // "anon" is edit-distance 1 from "anton" but only 4 chars normalized — too short to risk
    // a fuzzy guess, so this must fall through to null rather than matching Anton.
    expect(matchBrandFont('anon', FAMILIES)).toBeNull();
  });
});

describe('matchBrandFont — no match', () => {
  it('returns null for empty or whitespace-only input', () => {
    expect(matchBrandFont('', FAMILIES)).toBeNull();
    expect(matchBrandFont('   ', FAMILIES)).toBeNull();
  });

  it('returns null for input unrelated to any family', () => {
    expect(matchBrandFont('xyz123nonsense', FAMILIES)).toBeNull();
  });

  it('never guesses between multiple exact candidates across families', () => {
    // Two distinct families in the catalog should never normalize to the same exact name —
    // this guards the invariant, not a real collision in the current 26-family set.
    const dupedFamilies: MatchableFamily[] = [
      { key: 'family-a', name: 'Shared Name', aliases: [] },
      { key: 'family-b', name: 'Shared Name', aliases: [] },
    ];
    expect(matchBrandFont('Shared Name', dupedFamilies)).toBeNull();
  });
});
