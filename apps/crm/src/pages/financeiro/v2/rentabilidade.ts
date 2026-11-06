import { i18n } from '@mesaas/i18n';
import { CSV_BOM, CSV_EOL, csvField } from '@/lib/csvExport';
import type {
  ClienteRentabilidade,
  FuncaoFinanceira,
  RentabilidadeSeeded,
} from '@/store/financeiroV2';
import { abaixoDaMeta, anualizar } from './format';

// Pure helpers of the Rentabilidade screen: the rows the table, the phone list and the
// CSV render, so the three always agree (and honour the Mensal/Anual toggle alike).

export interface CelulaFuncao {
  funcaoId: number;
  valor: number;
  /** A por_entrega member of this função still has no quantity for this (active) client. */
  aInformar: boolean;
}

export interface LinhaRentabilidade {
  cliente: ClienteRentabilidade;
  /** Money below is already multiplied by 12 when Anual is on. */
  receita: number;
  custo: number;
  lucro: number;
  /** Fraction, unchanged by Anual. */
  margem: number | null;
  abaixo: boolean;
  funcoes: CelulaFuncao[];
}

export interface TotalRentabilidade {
  receita: number;
  custo: number;
  lucro: number;
  margem: number | null;
  porFuncao: Record<number, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Margem ascending, clients without one (receita 0) last. Array.sort is stable: ties keep the payload order. */
export function ordenarPorMargem(clientes: ClienteRentabilidade[]): ClienteRentabilidade[] {
  return [...clientes].sort((a, b) => {
    if (a.margem === null || b.margem === null) {
      return (a.margem === null ? 1 : 0) - (b.margem === null ? 1 : 0);
    }
    return a.margem - b.margem;
  });
}

export function montarLinhas(data: RentabilidadeSeeded, anual: boolean): LinhaRentabilidade[] {
  return ordenarPorMargem(data.clientes).map((c) => ({
    cliente: c,
    receita: anualizar(c.receita, anual),
    custo: anualizar(c.custo, anual),
    lucro: anualizar(c.lucro, anual),
    margem: c.margem,
    abaixo: abaixoDaMeta(c.margem, data.meta_margem),
    funcoes: data.funcoes.map((f) => ({
      funcaoId: f.id,
      valor: anualizar(c.por_funcao[String(f.id)] ?? 0, anual),
      // A paused client lists its people but owes no delivery (same as its a_informar).
      aInformar:
        c.status === 'ativo' &&
        c.pessoas.some(
          (p) => p.funcao_id === f.id && p.regra === 'entrega' && p.quantidade === null,
        ),
    })),
  }));
}

/** A sortable column of the table: the fixed ones, or a função column by id. */
export type ColunaOrdem = 'cliente' | 'receita' | 'custo' | 'lucro' | 'margem' | `funcao:${number}`;

export interface Ordenacao {
  coluna: ColunaOrdem;
  direcao: 'asc' | 'desc';
}

/** Default order: clients A-Z (paused ones are always last, see ordenarLinhas). */
export const ORDEM_PADRAO: Ordenacao = { coluna: 'cliente', direcao: 'asc' };

/** First click on a column: names A-Z and margem lowest first (the ones to look at), money
 *  highest first. A second click on the same column flips it. */
export function direcaoInicial(coluna: ColunaOrdem): Ordenacao['direcao'] {
  return coluna === 'cliente' || coluna === 'margem' ? 'asc' : 'desc';
}

const porNome = (a: LinhaRentabilidade, b: LinhaRentabilidade) =>
  a.cliente.nome.localeCompare(b.cliente.nome, 'pt-BR', { sensitivity: 'base' });

function valorDaColuna(l: LinhaRentabilidade, coluna: ColunaOrdem): number | null {
  if (coluna === 'receita' || coluna === 'custo' || coluna === 'lucro') return l[coluna];
  if (coluna === 'margem') return l.margem;
  const id = Number(coluna.slice('funcao:'.length));
  return l.funcoes.find((c) => c.funcaoId === id)?.valor ?? 0;
}

/**
 * Rows in the chosen order. Paused clients always go last, whatever the column, and a row
 * without a margem (no receita) goes last in either direction. Ties fall back to the name.
 */
export function ordenarLinhas(
  linhas: LinhaRentabilidade[],
  ordem: Ordenacao,
): LinhaRentabilidade[] {
  const sinal = ordem.direcao === 'asc' ? 1 : -1;
  return [...linhas].sort((a, b) => {
    const pausaA = a.cliente.status === 'pausado' ? 1 : 0;
    const pausaB = b.cliente.status === 'pausado' ? 1 : 0;
    if (pausaA !== pausaB) return pausaA - pausaB;
    if (ordem.coluna === 'cliente') return sinal * porNome(a, b);
    const va = valorDaColuna(a, ordem.coluna);
    const vb = valorDaColuna(b, ordem.coluna);
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
      return porNome(a, b);
    }
    return sinal * (va - vb) || porNome(a, b);
  });
}

/** Footer of the table: the sum of the rendered rows (cost outside the clients is in the KPIs). */
export function somarLinhas(
  linhas: LinhaRentabilidade[],
  funcoes: FuncaoFinanceira[],
): TotalRentabilidade {
  const receita = round2(linhas.reduce((acc, l) => acc + l.receita, 0));
  const custo = round2(linhas.reduce((acc, l) => acc + l.custo, 0));
  const lucro = round2(receita - custo);
  const porFuncao: Record<number, number> = {};
  for (const f of funcoes) {
    porFuncao[f.id] = round2(
      linhas.reduce((acc, l) => acc + (l.funcoes.find((x) => x.funcaoId === f.id)?.valor ?? 0), 0),
    );
  }
  return { receita, custo, lucro, margem: receita > 0 ? lucro / receita : null, porFuncao };
}

/** pt-BR number for a spreadsheet: no thousands separator, comma decimal ('2500,00'). */
const numero = (v: number) => round2(v).toFixed(2).replace('.', ',');

/** Margem in percentage points with one decimal ('52,8'); empty when there is none. */
const margemCsv = (m: number | null) =>
  m === null ? '' : (Math.round(m * 1000 + 1e-9) / 10).toFixed(1).replace('.', ',');

/**
 * `;`-separated CSV with a BOM (Excel reads the accents). Only the text cells go through
 * `csvField`: numbers are written as they are, because its formula guard would turn a
 * negative lucro into text ('-150,00) and its quoting would wrap every decimal comma.
 */
export function montarCsv(
  linhas: LinhaRentabilidade[],
  funcoes: FuncaoFinanceira[],
  anual: boolean,
): string {
  const sep = ';';
  // Same labels as the table headers: the values in `linhas` are already annual when Anual is on.
  const dinheiro = anual
    ? [
        i18n.t('financeV2:csv.arr'),
        i18n.t('financeV2:csv.custoAnual'),
        i18n.t('financeV2:csv.lucroAnual'),
      ]
    : [i18n.t('financeV2:csv.mrr'), i18n.t('financeV2:csv.custo'), i18n.t('financeV2:csv.lucro')];
  const header = [
    i18n.t('financeV2:csv.cliente'),
    ...dinheiro,
    i18n.t('financeV2:csv.margem'),
    ...funcoes.map((f) => f.nome),
  ]
    .map((h) => csvField(h, sep))
    .join(sep);
  const rows = linhas.map((l) =>
    [
      csvField(l.cliente.nome, sep),
      numero(l.receita),
      numero(l.custo),
      numero(l.lucro),
      margemCsv(l.margem),
      ...l.funcoes.map((f) => numero(f.valor)),
    ].join(sep),
  );
  return CSV_BOM + [header, ...rows].join(CSV_EOL) + CSV_EOL;
}

/**
 * `rentabilidade-<rotulo>.csv`, `-anual` before the extension when Anual is on. Characters a
 * file system rejects (`/ \\ : * ? " < > |`, control characters) and whitespace become `-`.
 */
export function nomeArquivoCsv(rotulo: string, anual: boolean): string {
  const base = rotulo
    // eslint-disable-next-line no-control-regex
    .replace(/[\s/\\:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `rentabilidade-${base}${anual ? '-anual' : ''}.csv`;
}
