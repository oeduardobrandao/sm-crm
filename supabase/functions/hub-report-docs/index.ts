// Hub do relatório de blocos (spec §9). Deploy OBRIGATÓRIO com --no-verify-jwt:
// /list e /doc autenticam por token de portal (resolveHubToken, que impõe
// feature_hub_portal); /print-doc autentica SÓ pelo print token HMAC — export
// de PDF é entitlement de relatórios, independente do portal.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { docHandler, listHandler, printDocHandler } from "./handlers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_FUNCTION_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/hub-report-docs", "");
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (path.startsWith("/print-doc/")) {
      const docId = path.slice("/print-doc/".length);
      const pt = url.searchParams.get("pt") ?? "";
      if (!UUID_RE.test(docId) || !pt) return json({ error: "Not found" }, 404);
      const doc = await printDocHandler(
        db,
        INTERNAL_FUNCTION_SECRET,
        docId,
        pt,
        Math.floor(Date.now() / 1000),
      );
      return doc ? json({ doc }) : json({ error: "Not found" }, 404);
    }

    const token = url.searchParams.get("token");
    if (!token) return json({ error: "token required" }, 400);
    const hubToken = await resolveHubToken(db, token, new Date().toISOString());
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    if (path === "/list" || path === "/list/") {
      return json({ items: await listHandler(db, hubToken) });
    }
    if (path.startsWith("/doc/")) {
      const docId = path.slice("/doc/".length);
      if (!UUID_RE.test(docId)) return json({ error: "Not found" }, 404);
      const doc = await docHandler(db, hubToken, docId);
      return doc ? json({ doc }) : json({ error: "Not found" }, 404);
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("[hub-report-docs] unexpected error", err);
    return json({ error: "Internal server error" }, 500);
  }
});
