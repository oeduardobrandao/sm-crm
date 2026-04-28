import { createJsonResponder } from "../_shared/http.ts";
import { validateForScheduling } from "../_shared/instagram-publish-utils.ts";

type DbClient = {
  from: (table: string) => any;
};

interface HubApproveHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
}

export function createHubApproveHandler(deps: HubApproveHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const { token, post_id, action, comentario } = await req.json();
    if (!token || !post_id || !action) return json({ error: "token, post_id and action required" }, 400);
    if (!["aprovado", "correcao", "mensagem"].includes(action)) return json({ error: "Invalid action" }, 400);

    const db = deps.createDb();

    const { data: hubToken } = await db
      .from("client_hub_tokens")
      .select("cliente_id, is_active")
      .eq("token", token)
      .gt("expires_at", deps.now())
      .maybeSingle();
    if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

    const { data: post } = await db
      .from("workflow_posts")
      .select("id, workflow_id, status")
      .eq("id", post_id)
      .maybeSingle();
    if (!post) return json({ error: "Post não encontrado." }, 404);

    const { data: workflow } = await db
      .from("workflows")
      .select("cliente_id")
      .eq("id", post.workflow_id)
      .single();
    if (workflow?.cliente_id !== hubToken.cliente_id) return json({ error: "Não autorizado." }, 403);

    const { error: insertError } = await db.from("post_approvals").insert({
      post_id,
      token,
      action,
      comentario: comentario ?? null,
      is_workspace_user: false,
    });
    if (insertError) return json({ error: insertError.message }, 500);

    const newStatus = action === "aprovado" ? "aprovado_cliente" : action === "correcao" ? "correcao_cliente" : post.status;
    await db.from("workflow_posts").update({ status: newStatus }).eq("id", post_id);

    let scheduled = false;
    if (action === "aprovado") {
      const { data: client } = await db
        .from("clientes")
        .select("auto_publish_on_approval")
        .eq("id", workflow.cliente_id)
        .single();

      if (client?.auto_publish_on_approval) {
        const validation = await validateForScheduling(db, post_id);
        if (validation.ok) {
          await db.from("workflow_posts")
            .update({ status: "agendado" })
            .eq("id", post_id);
          scheduled = true;
        }
      }
    }

    return json({ ok: true, scheduled });
  };
}
