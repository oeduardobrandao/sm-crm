import { describe, expect, it } from 'vitest';
import type { AgendaItem } from '../todayAgenda';
import { countPerDay, groupAgendaItems, oldestOverdueDays } from '../todayGroups';

const NOW = new Date(2026, 7, 17, 23, 30, 0);
const LABELS = { semCliente: 'Sem cliente', semResponsavel: 'Sem responsável' };

function item(over: Partial<AgendaItem>): AgendaItem {
  return {
    key: over.key ?? Math.random().toString(36),
    kind: 'tarefa',
    bucket: 'atrasado',
    title: 'Item',
    context: '',
    when: new Date(2026, 7, 10),
    href: '/',
    responsavel: null,
    cliente: null,
    badge: null,
    ...over,
  };
}

describe('groupAgendaItems', () => {
  it('groups by client, biggest first, with the catch-all last', () => {
    const items = [
      item({ key: 'a1', cliente: { id: 1, nome: 'Alfa' } }),
      item({ key: 'x', cliente: null }),
      item({ key: 'b1', cliente: { id: 2, nome: 'Beta' } }),
      item({ key: 'b2', cliente: { id: null, nome: 'Beta' } }),
    ];
    const groups = groupAgendaItems(items, 'cliente', LABELS);
    expect(groups.map((g) => g.label)).toEqual(['Beta', 'Alfa', 'Sem cliente']);
    expect(groups[0].items.map((i) => i.key)).toEqual(['b1', 'b2']);
    expect(groups[0].clienteId).toBe(2);
    expect(groups[2].rest).toBe(true);
  });

  it('breaks ties on the earliest deadline', () => {
    const groups = groupAgendaItems(
      [
        item({ cliente: { id: 1, nome: 'Alfa' }, when: new Date(2026, 7, 12) }),
        item({ cliente: { id: 2, nome: 'Beta' }, when: new Date(2026, 7, 9) }),
      ],
      'cliente',
      LABELS,
    );
    expect(groups.map((g) => g.label)).toEqual(['Beta', 'Alfa']);
  });

  it('groups by responsible', () => {
    const groups = groupAgendaItems(
      [
        item({ responsavel: { id: 10, nome: 'Ana' } }),
        item({ responsavel: null }),
        item({ responsavel: { id: 10, nome: 'Ana' } }),
      ],
      'responsavel',
      LABELS,
    );
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['Ana', 2],
      ['Sem responsável', 1],
    ]);
  });

  it('groups by local day in date order, undated last', () => {
    const groups = groupAgendaItems(
      [
        item({ when: new Date(2026, 7, 20, 18) }),
        item({ when: null }),
        item({ when: new Date(2026, 7, 19, 9) }),
        item({ when: new Date(2026, 7, 20, 8) }),
      ],
      'dia',
      LABELS,
    );
    expect(groups.map((g) => (g.day ? g.day.getDate() : null))).toEqual([19, 20, null]);
    expect(groups[1].items).toHaveLength(2);
  });
});

describe('oldestOverdueDays', () => {
  it('counts local days back to the oldest dated item', () => {
    expect(
      oldestOverdueDays([item({ when: new Date(2026, 7, 14) }), item({ when: null })], NOW),
    ).toBe(3);
    expect(oldestOverdueDays([item({ when: null })], NOW)).toBe(0);
  });
});

describe('countPerDay', () => {
  it('counts tomorrow through day N', () => {
    const counts = countPerDay(
      [
        item({ when: new Date(2026, 7, 18, 1) }),
        item({ when: new Date(2026, 7, 18, 22) }),
        item({ when: new Date(2026, 7, 24) }),
        item({ when: new Date(2026, 7, 17) }),
        item({ when: null }),
      ],
      NOW,
      7,
    );
    expect(counts).toEqual([2, 0, 0, 0, 0, 0, 1]);
  });
});
