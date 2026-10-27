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

/** Plural used in the default fluxo name: "Reels de novembro". */
const TIPO_PLURAL: Record<ContentFormat, string> = {
  feed: 'Imagens',
  carrossel: 'Carrosséis',
  reels: 'Reels',
  stories: 'Stories',
};

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

/** Lower-case pt-BR month name of a period (`YYYY-MM-01` or `YYYY-MM`): "novembro". */
export function mesLabel(periodo: string): string {
  return MESES[Number(periodo.slice(5, 7)) - 1] ?? '';
}

/** `YYYY-MM` (the `mes` URL param) to the period date `YYYY-MM-01`. */
export function periodoFromMes(mes: string): string {
  return `${mes.slice(0, 7)}-01`;
}

/** Default fluxo name: "Reels de novembro" for one format, else "Linha de novembro". */
export function nomeFluxoPadrao(itens: ItemTipo[], periodo: string): string {
  const mes = mesLabel(periodo);
  const tipos = new Set(itens.map((i) => i.tipo));
  if (tipos.size === 1) return `${TIPO_PLURAL[[...tipos][0]]} de ${mes}`;
  return `Linha de ${mes}`;
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
    return 'A linha chegou ao limite de 100 posts. Exclua uma linha para criar outra.';
  }
  if (msg.includes('linha_item_convertido')) return 'Esta linha já virou post. Atualize a página.';
  return null;
}

/** Rail and phone list count: production first, then the client's approvals once the linha
 * was sent, else the row count (spec §13.6). */
export function contagemLinha(l: LinhaEditorial): string {
  const total = l.itens_total ?? 0;
  const prod = l.itens_convertidos ?? 0;
  if (prod > 0) return `${prod} de ${total} em produção`;
  if (l.rodada > 0) return `${l.itens_aprovados ?? 0} de ${total} aprovados`;
  return `${total} ${total === 1 ? 'post' : 'posts'}`;
}
