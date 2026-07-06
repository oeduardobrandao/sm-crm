// "Aplicar a um post" eligibility (design-first spec §Estúdio home): invalid targets are
// listed DISABLED with the reason — eligibility becomes visible, not a 403. Checks run in
// the same order design-manage validates (tipo → status → designed → video) so the shown
// reason always matches what the backend would raise for that post.

export const EDITABLE_STATUSES = [
  'rascunho',
  'revisao_interna',
  'correcao_cliente',
  'enviado_cliente',
];

const SUPPORTED_TIPOS = ['feed', 'carrossel', 'reels'];

export type IneligibleReason =
  | 'tipo_unsupported'
  | 'not_editable'
  | 'already_designed'
  | 'has_video'
  | null;

export function postEligibility(
  post: { id: number; tipo: string; status: string },
  designedPostIds: Set<number>,
  videoPostIds: Set<number>,
): IneligibleReason {
  if (!SUPPORTED_TIPOS.includes(post.tipo)) return 'tipo_unsupported';
  if (!EDITABLE_STATUSES.includes(post.status)) return 'not_editable';
  if (designedPostIds.has(post.id)) return 'already_designed';
  // Reels keep their video by design (the cover targets its thumbnail) — video only blocks
  // feed/carrossel, mirroring the handler's `tipo !== 'reels' && hasVideoMedia` check.
  if (post.tipo !== 'reels' && videoPostIds.has(post.id)) return 'has_video';
  return null;
}
