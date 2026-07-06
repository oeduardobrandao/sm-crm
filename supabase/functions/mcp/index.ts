// Mesaas MCP server — remote, workspace-scoped, read-only (PR 1).
// Auth: workspace API key (mesaas_sk_…) resolved per request; service-role DB; tools scope to ctx.
// Transport: SDK web-standard streamable HTTP, server+transport built per request (stateless).
// Deploy with --no-verify-jwt (this function does its own auth).
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { publicOrigin, resolveCtx } from "../_shared/mcp-oauth.ts";
import { createDesignRenderTrigger } from "../_shared/design-render-trigger.ts";
import { resolveImageProvider } from "../_shared/image-gen/resolve.ts";
import { effectivePlanFeature, effectivePlanLimit } from "../_shared/entitlements-rpc.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { deleteObject, getObjectBytes, putObject, signGetUrl } from "../_shared/r2.ts";
import { createDocServiceClient } from "../_shared/doc-service.ts";
import { starterTemplateFor, type DesignFormat } from "../design-manage/starter-templates.gen.ts";
import { registerTools } from "./tools.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Optional: without the doc service configured, the design tools report "não configurado"
// instead of failing the whole MCP server at boot (same stance as the image provider below).
const RENDER_SERVICE_URL = Deno.env.get("RENDER_SERVICE_URL");
const RENDER_SERVICE_SECRET = Deno.env.get("RENDER_SERVICE_SECRET");
const docSvc = RENDER_SERVICE_URL && RENDER_SERVICE_SECRET
  ? createDocServiceClient(RENDER_SERVICE_URL, RENDER_SERVICE_SECRET)
  : null;
// Optional on purpose — without it design writes still land, only the immediate render kick is
// skipped (the sweep cron and the editor's own reads converge the render).
const CRON_SECRET = Deno.env.get("CRON_SECRET");
// Optional too: without ANY provider key, generate_image reports "não configurada" instead of
// the whole MCP server failing to boot (this function serves 17 other tools). Selection
// (OpenRouter first, Gemini fallback) is shared with generate-image via resolveImageProvider.
const imageProvider = resolveImageProvider() ?? undefined;
// The OAuth scope we advertise to clients. Supabase's AS only supports OIDC scopes
// (openid/profile/email/phone), so advertising our MCP scopes here makes Claude request them at
// /authorize, which Supabase rejects ("unsupported scope: clientes:read"). MCP scopes are enforced
// AFTER the token via the consent grant + requireScope in the tools — never as OAuth scopes.
const OAUTH_SCOPE = "openid";

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  // MCP Streamable HTTP + OAuth discovery need a few headers beyond the shared default. Localized
  // here so we don't widen CORS for every edge function. (Anthropic's web connector usually calls
  // server-side, where CORS is moot — this is defensive for any browser-side client/discovery.)
  cors["Access-Control-Allow-Headers"] =
    "authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id, last-event-id";
  cors["Access-Control-Expose-Headers"] = "WWW-Authenticate, mcp-session-id";
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  // Force https for the absolute discovery URLs (req.url carries the proxy's internal http scheme).
  const origin = publicOrigin(req.url, req.headers.get("x-forwarded-proto"));
  const resourceUrl = `${origin}/functions/v1/mcp`;
  const metadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;

  // OAuth 2.0 Protected Resource Metadata (RFC 9728), served at a sub-path and advertised via the
  // 401 WWW-Authenticate below. Points OAuth clients (claude.ai web) at Supabase's OAuth 2.1 AS.
  //
  // NOTE on discovery: RFC 9728 §3.1 would put this at the *host root*
  // (/.well-known/oauth-protected-resource/functions/v1/mcp), but Supabase only routes
  // /functions/v1/<name>/* to this function, so the root path can't reach us. The MCP spec's
  // discovery flow reads the absolute `resource_metadata` URL from our 401 WWW-Authenticate
  // challenge instead of constructing the well-known path, so spec-compliant clients still work.
  if (req.method === "GET" && url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return jsonResponse(
      {
        resource: resourceUrl,
        authorization_servers: [`${origin}/auth/v1`],
        scopes_supported: [OAUTH_SCOPE],
        bearer_methods_supported: ["header"],
      },
      200,
      cors,
    );
  }

  // Stateless server: no server-initiated SSE stream and no sessions. Per the MCP Streamable HTTP
  // spec, answer the SSE GET (and session DELETE) with 405 so clients fall back to plain
  // request/response (POST) mode. (Otherwise the fresh-per-request transport throws → our catch
  // returns 500 → mcp-remote drops the whole connection: "Failed to open SSE stream".)
  if (req.method === "GET" || req.method === "DELETE") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json", Allow: "POST, OPTIONS" },
    });
  }

  // Auth: a static mesaas_sk_ key OR a Supabase OAuth access token. (Passes through --no-verify-jwt.)
  const rawToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ctx = await resolveCtx(db, rawToken, new Date().toISOString());
  if (!ctx) {
    // RFC 9728 §5.1: advertise the resource metadata so OAuth clients can discover the AS.
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", scope="${OAUTH_SCOPE}"`,
      },
    });
  }

  // Per-request server: tools are bound to THIS key's workspace + scopes (stateless).
  // serverInfo metadata (MCP spec): title + icons let clients show a branded connector.
  const server = new McpServer({
    name: "mesaas",
    version: "0.1.0",
    title: "Mesaas",
    websiteUrl: "https://www.mesaas.com.br",
    icons: [
      { src: "https://www.mesaas.com.br/icon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
      {
        src: "https://www.mesaas.com.br/mesaas-icon-192.png",
        mimeType: "image/png",
        sizes: ["192x192"],
      },
    ],
  });
  registerTools(server, {
    db,
    ctx,
    // Estúdio design tools (design-first model):
    isFeatureEnabled: (feature) => effectivePlanFeature(db as never, ctx.conta_id, feature),
    triggerRender: CRON_SECRET ? createDesignRenderTrigger(SUPABASE_URL, CRON_SECRET) : undefined,
    fetchBlob: (r2Key) => getObjectBytes(r2Key),
    putBlob: (r2Key, bytes) => putObject(r2Key, bytes, "application/octet-stream"),
    deleteBlob: (r2Key) => deleteObject(r2Key),
    docDescribe: docSvc?.describe,
    docMutate: docSvc?.mutate,
    callRenderService: docSvc?.render,
    starterTemplate: (format) => starterTemplateFor(format as DesignFormat),
    randomUUID: () => crypto.randomUUID(),
    // generate_image (§8) — the shared core's dep bundle:
    imageGen: {
      db,
      provider: imageProvider,
      isFeatureEnabled: (contaId: string, feature: string) =>
        effectivePlanFeature(db as never, contaId, feature),
      monthlyLimit: (contaId: string) =>
        effectivePlanLimit(db as never, contaId, "rate_ai_images_per_month"),
      checkRateLimit: (key: string, max: number, windowSeconds: number) =>
        checkRateLimit(db as never, key, max, windowSeconds),
      putObject,
      deleteObject,
      insertFile: async (p: Record<string, unknown>) => {
        const { data, error } = await db.rpc("file_insert_with_quota", { p }).single();
        if (error || !data) throw new Error((error as { message?: string })?.message ?? "file insert failed");
        return { id: (data as { id: number }).id };
      },
      resolveFileBytes: (r2Key: string) => getObjectBytes(r2Key),
      signUrl: (key: string) => signGetUrl(key, 3600),
      randomUUID: () => crypto.randomUUID(),
      logError: (context: string, error: unknown) => console.error(`[${context}]`, error),
    },
  });

  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);

  let res: Response;
  try {
    res = await transport.handleRequest(req);
  } catch (e) {
    console.error("[mcp] transport error:", e);
    return jsonResponse({ error: "Internal error." }, 500, cors);
  }

  // Merge CORS onto the transport's Response (reconstruct if headers are immutable).
  try {
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  } catch (_e) {
    const copy = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) copy.headers.set(k, v);
    return copy;
  }
});
