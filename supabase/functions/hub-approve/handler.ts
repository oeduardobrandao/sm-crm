import { createJsonResponder } from "../_shared/http.ts";
import { validateForScheduling } from "../_shared/instagram-publish-utils.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
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

    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    const { data: post } = await db
      .from("workflow_posts")
      .select("id, workflow_id, status, is_express, cliente_id, conta_id")
      .eq("id", post_id)
      .maybeSingle();
    if (!post) return json({ error: "Post não encontrado." }, 404);

    // Ownership is the post's own cliente_id/conta_id, not a workflow lookup: an
    // avulso post (workflow_id null) has no workflow to authorize through, and
    // every post — attached or not — carries its own client and workspace.
    if (post.cliente_id !== hubToken.cliente_id || post.conta_id !== hubToken.conta_id) {
      return json({ error: "Não autorizado." }, 403);
    }

    if (action === "mensagem") {
      // Message-only: no status change, keep the plain insert.
      const { error: insertError } = await db.from("post_approvals").insert({
        post_id,
        token,
        action,
        comentario: comentario ?? null,
        is_workspace_user: false,
      });
      if (insertError) return json({ error: insertError.message }, 500);
    } else {
      // aprovado | correcao must actually transition the post.
      if (!["enviado_cliente", "correcao_cliente"].includes(post.status)) {
        return json({ error: "Post não está aguardando revisão do cliente." }, 400);
      }
      const newStatus = action === "aprovado" ? "aprovado_cliente" : "correcao_cliente";
      const { error: approvalErr } = await db.rpc("record_client_approval", {
        p_post_id: post_id,
        p_token: token,
        p_action: action,
        p_comentario: comentario ?? null,
        p_is_workspace_user: false,
        p_new_status: newStatus,
      });
      if (approvalErr) return json({ error: "Erro ao registrar aprovação." }, 500);
    }

    let scheduled = false;
    if (action === "aprovado") {
      const { data: client } = await db
        .from("clientes")
        .select("auto_publish_on_approval")
        .eq("id", post.cliente_id)
        .single();

      if (client?.auto_publish_on_approval) {
        // Express posts have no scheduled_at: approval IS the publish moment, so the
        // min-future date check is skipped and the post is stamped to publish now.
        const isExpress = post.is_express === true;
        const validation = await validateForScheduling(
          db,
          post_id,
          isExpress ? { skipDateCheck: true } : undefined,
        );
        if (validation.ok) {
          const { error: scheduleErr } = await db.rpc("record_post_status_change", {
            p_post_id: post_id,
            p_new_status: "agendado",
            p_source: "system",
            ...(isExpress ? { p_fields: { scheduled_at: deps.now() } } : {}),
          });
          if (scheduleErr) {
            // The approval stands; only the auto-publish failed. Reporting
            // scheduled: true here would tell the client the post is on its
            // way while it sits in aprovado_cliente with no date forever.
            console.error("[hub-approve] auto-publish scheduling failed:", scheduleErr);
          } else {
            scheduled = true;
          }
        }
        // Validation failed → the approval itself still succeeded; the auto-publish is
        // silently skipped (accepted behavior) and the agency schedules manually.
      }
    }

    const { error: notifErr } = await db.rpc("create_post_approval_notification", {
      p_post_id: post_id,
      p_action: action,
      p_comentario: comentario ?? null,
    });
    if (notifErr) {
      console.error("[hub-approve] notification creation failed:", notifErr);
    }

    return json({ ok: true, scheduled });
  };
}
