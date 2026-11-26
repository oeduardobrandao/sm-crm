import { assert, assertEquals } from "./assert.ts";
import {
  billingBlocker,
  DELETE_CONFIRM_WORD,
  deleteWorkspace,
  type DeleteWorkspaceDeps,
  type LiveBilling,
  previewWorkspaceDelete,
} from "../platform-admin/workspace-delete.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Resp = { data: unknown; error: unknown };

const WS = "11111111-2222-4333-8444-555555555555";
const ACTOR = "admin-user-1";

// Fake Supabase client: queues per table / per rpc ("rpc:<fn>"), plus an ordered event log.
function makeFakeDb(responses: Record<string, Resp[]>, events: string[]) {
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  const next = (key: string): Resp => (queues[key] ?? []).shift() ?? { data: null, error: null };
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    for (const m of ["select", "eq", "limit", "insert"]) {
      rec[m] = (..._args: unknown[]) => {
        if (m === "insert") events.push(`${table}.insert`);
        return rec;
      };
    }
    rec.then = (resolve: (r: Resp) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(next(table)).then(resolve, reject);
    return rec;
  }
  return {
    from: (t: string) => recorder(t),
    rpc: (fn: string, _args: unknown) => {
      events.push(`rpc:${fn}`);
      return Promise.resolve(next(`rpc:${fn}`));
    },
  } as unknown as SupabaseClient;
}

const MEMBERS = [
  { user_id: "u-owner", role: "owner", email: "dono@x.test", name: "Dono", login_deleted: true },
  { user_id: "u-multi", role: "agent", email: "multi@x.test", name: null, login_deleted: false },
];

function preview(subscription: unknown = null): Resp {
  return {
    data: {
      workspace: { id: WS, name: "Agência X" },
      subscription,
      counts: { clientes: 3, posts: 10, arquivos: 4, membros: 2 },
      members: MEMBERS,
    },
    error: null,
  };
}

const SUB_CANCELED = {
  provider: "stripe",
  status: "canceled",
  stripe_subscription_id: "sub_1",
  pagarme_subscription_id: null,
  blocks: false,
};

function billing(over: Partial<LiveBilling> = {}): LiveBilling {
  return {
    stripeStatus: () => Promise.resolve("canceled"),
    pagarmeStatus: () => Promise.resolve("canceled"),
    ...over,
  };
}

function deps(db: SupabaseClient, events: string[], b = billing(), deleteError?: unknown): DeleteWorkspaceDeps {
  return {
    db,
    billing: b,
    deleteUser: (id) => {
      events.push(`deleteUser:${id}`);
      return deleteError ? Promise.reject(deleteError) : Promise.resolve();
    },
  };
}

Deno.test("confirm word is the literal 'delete'", () => {
  assertEquals(DELETE_CONFIRM_WORD, "delete");
});

Deno.test("preview: invalid id is 400, unknown workspace is 404", async () => {
  const events: string[] = [];
  const db = makeFakeDb({
    "rpc:admin_delete_workspace_preview": [{ data: null, error: { message: "workspace_not_found" } }],
  }, events);
  assertEquals((await previewWorkspaceDelete(deps(db, events), { workspace_id: "x" })).status, 400);
  assertEquals((await previewWorkspaceDelete(deps(db, events), { workspace_id: WS })).status, 404);
});

Deno.test("preview: returns counts, members and no blocker when there is no subscription", async () => {
  const events: string[] = [];
  const db = makeFakeDb({ "rpc:admin_delete_workspace_preview": [preview()] }, events);
  const r = await previewWorkspaceDelete(deps(db, events), { workspace_id: WS });
  assertEquals(r.status, 200);
  assertEquals(r.body.blocker, null);
  assertEquals((r.body.counts as { posts: number }).posts, 10);
  assertEquals(r.body.confirm_word, "delete");
});

Deno.test("billingBlocker: mirror active blocks without a live read", async () => {
  let called = false;
  const b = await billingBlocker(
    { ...SUB_CANCELED, status: "active", blocks: true },
    billing({ stripeStatus: () => { called = true; return Promise.resolve("canceled"); } }),
  );
  assertEquals(b?.reason, "active_subscription");
  assert(!called, "mirror block must not hit Stripe");
});

Deno.test("billingBlocker: mirror canceled but Stripe live active blocks", async () => {
  const b = await billingBlocker(SUB_CANCELED, billing({ stripeStatus: () => Promise.resolve("active") }));
  assertEquals(b?.reason, "active_subscription");
});

Deno.test("billingBlocker: live read failure blocks (fail closed)", async () => {
  const b = await billingBlocker(SUB_CANCELED, billing({ stripeStatus: () => Promise.reject(new Error("timeout")) }));
  assertEquals(b?.reason, "billing_unverified");
});

Deno.test("billingBlocker: subscription gone at the provider passes", async () => {
  assertEquals(await billingBlocker(SUB_CANCELED, billing({ stripeStatus: () => Promise.resolve(null) })), null);
});

Deno.test("billingBlocker: checks Pagar.me too when the row has both ids", async () => {
  const b = await billingBlocker(
    { ...SUB_CANCELED, provider: "pagarme", pagarme_subscription_id: "sub_pg" },
    billing({ pagarmeStatus: () => Promise.resolve("active") }),
  );
  assertEquals(b?.reason, "active_subscription");
  assertEquals((b as { provider: string }).provider, "pagarme");
  assertEquals(
    await billingBlocker(
      { ...SUB_CANCELED, provider: "pagarme", pagarme_subscription_id: "sub_pg" },
      billing({ pagarmeStatus: () => Promise.resolve("failed") }),
    ),
    null,
  );
});

Deno.test("delete: wrong confirm word is 400 and touches nothing", async () => {
  for (const confirm of [undefined, "", "Delete", "excluir", "delet"]) {
    const events: string[] = [];
    const db = makeFakeDb({}, events);
    const r = await deleteWorkspace(deps(db, events), { workspace_id: WS, confirm }, ACTOR);
    assertEquals(r.status, 400, `confirm=${confirm}`);
    assertEquals(events, []);
  }
});

Deno.test("delete: active subscription is 409 and never calls the delete RPC", async () => {
  const events: string[] = [];
  const db = makeFakeDb({
    "rpc:admin_delete_workspace_preview": [preview({ ...SUB_CANCELED, status: "active", blocks: true })],
  }, events);
  const r = await deleteWorkspace(deps(db, events), { workspace_id: WS, confirm: "delete" }, ACTOR);
  assertEquals(r.status, 409);
  assert(!events.includes("rpc:admin_delete_workspace"), "delete RPC must not run");
});

Deno.test("delete: RPC races into active_subscription -> 409; deadlock -> 409; other -> generic 500", async () => {
  const cases: Array<[unknown, number]> = [
    [{ message: "active_subscription" }, 409],
    [{ code: "40P01", message: "deadlock detected" }, 409],
    [{ code: "57014", message: "canceling statement due to statement timeout" }, 503],
    [{ message: "workspace_delete_incomplete" }, 500],
  ];
  for (const [error, status] of cases) {
    const events: string[] = [];
    const db = makeFakeDb({
      "rpc:admin_delete_workspace_preview": [preview()],
      "rpc:admin_delete_workspace": [{ data: null, error }],
    }, events);
    const r = await deleteWorkspace(deps(db, events), { workspace_id: WS, confirm: "delete" }, ACTOR);
    assertEquals(r.status, status);
    assert(!String(r.body.error).includes("workspace_delete_incomplete"), "never leaks raw errors");
    assert(!events.some((e) => e.startsWith("deleteUser")), "no login deleted after a failed RPC");
  }
});

Deno.test("delete: deletes orphan logins after the RPC, skips one that joined another workspace", async () => {
  const events: string[] = [];
  const db = makeFakeDb({
    "rpc:admin_delete_workspace_preview": [preview()],
    "rpc:admin_delete_workspace": [{ data: { orphan_user_ids: ["u-owner", "u-late"] }, error: null }],
    // u-owner: no membership, not admin. u-late: joined another workspace meanwhile.
    workspace_members: [{ data: [], error: null }, { data: [{ workspace_id: "other" }], error: null }],
    platform_admins: [{ data: [], error: null }],
  }, events);
  const r = await deleteWorkspace(deps(db, events), { workspace_id: WS, confirm: " delete " }, ACTOR);
  assertEquals(r.status, 200);
  assertEquals(r.body.logins_deleted, 1);
  assertEquals(r.body.logins_kept, ["u-late"]);
  assertEquals(r.body.logins_failed, []);
  assertEquals(events.indexOf("rpc:admin_delete_workspace") < events.indexOf("deleteUser:u-owner"), true);
  assert(!events.includes("deleteUser:u-late"));
});

Deno.test("delete: a failed login delete is audited and reported, workspace stays deleted", async () => {
  const events: string[] = [];
  const db = makeFakeDb({
    "rpc:admin_delete_workspace_preview": [preview()],
    "rpc:admin_delete_workspace": [{ data: { orphan_user_ids: ["u-owner"] }, error: null }],
    workspace_members: [{ data: [], error: null }],
    platform_admins: [{ data: [], error: null }],
  }, events);
  const r = await deleteWorkspace(
    deps(db, events, billing(), new Error("fk violation")),
    { workspace_id: WS, confirm: "delete" },
    ACTOR,
  );
  assertEquals(r.status, 200);
  assertEquals(r.body.logins_deleted, 0);
  assertEquals(r.body.logins_failed, ["dono@x.test"]);
  assert(events.includes("audit_log.insert"), "failure audited");
});
