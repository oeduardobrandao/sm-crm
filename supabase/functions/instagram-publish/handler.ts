// supabase/functions/instagram-publish/handler.ts

import { createJsonResponder } from "../_shared/http.ts";
import { validateForScheduling } from "../_shared/instagram-publish-utils.ts";

type DbClient = { from: (table: string) => any };

interface PublishHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: (token: string) => DbClient;
  createServiceDb: () => DbClient;
}

export function createPublishHandler(deps: PublishHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const jwt = authHeader.slice(7);

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Expected: /instagram-publish/{action}/{postId}
    const action = pathParts[1]; // schedule | cancel | retry
    const postId = parseInt(pathParts[2], 10);

    if (isNaN(postId)) return json({ error: "Invalid post ID" }, 400);
    if (!["schedule", "cancel", "retry"].includes(action)) {
      return json({ error: "Invalid action" }, 400);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const userDb = deps.createDb(jwt);
    const svcDb = deps.createServiceDb();

    // Verify post exists and user has access (via RLS)
    const { data: post } = await userDb
      .from("workflow_posts")
      .select("id, status, workflow_id, scheduled_at, ig_caption, instagram_container_id, publish_retry_count")
      .eq("id", postId)
      .single();

    if (!post) return json({ error: "Post não encontrado." }, 404);

    if (action === "schedule") {
      if (post.status !== "aprovado_cliente") {
        return json({ error: "Post precisa estar aprovado pelo cliente para agendar." }, 422);
      }
      const validation = await validateForScheduling(svcDb, postId);
      if (!validation.ok) {
        return json({ error: "Validação falhou", details: validation.errors }, 422);
      }
      await svcDb.from("workflow_posts")
        .update({ status: "agendado" })
        .eq("id", postId);
      return json({ ok: true, status: "agendado" });
    }

    if (action === "cancel") {
      if (post.status !== "agendado") {
        return json({ error: "Apenas posts agendados podem ser cancelados." }, 422);
      }
      await svcDb.from("workflow_posts").update({
        status: "aprovado_cliente",
        instagram_container_id: null,
        publish_processing_at: null,
        publish_error: null,
      }).eq("id", postId);
      return json({ ok: true, status: "aprovado_cliente" });
    }

    if (action === "retry") {
      if (post.status !== "falha_publicacao") {
        return json({ error: "Apenas posts com falha podem ser reenviados." }, 422);
      }
      await svcDb.from("workflow_posts").update({
        status: "agendado",
        publish_retry_count: 0,
        publish_error: null,
        instagram_container_id: null,
        publish_processing_at: null,
      }).eq("id", postId);
      return json({ ok: true, status: "agendado" });
    }

    return json({ error: "Unknown action" }, 400);
  };
}
