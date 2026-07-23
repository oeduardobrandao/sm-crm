import { assert, assertEquals } from "./assert.ts";
import { cancelInvite, getAuthStatesByEmails } from "../_shared/invite-actions.ts";

// Fake admin client: one listUsers page, plus rpc(user_has_password) and profiles reads.
function makeAdmin(opts: {
  users: Array<{ id: string; email: string; email_confirmed_at?: string | null; confirmation_sent_at?: string | null; invited_at?: string | null; last_sign_in_at?: string | null }>;
  passwords?: Record<string, boolean>;
  onboarded?: Record<string, boolean>;
}) {
  let listCalls = 0;
  return {
    _listCalls: () => listCalls,
    auth: {
      admin: {
        // deno-lint-ignore no-explicit-any
        listUsers: (_args: any) => {
          listCalls++;
          // single page then empty
          return Promise.resolve(listCalls === 1
            ? { data: { users: opts.users }, error: null }
            : { data: { users: [] }, error: null });
        },
      },
    },
    // deno-lint-ignore no-explicit-any
    rpc: (_fn: string, params: any) =>
      Promise.resolve({ data: opts.passwords?.[params.p_user_id] ?? null, error: null }),
    from: (_t: string) => ({
      select: () => ({
        in: (_col: string, ids: string[]) => Promise.resolve({
          data: ids.map((id) => ({ id, onboarding_complete: opts.onboarded?.[id] ?? false })),
          error: null,
        }),
      }),
    }),
  };
}

Deno.test("getAuthStatesByEmails resolves everything in a single listUsers scan", async () => {
  const admin = makeAdmin({
    users: [
      { id: "u1", email: "a@x.com", email_confirmed_at: "2026-01-01T00:00:00Z", confirmation_sent_at: "2026-01-01T00:00:00Z" },
      { id: "u2", email: "b@x.com", email_confirmed_at: null, confirmation_sent_at: "2026-01-02T00:00:00Z" },
    ],
    passwords: { u1: true, u2: false },
    onboarded: { u1: true, u2: false },
  });

  // deno-lint-ignore no-explicit-any
  const states = await getAuthStatesByEmails(admin as any, ["A@x.com", "b@x.com", "missing@x.com"]);

  assertEquals(admin._listCalls(), 2); // one data page + one empty terminator, NOT one-per-email
  const a = states.get("a@x.com");
  assert(a, "expected a state for a@x.com");
  assertEquals(a!.email_confirmed, true);
  assertEquals(a!.has_password, true);
  assertEquals(a!.onboarding_complete, true);
  const b = states.get("b@x.com");
  assertEquals(b!.email_confirmed, false);
  assertEquals(b!.has_password, false);
  assertEquals(states.has("missing@x.com"), false);
});

// Recording fake for cancelInvite: invites lookup + delete, profiles/members/auth deletes.
// Also records an ORDERED operation log (`_ops()`) covering the capture SELECT on
// workspace_members and the three delete calls, so tests can assert real ordering
// (not just final values) and prove no side effects occurred before an early throw.
function makeCancelAdmin(opts: {
  invite: { id: string; conta_id: string; email: string; status: string } | null;
  authUser?: { id: string; email_confirmed_at: string | null } | null;
  onboarding?: boolean;
  hasPassword?: boolean | null;
  memberships?: string[]; // workspace_ids the user belongs to
  invitesDeleteError?: boolean; // inject an error on the final `invites` delete
}) {
  const deletes: string[] = [];
  const ops: string[] = [];
  const inviteRow = opts.invite;
  return {
    _deletes: () => deletes,
    _ops: () => ops,
    auth: {
      admin: {
        // deno-lint-ignore no-explicit-any
        listUsers: (_a: any) => Promise.resolve({
          data: { users: opts.authUser ? [{ ...opts.authUser, email: inviteRow?.email }] : [] },
          error: null,
        }),
        deleteUser: (id: string) => {
          ops.push("deleteUser");
          deletes.push("auth:" + id);
          return Promise.resolve({ error: null });
        },
      },
    },
    // deno-lint-ignore no-explicit-any
    rpc: (_fn: string, _p: any) => Promise.resolve({ data: opts.hasPassword ?? null, error: null }),
    from: (table: string) => {
      const api: any = {
        select: () => {
          // Only the workspace_members capture-before-delete SELECT is logged here —
          // it's the one ordering guarantee this task is responsible for. The
          // profiles/invites lookups use maybeSingle() as their terminal call and
          // aren't part of the capture-before-delete story.
          if (table === "workspace_members") ops.push("select:workspace_members");
          return api;
        },
        eq: () => api,
        in: () => api,
        maybeSingle: () => {
          if (table === "profiles") return Promise.resolve({ data: opts.onboarding !== undefined ? { onboarding_complete: opts.onboarding } : null, error: null });
          if (table === "invites") return Promise.resolve({ data: inviteRow, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        delete: () => {
          ops.push("delete:" + table);
          deletes.push("del:" + table);
          return api;
        },
        then: (r: (x: any) => unknown) => {
          if (table === "workspace_members") {
            return Promise.resolve(r({ data: (opts.memberships ?? []).map((w) => ({ workspace_id: w })), error: null }));
          }
          if (table === "invites" && opts.invitesDeleteError) {
            return Promise.resolve(r({ data: null, error: { message: "boom" } }));
          }
          return Promise.resolve(r({ data: null, error: null }));
        },
      };
      return api;
    },
  };
}

Deno.test("cancelInvite refuses an accepted invite", async () => {
  const admin = makeCancelAdmin({ invite: { id: "i1", conta_id: "c1", email: "a@x.com", status: "accepted" } });
  // deno-lint-ignore no-explicit-any
  await assertThrowsAsyncMessage(() => cancelInvite(admin as any, { inviteId: "i1", contaId: "c1" }), "invite_not_cancellable");
  assertEquals(admin._deletes(), []);
  assertEquals(admin._ops(), [], "accepted-guard must fire before any capture/delete side effect");
});

Deno.test("cancelInvite rejects a wrong-workspace invite", async () => {
  const admin = makeCancelAdmin({ invite: null });
  // deno-lint-ignore no-explicit-any
  await assertThrowsAsyncMessage(() => cancelInvite(admin as any, { inviteId: "i1", contaId: "c1" }), "invite_not_found");
});

Deno.test("cancelInvite deletes a never-onboarded user and reports affected workspaces", async () => {
  const admin = makeCancelAdmin({
    invite: { id: "i1", conta_id: "c1", email: "a@x.com", status: "pending" },
    authUser: { id: "u1", email_confirmed_at: null }, // never confirmed -> reinvite class -> delete
    onboarding: false,
    hasPassword: false,
    memberships: ["c1", "c2"],
  });
  // deno-lint-ignore no-explicit-any
  const res = await cancelInvite(admin as any, { inviteId: "i1", contaId: "c1" });
  assertEquals(res.deletedUser, true);
  assertEquals(res.affectedWorkspaceIds.sort(), ["c1", "c2"]);
  assert(admin._deletes().includes("auth:u1"), "expected the auth user to be deleted");
  // Prove capture-before-delete ordering, not just the final affectedWorkspaceIds
  // value: a regression that moved the capture SELECT to run AFTER the deletes
  // would still produce the same affectedWorkspaceIds above but would fail this.
  assertEquals(admin._ops(), [
    "select:workspace_members",
    "delete:profiles",
    "delete:workspace_members",
    "deleteUser",
    "delete:invites",
  ]);
});

Deno.test("cancelInvite throws when the final invites delete errors", async () => {
  const admin = makeCancelAdmin({
    invite: { id: "i1", conta_id: "c1", email: "a@x.com", status: "pending" },
    invitesDeleteError: true,
  });
  // deno-lint-ignore no-explicit-any
  await assertThrowsAsyncMessage(() => cancelInvite(admin as any, { inviteId: "i1", contaId: "c1" }), "cancel_invite_final_delete_failed");
});

Deno.test("cancelInvite keeps an onboarded user (no global delete)", async () => {
  const admin = makeCancelAdmin({
    invite: { id: "i1", conta_id: "c1", email: "a@x.com", status: "pending" },
    authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    onboarding: true,
    hasPassword: true,
    memberships: ["c1", "c2"],
  });
  // deno-lint-ignore no-explicit-any
  const res = await cancelInvite(admin as any, { inviteId: "i1", contaId: "c1" });
  assertEquals(res.deletedUser, false);
  assert(!admin._deletes().includes("auth:u1"), "must NOT delete an onboarded user");
});

// Small helper: assert an async fn throws with a message containing `needle`.
async function assertThrowsAsyncMessage(fn: () => Promise<unknown>, needle: string) {
  let threw = false;
  try { await fn(); } catch (e) { threw = true; assert(String((e as Error).message).includes(needle), `expected "${needle}" in "${(e as Error).message}"`); }
  assert(threw, `expected throw containing "${needle}"`);
}

import { inviteOrResend } from "../_shared/invite-actions.ts";

// Fake admin client. `pendingOtherEmails` is the pending count for OTHER emails
// (the seat check excludes a matching pending row for THIS email — finding 3).
// `matchingPending` says whether a pending row exists for THIS email.
// `failTable` injects a Supabase { error } on the first insert/delete to that
// table (finding 2). `memberships` is the user's workspace set (finding 5).
function makeInviteAdmin(opts: {
  limit: number | null;
  members: number;
  pendingOtherEmails?: number;
  matchingPending?: boolean;
  authUser?: { id: string; email_confirmed_at: string | null } | null;
  onboarding?: boolean | null;      // profiles.onboarding_complete
  hasProfile?: boolean;
  hasPassword?: boolean | null;
  isMember?: boolean;
  memberships?: string[];
  failTable?: string;               // e.g. "workspace_members" -> insert/delete returns { error }
}) {
  const events: string[] = [];
  const failErr = { message: "injected failure" };
  return {
    _events: () => events,
    auth: {
      admin: {
        // deno-lint-ignore no-explicit-any
        listUsers: (_a: any) => Promise.resolve({ data: { users: opts.authUser ? [{ ...opts.authUser, email: "a@x.com" }] : [] }, error: null }),
        deleteUser: (id: string) => { events.push("delUser:" + id); return Promise.resolve({ error: opts.failTable === "auth" ? failErr : null }); },
        generateLink: (_a: any) => { events.push("genLink"); return Promise.resolve({ data: { properties: { action_link: "https://link" } }, error: null }); },
        inviteUserByEmail: (_e: string, _o: any) => { events.push("authInvite"); return Promise.resolve({ error: null }); },
      },
    },
    // deno-lint-ignore no-explicit-any
    rpc: (fn: string, _params: any) => {
      if (fn === "effective_plan_limit") return Promise.resolve({ data: opts.limit, error: null });
      if (fn === "user_has_password") return Promise.resolve({ data: opts.hasPassword ?? null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const api: any = {
        // select("*", {head:true}) is the seat count path; .neq(...) marks the members-exclusion.
        select: (_c?: string, o?: any) => { if (o?.head) api._head = true; return api; },
        eq: () => api,
        neq: () => api,
        in: () => api,
        delete: () => { events.push("del:" + table); return { ...api, _err: opts.failTable === table }; },
        insert: (row: any) => {
          events.push("ins:" + table + ":" + (row.status ?? ""));
          const err = opts.failTable === table ? failErr : null;
          return { select: () => ({ single: () => Promise.resolve({ data: err ? null : { id: "new-invite" }, error: err }) }), then: (r: (x: any) => unknown) => Promise.resolve(r({ data: null, error: err })) };
        },
        maybeSingle: () => {
          if (table === "profiles") return Promise.resolve({ data: opts.hasProfile === false ? null : { onboarding_complete: opts.onboarding ?? false, id: "u1" }, error: null });
          if (table === "workspace_members") return Promise.resolve({ data: opts.isMember ? { id: "m1" } : null, error: null });
          if (table === "contas") return Promise.resolve({ data: { nome: "WS" }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then: (r: (x: any) => unknown) => {
          if (api._head && table === "workspace_members") return Promise.resolve(r({ count: opts.members, error: null }));
          if (api._head && table === "invites") return Promise.resolve(r({ count: opts.pendingOtherEmails ?? 0, error: null }));
          if (table === "workspace_members") return Promise.resolve(r({ data: (opts.memberships ?? []).map((w) => ({ workspace_id: w })), error: null }));
          return Promise.resolve(r({ data: null, error: (api as any)._err ? failErr : null }));
        },
      };
      return api;
    },
  };
}

const baseInput = { contaId: "c1", email: "a@x.com", role: "agent" as const, invitedBy: "owner1", redirectBase: "https://app" };
const CRM = { addOnboarded: true };
const ADMIN = { addOnboarded: false };

Deno.test("inviteOrResend: a brand-new email at the limit is rejected before any send", async () => {
  const admin = makeInviteAdmin({ limit: 3, members: 3, pendingOtherEmails: 0 });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, CRM);
  assertEquals(out.route, "plan-limit-exceeded");
  assert(!admin._events().includes("authInvite"), "must not send when over limit");
});

Deno.test("inviteOrResend: resending an existing pending invite at the limit SUCCEEDS (finding 3)", async () => {
  // Workspace is at capacity via members(2) + THIS email's own pending row = limit(3).
  // The seat count EXCLUDES this email's pending (pendingOtherEmails: 0), so the code
  // sees 2 < 3 and proceeds. A naive check that counted this email's pending would see
  // 3 and wrongly reject — that this test passes proves the exclusion is load-bearing.
  const admin = makeInviteAdmin({ limit: 3, members: 2, pendingOtherEmails: 0, matchingPending: true, authUser: null });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, ADMIN);
  assertEquals(out.route, "invited");
});

Deno.test("inviteOrResend: brand-new email sends an auth invite", async () => {
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: null });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, CRM);
  assertEquals(out.route, "invited");
  assert(admin._events().includes("authInvite"));
});

Deno.test("inviteOrResend: confirmed-but-passwordless gets a fresh recovery link", async () => {
  // The resend-link route emails via Resend; stub env + fetch so the HTTP call
  // succeeds without a real key. Restore both afterwards.
  const prevKey = Deno.env.get("RESEND_API_KEY");
  Deno.env.set("RESEND_API_KEY", "test-key");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  try {
    const admin = makeInviteAdmin({ limit: null, members: 1, matchingPending: true, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: false, hasPassword: false });
    // deno-lint-ignore no-explicit-any
    const out = await inviteOrResend(admin as any, baseInput, ADMIN);
    assertEquals(out.route, "resent-link");
    assert(admin._events().includes("genLink"));
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) Deno.env.delete("RESEND_API_KEY"); else Deno.env.set("RESEND_API_KEY", prevKey);
  }
});

Deno.test("inviteOrResend CRM mode: onboarded non-member is ADDED", async () => {
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: true, hasPassword: true, isMember: false });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, CRM);
  assertEquals(out.route, "added");
  assert(admin._events().includes("ins:workspace_members:"), "expected a membership insert");
  assert(admin._events().includes("ins:invites:accepted"), "expected an accepted invite row");
});

Deno.test("inviteOrResend ADMIN mode: onboarded non-member is REPORTED, not added (finding 1)", async () => {
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: true, hasPassword: true, isMember: false });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, ADMIN);
  assertEquals(out.route, "already-onboarded");
  assert(!admin._events().some((e) => e.startsWith("ins:workspace_members")), "must NOT add a member");
  assert(!admin._events().some((e) => e.startsWith("del:invites")), "must NOT delete the pending invite");
});

Deno.test("inviteOrResend: onboarded existing member is a no-op already-member", async () => {
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: true, hasPassword: true, isMember: true });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, ADMIN);
  assertEquals(out.route, "already-member");
});

Deno.test("inviteOrResend: never-confirmed stale user is reinvited and reports affected workspaces (finding 5)", async () => {
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: null }, hasProfile: true, onboarding: false, hasPassword: false, memberships: ["c1", "c2"] });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, ADMIN);
  assertEquals(out.route, "reinvited");
  assertEquals((out.affectedWorkspaceIds ?? []).sort(), ["c1", "c2"]);
  assert(admin._events().includes("delUser:u1"), "reinvite deletes the stale user");
  assert(admin._events().includes("authInvite"), "then sends a fresh invite");
});

Deno.test("inviteOrResend: blocked-anomalous does NOT delete the invite (finding 4)", async () => {
  // Confirmed auth user with NO profile row -> blocked-anomalous. Classify runs
  // before any delete, so the pending invite survives.
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: false, hasPassword: null });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, ADMIN);
  assertEquals(out.route, "blocked-anomalous");
  assert(!admin._events().some((e) => e.startsWith("del:invites")), "must not delete the invite");
});

Deno.test("inviteOrResend: a failed membership insert throws, never reports success (finding 2)", async () => {
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: true, hasPassword: true, isMember: false, failTable: "workspace_members" });
  let threw = false;
  // deno-lint-ignore no-explicit-any
  try { await inviteOrResend(admin as any, baseInput, CRM); } catch { threw = true; }
  assert(threw, "a Supabase { error } on the member insert must throw");
});
