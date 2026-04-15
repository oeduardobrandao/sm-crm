import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

/** Complete an etapa and activate the next one (or mark workflow done). */
async function completeEtapa(db: any, workflowId: number, etapaId: number) {
  const now = new Date().toISOString();

  await db
    .from("workflow_etapas")
    .update({ status: "concluido", concluido_em: now })
    .eq("id", etapaId);

  const { data: allEtapas } = await db
    .from("workflow_etapas")
    .select("id, ordem, status")
    .eq("workflow_id", workflowId)
    .order("ordem", { ascending: true });

  const currentIdx = allEtapas?.findIndex((e: any) => e.id === etapaId) ?? -1;
  const nextIdx = currentIdx + 1;

  if (allEtapas && nextIdx < allEtapas.length) {
    await db
      .from("workflow_etapas")
      .update({ status: "ativo", iniciado_em: now })
      .eq("id", allEtapas[nextIdx].id);

    await db
      .from("workflows")
      .update({ etapa_atual: nextIdx })
      .eq("id", workflowId);
  } else {
    await db
      .from("workflows")
      .update({ status: "concluido", etapa_atual: currentIdx })
      .eq("id", workflowId);
  }
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { token, etapa_id, post_id, action, comentario } = await req.json();

    if (!token || (!etapa_id && !post_id) || !action) {
      return json({ error: "Missing required fields: token, (etapa_id or post_id), action" }, 400);
    }

    if (!["aprovado", "correcao"].includes(action)) {
      return json({ error: "action must be 'aprovado' or 'correcao'" }, 400);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Validate token → get workflow_id
    const { data: tokenRow, error: tokenErr } = await db
      .from("portal_tokens")
      .select("workflow_id")
      .eq("token", token)
      .maybeSingle();

    if (tokenErr || !tokenRow) {
      return json({ error: "Invalid or expired token" }, 403);
    }

    const workflowId = tokenRow.workflow_id;

    // ── Per-post approval path ────────────────────────────────────────────────
    if (post_id) {
      if (action === "correcao" && (!comentario || !comentario.trim())) {
        return json({ error: "comentario is required for corrections" }, 400);
      }

      const { data: post, error: postErr } = await db
        .from("workflow_posts")
        .select("id, workflow_id, status")
        .eq("id", post_id)
        .single();

      if (postErr || !post) {
        return json({ error: "Post not found" }, 404);
      }

      if (post.workflow_id !== workflowId) {
        return json({ error: "Post does not belong to this workflow" }, 403);
      }

      if (!["enviado_cliente", "correcao_cliente"].includes(post.status)) {
        return json({ error: "Post is not awaiting client review" }, 400);
      }

      // Record approval
      await db.from("post_approvals").insert({
        post_id,
        token,
        action,
        comentario: comentario?.trim() || null,
        is_workspace_user: false,
      });

      // Update post status
      const newStatus = action === "aprovado" ? "aprovado_cliente" : "correcao_cliente";
      await db.from("workflow_posts").update({ status: newStatus }).eq("id", post_id);

      // Check if all client-visible posts are now approved → auto-complete etapa
      if (action === "aprovado") {
        const { data: sentPosts } = await db
          .from("workflow_posts")
          .select("id, status")
          .eq("workflow_id", workflowId)
          .in("status", ["enviado_cliente", "aprovado_cliente", "correcao_cliente"]);

        // Re-fetch the just-updated post to get correct status
        const updatedStatuses = (sentPosts || []).map((p: any) =>
          p.id === post_id ? "aprovado_cliente" : p.status
        );
        const allApproved = updatedStatuses.every((s: string) => s === "aprovado_cliente");

        if (allApproved) {
          const { data: approvalEtapa } = await db
            .from("workflow_etapas")
            .select("id, ordem")
            .eq("workflow_id", workflowId)
            .eq("tipo", "aprovacao_cliente")
            .eq("status", "ativo")
            .maybeSingle();

          if (approvalEtapa) {
            await completeEtapa(db, workflowId, approvalEtapa.id);
          }
        }
      }

      // Return updated posts for portal refresh
      const { data: updatedPosts } = await db
        .from("workflow_posts")
        .select("id, titulo, tipo, status, ordem, conteudo_plain")
        .eq("workflow_id", workflowId)
        .in("status", ["enviado_cliente", "aprovado_cliente", "correcao_cliente"])
        .order("ordem", { ascending: true });

      return json({ success: true, posts: updatedPosts || [] });
    }

    // ── Per-etapa approval path (existing behavior) ───────────────────────────
    if (action === "correcao" && (!comentario || !comentario.trim())) {
      return json({ error: "comentario is required for corrections" }, 400);
    }

    const { data: etapa, error: etapaErr } = await db
      .from("workflow_etapas")
      .select("id, workflow_id, ordem, status, tipo")
      .eq("id", etapa_id)
      .single();

    if (etapaErr || !etapa) {
      return json({ error: "Etapa not found" }, 404);
    }

    if (etapa.workflow_id !== workflowId) {
      return json({ error: "Etapa does not belong to this workflow" }, 403);
    }

    if (etapa.tipo !== "aprovacao_cliente") {
      return json({ error: "This etapa is not a client approval step" }, 400);
    }

    if (etapa.status !== "ativo") {
      return json({ error: "This etapa is not currently active" }, 400);
    }

    await db.from("portal_approvals").insert({
      workflow_etapa_id: etapa_id,
      token,
      action,
      comentario: comentario?.trim() || null,
    });

    if (action === "aprovado") {
      await completeEtapa(db, workflowId, etapa_id);
    }

    const { data: updatedEtapas } = await db
      .from("workflow_etapas")
      .select("id, ordem, nome, status, tipo, iniciado_em, concluido_em")
      .eq("workflow_id", workflowId)
      .order("ordem", { ascending: true });

    return json({ success: true, etapas: updatedEtapas || [] });
  } catch (err) {
    console.error("[portal-approve] Error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
