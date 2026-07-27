import { describe, expect, test } from 'vitest';
import { parseGenericCsv } from '../src/generic-csv';

describe('parseGenericCsv', () => {
  test('first row is the header; rows keyed by file:index', () => {
    const col = parseGenericCsv('clientes.csv', 'Nome,Email\nAna,ana@x.com\nBia,bia@x.com');
    expect(col).toMatchObject({
      id: 'clientes.csv',
      name: 'clientes',
      source: 'csv',
      columns: ['Nome', 'Email'],
      listNames: [],
    });
    expect(col.rows).toEqual([
      { key: 'clientes.csv:1', cells: { Nome: 'Ana', Email: 'ana@x.com' } },
      { key: 'clientes.csv:2', cells: { Nome: 'Bia', Email: 'bia@x.com' } },
    ]);
  });

  test('ragged rows pad missing cells with empty string', () => {
    const col = parseGenericCsv('x.csv', 'A,B\n1');
    expect(col.rows[0].cells).toEqual({ A: '1', B: '' });
  });
});
