import { assert, assertEquals } from "./assert.ts";
import { decodeJwtClaim, grantActive, validateConsentPayload } from "../_shared/mcp-oauth.ts";

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
    client_id: "  client-uuid  ",
    conta_id: "conta-uuid",
    scopes: ["clientes:read", "posts:read"],
  });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.client_id, "client-uuid"); // trimmed
    assertEquals(r.value.conta_id, "conta-uuid");
    assertEquals(r.value.scopes, ["clientes:read", "posts:read"]);
  }
});

Deno.test("validateConsentPayload rejects missing fields and bad scopes", () => {
  const noClient = validateConsentPayload({ conta_id: "c", scopes: ["posts:read"] });
  assertEquals(noClient.ok, false);
  const noConta = validateConsentPayload({ client_id: "x", scopes: ["posts:read"] });
  assertEquals(noConta.ok, false);
  const emptyScopes = validateConsentPayload({ client_id: "x", conta_id: "c", scopes: [] });
  assertEquals(emptyScopes.ok, false); // non-empty required
  const badScope = validateConsentPayload({ client_id: "x", conta_id: "c", scopes: ["posts:write"] });
  assertEquals(badScope.ok, false); // not in allowlist
});
