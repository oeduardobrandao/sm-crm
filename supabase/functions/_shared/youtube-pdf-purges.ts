// Drains the `youtube_pdf_purges` queue: PDF objects of report snapshots whose YouTube data was
// purged (youtube_purge_channel clears `pdf_storage_path` and queues the path here). The object
// lives in the private `analytics-reports` bucket; removal is retried until it succeeds or
// `maxAttempts` is reached (then the row is kept for manual follow-up and logged once).

import { PDF_BUCKET } from "../report-docs/errors.ts";
import type { DbClient } from "./google.ts";

/** The slice of the Supabase storage client this module needs (`storage.from(bucket).remove`). */
export interface StorageLike {
  from(bucket: string): {
    remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
  };
}

interface PurgeRow {
  id: string;
  conta_id: string;
  storage_path: string;
  attempts: number | null;
}

const STORAGE_TIMEOUT_MS = 10_000;

/** Bounds a storage call that has no native abort: a hung promise never rejects on its own. */
async function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function drainYoutubePdfPurges(
  svc: DbClient,
  opts: { storage: StorageLike; contaId?: string; limit: number; maxAttempts: number; timeoutMs?: number },
): Promise<{ removed: number; failed: number; gaveUp: number }> {
  const out = { removed: 0, failed: 0, gaveUp: 0 };

  let query = svc.from("youtube_pdf_purges").select("id, conta_id, storage_path, attempts");
  if (opts.contaId) query = query.eq("conta_id", opts.contaId);
  const { data, error } = await query
    .lt("attempts", opts.maxAttempts)
    .order("created_at", { ascending: true })
    .limit(opts.limit);
  if (error) {
    console.error(`[youtube-pdf-purges] listing failed: ${error.message}`);
    return out;
  }

  for (const row of (data ?? []) as PurgeRow[]) {
    const attempts = Number(row.attempts) || 0;
    if (attempts >= opts.maxAttempts) {
      out.gaveUp += 1;
      console.error(`[youtube-pdf-purges] purge ${row.id} gave up after ${attempts} attempts; row kept`);
      continue;
    }

    let failure: string | null = null;
    try {
      // storage-js reports an absent object as success (no error), so any error is a failure.
      const { error: removeError } = await withTimeout(
        opts.storage.from(PDF_BUCKET).remove([row.storage_path]),
        opts.timeoutMs ?? STORAGE_TIMEOUT_MS,
        "storage remove",
      );
      if (removeError) failure = removeError.message;
    } catch (err) {
      failure = (err as Error).message;
    }

    if (failure === null) {
      const { error: delError } = await svc
        .from("youtube_pdf_purges")
        .delete()
        .eq("id", row.id)
        .eq("conta_id", row.conta_id);
      if (delError) {
        console.error(`[youtube-pdf-purges] purge ${row.id} delete failed: ${delError.message}`);
        out.failed += 1;
      } else {
        out.removed += 1;
      }
      continue;
    }

    const { error: updError } = await svc
      .from("youtube_pdf_purges")
      .update({ attempts: attempts + 1 })
      .eq("id", row.id)
      .eq("conta_id", row.conta_id);
    if (updError) console.error(`[youtube-pdf-purges] purge ${row.id} update failed: ${updError.message}`);
    // Count/log the give-up only when the bump was persisted (else the row is retried and re-reported).
    if (!updError && attempts + 1 >= opts.maxAttempts) {
      out.gaveUp += 1;
      console.error(`[youtube-pdf-purges] purge ${row.id} gave up after ${attempts + 1} attempts: ${failure}`);
    } else {
      out.failed += 1;
    }
  }
  return out;
}
