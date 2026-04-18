import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
};

interface HubBriefingHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
}

async function resolveToken(db: DbClient, token: string, now: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, is_active, clientes(conta_id)")
    .eq("token", token)
    .gt("expires_at", now)
    .maybeSingle();
  if (!data || !data.is_active) return null;
  return data as { cliente_id: number; is_active: boolean; clientes: { conta_id: number } };
}

export function createHubBriefingHandler(deps: HubBriefingHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const db = deps.createDb();

    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("token");
      if (!token) return json({ error: "token required" }, 400);

      const hubToken = await resolveToken(db, token, deps.now());
      if (!hubToken) return json({ error: "Link inválido." }, 404);

      const { data, error } = await db
        .from("hub_briefing_questions")
        .select("id, question, answer, section, display_order")
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

      const hubToken = await resolveToken(db, token, deps.now());
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
  };
}
