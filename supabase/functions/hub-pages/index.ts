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
  const token = url.searchParams.get("token");
  const pageId = url.searchParams.get("page_id");
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: hubToken } = await db.from("client_hub_tokens").select("cliente_id, conta_id, is_active").eq("token", token).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  // Verify client belongs to this workspace (IDOR protection)
  const { data: clientCheck } = await db
    .from("clientes")
    .select("id")
    .eq("id", hubToken.cliente_id)
    .eq("conta_id", hubToken.conta_id)
    .maybeSingle();
  if (!clientCheck) return json({ error: "Link inválido." }, 404);

  if (pageId) {
    const { data: page } = await db.from("hub_pages").select("*, clientes!inner(conta_id)").eq("id", pageId).eq("cliente_id", hubToken.cliente_id).eq("clientes.conta_id", hubToken.conta_id).maybeSingle();
    if (!page) return json({ error: "Página não encontrada." }, 404);
    const { clientes: _, ...pageData } = page as any;
    return json({ page: pageData });
  }

  const { data: rawPages } = await db.from("hub_pages").select("id, title, display_order, created_at, clientes!inner(conta_id)").eq("cliente_id", hubToken.cliente_id).eq("clientes.conta_id", hubToken.conta_id).order("display_order");
  const pages = (rawPages ?? []).map(({ clientes: _, ...p }: any) => p);
  return json({ pages });
});
