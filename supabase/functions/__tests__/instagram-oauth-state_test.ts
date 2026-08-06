import { assertEquals } from "./assert.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-key-0123456789abcdef0123456789");

const { createSignedState, verifySignedState } = await import("../instagram-integration/oauth-state.ts");

/** oauth_states writes are irrelevant here; swallow them. */
function fakeDb() {
  const chain = {
    delete: () => chain,
    lt: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
  };
  return { from: () => chain };
}

Deno.test("signed state: round-trips the link token", async () => {
  // deno-lint-ignore no-explicit-any
  const state = await createSignedState("42", "user-1", "conta-1", fakeDb() as any, "tok-9");
  const parsed = await verifySignedState(state);
  assertEquals(parsed.clientId, "42");
  assertEquals(parsed.userId, "user-1");
  assertEquals(parsed.contaId, "conta-1");
  assertEquals(parsed.linkToken, "tok-9");
});

Deno.test("signed state: agency flow has no link token", async () => {
  // Compatibilidade: states já em voo, criados antes desta mudança, precisam
  // continuar verificando. Ausente significa fluxo da agência.
  // deno-lint-ignore no-explicit-any
  const state = await createSignedState("42", "user-1", "conta-1", fakeDb() as any);
  const parsed = await verifySignedState(state);
  assertEquals(parsed.linkToken, undefined);
});

Deno.test("signed state: a forged link token fails the signature", async () => {
  // O cliente final controla a URL de volta, então o linkToken TEM que estar
  // dentro do payload assinado. Aqui montamos um payload novo com outro token e
  // reaproveitamos a assinatura do original: a verificação precisa recusar.
  // deno-lint-ignore no-explicit-any
  const state = await createSignedState("42", "user-1", "conta-1", fakeDb() as any, "tok-9");
  const sig = state.slice(state.indexOf(".") + 1);
  const forgedPayload = JSON.stringify({
    clientId: "42", userId: "user-1", contaId: "conta-1",
    nonce: "n", iat: Date.now(), linkToken: "tok-ATACANTE",
  });
  const forgedB64 = btoa(forgedPayload)
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  let threw = false;
  try {
    await verifySignedState(`${forgedB64}.${sig}`);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
