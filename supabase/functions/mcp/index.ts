// Mesaas MCP server — remote, workspace-scoped, read-only (PR 1).
// Auth: workspace API key (mesaas_sk_…) resolved per request; service-role DB; tools scope to ctx.
// Transport: SDK web-standard streamable HTTP, server+transport built per request (stateless).
// Deploy with --no-verify-jwt (this function does its own auth).
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { MCP_ALLOWED_SCOPES } from "../_shared/mcp-token.ts";
import { resolveCtx } from "../_shared/mcp-oauth.ts";
import { registerTools } from "./tools.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SCOPES = MCP_ALLOWED_SCOPES.join(" ");

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const resourceUrl = `${url.origin}/functions/v1/mcp`;
  const metadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;

  // OAuth 2.0 Protected Resource Metadata (RFC 9728), served at a sub-path and advertised via the
  // 401 WWW-Authenticate below. Points OAuth clients (claude.ai web) at Supabase's OAuth 2.1 AS.
  if (req.method === "GET" && url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return jsonResponse(
      {
        resource: resourceUrl,
        authorization_servers: [`${url.origin}/auth/v1`],
        scopes_supported: MCP_ALLOWED_SCOPES,
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
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", scope="${SCOPES}"`,
      },
    });
  }

  // Per-request server: tools are bound to THIS key's workspace + scopes (stateless).
  const server = new McpServer({ name: "mesaas", version: "0.1.0" });
  registerTools(server, { db, ctx });

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
