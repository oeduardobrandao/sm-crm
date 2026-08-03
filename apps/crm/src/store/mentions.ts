import { supabase } from './core';

export type MentionHostType = 'post_comment' | 'tarefa' | 'workflow_post';

/**
 * Syncs the `mencoes` ledger for one host row (a comment, tarefa, or
 * workflow_post) against the membro ids currently mentioned in its content.
 * Calls `sync_mentions`, which diffs against the existing ledger and fires
 * notifications for newly-added mentions (see 20260803000001_mencoes.sql).
 *
 * MUST be called even with an empty array on edit -- that is how a removed
 * `@membro` mention gets cleared from the ledger, since sync_mentions deletes
 * anything not in p_membro_ids.
 *
 * Fire-and-forget by design: a mention-sync failure is not a save failure.
 * The comment/tarefa/post row is already committed by the time this runs, so
 * this NEVER throws or rejects -- it only console.errors. Callers can `await`
 * it (it always resolves) without wrapping it in their own try/catch.
 */
export async function syncMentions(
  hostType: MentionHostType,
  hostId: number,
  membroIds: number[],
): Promise<void> {
  try {
    const { error } = await supabase.rpc('sync_mentions', {
      p_host_type: hostType,
      p_host_id: hostId,
      p_membro_ids: membroIds,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[mentions] sync_mentions failed:', err);
  }
}
