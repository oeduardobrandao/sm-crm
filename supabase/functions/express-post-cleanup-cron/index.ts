import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(async (req: Request) => {
  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

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
      return new Response(JSON.stringify({ success: true, deleted: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let deleted = 0;
    let skipped = 0;

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
        fileIds = (links ?? []).map((l: { file_id: number }) => l.file_id);
      }

      const { error: delErr } = await supabase
        .from("workflows")
        .delete()
        .eq("id", wf.id);

      if (delErr) {
        console.error(`Failed to delete workflow ${wf.id}:`, delErr.message);
        continue;
      }

      for (const fileId of fileIds) {
        const { data: file } = await supabase
          .from("files")
          .select("id, reference_count")
          .eq("id", fileId)
          .maybeSingle();

        if (file && file.reference_count <= 0) {
          await supabase.from("files").delete().eq("id", fileId);
        }
      }

      deleted++;
    }

    return new Response(JSON.stringify({ success: true, deleted, skipped }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Express post cleanup failed:", message);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
