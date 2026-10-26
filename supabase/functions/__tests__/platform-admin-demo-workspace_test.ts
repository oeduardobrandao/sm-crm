import { assert, assertEquals } from "./assert.ts";
import {
  createDemoWorkspace,
  type DemoDeps,
  resendDemoAccess,
  validateDemoInput,
} from "../platform-admin/demo-workspace.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { DemoSeedCounts } from "../_shared/invite-email.ts";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client (pattern from platform-admin-workspace-overrides_test.ts),
// plus `rpc`, which records under the function name and pops from the same queues.
// `events` is a shared, ordered log of every side effect (db + deps).
function makeFakeDb(responses: Record<string, Resp[]>, events: string[]) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  const next = (key: string): Resp => (queues[key] ?? []).shift() ?? { data: null, error: null };
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    for (const m of ["select", "eq", "in", "is", "not", "order", "limit", "insert", "update", "upsert", "delete"]) {
      rec[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        if (["insert", "update", "upsert", "delete"].includes(m)) events.push(`${table}.${m}`);
        return rec;
      };
    }
    rec.single = () => Promise.resolve(next(table));
    rec.maybeSingle = () => Promise.resolve(next(table));
    rec.then = (resolve: (r: Resp) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(next(table)).then(resolve, reject);
    return rec;
  }
  const db = {
    from: (t: string) => recorder(t),
    rpc: (fn: string, args: unknown) => {
      calls.push({ table: fn, method: "rpc", args: [args] });
      events.push(`rpc:${fn}`);
      return Promise.resolve(next(`rpc:${fn}`));
    },
  };
  return { db, calls };
}

const COUNTS: DemoSeedCounts = { membros: 1, clientes: 1, workflows: 1, posts: 4, ideias: 3, leads: 3, eventos: 1 };
const ACTOR = { adminId: "padmin-1", userId: "admin-user-1" };
const PLAN_PRO = { id: "pro", name: "Pro", is_active: true, is_default: false };

function happyResponses(over: Record<string, Resp[]> = {}): Record<string, Resp[]> {
  return {
    plans: [{ data: PLAN_PRO, error: null }],
    workspace_members: [{ data: { workspace_id: "ws-new" }, error: null }],
    // The demo marker is a compare-and-set with .select("id"): one row back = this request owns it.
    workspaces: [{ data: [{ id: "ws-new" }], error: null }],
    workspace_plan_overrides: [{ data: null, error: null }, { data: null, error: null }],
    "rpc:demo_workspace_seed": [{ data: COUNTS, error: null }],
    ...over,
  };
}

interface FakeDepsOpts {
  existingUser?: { id: string } | null;
  /** Returned by findUserByEmail calls after the first (the re-check after a createUser failure). */
  existingUserOnRecheck?: { id: string } | null;
  createError?: unknown;
  generateError?: unknown;
  sendError?: unknown;
  deleteError?: unknown;
  ownerEmail?: string | null;
}

function makeDeps(db: unknown, events: string[], opts: FakeDepsOpts = {}) {
  const sent: Array<Parameters<DemoDeps["sendEmail"]>[0]> = [];
  const created: Array<{ email: string; data: Record<string, string> }> = [];
  const links: Array<{ type: string; email: string; redirectTo: string }> = [];
  const deleted: string[] = [];
  const deps: DemoDeps = {
    db: db as SupabaseClient,
    redirectBase: "https://app.test",
    findUserByEmail: (email) => {
      const isRecheck = events.some((e) => e.startsWith("findUserByEmail"));
      events.push(`findUserByEmail:${email}`);
      if (isRecheck && opts.existingUserOnRecheck !== undefined) return Promise.resolve(opts.existingUserOnRecheck);
      return Promise.resolve(opts.existingUser ?? null);
    },
    getUserEmail: (id) => {
      events.push(`getUserEmail:${id}`);
      return Promise.resolve(opts.ownerEmail === undefined ? "dono@x.com" : opts.ownerEmail);
    },
    createUser: (email, data) => {
      events.push("createUser");
      created.push({ email, data });
      if (opts.createError) return Promise.reject(opts.createError);
      return Promise.resolve({ userId: "user-new" });
    },
    generateLink: (type, email, redirectTo) => {
      events.push(`generateLink:${type}`);
      links.push({ type, email, redirectTo });
      if (opts.generateError) return Promise.reject(opts.generateError);
      return Promise.resolve({ actionLink: "https://link.test/a" });
    },
    deleteUser: (id) => {
      events.push(`deleteUser:${id}`);
      deleted.push(id);
      return opts.deleteError ? Promise.reject(opts.deleteError) : Promise.resolve();
    },
    sendEmail: (p) => {
      events.push("sendEmail");
      sent.push(p);
      return opts.sendError ? Promise.reject(opts.sendError) : Promise.resolve();
    },
  };
  return { deps, sent, created, links, deleted };
}

function setup(responses: Record<string, Resp[]>, opts: FakeDepsOpts = {}) {
  const events: string[] = [];
  const { db, calls } = makeFakeDb(responses, events);
  const d = makeDeps(db, events, opts);
  return { ...d, calls, events };
}

const BODY = { email: " Ana@Gmail.com ", plan_id: "pro", nome: " Ana ", empresa: " Agência Sol " };

// ─── validateDemoInput ─────────────────────────────────────────

Deno.test("validateDemoInput normalises the e-mail and defaults", () => {
  const r = validateDemoInput({ email: " Ana@Gmail.com ", plan_id: "pro", nome: "  ", empresa: "" });
  assert(r.ok);
  assertEquals(r.email, "ana@gmail.com");
  assertEquals(r.planId, "pro");
  assertEquals(r.nome, null);
  assertEquals(r.empresa, "Minha agência");
  assertEquals(r.refCode, null);
});

Deno.test("validateDemoInput trims nome/empresa and lowercases ref_code", () => {
  const r = validateDemoInput({ email: "a@b.co", plan_id: "pro", nome: " Ana ", empresa: " Sol ", ref_code: " AbC123 " });
  assert(r.ok);
  assertEquals(r.nome, "Ana");
  assertEquals(r.empresa, "Sol");
  assertEquals(r.refCode, "abc123");
});

Deno.test("validateDemoInput rejects bad e-mail, missing plan and malformed ref_code", () => {
  for (const body of [
    null,
    { email: "nope", plan_id: "pro" },
    { email: "a@b.co" },
    { email: "a@b.co", plan_id: "pro", ref_code: "ab" },
    { email: "a@b.co", plan_id: "pro", ref_code: "abc-123" },
  ]) {
    const r = validateDemoInput(body);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.status, 400);
  }
});

// ─── createDemoWorkspace: refusals before anything is created ──

Deno.test("createDemoWorkspace rejects the default plan and internal plans with 400", async () => {
  for (const plan of [
    { id: "free", name: "Free", is_active: true, is_default: true },
    { id: "lifetime", name: "Vitalício", is_active: true, is_default: false },
    { id: "old", name: "Old", is_active: false, is_default: false },
    null,
  ]) {
    const t = setup({ plans: [{ data: plan, error: null }] });
    const res = await createDemoWorkspace(t.deps, { ...BODY, plan_id: plan?.id ?? "missing" }, ACTOR);
    assertEquals(res.status, 400);
    assertEquals(t.created.length, 0);
    assertEquals(t.links.length, 0);
    assertEquals(t.events.filter((e) => e.startsWith("findUserByEmail")).length, 0);
  }
});

Deno.test("createDemoWorkspace returns 409 when an auth user already exists for the e-mail", async () => {
  const t = setup(happyResponses(), { existingUser: { id: "u-old" } });
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 409);
  assertEquals(res.body.error, "Já existe uma conta Mesaas com este e-mail.");
  assertEquals(t.created.length, 0);
  assertEquals(t.links.length, 0);
  assertEquals(t.deleted.length, 0);
});

Deno.test("createDemoWorkspace maps createUser duplicate-user error (code email_exists) to 409, nothing created", async () => {
  // The message text is deliberately unrelated: only the code may be matched.
  const err = Object.assign(new Error("something else entirely"), { code: "email_exists", status: 422 });
  const t = setup(happyResponses(), { createError: err });
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 409);
  assertEquals(res.body.error, "Já existe uma conta Mesaas com este e-mail.");
  assertEquals(t.links.length, 0);
  assertEquals(t.events.includes("workspaces.update"), false);
  assertEquals(t.events.includes("rpc:demo_workspace_discard"), false);
  assertEquals(t.deleted.length, 0);
});

Deno.test("createDemoWorkspace maps a non-duplicate createUser failure to the generic 500 without rollback", async () => {
  // Duplicate-sounding text with another code: still not a 409.
  const err = Object.assign(new Error("A user with this email address has already been registered"), {
    code: "unexpected_failure",
    status: 500,
  });
  const t = setup(happyResponses(), { createError: err });
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 500);
  assertEquals(res.body.error, "Não foi possível criar a conta demo. Nada foi criado.");
  assertEquals(t.links.length, 0);
  assertEquals(t.events.includes("rpc:demo_workspace_discard"), false);
  assertEquals(t.deleted.length, 0);
});

Deno.test("createDemoWorkspace maps a lost createUser race (500 unexpected_failure, user now exists) to 409", async () => {
  // GoTrue's answer to a concurrent insert of the same new e-mail (unique index violation).
  const err = Object.assign(new Error("Database error creating new user"), { code: "unexpected_failure", status: 500 });
  const t = setup(happyResponses(), { createError: err, existingUserOnRecheck: { id: "u-winner" } });
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 409);
  assertEquals(res.body.error, "Já existe uma conta Mesaas com este e-mail.");
  assertEquals(t.events.filter((e) => e.startsWith("findUserByEmail")).length, 2);
  assertEquals(t.links.length, 0);
  assertEquals(t.events.includes("rpc:demo_workspace_discard"), false);
  assertEquals(t.deleted.length, 0);
});

Deno.test("createDemoWorkspace answers 409 without rollback when the demo marker CAS matches no row", async () => {
  // Another request already marked this workspace: it owns it, so nothing may be discarded.
  const t = setup(happyResponses({ workspaces: [{ data: [], error: null }] }));
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 409);
  assertEquals(res.body.error, "Já existe uma conta Mesaas com este e-mail.");
  const isCall = t.calls.find((c) => c.table === "workspaces" && c.method === "is");
  assertEquals(isCall?.args, ["demo_created_at", null]);
  const selCall = t.calls.find((c) => c.table === "workspaces" && c.method === "select");
  assertEquals(selCall?.args, ["id"]);
  assertEquals(t.events.includes("rpc:demo_workspace_discard"), false);
  assertEquals(t.deleted.length, 0);
  assertEquals(t.links.length, 0);
  assertEquals(t.events.includes("workspace_plan_overrides.insert"), false);
  assertEquals(t.events.includes("rpc:demo_workspace_seed"), false);
  assertEquals(t.events.includes("audit_log.insert"), false);
  assertEquals(t.sent.length, 0);
});

Deno.test("createDemoWorkspace rolls back the new user and workspace when the invite link fails", async () => {
  const err = Object.assign(new Error("link down"), { code: "email_exists", status: 422 });
  const t = setup(happyResponses(), { generateError: err });
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  // After createUser succeeded, even an email_exists code here is a plain failure.
  assertEquals(res.status, 500);
  assertEquals(res.body.error, "Não foi possível criar a conta demo. Nada foi criado.");
  const discard = t.calls.find((c) => c.table === "demo_workspace_discard");
  assertEquals(discard?.args[0], { p_conta: "ws-new" });
  assertEquals(t.deleted, ["user-new"]);
  assertEquals(t.events.includes("rpc:demo_workspace_seed"), false);
  assertEquals(t.sent.length, 0);
});

Deno.test("createDemoWorkspace rejects an unknown, inactive or self affiliate code with 400 before creating anything", async () => {
  for (const aff of [null, { id: "aff-1", code: "abcd12", email: "ana@gmail.com" }]) {
    const t = setup(happyResponses({ affiliates: [{ data: aff, error: null }] }));
    const res = await createDemoWorkspace(t.deps, { ...BODY, ref_code: "ABCD12" }, ACTOR);
    assertEquals(res.status, 400);
    assertEquals(t.created.length, 0);
    assertEquals(t.links.length, 0);
    assertEquals(t.events.filter((e) => e.startsWith("findUserByEmail")).length, 0);
  }
  // inactive codes are filtered by the query itself (status = 'active')
  const t = setup(happyResponses({ affiliates: [{ data: null, error: null }] }));
  await createDemoWorkspace(t.deps, { ...BODY, ref_code: "abcd12" }, ACTOR);
  const statusFilter = t.calls.find((c) => c.table === "affiliates" && c.method === "eq" && c.args[0] === "status");
  assertEquals(statusFilter?.args[1], "active");
  const codeFilter = t.calls.find((c) => c.table === "affiliates" && c.method === "eq" && c.args[0] === "code");
  assertEquals(codeFilter?.args[1], "abcd12");
});

// ─── createDemoWorkspace: happy path ───────────────────────────

Deno.test("createDemoWorkspace sets plan_source demo and demo marker before seeding", async () => {
  const t = setup(happyResponses({
    affiliates: [{ data: { id: "aff-1", code: "abcd12", email: "outra@x.com" }, error: null }],
  }));
  const res = await createDemoWorkspace(t.deps, { ...BODY, ref_code: "abcd12" }, ACTOR);
  assertEquals(res.status, 200);
  assertEquals(res.body, { workspace_id: "ws-new", email: "ana@gmail.com", email_sent: true });

  const order = [
    "createUser",
    "workspaces.update",
    "generateLink:invite",
    "rpc:demo_workspace_seed",
    "affiliate_referrals.insert",
    "audit_log.insert",
    "sendEmail",
  ];
  const idx = order.map((e) => t.events.indexOf(e));
  assert(idx.every((i) => i >= 0), `missing events: ${JSON.stringify(t.events)}`);
  assertEquals([...idx].sort((a, b) => a - b), idx, `wrong order: ${JSON.stringify(t.events)}`);

  const wsUpdate = t.calls.find((c) => c.table === "workspaces" && c.method === "update")!.args[0] as Record<
    string,
    unknown
  >;
  assertEquals(wsUpdate.plan_id, "pro");
  assertEquals(wsUpdate.plan_source, "demo");
  assertEquals(wsUpdate.demo_created_by, ACTOR.userId);
  assert(typeof wsUpdate.demo_created_at === "string");
  const wsEq = t.calls.find((c) => c.table === "workspaces" && c.method === "eq");
  assertEquals(wsEq?.args, ["id", "ws-new"]);
  const wsIs = t.calls.find((c) => c.table === "workspaces" && c.method === "is");
  assertEquals(wsIs?.args, ["demo_created_at", null]);

  // overrides created the way set-workspace-plan does (no row → insert by platform admin id)
  const ovIns = t.calls.find((c) => c.table === "workspace_plan_overrides" && c.method === "insert");
  assertEquals(ovIns?.args[0], { workspace_id: "ws-new", updated_by: ACTOR.adminId });
  assert(t.events.indexOf("workspace_plan_overrides.insert") < t.events.indexOf("rpc:demo_workspace_seed"));

  const seed = t.calls.find((c) => c.table === "demo_workspace_seed");
  assertEquals(seed?.args[0], { p_conta: "ws-new", p_owner: "user-new" });

  const ref = t.calls.find((c) => c.table === "affiliate_referrals" && c.method === "insert");
  assertEquals(ref?.args[0], { workspace_id: "ws-new", affiliate_id: "aff-1", ref_code: "abcd12" });

  // auth metadata rides createUser: nome + empresa only, never ref_code
  assertEquals(t.created, [{ email: "ana@gmail.com", data: { nome: "Ana", empresa: "Agência Sol" } }]);
  assertEquals(t.links[0].type, "invite");
  assertEquals(t.links[0].email, "ana@gmail.com");
  assertEquals(t.links[0].redirectTo, "https://app.test/configurar-senha");

  assertEquals(t.sent[0], {
    to: "ana@gmail.com",
    actionLink: "https://link.test/a",
    nome: "Ana",
    planName: "Pro",
    counts: COUNTS,
  });
});

Deno.test("createDemoWorkspace omits blank nome from the Auth metadata and defaults empresa", async () => {
  const t = setup(happyResponses());
  const res = await createDemoWorkspace(t.deps, { email: "a@b.co", plan_id: "pro", nome: "  " }, ACTOR);
  assertEquals(res.status, 200);
  assertEquals(t.created[0].data, { empresa: "Minha agência" });
  assertEquals(t.events.includes("affiliate_referrals.insert"), false);
});

Deno.test("createDemoWorkspace resets an existing overrides row like set-workspace-plan", async () => {
  const t = setup(happyResponses({
    workspace_plan_overrides: [{ data: { id: "ov-1" }, error: null }, { data: null, error: null }],
  }));
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 200);
  const upd = t.calls.find((c) => c.table === "workspace_plan_overrides" && c.method === "update")!
    .args[0] as Record<string, unknown>;
  assertEquals(upd.resource_overrides, null);
  assertEquals(upd.feature_overrides, null);
  assertEquals(upd.notes, null);
  assertEquals(upd.updated_by, ACTOR.adminId);
});

Deno.test("createDemoWorkspace audits admin-create-demo with email and plan_id", async () => {
  const t = setup(happyResponses());
  await createDemoWorkspace(t.deps, BODY, ACTOR);
  const audit = t.calls.find((c) => c.table === "audit_log" && c.method === "insert")!.args[0] as Record<
    string,
    unknown
  >;
  assertEquals(audit.action, "admin-create-demo");
  assertEquals(audit.conta_id, "ws-new");
  assertEquals(audit.actor_user_id, ACTOR.userId);
  assertEquals(audit.metadata, { email: "ana@gmail.com", plan_id: "pro" });
});

// ─── createDemoWorkspace: failures after the user exists ──────

Deno.test("createDemoWorkspace rolls back on seed failure", async () => {
  const t = setup(happyResponses({
    "rpc:demo_workspace_seed": [{ data: null, error: { message: "boom" } }],
  }));
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 500);
  assertEquals(res.body, { error: "Não foi possível criar a conta demo. Nada foi criado." });
  const discard = t.calls.find((c) => c.table === "demo_workspace_discard");
  assertEquals(discard?.args[0], { p_conta: "ws-new" });
  assertEquals(t.deleted, ["user-new"]);
  assert(t.events.indexOf("rpc:demo_workspace_discard") < t.events.indexOf("deleteUser:user-new"));
  assertEquals(t.sent.length, 0);
  assertEquals(t.events.includes("audit_log.insert"), false);
});

Deno.test("createDemoWorkspace rolls back when the affiliate referral insert fails", async () => {
  const t = setup(happyResponses({
    affiliates: [{ data: { id: "aff-1", code: "abcd12", email: "outra@x.com" }, error: null }],
    affiliate_referrals: [{ data: null, error: { message: "dup" } }],
  }));
  const res = await createDemoWorkspace(t.deps, { ...BODY, ref_code: "abcd12" }, ACTOR);
  assertEquals(res.status, 500);
  assert(t.events.includes("rpc:demo_workspace_discard"));
  assertEquals(t.deleted, ["user-new"]);
  assertEquals(t.sent.length, 0);
});

Deno.test("createDemoWorkspace finds the workspace by created_by when the owner row is missing, and discards it", async () => {
  const t = setup(happyResponses({
    workspace_members: [{ data: null, error: null }],
    workspaces: [{ data: { id: "ws-fallback" }, error: null }, { data: [{ id: "ws-fallback" }], error: null }],
    "rpc:demo_workspace_seed": [{ data: null, error: { message: "boom" } }],
  }));
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 500);
  const createdBy = t.calls.find((c) => c.table === "workspaces" && c.method === "eq" && c.args[0] === "created_by");
  assertEquals(createdBy?.args[1], "user-new");
  const discard = t.calls.find((c) => c.table === "demo_workspace_discard");
  assertEquals(discard?.args[0], { p_conta: "ws-fallback" });
  assertEquals(t.deleted, ["user-new"]);
});

Deno.test("createDemoWorkspace still deletes the user when the discard RPC fails, and records both outcomes", async () => {
  const t = setup(happyResponses({
    "rpc:demo_workspace_seed": [{ data: null, error: { message: "boom" } }],
    "rpc:demo_workspace_discard": [{ data: null, error: { message: "discard boom" } }],
  }));
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 500);
  assertEquals(t.deleted, ["user-new"]);
  const audit = t.calls.find((c) => c.table === "audit_log" && c.method === "insert")!.args[0] as Record<
    string,
    unknown
  >;
  const meta = audit.metadata as Record<string, unknown>;
  assertEquals(meta.rollback_failed, true);
  assertEquals(meta.discard, "failed");
  assertEquals(meta.delete_user, "ok");
});

Deno.test("createDemoWorkspace records a failed deleteUser after a successful discard", async () => {
  const t = setup(
    happyResponses({ "rpc:demo_workspace_seed": [{ data: null, error: { message: "boom" } }] }),
    { deleteError: new Error("auth down") },
  );
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 500);
  const audit = t.calls.find((c) => c.table === "audit_log" && c.method === "insert")!.args[0] as Record<
    string,
    unknown
  >;
  assertEquals(audit.action, "admin-create-demo-failed");
  const meta = audit.metadata as Record<string, unknown>;
  assertEquals(meta.discard, "ok");
  assertEquals(meta.delete_user, "failed");
});

Deno.test("createDemoWorkspace deletes the user even when the new workspace cannot be found", async () => {
  const t = setup(happyResponses({ workspace_members: [{ data: null, error: null }], workspaces: [{ data: null, error: null }] }));
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 500);
  assertEquals(t.events.includes("rpc:demo_workspace_discard"), false);
  assertEquals(t.deleted, ["user-new"]);
});

Deno.test("createDemoWorkspace audits rollback_failed when the rollback itself fails", async () => {
  const t = setup(
    happyResponses({
      "rpc:demo_workspace_seed": [{ data: null, error: { message: "boom" } }],
      "rpc:demo_workspace_discard": [{ data: null, error: { message: "discard boom" } }],
    }),
  );
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 500);
  const audit = t.calls.find((c) => c.table === "audit_log" && c.method === "insert")!.args[0] as Record<
    string,
    unknown
  >;
  assertEquals(audit.action, "admin-create-demo-failed");
  const meta = audit.metadata as Record<string, unknown>;
  assertEquals(meta.rollback_failed, true);
  assertEquals(meta.email, "ana@gmail.com");
  assertEquals(t.sent.length, 0);
});

Deno.test("createDemoWorkspace keeps the account when the e-mail fails", async () => {
  const t = setup(happyResponses(), { sendError: new Error("resend timeout") });
  const res = await createDemoWorkspace(t.deps, BODY, ACTOR);
  assertEquals(res.status, 200);
  assertEquals(res.body, { workspace_id: "ws-new", email: "ana@gmail.com", email_sent: false });
  assertEquals(t.events.includes("rpc:demo_workspace_discard"), false);
  assertEquals(t.deleted.length, 0);
});

// ─── resendDemoAccess ──────────────────────────────────────────

const DEMO_WS = { id: "ws-d", created_by: "owner-1", demo_created_at: "2026-10-26T00:00:00Z", plan_id: "pro" };

Deno.test("resendDemoAccess refuses when the owner already has a password (409)", async () => {
  const t = setup({
    workspaces: [{ data: DEMO_WS, error: null }],
    "rpc:user_has_password": [{ data: true, error: null }],
  });
  const res = await resendDemoAccess(t.deps, { workspace_id: "ws-d" }, ACTOR);
  assertEquals(res.status, 409);
  assertEquals(res.body.error, "O dono já definiu a senha.");
  assertEquals(t.links.length, 0);
  assertEquals(t.sent.length, 0);
});

Deno.test("resendDemoAccess sends a recovery link otherwise", async () => {
  const t = setup({
    workspaces: [{ data: DEMO_WS, error: null }],
    "rpc:user_has_password": [{ data: false, error: null }],
    profiles: [{ data: { nome: "Ana" }, error: null }],
    plans: [{ data: { name: "Pro" }, error: null }],
  });
  const res = await resendDemoAccess(t.deps, { workspace_id: "ws-d" }, ACTOR);
  assertEquals(res.status, 200);
  assertEquals(res.body, { message: "Acesso reenviado.", email: "dono@x.com" });
  const pw = t.calls.find((c) => c.table === "user_has_password");
  assertEquals(pw?.args[0], { p_user_id: "owner-1" });
  assertEquals(t.links[0].type, "recovery");
  assertEquals(t.links[0].email, "dono@x.com");
  assertEquals(t.links[0].redirectTo, "https://app.test/configurar-senha");
  assertEquals(t.sent[0].to, "dono@x.com");
  assertEquals(t.sent[0].actionLink, "https://link.test/a");
  assertEquals(t.sent[0].nome, "Ana");
  assertEquals(t.sent[0].planName, "Pro");
  const audit = t.calls.find((c) => c.table === "audit_log" && c.method === "insert")!.args[0] as Record<
    string,
    unknown
  >;
  assertEquals(audit.action, "admin-resend-demo-access");
  assertEquals(audit.conta_id, "ws-d");
});

Deno.test("resendDemoAccess refuses a workspace that was never a demo, and unknown workspaces", async () => {
  const notDemo = setup({ workspaces: [{ data: { ...DEMO_WS, demo_created_at: null }, error: null }] });
  assertEquals((await resendDemoAccess(notDemo.deps, { workspace_id: "ws-d" }, ACTOR)).status, 409);
  const missing = setup({ workspaces: [{ data: null, error: null }] });
  assertEquals((await resendDemoAccess(missing.deps, { workspace_id: "ws-x" }, ACTOR)).status, 404);
  const noId = setup({});
  assertEquals((await resendDemoAccess(noId.deps, {}, ACTOR)).status, 400);
});

Deno.test("resendDemoAccess reports email_sent false when the send fails", async () => {
  const t = setup({
    workspaces: [{ data: DEMO_WS, error: null }],
    "rpc:user_has_password": [{ data: false, error: null }],
  }, { sendError: new Error("down") });
  const res = await resendDemoAccess(t.deps, { workspace_id: "ws-d" }, ACTOR);
  assertEquals(res.status, 502);
  assertEquals(res.body, { error: "Não foi possível enviar o e-mail de acesso. Tente novamente." });
  const audit = t.calls.find((c) => c.table === "audit_log" && c.method === "insert")!.args[0] as Record<
    string,
    unknown
  >;
  assertEquals(audit.action, "admin-resend-demo-access");
  assertEquals((audit.metadata as Record<string, unknown>).email_sent, false);
});
