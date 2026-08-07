import { describe, expect, test } from 'vitest';
import { mapStatus, proposeMapping } from '../src/mapper';
import type { ImportBundle, ImportCollection } from '../src/types';

const col = (over: Partial<ImportCollection>): ImportCollection => ({
  id: 'x',
  name: 'x',
  source: 'csv',
  columns: [],
  listNames: [],
  rows: [],
  ...over,
});
const bundle = (...collections: ImportCollection[]): ImportBundle => ({
  source: 'csv',
  collections,
  warnings: [],
});

describe('proposeMapping', () => {
  test('email+phone columns classify as clientes with roles', () => {
    const p = proposeMapping(
      bundle(
        col({
          id: 'c',
          name: 'Contatos',
          columns: ['Nome', 'Email', 'Telefone', 'Valor'],
          rows: [
            {
              key: 'c:1',
              cells: { Nome: 'Ana', Email: 'a@x.com', Telefone: '11 9', Valor: '1500' },
            },
          ],
        }),
      ),
    );
    expect(p.collections[0]).toMatchObject({
      destination: 'clientes',
      columnRoles: { title: 'Nome', email: 'Email', phone: 'Telefone', monthlyValue: 'Valor' },
    });
  });

  test('dated rows classify as posts; lists with few dates as entregas', () => {
    const dated = col({
      id: 'p',
      name: 'Calendário',
      columns: ['Nome'],
      listNames: ['Rascunho', 'Aprovado'],
      rows: [
        { key: 'p:1', cells: { Nome: 'A' }, listName: 'Rascunho', dueDate: '2026-08-01T00:00:00Z' },
        { key: 'p:2', cells: { Nome: 'B' }, listName: 'Aprovado', dueDate: '2026-08-02T00:00:00Z' },
      ],
    });
    const board = col({
      id: 'e',
      name: 'Entregas',
      columns: ['Nome'],
      listNames: ['A fazer', 'Feito'],
      rows: [
        { key: 'e:1', cells: { Nome: 'T1' }, listName: 'A fazer', dueDate: null },
        { key: 'e:2', cells: { Nome: 'T2' }, listName: 'Feito', dueDate: null },
        { key: 'e:3', cells: { Nome: 'T3' }, listName: 'Feito', dueDate: null },
        { key: 'e:4', cells: { Nome: 'T4' }, listName: 'A fazer', dueDate: null },
      ],
    });
    const p = proposeMapping(bundle(dated, board));
    expect(p.collections[0].destination).toBe('posts');
    expect(p.collections[0].statusMap).toEqual({
      Rascunho: 'rascunho',
      Aprovado: 'aprovado_cliente',
    });
    expect(p.collections[1].destination).toBe('entregas');
  });

  test('idea-ish names classify as ideias', () => {
    const p = proposeMapping(bundle(col({ id: 'i', name: 'Banco de ideias', columns: ['Nome'] })));
    expect(p.collections[0].destination).toBe('ideias');
  });
});

describe('client column density', () => {
  // The Trello shape: 'Etiquetas' matches the client role, but an unlabeled
  // board leaves it blank on every card. Binding to it would resolve every
  // row to a blank client and commit nothing.
  const trelloish = (etiquetas: (string | undefined)[]): ImportCollection =>
    col({
      id: 't',
      name: 'OLIV DIGITAL',
      source: 'trello',
      columns: ['Nome', 'Etiquetas'],
      listNames: ['Em criação', 'Concluído'],
      rows: etiquetas.map((v, n) => ({
        key: `t:${n}`,
        cells: { Nome: `Card ${n}`, ...(v !== undefined && { Etiquetas: v }) },
        listName: 'Em criação',
        dueDate: null,
      })),
    });

  test('all-blank client column falls back to the fixed picker', () => {
    const p = proposeMapping(bundle(trelloish(['', '', undefined, '   '])));
    expect(p.collections[0].columnRoles.client).toBe('Etiquetas');
    expect(p.collections[0].clientAssignment).toEqual({ mode: 'fixed', clienteNome: '' });
  });

  test('client column filled on at least half the rows stays column mode', () => {
    const p = proposeMapping(bundle(trelloish(['Dra. Ana', 'Dr. Beto', '', ''])));
    expect(p.collections[0].clientAssignment).toEqual({ mode: 'column', column: 'Etiquetas' });
  });

  test('sparse client column (under half) falls back to the fixed picker', () => {
    const p = proposeMapping(bundle(trelloish(['Dra. Ana', '', '', ''])));
    expect(p.collections[0].clientAssignment).toEqual({ mode: 'fixed', clienteNome: '' });
  });

  test('a rowless collection proposes the fixed picker, never an unproven column', () => {
    const p = proposeMapping(bundle(trelloish([])));
    expect(p.collections[0].clientAssignment).toEqual({ mode: 'fixed', clienteNome: '' });
  });
});

describe('mapStatus clamp', () => {
  test('never returns agendado', () => {
    expect(mapStatus('Agendado')).toBe('aprovado_cliente');
    expect(mapStatus('Scheduled')).toBe('aprovado_cliente');
  });
  test('published-ish maps to postado, unknown to rascunho', () => {
    expect(mapStatus('Publicado')).toBe('postado');
    expect(mapStatus('???')).toBe('rascunho');
  });
  test('correction wins over enviado/client when both match (order-dependent branch)', () => {
    expect(mapStatus('Correção Cliente')).toBe('correcao_cliente');
  });
});
