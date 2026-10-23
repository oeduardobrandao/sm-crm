import { describe, expect, it } from 'vitest';
import type { RentabilidadeSeeded } from '@/store/financeiroV2';
import { montarLinhas, nomeArquivoCsv } from '../rentabilidade';
import { planilha } from './fixtures/planilha';

/** Ana (Design, id 2) per delivery with no quantity on Cinara (ativo) and Tyciana (pausado). */
function semQuantidade(): RentabilidadeSeeded {
  const data = structuredClone(planilha);
  for (const c of data.clientes) {
    if (c.nome !== 'Cinara' && c.nome !== 'Tyciana') continue;
    if (c.nome === 'Tyciana') c.status = 'pausado';
    c.pessoas = c.pessoas.map((p) =>
      p.nome === 'Ana'
        ? { ...p, regra: 'entrega', valor: 0, quantidade: null, valor_unitario: 45 }
        : p,
    );
  }
  return data;
}

describe('montarLinhas', () => {
  const celulaDesign = (data: RentabilidadeSeeded, nome: string) =>
    montarLinhas(data, false)
      .find((l) => l.cliente.nome === nome)!
      .funcoes.find((f) => f.funcaoId === 2)!;

  it('flags a delivery to inform on an active client', () => {
    expect(celulaDesign(semQuantidade(), 'Cinara').aInformar).toBe(true);
  });

  it('does not flag a paused client (its assignments are listed, nothing is owed)', () => {
    expect(celulaDesign(semQuantidade(), 'Tyciana').aInformar).toBe(false);
  });
});

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
