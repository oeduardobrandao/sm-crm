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

export type AcceptErrorKind =
  | 'changed'
  | 'conflict'
  | 'target_gone'
  | 'target_locked'
  | 'retry'
  | 'other';

/**
 * Which toast an `acceptEditSuggestion` failure gets. `changed`: the client saved a newer
 * version. `conflict`: the post moved since the card was loaded. `target_gone`: the TikTok or
 * Geral destination of a chosen caption was removed. `target_locked`: the TikTok destination is
 * publishing or published. Those four refetch and ask for a new review. `retry`: Postgres broke a
 * deadlock (40P01, a destination removed at the same moment); the RPC is safe to repeat.
 * PostgrestError is a plain object, not an Error instance: the RPC's own refusals arrive as P0001
 * with the tag in `message`, the deadlock as `code`.
 */
export function classifyAcceptError(err: unknown): AcceptErrorKind {
  const e = err as { message?: unknown; code?: unknown } | null | undefined;
  const message = String(e?.message ?? '');
  if (message.includes('suggestion_changed')) return 'changed';
  if (message.includes('suggestion_conflict')) return 'conflict';
  if (message.includes('target_gone')) return 'target_gone';
  if (message.includes('target_locked')) return 'target_locked';
  if (e?.code === '40P01') return 'retry';
  return 'other';
}

/**
 * The toast key (namespace `postEditor`) for the three destination-level refusals, or `null` for
 * the kinds each drawer words itself. `target_gone` names the destination when the accepted
 * fields leave no doubt which one it was.
 */
export function destinationAcceptErrorKey(
  kind: AcceptErrorKind,
  fields: SuggestionField[],
): string | null {
  if (kind === 'target_locked') return 'postEditor:suggestionReview.errors.targetLocked';
  if (kind === 'retry') return 'postEditor:suggestionReview.errors.retry';
  if (kind !== 'target_gone') return null;
  const tiktok = fields.includes('legenda_tiktok');
  const geral = fields.includes('legenda_geral');
  if (tiktok && !geral) return 'postEditor:suggestionReview.errors.targetGoneTiktok';
  if (geral && !tiktok) return 'postEditor:suggestionReview.errors.targetGoneGeral';
  return 'postEditor:suggestionReview.errors.targetGone';
}
