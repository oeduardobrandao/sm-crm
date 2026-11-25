import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";

// resolveHubToken(db, token, now, expectedContaId?, knownAgencyName?):
//   1. client_hub_tokens .select(...).eq("token").gt("expires_at", now).maybeSingle()
//      missing/expired/inactive -> { ok: false, reason: "invalid" }
//   2. hub_workspace_paused RPC (reverse trial ended >= 7 days ago, still on Free)
//      true -> { ok: false, reason: "paused", agencyName } (workspaces.name)
//   3. effective_plan_feature RPC for "feature_hub_portal"; off -> invalid
// Returns { ok: true, token: { cliente_id, conta_id, is_active } }.

const NOW = "2026-06-12T00:00:00.000Z";
const ROW = { cliente_id: 7, conta_id: "ws-1", is_active: true };

function rpcNames(db: ReturnType<typeof createSupabaseQueryMock>) {
  return db.calls.filter((c) => c.operation === "rpc").map((c) => c.table);
}

Deno.test("resolveHubToken: feature ON + active token returns the token row", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: ROW, error: null });
  db.queueRpc("hub_workspace_paused", { data: false, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  const result = await resolveHubToken(db as never, "tok", NOW);
  assertEquals(result, { ok: true, token: ROW });
});

Deno.test("resolveHubToken: feature OFF returns invalid (hub stops serving)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: ROW, error: null });
  db.queueRpc("hub_workspace_paused", { data: false, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  const result = await resolveHubToken(db as never, "tok", NOW);
  assertEquals(result, { ok: false, reason: "invalid" });
});

Deno.test("resolveHubToken: inactive token returns invalid without the pause or feature rpc", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { ...ROW, is_active: false }, error: null });
  const result = await resolveHubToken(db as never, "tok", NOW);
  assertEquals(result, { ok: false, reason: "invalid" });
  assertEquals(rpcNames(db), []);
});

Deno.test("invalid_token_still_invalid: no token row -> invalid, no rpc", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const result = await resolveHubToken(db as never, "tok", NOW);
  assertEquals(result, { ok: false, reason: "invalid" });
  assertEquals(rpcNames(db), []);
});

Deno.test("paused_workspace_returns_paused: before the feature gate, with the agency name", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: ROW, error: null });
  db.queueRpc("hub_workspace_paused", { data: true, error: null });
  db.queue("workspaces", "select", { data: { name: "Agência Sol" }, error: null });
  const result = await resolveHubToken(db as never, "tok", NOW);
  assertEquals(result, { ok: false, reason: "paused", agencyName: "Agência Sol" });
  assertEquals(rpcNames(db), ["rpc:hub_workspace_paused"]);
  const pausedCall = db.calls.find((c) => c.table === "rpc:hub_workspace_paused");
  assertEquals(pausedCall?.payload, { p_conta: "ws-1" });
});

Deno.test("resolveHubToken: paused uses the caller's agency name without a lookup", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: ROW, error: null });
  db.queueRpc("hub_workspace_paused", { data: true, error: null });
  const result = await resolveHubToken(db as never, "tok", NOW, "ws-1", "Agência Lua");
  assertEquals(result, { ok: false, reason: "paused", agencyName: "Agência Lua" });
  assertEquals(db.calls.filter((c) => c.table === "workspaces").length, 0);
});

Deno.test("resolveHubToken: pause rpc error or non-true data reads as not paused", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    for (const answer of [{ data: null, error: { code: "42883" } }, { data: "true", error: null }]) {
      const db = createSupabaseQueryMock();
      db.queue("client_hub_tokens", "select", { data: ROW, error: null });
      db.queueRpc("hub_workspace_paused", answer);
      db.queueRpc("effective_plan_feature", { data: true, error: null });
      const result = await resolveHubToken(db as never, "tok", NOW);
      assertEquals(result, { ok: true, token: ROW });
    }
  } finally {
    console.error = orig;
  }
});
