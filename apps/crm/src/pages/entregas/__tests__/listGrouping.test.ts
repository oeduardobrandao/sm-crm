import { describe, expect, it, vi } from 'vitest';
// listGrouping -> minhaFila -> store, que puxa o cliente supabase; o automock
// deixa o import inerte (mesmo motivo de minhaFila.test.ts).
vi.mock('../../../lib/supabase');
import {
  allGroupsCollapsed,
  countByResponsavel,
  groupListRows,
  toggleKey,
  type ListGroup,
  type ListGroupAccessors,
} from '../listGrouping';
import type { DeadlineInfo } from '../etapaPrazo';

// Fixed "now": quarta-feira 2026-09-30, 10:00 local.
const NOW = new Date(2026, 8, 30, 10, 0, 0);
const OK: DeadlineInfo = { diasRestantes: 1, horasRestantes: 0, estourado: false, urgente: false };
const LATE: DeadlineInfo = {
  diasRestantes: -1,
  horasRestantes: 0,
  estourado: true,
  urgente: false,
};
/** Data local `n` dias depois do dia de NOW, às `h` horas. */
const day = (n: number, h = 9) => new Date(2026, 8, 30 + n, h, 0, 0);

interface Row {
  id: string;
  prazo?: { date: Date | null; deadline: DeadlineInfo };
  postagem?: Date | null;
  cliente?: { id: number | null; nome: string };
  resp?: { id: number | null; nome: string };
  etapa?: string;
}

const acc: ListGroupAccessors<Row> = {
  prazo: (r) => r.prazo,
  postagem: (r) => r.postagem ?? null,
  cliente: (r) => r.cliente ?? { id: null, nome: '' },
  responsavel: (r) => r.resp ?? { id: null, nome: '' },
  etapa: (r) => r.etapa ?? '',
};

const summary = (groups: ListGroup<Row>[]) =>
  groups.map((g) => [g.label, g.sub ?? null, g.rows.map((r) => r.id)]);

describe('groupListRows', () => {
  it('prazo: Atrasado, Hoje, Amanhã, um grupo por dia da semana até +7, Depois, Sem prazo', () => {
    const rows: Row[] = [
      { id: 'a', prazo: { date: day(8), deadline: OK } },
      { id: 'b', prazo: { date: day(0), deadline: LATE } },
      { id: 'c', prazo: { date: day(2), deadline: OK } },
      { id: 'd' },
      { id: 'e', prazo: { date: day(1), deadline: OK } },
      { id: 'f', prazo: { date: day(0, 18), deadline: OK } },
      { id: 'g', prazo: { date: day(7), deadline: OK } },
      { id: 'h', prazo: { date: day(-2), deadline: OK } },
      { id: 'i', prazo: { date: day(2, 15), deadline: OK } },
    ];
    const groups = groupListRows(rows, 'prazo', acc, NOW);
    expect(summary(groups)).toEqual([
      ['Atrasado', null, ['b', 'h']],
      ['Hoje', null, ['f']],
      ['Amanhã', null, ['e']],
      ['Sexta-feira', '2 out', ['c', 'i']],
      ['Quarta-feira', '7 out', ['g']],
      ['Depois', null, ['a']],
      ['Sem prazo', null, ['d']],
    ]);
    expect(groups.map((g) => g.danger)).toEqual([true, false, false, false, false, false, false]);
    expect(groups[0].key).toBe('prazo:atrasado');
    expect(groups[3].key).toBe('prazo:dia:20261002');
  });

  it('postagem: passado vira "Data passada" (sem vermelho) e sem data vira "Sem data"', () => {
    const rows: Row[] = [
      { id: 'a', postagem: null },
      { id: 'b', postagem: day(-1, 20) },
      { id: 'c', postagem: day(0, 8) },
    ];
    const groups = groupListRows(rows, 'postagem', acc, NOW);
    expect(summary(groups)).toEqual([
      ['Data passada', null, ['b']],
      ['Hoje', null, ['c']],
      ['Sem data', null, ['a']],
    ]);
    expect(groups.every((g) => !g.danger)).toBe(true);
    expect(groups.map((g) => g.key)).toEqual([
      'postagem:atrasado',
      'postagem:hoje',
      'postagem:sem_prazo',
    ]);
  });

  it('postagem sem o acessor (Lista de Fluxos) agrupa por prazo', () => {
    const { postagem: _omit, ...semPostagem } = acc;
    const rows: Row[] = [{ id: 'a', prazo: { date: day(1), deadline: OK } }];
    const groups = groupListRows(rows, 'postagem', semPostagem, NOW);
    expect(summary(groups)).toEqual([['Amanhã', null, ['a']]]);
    expect(groups[0].key).toBe('prazo:amanha');
  });

  it('cliente: alfabético sem acento, "Sem cliente" por último, chave pelo id', () => {
    const rows: Row[] = [
      { id: 'a', cliente: { id: 2, nome: 'Beta' } },
      { id: 'b', cliente: { id: 1, nome: 'Álvaro' } },
      { id: 'c' },
      { id: 'd', cliente: { id: 2, nome: 'Beta' } },
    ];
    const groups = groupListRows(rows, 'cliente', acc, NOW);
    expect(summary(groups)).toEqual([
      ['Álvaro', null, ['b']],
      ['Beta', null, ['a', 'd']],
      ['Sem cliente', null, ['c']],
    ]);
    expect(groups.map((g) => g.key)).toEqual(['cliente:1', 'cliente:2', 'cliente:none']);
  });

  it('responsável: id sem nome vira "Sem nome"; sem id vai para "Sem responsável" no fim', () => {
    const rows: Row[] = [
      { id: 'a', resp: { id: 9, nome: '' } },
      { id: 'b' },
      { id: 'c', resp: { id: 7, nome: 'Ana' } },
    ];
    expect(summary(groupListRows(rows, 'responsavel', acc, NOW))).toEqual([
      ['Ana', null, ['c']],
      ['Sem nome', null, ['a']],
      ['Sem responsável', null, ['b']],
    ]);
  });

  it('etapa: alfabético, "Sem etapa" por último', () => {
    const rows: Row[] = [{ id: 'a', etapa: 'Design' }, { id: 'b' }, { id: 'c', etapa: 'Copy' }];
    expect(summary(groupListRows(rows, 'etapa', acc, NOW))).toEqual([
      ['Copy', null, ['c']],
      ['Design', null, ['a']],
      ['Sem etapa', null, ['b']],
    ]);
  });
});

describe('countByResponsavel', () => {
  it('conta por id e ignora quem não tem responsável', () => {
    expect(countByResponsavel([7, null, 7, 9, undefined])).toEqual(
      new Map([
        [7, 2],
        [9, 1],
      ]),
    );
  });
});

describe('toggleKey', () => {
  it('devolve um Set novo com a chave alternada', () => {
    const a = new Set(['x']);
    const b = toggleKey(a, 'y');
    expect([...b]).toEqual(['x', 'y']);
    expect([...toggleKey(b, 'x')]).toEqual(['y']);
    expect([...a]).toEqual(['x']);
  });
});

describe('allGroupsCollapsed', () => {
  it('só é verdade com todos os grupos visíveis recolhidos', () => {
    expect(allGroupsCollapsed([], new Set())).toBe(false);
    expect(allGroupsCollapsed(['a', 'b'], new Set(['a']))).toBe(false);
    // Uma chave de outro agrupamento no conjunto não atrapalha.
    expect(allGroupsCollapsed(['a', 'b'], new Set(['a', 'b', 'velho']))).toBe(true);
  });
});
