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
