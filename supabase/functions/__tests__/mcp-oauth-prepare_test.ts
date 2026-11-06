import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { prepareOAuthAuthorization } from "../_shared/mcp-oauth.ts";

// prepare-authorization (mcp-oauth-consent): before the consent page asks Supabase for the
// authorization details (the call that auto-approves an existing consent), clear a consent whose
// Mesaas grant is gone, so a revoked connection reconnects through the consent screen instead of
// looping on 401.

Deno.test("prepareOAuthAuthorization: passes the verified user id and returns the RPC outcome", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("mcp_oauth_prepare_authorization", { data: "repaired", error: null, count: null });
  const out = await prepareOAuthAuthorization(svc as any, "jwnp5rhicco3fni3z54tmyiqoj6u52nm", "user-1");
  assertEquals(out, "repaired");
  assertEquals(svc.calls.length, 1);
  assertEquals(svc.calls[0].table, "rpc:mcp_oauth_prepare_authorization");
  assertEquals(svc.calls[0].payload, {
    p_authorization_id: "jwnp5rhicco3fni3z54tmyiqoj6u52nm",
    p_user_id: "user-1",
  });
});

Deno.test("prepareOAuthAuthorization: ok and not_found pass through", async () => {
  for (const outcome of ["ok", "not_found"]) {
    const svc = createSupabaseQueryMock();
    svc.queueRpc("mcp_oauth_prepare_authorization", { data: outcome, error: null, count: null });
    assertEquals(await prepareOAuthAuthorization(svc as any, "abc123", "user-1"), outcome);
  }
});

Deno.test("prepareOAuthAuthorization: a malformed authorization id never reaches the RPC", async () => {
  for (const bad of ["", "a b", "../x", "x".repeat(201), 42 as unknown as string, null as unknown as string]) {
    const svc = createSupabaseQueryMock();
    assertEquals(await prepareOAuthAuthorization(svc as any, bad, "user-1"), "not_found");
    assertEquals(svc.calls.length, 0, `called the RPC for ${String(bad).slice(0, 20)}`);
  }
});

Deno.test("prepareOAuthAuthorization: an RPC error or unexpected value is 'error', never a throw", async () => {
  const errored = createSupabaseQueryMock();
  errored.queueRpc("mcp_oauth_prepare_authorization", {
    data: null,
    error: { message: "relation auth.oauth_authorizations does not exist" },
    count: null,
  });
  assertEquals(await prepareOAuthAuthorization(errored as any, "abc123", "user-1"), "error");

  const odd = createSupabaseQueryMock();
  odd.queueRpc("mcp_oauth_prepare_authorization", { data: "surprise", error: null, count: null });
  assertEquals(await prepareOAuthAuthorization(odd as any, "abc123", "user-1"), "error");
});

Deno.test("mcp-oauth-consent: prepare-authorization is wired with the verified user, before any other gate", async () => {
  const src = await Deno.readTextFile(new URL("../mcp-oauth-consent/index.ts", import.meta.url));
  assert(/action === "prepare-authorization"/.test(src), "action exists");
  assert(
    /prepareOAuthAuthorization\(svc, body\.authorization_id, user\.id\)/.test(src),
    "uses the JWT-verified user id, never a body-supplied one",
  );
});
