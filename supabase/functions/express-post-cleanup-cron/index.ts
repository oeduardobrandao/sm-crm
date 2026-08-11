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

      // Conclusion pass: an approval-mode express post publishes only after the
      // client approves, with nobody left on the page to conclude the workflow
      // (publish-now mode concludes it client-side). Close any express workflow
      // whose posts were all published so it doesn't linger on the board.
      // Candidates come from the posts' is_express marker, never from the
      // workflow title: the title is user-editable in the drawer, so it can
      // both falsely match a renamed regular workflow and miss a renamed
      // express one.
      let concluded = 0;
      const { data: expressPostRows, error: expressErr } = await supabase
        .from("workflow_posts")
        .select("workflow_id")
        .eq("is_express", true)
        .eq("status", "postado");

      if (expressErr) throw expressErr;

      const candidateIds = [
        ...new Set((expressPostRows ?? []).map((r: { workflow_id: number }) => r.workflow_id)),
      ];

      if (candidateIds.length > 0) {
        const { data: activeExpress, error: activeErr } = await supabase
          .from("workflows")
          .select("id")
          .in("id", candidateIds)
          .eq("status", "ativo");

        if (activeErr) throw activeErr;

        for (const wf of activeExpress ?? []) {
          const { data: posts } = await supabase
            .from("workflow_posts")
            .select("id, status, is_express")
            .eq("workflow_id", wf.id);

          // Conclude only when every post is a published express post; a mixed
          // workflow (someone added a regular post to it) is left alone.
          const allExpressPostado = (posts ?? []).length > 0 &&
            (posts ?? []).every(
              (p: { status: string; is_express: boolean }) =>
                p.status === "postado" && p.is_express === true,
            );
          if (!allExpressPostado) continue;

          const { error: concludeErr } = await supabase
            .from("workflows")
            .update({ status: "concluido" })
            .eq("id", wf.id);

          if (concludeErr) {
            console.error(`Failed to conclude workflow ${wf.id}:`, concludeErr.message);
            continue;
          }
          concluded++;
        }
      }

      const { data: orphanWorkflows, error: fetchErr } = await supabase
        .from("workflows")
        .select("id")
        .like("titulo", "Post Express -%")
        .eq("status", "ativo")
        .lt("created_at", cutoff);

      if (fetchErr) throw fetchErr;
      if (!orphanWorkflows || orphanWorkflows.length === 0) {
        return json({ success: true, deleted: 0, concluded });
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

      return json({ success: true, deleted, skipped, failed, concluded });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Express post cleanup failed:", message);
      return json({ error: "Internal server error" }, 500);
    }
  },
}));
