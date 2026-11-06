import { getIntlLocale, i18n } from '@mesaas/i18n';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import type { PessoaRentabilidade } from '@/store/financeiroV2';

/** Decimal mark of the UI language: ',' in Portuguese, '.' in English. */
export function separadorDecimal(): string {
  return getIntlLocale() === 'pt-BR' ? ',' : '.';
}

/**
 * Margin fraction as a percentage with one decimal ('52,8%' in pt, '52.8%' in en); null is '-'.
 * Rounds half up with a tiny epsilon: 0.6025 is 0.60249999... in binary and toFixed /
 * Intl would give '60,2%'.
 */
export function formatMargem(m: number | null): string {
  if (m === null || !Number.isFinite(m)) return '-';
  const pct = Math.round(m * 1000 + 1e-9) / 10;
  return `${pct.toFixed(1).replace('.', separadorDecimal())}%`;
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

/** 'arte' -> 'artes', 'gravação' -> 'gravações'; singular when quantidade is 1. */
export function unidadeComNumero(unidade: string, quantidade: number): string {
  if (quantidade === 1) return unidade;
  return unidade.endsWith('ão') ? `${unidade.slice(0, -2)}ões` : `${unidade}s`;
}

/**
 * The one-line "how was this cost computed" text of a pessoa in a client's breakdown.
 * `unidade` (the acordo's unit, e.g. 'arte') is not on PessoaRentabilidade, so the
 * caller passes it; it is pluralised by `unidadeComNumero` (a stored unit stays as typed).
 * Without one, the generic "entrega" is a translated plural.
 * `pausado`: the client is paused, so the person is listed (the assignment is kept) but
 * costs it nothing, unless deliveries were entered for it (they still count).
 */
export function regraTexto(
  p: PessoaRentabilidade,
  access: FinancialAccess,
  unidade?: string,
  pausado = false,
): string {
  if (pausado && !(p.regra === 'entrega' && p.quantidade !== null)) {
    return i18n.t('financeV2:shared.pausado');
  }
  if (p.regra === 'exclusivo') {
    return i18n.t('financeV2:regra.exclusivo', { valor: formatFinancialBRL(p.total, access) });
  }
  if (p.regra === 'entrega') {
    if (p.quantidade === null) return i18n.t('financeV2:shared.aInformar');
    const un =
      unidade === undefined
        ? i18n.t('financeV2:regra.entrega', { count: p.quantidade })
        : unidadeComNumero(unidade, p.quantidade);
    return i18n.t('financeV2:regra.porEntrega', {
      quantidade: p.quantidade,
      unidade: un,
      valor: formatFinancialBRL(p.valor_unitario, access),
    });
  }
  return i18n.t('financeV2:regra.rateio', {
    valor: formatFinancialBRL(p.total, access),
    clientes: i18n.t('financeV2:regra.clientes', { count: p.n_clientes }),
  });
}
