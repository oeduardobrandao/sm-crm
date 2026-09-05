import { assertEquals } from "./assert.ts";
import { handleListWorkspaces } from "../platform-admin/list-workspaces.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

function makeFakeRpcDb(result: unknown) {
  const rpcCalls: Array<{ fn: string; params: unknown }> = [];
  const db = {
    rpc: (fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: result, error: null });
    },
  };
  return { db, rpcCalls };
}

const HEADERS = { "Content-Type": "application/json" };

Deno.test("list-workspaces delegates to admin_list_workspaces and passes filters through", async () => {
  const payload = {
    total: 42,
    total_members: 99,
    total_clients: 314,
    total_with_overrides: 7,
    workspaces: [{ id: "ws-1", name: "Alpha" }],
  };
  const { db, rpcCalls } = makeFakeRpcDb(payload);

  const res = await handleListWorkspaces(
    db as unknown as SupabaseClient,
    { search: "alp", plan_id: "pro", offset: 20, limit: 20 },
    HEADERS,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.total, 42);
  assertEquals(body.total_members, 99);
  assertEquals(body.total_clients, 314);
  assertEquals(body.total_with_overrides, 7);
  assertEquals(body.workspaces.length, 1);
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].fn, "admin_list_workspaces");
  assertEquals(rpcCalls[0].params, {
    p_search: "alp",
    p_plan_id: "pro",
    p_offset: 20,
    p_limit: 20,
    p_as_of: null,
    p_status: null,
    p_has_overrides: null,
    p_activity: null,
    p_created_since: null,
    p_sort: "created_at",
    p_dir: "desc",
  });
});

Deno.test("list-workspaces forwards as_of as the RPC's snapshot timestamp", async () => {
  const { db, rpcCalls } = makeFakeRpcDb({ total: 0, workspaces: [] });

  await handleListWorkspaces(
    db as unknown as SupabaseClient,
    { as_of: "2026-01-01T00:00:00.000Z" },
    HEADERS,
  );

  assertEquals(rpcCalls[0].params, {
    p_search: null,
    p_plan_id: null,
    p_offset: 0,
    p_limit: 20,
    p_as_of: "2026-01-01T00:00:00.000Z",
    p_status: null,
    p_has_overrides: null,
    p_activity: null,
    p_created_since: null,
    p_sort: "created_at",
    p_dir: "desc",
  });
});

Deno.test("list-workspaces defaults offset 0 / limit 20 and null filters", async () => {
  const { db, rpcCalls } = makeFakeRpcDb({ total: 0, workspaces: [] });
  const res = await handleListWorkspaces(db as unknown as SupabaseClient, {}, HEADERS);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, {
    workspaces: [],
    total: 0,
    total_members: 0,
    total_clients: 0,
    total_with_overrides: 0,
  });
  assertEquals(rpcCalls[0].params, {
    p_search: null,
    p_plan_id: null,
    p_offset: 0,
    p_limit: 20,
    p_as_of: null,
    p_status: null,
    p_has_overrides: null,
    p_activity: null,
    p_created_since: null,
    p_sort: "created_at",
    p_dir: "desc",
  });
});

Deno.test("list-workspaces tolerates a null RPC payload", async () => {
  const { db } = makeFakeRpcDb(null);
  const res = await handleListWorkspaces(db as unknown as SupabaseClient, {}, HEADERS);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, {
    workspaces: [],
    total: 0,
    total_members: 0,
    total_clients: 0,
    total_with_overrides: 0,
  });
});

Deno.test("list-workspaces forwards the filter and sort params to the RPC", async () => {
  const { db, rpcCalls } = makeFakeRpcDb({ total: 0, workspaces: [] });

  await handleListWorkspaces(
    db as unknown as SupabaseClient,
    {
      status: "pendente",
      has_overrides: false,
      activity: "dormente",
      created_since: "2026-08-01T00:00:00.000Z",
      sort: "client_count",
      dir: "asc",
    },
    HEADERS,
  );

  assertEquals(rpcCalls[0].params, {
    p_search: null,
    p_plan_id: null,
    p_offset: 0,
    p_limit: 20,
    p_as_of: null,
    p_status: "pendente",
    p_has_overrides: false,
    p_activity: "dormente",
    p_created_since: "2026-08-01T00:00:00.000Z",
    p_sort: "client_count",
    p_dir: "asc",
  });
});
