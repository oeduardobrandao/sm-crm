import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { token, post_id, action, comentario } = await req.json();
  if (!token || !post_id || !action) return json({ error: "token, post_id and action required" }, 400);
  if (!["aprovado", "correcao", "mensagem"].includes(action)) return json({ error: "Invalid action" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Validate token
  const { data: hubToken } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active")
    .eq("token", token)
    .maybeSingle();
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  // Verify the post belongs to this client
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

  // Record approval
  await db.from("workflow_post_approvals").insert({
    post_id,
    action,
    comentario: comentario ?? null,
    is_workspace_user: false,
  });

  // Update post status
  const newStatus = action === "aprovado" ? "aprovado_cliente" : action === "correcao" ? "correcao_cliente" : post.status;
  await db.from("workflow_posts").update({ status: newStatus }).eq("id", post_id);

  return json({ ok: true });
});
