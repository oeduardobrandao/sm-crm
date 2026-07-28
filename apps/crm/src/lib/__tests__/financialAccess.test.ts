import { describe, it, expect } from 'vitest';
import { formatFinancialBRL, MASKED_BRL } from '../financialAccess';

describe('formatFinancialBRL', () => {
  it('formats the value when access is literally true', () => {
    expect(formatFinancialBRL(1234.5, true)).toBe(
      (1234.5).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    );
  });

  it('masks when access is false', () => {
    expect(formatFinancialBRL(1234.5, false)).toBe(MASKED_BRL);
  });

  // Values fail CLOSED: rendering a real figure to someone who may be
  // restricted is the harm, so anything that is not literal `true` masks.
  it('masks while access is still unknown', () => {
    expect(formatFinancialBRL(1234.5, 'unknown')).toBe(MASKED_BRL);
  });

  it('treats null and undefined as zero when authorized', () => {
    const zero = (0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    expect(formatFinancialBRL(null, true)).toBe(zero);
    expect(formatFinancialBRL(undefined, true)).toBe(zero);
  });

  it('masks null when not authorized rather than showing R$ 0', () => {
    expect(formatFinancialBRL(null, false)).toBe(MASKED_BRL);
  });
});
