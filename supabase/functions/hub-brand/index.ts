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

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: hubToken } = await db.from("client_hub_tokens").select("cliente_id, is_active").eq("token", token).maybeSingle();
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  const { data: brand } = await db.from("hub_brand").select("*").eq("cliente_id", hubToken.cliente_id).maybeSingle();
  const { data: files } = await db.from("hub_brand_files").select("*").eq("cliente_id", hubToken.cliente_id).order("display_order");

  return json({ brand: brand ?? null, files: files ?? [] });
});
