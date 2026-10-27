import { getIntlLocale, i18n } from '@mesaas/i18n';
import type { ContentFormat } from '@mesaas/platforms';
import { TIPO_ORDER } from '../postLabels';
import type { LinhaEditorial } from '@/store/linhaEditorial';

// Pure helpers of the linha editorial view. No React, no Supabase.

type ItemDia = { data: string | null };
type ItemTipo = { tipo: ContentFormat };

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Case- and accent-insensitive key for matching column names to property definitions. */
export function normalizeNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** `YYYY-MM` of a `YYYY-MM-DD` / `YYYY-MM-01` string. */
const monthOf = (iso: string) => iso.slice(0, 7);

/**
 * Date for a new row: the day after the latest dated row, the month's first day when no row
 * has a date, and null once that would fall outside the month (the row is created undated).
 */
export function defaultNovaData(itens: ItemDia[], periodo: string): string | null {
  const dated = itens.map((i) => i.data).filter((d): d is string => !!d);
  if (dated.length === 0) return `${monthOf(periodo)}-01`;
  const last = dated.reduce((a, b) => (a > b ? a : b));
  const [y, m, d] = last.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return monthOf(next) === monthOf(periodo) ? next : null;
}

/** Count per format, in `TIPO_ORDER`, omitting formats with no row. */
export function formatBreakdown(itens: ItemTipo[]): { tipo: ContentFormat; n: number }[] {
  return TIPO_ORDER.map((tipo) => ({
    tipo,
    n: itens.filter((i) => i.tipo === tipo).length,
  })).filter((b) => b.n > 0);
}

/**
 * Month name of a period (`YYYY-MM-01` or `YYYY-MM`) in the UI language: lower-case in pt-BR
 * ("novembro"), capitalized in English ("November").
 */
export function mesLabel(periodo: string): string {
  const idx = Number(periodo.slice(5, 7)) - 1;
  const pt = MESES[idx];
  if (!pt || getIntlLocale() !== 'en-US') return pt ?? '';
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2000, idx, 1),
  );
}

/** `YYYY-MM` (the `mes` URL param) to the period date `YYYY-MM-01`. */
export function periodoFromMes(mes: string): string {
  return `${mes.slice(0, 7)}-01`;
}

/** Default fluxo name: "Reels de novembro" for one format, else "Linha de novembro". */
export function nomeFluxoPadrao(itens: ItemTipo[], periodo: string): string {
  const mes = mesLabel(periodo);
  const tipos = new Set(itens.map((i) => i.tipo));
  if (tipos.size === 1) {
    const tipo = i18n.t(`linha:logic.tipoPlural.${[...tipos][0]}`);
    return i18n.t('linha:logic.nomeFluxoFormato', { tipo, mes });
  }
  return i18n.t('linha:logic.nomeFluxoLinha', { mes });
}

/**
 * User copy for the raises of `linha_item_guard` (migration 20261031000001) that the person
 * can act on; null for anything else (the caller keeps its own fallback).
 */
export function mensagemGuardItem(err: unknown): string | null {
  const msg =
    err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message
      : '';
  if (msg.includes('linha_item_limite')) {
    return i18n.t('linha:logic.guardLimite');
  }
  if (msg.includes('linha_item_convertido')) return i18n.t('linha:logic.guardConvertido');
  return null;
}

/** Rail and phone list count: production first, then the client's approvals once the linha
 * was sent, else the row count (spec §13.6). */
export function contagemLinha(l: LinhaEditorial): string {
  const total = l.itens_total ?? 0;
  const prod = l.itens_convertidos ?? 0;
  if (prod > 0) return i18n.t('linha:logic.contagemProducao', { prod, total });
  if (l.rodada > 0) {
    return i18n.t('linha:logic.contagemAprovados', { aprovados: l.itens_aprovados ?? 0, total });
  }
  return i18n.t('linha:logic.contagemPosts', { count: total });
}
