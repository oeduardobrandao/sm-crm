import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveActiveCaller, validateMembroForInvite } from "../_shared/invite-membro.ts";

// Minimal fake: profiles.active_workspace_id + workspace_members role lookup.
function makeCallerAdmin(opts: {
  activeWorkspaceId: string | null;
  membershipRole?: string | null;
}) {
  return {
    from: (table: string) => {
      const api: any = {
        select: () => api,
        eq: () => api,
        maybeSingle: () => {
          if (table === "profiles") {
            return Promise.resolve({
              data: opts.activeWorkspaceId ? { active_workspace_id: opts.activeWorkspaceId } : null,
              error: null,
            });
          }
          if (table === "workspace_members") {
            return Promise.resolve({
              data: opts.membershipRole ? { role: opts.membershipRole } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };
}

Deno.test("resolveActiveCaller: resolves workspace and role from workspace_members", async () => {
  const admin = makeCallerAdmin({ activeWorkspaceId: "ws1", membershipRole: "owner" });
  // deno-lint-ignore no-explicit-any
  const caller = await resolveActiveCaller(admin as any, "u1");
  assertEquals(caller, { workspaceId: "ws1", role: "owner" });
});

Deno.test("resolveActiveCaller: null when no active workspace", async () => {
  const admin = makeCallerAdmin({ activeWorkspaceId: null });
  // deno-lint-ignore no-explicit-any
  assertEquals(await resolveActiveCaller(admin as any, "u1"), null);
});

Deno.test("resolveActiveCaller: null when caller has NO membership row in the active workspace (stale profile)", async () => {
  const admin = makeCallerAdmin({ activeWorkspaceId: "ws1", membershipRole: null });
  // deno-lint-ignore no-explicit-any
  assertEquals(await resolveActiveCaller(admin as any, "u1"), null);
});

// Fake for validateMembroForInvite: membros lookup + two pending-invite probes.
// The invites probe distinguishes the two conflict queries by which filter was
// used: .neq("membro_id", ...) marks the "same email, other membro" probe;
// .neq("email", ...) marks the "same membro, other email" probe.
function makeMembroAdmin(opts: {
  membro: { id: number; conta_id: string; crm_user_id: string | null } | null;
  otherMembroPendingSameEmail?: boolean;
  otherEmailPendingSameMembro?: boolean;
}) {
  return {
    from: (table: string) => {
      const neqCols: string[] = [];
      const api: any = {
        select: () => api,
        eq: () => api,
        not: () => api,
        neq: (col: string) => { neqCols.push(col); return api; },
        maybeSingle: () => {
          if (table === "membros") return Promise.resolve({ data: opts.membro, error: null });
          if (table === "invites") {
            if (neqCols.includes("membro_id")) {
              return Promise.resolve({ data: opts.otherMembroPendingSameEmail ? { id: "i1" } : null, error: null });
            }
            if (neqCols.includes("email")) {
              return Promise.resolve({ data: opts.otherEmailPendingSameMembro ? { id: "i2" } : null, error: null });
            }
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };
}

const ARGS = { membroId: 7, workspaceId: "ws1", email: "a@x.com" };

Deno.test("validateMembroForInvite: ok for an unlinked membro with no conflicts", async () => {
  const admin = makeMembroAdmin({ membro: { id: 7, conta_id: "ws1", crm_user_id: null } });
  // deno-lint-ignore no-explicit-any
  assertEquals(await validateMembroForInvite(admin as any, ARGS), { ok: true });
});

Deno.test("validateMembroForInvite: not_found when the membro is missing or in another workspace", async () => {
  const admin = makeMembroAdmin({ membro: null });
  // deno-lint-ignore no-explicit-any
  assertEquals(await validateMembroForInvite(admin as any, ARGS), { ok: false, reason: "not_found" });
});

Deno.test("validateMembroForInvite: already_linked when crm_user_id is set", async () => {
  const admin = makeMembroAdmin({ membro: { id: 7, conta_id: "ws1", crm_user_id: "u9" } });
  // deno-lint-ignore no-explicit-any
  assertEquals(await validateMembroForInvite(admin as any, ARGS), { ok: false, reason: "already_linked" });
});

Deno.test("validateMembroForInvite: pending_conflict when the email's pending invite points at another membro", async () => {
  const admin = makeMembroAdmin({
    membro: { id: 7, conta_id: "ws1", crm_user_id: null },
    otherMembroPendingSameEmail: true,
  });
  // deno-lint-ignore no-explicit-any
  assertEquals(await validateMembroForInvite(admin as any, ARGS), { ok: false, reason: "pending_conflict" });
});

Deno.test("validateMembroForInvite: membro_has_pending when the membro already has a pending invite to another email", async () => {
  const admin = makeMembroAdmin({
    membro: { id: 7, conta_id: "ws1", crm_user_id: null },
    otherEmailPendingSameMembro: true,
  });
  // deno-lint-ignore no-explicit-any
  assertEquals(await validateMembroForInvite(admin as any, ARGS), { ok: false, reason: "membro_has_pending" });
});
