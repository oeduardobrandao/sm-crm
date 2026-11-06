import { assert, assertEquals } from "./assert.ts";
import {
  boundGrantScopes,
  decodeJwtClaim,
  grantActive,
  mcpScopesFromClaim,
  permittedMcpScopes,
  publicOrigin,
  validateConsentPayload,
} from "../_shared/mcp-oauth.ts";
import { MCP_ALLOWED_SCOPES, MCP_SCOPE_PERMISSION } from "../_shared/mcp-token.ts";

function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

Deno.test("decodeJwtClaim extracts string claims", () => {
  const t = makeJwt({ client_id: "abc123", sub: "u1", azp: "xyz" });
  assertEquals(decodeJwtClaim(t, "client_id"), "abc123");
  assertEquals(decodeJwtClaim(t, "azp"), "xyz");
  assertEquals(decodeJwtClaim(t, "sub"), "u1");
  assertEquals(decodeJwtClaim(t, "missing"), null);
});

Deno.test("decodeJwtClaim returns null for malformed / non-string", () => {
  assertEquals(decodeJwtClaim("only-one-part", "client_id"), null);
  assertEquals(decodeJwtClaim("a.!!!notbase64!!!.c", "client_id"), null);
  assertEquals(decodeJwtClaim(makeJwt({ client_id: 123 }), "client_id"), null); // number, not string
});

Deno.test("grantActive gates on existence, revocation, feature and membership", () => {
  assertEquals(grantActive({ revoked_at: null }, true, true), true);
  assertEquals(grantActive({ revoked_at: null }, false, true), false); // feature off
  assertEquals(grantActive({ revoked_at: null }, true, false), false); // not a member anymore
  assertEquals(grantActive({ revoked_at: "2026-01-01T00:00:00Z" }, true, true), false); // revoked
  assert(!grantActive(null, true, true)); // no grant
});

Deno.test("validateConsentPayload accepts a well-formed approve body", () => {
  const r = validateConsentPayload({
    authorization_id: "  auth-id  ",
    conta_id: "conta-uuid",
    scopes: ["clientes:read", "posts:read"],
  });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.authorization_id, "auth-id"); // trimmed
    assertEquals(r.value.conta_id, "conta-uuid");
    assertEquals(r.value.scopes, ["clientes:read", "posts:read"]);
  }
});

Deno.test("validateConsentPayload rejects missing fields and bad scopes", () => {
  // client_id is NOT accepted from the body — authorization_id is required instead.
  const noAuth = validateConsentPayload({ conta_id: "c", scopes: ["posts:read"] });
  assertEquals(noAuth.ok, false);
  const noConta = validateConsentPayload({ authorization_id: "a", scopes: ["posts:read"] });
  assertEquals(noConta.ok, false);
  const emptyScopes = validateConsentPayload({ authorization_id: "a", conta_id: "c", scopes: [] });
  assertEquals(emptyScopes.ok, false); // non-empty required
  const badScope = validateConsentPayload({
    authorization_id: "a",
    conta_id: "c",
    scopes: ["admin:delete"],
  });
  assertEquals(badScope.ok, false); // not in allowlist
});

Deno.test("validateConsentPayload: target platform dispensa conta_id e valida escopos do admin", () => {
  const r = validateConsentPayload({ authorization_id: "a", target: "platform", scopes: ["kb:read", "banners:write"] });
  assert(r.ok);
  if (r.ok) assertEquals(r.value, { authorization_id: "a", target: "platform", conta_id: null, scopes: ["kb:read", "banners:write"] });
  assertEquals(validateConsentPayload({ authorization_id: "a", target: "platform", scopes: ["posts:read"] }).ok, false);
  assertEquals(validateConsentPayload({ authorization_id: "a", target: "platform", scopes: [] }).ok, false);
});

Deno.test("validateConsentPayload: target default é workspace (contrato antigo intacto) e target inválido é rejeitado", () => {
  const r = validateConsentPayload({ authorization_id: "a", conta_id: "c", scopes: ["posts:read"] });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.target, "workspace");
  assertEquals(validateConsentPayload({ authorization_id: "a", target: "workspace", scopes: ["posts:read"] }).ok, false); // sem conta_id
  assertEquals(validateConsentPayload({ authorization_id: "a", target: "galaxy", conta_id: "c", scopes: ["posts:read"] }).ok, false);
  assertEquals(validateConsentPayload({ authorization_id: "a", conta_id: "c", scopes: ["kb:read"] }).ok, false); // escopo do admin no target workspace
});

Deno.test("mcpScopesFromClaim extracts allowlisted scopes from string or array", () => {
  assertEquals(mcpScopesFromClaim("openid clientes:read posts:read"), [
    "clientes:read",
    "posts:read",
  ]);
  assertEquals(mcpScopesFromClaim(["email", "ideias:read", "bogus"]), ["ideias:read"]);
  assertEquals(mcpScopesFromClaim("openid email"), []); // no MCP scopes named
  assertEquals(mcpScopesFromClaim(null), []);
  assertEquals(mcpScopesFromClaim(undefined), []);
});

Deno.test("publicOrigin forces https for public hosts, keeps http for localhost", () => {
  // Supabase passes req.url with the internal http scheme → must become https.
  assertEquals(
    publicOrigin("http://wlyzhyfondykzpsiqsce.supabase.co/functions/v1/mcp", null),
    "https://wlyzhyfondykzpsiqsce.supabase.co",
  );
  // x-forwarded-proto wins when present.
  assertEquals(publicOrigin("http://x.supabase.co/functions/v1/mcp", "https"), "https://x.supabase.co");
  // Local dev (functions serve) stays http.
  assertEquals(publicOrigin("http://localhost:54321/functions/v1/mcp", null), "http://localhost:54321");
});

Deno.test("boundGrantScopes intersects only when the request named MCP scopes", () => {
  // request named MCP scopes → grant can't exceed them
  assertEquals(boundGrantScopes(["clientes:read", "posts:read"], ["clientes:read"]), [
    "clientes:read",
  ]);
  // request named none (generic OAuth) → the user's consent selection stands
  assertEquals(boundGrantScopes(["clientes:read", "posts:read"], []), [
    "clientes:read",
    "posts:read",
  ]);
});

// --- permittedMcpScopes: OAuth grants are capped by the user's own role ---

/** Stub service client whose has_permission_for answers from a fixed set of "module:action". */
function permDb(allowed: string[]) {
  const calls: Array<Record<string, unknown>> = [];
  const db = {
    rpc: (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, ...payload });
      return Promise.resolve({
        data: allowed.includes(`${payload.p_module}:${payload.p_action}`),
        error: null,
      });
    },
  };
  // deno-lint-ignore no-explicit-any
  return { db: db as any, calls };
}

Deno.test("MCP_SCOPE_PERMISSION maps every allowlisted scope", () => {
  for (const s of MCP_ALLOWED_SCOPES) assert(s in MCP_SCOPE_PERMISSION, `missing ${s}`);
});

Deno.test("permittedMcpScopes: default agent role (equipe none, no financeiro) loses membros:* and financeiro:*", async () => {
  const { db } = permDb([
    "clientes:ver", "clientes:editar", "entregas:ver", "entregas:editar",
    "ideias:ver", "ideias:editar", "tarefas:ver", "tarefas:editar",
  ]);
  const got = await permittedMcpScopes(db, "u1", "ws-a");
  assertEquals(
    got,
    MCP_ALLOWED_SCOPES.filter((s) => !s.startsWith("membros:") && !s.startsWith("financeiro:")),
  );
});

Deno.test("permittedMcpScopes: ver-only role keeps reads, drops writes", async () => {
  const { db } = permDb(["clientes:ver", "entregas:ver"]);
  const got = await permittedMcpScopes(db, "u1", "ws-a", [
    "clientes:read", "clientes:write", "posts:read", "posts:write", "workflows:read",
  ]);
  assertEquals(got, ["clientes:read", "posts:read", "workflows:read"]);
});

Deno.test("permittedMcpScopes: checks each module/action once, against the given workspace", async () => {
  const { db, calls } = permDb(["entregas:ver"]);
  await permittedMcpScopes(db, "u1", "ws-a", ["posts:read", "workflows:read", "posts:read"]);
  assertEquals(calls, [{
    name: "has_permission_for", p_user: "u1", p_workspace: "ws-a", p_module: "entregas", p_action: "ver",
  }]);
});

Deno.test("permittedMcpScopes: non-member / RPC error / unknown scope -> nothing", async () => {
  assertEquals(await permittedMcpScopes(permDb([]).db, "u1", "ws-a"), []);
  const failing = { rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
  // deno-lint-ignore no-explicit-any
  assertEquals(await permittedMcpScopes(failing as any, "u1", "ws-a", ["posts:read"]), []);
  assertEquals(await permittedMcpScopes(permDb(["entregas:ver"]).db, "u1", "ws-a", ["designs:write"]), []);
});

Deno.test("resolveOAuthCtx re-caps the grant by the user's current role on every request", async () => {
  const src = await Deno.readTextFile(new URL("../_shared/mcp-oauth.ts", import.meta.url));
  const fn = src.match(/export async function resolveOAuthCtx[\s\S]*?\n\}/)?.[0] ?? "";
  assert(fn.length > 0, "expected resolveOAuthCtx");
  assert(/permittedMcpScopes\(db, user\.id, contaId, bounded\)/.test(fn), "scopes must pass through permittedMcpScopes");
  assert(/hasPermissionFor\(db, user\.id, contaId, "financeiro", "editar"\)/.test(fn), "financial writes follow the user's financeiro:editar");
  assert(/can_write_financials: canWriteFinancials/.test(fn));
  assert(/if \(scopes\.length === 0\) return null;/.test(fn), "a grant with no permitted scope must not resolve");
});
