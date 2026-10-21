import { describe, it, expect } from 'vitest';
import { CSV_BOM, CSV_EOL, csvField, csvRow } from '../csvExport';

describe('csvExport', () => {
  it('exposes BOM and CRLF', () => {
    expect(CSV_BOM).toBe('\uFEFF');
    expect(CSV_EOL).toBe('\r\n');
  });

  it('quotes all separators regardless of active one', () => {
    expect(csvField('a;b', ';')).toBe('"a;b"');
    expect(csvField('a,b', ';')).toBe('"a,b"');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField('a\tb', ';')).toBe('"a\tb"');
  });

  it('quotes quotes and line breaks, doubling quotes', () => {
    expect(csvField('diz "oi"', ';')).toBe('"diz ""oi"""');
    expect(csvField('l1\nl2', ';')).toBe('"l1\nl2"');
    expect(csvField('l1\rl2', ';')).toBe('"l1\rl2"');
  });

  it('neutralizes formulas, including behind leading whitespace/control chars', () => {
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('  +1')).toBe("'  +1");
    expect(csvField('\t-2')).toBe(`"'\t-2"`);
    expect(csvField('@x')).toBe("'@x");
    expect(csvField('=1;2', ';')).toBe('"\'=1;2"');
  });

  it('prefixes formula-leading segments created by separator splitting', () => {
    expect(csvField('nice,=1+1', ';')).toBe('"\'nice,=1+1"');
    expect(csvField('x;@SUM(1)')).toBe('"\'x;@SUM(1)"');
  });

  it('joins rows with the separator', () => {
    expect(csvRow(['a', 1, 'b;c'], ';')).toBe('a;1;"b;c"');
    expect(csvRow(['a', 1])).toBe('a,1');
  });
});
