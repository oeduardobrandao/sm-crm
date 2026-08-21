// API do relatório interativo de blocos. PR 1: só POST /generate.
// PR 3 adiciona /:id/pdf, /:id/refresh-data e DELETE /:id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { makeBoundedFetch } from "./bounded-fetch.ts";
import { parseGenerateBody } from "./client-id.ts";
import { GenerateError, generateReportDocument } from "./generate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = createJsonResponder(corsHeaders);
  const path = new URL(req.url).pathname.replace("/report-docs", "");

  try {
    const authHeader = req.headers.get("Authorization");
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader ?? "" }, fetch: makeBoundedFetch() },
    });
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token || token === "undefined" || token === "null") {
      return json({ error: "Unauthorized" }, 401);
    }
    const userRes = await anonClient.auth.getUser();
    const user = userRes.data?.user;
    if (userRes.error || !user) return json({ error: "Unauthorized" }, 401);

    // Geração é síncrona, sem retry de fila (spec §5): uma query PostgREST
    // travada no service client não pode segurar o request até o runtime
    // matar a função -- ver bounded-fetch.ts.
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { fetch: makeBoundedFetch() },
    });
    const { data: profile } = await serviceClient
      .from("profiles").select("active_workspace_id").eq("id", user.id).single();
    // Sem workspace ativo não há tenant (mesma semântica de
    // get_my_conta_id()/RLS: report_documents_select lê só
    // active_workspace_id + EXISTS workspace_members). conta_id legado NÃO é
    // fallback aqui: geraria um documento sob o tenant errado, invisível ao
    // próprio criador (RLS nunca deixaria ele achar o próprio relatório).
    const contaId = profile?.active_workspace_id;
    if (!contaId) return json({ error: "Unauthorized" }, 401);
    const { data: membership } = await serviceClient
      .from("workspace_members").select("user_id")
      .eq("user_id", user.id).eq("workspace_id", contaId).maybeSingle();
    if (!membership) return json({ error: "Unauthorized" }, 401);

    if (req.method === "POST" && path === "/generate") {
      const allowed = await checkRateLimit(serviceClient, `report-docs:${contaId}`, 20, 3600);
      if (!allowed) return json({ error: "Rate limit exceeded" }, 429);

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid_body" }, 400);
      }
      const parsed = parseGenerateBody(body);
      if (parsed === null) return json({ error: "invalid_body" }, 400);
      const { clientId, month } = parsed;

      const result = await generateReportDocument(
        serviceClient,
        { fetch, storage: serviceClient.storage, geminiKey: GEMINI_API_KEY, userId: user.id },
        contaId,
        clientId,
        month,
      );
      return json(result, 201);
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  } catch (err) {
    if (err instanceof GenerateError) {
      if (err.code === "bad_month") return json({ error: "invalid_month" }, 400);
      if (err.code === "feature_disabled") return json({ error: "feature_disabled" }, 403);
      return json({ error: "not_found" }, 404);
    }
    return internalServerError(json, "report-docs", err);
  }
});
