import { describe, expect, it } from 'vitest';
import { computeWordDiff, diffWords } from './index';

describe('@mesaas/text-diff', () => {
  it('never splits a word: every insert/delete segment is made of whole tokens', () => {
    const segments = computeWordDiff('acneico funciona', 'antiacne funciona');
    const changed = segments.filter((s) => s.type !== 'equal').map((s) => s.text);
    expect(changed).toEqual(['acneico', 'antiacne']);
    expect(segments.at(-1)).toEqual({ type: 'equal', text: ' funciona' });
  });

  it('round-trips: equal+delete segments rebuild the original, equal+insert rebuild the new text', () => {
    const a = 'Lançamento da coleção de inverno, confira!';
    const b = 'Lançamento da nova coleção de verão. Confira!';
    const segments = computeWordDiff(a, b);
    expect(
      segments
        .filter((s) => s.type !== 'insert')
        .map((s) => s.text)
        .join(''),
    ).toBe(a);
    expect(
      segments
        .filter((s) => s.type !== 'delete')
        .map((s) => s.text)
        .join(''),
    ).toBe(b);
  });

  it('exposes the raw diff-match-patch tuples', () => {
    expect(diffWords('a', 'a')).toEqual([[0, 'a']]);
  });
});
