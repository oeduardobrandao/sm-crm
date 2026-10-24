import { describe, expect, it } from 'vitest';
import type { RentabilidadeSeeded } from '@/store/financeiroV2';
import {
  direcaoInicial,
  montarLinhas,
  nomeArquivoCsv,
  ORDEM_PADRAO,
  ordenarLinhas,
} from '../rentabilidade';
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

describe('ordenarLinhas', () => {
  /** Three clients: Bia (pausada), ana and Ébano, with receita/custo chosen per test. */
  function linhas(
    rows: Array<[nome: string, receita: number, custo: number, status?: 'ativo' | 'pausado']>,
  ) {
    const data = structuredClone(planilha);
    const base = data.clientes[0];
    data.clientes = rows.map(([nome, receita, custo, status], i) => ({
      ...base,
      cliente_id: 100 + i,
      nome,
      status: status ?? 'ativo',
      receita,
      custo,
      lucro: receita - custo,
      margem: receita > 0 ? (receita - custo) / receita : null,
      por_funcao: { '1': custo },
    }));
    return montarLinhas(data, false);
  }
  const nomes = (ls: ReturnType<typeof linhas>) => ls.map((l) => l.cliente.nome);

  it('defaults to A-Z ignoring case and accents, paused clients last', () => {
    const ls = linhas([
      ['Bia', 1000, 100, 'pausado'],
      ['Ébano', 1000, 500],
      ['ana', 1000, 900],
      ['Carla', 1000, 200],
    ]);
    expect(nomes(ordenarLinhas(ls, ORDEM_PADRAO))).toEqual(['ana', 'Carla', 'Ébano', 'Bia']);
    expect(nomes(ordenarLinhas(ls, { coluna: 'cliente', direcao: 'desc' }))).toEqual([
      'Ébano',
      'Carla',
      'ana',
      'Bia',
    ]);
  });

  it('sorts money and função columns, keeping paused clients last either way', () => {
    const ls = linhas([
      ['Bia', 5000, 4000, 'pausado'],
      ['Ana', 2000, 300],
      ['Carla', 3000, 1200],
    ]);
    expect(nomes(ordenarLinhas(ls, { coluna: 'receita', direcao: 'desc' }))).toEqual([
      'Carla',
      'Ana',
      'Bia',
    ]);
    expect(nomes(ordenarLinhas(ls, { coluna: 'receita', direcao: 'asc' }))).toEqual([
      'Ana',
      'Carla',
      'Bia',
    ]);
    expect(nomes(ordenarLinhas(ls, { coluna: 'funcao:1', direcao: 'desc' }))).toEqual([
      'Carla',
      'Ana',
      'Bia',
    ]);
  });

  it('puts a client without margem last in both directions, ties by name', () => {
    const ls = linhas([
      ['Zé', 0, 100],
      ['Bia', 1000, 500],
      ['Ana', 1000, 500],
      ['Caio', 1000, 900],
    ]);
    expect(nomes(ordenarLinhas(ls, { coluna: 'margem', direcao: 'asc' }))).toEqual([
      'Caio',
      'Ana',
      'Bia',
      'Zé',
    ]);
    expect(nomes(ordenarLinhas(ls, { coluna: 'margem', direcao: 'desc' }))).toEqual([
      'Ana',
      'Bia',
      'Caio',
      'Zé',
    ]);
  });

  it('first click: names and margem ascending, money descending', () => {
    expect(direcaoInicial('cliente')).toBe('asc');
    expect(direcaoInicial('margem')).toBe('asc');
    expect(direcaoInicial('lucro')).toBe('desc');
    expect(direcaoInicial('funcao:3')).toBe('desc');
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
