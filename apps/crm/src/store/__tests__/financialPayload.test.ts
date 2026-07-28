import { describe, it, expect } from 'vitest';
import { stripFinancialFields } from '../../lib/financialAccess';

describe('stripFinancialFields', () => {
  it('omits the key entirely when access is denied', () => {
    const out = stripFinancialFields({ nome: 'A', valor_mensal: 0, telefone: '9' }, false, [
      'valor_mensal',
    ]);
    expect('valor_mensal' in out).toBe(false);
    expect(out).toEqual({ nome: 'A', telefone: '9' });
  });

  // Omission, not zeroing: the forms send `valor: '' ? Number : 0`, so a literal
  // 0 reaches the payload for a blank field. Passing that through would make the
  // write guard reject EVERY client edit a restricted admin attempts — including
  // changing a phone number — and if the guard were ever loosened it would
  // silently zero the retainer.
  it('omits rather than zeroes', () => {
    const out = stripFinancialFields({ valor_mensal: 5000 }, false, ['valor_mensal']);
    expect(out).not.toHaveProperty('valor_mensal');
  });

  it('omits while access is unknown', () => {
    const out = stripFinancialFields({ valor_mensal: 1 }, 'unknown', ['valor_mensal']);
    expect('valor_mensal' in out).toBe(false);
  });

  it('passes the payload through untouched when authorized', () => {
    const input = { nome: 'A', valor_mensal: 5000 };
    expect(stripFinancialFields(input, true, ['valor_mensal'])).toEqual(input);
  });

  it('handles several keys at once', () => {
    const out = stripFinancialFields({ nome: 'X', custo_mensal: 1, valor_mensal: 2 }, false, [
      'custo_mensal',
      'valor_mensal',
    ]);
    expect(out).toEqual({ nome: 'X' });
  });
});
