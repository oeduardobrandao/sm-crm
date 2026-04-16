import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const workspaceSlug = url.searchParams.get("workspace");
  const token = url.searchParams.get("token");

  if (!workspaceSlug || !token) return json({ error: "workspace and token are required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Resolve workspace
  const { data: conta } = await db
    .from("workspaces")
    .select("id, name, logo_url, brand_color, hub_enabled")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!conta) return json({ error: "Workspace não encontrado." }, 404);
  if (!conta.hub_enabled) return json({ error: "Hub desativado." }, 403);

  // 2. Validate token belongs to this workspace
  const { data: hubToken } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active")
    .eq("token", token)
    .eq("conta_id", conta.id)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  // 3. Fetch client name
  const { data: cliente } = await db
    .from("clientes")
    .select("nome")
    .eq("id", hubToken.cliente_id)
    .single();

  return json({
    workspace: {
      name: conta.name,
      logo_url: conta.logo_url,
      brand_color: conta.brand_color ?? "#1a1a2e",
    },
    cliente_nome: cliente?.nome ?? "",
    is_active: hubToken.is_active,
    cliente_id: hubToken.cliente_id,
  });
});
