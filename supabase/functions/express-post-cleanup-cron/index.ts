import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createExpressPostCleanupCronHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createExpressPostCleanupCronHandler({
  buildCorsHeaders,
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (_req, json) => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: orphanWorkflows, error: fetchErr } = await supabase
        .from("workflows")
        .select("id")
        .like("titulo", "Post Express -%")
        .eq("status", "ativo")
        .lt("created_at", cutoff);

      if (fetchErr) throw fetchErr;
      if (!orphanWorkflows || orphanWorkflows.length === 0) {
        return json({ success: true, deleted: 0 });
      }

      let deleted = 0;
      let skipped = 0;
      let failed = 0;

      for (const wf of orphanWorkflows) {
        const { data: posts } = await supabase
          .from("workflow_posts")
          .select("id, status")
          .eq("workflow_id", wf.id);

        const allRascunho = (posts ?? []).every((p: { status: string }) => p.status === "rascunho");
        if (!allRascunho) {
          skipped++;
          continue;
        }

        const postIds = (posts ?? []).map((p: { id: number }) => p.id);

        let fileIds: number[] = [];
        if (postIds.length > 0) {
          const { data: links } = await supabase
            .from("post_file_links")
            .select("file_id")
            .in("post_id", postIds);
          fileIds = [...new Set((links ?? []).map((l: { file_id: number }) => l.file_id))];
        }

        const { error: delErr } = await supabase
          .from("workflows")
          .delete()
          .eq("id", wf.id);

        if (delErr) {
          console.error(`Failed to delete workflow ${wf.id}:`, delErr.message);
          failed++;
          continue;
        }

        if (fileIds.length > 0) {
          const { data: orphanFiles } = await supabase
            .from("files")
            .select("id")
            .in("id", fileIds)
            .lte("reference_count", 0);

          for (const f of orphanFiles ?? []) {
            const { error: fileDelErr } = await supabase.from("files").delete().eq("id", f.id);
            if (fileDelErr) {
              console.error(`Failed to delete orphan file ${f.id}:`, fileDelErr.message);
            }
          }
        }

        deleted++;
      }

      return json({ success: true, deleted, skipped, failed });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Express post cleanup failed:", message);
      return json({ error: "Internal server error" }, 500);
    }
  },
}));
