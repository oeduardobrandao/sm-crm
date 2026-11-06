import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import type { PessoaRentabilidade } from '@/store/financeiroV2';
import { formatMargem, regraTexto } from '../format';

// formatFinancialBRL puts a NO-BREAK SPACE after "R$"
const norm = (s: string) => s.replace(/\u00a0/g, ' ');

function pessoa(over: Partial<PessoaRentabilidade>): PessoaRentabilidade {
  return {
    membro_id: 1,
    nome: 'Caio',
    funcao_id: 1,
    regra: 'rateio',
    valor: 260,
    total: 3900,
    n_clientes: 15,
    quantidade: null,
    valor_unitario: null,
    ...over,
  };
}

describe('format helpers in English', () => {
  afterEach(() => i18n.changeLanguage('pt'));

  it('formatMargem uses a decimal point', async () => {
    await i18n.changeLanguage('en');
    expect(formatMargem(0.528)).toBe('52.8%');
    expect(formatMargem(0.6025)).toBe('60.3%');
    expect(formatMargem(-0.1)).toBe('-10.0%');
    expect(formatMargem(null)).toBe('-');
  });

  it('regraTexto translates each rule', async () => {
    await i18n.changeLanguage('en');
    expect(norm(regraTexto(pessoa({}), true))).toBe('R$ 3.900,00 ÷ 15 clients');
    expect(norm(regraTexto(pessoa({ total: 800, n_clientes: 1 }), true))).toBe(
      'R$ 800,00 ÷ 1 client',
    );
    const exclusivo = pessoa({ regra: 'exclusivo', valor: 550, total: 550, n_clientes: 1 });
    expect(norm(regraTexto(exclusivo, true))).toBe('This client only: R$ 550,00 per month');
    const entrega = pessoa({ regra: 'entrega', quantidade: 3, valor_unitario: 45, valor: 135 });
    expect(norm(regraTexto(entrega, true))).toBe('3 deliverables × R$ 45,00');
    expect(norm(regraTexto({ ...entrega, quantidade: 1 }, true))).toBe('1 deliverable × R$ 45,00');
    expect(regraTexto({ ...entrega, quantidade: null }, true)).toBe('To be entered');
    expect(regraTexto(pessoa({ valor: 0 }), true, undefined, true)).toBe('Paused');
  });

  it('regraTexto keeps a stored unit as typed', async () => {
    await i18n.changeLanguage('en');
    const p = pessoa({ regra: 'entrega', quantidade: 10, valor_unitario: 45, valor: 450 });
    expect(norm(regraTexto(p, true, 'arte'))).toBe('10 artes × R$ 45,00');
  });

  it('regraTexto with zero deliverables keeps the plural in both languages', async () => {
    const p = pessoa({ regra: 'entrega', quantidade: 0, valor_unitario: 45, valor: 0 });
    expect(norm(regraTexto(p, true))).toBe('0 entregas × R$ 45,00');
    await i18n.changeLanguage('en');
    expect(norm(regraTexto(p, true))).toBe('0 deliverables × R$ 45,00');
  });
});
