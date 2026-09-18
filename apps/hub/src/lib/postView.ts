import type { TFunction } from 'i18next';
import type { HubPost, HubPostMedia } from '../types';

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
};

/**
 * Presentational-only state (not a DB status): an `agendado` post whose scheduled
 * time already passed is being published right now.
 */
export function getPostPublishState(p: {
  status: HubPost['status'];
  scheduled_at: string | null;
}): string {
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

export type PostSortDirection = 'asc' | 'desc';

/**
 * Sorts by scheduled_at in the given direction. Unscheduled posts are always last, and
 * `ordem` breaks ties in the same direction, so 'desc' is the exact reverse of 'asc' for
 * every scheduled post. Returns a copy.
 */
export function sortPostsByScheduled(posts: HubPost[], direction: PostSortDirection): HubPost[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...posts].sort((a, b) => {
    if (!a.scheduled_at && !b.scheduled_at) return sign * (a.ordem - b.ordem);
    if (!a.scheduled_at) return 1;
    if (!b.scheduled_at) return -1;
    const diff = a.scheduled_at.localeCompare(b.scheduled_at);
    return diff !== 0 ? sign * diff : sign * (a.ordem - b.ordem);
  });
}

/** scheduled_at ascending, unscheduled last, `ordem` as the tiebreaker. Returns a copy. */
export function sortPostsChronologically(posts: HubPost[]): HubPost[] {
  return sortPostsByScheduled(posts, 'asc');
}
