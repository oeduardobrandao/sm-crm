import { describe, expect, test } from 'vitest';
import { parseCsv } from '../src/csv';

describe('parseCsv', () => {
  test('parses simple rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('handles quoted fields with commas, escaped quotes, newlines', () => {
    expect(parseCsv('name,desc\n"Silva, Ana","diz ""oi""\nsegunda linha"')).toEqual([
      ['name', 'desc'],
      ['Silva, Ana', 'diz "oi"\nsegunda linha'],
    ]);
  });

  test('strips BOM and CRLF, drops fully empty lines', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n,\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

// A Brazilian (or any European-locale) Excel writes CSV with the OS list
// separator, which is `;` — and the wizard's upload guide says that export is
// supported. Before delimiter detection every such file parsed as ONE column
// per line, so the mapping step had nothing to address.
describe('parseCsv — delimiter detection', () => {
  test('a semicolon-separated file parses into real columns', () => {
    expect(parseCsv('Nome;Email;Telefone\nAna;ana@x.com;11999\nBia;bia@x.com;11888')).toEqual([
      ['Nome', 'Email', 'Telefone'],
      ['Ana', 'ana@x.com', '11999'],
      ['Bia', 'bia@x.com', '11888'],
    ]);
  });

  test('a comma-separated file is unaffected', () => {
    expect(parseCsv('Nome,Email\nAna,ana@x.com')).toEqual([
      ['Nome', 'Email'],
      ['Ana', 'ana@x.com'],
    ]);
  });

  test('a semicolon file whose quoted fields contain commas keeps them as data', () => {
    // Naive counting sees 2 commas vs 1 semicolon on the header line and would
    // pick comma, shredding both fields. Detection must ignore quoted content.
    expect(parseCsv('"Nome, completo";"Endereço, nº"\n"Silva, Ana";"Rua A, 10"')).toEqual([
      ['Nome, completo', 'Endereço, nº'],
      ['Silva, Ana', 'Rua A, 10'],
    ]);
  });

  test('a comma file whose quoted fields contain semicolons keeps them as data', () => {
    expect(parseCsv('"Nome; alt",Obs\n"Ana; Aninha","a;b;c"')).toEqual([
      ['Nome; alt', 'Obs'],
      ['Ana; Aninha', 'a;b;c'],
    ]);
  });

  test('a single-column file with no delimiter at all still parses one cell per line', () => {
    expect(parseCsv('Nome\nAna\nBia')).toEqual([['Nome'], ['Ana'], ['Bia']]);
  });

  test('a tab-separated file parses into real columns', () => {
    expect(parseCsv('Nome\tEmail\nAna\tana@x.com')).toEqual([
      ['Nome', 'Email'],
      ['Ana', 'ana@x.com'],
    ]);
  });

  test('detection reads the header line only, and the BOM does not hide it', () => {
    // A later row carrying more (unquoted) semicolons than the header has
    // commas must not flip the whole file to semicolons.
    expect(parseCsv('﻿a,b\nx;y;z;w,2')).toEqual([
      ['a', 'b'],
      ['x;y;z;w', '2'],
    ]);
  });
});
