import { describe, it, expect } from 'vitest';
import { CSV_BOM, CSV_EOL, csvField, csvRow } from '../csvExport';

describe('csvExport', () => {
  it('exposes BOM and CRLF', () => {
    expect(CSV_BOM).toBe('﻿');
    expect(CSV_EOL).toBe('\r\n');
  });

  it('quotes the active separator only', () => {
    expect(csvField('a;b', ';')).toBe('"a;b"');
    expect(csvField('a,b', ';')).toBe('a,b');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('a;b')).toBe('a;b');
  });

  it('quotes quotes and line breaks, doubling quotes', () => {
    expect(csvField('diz "oi"', ';')).toBe('"diz ""oi"""');
    expect(csvField('l1\nl2', ';')).toBe('"l1\nl2"');
    expect(csvField('l1\rl2', ';')).toBe('"l1\rl2"');
  });

  it('neutralizes formulas, including behind leading whitespace/control chars', () => {
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('  +1')).toBe("'  +1");
    expect(csvField('\t-2')).toBe("'\t-2");
    expect(csvField('@x')).toBe("'@x");
    expect(csvField('=1;2', ';')).toBe('"\'=1;2"');
  });

  it('joins rows with the separator', () => {
    expect(csvRow(['a', 1, 'b;c'], ';')).toBe('a;1;"b;c"');
    expect(csvRow(['a', 1])).toBe('a,1');
  });
});
