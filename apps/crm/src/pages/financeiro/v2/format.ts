import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import type { PessoaRentabilidade } from '@/store/financeiroV2';

/**
 * Margin fraction as a percentage with a comma and one decimal ('52,8%'); null is '-'.
 * Rounds half up with a tiny epsilon: 0.6025 is 0.60249999... in binary and toFixed /
 * Intl would give '60,2%'.
 */
export function formatMargem(m: number | null): string {
  if (m === null || !Number.isFinite(m)) return '-';
  const pct = Math.round(m * 1000 + 1e-9) / 10;
  return `${pct.toFixed(1).replace('.', ',')}%`;
}

/**
 * `m` is a fraction (0.47), `metaPct` is in percentage points (55). Margins arrive
 * rounded to 4 decimals, so compare at that precision: 0.57 * 100 is 56.99999999999999.
 */
export function abaixoDaMeta(m: number | null, metaPct: number): boolean {
  return m !== null && Math.round(m * 1e6) / 1e4 < metaPct;
}

export function anualizar(v: number, anual: boolean): number {
  return anual ? v * 12 : v;
}

/**
 * The one-line "how was this cost computed" text of a pessoa in a client's breakdown.
 * `unidade` (the acordo's unit, e.g. 'arte') is not on PessoaRentabilidade, so the
 * caller passes it; it is pluralised by appending 's' when quantidade !== 1.
 */
export function regraTexto(
  p: PessoaRentabilidade,
  access: FinancialAccess,
  unidade = 'entrega',
): string {
  if (p.regra === 'exclusivo') {
    return `Só este cliente: ${formatFinancialBRL(p.total, access)} por mês`;
  }
  if (p.regra === 'entrega') {
    if (p.quantidade === null) return 'A informar';
    const un = p.quantidade === 1 ? unidade : `${unidade}s`;
    return `${p.quantidade} ${un} × ${formatFinancialBRL(p.valor_unitario, access)}`;
  }
  const clientes = p.n_clientes === 1 ? '1 cliente' : `${p.n_clientes} clientes`;
  return `${formatFinancialBRL(p.total, access)} ÷ ${clientes}`;
}
