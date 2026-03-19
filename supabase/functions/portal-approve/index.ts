import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { token, etapa_id, action, comentario } = await req.json();

    if (!token || !etapa_id || !action) {
      return json({ error: "Missing required fields: token, etapa_id, action" }, 400);
    }

    if (!["aprovado", "correcao"].includes(action)) {
      return json({ error: "action must be 'aprovado' or 'correcao'" }, 400);
    }

    if (action === "correcao" && (!comentario || !comentario.trim())) {
      return json({ error: "comentario is required for corrections" }, 400);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Validate token → get workflow_id
    const { data: tokenRow, error: tokenErr } = await db
      .from("portal_tokens")
      .select("workflow_id")
      .eq("token", token)
      .maybeSingle();

    if (tokenErr || !tokenRow) {
      return json({ error: "Invalid or expired token" }, 403);
    }

    const workflowId = tokenRow.workflow_id;

    // 2. Validate etapa belongs to workflow, is approval type, and is active
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

    // 3. Record the approval/correction
    await db.from("portal_approvals").insert({
      workflow_etapa_id: etapa_id,
      token,
      action,
      comentario: comentario?.trim() || null,
    });

    // 4. If approved, complete the etapa and activate next
    if (action === "aprovado") {
      const now = new Date().toISOString();

      // Mark current etapa as done
      await db
        .from("workflow_etapas")
        .update({ status: "concluido", concluido_em: now })
        .eq("id", etapa_id);

      // Get all etapas to find next
      const { data: allEtapas } = await db
        .from("workflow_etapas")
        .select("id, ordem, status")
        .eq("workflow_id", workflowId)
        .order("ordem", { ascending: true });

      const currentIdx = allEtapas?.findIndex((e: any) => e.id === etapa_id) ?? -1;
      const nextIdx = currentIdx + 1;

      if (allEtapas && nextIdx < allEtapas.length) {
        // Activate next etapa
        await db
          .from("workflow_etapas")
          .update({ status: "ativo", iniciado_em: now })
          .eq("id", allEtapas[nextIdx].id);

        await db
          .from("workflows")
          .update({ etapa_atual: nextIdx })
          .eq("id", workflowId);
      } else {
        // All etapas done — mark workflow complete
        await db
          .from("workflows")
          .update({ status: "concluido", etapa_atual: currentIdx })
          .eq("id", workflowId);
      }
    }

    // 5. Return updated etapas
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
