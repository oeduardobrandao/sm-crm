import { createClient } from "npm:@supabase/supabase-js@2";
import { deleteObject, listOrphanKeys } from "../_shared/r2.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createPostMediaCleanupCronHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();

Deno.serve(createPostMediaCleanupCronHandler({
  buildCorsHeaders,
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (_req, json) => {
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: pending } = await svc
      .from("post_media_deletions")
      .select("id, r2_key, attempts")
      .lt("attempts", 6)
      .order("enqueued_at", { ascending: true })
      .limit(500);

    let deleted = 0;
    let failed = 0;
    for (const row of pending ?? []) {
      try {
        await deleteObject(row.r2_key);
        await svc.from("post_media_deletions").delete().eq("id", row.id);
        deleted++;
      } catch (e) {
        failed++;
        await svc.from("post_media_deletions")
          .update({ attempts: (row.attempts ?? 0) + 1, last_error: (e as Error).message })
          .eq("id", row.id);
      }
    }

    const orphanCandidates = await listOrphanKeys("contas/", 24 * 60 * 60 * 1000);
    let orphansDeleted = 0;
    if (orphanCandidates.length > 0) {
      const [byMain, byThumb] = await Promise.all([
        svc.from("post_media").select("r2_key, thumbnail_r2_key").in("r2_key", orphanCandidates),
        svc.from("post_media").select("r2_key, thumbnail_r2_key").in("thumbnail_r2_key", orphanCandidates),
      ]);
      const known = new Set<string>();
      for (const row of [...(byMain.data ?? []), ...(byThumb.data ?? [])]) {
        if (row.r2_key) known.add(row.r2_key);
        if (row.thumbnail_r2_key) known.add(row.thumbnail_r2_key);
      }
      for (const key of orphanCandidates) {
        if (known.has(key)) continue;
        try {
          await deleteObject(key);
          orphansDeleted++;
        } catch {
          // swallow and retry on the next run
        }
      }
    }

    return json({ deleted, failed, orphansDeleted });
  },
}));
