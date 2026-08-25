import { describe, expect, it } from 'vitest';
import { computeWordDiff } from '../textDiff';

describe('computeWordDiff', () => {
  it('returns a single equal segment for identical strings', () => {
    const result = computeWordDiff('hello world', 'hello world');
    expect(result).toEqual([{ type: 'equal', text: 'hello world' }]);
  });

  it('detects inserted text', () => {
    const result = computeWordDiff('hello', 'hello world');
    const insert = result.find((s) => s.type === 'insert');
    expect(insert).toBeDefined();
    expect(insert!.text).toContain('world');
  });

  it('detects deleted text', () => {
    const result = computeWordDiff('hello world', 'hello');
    const del = result.find((s) => s.type === 'delete');
    expect(del).toBeDefined();
    expect(del!.text).toContain('world');
  });

  it('detects replacements as delete + insert', () => {
    const result = computeWordDiff('gato preto', 'gato branco');
    const types = result.map((s) => s.type);
    expect(types).toContain('delete');
    expect(types).toContain('insert');
    expect(result.find((s) => s.type === 'equal')?.text).toContain('gato');
  });

  it('handles empty original', () => {
    const result = computeWordDiff('', 'novo texto');
    expect(result).toEqual([{ type: 'insert', text: 'novo texto' }]);
  });

  it('handles empty suggested', () => {
    const result = computeWordDiff('texto antigo', '');
    expect(result).toEqual([{ type: 'delete', text: 'texto antigo' }]);
  });

  it('handles both empty', () => {
    const result = computeWordDiff('', '');
    expect(result).toEqual([]);
  });

  it('replaces the whole word when only part of it changed, instead of chopping mid-word', () => {
    // "acneico" -> "antiacne" share the substring "a" + "cne", so a raw character diff
    // splits it into "a[+ntia]cne[-ico]" -- unreadable. A correction touching any part of a
    // word must show as a clean whole-word swap.
    const result = computeWordDiff('Sabonete acneico.', 'Sabonete antiacne.');
    expect(result).toEqual([
      { type: 'equal', text: 'Sabonete ' },
      { type: 'delete', text: 'acneico' },
      { type: 'insert', text: 'antiacne' },
      { type: 'equal', text: '.' },
    ]);
  });

  it('does not split a single-character case fix into per-character diffs', () => {
    const result = computeWordDiff('LA ROCHE', 'La Roche');
    expect(result).toEqual([
      { type: 'delete', text: 'LA ROCHE' },
      { type: 'insert', text: 'La Roche' },
    ]);
  });

  it('keeps a decomposed-Unicode accent attached to its base letter', () => {
    // NFD (decomposed) text -- common in pasted content -- spells the "a with tilde" sound as
    // base letter "a" (U+0061) plus a separate combining tilde (U+0303), instead of the
    // single precomposed character (U+00E3). Built via String.fromCharCode so the test
    // doesn't depend on which form a literal accented character in this source file would be
    // saved as. Without \p{M} in the token class, that combining mark falls into the
    // "everything else" bucket, splitting the base letter from its own accent and
    // reproducing the mid-word chopping this function exists to avoid.
    const combiningTilde = String.fromCharCode(0x0303);
    const original = `a${combiningTilde}e`;
    const suggested = `a${combiningTilde}os`;
    expect(original.normalize('NFC')).not.toBe(original); // sanity-check: really is decomposed

    const result = computeWordDiff(original, suggested);
    expect(result).toEqual([
      { type: 'delete', text: original },
      { type: 'insert', text: suggested },
    ]);
  });
});
