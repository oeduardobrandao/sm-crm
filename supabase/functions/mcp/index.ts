// Mesaas MCP server — remote, workspace-scoped, read-only (PR 1).
// Auth: workspace API key (mesaas_sk_…) resolved per request; service-role DB; tools scope to ctx.
// Transport: SDK web-standard streamable HTTP, server+transport built per request (stateless).
// Deploy with --no-verify-jwt (this function does its own auth).
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveMcpKey } from "../_shared/mcp-token.ts";
import { registerTools } from "./tools.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Authorization passes through because the function is deployed --no-verify-jwt.
  const rawToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ctx = await resolveMcpKey(db, rawToken, new Date().toISOString());
  if (!ctx) return jsonResponse({ error: "Unauthorized" }, 401, cors);

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
