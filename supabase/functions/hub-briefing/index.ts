import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active")
    .eq("token", token)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  return data as { cliente_id: number; is_active: boolean };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return json({ error: "token required" }, 400);

    const hubToken = await resolveToken(db, token);
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    const { data, error } = await db
      .from("hub_briefing_questions")
      .select("id, question, answer, display_order")
      .eq("cliente_id", hubToken.cliente_id)
      .order("display_order");

    if (error) return json({ error: error.message }, 500);
    return json({ questions: data ?? [] });
  }

  if (req.method === "POST") {
    let body: { token?: string; question_id?: string; answer?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { token, question_id, answer } = body;
    if (!token || !question_id || answer === undefined) {
      return json({ error: "token, question_id, and answer are required" }, 400);
    }

    const hubToken = await resolveToken(db, token);
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    const { data: question } = await db
      .from("hub_briefing_questions")
      .select("id")
      .eq("id", question_id)
      .eq("cliente_id", hubToken.cliente_id)
      .maybeSingle();

    if (!question) return json({ error: "Pergunta não encontrada." }, 404);

    const { error } = await db
      .from("hub_briefing_questions")
      .update({ answer })
      .eq("id", question_id)
      .eq("cliente_id", hubToken.cliente_id);

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
});
