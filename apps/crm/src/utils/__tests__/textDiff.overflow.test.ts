import { describe, expect, it } from 'vitest';
import { diffWords } from '../textDiff';

function decode(diffs: [number, string][]): { orig: string; sugg: string } {
  let orig = '';
  let sugg = '';
  for (const [op, text] of diffs) {
    if (op <= 0) orig += text;
    if (op >= 0) sugg += text;
  }
  return { orig, sugg };
}

// diffWords encodes each distinct token as one UTF-16 code unit. Past 65536 total distinct
// tokens, String.fromCharCode wraps (String.fromCharCode(65536) === String.fromCharCode(0)),
// which would silently collide a later token's code with an earlier one and corrupt the
// decoded text. These reconstruct the full original/suggested text from the diff output and
// assert it round-trips exactly, at volumes that exercise both the per-text budget bail-out
// and the combined 65536 ceiling.
describe('diffWords token-budget overflow', () => {
  it('does not corrupt text when text1 has > 40000 distinct tokens', () => {
    const words = Array.from({ length: 45000 }, (_, i) => `tok${i}`);
    const original = words.join(' ') + ' TAIL_ORIG';
    const suggested = 'tok0 tok1 TAIL_SUGG';

    const diffs = diffWords(original, suggested);
    const { orig, sugg } = decode(diffs);

    expect(orig).toBe(original);
    expect(sugg).toBe(suggested);
  });

  it('does not corrupt text when combined distinct tokens exceed 65536', () => {
    const wordsA = Array.from({ length: 39000 }, (_, i) => `a${i}`);
    const wordsB = Array.from({ length: 39000 }, (_, i) => `b${i}`);
    const original = wordsA.join(' ') + ' ORIG_MARKER';
    const suggested = wordsB.join(' ') + ' SUGG_MARKER';

    const diffs = diffWords(original, suggested);
    const { orig, sugg } = decode(diffs);

    expect(orig).toBe(original);
    expect(sugg).toBe(suggested);
  });
});
