// API do relatório interativo de blocos. PR 1: só POST /generate.
// PR 3 adiciona /:id/pdf, /:id/refresh-data e DELETE /:id.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { makeBoundedFetch } from "./bounded-fetch.ts";
import { parseGenerateBody } from "./client-id.ts";
import { DocActionError } from "./errors.ts";
import { GenerateError, generateReportDocument } from "./generate.ts";
import { refreshReportDocument } from "./refresh.ts";
import { deleteReportDocument } from "./delete-doc.ts";
import { exportReportPdf } from "./pdf.ts";
import { convertUrlToPdf } from "../_shared/report-template/pdf-url.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";

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
      const { clientId, month, templateId } = parsed;

      const result = await generateReportDocument(
        serviceClient,
        { fetch, storage: serviceClient.storage, geminiKey: GEMINI_API_KEY, userId: user.id },
        contaId,
        clientId,
        month,
        templateId,
      );
      return json(result, 201);
    }

    const docMatch = path.match(/^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/(pdf|refresh-data))?$/i);
    if (docMatch) {
      const docId = docMatch[1];
      const action = docMatch[3];
      // refresh-data e pdf disparam trabalho pago (bateria de queries do
      // snapshot, narrativa AI, conversão Gotenberg) -- exigem a mesma
      // entitlement de POST /generate, mesmo em cache hit do pdf (workspace
      // rebaixado não deve seguir mintando signed URL via API). DELETE fica
      // de fora de propósito: o usuário sempre pode apagar o próprio dado, e
      // a rota já remove o PDF armazenado -- ela nunca deveria ficar presa
      // atrás de um plano expirado.
      if (action === "pdf" || action === "refresh-data") {
        if (!(await effectivePlanFeature(serviceClient, contaId, "feature_analytics_reports"))) {
          return json({ error: "feature_disabled" }, 403);
        }
      }
      if (req.method === "POST" && action === "refresh-data") {
        const allowed = await checkRateLimit(serviceClient, `report-docs:${contaId}`, 20, 3600);
        if (!allowed) return json({ error: "Rate limit exceeded" }, 429);
        await refreshReportDocument(
          serviceClient,
          { fetch, storage: serviceClient.storage },
          contaId,
          docId,
        );
        return json({ ok: true });
      }
      if (req.method === "DELETE" && !action) {
        await deleteReportDocument(serviceClient, serviceClient.storage, contaId, docId);
        return json({ ok: true });
      }
      if (req.method === "POST" && action === "pdf") {
        const allowed = await checkRateLimit(serviceClient, `report-docs-pdf:${contaId}`, 30, 3600);
        if (!allowed) return json({ error: "Rate limit exceeded" }, 429);
        const result = await exportReportPdf(serviceClient, {
          convert: convertUrlToPdf,
          storage: serviceClient.storage,
          now: () => new Date(),
          env: {
            gotenbergUrl: Deno.env.get("GOTENBERG_URL") ?? "",
            printBase: Deno.env.get("REPORT_PRINT_BASE") ?? "",
            internalSecret: Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "",
          },
        }, contaId, docId);
        return json(result);
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  } catch (err) {
    if (err instanceof GenerateError) {
      if (err.code === "bad_month") return json({ error: "invalid_month" }, 400);
      if (err.code === "feature_disabled") return json({ error: "feature_disabled" }, 403);
      if (err.code === "invalid_template") return json({ error: "invalid_template" }, 400);
      return json({ error: "not_found" }, 404);
    }
    if (err instanceof DocActionError) {
      if (err.code === "pdf_not_configured") return json({ error: "pdf_not_configured" }, 503);
      if (err.code === "pdf_failed") return json({ error: "pdf_failed" }, 502);
      return json({ error: "not_found" }, 404);
    }
    return internalServerError(json, "report-docs", err);
  }
});
