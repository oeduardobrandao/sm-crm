import { describe, expect, it } from 'vitest';
import { nomeArquivoCsv } from '../rentabilidade';

describe('nomeArquivoCsv', () => {
  it('builds the monthly and annual names from the period label', () => {
    expect(nomeArquivoCsv('out 2026', false)).toBe('rentabilidade-out-2026.csv');
    expect(nomeArquivoCsv('out 2026', true)).toBe('rentabilidade-out-2026-anual.csv');
  });

  it('replaces filename-unsafe characters', () => {
    expect(nomeArquivoCsv(' 15/10 a 14/11: "out"?* ', false)).toBe(
      'rentabilidade-15-10-a-14-11-out.csv',
    );
    expect(nomeArquivoCsv('a\\b<c>d|e', false)).toBe('rentabilidade-a-b-c-d-e.csv');
  });
});
