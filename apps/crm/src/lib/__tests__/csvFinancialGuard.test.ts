import { describe, it, expect } from 'vitest';
import { assertNoFinancialColumns } from '../financialAccess';

describe('assertNoFinancialColumns', () => {
  it('throws naming the offending column when a restricted user supplies it', () => {
    expect(() =>
      assertNoFinancialColumns([{ nome: 'A', valor_mensal: '100' }], false, ['valor_mensal']),
    ).toThrow(/valor_mensal/);
  });

  it('detects the column even when only a later row carries it', () => {
    expect(() =>
      assertNoFinancialColumns([{ nome: 'A' }, { nome: 'B', valor_mensal: '5' }], false, [
        'valor_mensal',
      ]),
    ).toThrow(/valor_mensal/);
  });

  it('throws while access is unknown', () => {
    expect(() =>
      assertNoFinancialColumns([{ valor_mensal: '1' }], 'unknown', ['valor_mensal']),
    ).toThrow();
  });

  it('allows the column when authorized', () => {
    expect(() =>
      assertNoFinancialColumns([{ valor_mensal: '1' }], true, ['valor_mensal']),
    ).not.toThrow();
  });

  it('allows a file without the column at all', () => {
    expect(() => assertNoFinancialColumns([{ nome: 'A' }], false, ['valor_mensal'])).not.toThrow();
  });
});
