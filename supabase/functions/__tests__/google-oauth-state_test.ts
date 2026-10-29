// google-integration/oauth-state.ts: HMAC-signed state (TikTok scheme) with provider 'google',
// product + consentRetry in the payload, and nonce consumption inside verifyGoogleState.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createGoogleState, verifyGoogleState } from "../google-integration/oauth-state.ts";
import { createSignedState as createTikTokState, toUrlSafeBase64 } from "../tiktok-integration/oauth-state.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-secret-key-for-google-state-32chars");

async function rejectsWith(fn: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await fn();
  } catch (e) {
    assertEquals((e as Error).message, message);
    return;
  }
  throw new Error(`expected rejection "${message}", but it resolved`);
}

const PARAMS = {
  clientId: "123",
  userId: "user-abc",
  contaId: "conta-1",
  product: "gbp" as const,
  consentRetry: true,
};

/** Mock that accepts the cleanup delete + insert of createGoogleState. */
function mintDb() {
  const db = createSupabaseQueryMock();
  db.queue("oauth_states", "delete", { data: null, error: null });
  db.queue("oauth_states", "insert", { data: null, error: null });
  return db;
}

/** Mock whose consume UPDATE matches a row once (then the default: no row). */
function consumeDb(...responses: Array<{ data: unknown; error?: unknown }>) {
  const db = createSupabaseQueryMock();
  db.queue("oauth_states", "update", ...responses);
  return db;
}

/** Re-signs nothing: builds `payload.sig` reusing a valid signature (for tamper tests). */
function decodePayload(state: string): Record<string, unknown> {
  const [p] = state.split(".");
  const b64 = p.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
}

Deno.test("google-oauth-state: round-trip returns the payload and consumes the nonce", async () => {
  const mint = mintDb();
  const state = await createGoogleState(PARAMS, mint as never);

  const insert = mint.calls.find((c) => c.table === "oauth_states" && c.operation === "insert");
  assert(insert, "oauth_states row must be inserted");
  const row = insert.payload as Record<string, unknown>;
  assertEquals(row.provider, "google");
  assertEquals(row.client_id, 123);
  assertEquals(row.conta_id, "conta-1");
  assertEquals(row.initiated_by, "user-abc");
  const ttl = new Date(row.expires_at as string).getTime() - Date.now();
  assert(ttl > 9 * 60_000 && ttl <= 10 * 60_000, `expires_at should be ~10 min out, got ${ttl}ms`);
  assertEquals(decodePayload(state).provider, "google");

  const db = consumeDb({ data: { nonce: row.nonce } });
  const out = await verifyGoogleState(state, db as never);
  assertEquals(out, { ...PARAMS, nonce: row.nonce as string });

  const consume = db.calls.find((c) => c.operation === "update");
  assert(consume, "nonce must be consumed");
  assert(typeof (consume.payload as Record<string, unknown>).consumed_at === "string");
  const filters = consume.modifiers.map((m) => `${m.method}:${m.args[0]}:${m.args[1]}`);
  assert(filters.includes(`eq:nonce:${row.nonce}`), `nonce filter missing: ${filters}`);
  assert(filters.includes("eq:provider:google"), `provider filter missing: ${filters}`);
  assert(filters.includes("is:consumed_at:null"), `consumed_at filter missing: ${filters}`);
  assert(consume.modifiers.some((m) => m.method === "gt" && m.args[0] === "expires_at"), "expires_at filter missing");
});

Deno.test("google-oauth-state: youtube product and consentRetry=false survive the round-trip", async () => {
  const state = await createGoogleState({ ...PARAMS, product: "youtube", consentRetry: false }, mintDb() as never);
  const out = await verifyGoogleState(state, consumeDb({ data: { id: "row" } }) as never);
  assertEquals([out.product, out.consentRetry], ["youtube", false]);
});

Deno.test("google-oauth-state: tampered payload or signature throws State signature invalid", async () => {
  const state = await createGoogleState(PARAMS, mintDb() as never);
  const [payload, sig] = state.split(".");
  const forged = toUrlSafeBase64(btoa(JSON.stringify({ ...decodePayload(state), contaId: "evil" })));
  await rejectsWith(() => verifyGoogleState(`${forged}.${sig}`, consumeDb({ data: {} }) as never), "State signature invalid");
  const badSig = sig.slice(0, -2) + (sig.endsWith("AA") ? "BB" : "AA");
  await rejectsWith(() => verifyGoogleState(`${payload}.${badSig}`, consumeDb({ data: {} }) as never), "State signature invalid");
});

Deno.test("google-oauth-state: a TikTok-minted state throws Invalid state provider", async () => {
  const tiktokState = await createTikTokState("123", "user-abc", "conta-1", mintDb());
  const db = consumeDb({ data: {} });
  await rejectsWith(() => verifyGoogleState(tiktokState, db as never), "Invalid state provider");
  assertEquals(db.calls.filter((c) => c.operation === "update").length, 0, "nonce must not be consumed");
});

Deno.test("google-oauth-state: a state issued 11 minutes ago throws State expired", async () => {
  const realNow = Date.now;
  let state: string;
  try {
    Date.now = () => realNow() - 11 * 60_000;
    state = await createGoogleState(PARAMS, mintDb() as never);
  } finally {
    Date.now = realNow;
  }
  await rejectsWith(() => verifyGoogleState(state, consumeDb({ data: {} }) as never), "State expired");
});

Deno.test("google-oauth-state: verifying the same state twice throws state_replayed the second time", async () => {
  const state = await createGoogleState(PARAMS, mintDb() as never);
  const db = consumeDb({ data: { id: "row" } }, { data: null });
  await verifyGoogleState(state, db as never);
  await rejectsWith(() => verifyGoogleState(state, db as never), "state_replayed");
});

Deno.test("google-oauth-state: a consume read error throws, never treats the state as valid", async () => {
  const state = await createGoogleState(PARAMS, mintDb() as never);
  const db = consumeDb({ data: null, error: { message: "connection reset" } });
  await rejectsWith(() => verifyGoogleState(state, db as never), "state_check_failed");
});

Deno.test("google-oauth-state: malformed state throws Invalid state format", async () => {
  await rejectsWith(() => verifyGoogleState("nodot", consumeDb() as never), "Invalid state format");
  await rejectsWith(() => verifyGoogleState("!!!.???", consumeDb() as never), "Invalid state format");
});

Deno.test("google-oauth-state: createGoogleState throws when the oauth_states insert fails", async () => {
  const db = createSupabaseQueryMock();
  db.queue("oauth_states", "delete", { data: null, error: null });
  db.queue("oauth_states", "insert", { data: null, error: { message: "check constraint" } });
  await rejectsWith(() => createGoogleState(PARAMS, db as never), "oauth_state_insert_failed");
});
