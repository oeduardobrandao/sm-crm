import { createClient } from "npm:@supabase/supabase-js@2";
import { deleteObject, listOrphanKeys } from "../_shared/r2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = { "Access-Control-Allow-Origin": "*" };
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async () => {
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Drain the deletion queue
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

  // 2. Orphan sweep: list objects under contas/ older than 24h with no matching row
  const orphanCandidates = await listOrphanKeys("contas/", 24 * 60 * 60 * 1000);
  let orphansDeleted = 0;
  if (orphanCandidates.length > 0) {
    const { data: existing } = await svc
      .from("post_media")
      .select("r2_key, thumbnail_r2_key")
      .in("r2_key", orphanCandidates);
    const known = new Set<string>();
    for (const r of existing ?? []) {
      if (r.r2_key) known.add(r.r2_key);
      if (r.thumbnail_r2_key) known.add(r.thumbnail_r2_key);
    }
    for (const key of orphanCandidates) {
      if (known.has(key)) continue;
      try { await deleteObject(key); orphansDeleted++; } catch { /* swallow; retry next run */ }
    }
  }

  return json({ deleted, failed, orphansDeleted });
});
