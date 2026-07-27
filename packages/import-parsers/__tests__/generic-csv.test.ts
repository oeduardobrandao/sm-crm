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

  test('duplicate header names are deduplicated, both columns preserved', () => {
    const col = parseGenericCsv('dup.csv', 'Status,Name,Status\nOpen,X,Done');
    expect(col.columns).toEqual(['Status', 'Name', 'Status (2)']);
    expect(col.rows[0].cells).toEqual({ Status: 'Open', Name: 'X', 'Status (2)': 'Done' });
  });

  test('a data row with more fields than the header preserves the overflow value', () => {
    const col = parseGenericCsv('overflow.csv', 'A,B\n1,2,3');
    expect(col.columns).toEqual(['A', 'B', 'Coluna 3']);
    expect(col.rows[0].cells).toEqual({ A: '1', B: '2', 'Coluna 3': '3' });
  });

  test('an empty header cell gets a synthesized name instead of colliding', () => {
    const col = parseGenericCsv('empty-header.csv', 'A,,C\n1,2,3');
    expect(col.columns).toEqual(['A', 'Coluna 2', 'C']);
    expect(col.rows[0].cells).toEqual({ A: '1', 'Coluna 2': '2', C: '3' });
  });
});
