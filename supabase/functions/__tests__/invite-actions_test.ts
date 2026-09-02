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
        neq: () => api,
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

// Fake admin client.
// `pendingInvites` is a fixture of ALL pending invite rows in the workspace
// (both matching and non-matching the target email). The fake computes the
// seat check's pending head-count by ACTUALLY filtering this fixture against
// whatever `.neq("email", ...)` call the source code chained onto the query —
// it does not just echo back a hardcoded number. This is what makes the
// seat-exclusion invariant (finding 1) a real assertion: if the source's
// `.neq("email", email)` call were deleted or inverted, the fake would record
// no (or the wrong) exclusion and the computed count — and therefore the seat
// decision — would come out different.
// `pendingOtherEmails` is a legacy fallback (used by tests that don't care
// about the exclusion): when `pendingInvites` isn't given, the pending count
// is just this fixed number, matching the old fake's behavior.
// `matchingPending` documents whether a pending row exists for THIS email.
// `failTable` injects a Supabase { error } on the first insert/delete to that
// table (finding 2). `memberships` is the user's workspace set (finding 4/5).
function makeInviteAdmin(opts: {
  limit: number | null;
  members: number;
  pendingOtherEmails?: number;
  pendingInvites?: Array<{ email: string }>;
  matchingPending?: boolean;
  authUser?: { id: string; email_confirmed_at: string | null } | null;
  onboarding?: boolean | null;      // profiles.onboarding_complete
  hasProfile?: boolean;
  profileActiveWorkspaceId?: string | null; // existing profile's profiles.active_workspace_id
  hasPassword?: boolean | null;
  isMember?: boolean;
  memberships?: string[];
  otherPendingWorkspaceIds?: string[];  // pending invites for this email in OTHER workspaces
  failTable?: string;               // e.g. "workspace_members" -> insert/delete returns { error }
  failAuthInvite?: boolean;         // inviteUserByEmail returns { error } -> send throws
  failInviteDeleteById?: boolean;   // ONLY the rollback delete (.eq("id", ...)) returns { error }
  insertReturnsNoId?: boolean;      // insert resolves with NO error and NO row
  priorPendingMembroId?: number | null; // the replaced pending row's membro_id, for the inherit lookup
}) {
  const events: string[] = [];
  const failErr = { message: "injected failure" };
  const inserts: Array<{ table: string; row: any }> = [];
  const updates: Array<{ table: string; row: any }> = [];
  const authInviteCalls: Array<{ email: string; opts: any }> = [];
  return {
    _events: () => events,
    _inserts: () => inserts,
    _updates: () => updates,
    _authInviteCalls: () => authInviteCalls,
    auth: {
      admin: {
        // deno-lint-ignore no-explicit-any
        listUsers: (_a: any) => Promise.resolve({ data: { users: opts.authUser ? [{ ...opts.authUser, email: "a@x.com" }] : [] }, error: null }),
        deleteUser: (id: string) => { events.push("delUser:" + id); return Promise.resolve({ error: opts.failTable === "auth" ? failErr : null }); },
        generateLink: (_a: any) => { events.push("genLink"); return Promise.resolve({ data: { properties: { action_link: "https://link" } }, error: null }); },
        inviteUserByEmail: (e: string, o: any) => { events.push("authInvite"); authInviteCalls.push({ email: e, opts: o }); return Promise.resolve({ error: opts.failAuthInvite ? failErr : null }); },
      },
    },
    // deno-lint-ignore no-explicit-any
    rpc: (fn: string, _params: any) => {
      if (fn === "effective_plan_limit") return Promise.resolve({ data: opts.limit, error: null });
      if (fn === "user_has_password") return Promise.resolve({ data: opts.hasPassword ?? null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      // Fresh per `.from(table)` call, so filters recorded on one query chain
      // never leak into another.
      const neqFilters: Array<{ col: string; val: unknown }> = [];
      const eqCols: string[] = [];
      let isDelete = false;
      const api: any = {
        // select("*", {head:true}) is the seat count path; .neq(...) marks the exclusion.
        select: (_c?: string, o?: any) => { if (o?.head) api._head = true; return api; },
        eq: (col?: string) => { if (col) eqCols.push(col); return api; },
        neq: (col: string, val: unknown) => { neqFilters.push({ col, val }); return api; },
        in: () => api,
        not: () => api,
        is: () => api,
        delete: () => { events.push("del:" + table); isDelete = true; return { ...api, _err: opts.failTable === table }; },
        insert: (row: any) => {
          events.push("ins:" + table + ":" + (row.status ?? ""));
          inserts.push({ table, row });
          const err = opts.failTable === table ? failErr : null;
          const inserted = err || opts.insertReturnsNoId ? null : { id: "new-invite" };
          return { select: () => ({ single: () => Promise.resolve({ data: inserted, error: err }) }), then: (r: (x: any) => unknown) => Promise.resolve(r({ data: null, error: err })) };
        },
        update: (row: any) => { events.push("upd:" + table); updates.push({ table, row }); return api; },
        maybeSingle: () => {
          if (table === "profiles") return Promise.resolve({
            data: opts.hasProfile === false ? null : {
              onboarding_complete: opts.onboarding ?? false,
              id: "u1",
              active_workspace_id: opts.profileActiveWorkspaceId ?? null,
            },
            error: null,
          });
          if (table === "workspace_members") return Promise.resolve({ data: opts.isMember ? { id: "m1" } : null, error: null });
          if (table === "contas") return Promise.resolve({ data: { nome: "WS" }, error: null });
          if (table === "invites") {
            return Promise.resolve({
              data: opts.priorPendingMembroId != null ? { membro_id: opts.priorPendingMembroId } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then: (r: (x: any) => unknown) => {
          if (isDelete && table === "invites" && eqCols.includes("id") && opts.failInviteDeleteById) {
            return Promise.resolve(r({ data: null, error: failErr }));
          }
          if (api._head && table === "workspace_members") return Promise.resolve(r({ count: opts.members, error: null }));
          if (api._head && table === "invites") {
            const count = opts.pendingInvites
              ? opts.pendingInvites.filter((inv) =>
                  !neqFilters.some((f) => f.col === "email" && f.val === inv.email)
                ).length
              : (opts.pendingOtherEmails ?? 0);
            return Promise.resolve(r({ count, error: null }));
          }
          if (table === "invites" && !isDelete) {
            return Promise.resolve(r({ data: (opts.otherPendingWorkspaceIds ?? []).map((w) => ({ conta_id: w })), error: null }));
          }
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
  // Fixture: 2 pending rows exist workspace-wide — one is THIS email's own
  // ("a@x.com", the resend target), one is another invitee's ("b@x.com").
  // members(1) + ALL pending rows(2) = 3, which is NOT < limit(3) -- a naive
  // "count every pending row" implementation would reject this as over-limit.
  // The correct implementation excludes the target's own row via
  // `.neq("email", email)`, leaving pending=1 (just "b@x.com"), so
  // members(1)+pending(1)=2 < limit(3) and it proceeds. The fake computes the
  // count by actually filtering `pendingInvites` against the `.neq(...)` the
  // source registered (see makeInviteAdmin) rather than returning a hardcoded
  // number, so if the source's `.neq("email", email)` were removed or
  // inverted, the fake would report count=2 and this assertion (route
  // "invited") would fail with "plan-limit-exceeded" instead.
  const admin = makeInviteAdmin({
    limit: 3,
    members: 1,
    pendingInvites: [{ email: "a@x.com" }, { email: "b@x.com" }],
    matchingPending: true,
    authUser: null,
  });
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
  // "c2" is a workspace OTHER than the target, so this reinvite is gated —
  // confirmCrossWorkspace: true is what an admin who confirmed would send, and
  // is what keeps this test about the audit fan-out rather than the gate.
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: null }, hasProfile: true, onboarding: false, hasPassword: false, memberships: ["c1", "c2"] });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, { addOnboarded: false, confirmCrossWorkspace: true });
  assertEquals(out.route, "reinvited");
  assertEquals((out.affectedWorkspaceIds ?? []).sort(), ["c1", "c2"]);
  assert(admin._events().includes("delUser:u1"), "reinvite deletes the stale user");
  assert(admin._events().includes("authInvite"), "then sends a fresh invite");
});

Deno.test("inviteOrResend: reinvite still reports the current workspace when absent from captured memberships (finding 4)", async () => {
  // Unlike the test above, the captured memberships set does NOT include the
  // current workspace ("c1" — baseInput.contaId). Only "c2" is captured, so
  // input.contaId must be unioned in explicitly for "c1" to show up at all. A
  // regression that dropped it from the union would leave affectedWorkspaceIds
  // as just ["c2"] and this assertion would fail.
  // "c2" is another workspace, so this reinvite is gated too — confirm it, for
  // the same reason as the test above.
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: null }, hasProfile: true, onboarding: false, hasPassword: false, memberships: ["c2"] });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, { addOnboarded: false, confirmCrossWorkspace: true });
  assertEquals(out.route, "reinvited");
  assertEquals((out.affectedWorkspaceIds ?? []).sort(), ["c1", "c2"]);
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

Deno.test("inviteOrResend: inviteId is returned for every route that creates an invites row", async () => {
  // invited (brand-new email)
  const newUser = makeInviteAdmin({ limit: null, members: 1, authUser: null });
  // deno-lint-ignore no-explicit-any
  const invited = await inviteOrResend(newUser as any, baseInput, ADMIN);
  assertEquals(invited.route, "invited");
  assertEquals(invited.inviteId, "new-invite");

  // reinvited (never-confirmed stale user)
  const stale = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: null }, hasProfile: true, onboarding: false, hasPassword: false, memberships: ["c1"] });
  // deno-lint-ignore no-explicit-any
  const reinvited = await inviteOrResend(stale as any, baseInput, ADMIN);
  assertEquals(reinvited.route, "reinvited");
  assertEquals(reinvited.inviteId, "new-invite");

  // added (CRM mode, onboarded non-member)
  const onboarded = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: true, hasPassword: true, isMember: false });
  // deno-lint-ignore no-explicit-any
  const added = await inviteOrResend(onboarded as any, baseInput, CRM);
  assertEquals(added.route, "added");
  assertEquals(added.inviteId, "new-invite");
});

Deno.test("inviteOrResend: resent-link returns the id of the NEW pending row", async () => {
  const prevKey = Deno.env.get("RESEND_API_KEY");
  Deno.env.set("RESEND_API_KEY", "test-key");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  try {
    const admin = makeInviteAdmin({ limit: null, members: 1, matchingPending: true, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: false, hasPassword: false });
    // deno-lint-ignore no-explicit-any
    const out = await inviteOrResend(admin as any, baseInput, ADMIN);
    assertEquals(out.route, "resent-link");
    assertEquals(out.inviteId, "new-invite");
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) Deno.env.delete("RESEND_API_KEY"); else Deno.env.set("RESEND_API_KEY", prevKey);
  }
});

Deno.test("inviteOrResend: no-op routes carry NO inviteId", async () => {
  const onboarded = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: true, hasPassword: true, isMember: false });
  // deno-lint-ignore no-explicit-any
  assertEquals((await inviteOrResend(onboarded as any, baseInput, ADMIN)).inviteId, undefined);

  const member = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: true, hasPassword: true, isMember: true });
  // deno-lint-ignore no-explicit-any
  assertEquals((await inviteOrResend(member as any, baseInput, ADMIN)).inviteId, undefined);

  const full = makeInviteAdmin({ limit: 3, members: 3, pendingOtherEmails: 0 });
  // deno-lint-ignore no-explicit-any
  assertEquals((await inviteOrResend(full as any, baseInput, ADMIN)).inviteId, undefined);

  const anomalous = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: false, hasPassword: null });
  // deno-lint-ignore no-explicit-any
  assertEquals((await inviteOrResend(anomalous as any, baseInput, ADMIN)).inviteId, undefined);
});

Deno.test("inviteOrResend: an insert that returns no error AND no row throws, never a silent undefined id", async () => {
  // The contract is that inviteId is ALWAYS present on a creating route.
  // Checking only `error` would return inviteId: undefined here and silently
  // drop the audit resource_id.
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: true, hasPassword: true, isMember: false, insertReturnsNoId: true });
  let message = "";
  try {
    // deno-lint-ignore no-explicit-any
    await inviteOrResend(admin as any, baseInput, CRM);
  } catch (e) {
    message = (e as Error).message;
  }
  assertEquals(message, "invite_mutation_failed:invite_insert_accepted");
});

Deno.test("inviteOrResend: a failed rollback delete is logged, and the original send error still propagates", async () => {
  // inviteUserByEmail fails AFTER the pending row was inserted, so the rollback
  // runs; the rollback's own delete also fails. Before the fix that delete's
  // { error } was discarded, so the phantom pending row left NO trace at all.
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: null, failAuthInvite: true, failInviteDeleteById: true });
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    await inviteOrResend(admin as any, baseInput, ADMIN);
  } catch {
    threw = true;
  } finally {
    console.error = original;
  }
  assert(threw, "the original send failure must still propagate to the caller");
  assert(
    logged.some((l) => String(l[0]).includes("pending invite cleanup failed")),
    "the failed rollback must be logged",
  );
});

Deno.test("inviteOrResend: reinvite touching ONLY the target workspace proceeds without asking", async () => {
  // The motivating typo case: an orphan account that exists solely because of
  // the mistyped address. Nothing else is affected, so no prompt.
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: null }, hasProfile: true, onboarding: false, hasPassword: false, memberships: ["c1"] });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, ADMIN);
  assertEquals(out.route, "reinvited");
  assert(admin._events().includes("delUser:u1"));
});

Deno.test("inviteOrResend: reinvite reaching another workspace's MEMBERSHIP stops before mutating", async () => {
  // The self-signup-who-never-confirmed case: they own workspace "c2".
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: null }, hasProfile: true, onboarding: false, hasPassword: false, memberships: ["c1", "c2"] });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, ADMIN);
  assertEquals(out.route, "needs-confirmation");
  assertEquals(out.affectedWorkspaceIds, ["c2"]); // only the OTHER workspaces
  assert(!admin._events().includes("delUser:u1"), "must not delete the user");
  assert(!admin._events().some((e) => e.startsWith("del:invites")), "must not clear the target's pending invite either");
  assert(!admin._events().includes("authInvite"), "must not send anything");
});

Deno.test("inviteOrResend: reinvite reaching another workspace's PENDING INVITE also stops", async () => {
  // No membership anywhere — the ordinary-invitee shape. The damage here is the
  // dead link left behind in workspace "c3", which workspace_members cannot see.
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: null }, hasProfile: true, onboarding: false, hasPassword: false, memberships: [], otherPendingWorkspaceIds: ["c3"] });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, ADMIN);
  assertEquals(out.route, "needs-confirmation");
  assertEquals(out.affectedWorkspaceIds, ["c3"]);
  assert(!admin._events().includes("delUser:u1"));
});

Deno.test("inviteOrResend: confirmCrossWorkspace proceeds and audits the UNION of both impacts", async () => {
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: null }, hasProfile: true, onboarding: false, hasPassword: false, memberships: ["c1", "c2"], otherPendingWorkspaceIds: ["c3"] });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, { addOnboarded: false, confirmCrossWorkspace: true });
  assertEquals(out.route, "reinvited");
  assertEquals((out.affectedWorkspaceIds ?? []).sort(), ["c1", "c2", "c3"]);
  assert(admin._events().includes("delUser:u1"));
  assert(admin._events().includes("authInvite"));
});

Deno.test("inviteOrResend: an ALREADY-ONBOARDED user is never gated — nothing to confirm", async () => {
  // Confirms the reassurance in the spec: someone who accepted elsewhere takes
  // add-direct, so the destructive route is unreachable for them.
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" }, hasProfile: true, onboarding: true, hasPassword: true, isMember: false, memberships: ["c1", "c2"] });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, ADMIN);
  assertEquals(out.route, "already-onboarded");
  assert(!admin._events().includes("delUser:u1"));
});

Deno.test("inviteOrResend: explicit membroId is stamped on the new pending invite row", async () => {
  const admin = makeInviteAdmin({ limit: null, members: 0, authUser: null });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, { ...baseInput, membroId: 7 }, CRM);
  assertEquals(out.route, "invited");
  const inviteRow = admin._inserts().find((i) => i.table === "invites");
  assertEquals(inviteRow?.row.membro_id, 7);
});

Deno.test("inviteOrResend: added route stamps membro_id AND links the membro immediately", async () => {
  const admin = makeInviteAdmin({
    limit: null, members: 0,
    authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    onboarding: true, hasProfile: true, hasPassword: true, isMember: false,
  });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, { ...baseInput, membroId: 7 }, CRM);
  assertEquals(out.route, "added");
  const inviteRow = admin._inserts().find((i) => i.table === "invites");
  assertEquals(inviteRow?.row.membro_id, 7);
  const link = admin._updates().find((u) => u.table === "membros");
  assertEquals(link?.row.crm_user_id, "u1");
});

Deno.test("inviteOrResend: added route WITHOUT membroId never touches membros", async () => {
  const admin = makeInviteAdmin({
    limit: null, members: 0,
    authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    onboarding: true, hasProfile: true, hasPassword: true, isMember: false,
  });
  // deno-lint-ignore no-explicit-any
  await inviteOrResend(admin as any, baseInput, CRM);
  assertEquals(admin._updates().filter((u) => u.table === "membros").length, 0);
});

Deno.test("inviteOrResend: a resend with NO membroId inherits the replaced pending row's link", async () => {
  const admin = makeInviteAdmin({
    limit: null, members: 0, authUser: null, priorPendingMembroId: 7,
  });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, ADMIN);
  assertEquals(out.route, "invited");
  const inviteRow = admin._inserts().find((i) => i.table === "invites");
  assertEquals(inviteRow?.row.membro_id, 7);
});

Deno.test("inviteOrResend: an explicit membroId beats the inherited one", async () => {
  const admin = makeInviteAdmin({
    limit: null, members: 0, authUser: null, priorPendingMembroId: 7,
  });
  // deno-lint-ignore no-explicit-any
  await inviteOrResend(admin as any, { ...baseInput, membroId: 9 }, CRM);
  const inviteRow = admin._inserts().find((i) => i.table === "invites");
  assertEquals(inviteRow?.row.membro_id, 9);
});

Deno.test("inviteOrResend CRM mode: add-direct restores active_workspace_id when the existing profile has none", async () => {
  // Reproduces the Ana bug: an already-onboarded user with a live profile row
  // but NO active workspace (e.g. just removed from their only membership)
  // gets silently re-added. Without a restore, they end up with a session and
  // a workspace_members row but every RLS-gated query returns nothing.
  const admin = makeInviteAdmin({
    limit: null, members: 1,
    authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    hasProfile: true, profileActiveWorkspaceId: null, onboarding: true, hasPassword: true, isMember: false,
  });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, CRM);
  assertEquals(out.route, "added");
  const profileUpdate = admin._updates().find((u) => u.table === "profiles");
  assert(profileUpdate, "expected a profiles update restoring active_workspace_id");
  assertEquals(profileUpdate!.row.active_workspace_id, "c1");
  assertEquals(profileUpdate!.row.conta_id, "c1");
});

Deno.test("inviteOrResend CRM mode: add-direct does NOT overwrite an active_workspace_id already pointing elsewhere", async () => {
  // The Maria Luiza case: the existing profile's active workspace is a
  // DIFFERENT, still-valid workspace (e.g. one they own). Being added to a
  // second workspace must not silently switch them away from it.
  const admin = makeInviteAdmin({
    limit: null, members: 1,
    authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    hasProfile: true, profileActiveWorkspaceId: "own-workspace", onboarding: true, hasPassword: true, isMember: false,
  });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, CRM);
  assertEquals(out.route, "added");
  assert(!admin._updates().some((u) => u.table === "profiles"), "must not touch an already-set active_workspace_id");
});

Deno.test("inviteOrResend: resend-link route also stamps membro_id", async () => {
  // Same RESEND_API_KEY/fetch stubbing as the other resend-link tests above —
  // sendInviteEmail throws without it.
  const prevKey = Deno.env.get("RESEND_API_KEY");
  Deno.env.set("RESEND_API_KEY", "test-key");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  try {
    const admin = makeInviteAdmin({
      limit: null, members: 0,
      authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
      onboarding: false, hasProfile: true, hasPassword: false,
    });
    // deno-lint-ignore no-explicit-any
    const out = await inviteOrResend(admin as any, { ...baseInput, membroId: 7 }, ADMIN);
    assertEquals(out.route, "resent-link");
    const inviteRow = admin._inserts().find((i) => i.table === "invites");
    assertEquals(inviteRow?.row.membro_id, 7);
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) Deno.env.delete("RESEND_API_KEY"); else Deno.env.set("RESEND_API_KEY", prevKey);
  }
});

// -----------------------------------------------------------------------
// role_id threading (Task 6). Mirrors the membroId coverage above: every
// route that inserts an `invites` row must stamp role_id, and — per the
// chassis-rule fix (codex PR-A finding 1) — invites.role ALSO collapses to
// 'agent' whenever roleId is present, exactly like the membership row. This
// is what keeps a later role_id deletion (ON DELETE SET NULL) from
// resurrecting the caller's original, possibly stronger, legacy role on
// accept_workspace_invite's no-role_id path.
// -----------------------------------------------------------------------

Deno.test("inviteOrResend: brand-new email WITH roleId stamps invites.role='agent' + role_id (chassis rule)", async () => {
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: null });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, { ...baseInput, role: "admin", roleId: "role-1" }, CRM);
  assertEquals(out.route, "invited");
  const inviteRow = admin._inserts().find((i) => i.table === "invites");
  assertEquals(inviteRow?.row.role_id, "role-1");
  assertEquals(inviteRow?.row.role, "agent"); // chassis rule, NOT the requested "admin"
});

Deno.test("inviteOrResend: brand-new email WITH roleId also stamps 'agent' into the auth-invite user_metadata", async () => {
  // Kept consistent with invites.role for the same chassis-rule reason —
  // metadata.role is informational (accept_workspace_invite resolves the
  // real membership role from invites.role_id), but there is no reason to
  // have it disagree with invites.role.
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: null });
  // deno-lint-ignore no-explicit-any
  await inviteOrResend(admin as any, { ...baseInput, role: "admin", roleId: "role-1" }, CRM);
  const call = admin._authInviteCalls()[0];
  assertEquals(call?.opts?.data?.role, "agent");
});

Deno.test("inviteOrResend: brand-new email WITHOUT roleId stamps role_id: null (regression)", async () => {
  const admin = makeInviteAdmin({ limit: null, members: 1, authUser: null });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, CRM);
  assertEquals(out.route, "invited");
  const inviteRow = admin._inserts().find((i) => i.table === "invites");
  assertEquals(inviteRow?.row.role_id, null);
});

Deno.test("inviteOrResend CRM mode: add-direct WITH roleId inserts membership role='agent' + role_id (chassis rule)", async () => {
  const admin = makeInviteAdmin({
    limit: null, members: 1,
    authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    hasProfile: true, onboarding: true, hasPassword: true, isMember: false,
  });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, { ...baseInput, roleId: "role-1" }, CRM);
  assertEquals(out.route, "added");
  const memberRow = admin._inserts().find((i) => i.table === "workspace_members");
  assertEquals(memberRow?.row.role, "agent"); // chassis role, NOT baseInput.role ("agent" here too, but forced regardless)
  assertEquals(memberRow?.row.role_id, "role-1");
  const inviteRow = admin._inserts().find((i) => i.table === "invites");
  assertEquals(inviteRow?.row.role, "agent"); // chassis rule applies to invites.role too (codex PR-A finding 1)
  assertEquals(inviteRow?.row.role_id, "role-1");
});

Deno.test("inviteOrResend CRM mode: add-direct with a non-agent legacy role + roleId forces BOTH membership AND invites.role to 'agent'", async () => {
  // baseInput.role is "agent"; use "admin" here so a regression that forgot
  // the chassis collapse (and just wrote input.role) would be caught on
  // either row.
  const admin = makeInviteAdmin({
    limit: null, members: 1,
    authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    hasProfile: true, onboarding: true, hasPassword: true, isMember: false,
  });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, { ...baseInput, role: "admin", roleId: "role-1" }, CRM);
  assertEquals(out.route, "added");
  const memberRow = admin._inserts().find((i) => i.table === "workspace_members");
  assertEquals(memberRow?.row.role, "agent");
  const inviteRow = admin._inserts().find((i) => i.table === "invites");
  // NOT "admin" — a deleted custom role (role_id -> NULL via ON DELETE SET
  // NULL) must never leave behind a stronger legacy role for
  // accept_workspace_invite's no-role_id path to grant (finding 1).
  assertEquals(inviteRow?.row.role, "agent");
});

Deno.test("inviteOrResend CRM mode: add-direct WITHOUT roleId keeps the legacy role + role_id: null (regression)", async () => {
  const admin = makeInviteAdmin({
    limit: null, members: 1,
    authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    hasProfile: true, onboarding: true, hasPassword: true, isMember: false,
  });
  // deno-lint-ignore no-explicit-any
  const out = await inviteOrResend(admin as any, baseInput, CRM);
  assertEquals(out.route, "added");
  const memberRow = admin._inserts().find((i) => i.table === "workspace_members");
  assertEquals(memberRow?.row.role, baseInput.role);
  assertEquals(memberRow?.row.role_id, null);
  const inviteRow = admin._inserts().find((i) => i.table === "invites");
  assertEquals(inviteRow?.row.role_id, null);
});

Deno.test("inviteOrResend: resend-link route WITH roleId preserves role_id and stamps role='agent' on the re-inserted invite (chassis rule)", async () => {
  const prevKey = Deno.env.get("RESEND_API_KEY");
  Deno.env.set("RESEND_API_KEY", "test-key");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  try {
    const admin = makeInviteAdmin({
      limit: null, members: 0,
      authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
      onboarding: false, hasProfile: true, hasPassword: false,
    });
    // deno-lint-ignore no-explicit-any
    const out = await inviteOrResend(admin as any, { ...baseInput, role: "admin", roleId: "role-2" }, ADMIN);
    assertEquals(out.route, "resent-link");
    const inviteRow = admin._inserts().find((i) => i.table === "invites");
    assertEquals(inviteRow?.row.role_id, "role-2");
    assertEquals(inviteRow?.row.role, "agent"); // NOT "admin" — finding 1
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) Deno.env.delete("RESEND_API_KEY"); else Deno.env.set("RESEND_API_KEY", prevKey);
  }
});

Deno.test("inviteOrResend: resend-link route WITHOUT roleId stamps role_id: null (regression)", async () => {
  const prevKey = Deno.env.get("RESEND_API_KEY");
  Deno.env.set("RESEND_API_KEY", "test-key");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  try {
    const admin = makeInviteAdmin({
      limit: null, members: 0,
      authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
      onboarding: false, hasProfile: true, hasPassword: false,
    });
    // deno-lint-ignore no-explicit-any
    const out = await inviteOrResend(admin as any, baseInput, ADMIN);
    assertEquals(out.route, "resent-link");
    const inviteRow = admin._inserts().find((i) => i.table === "invites");
    assertEquals(inviteRow?.row.role_id, null);
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) Deno.env.delete("RESEND_API_KEY"); else Deno.env.set("RESEND_API_KEY", prevKey);
  }
});
