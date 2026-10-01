import { describe, expect, it } from 'vitest';
import {
  bulkResultMessage,
  groupCheckState,
  runBulk,
  toggleGroup,
  toggleOne,
  visibleSelection,
} from '../kb-bulk';

describe('runBulk', () => {
  it('runs every item and counts failures without stopping', async () => {
    const seen: number[] = [];
    const result = await runBulk([1, 2, 3], async (id) => {
      seen.push(id);
      if (id === 2) throw new Error('nope');
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(result).toEqual({ ok: 2, failed: 1 });
  });
});

describe('bulkResultMessage', () => {
  it('pluralises and mentions failures only when there are any', () => {
    expect(bulkResultMessage('published', { ok: 1, failed: 0 })).toBe('1 item publicado.');
    expect(bulkResultMessage('draft', { ok: 3, failed: 0 })).toBe('3 itens despublicados.');
    expect(bulkResultMessage('published', { ok: 2, failed: 2 })).toBe(
      '2 itens publicados. 2 falharam.',
    );
    expect(bulkResultMessage('draft', { ok: 0, failed: 1 })).toBe(
      'Nenhum item alterado. 1 falhou.',
    );
  });
});

describe('selection helpers', () => {
  it('visibleSelection keeps list order and drops hidden ids', () => {
    expect(visibleSelection(new Set(['c', 'a', 'x']), ['a', 'b', 'c'])).toEqual(['a', 'c']);
  });

  it('groupCheckState reports none, some and all', () => {
    expect(groupCheckState(new Set<number>(), [1, 2])).toBe(false);
    expect(groupCheckState(new Set([1]), [1, 2])).toBe('indeterminate');
    expect(groupCheckState(new Set([1, 2, 9]), [1, 2])).toBe(true);
  });

  it('toggleGroup fills a partial group and clears a full one, leaving other ids alone', () => {
    expect([...toggleGroup(new Set([1, 9]), [1, 2])].sort()).toEqual([1, 2, 9]);
    expect([...toggleGroup(new Set([1, 2, 9]), [1, 2])]).toEqual([9]);
  });

  it('toggleOne flips a single id', () => {
    expect([...toggleOne(new Set([1]), 2)].sort()).toEqual([1, 2]);
    expect([...toggleOne(new Set([1, 2]), 1)]).toEqual([2]);
  });
});
