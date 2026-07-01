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
