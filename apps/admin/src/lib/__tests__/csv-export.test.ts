import { describe, expect, it } from 'vitest';
import { centsToReais, isoDate, sanitizeCell, toCSV, toMonthlyCents } from '../csv-export';

describe('sanitizeCell', () => {
  it('prefixes values starting with =, +, -, @, tab, or CR with a leading quote', () => {
    expect(sanitizeCell('=cmd|calc')).toBe("'=cmd|calc");
    expect(sanitizeCell('+1234')).toBe("'+1234");
    expect(sanitizeCell('-1234')).toBe("'-1234");
    expect(sanitizeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(sanitizeCell('\tdanger')).toBe("'\tdanger");
    expect(sanitizeCell('\rdanger')).toBe("'\rdanger");
  });

  it('leaves a value that only contains, but does not start with, a risky character alone', () => {
    expect(sanitizeCell('Sub-Total')).toBe('Sub-Total');
    expect(sanitizeCell('a@b.com')).toBe('a@b.com');
  });

  it('leaves ordinary text alone', () => {
    expect(sanitizeCell('Acme Corp')).toBe('Acme Corp');
  });
});

describe('toCSV', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'amount', label: 'Amount' },
  ];

  it('produces a BOM-prefixed header row and one row per input, CRLF-separated', () => {
    const csv = toCSV([{ name: 'Acme', amount: 100 }], columns);
    expect(csv).toBe('﻿"Name","Amount"\r\n"Acme","100"');
  });

  it('quotes fields containing commas or quotes and doubles embedded quotes', () => {
    const csv = toCSV([{ name: 'Silva, Ana "A"', amount: 1 }], columns);
    expect(csv).toContain('"Silva, Ana ""A"""');
  });

  it('keeps a newline inside a field as part of one quoted cell', () => {
    const csv = toCSV([{ name: 'line1\nline2', amount: 1 }], columns);
    expect(csv).toContain('"line1\nline2"');
  });

  it('renders null/undefined cells as an empty string', () => {
    const csv = toCSV([{ name: null, amount: undefined }], columns);
    expect(csv).toBe('﻿"Name","Amount"\r\n"",""');
  });

  it('returns just the header for an empty row list', () => {
    const csv = toCSV([], columns);
    expect(csv).toBe('﻿"Name","Amount"');
  });

  it('neutralizes formula-injection risk in cell values before quoting', () => {
    const csv = toCSV([{ name: '=cmd|calc', amount: 1 }], columns);
    expect(csv).toContain('"\'=cmd|calc"');
  });
});

describe('toMonthlyCents', () => {
  it('divides annual amounts by 12, rounded to the nearest cent', () => {
    expect(toMonthlyCents('year', 180001)).toBe(15000);
    expect(toMonthlyCents('year', 180000)).toBe(15000);
  });

  it('passes monthly amounts through unchanged', () => {
    expect(toMonthlyCents('month', 9900)).toBe(9900);
  });

  it('returns null for a non-positive or missing amount', () => {
    expect(toMonthlyCents('month', 0)).toBeNull();
    expect(toMonthlyCents('month', null)).toBeNull();
    expect(toMonthlyCents('year', undefined)).toBeNull();
  });
});

describe('centsToReais', () => {
  it('converts integer cents to decimal reais', () => {
    expect(centsToReais(180001)).toBe(1800.01);
    expect(centsToReais(15000)).toBe(150);
  });

  it('returns an empty string for null/undefined', () => {
    expect(centsToReais(null)).toBe('');
    expect(centsToReais(undefined)).toBe('');
  });
});

describe('isoDate', () => {
  it('truncates an ISO timestamp to its date portion', () => {
    expect(isoDate('2026-01-15T10:00:00Z')).toBe('2026-01-15');
  });

  it('returns an empty string for null/undefined', () => {
    expect(isoDate(null)).toBe('');
    expect(isoDate(undefined)).toBe('');
  });
});
