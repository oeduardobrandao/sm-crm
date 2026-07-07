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

// ---------- "Tornar editável no Estúdio" entry-point gating (Task 6, slice C) ----------

// design-import only supports feed/carrossel — the design it creates IS the post's frames,
// unlike reel covers (which target the thumbnail only) or stories (unsupported entirely).
const IMPORT_SUPPORTED_TIPOS = ['feed', 'carrossel'];

/** Whether WorkflowDrawer should offer "Tornar editável no Estúdio" for this post. Mirrors
 * the gating the drawer applies before wiring `onMakeEditable` onto PostMediaGallery:
 * feature flags fail-open (same pattern as feature_estudio elsewhere), no design already
 * attached, tipo in feed|carrossel, and the post status still editable. Video-media
 * ineligibility is NOT checked here — PostMediaGallery owns that check itself (it has the
 * media list; this helper doesn't), per the brief. */
export function canMakeEditable(
  post: { tipo: string; status: string },
  opts: { estudioBlocked: boolean; aiImagesBlocked: boolean; hasDesign: boolean },
): boolean {
  if (opts.estudioBlocked) return false;
  if (opts.aiImagesBlocked) return false;
  if (opts.hasDesign) return false;
  if (!IMPORT_SUPPORTED_TIPOS.includes(post.tipo)) return false;
  if (!EDITABLE_STATUSES.includes(post.status)) return false;
  return true;
}

/** Held ≠ ownership (slice C, design-import): a design born with `media_apply_held` does NOT
 * own the post's media until the user's first save in the editor. WorkflowDrawer uses this to
 * decide what `PostMediaGallery` and the drawer's info banner should show — the gallery must
 * stay unlocked while held (only pass `design` down once ownership is real), and the drawer
 * shows an informational banner in its place. */
export function galleryDesignForHeld<T extends { media_apply_held: boolean } | null>(
  designSummary: T,
): T | null {
  if (designSummary === null) return null;
  return designSummary.media_apply_held ? null : designSummary;
}

export function shouldShowHeldInfoBanner(
  designSummary: { media_apply_held: boolean } | null,
): boolean {
  return designSummary?.media_apply_held === true;
}
