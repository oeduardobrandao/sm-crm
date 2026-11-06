import { extractR2Keys } from '@/services/inlineImage';
// Types only: the drawer test harnesses mock '@/store/posts' with a fixed export list.
import type { PostEditSuggestion, SuggestionField, WorkflowPost } from '@/store/posts';

export type { SuggestionField };

/** Canonical order: how the review card, the dialog and `p_fields` list them. */
export const SUGGESTION_FIELDS: readonly SuggestionField[] = [
  'texto',
  'legenda',
  'legenda_tiktok',
  'legenda_geral',
];

export interface SuggestionFieldState {
  field: SuggestionField;
  /** The client changed this field (read from the server-computed `changed_fields`). */
  changed: boolean;
  /** The client changed it AND the live post no longer matches the base the client started from. */
  conflict: boolean;
  /**
   * The live value is still loading (the Geral caption lives in `post_targets`, fetched apart):
   * conflict is unknown, so the field can be neither judged nor applied yet.
   */
  pending: boolean;
  /**
   * The destination the client wrote for is gone (the Geral row was removed, or removed and added
   * again): accept would refuse it with `target_gone`, so it is not offered.
   */
  gone: boolean;
}

/** The live Geral row: `undefined` = not loaded yet, `null` = the post has no Geral destination. */
export interface LiveGeralTarget {
  id: number;
  caption: string | null;
}

export type SuggestionLivePost = Pick<
  WorkflowPost,
  'conteudo' | 'conteudo_plain' | 'ig_caption' | 'tiktok_caption'
> & {
  geral?: LiveGeralTarget | null;
};

export type CaptionField = Exclude<SuggestionField, 'texto'>;

/** The `changed_fields` column each caption field is recorded under. */
const CAPTION_COLUMN: Record<CaptionField, string> = {
  legenda: 'ig_caption',
  legenda_tiktok: 'tiktok_caption',
  legenda_geral: 'geral_caption',
};

function sameKeySet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((k) => sb.has(k));
}

/**
 * Has the live texto moved away from `original_*`? Plain text differs, or the inline-image key set
 * differs. Formatting-only drift is NOT a difference: TipTap round-trips rewrite the jsonb, an added
 * or removed image is real. A NULL base (row created before the base was kept) reads as empty.
 */
function textoDiffersFromBase(post: SuggestionLivePost, s: PostEditSuggestion): boolean {
  if ((post.conteudo_plain ?? '') !== (s.original_conteudo_plain ?? '')) return true;
  return !sameKeySet(extractR2Keys(post.conteudo ?? null), extractR2Keys(s.original_conteudo));
}

/** The live value of a caption field. `undefined` only for Geral while it loads. */
export function liveCaption(
  post: SuggestionLivePost,
  field: CaptionField,
): string | null | undefined {
  if (field === 'legenda') return post.ig_caption ?? null;
  if (field === 'legenda_tiktok') return post.tiktok_caption ?? null;
  if (post.geral === undefined) return undefined;
  return post.geral?.caption ?? null;
}

export function originalCaption(s: PostEditSuggestion, field: CaptionField): string | null {
  if (field === 'legenda') return s.original_ig_caption;
  if (field === 'legenda_tiktok') return s.original_tiktok_caption ?? null;
  return s.original_geral_caption ?? null;
}

export function suggestedCaption(s: PostEditSuggestion, field: CaptionField): string | null {
  if (field === 'legenda') return s.suggested_ig_caption;
  if (field === 'legenda_tiktok') return s.suggested_tiktok_caption ?? null;
  return s.suggested_geral_caption ?? null;
}

/** Captions compare as `COALESCE(x, '')`, the RPC's rule. */
function captionDiffersFromBase(
  post: SuggestionLivePost,
  s: PostEditSuggestion,
  field: CaptionField,
): boolean {
  return (liveCaption(post, field) ?? '') !== (originalCaption(s, field) ?? '');
}

function changedByClient(s: PostEditSuggestion, field: SuggestionField): boolean {
  if (field !== 'texto') return s.changed_fields.includes(CAPTION_COLUMN[field]);
  // A `conteudo` entry with a NULL suggested doc is the legacy ::text-compare artefact of a
  // caption-only Story suggestion (null vs the existing doc): there is nothing to apply, so the
  // CRM does not offer texto. A changed `conteudo_plain` is a real text change on its own.
  return (
    s.changed_fields.includes('conteudo_plain') ||
    (s.changed_fields.includes('conteudo') && s.suggested_conteudo != null)
  );
}

/** Geral row removed, or removed and added again (another id than the one the client wrote for). */
function geralGone(post: SuggestionLivePost, s: PostEditSuggestion): boolean {
  if (post.geral === undefined) return false;
  if (post.geral === null) return true;
  return s.geral_target_id != null && post.geral.id !== s.geral_target_id;
}

/** The Geral row out of a destination list; `undefined` while the list is not loaded. */
export function geralFromTargets(
  targets: readonly { id: number; platform: string; caption: string | null }[] | undefined,
): LiveGeralTarget | null | undefined {
  if (!targets) return undefined;
  const row = targets.find((t) => t.platform === 'geral');
  return row ? { id: row.id, caption: row.caption } : null;
}

/** Whether the client's suggestion touches the Geral caption (the CRM must fetch it to judge). */
export function suggestionTouchesGeral(s: PostEditSuggestion | null | undefined): boolean {
  return s?.changed_fields.includes(CAPTION_COLUMN.legenda_geral) === true;
}

/** One entry per logical field, in canonical order. Mirrors accept_edit_suggestion's rules. */
export function suggestionFieldStates(
  post: SuggestionLivePost,
  s: PostEditSuggestion,
): SuggestionFieldState[] {
  return SUGGESTION_FIELDS.map((field) => {
    const changed = changedByClient(s, field);
    if (field === 'texto') {
      return {
        field,
        changed,
        conflict: changed && textoDiffersFromBase(post, s),
        pending: false,
        gone: false,
      };
    }
    // Never judge a conflict against a value that has not arrived.
    const pending = changed && liveCaption(post, field) === undefined;
    const gone = changed && field === 'legenda_geral' && geralGone(post, s);
    return {
      field,
      changed,
      conflict: changed && !pending && !gone && captionDiffersFromBase(post, s, field),
      pending,
      gone,
    };
  });
}

/** Changed, judged and still there: what accept can send. */
export function isApplicable(st: SuggestionFieldState): boolean {
  return st.changed && !st.pending && !st.gone;
}

/**
 * The Aceitar button: enabled when something can be applied and no changed field is still
 * loading; "Aceitar…" (dialog first) when any field conflicts.
 */
export function acceptAvailability(states: SuggestionFieldState[]): {
  canAccept: boolean;
  needsReview: boolean;
} {
  return {
    canAccept: !states.some((st) => st.changed && st.pending) && states.some(isApplicable),
    needsReview: states.some((st) => st.conflict),
  };
}

/**
 * Fields the client did not change but the team did since the suggestion was sent: accept leaves
 * them alone, and the card footer says so. For a field the client did not change, `original_*` is
 * kept equal to the live value at the last save, so a difference means a later team edit. A NULL
 * base reads as empty for texto and the Instagram caption (a post with no caption stores NULL).
 * TikTok and Geral are only judged with a stored base: rows saved before those columns existed
 * keep them NULL, and reading that as "empty" would blame the team for every caption already
 * there.
 */
export function teamOnlyChangedFields(
  post: SuggestionLivePost,
  s: PostEditSuggestion,
): SuggestionField[] {
  const out: SuggestionField[] = [];
  if (!changedByClient(s, 'texto') && textoDiffersFromBase(post, s)) out.push('texto');
  for (const field of ['legenda', 'legenda_tiktok', 'legenda_geral'] as const) {
    if (changedByClient(s, field)) continue;
    if (field !== 'legenda' && originalCaption(s, field) == null) continue;
    if (liveCaption(post, field) === undefined) continue;
    if (captionDiffersFromBase(post, s, field)) out.push(field);
  }
  return out;
}

/**
 * The fields the post can carry, for the "sem alterações do cliente" line: texto always, each
 * caption only when the post goes to that destination. `targets` is the destination list when the
 * editor has it (multiplatform); otherwise Instagram and TikTok come from the derived `platform`,
 * and Geral from the live row when it was fetched.
 */
export function reviewableFields(
  post: Pick<WorkflowPost, 'platform'> & Pick<SuggestionLivePost, 'geral'>,
  targets: readonly string[] | undefined,
): SuggestionField[] {
  const platform = post.platform ?? 'instagram';
  const has = (p: 'instagram' | 'tiktok' | 'geral') => {
    if (targets) return targets.includes(p);
    if (p === 'instagram') return platform === 'instagram' || platform === 'both';
    if (p === 'tiktok') return platform === 'tiktok' || platform === 'both';
    return post.geral != null;
  };
  return SUGGESTION_FIELDS.filter((f) => {
    if (f === 'texto') return true;
    if (f === 'legenda') return has('instagram');
    if (f === 'legenda_tiktok') return has('tiktok');
    return has('geral');
  });
}

/**
 * The client rewrote the Instagram caption while TikTok followed it, and TikTok now has a caption
 * of its own (`''` included: an emptied field is still TikTok's own): accepting changes Instagram
 * only, not the TikTok text the client saw changing along.
 */
export function tiktokNoLongerFollowsIg(post: SuggestionLivePost, s: PostEditSuggestion): boolean {
  return (
    s.tiktok_followed_ig === true &&
    changedByClient(s, 'legenda') &&
    post.tiktok_caption !== null &&
    post.tiktok_caption !== undefined
  );
}
