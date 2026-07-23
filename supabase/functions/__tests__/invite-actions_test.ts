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
