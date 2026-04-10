import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active")
    .eq("token", token)
    .maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const hubToken = await resolveToken(db, token);
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  // Fetch all workflows for this client
  const { data: workflows } = await db
    .from("workflows")
    .select("id")
    .eq("cliente_id", hubToken.cliente_id);

  const workflowIds = (workflows ?? []).map((w: { id: number }) => w.id);
  if (workflowIds.length === 0) return json({ posts: [], postApprovals: [] });

  // Fetch all posts
  const { data: posts } = await db
    .from("workflow_posts")
    .select("id, titulo, tipo, status, ordem, conteudo_plain, scheduled_at, workflow_id")
    .in("workflow_id", workflowIds)
    .order("scheduled_at", { ascending: true });

  const postIds = (posts ?? []).map((p: { id: number }) => p.id);

  // Fetch approval history for those posts
  const { data: postApprovals } = postIds.length > 0
    ? await db
        .from("workflow_post_approvals")
        .select("id, post_id, action, comentario, is_workspace_user, created_at")
        .in("post_id", postIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  return json({ posts: posts ?? [], postApprovals: postApprovals ?? [] });
});
