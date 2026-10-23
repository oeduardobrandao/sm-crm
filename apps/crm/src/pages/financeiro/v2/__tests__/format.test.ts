import { describe, expect, it } from 'vitest';
import { MASKED_BRL } from '@/lib/financialAccess';
import type { PessoaRentabilidade } from '@/store/financeiroV2';
import { abaixoDaMeta, anualizar, formatMargem, regraTexto } from '../format';
import { planilha } from './fixtures/planilha';

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

describe('formatMargem', () => {
  it('formata com virgula e uma casa', () => {
    expect(formatMargem(0.528)).toBe('52,8%');
    expect(formatMargem(0.6)).toBe('60,0%');
    expect(formatMargem(1)).toBe('100,0%');
    expect(formatMargem(0)).toBe('0,0%');
  });

  it('arredonda meio para cima apesar do erro binario', () => {
    expect(formatMargem(0.6025)).toBe('60,3%');
    expect(formatMargem(0.5977)).toBe('59,8%');
  });

  it('formata margem negativa', () => {
    expect(formatMargem(-0.1)).toBe('-10,0%');
    expect(formatMargem(-0.3333)).toBe('-33,3%');
  });

  it('null vira hifen', () => {
    expect(formatMargem(null)).toBe('-');
  });
});

describe('abaixoDaMeta', () => {
  it('compara a margem (fracao) com a meta em pontos percentuais', () => {
    expect(abaixoDaMeta(0.47, 55)).toBe(true);
    expect(abaixoDaMeta(0.528, 55)).toBe(true);
    expect(abaixoDaMeta(0.55, 55)).toBe(false);
    expect(abaixoDaMeta(0.6, 55)).toBe(false);
  });

  it('nao acusa erro de ponto flutuante na borda', () => {
    expect(abaixoDaMeta(0.57, 57)).toBe(false);
    expect(abaixoDaMeta(0.58, 58)).toBe(false);
  });

  it('margem null nunca esta abaixo', () => {
    expect(abaixoDaMeta(null, 55)).toBe(false);
  });
});

describe('anualizar', () => {
  it('multiplica por 12 so no modo anual', () => {
    expect(anualizar(1000, true)).toBe(12000);
    expect(anualizar(1000, false)).toBe(1000);
  });
});

describe('regraTexto', () => {
  it('rateio mostra o total do membro dividido pelos clientes', () => {
    expect(norm(regraTexto(pessoa({}), true))).toBe('R$ 3.900,00 ÷ 15 clientes');
  });

  it('rateio com um cliente usa o singular', () => {
    expect(norm(regraTexto(pessoa({ total: 800, n_clientes: 1 }), true))).toBe(
      'R$ 800,00 ÷ 1 cliente',
    );
  });

  it('exclusivo mostra o total por mes', () => {
    const p = pessoa({ regra: 'exclusivo', valor: 550, total: 550, n_clientes: 1 });
    expect(norm(regraTexto(p, true))).toBe('Só este cliente: R$ 550,00 por mês');
  });

  it('entrega mostra quantidade, unidade no plural e valor unitario', () => {
    const p = pessoa({ regra: 'entrega', quantidade: 10, valor_unitario: 45, valor: 450 });
    expect(norm(regraTexto(p, true, 'arte'))).toBe('10 artes × R$ 45,00');
  });

  it('entrega com uma unidade nao pluraliza e o padrao e "entrega"', () => {
    const p = pessoa({ regra: 'entrega', quantidade: 1, valor_unitario: 45, valor: 45 });
    expect(norm(regraTexto(p, true, 'arte'))).toBe('1 arte × R$ 45,00');
    expect(norm(regraTexto({ ...p, quantidade: 3 }, true))).toBe('3 entregas × R$ 45,00');
  });

  it('entrega sem quantidade e "A informar"', () => {
    const p = pessoa({ regra: 'entrega', quantidade: null, valor_unitario: 45, valor: 0 });
    expect(regraTexto(p, true, 'arte')).toBe('A informar');
  });

  it('cliente pausado mostra "Pausado" no lugar da regra', () => {
    expect(regraTexto(pessoa({ valor: 0 }), true, undefined, true)).toBe('Pausado');
    const semQtd = pessoa({ regra: 'entrega', valor: 0, quantidade: null, valor_unitario: 45 });
    expect(regraTexto(semQtd, true, 'arte', true)).toBe('Pausado');
  });

  it('cliente pausado com entregas informadas mantem a conta (as entregas contam)', () => {
    const p = pessoa({ regra: 'entrega', valor: 90, quantidade: 2, valor_unitario: 45 });
    expect(norm(regraTexto(p, true, 'arte', true))).toBe('2 artes × R$ 45,00');
  });

  it('mascara o dinheiro sem acesso financeiro', () => {
    expect(regraTexto(pessoa({}), false)).toBe(`${MASKED_BRL} ÷ 15 clientes`);
    expect(regraTexto(pessoa({}), 'unknown')).toBe(`${MASKED_BRL} ÷ 15 clientes`);
    const p = pessoa({ regra: 'entrega', quantidade: 10, valor_unitario: 45 });
    expect(regraTexto(p, false, 'arte')).toBe(`10 artes × ${MASKED_BRL}`);
  });
});

describe('fixture planilha', () => {
  const { clientes, membros, totais } = planilha;

  it('os totais batem com a soma dos clientes', () => {
    const soma = (f: (c: (typeof clientes)[number]) => number) =>
      clientes.reduce((acc, c) => acc + f(c), 0);
    expect(totais.receita).toBe(soma((c) => c.receita));
    expect(totais.custo_clientes).toBe(soma((c) => c.custo));
    expect(totais.custo_total).toBe(totais.custo_clientes + totais.custo_sem_cliente);
    expect(totais.lucro).toBe(totais.receita - totais.custo_total);
    for (const [fid, valor] of Object.entries(totais.por_funcao)) {
      expect(valor).toBe(soma((c) => c.por_funcao[fid] ?? 0));
    }
  });

  it('o custo de cada membro bate com a soma das fatias nos clientes', () => {
    for (const m of membros) {
      const fatias = clientes.flatMap((c) => c.pessoas.filter((p) => p.membro_id === m.membro_id));
      expect(fatias).toHaveLength(m.n_clientes);
      expect(fatias.reduce((acc, p) => acc + p.valor, 0)).toBe(m.custo);
    }
  });

  it('por_funcao tem uma chave para cada funcao, nos clientes e nos totais', () => {
    const ids = planilha.funcoes.map((f) => String(f.id)).sort();
    expect(Object.keys(totais.por_funcao).sort()).toEqual(ids);
    for (const c of clientes) expect(Object.keys(c.por_funcao).sort()).toEqual(ids);
    expect(totais.por_funcao['5']).toBe(0);
  });

  it('pessoas e membros seguem a ordem do contrato', () => {
    const ordem = new Map(planilha.funcoes.map((f) => [f.id as number | null, f.ordem]));
    const rank = (x: { funcao_id: number | null; nome: string }) => [
      ordem.get(x.funcao_id) ?? Infinity,
      x.nome,
    ];
    const ordenado = <T extends { funcao_id: number | null; nome: string }>(xs: T[]) =>
      [...xs].sort((a, b) => {
        const [oa, na] = rank(a) as [number, string];
        const [ob, nb] = rank(b) as [number, string];
        return oa - ob || na.localeCompare(nb, 'pt-BR');
      });
    expect(membros.map((m) => m.nome)).toEqual(ordenado(membros).map((m) => m.nome));
    for (const c of clientes) {
      expect(c.pessoas.map((p) => p.nome)).toEqual(ordenado(c.pessoas).map((p) => p.nome));
    }
    expect(clientes.find((c) => c.nome === 'Talitha')?.pessoas.map((p) => p.nome)).toEqual([
      'Lia',
      'Ana',
      'Bruno',
      'Duda',
    ]);
    expect(membros.map((m) => m.nome)).toEqual(['Caio', 'Lia', 'Ana', 'Bruno', 'Duda']);
    const ordens = planilha.funcoes.map((f) => f.ordem);
    expect(ordens).toEqual([...ordens].sort((a, b) => a - b));
  });

  it('dinheiro com 2 casas e margem com 4', () => {
    const casas = (n: number, d: number) => Math.abs(Math.round(n * 10 ** d) / 10 ** d - n) < 1e-9;
    for (const c of clientes) {
      for (const v of [c.receita, c.custo, c.lucro, ...Object.values(c.por_funcao)]) {
        expect(casas(v, 2)).toBe(true);
      }
      expect(casas(c.margem ?? 0, 4)).toBe(true);
    }
    expect(casas(totais.margem ?? 0, 4)).toBe(true);
  });

  it('clientes vem ordenados por nome', () => {
    const nomes = clientes.map((c) => c.nome);
    expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  });
});
