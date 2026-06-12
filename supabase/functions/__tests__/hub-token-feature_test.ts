import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";

// resolveHubToken(db, token, now, expectedContaId?):
//   1. client_hub_tokens .select(...).eq("token").gt("expires_at", now).maybeSingle()
//   2. effective_plan_feature RPC for "feature_hub_portal"
//   3. hubTokenActive(row, featureOn) gate
// Returns the token row { cliente_id, conta_id, is_active } or null.

const NOW = "2026-06-12T00:00:00.000Z";

Deno.test("resolveHubToken: feature ON + active token returns the token row", async () => {
  const db = createSupabaseQueryMock();
  const row = { cliente_id: 7, conta_id: "ws-1", is_active: true };
  db.queue("client_hub_tokens", "select", { data: row, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  const result = await resolveHubToken(db as never, "tok", NOW);
  assertEquals(result, row);
});

Deno.test("resolveHubToken: feature OFF returns null (hub stops serving)", async () => {
  const db = createSupabaseQueryMock();
  const row = { cliente_id: 7, conta_id: "ws-1", is_active: true };
  db.queue("client_hub_tokens", "select", { data: row, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  const result = await resolveHubToken(db as never, "tok", NOW);
  assertEquals(result, null);
});

Deno.test("resolveHubToken: inactive token returns null even with feature ON", async () => {
  const db = createSupabaseQueryMock();
  const row = { cliente_id: 7, conta_id: "ws-1", is_active: false };
  db.queue("client_hub_tokens", "select", { data: row, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  const result = await resolveHubToken(db as never, "tok", NOW);
  assertEquals(result, null);
});
