import type { TFunction } from 'i18next';
import type { EmProducaoReason, HubPost, HubPostMedia } from '../types';

export type { EmProducaoReason };

/** Statuses a client is allowed to see in the Hub (mirrors PostagensPage). */
export const VISIBLE_STATUSES = new Set<HubPost['status']>([
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
  'agendado',
  'postado',
  'falha_publicacao',
]);

export function isClientVisible(status: HubPost['status']): boolean {
  return VISIBLE_STATUSES.has(status);
}

/** Statuses the agency works in; hidden from the client unless the post is em produção. */
export const INTERNAL_STATUSES = new Set<HubPost['status']>([
  'rascunho',
  'revisao_interna',
  'aprovado_interno',
]);

type ProductionFields = { status: HubPost['status']; em_producao?: EmProducaoReason | null };

/** The client already saw this post and the agency is working on it again. */
export function isInProduction(p: ProductionFields): boolean {
  return !!p.em_producao && INTERNAL_STATUSES.has(p.status);
}

/** Post-level visibility: the status set plus in-production posts (read-only). */
export function isPostClientVisible(p: ProductionFields): boolean {
  return VISIBLE_STATUSES.has(p.status) || isInProduction(p);
}

/** Status key for labels: 'em_producao' for in-production posts, the DB status otherwise. */
export function clientStatusOf(p: ProductionFields): string {
  return isInProduction(p) ? 'em_producao' : p.status;
}

/** Media-first card selection, identical to the Postagens/Aprovações lists. */
export function pickPostCardKind(post: HubPost): 'instagram' | 'story' | 'text' {
  if ((post.media?.length ?? 0) === 0) return 'text';
  return post.tipo === 'stories' ? 'story' : 'instagram';
}

/** Client-facing labels shared by the post cards and the Mensagens hover preview.
 * (PostagensPage keeps a local copy with colors; these are the plain-text halves.) */
export const CLIENT_STATUS_LABELS: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  publicando: 'Publicando…',
  postado: 'Publicado',
  falha_publicacao: 'Falha na publicação',
  em_producao: 'Em produção',
};

export const TIPO_LABELS: Record<HubPost['tipo'], string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};

/** Translated equivalent of `CLIENT_STATUS_LABELS` — takes the caller's `t` (from
 * `useTranslation('hubPostCard')` or the `@mesaas/i18n` singleton) instead of a hook of
 * its own, so it works from both components and plain modules. */
export function getClientStatusLabel(t: TFunction, status: string): string {
  const labels: Record<string, string> = {
    enviado_cliente: t('hubPostCard:status.enviado_cliente', 'Aguardando aprovação'),
    aprovado_cliente: t('hubPostCard:status.aprovado_cliente', 'Aprovado'),
    correcao_cliente: t('hubPostCard:status.correcao_cliente', 'Correção solicitada'),
    agendado: t('hubPostCard:status.agendado', 'Agendado'),
    publicando: t('hubPostCard:status.publicando', 'Publicando…'),
    postado: t('hubPostCard:status.postado', 'Publicado'),
    falha_publicacao: t('hubPostCard:status.falha_publicacao', 'Falha na publicação'),
    em_producao: t('hubPostCard:status.em_producao', 'Em produção'),
  };
  return labels[status] ?? status;
}

/** Translated equivalent of `TIPO_LABELS` — see `getClientStatusLabel`. */
export function getTipoLabel(t: TFunction, tipo: string): string {
  const labels: Record<string, string> = {
    feed: t('hubPostCard:tipo.feed', 'Feed'),
    reels: t('hubPostCard:tipo.reels', 'Reels'),
    stories: t('hubPostCard:tipo.stories', 'Stories'),
    carrossel: t('hubPostCard:tipo.carrossel', 'Carrossel'),
  };
  return labels[tipo] ?? tipo;
}

/** Status colours shared by the tile pill and the dialog header (moved from PostagensPage). */
export const STATUS_COLORS: Record<string, string> = {
  enviado_cliente: '#f5a342',
  aprovado_cliente: '#3ecf8e',
  correcao_cliente: '#f55a42',
  agendado: '#42c8f5',
  publicando: '#E1306C',
  postado: '#525252',
  falha_publicacao: '#f55a42',
  em_producao: '#8b5cf6',
};

/**
 * Presentational-only state (not a DB status): an `agendado` post whose scheduled
 * time already passed is being published right now.
 */
export function getPostPublishState(p: {
  status: HubPost['status'];
  scheduled_at: string | null;
  em_producao?: EmProducaoReason | null;
}): string {
  if (isInProduction(p)) return 'em_producao';
  return p.status === 'agendado' && !!p.scheduled_at && new Date(p.scheduled_at) <= new Date()
    ? 'publicando'
    : p.status;
}

/** Tile/strip image: the flagged cover, else the first media item. */
export function getPostCover(post: HubPost): HubPostMedia | null {
  return post.cover_media ?? post.media?.[0] ?? null;
}

/**
 * The caption the client actually sees: the explicit caption when non-empty,
 * otherwise the text after "LEGENDA" in `conteudo_plain`, otherwise the whole
 * `conteudo_plain`. Same rule the old cards used, kept in one place.
 */
export function deriveCaption(post: HubPost, igCaption: string | null): string {
  if (igCaption) return igCaption;
  const rawText = post.conteudo_plain ?? '';
  const legendaIdx = rawText.toUpperCase().indexOf('LEGENDA');
  return legendaIdx !== -1
    ? rawText
        .slice(legendaIdx + 'LEGENDA'.length)
        .replace(/^[:\s\n]+/, '')
        .trim()
    : rawText;
}

/**
 * A media post's full text is worth its own tab only when it says more than the caption
 * the Legenda tab already shows.
 */
export function hasDistinctPostText(post: HubPost): boolean {
  const body = (post.conteudo_plain ?? '').trim();
  if (!body) return false;
  return body !== deriveCaption(post, post.ig_caption).trim();
}

export type PostSortDirection = 'asc' | 'desc';

/**
 * 'asc' is scheduled_at ascending, unscheduled last, `ordem` as the tiebreaker. 'desc' is the
 * exact reverse of that list, so unscheduled posts come first. Returns a copy.
 */
export function sortPostsByScheduled(posts: HubPost[], direction: PostSortDirection): HubPost[] {
  const asc = [...posts].sort((a, b) => {
    if (!a.scheduled_at && !b.scheduled_at) return a.ordem - b.ordem;
    if (!a.scheduled_at) return 1;
    if (!b.scheduled_at) return -1;
    return a.scheduled_at.localeCompare(b.scheduled_at) || a.ordem - b.ordem;
  });
  return direction === 'asc' ? asc : asc.reverse();
}

/** scheduled_at ascending, unscheduled last, `ordem` as the tiebreaker. Returns a copy. */
export function sortPostsChronologically(posts: HubPost[]): HubPost[] {
  return sortPostsByScheduled(posts, 'asc');
}

/** Filter value meaning "no month filter". Never collides with a `YYYY-MM` key or `none`. */
export const ALL_MONTHS = 'all';
/** Bucket key for posts without a usable date. */
export const NO_MONTH = 'none';

/**
 * `YYYY-MM` of the date the Hub shows on the post (`scheduled_at`, the same field the tile
 * and dialog chips format), or `none`. Read in the viewer's local timezone because that is
 * what `formatDate` (toLocaleDateString without a timeZone) renders, so a post shown as
 * "30 de abr." is never filed under May just because its UTC instant crossed midnight.
 */
export function getPostMonthKey(post: { scheduled_at: string | null }): string {
  if (!post.scheduled_at) return NO_MONTH;
  const d = new Date(post.scheduled_at);
  if (Number.isNaN(d.getTime())) return NO_MONTH;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function countPostsByMonth(posts: { scheduled_at: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const key = getPostMonthKey(p);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface PostMonthGroup {
  key: string;
  count: number;
}

/** One group per month with a post, newest month first; the dateless bucket goes last. */
export function groupPostsByMonth(posts: { scheduled_at: string | null }[]): PostMonthGroup[] {
  return [...countPostsByMonth(posts)]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => {
      if (a.key === NO_MONTH) return 1;
      if (b.key === NO_MONTH) return -1;
      return b.key.localeCompare(a.key);
    });
}

/** "Setembro de 2026" for `2026-09`: localized long month + year, first letter capitalized. */
export function formatMonthKey(key: string, lang: string): string {
  const [year, month] = key.split('-').map(Number);
  const label = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1),
  );
  return label.charAt(0).toLocaleUpperCase(lang) + label.slice(1);
}
