import { assert, assertEquals } from "./assert.ts";
import {
  boundGrantScopes,
  decodeJwtClaim,
  grantActive,
  mcpScopesFromClaim,
  publicOrigin,
  validateConsentPayload,
} from "../_shared/mcp-oauth.ts";

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
    scopes: ["posts:write"],
  });
  assertEquals(badScope.ok, false); // not in allowlist
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
