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
  /** A por_entrega member of this função still has no quantity for this client. */
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
      aInformar: c.pessoas.some(
        (p) => p.funcao_id === f.id && p.regra === 'entrega' && p.quantidade === null,
      ),
    })),
  }));
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
  const dinheiro = anual ? ['ARR', 'Custo anual', 'LL anual'] : ['MRR', 'Custo', 'Lucro'];
  const header = ['Cliente', ...dinheiro, 'Margem', ...funcoes.map((f) => f.nome)]
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
