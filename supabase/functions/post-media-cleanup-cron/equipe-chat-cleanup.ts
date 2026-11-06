// equipe-chat (team group chats): two cleanup legs run by post-media-cleanup-cron,
// mirroring orphan-scan.ts / stream-steps.ts in shape — each leg is wrapped so one
// leg's (or one row's) failure can never block the other.
//
// Leg 1, tmp sweep: a blind, safe scan of the presigned-upload staging prefix.
// equipe-chat-media finalize copies the object out of equipe-chat-tmp/ right after
// upload; anything still sitting there >24h means finalize never ran (client
// abandoned the upload, or the copy itself failed and the client re-sent) — always
// safe to trash.
//
// Leg 2, staged reap: equipe_mensagem_anexos rows with mensagem_id IS NULL are
// "staged" — the upload finalized but the message was never sent. Past 24h old,
// equipe_chat_anexo_release(id) deletes the row and refunds the workspace's storage
// quota IN THE SAME TRANSACTION, then returns the r2_key it just released. It
// returns NULL when the send won the race (message_id got set, or the row is
// already gone) — that NULL means do NOT trash anything, the attachment is now
// live under a sent message.

interface DbError {
  message: string;
}

export interface EquipeChatCleanupDeps {
  db: {
    from(table: "equipe_mensagem_anexos"): {
      select(columns: string): {
        is(
          column: string,
          value: null,
        ): {
          lt(
            column: string,
            value: string,
          ): {
            limit(n: number): PromiseLike<{
              data: Array<{ id: number }> | null;
              error: DbError | null;
            }>;
          };
        };
      };
    };
    rpc(
      fn: "equipe_chat_anexo_release",
      params: { p_anexo_id: number },
    ): PromiseLike<{ data: string | null; error: DbError | null }>;
  };
  listOrphanKeys(prefix: string, olderThanMs: number): Promise<string[]>;
  /** Two-phase remove (copy to trash/ then delete) — never a hard delete. */
  trashObject(key: string): Promise<void>;
  /** Injectable clock for tests; defaults to Date.now. */
  nowMs?: () => number;
}

export interface EquipeChatCleanupResult {
  /** Abandoned equipe-chat-tmp/ uploads moved to trash/ this run. */
  tmpTrashed: number;
  /** Staged attachments released (and trashed) because they aged out unsent. */
  stagedReleased: number;
  /** Any per-step or per-row failure this run — logged and skipped, never rethrown. */
  failed: number;
}

export const TMP_PREFIX = "equipe-chat-tmp/";
export const STAGED_AGE_MS = 24 * 60 * 60 * 1000;
export const STAGED_BATCH = 500;

export async function runEquipeChatCleanup(deps: EquipeChatCleanupDeps): Promise<EquipeChatCleanupResult> {
  const nowMs = deps.nowMs ?? (() => Date.now());
  let tmpTrashed = 0;
  let stagedReleased = 0;
  let failed = 0;

  try {
    const tmpKeys = await deps.listOrphanKeys(TMP_PREFIX, STAGED_AGE_MS);
    for (const key of tmpKeys) {
      try {
        await deps.trashObject(key);
        tmpTrashed++;
      } catch (e) {
        failed++;
        console.error("equipe-chat-cleanup:tmp-sweep", key, (e as Error).message);
      }
    }
  } catch (e) {
    failed++;
    console.error("equipe-chat-cleanup:tmp-list", (e as Error).message);
  }

  const cutoffIso = new Date(nowMs() - STAGED_AGE_MS).toISOString();
  const { data: staged, error: stagedErr } = await deps.db
    .from("equipe_mensagem_anexos")
    .select("id")
    .is("mensagem_id", null)
    .lt("created_at", cutoffIso)
    .limit(STAGED_BATCH);
  if (stagedErr) {
    failed++;
    console.error("equipe-chat-cleanup:staged-list", stagedErr.message);
  }

  for (const row of staged ?? []) {
    try {
      const { data: releasedKey, error: relErr } = await deps.db.rpc("equipe_chat_anexo_release", {
        p_anexo_id: row.id,
      });
      if (relErr) throw new Error(relErr.message);
      if (releasedKey) {
        await deps.trashObject(releasedKey);
        stagedReleased++;
      }
    } catch (e) {
      failed++;
      console.error("equipe-chat-cleanup:staged-reap", row.id, (e as Error).message);
    }
  }

  return { tmpTrashed, stagedReleased, failed };
}
