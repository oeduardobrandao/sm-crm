import { extractMentionsFromDoc } from '@/components/mentions/mentionTokens';
import type { PostEditSuggestion } from '@/store/posts';
import type { SuggestionField } from './editSuggestionFields';

/**
 * Member ids to hand to `syncMentions` after an accept, or `null` when the ledger must stay as
 * is. `accept_edit_suggestion` writes `conteudo` server-side, so the drawers re-sync mentions
 * from the suggested doc, but only when that doc actually landed: texto was applied, the doc
 * changed, and it is not the NULL doc of a caption-only suggestion. Keeping the team's texto
 * keeps its live mentions; syncing from the suggestion would wipe them.
 */
export function mentionIdsToSyncAfterAccept(
  suggestion: PostEditSuggestion,
  fields: SuggestionField[],
): number[] | null {
  if (
    !fields.includes('texto') ||
    !suggestion.changed_fields.includes('conteudo') ||
    suggestion.suggested_conteudo == null
  ) {
    return null;
  }
  return extractMentionsFromDoc(suggestion.suggested_conteudo)
    .filter((ref) => ref.entityType === 'membro')
    .map((ref) => ref.id);
}

export type AcceptErrorKind = 'changed' | 'conflict' | 'other';

/**
 * Which toast an `acceptEditSuggestion` failure gets. `changed`: the client saved a newer
 * version. `conflict`: the post moved since the card was loaded. Both refetch and ask for a new
 * review. PostgrestError is a plain object, not an Error instance.
 */
export function classifyAcceptError(err: unknown): AcceptErrorKind {
  const message = String((err as { message?: unknown } | null)?.message ?? '');
  if (message.includes('suggestion_changed')) return 'changed';
  if (message.includes('suggestion_conflict')) return 'conflict';
  return 'other';
}
