import { assert, assertEquals } from "./assert.ts";
import { computeInviteFlags } from "../platform-admin/invites-enrich.ts";

Deno.test("computeInviteFlags flags an add-direct (accepted_at ~= created_at) as silent_add", () => {
  const f = computeInviteFlags({
    status: "accepted",
    created_at: "2026-07-21T15:58:06.000Z",
    accepted_at: "2026-07-21T15:58:05.900Z",
  });
  assertEquals(f.silent_add, true);
  assertEquals(f.link_expired, false);
});

Deno.test("computeInviteFlags does NOT flag a normal accepted invite as silent_add", () => {
  const f = computeInviteFlags({
    status: "accepted",
    created_at: "2026-07-21T15:46:22.000Z",
    accepted_at: "2026-07-21T15:47:09.000Z", // 47s later
  });
  assertEquals(f.silent_add, false);
});

Deno.test("computeInviteFlags marks a pending invite link expired 24h after its OWN created_at", () => {
  const now = new Date("2026-07-23T13:00:00.000Z").getTime();
  const f = computeInviteFlags(
    { status: "pending", created_at: "2026-07-21T12:00:00.000Z", accepted_at: null }, // >24h old
    now,
  );
  assertEquals(f.link_expired, true);
});

Deno.test("computeInviteFlags: a recently-created pending invite is not expired", () => {
  const now = new Date("2026-07-23T13:00:00.000Z").getTime();
  const f = computeInviteFlags(
    { status: "pending", created_at: "2026-07-23T12:00:00.000Z", accepted_at: null }, // 1h old
    now,
  );
  assertEquals(f.link_expired, false);
});

import { resendMessage } from "../platform-admin/invites-enrich.ts";

Deno.test("resendMessage maps plan-limit-exceeded to a 403", () => {
  const r = resendMessage("plan-limit-exceeded");
  assertEquals(r.status, 403);
  assertEquals(r.body.error, "plan_limit_exceeded");
});

Deno.test("resendMessage maps already-onboarded/already-member to 200 info", () => {
  assertEquals(resendMessage("already-onboarded").status, 200);
  assert(String(resendMessage("already-onboarded").body.message).length > 0);
  assertEquals(resendMessage("already-member").status, 200);
});

Deno.test("resendMessage maps blocked-anomalous to a 409", () => {
  assertEquals(resendMessage("blocked-anomalous").status, 409);
});

Deno.test("resendMessage maps a normal invite/resent-link/reinvited to 200 success", () => {
  for (const route of ["invited", "resent-link", "reinvited"] as const) {
    assertEquals(resendMessage(route).status, 200);
  }
});

import { validateResendTarget } from "../platform-admin/invites-enrich.ts";

Deno.test("validateResendTarget: 404 when the invite is missing / wrong workspace", () => {
  const r = validateResendTarget(null);
  assertEquals(r?.status, 404);
});

Deno.test("validateResendTarget: 400 when the invite is already accepted", () => {
  const r = validateResendTarget({ status: "accepted" });
  assertEquals(r?.status, 400);
});

Deno.test("validateResendTarget: null (ok) for pending/expired", () => {
  assertEquals(validateResendTarget({ status: "pending" }), null);
  assertEquals(validateResendTarget({ status: "expired" }), null);
});

import { handleAdminCancelInvite, handleAdminResendInvite } from "../platform-admin/invite-handlers.ts";

const H = { "Content-Type": "application/json" };

// Fake svc for the CANCEL handler. `invite` is the invites lookup result;
// `authUser`/`onboarding`/`hasPassword` drive the delete decision; `memberships`
// is the user's workspace set. Records audit_log inserts.
function makeCancelSvc(opts: {
  invite: { id: string; conta_id: string; email: string; status: string } | null;
  authUser?: { id: string; email_confirmed_at: string | null } | null;
  onboarding?: boolean;
  hasPassword?: boolean | null;
  memberships?: string[];
}) {
  const audits: any[] = [];
  const svc: any = {
    _audits: () => audits,
    auth: { admin: {
      listUsers: (_a: any) => Promise.resolve({ data: { users: opts.authUser ? [{ ...opts.authUser, email: opts.invite?.email }] : [] }, error: null }),
      deleteUser: (_id: string) => Promise.resolve({ error: null }),
    } },
    rpc: (_fn: string, _p: any) => Promise.resolve({ data: opts.hasPassword ?? null, error: null }),
    from: (table: string) => {
      const api: any = {
        select: () => api, eq: () => api, neq: () => api, in: () => api, delete: () => api,
        insert: (row: any) => { if (table === "audit_log") audits.push(row); return Promise.resolve({ error: null }); },
        maybeSingle: () => {
          if (table === "invites") return Promise.resolve({ data: opts.invite, error: null });
          if (table === "profiles") return Promise.resolve({ data: opts.onboarding !== undefined ? { onboarding_complete: opts.onboarding } : null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then: (r: (x: any) => unknown) => Promise.resolve(r(table === "workspace_members" ? { data: (opts.memberships ?? []).map((w) => ({ workspace_id: w })), error: null } : { data: null, error: null })),
      };
      return api;
    },
  };
  return svc;
}

Deno.test("handleAdminCancelInvite: accepted invite → 400", async () => {
  const svc = makeCancelSvc({ invite: { id: "i1", conta_id: "c1", email: "a@x.com", status: "accepted" } });
  const res = await handleAdminCancelInvite(svc, { workspace_id: "c1", invite_id: "i1" }, "admin1", H);
  assertEquals(res.status, 400);
});

Deno.test("handleAdminCancelInvite: missing invite → 404", async () => {
  const svc = makeCancelSvc({ invite: null });
  const res = await handleAdminCancelInvite(svc, { workspace_id: "c1", invite_id: "i1" }, "admin1", H);
  assertEquals(res.status, 404);
});

Deno.test("handleAdminCancelInvite: global delete audits EACH affected workspace with one operation_id", async () => {
  const svc = makeCancelSvc({
    invite: { id: "i1", conta_id: "c1", email: "a@x.com", status: "pending" },
    authUser: { id: "u1", email_confirmed_at: null }, // never confirmed → reinvite class → delete
    onboarding: false, hasPassword: false, memberships: ["c1", "c2"],
  });
  const res = await handleAdminCancelInvite(svc, { workspace_id: "c1", invite_id: "i1" }, "admin1", H);
  assertEquals(res.status, 200);
  const audits = svc._audits();
  assertEquals(audits.length, 2); // one per affected workspace
  assertEquals(new Set(audits.map((a: any) => a.conta_id)), new Set(["c1", "c2"]));
  assertEquals(new Set(audits.map((a: any) => a.metadata.operation_id)).size, 1); // shared id
});

Deno.test("handleAdminResendInvite: missing invite → 404", async () => {
  const svc: any = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }) };
  const res = await handleAdminResendInvite(svc, { workspace_id: "c1", invite_id: "i1" }, "admin1", H);
  assertEquals(res.status, 404);
});

import { validateCreateInvite, createMessage, resendOutcomeMessage } from "../platform-admin/invites-enrich.ts";

const WS = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

Deno.test("validateCreateInvite: rejects owner with the exact 400 message", () => {
  const r = validateCreateInvite({ workspace_id: WS, email: "a@x.com", role: "owner" });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 400);
    assertEquals(r.error, "role must be admin or agent");
  }
});

Deno.test("validateCreateInvite: rejects a missing or unknown role", () => {
  for (const role of [undefined, "", "OWNER", "superadmin", 7]) {
    const r = validateCreateInvite({ workspace_id: WS, email: "a@x.com", role });
    assertEquals(r.ok, false, `role ${JSON.stringify(role)} must be rejected`);
  }
});

Deno.test("validateCreateInvite: a truthy NON-STRING email is a 400, not a crash", () => {
  // Before this guard, email.toLowerCase() threw a TypeError -> opaque 500.
  const r = validateCreateInvite({ workspace_id: WS, email: 123, role: "agent" });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 400);
    assertEquals(r.error, "A valid email is required");
  }
});

Deno.test("validateCreateInvite: rejects missing, blank and malformed emails", () => {
  for (const email of [undefined, "", "   ", "nope", "no@dot", "a b@x.com", "@x.com"]) {
    const r = validateCreateInvite({ workspace_id: WS, email, role: "agent" });
    assertEquals(r.ok, false, `email ${JSON.stringify(email)} must be rejected`);
  }
});

Deno.test("validateCreateInvite: rejects a missing or malformed workspace_id", () => {
  for (const ws of [undefined, "", "not-a-uuid", 42, "11111111-2222-3333-4444-5555555555"]) {
    const r = validateCreateInvite({ workspace_id: ws, email: "a@x.com", role: "agent" });
    assertEquals(r.ok, false, `workspace_id ${JSON.stringify(ws)} must be rejected`);
    if (!r.ok) assertEquals(r.error, "workspace_id must be a valid uuid");
  }
});

Deno.test("validateCreateInvite: accepts admin/agent and normalises the email and workspace_id case", () => {
  const r = validateCreateInvite({ workspace_id: WS.toUpperCase(), email: "  Iara41.AI@Gmail.com ", role: "admin" });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.email, "iara41.ai@gmail.com");
    assertEquals(r.role, "admin");
    assertEquals(r.workspaceId, WS); // lower-cased, matching Postgres's canonical form
  }
  assertEquals(validateCreateInvite({ workspace_id: WS, email: "a@x.com", role: "agent" }).ok, true);
});

Deno.test("createMessage: already-onboarded copy is create-specific, not the resend wording", () => {
  const m = createMessage({ route: "already-onboarded" });
  assertEquals(m.status, 200);
  assertEquals(
    m.body.message,
    "This person already has an account and was NOT added to the workspace. No invite was created.",
  );
  // The resend wording claims a pending invite was left in place — false here.
  assert(!String(m.body.message).includes("left in place"));
});

Deno.test("createMessage: needs-confirmation is a 409 carrying the machine-readable count", () => {
  const m = createMessage({ route: "needs-confirmation", affectedWorkspaceIds: ["c2", "c3"] });
  assertEquals(m.status, 409);
  assertEquals(m.body.error, "cross_workspace_confirmation_required");
  assertEquals(m.body.other_workspace_count, 2); // the UI names this in its prompt
  assert(String(m.body.message).length > 0);
});

Deno.test("resendOutcomeMessage: gates identically, delegates everything else to resendMessage", () => {
  // Resend reaches the same destructive route through the same primitive, so it
  // must gate the same way — but keep its own already-onboarded wording.
  const gated = resendOutcomeMessage({ route: "needs-confirmation", affectedWorkspaceIds: ["c2"] });
  assertEquals(gated.status, 409);
  assertEquals(gated.body.other_workspace_count, 1);

  assertEquals(resendOutcomeMessage({ route: "invited", inviteId: "i1" }).body, resendMessage("invited").body);
  assertEquals(resendOutcomeMessage({ route: "already-onboarded" }).body, resendMessage("already-onboarded").body);
});

Deno.test("createMessage: delegates every other route to resendMessage", () => {
  assertEquals(createMessage({ route: "plan-limit-exceeded" }).status, 403);
  assertEquals(createMessage({ route: "blocked-anomalous" }).status, 409);
  assertEquals(createMessage({ route: "reinvited", inviteId: "i9" }).body, resendMessage("reinvited").body);
  assertEquals(createMessage({ route: "invited", inviteId: "i1" }).body, resendMessage("invited").body);
  assertEquals(createMessage({ route: "already-member" }).body, resendMessage("already-member").body);
});

import { handleAdminCreateInvite } from "../platform-admin/invite-handlers.ts";

/**
 * Fake svc covering the whole create path: the workspaces existence check, the
 * seat RPC, the auth scan inside inviteOrResend, and the invites/audit_log
 * writes. `_audits()` and `_inserts()` expose what was written.
 */
function makeCreateSvc(opts: {
  workspaceExists?: boolean;
  workspaceLookupFails?: boolean;
  inviteLookupFails?: boolean;
  limit?: number | null;
  members?: number;
  authUser?: { id: string; email_confirmed_at: string | null } | null;
  onboarding?: boolean;
  hasPassword?: boolean | null;
  memberships?: string[];
  otherPendingWorkspaceIds?: string[];
  invite?: { id: string; conta_id: string; email: string; role: string; status: string; invited_by: string } | null;
} = {}) {
  const audits: any[] = [];
  const inserts: Array<{ table: string; row: any }> = [];
  return {
    _audits: () => audits,
    _inserts: () => inserts,
    auth: { admin: {
      listUsers: (_a: any) => Promise.resolve({ data: { users: opts.authUser ? [{ ...opts.authUser, email: "new@x.com" }] : [] }, error: null }),
      deleteUser: (_id: string) => Promise.resolve({ error: null }),
      inviteUserByEmail: (_e: string, _o: any) => Promise.resolve({ error: null }),
      generateLink: (_a: any) => Promise.resolve({ data: { properties: { action_link: "https://link" } }, error: null }),
    } },
    rpc: (fn: string, _p: any) => {
      if (fn === "effective_plan_limit") return Promise.resolve({ data: opts.limit ?? null, error: null });
      if (fn === "user_has_password") return Promise.resolve({ data: opts.hasPassword ?? null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const api: any = {
        _head: false,
        select: (_c?: string, o?: any) => { if (o?.head) api._head = true; return api; },
        _isDelete: false,
        eq: () => api, neq: () => api, in: () => api, not: () => api,
        delete: () => { api._isDelete = true; return api; },
        insert: (row: any) => {
          if (table === "audit_log") { audits.push(row); return Promise.resolve({ error: null }); }
          inserts.push({ table, row });
          return {
            select: () => ({ single: () => Promise.resolve({ data: { id: "created-invite" }, error: null }) }),
            then: (r: (x: any) => unknown) => Promise.resolve(r({ data: null, error: null })),
          };
        },
        maybeSingle: () => {
          if (table === "workspaces") {
            if (opts.workspaceLookupFails) return Promise.resolve({ data: null, error: { message: "PostgREST down" } });
            return Promise.resolve({ data: opts.workspaceExists === false ? null : { id: "ws" }, error: null });
          }
          if (table === "invites") {
            if (opts.inviteLookupFails) return Promise.resolve({ data: null, error: { message: "PostgREST down" } });
            return Promise.resolve({ data: opts.invite ?? null, error: null });
          }
          if (table === "profiles") return Promise.resolve({ data: opts.onboarding === undefined ? null : { onboarding_complete: opts.onboarding, id: "u1" }, error: null });
          if (table === "contas") return Promise.resolve({ data: { nome: "WS" }, error: null });
          return Promise.resolve({ data: null, error: null }); // workspace_members: not a member
        },
        then: (r: (x: any) => unknown) => {
          if (api._head && table === "workspace_members") return Promise.resolve(r({ count: opts.members ?? 0, error: null }));
          if (api._head && table === "invites") return Promise.resolve(r({ count: 0, error: null }));
          if (table === "workspace_members") return Promise.resolve(r({ data: (opts.memberships ?? []).map((w) => ({ workspace_id: w })), error: null }));
          // captureOrphanImpact's pending-invite read (a non-head, non-delete select)
          if (table === "invites" && !api._isDelete) {
            return Promise.resolve(r({ data: (opts.otherPendingWorkspaceIds ?? []).map((w) => ({ conta_id: w })), error: null }));
          }
          return Promise.resolve(r({ data: null, error: null }));
        },
      };
      return api;
    },
  };
}

const OK_BODY = { workspace_id: WS, email: "new@x.com", role: "agent" };

Deno.test("handleAdminCreateInvite: role owner is rejected 400 before any work", async () => {
  const svc = makeCreateSvc();
  const res = await handleAdminCreateInvite(svc as any, { ...OK_BODY, role: "owner" }, "admin1", H);
  assertEquals(res.status, 400);
  assertEquals(svc._inserts().length, 0);
});

Deno.test("handleAdminCreateInvite: a non-string email is a 400, never a 500", async () => {
  const svc = makeCreateSvc();
  const res = await handleAdminCreateInvite(svc as any, { ...OK_BODY, email: 123 }, "admin1", H);
  assertEquals(res.status, 400);
});

Deno.test("handleAdminCreateInvite: a malformed workspace_id is a 400", async () => {
  const svc = makeCreateSvc();
  const res = await handleAdminCreateInvite(svc as any, { ...OK_BODY, workspace_id: "nope" }, "admin1", H);
  assertEquals(res.status, 400);
});

Deno.test("handleAdminCreateInvite: an unknown workspace is a 404, NOT a misleading 403", async () => {
  // effective_plan_limit returns 0 for an unknown workspace, so without this
  // check seatsAvailable computes 0+0 < 0 -> false -> plan-limit-exceeded (403).
  const svc = makeCreateSvc({ workspaceExists: false });
  const res = await handleAdminCreateInvite(svc as any, OK_BODY, "admin1", H);
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, "Workspace not found");
});

Deno.test("handleAdminCreateInvite: a FAILED workspace lookup throws (generic 500), never a confident 404", async () => {
  // No row is returned either way — only { error } distinguishes "does not
  // exist" from "the query blew up". Throwing lands on the dispatcher's 500.
  const svc = makeCreateSvc({ workspaceLookupFails: true });
  let threw = false;
  try {
    await handleAdminCreateInvite(svc as any, OK_BODY, "admin1", H);
  } catch {
    threw = true;
  }
  assert(threw, "a lookup failure must propagate, not be reported as Workspace not found");
});

Deno.test("handleAdminCreateInvite: happy path invites, attributes to the ADMIN, and audits the real invite id", async () => {
  const svc = makeCreateSvc({ authUser: null, members: 1 });
  const res = await handleAdminCreateInvite(svc as any, OK_BODY, "admin1", H);
  assertEquals(res.status, 200);

  const inviteRow = svc._inserts().find((i) => i.table === "invites")?.row;
  assertEquals(inviteRow.invited_by, "admin1"); // the platform admin, not the owner
  assertEquals(inviteRow.role, "agent");
  assertEquals(inviteRow.email, "new@x.com");

  const audits = svc._audits();
  assertEquals(audits.length, 1);
  assertEquals(audits[0].action, "admin-create-invite");
  assertEquals(audits[0].resource_id, "created-invite");
  assertEquals(audits[0].actor_user_id, "admin1");
  assertEquals(audits[0].metadata.route, "invited");
  assertEquals(audits[0].metadata.email, "new@x.com");
  assertEquals(audits[0].metadata.role, "agent");
});

Deno.test("handleAdminCreateInvite: an already-onboarded target is REPORTED, never added", async () => {
  const svc = makeCreateSvc({
    authUser: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
    onboarding: true, hasPassword: true, members: 1,
  });
  const res = await handleAdminCreateInvite(svc as any, OK_BODY, "admin1", H);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.route, "already-onboarded");
  assert(String(body.message).includes("No invite was created."));
  assert(!svc._inserts().some((i) => i.table === "workspace_members"), "must NOT add a member");
});

Deno.test("handleAdminCreateInvite: an unconfirmed reinvite reaching another workspace is REFUSED with 409", async () => {
  const svc = makeCreateSvc({
    authUser: { id: "u1", email_confirmed_at: null }, // never confirmed -> reinvite
    onboarding: false, hasPassword: false, memberships: [WS, "c2"], members: 1,
  });
  const res = await handleAdminCreateInvite(svc as any, OK_BODY, "admin1", H);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, "cross_workspace_confirmation_required");
  assertEquals(body.other_workspace_count, 1);
  assertEquals(svc._audits().length, 0); // nothing happened, nothing to audit
  assert(!svc._inserts().some((i) => i.table === "invites"), "must not create an invite");
});

Deno.test("handleAdminCreateInvite: a truthy-but-not-true confirm flag does NOT count as consent", async () => {
  const svc = makeCreateSvc({
    authUser: { id: "u1", email_confirmed_at: null },
    onboarding: false, hasPassword: false, memberships: [WS, "c2"], members: 1,
  });
  const res = await handleAdminCreateInvite(
    svc as any, { ...OK_BODY, confirm_cross_workspace: "yes" }, "admin1", H,
  );
  assertEquals(res.status, 409);
});

Deno.test("handleAdminCreateInvite: with confirmation it proceeds and audits EACH affected workspace", async () => {
  const svc = makeCreateSvc({
    authUser: { id: "u1", email_confirmed_at: null },
    onboarding: false, hasPassword: false, memberships: [WS, "c2"], members: 1,
  });
  const res = await handleAdminCreateInvite(
    svc as any, { ...OK_BODY, confirm_cross_workspace: true }, "admin1", H,
  );
  assertEquals(res.status, 200);

  const audits = svc._audits();
  assertEquals(audits.length, 2); // WS and c2
  assertEquals(new Set(audits.map((a: any) => a.conta_id)), new Set([WS, "c2"]));
  assertEquals(new Set(audits.map((a: any) => a.metadata.operation_id)).size, 1);
});

Deno.test("handleAdminResendInvite: a FAILED invite lookup throws (generic 500), never a confident 404", async () => {
  // No row is returned either way — only { error } distinguishes "does not
  // exist" from "the query blew up". Throwing lands on the dispatcher's 500.
  const svc = makeCreateSvc({ inviteLookupFails: true });
  let threw = false;
  try {
    await handleAdminResendInvite(svc as any, { workspace_id: "c1", invite_id: "i1" }, "admin1", H);
  } catch {
    threw = true;
  }
  assert(threw, "a lookup failure must propagate, not be reported as Invite not found");
});

Deno.test("handleAdminResendInvite: audits the NEW invite id, not the one deletePriorInvites removed", async () => {
  const svc = makeCreateSvc({
    invite: { id: "old-invite", conta_id: "ws", email: "new@x.com", role: "agent", status: "pending", invited_by: "owner1" },
    authUser: null, members: 1,
  });
  const res = await handleAdminResendInvite(svc as any, { workspace_id: "ws", invite_id: "old-invite" }, "admin1", H);
  assertEquals(res.status, 200);
  const audits = svc._audits();
  assertEquals(audits.length, 1);
  assertEquals(audits[0].resource_id, "created-invite"); // NOT "old-invite" — that row is gone
});
