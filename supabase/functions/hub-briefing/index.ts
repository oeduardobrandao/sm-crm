import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: hubToken } = await db.from("client_hub_tokens").select("cliente_id, is_active").eq("token", token).maybeSingle();
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  const { data: cliente } = await db
    .from("clientes")
    .select("nome, email, telefone, segmento, notas")
    .eq("id", hubToken.cliente_id)
    .single();

  return json({ briefing: cliente ?? null });
});
