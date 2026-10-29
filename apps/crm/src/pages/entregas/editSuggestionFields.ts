import { extractR2Keys } from '@/services/inlineImage';
import type { PostEditSuggestion, SuggestionField, WorkflowPost } from '@/store/posts';

export type { SuggestionField };

export interface SuggestionFieldState {
  field: SuggestionField;
  /** The client changed this field (read from the server-computed `changed_fields`). */
  changed: boolean;
  /** The client changed it AND the live post no longer matches the base the client started from. */
  conflict: boolean;
}

type LivePost = Pick<WorkflowPost, 'conteudo' | 'conteudo_plain' | 'ig_caption'>;

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
function textoDiffersFromBase(post: LivePost, s: PostEditSuggestion): boolean {
  if ((post.conteudo_plain ?? '') !== (s.original_conteudo_plain ?? '')) return true;
  return !sameKeySet(extractR2Keys(post.conteudo ?? null), extractR2Keys(s.original_conteudo));
}

function legendaDiffersFromBase(post: LivePost, s: PostEditSuggestion): boolean {
  return (post.ig_caption ?? '') !== (s.original_ig_caption ?? '');
}

function changedByClient(s: PostEditSuggestion, field: SuggestionField): boolean {
  return field === 'texto'
    ? s.changed_fields.includes('conteudo') || s.changed_fields.includes('conteudo_plain')
    : s.changed_fields.includes('ig_caption');
}

/** Always two entries, texto first. Mirrors accept_edit_suggestion's rules. */
export function suggestionFieldStates(
  post: LivePost,
  s: PostEditSuggestion,
): SuggestionFieldState[] {
  const texto = changedByClient(s, 'texto');
  const legenda = changedByClient(s, 'legenda');
  return [
    { field: 'texto', changed: texto, conflict: texto && textoDiffersFromBase(post, s) },
    { field: 'legenda', changed: legenda, conflict: legenda && legendaDiffersFromBase(post, s) },
  ];
}

/**
 * Fields the client did not change but the team did since the suggestion was sent: accept leaves
 * them alone, and the card footer says so. For a field the client did not change, `original_*` is
 * kept equal to the live value at the last save, so a difference means a later team edit. A NULL
 * base reads as empty (a post with no caption stores NULL), same as for conflicts.
 */
export function teamOnlyChangedFields(post: LivePost, s: PostEditSuggestion): SuggestionField[] {
  const out: SuggestionField[] = [];
  if (!changedByClient(s, 'texto') && textoDiffersFromBase(post, s)) out.push('texto');
  if (!changedByClient(s, 'legenda') && legendaDiffersFromBase(post, s)) out.push('legenda');
  return out;
}
