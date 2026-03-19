import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return json({ error: "Token is required" }, 400);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Validate token
    const { data: tokenRow, error: tokenErr } = await db
      .from("portal_tokens")
      .select("workflow_id, conta_id")
      .eq("token", token)
      .maybeSingle();

    if (tokenErr || !tokenRow) {
      return json({ error: "Link inválido ou expirado." }, 404);
    }

    // 2. Fetch workflow
    const { data: workflow, error: wfErr } = await db
      .from("workflows")
      .select("titulo, status, etapa_atual, link_notion, link_drive, created_at, cliente_id")
      .eq("id", tokenRow.workflow_id)
      .single();

    if (wfErr || !workflow) {
      return json({ error: "Workflow não encontrado." }, 404);
    }

    // 3. Fetch etapas (include tipo)
    const { data: etapas } = await db
      .from("workflow_etapas")
      .select("id, ordem, nome, tipo, status, iniciado_em, concluido_em")
      .eq("workflow_id", tokenRow.workflow_id)
      .order("ordem", { ascending: true });

    // 4. Fetch client name
    const { data: cliente } = await db
      .from("clientes")
      .select("nome")
      .eq("id", workflow.cliente_id)
      .single();

    // 5. Fetch workspace info
    const { data: conta } = await db
      .from("contas")
      .select("nome, logo_url")
      .eq("id", tokenRow.conta_id)
      .maybeSingle();

    // Strip cliente_id from workflow response (no sensitive data)
    const { cliente_id: _, ...workflowSafe } = workflow;

    // 6. Fetch portal approvals 
    const { data: approvals } = await db
      .from("portal_approvals")
      .select("id, workflow_etapa_id, action, comentario, created_at")
      .eq("token", token)
      .order("created_at", { ascending: false });

    return json({
      workflow: workflowSafe,
      etapas: etapas || [],
      approvals: approvals || [],
      cliente_nome: cliente?.nome || "Cliente",
      workspace: {
        name: conta?.nome || "Workspace",
        logo_url: conta?.logo_url || null,
      },
    });
  } catch (err) {
    console.error("[portal-data] Error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
