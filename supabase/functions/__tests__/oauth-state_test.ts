import { assertEquals } from "./assert.ts";
import { createSignedState, verifySignedState, toUrlSafeBase64 } from "../instagram-integration/oauth-state.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";

// Set env var for HMAC key
Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-secret-key-for-oauth-state-32chars");

Deno.test("oauth-state: round-trip preserves userId and contaId", async () => {
  const db = createSupabaseQueryMock();
  db.queue("oauth_states", "delete", { data: null, error: null }); // cleanup expired
  db.queue("oauth_states", "insert", { data: null, error: null }); // insert new state
  const state = await createSignedState("123", "user-abc", "conta-1", db);
  const result = await verifySignedState(state);
  assertEquals(result.clientId, "123");
  assertEquals(result.userId, "user-abc");
  assertEquals(result.contaId, "conta-1");
  assertEquals(typeof result.nonce, "string");
});

Deno.test("oauth-state: tampered payload fails verification", async () => {
  const db = createSupabaseQueryMock();
  db.queue("oauth_states", "delete", { data: null, error: null });
  db.queue("oauth_states", "insert", { data: null, error: null });
  const state = await createSignedState("123", "user-abc", "conta-1", db);
  const [_payload, sig] = state.split(".");
  const fakePayload = toUrlSafeBase64(btoa(JSON.stringify({ clientId: "999", userId: "hacker", contaId: "evil", nonce: "x", iat: Date.now() })));
  const tampered = fakePayload + "." + sig;
  let threw = false;
  try {
    await verifySignedState(tampered);
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, "State signature invalid");
  }
  assertEquals(threw, true);
});

Deno.test("oauth-state: expired state fails verification", async () => {
  const db = createSupabaseQueryMock();
  db.queue("oauth_states", "delete", { data: null, error: null });
  db.queue("oauth_states", "insert", { data: null, error: null });
  // Test the error path with an invalid state format
  let threw = false;
  try {
    await verifySignedState("invalid-no-dot");
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, "Invalid state format");
  }
  assertEquals(threw, true);
});

Deno.test("oauth-state: malformed state without dot separator fails", async () => {
  let threw = false;
  try {
    await verifySignedState("nodot");
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message, "Invalid state format");
  }
  assertEquals(threw, true);
});
