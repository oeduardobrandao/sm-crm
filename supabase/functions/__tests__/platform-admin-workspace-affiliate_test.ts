import { assert, assertEquals } from "./assert.ts";
import { makeFakeDb, type Resp } from "./mcp-admin-helpers.ts";
import {
  handleSetWorkspaceAffiliate,
  loadWorkspaceAffiliate,
  normalizeRefCode,
} from "../platform-admin/workspace-affiliate.ts";

const HEADERS = { "Content-Type": "application/json" };
const ACTOR = "admin-user-1";
const WS = { data: { id: "ws-1" }, error: null };
const OWNERS = { data: [{ user_id: "owner-1" }], error: null };
const AFF_NEW = { id: "aff-2", code: "novo123", nome: "Bia", email: "bia@x.com" };

function setup(responses: Record<string, Resp[]>, ownerEmail = "dono@x.com") {
  const t = makeFakeDb(responses);
  t.db.auth.admin = {
    getUserById: (_id: string) => Promise.resolve({ data: { user: { email: ownerEmail } }, error: null }),
  } as never;
  return t;
}

async function run(t: ReturnType<typeof setup>, body: Record<string, unknown>) {
  const res = await handleSetWorkspaceAffiliate(t.db as never, body as never, ACTOR, HEADERS);
  return { status: res.status, body: await res.json() };
}

function writes(t: ReturnType<typeof setup>, table: string) {
  return t.calls.filter((c) => c.table === table && ["insert", "update", "upsert", "delete"].includes(c.method));
}

function audit(t: ReturnType<typeof setup>) {
  return t.calls.find((c) => c.table === "audit_log" && c.method === "insert")?.args[0] as
    | Record<string, unknown>
    | undefined;
}

// ─── normalizeRefCode ──────────────────────────────────────────

Deno.test("normalizeRefCode trims, lowercases and validates the trigger's format", () => {
  assertEquals(normalizeRefCode(" AbC123 "), { ok: true, code: "abc123" });
  assertEquals(normalizeRefCode(null), { ok: true, code: null });
  assertEquals(normalizeRefCode("  "), { ok: true, code: null });
  assertEquals(normalizeRefCode(undefined), { ok: true, code: null });
  assertEquals(normalizeRefCode("ab").ok, false);
  assertEquals(normalizeRefCode("abc-123").ok, false);
  assertEquals(normalizeRefCode(42).ok, false);
});

// ─── set-workspace-affiliate ───────────────────────────────────

Deno.test("set-workspace-affiliate inserts a referral when the workspace has none", async () => {
  const t = setup({
    workspaces: [WS],
    affiliate_referrals: [{ data: null, error: null }, { data: null, error: null }],
    affiliates: [{ data: AFF_NEW, error: null }],
    workspace_members: [OWNERS],
  });
  const r = await run(t, { workspace_id: "ws-1", ref_code: " NOVO123 " });
  assertEquals(r.status, 200);
  assertEquals(r.body, { affiliate: { id: "aff-2", name: "Bia", code: "novo123" } });
  const w = writes(t, "affiliate_referrals");
  assertEquals(w.length, 1);
  assertEquals(w[0].method, "insert");
  assertEquals(w[0].args[0], { workspace_id: "ws-1", affiliate_id: "aff-2", ref_code: "novo123" });
  const code = t.calls.find((c) => c.table === "affiliates" && c.method === "eq" && c.args[0] === "code");
  assertEquals(code?.args[1], "novo123");
  const status = t.calls.find((c) => c.table === "affiliates" && c.method === "eq" && c.args[0] === "status");
  assertEquals(status?.args[1], "active");
});

Deno.test("set-workspace-affiliate updates an existing referral in place (created_at kept)", async () => {
  const t = setup({
    workspaces: [WS],
    affiliate_referrals: [{ data: { affiliate_id: "aff-1" }, error: null }, { data: null, error: null }],
    affiliates: [{ data: AFF_NEW, error: null }],
    workspace_members: [OWNERS],
  });
  const r = await run(t, { workspace_id: "ws-1", ref_code: "novo123" });
  assertEquals(r.status, 200);
  const w = writes(t, "affiliate_referrals");
  assertEquals(w.length, 1);
  assertEquals(w[0].method, "update");
  assertEquals(w[0].args[0], { affiliate_id: "aff-2", ref_code: "novo123" });
  const scoped = t.calls.find((c) => c.table === "affiliate_referrals" && c.method === "eq" &&
    c.args[0] === "workspace_id" && c.args[1] === "ws-1");
  assert(scoped, "update must be scoped to the workspace");
});

Deno.test("set-workspace-affiliate clears the referral with ref_code null", async () => {
  const t = setup({
    workspaces: [WS],
    affiliate_referrals: [{ data: { affiliate_id: "aff-1" }, error: null }, { data: null, error: null }],
  });
  const r = await run(t, { workspace_id: "ws-1", ref_code: null });
  assertEquals(r.status, 200);
  assertEquals(r.body, { affiliate: null });
  const w = writes(t, "affiliate_referrals");
  assertEquals(w.length, 1);
  assertEquals(w[0].method, "delete");
  assertEquals(audit(t)?.metadata, { old_affiliate_id: "aff-1", new_affiliate_id: null });
});

Deno.test("set-workspace-affiliate rejects an unknown or inactive code with 400 and writes nothing", async () => {
  for (const ref of ["sumiu99", "ab"]) {
    const t = setup({
      workspaces: [WS],
      affiliate_referrals: [{ data: { affiliate_id: "aff-1" }, error: null }],
      affiliates: [{ data: null, error: null }],
      workspace_members: [OWNERS],
    });
    const r = await run(t, { workspace_id: "ws-1", ref_code: ref });
    assertEquals(r.status, 400);
    assertEquals(r.body, { error: "Código de afiliado não encontrado ou inativo." });
    assertEquals(writes(t, "affiliate_referrals").length, 0);
    assertEquals(audit(t), undefined);
  }
});

Deno.test("set-workspace-affiliate rejects self-referral (owner e-mail = affiliate e-mail) with 400", async () => {
  const t = setup({
    workspaces: [WS],
    affiliate_referrals: [{ data: null, error: null }],
    affiliates: [{ data: AFF_NEW, error: null }],
    workspace_members: [OWNERS],
  }, " Bia@X.com ");
  const r = await run(t, { workspace_id: "ws-1", ref_code: "novo123" });
  assertEquals(r.status, 400);
  assert(typeof r.body.error === "string" && r.body.error.length > 0);
  assertEquals(writes(t, "affiliate_referrals").length, 0);
});

Deno.test("set-workspace-affiliate audits admin-set-affiliate with old and new affiliate ids", async () => {
  const t = setup({
    workspaces: [WS],
    affiliate_referrals: [{ data: { affiliate_id: "aff-1" }, error: null }, { data: null, error: null }],
    affiliates: [{ data: AFF_NEW, error: null }],
    workspace_members: [OWNERS],
  });
  await run(t, { workspace_id: "ws-1", ref_code: "novo123" });
  const a = audit(t);
  assert(a);
  assertEquals(a.action, "admin-set-affiliate");
  assertEquals(a.conta_id, "ws-1");
  assertEquals(a.actor_user_id, ACTOR);
  assertEquals(a.metadata, { old_affiliate_id: "aff-1", new_affiliate_id: "aff-2" });
});

Deno.test("set-workspace-affiliate never touches affiliate_commissions", async () => {
  const t = setup({
    workspaces: [WS],
    affiliate_referrals: [{ data: { affiliate_id: "aff-1" }, error: null }, { data: null, error: null }],
    affiliates: [{ data: AFF_NEW, error: null }],
    workspace_members: [OWNERS],
  });
  await run(t, { workspace_id: "ws-1", ref_code: "novo123" });
  assertEquals(t.calls.some((c) => c.table === "affiliate_commissions"), false);
});

Deno.test("set-workspace-affiliate with the same affiliate is a no-op (no write, no audit)", async () => {
  const t = setup({
    workspaces: [WS],
    affiliate_referrals: [{ data: { affiliate_id: "aff-2" }, error: null }],
    affiliates: [{ data: AFF_NEW, error: null }],
    workspace_members: [OWNERS],
  });
  const r = await run(t, { workspace_id: "ws-1", ref_code: "novo123" });
  assertEquals(r.status, 200);
  assertEquals(r.body, { affiliate: { id: "aff-2", name: "Bia", code: "novo123" } });
  assertEquals(writes(t, "affiliate_referrals").length, 0);
  assertEquals(audit(t), undefined);
});

Deno.test("set-workspace-affiliate: 400 without workspace_id, 404 for an unknown workspace", async () => {
  assertEquals((await run(setup({}), { ref_code: null })).status, 400);
  const t = setup({ workspaces: [{ data: null, error: null }] });
  assertEquals((await run(t, { workspace_id: "nope", ref_code: null })).status, 404);
});

// ─── loadWorkspaceAffiliate (detail payload) ───────────────────

Deno.test("loadWorkspaceAffiliate returns { id, name, code } or null", async () => {
  const t = setup({
    affiliate_referrals: [{ data: { affiliate_id: "aff-2", affiliates: { id: "aff-2", nome: "Bia", code: "novo123" } }, error: null }],
  });
  assertEquals(await loadWorkspaceAffiliate(t.db as never, "ws-1"), { id: "aff-2", name: "Bia", code: "novo123" });
  const none = setup({ affiliate_referrals: [{ data: null, error: null }] });
  assertEquals(await loadWorkspaceAffiliate(none.db as never, "ws-1"), null);
});

// ─── reclassify the acquisition channel after an affiliate change ───

function reclassifyCalls(t: ReturnType<typeof setup>) {
  return t.calls.filter((c) => c.table === "rpc:workspace_acquisition_reclassify");
}

Deno.test("set-workspace-affiliate reclassifies the channel after set, change and removal", async () => {
  const cases: Array<{ name: string; ref: string | null; current: unknown }> = [
    { name: "set", ref: "novo123", current: null },
    { name: "change", ref: "novo123", current: { affiliate_id: "aff-1" } },
    { name: "remove", ref: null, current: { affiliate_id: "aff-1" } },
  ];
  for (const c of cases) {
    const t = setup({
      workspaces: [WS],
      affiliate_referrals: [{ data: c.current, error: null }, { data: null, error: null }],
      affiliates: [{ data: AFF_NEW, error: null }],
      workspace_members: [OWNERS],
    });
    const r = await run(t, { workspace_id: "ws-1", ref_code: c.ref });
    assertEquals(r.status, 200, c.name);
    const rc = reclassifyCalls(t);
    assertEquals(rc.length, 1, c.name);
    assertEquals(rc[0].args[0], { p_workspace: "ws-1" }, c.name);
  }
});

Deno.test("set-workspace-affiliate: no reclassify when nothing changed", async () => {
  const t = setup({
    workspaces: [WS],
    affiliate_referrals: [{ data: { affiliate_id: "aff-2" }, error: null }],
    affiliates: [{ data: AFF_NEW, error: null }],
    workspace_members: [OWNERS],
  });
  await run(t, { workspace_id: "ws-1", ref_code: "novo123" });
  assertEquals(reclassifyCalls(t).length, 0);
});

Deno.test("set-workspace-affiliate: a failing reclassify is logged and the action still returns 200", async () => {
  const t = makeFakeDb({
    workspaces: [WS],
    affiliate_referrals: [{ data: null, error: null }, { data: null, error: null }],
    affiliates: [{ data: AFF_NEW, error: null }],
    workspace_members: [OWNERS],
  }, { workspace_acquisition_reclassify: [{ data: null, error: { message: "boom" } }] });
  t.db.auth.admin = {
    getUserById: (_id: string) => Promise.resolve({ data: { user: { email: "dono@x.com" } }, error: null }),
  } as never;
  const orig = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    const res = await handleSetWorkspaceAffiliate(t.db as never, { workspace_id: "ws-1", ref_code: "novo123" } as never, ACTOR, HEADERS);
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { affiliate: { id: "aff-2", name: "Bia", code: "novo123" } });
  } finally {
    console.error = orig;
  }
  assert(logged.some((a) => String(a[0]).includes("reclassify")), "the failure must be logged");
});
