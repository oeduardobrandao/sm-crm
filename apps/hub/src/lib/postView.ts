import type { TFunction } from 'i18next';
import type { HubPost } from '../types';

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
