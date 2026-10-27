import { describe, expect, it } from 'vitest';
import type { HubLinhaItem } from '../../../types';
import { currentPeriodo, groupByWeek } from '../linhaWeeks';

function item(id: string, data: string | null): HubLinhaItem {
  return { id, data, tipo: 'feed', titulo: `Post ${id}`, direcao: '', valores: {} };
}

describe('groupByWeek', () => {
  const itens = [
    item('a', '2026-11-03'),
    item('b', '2026-11-04'),
    item('c', '2026-11-06'),
    item('d', '2026-11-09'),
    item('e', '2026-11-30'),
    item('f', null),
  ];

  it('groups Nov 2026 by Sunday-to-Saturday week, undated last', () => {
    const groups = groupByWeek(itens, '2026-11-01');
    expect(groups.map((g) => g.label)).toEqual([
      'Semana de 1 a 7 de novembro',
      'Semana de 8 a 14 de novembro',
      'Semana de 29 a 30 de novembro',
      'Sem data',
    ]);
    expect(groups.map((g) => g.itens.map((i) => i.id))).toEqual([
      ['a', 'b', 'c'],
      ['d'],
      ['e'],
      ['f'],
    ]);
  });

  it('clips the first and last week to the month', () => {
    // Dec 2026 starts on a Tuesday and ends on a Thursday.
    const groups = groupByWeek([item('x', '2026-12-01'), item('y', '2026-12-31')], '2026-12-01');
    expect(groups.map((g) => g.label)).toEqual([
      'Semana de 1 a 5 de dezembro',
      'Semana de 27 a 31 de dezembro',
    ]);
  });

  it('keeps the input order inside a week and omits Sem data when every item is dated', () => {
    const groups = groupByWeek([item('b', '2026-11-04'), item('a', '2026-11-03')], '2026-11-01');
    expect(groups).toHaveLength(1);
    expect(groups[0].itens.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('returns nothing for an empty plan', () => {
    expect(groupByWeek([], '2026-11-01')).toEqual([]);
  });

  it('lets the caller render the labels', () => {
    const groups = groupByWeek(itens, '2026-11-01', (w) =>
      w.semData ? 'none' : `${w.inicio}-${w.fim}/${w.mes}`,
    );
    expect(groups.map((g) => g.label)).toEqual(['1-7/10', '8-14/10', '29-30/10', 'none']);
  });
});

describe('currentPeriodo', () => {
  it('uses the Sao Paulo month, not the UTC one', () => {
    // 02:00 UTC on Dec 1 is still Nov 30 in Sao Paulo.
    expect(currentPeriodo(new Date('2026-12-01T02:00:00Z'))).toBe('2026-11-01');
    expect(currentPeriodo(new Date('2026-12-01T04:00:00Z'))).toBe('2026-12-01');
  });
});
