# Workspace Invite Inside the Membro Form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let owners/admins optionally invite a person to the workspace from the Adicionar/Editar Membro dialog, with a seat meter, and auto-link the resulting account to the membro (`crm_user_id`) when the invite is accepted.

**Architecture:** A nullable `invites.membro_id` column carries the link through the existing invite pipeline. `invite-user` validates the membro and moves to active-workspace authorization; `inviteOrResend` stamps (and inherits) `membro_id` on every invite row it writes and links immediately on the `added` route; the `accept_workspace_invite` RPC links on acceptance. The CRM dialog gains an "Acesso ao CRM" section with a switch, email + role fields, and a seat meter.

**Tech Stack:** React 19 + react-hook-form + zod + TanStack Query (CRM), Deno edge functions, Postgres (Supabase), Vitest + `deno test`.

**Spec:** `docs/superpowers/specs/2026-07-31-membro-workspace-invite-design.md`

## Global Constraints

- All user-facing copy is PT-BR. **No em-dashes in user-facing copy** (use period, colon, or "·").
- Edge functions never return raw error details to clients: generic PT message out, detail to `console.error`.
- The migration version prefix must be unique. Planned prefix: `20260731000002` (open PR #279 already claims `20260731000001`). **Re-verify against `git ls-tree origin/main:supabase/migrations | tail` immediately before opening the PR** and renumber above the tail if needed.
- `accept_workspace_invite` must be replaced from its currently deployed definition (`20260720000004_reconcile_prod_missing_functions.sql`), preserving `SECURITY DEFINER`, `SET search_path = public`, and service-role-only `GRANT EXECUTE`.
- New-code toasts use `toast()` from `sonner` (never `showToast()`).
- Permission gating in the dialog uses `workspaceRole` + `membershipResolved` from `AuthContext`, never `profiles.role`-derived `role`/`isAgent`.
- `deno test` dirties the root `deno.lock`: run `git checkout -- deno.lock` after any `npm run test:functions` / `deno test` run before committing.
- Before push: `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run test:functions`, `npm run lint`, `npm run format:check`.

---

### Task 1: Migration — `invites.membro_id` + auto-link in `accept_workspace_invite`

**Files:**
- Create: `supabase/migrations/20260731000002_invite_membro_link.sql`

**Interfaces:**
- Produces: `invites.membro_id bigint NULL` (FK → `membros.id`, `ON DELETE SET NULL`); `accept_workspace_invite(p_user_id uuid)` additionally sets `membros.crm_user_id` when the accepted invite carries `membro_id`.

- [ ] **Step 1: Write the migration**

The RPC body below is the deployed definition from `20260720000004_reconcile_prod_missing_functions.sql` with ONE addition (the `IF v_invite.membro_id IS NOT NULL` block). Do not restructure anything else.

```sql
-- Link workspace invites to membros da equipe.
--
-- invites.membro_id records which membro an invite was sent for (from the
-- Equipe form). accept_workspace_invite then links the membro to the new
-- user (membros.crm_user_id) at acceptance time.
--
-- The RPC body is copied from its CURRENT deployed definition
-- (20260720000004_reconcile_prod_missing_functions.sql), NOT the original
-- 20260713000001 version, with only the membro-link block added.

ALTER TABLE public.invites
  ADD COLUMN membro_id bigint REFERENCES public.membros(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.accept_workspace_invite(p_user_id uuid)
RETURNS TABLE (
  invite_id uuid,
  conta_id uuid,
  role text,
  email text,
  already_accepted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_conta_id uuid;
  v_invite public.invites%ROWTYPE;
BEGIN
  SELECT lower(u.email)
  INTO v_email
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.conta_id
  INTO v_conta_id
  FROM profiles p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT i.*
  INTO v_invite
  FROM invites i
  WHERE lower(i.email) = v_email
    AND i.conta_id = v_conta_id
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT i.*
    INTO v_invite
    FROM invites i
    WHERE lower(i.email) = v_email
      AND i.conta_id = v_conta_id
      AND i.status = 'accepted'
      AND EXISTS (
        SELECT 1
        FROM workspace_members wm
        WHERE wm.user_id = p_user_id
          AND wm.workspace_id = i.conta_id
      )
    ORDER BY i.accepted_at DESC NULLS LAST, i.created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
    END IF;

    invite_id := v_invite.id;
    conta_id := v_invite.conta_id;
    role := v_invite.role;
    email := v_email;
    already_accepted := true;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO workspace_members (user_id, workspace_id, role)
  VALUES (p_user_id, v_invite.conta_id, v_invite.role)
  ON CONFLICT (user_id, workspace_id) DO UPDATE
  SET role = EXCLUDED.role;

  UPDATE profiles
  SET conta_id = v_invite.conta_id,
      active_workspace_id = v_invite.conta_id,
      role = v_invite.role::user_role,
      onboarding_complete = true
  WHERE id = p_user_id;

  UPDATE invites
  SET status = 'accepted',
      accepted_at = now()
  WHERE id = v_invite.id;

  -- Link the membro this invite was sent for. Guarded by crm_user_id IS NULL
  -- so a manual link made in the meantime wins; conta_id guard keeps the
  -- update inside the invite's workspace.
  IF v_invite.membro_id IS NOT NULL THEN
    UPDATE membros m
    SET crm_user_id = p_user_id
    WHERE m.id = v_invite.membro_id
      AND m.conta_id = v_invite.conta_id
      AND m.crm_user_id IS NULL;
  END IF;

  invite_id := v_invite.id;
  conta_id := v_invite.conta_id;
  role := v_invite.role;
  email := v_email;
  already_accepted := false;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) TO service_role;
```

- [ ] **Step 2: Verify the version prefix is unique in the tree**

Run: `ls supabase/migrations | cut -d_ -f1 | sort | uniq -d`
Expected: no output (no duplicate prefixes).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260731000002_invite_membro_link.sql
git commit -m "feat(db): link workspace invites to membros and auto-link on accept"
```

---

### Task 2: `_shared/invite-membro.ts` — caller resolution + membro validation helpers

**Files:**
- Create: `supabase/functions/_shared/invite-membro.ts`
- Test: `supabase/functions/__tests__/invite-membro_test.ts`

**Interfaces:**
- Produces:
  - `resolveActiveCaller(adminClient, userId: string): Promise<{ workspaceId: string; role: "owner" | "admin" | "agent" } | null>` — workspace from `profiles.active_workspace_id`, role from `workspace_members` (never `profiles.role`).
  - `validateMembroForInvite(adminClient, args: { membroId: number; workspaceId: string; email: string }): Promise<{ ok: true } | { ok: false; reason: "not_found" | "already_linked" | "pending_conflict" | "membro_has_pending" }>`
- Consumed by: Task 4 (`invite-user/index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/invite-membro_test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/__tests__/invite-membro_test.ts`
Expected: FAIL (module `../_shared/invite-membro.ts` not found).

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/invite-membro.ts`:

```ts
// deno-lint-ignore-file no-explicit-any

/**
 * Caller resolution for the active-workspace model. profiles.role and
 * profiles.conta_id go stale after a workspace switch; authority must come
 * from workspace_members for profiles.active_workspace_id (same rule
 * manage-workspace-user documents).
 */
export interface ActiveCaller {
  workspaceId: string;
  role: "owner" | "admin" | "agent";
}

export async function resolveActiveCaller(
  adminClient: any,
  userId: string,
): Promise<ActiveCaller | null> {
  const { data: prof } = await adminClient
    .from("profiles").select("active_workspace_id").eq("id", userId).maybeSingle();
  const workspaceId = prof?.active_workspace_id;
  if (!workspaceId) return null;
  const { data: membership } = await adminClient
    .from("workspace_members").select("role")
    .eq("user_id", userId).eq("workspace_id", workspaceId).maybeSingle();
  if (!membership?.role) return null;
  return { workspaceId, role: membership.role };
}

export type MembroValidation =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_linked" | "pending_conflict" | "membro_has_pending" };

/**
 * Pre-invite validation for a membroId sent from the Equipe form.
 * - not_found also covers a membro from another workspace (no detail leak).
 * - pending_conflict: this email's pending invite points at a DIFFERENT
 *   membro; proceeding would silently transfer the link (spec rule).
 * - membro_has_pending: this membro already has a pending invite to a
 *   different email; two pending invites racing for one membro is refused.
 */
export async function validateMembroForInvite(
  adminClient: any,
  args: { membroId: number; workspaceId: string; email: string },
): Promise<MembroValidation> {
  const { data: membro } = await adminClient
    .from("membros").select("id, conta_id, crm_user_id")
    .eq("id", args.membroId).eq("conta_id", args.workspaceId).maybeSingle();
  if (!membro) return { ok: false, reason: "not_found" };
  if (membro.crm_user_id) return { ok: false, reason: "already_linked" };

  const { data: emailConflict } = await adminClient
    .from("invites").select("id")
    .eq("conta_id", args.workspaceId).eq("email", args.email).eq("status", "pending")
    .not("membro_id", "is", null).neq("membro_id", args.membroId).maybeSingle();
  if (emailConflict) return { ok: false, reason: "pending_conflict" };

  const { data: membroConflict } = await adminClient
    .from("invites").select("id")
    .eq("conta_id", args.workspaceId).eq("membro_id", args.membroId).eq("status", "pending")
    .neq("email", args.email).maybeSingle();
  if (membroConflict) return { ok: false, reason: "membro_has_pending" };

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/__tests__/invite-membro_test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Revert deno.lock and commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/_shared/invite-membro.ts supabase/functions/__tests__/invite-membro_test.ts
git commit -m "feat(functions): active-workspace caller resolution + membro invite validation"
```

---

### Task 3: `inviteOrResend` — stamp, inherit, and immediately link `membro_id`

**Files:**
- Modify: `supabase/functions/_shared/invite-actions.ts` (interface `InviteOrResendInput`, function `inviteOrResend`, function `sendNewUserInvite`)
- Modify: `supabase/functions/_shared/invite-pending.ts` (interface `PendingWorkspaceInviteInput`)
- Test: `supabase/functions/__tests__/invite-actions_test.ts` (extend `makeInviteAdmin` + new tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `InviteOrResendInput` gains `membroId?: number | null`. Every invites-row insert carries `membro_id`. The `added` route updates `membros.crm_user_id` immediately. When `input.membroId` is absent, the pending row being replaced donates its `membro_id` (inherit rule).

- [ ] **Step 1: Extend the fake admin client in `invite-actions_test.ts`**

In `makeInviteAdmin` (around line 223):

1. Add to the `opts` type: `priorPendingMembroId?: number | null;`
2. Add a row recorder next to `const events: string[] = [];`:

```ts
  const inserts: Array<{ table: string; row: any }> = [];
  const updates: Array<{ table: string; row: any }> = [];
```

and expose them in the returned object:

```ts
    _inserts: () => inserts,
    _updates: () => updates,
```

3. In the `api` object inside `from(table)`, record inserted rows — change the `insert` method's first line to also push the row:

```ts
        insert: (row: any) => {
          events.push("ins:" + table + ":" + (row.status ?? ""));
          inserts.push({ table, row });
          const err = opts.failTable === table ? failErr : null;
          const inserted = err || opts.insertReturnsNoId ? null : { id: "new-invite" };
          return { select: () => ({ single: () => Promise.resolve({ data: inserted, error: err }) }), then: (r: (x: any) => unknown) => Promise.resolve(r({ data: null, error: err })) };
        },
```

4. Add `update`, `not`, and `is` methods to `api` (alongside `neq`/`in`):

```ts
        update: (row: any) => { events.push("upd:" + table); updates.push({ table, row }); return api; },
        not: () => api,
        is: () => api,
```

5. In `maybeSingle`, serve the inherit lookup (BEFORE the fall-through return): the source queries `invites` with `.select("membro_id")`; make the fake return the fixture:

```ts
          if (table === "invites") {
            return Promise.resolve({
              data: opts.priorPendingMembroId != null ? { membro_id: opts.priorPendingMembroId } : null,
              error: null,
            });
          }
```

- [ ] **Step 2: Write the failing tests**

Append to `supabase/functions/__tests__/invite-actions_test.ts`:

```ts
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

Deno.test("inviteOrResend: resend-link route also stamps membro_id", async () => {
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
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `deno test supabase/functions/__tests__/invite-actions_test.ts`
Expected: the 6 new tests FAIL (`membro_id` is `undefined` on inserted rows / no membros update); all pre-existing tests still PASS.

- [ ] **Step 4: Implement in `invite-pending.ts`**

Add `membroId` to the input and stamp it in the insert callback's consumer (the insert itself lives in `invite-actions.ts`; here only the type changes):

```ts
export interface PendingWorkspaceInviteInput {
  contaId: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string;
  redirectTo: string;
  membroId?: number | null;
}
```

- [ ] **Step 5: Implement in `invite-actions.ts`**

1. `InviteOrResendInput` gains the field:

```ts
export interface InviteOrResendInput {
  contaId: string;
  email: string;
  role: "owner" | "admin" | "agent";
  invitedBy: string;
  redirectBase: string;
  /** Membro da equipe this invite links to (Equipe form). Stamped on every
   * invites row; the added route links membros.crm_user_id immediately. */
  membroId?: number | null;
}
```

2. In `inviteOrResend`, right AFTER the seat pre-check `if (!seatsAvailable(...)) return ...` block, add the inherit resolution (must run before ANY `deletePriorInvites` call):

```ts
  // Resolve the membro link for every invites row written below. When the
  // caller passes none (resend from Configurações / admin portal), inherit it
  // from the pending row being replaced: deletePriorInvites + re-insert would
  // otherwise silently drop a link created from the Equipe form.
  let membroId = input.membroId ?? null;
  if (membroId == null) {
    const { data: prior } = await adminClient
      .from("invites").select("membro_id")
      .eq("conta_id", input.contaId).eq("email", email).eq("status", "pending")
      .not("membro_id", "is", null).maybeSingle();
    membroId = prior?.membro_id ?? null;
  }
```

3. `added` route: stamp the accepted invite row and link the membro. Replace the `iIns` insert with:

```ts
      const iIns = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy,
        status: "accepted", accepted_at: new Date().toISOString(), membro_id: membroId,
      }).select("id").single();
      if (membroId != null) {
        const upd = await adminClient.from("membros")
          .update({ crm_user_id: existingUser.id })
          .eq("id", membroId).eq("conta_id", input.contaId).is("crm_user_id", null);
        ensureOk(upd.error, "membro_link");
      }
      return { route: "added", inviteId: insertedId(iIns, "invite_insert_accepted") };
```

(Note: `.is(...)` terminates the chain as a thenable in supabase-js, same as the existing count queries; `upd.error` is the awaited result's error.)

4. `resend-link` route: stamp the pending row:

```ts
      const ins = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy,
        status: "pending", membro_id: membroId,
      }).select("id").single();
```

5. The `reinvited` and `invited` routes both call `sendNewUserInvite(adminClient, input, email)` — change both call sites to pass the resolved id: `sendNewUserInvite(adminClient, input, email, membroId)`, and update the helper:

```ts
/** Returns the id of the pending invites row it created. */
async function sendNewUserInvite(adminClient: any, input: InviteOrResendInput, email: string, membroId: number | null): Promise<string> {
  return await sendPendingWorkspaceInvite({
    createPendingInvite: async (p) => {
      const { data, error } = await adminClient.from("invites").insert({
        conta_id: p.contaId, email: p.email, role: p.role, invited_by: p.invitedBy,
        status: "pending", membro_id: p.membroId ?? null,
      }).select("id").single();
      if (error || !data) throw error ?? new Error("invite_insert_failed");
      return data;
    },
    sendAuthInvite: async (p) => {
      const { error } = await adminClient.auth.admin.inviteUserByEmail(p.email, {
        data: { conta_id: p.contaId, role: p.role, nome: p.email.split("@")[0] },
        redirectTo: p.redirectTo,
      });
      if (error) throw error;
    },
    // Throw on a failed rollback so sendPendingWorkspaceInvite's catch actually
    // logs it — supabase-js RESOLVES with { error }, so ignoring it left a
    // phantom pending row with no trace anywhere.
    deletePendingInvite: async (id) => {
      const { error } = await adminClient.from("invites").delete().eq("id", id);
      if (error) throw error;
    },
  }, {
    contaId: input.contaId, email, role: input.role, invitedBy: input.invitedBy,
    redirectTo: input.redirectBase + "/configurar-senha", membroId,
  });
}
```

- [ ] **Step 6: Run the full Deno suite**

Run: `deno test supabase/functions/`
Expected: PASS, including all pre-existing invite tests (the inherit lookup returns `{ data: null }` in old fixtures, so old behavior is unchanged).

Note: `platform-admin-invites_test.ts` exercises `inviteOrResend` with its OWN fake admin client. If it crashes on the new inherit lookup (`.not is not a function`), add the same chainable no-op `not: () => api` (and an invites branch in its `maybeSingle` returning `{ data: null, error: null }`) to that fake as well.

- [ ] **Step 7: Revert deno.lock and commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/_shared/invite-actions.ts supabase/functions/_shared/invite-pending.ts supabase/functions/__tests__/invite-actions_test.ts
git commit -m "feat(functions): inviteOrResend stamps, inherits and immediately links membro_id"
```

---

### Task 4: `invite-user/index.ts` — active-workspace auth + membroId validation

**Files:**
- Modify: `supabase/functions/invite-user/index.ts`

**Interfaces:**
- Consumes: `resolveActiveCaller` / `validateMembroForInvite` from Task 2; `InviteOrResendInput.membroId` from Task 3.
- Produces: POST body accepts optional `membroId: number`. New 400 responses with PT messages (below). All authorization now derives from the caller's ACTIVE workspace.

- [ ] **Step 1: Rewire caller resolution**

In `supabase/functions/invite-user/index.ts`:

1. Add the import:

```ts
import { resolveActiveCaller, validateMembroForInvite } from "../_shared/invite-membro.ts";
```

2. Replace the profile lookup block (the `// Get current user profile` block that selects `conta_id, role` from `profiles`) with:

```ts
    // Authorization derives from the ACTIVE workspace: profiles.role/conta_id
    // go stale after a workspace switch (see manage-workspace-user).
    const caller = await resolveActiveCaller(adminClient, user.id);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Workspace não encontrado.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
```

3. Replace every remaining use of the old profile:
   - DELETE branch: `profile.role` → `caller.role`; `.eq('conta_id', profile.conta_id)` → `.eq('conta_id', caller.workspaceId)`.
   - POST branch: `profile.role === 'agent'` → `caller.role === 'agent'`; `profile.role === 'admin'` → `caller.role === 'admin'`; `contaId: profile.conta_id` → `contaId: caller.workspaceId`.

- [ ] **Step 2: Validate and forward membroId**

After the existing `role` validation (`if (!['owner','admin','agent'].includes(role))`) and permission checks, add:

```ts
    let membroId: number | undefined;
    if (body.membroId !== undefined && body.membroId !== null) {
      if (typeof body.membroId !== 'number' || !Number.isInteger(body.membroId)) {
        return new Response(JSON.stringify({ error: 'Requisição inválida.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const check = await validateMembroForInvite(adminClient, {
        membroId: body.membroId, workspaceId: caller.workspaceId, email: email.toLowerCase(),
      });
      if (!check.ok) {
        const messages: Record<string, string> = {
          not_found: 'Membro não encontrado.',
          already_linked: 'Este membro já está vinculado a uma conta.',
          pending_conflict: 'Este e-mail já tem um convite pendente vinculado a outro membro.',
          membro_has_pending: 'Este membro já tem um convite pendente.',
        };
        return new Response(JSON.stringify({ error: messages[check.reason] }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      membroId = body.membroId;
    }
```

and pass it into `inviteOrResend`'s input object: add `membroId,` after `invitedBy: user.id,`.

- [ ] **Step 3: Run the Deno suite and typecheck the function**

Run: `deno check supabase/functions/invite-user/index.ts && deno test supabase/functions/`
Expected: check OK, all tests PASS.

- [ ] **Step 4: Revert deno.lock and commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/invite-user/index.ts
git commit -m "feat(functions): invite-user validates membroId and authorizes via active workspace"
```

---

### Task 5: Frontend data layer — `addMembro` returns the row; `inviteUser` carries `membroId`

**Files:**
- Modify: `apps/crm/src/store/team.ts:30-41` (`addMembro`)
- Modify: `apps/crm/src/services/invite.ts` (`inviteUser`)
- Test: `apps/crm/src/services/__tests__/invite.test.ts` (extend)

**Interfaces:**
- Produces:
  - `addMembro(m: Omit<Membro, 'id' | 'user_id' | 'conta_id'>): Promise<Membro>` — returns the created row (allowlisted columns).
  - `inviteUser(email: string, role: InviteRole, membroId?: number): Promise<InviteResult>` — adds `membroId` to the POST body when given; on a non-OK response the thrown `Error` also carries the response JSON's fields (`Object.assign`) so `mapEntitlementError` can read `error: 'plan_limit_exceeded'`.
- Consumed by: Task 8 (EquipePage orchestration).

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('inviteUser', ...)` block of `apps/crm/src/services/__tests__/invite.test.ts`:

```ts
    it('includes membroId in the body when provided', async () => {
      fetchHarness.queueResponse({ json: { success: true, message: 'Convite enviado!' } });

      await inviteUser('novo@equipe.com', 'agent', 42);

      const body = JSON.parse(String(fetchHarness.calls[0].init?.body));
      expect(body).toEqual({ email: 'novo@equipe.com', role: 'agent', membroId: 42 });
    });

    it('omits membroId from the body when not provided', async () => {
      fetchHarness.queueResponse({ json: { success: true } });

      await inviteUser('novo@equipe.com', 'agent');

      const body = JSON.parse(String(fetchHarness.calls[0].init?.body));
      expect(body).toEqual({ email: 'novo@equipe.com', role: 'agent' });
    });

    it('attaches the error payload to the thrown Error so entitlement mapping works', async () => {
      fetchHarness.queueResponse({
        status: 403,
        json: { error: 'plan_limit_exceeded', resource: 'max_team_members' },
      });

      let thrown: unknown;
      try {
        await inviteUser('novo@equipe.com', 'agent', 42);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as { error?: string }).error).toBe('plan_limit_exceeded');
      expect((thrown as { resource?: string }).resource).toBe('max_team_members');
    });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -- invite.test`
Expected: the 3 new tests FAIL (`membroId` missing from body; thrown error has no `.error`).

- [ ] **Step 3: Implement `inviteUser`**

In `apps/crm/src/services/invite.ts` replace `inviteUser` with:

```ts
export async function inviteUser(
  email: string,
  role: InviteRole,
  membroId?: number,
): Promise<InviteResult> {
  if (!email) throw new Error('Email é obrigatório');
  const headers = await getAuthHeaders();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
    method: 'POST',
    headers,
    body: JSON.stringify(membroId != null ? { email, role, membroId } : { email, role }),
  });
  const result = await res.json();
  if (!res.ok) {
    // Carry the JSON payload on the Error so mapEntitlementError() can read
    // { error: 'plan_limit_exceeded', resource } from the edge function.
    const error = new Error(result.error || result.message || `Erro ${res.status}`);
    Object.assign(error, result);
    throw error;
  }
  return result as InviteResult;
}
```

- [ ] **Step 4: Implement `addMembro` return**

In `apps/crm/src/store/team.ts` replace `addMembro` with:

```ts
export async function addMembro(m: Omit<Membro, 'id' | 'user_id' | 'conta_id'>): Promise<Membro> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  // RETURNING is narrowed to the allowlist: `.select()` is RETURNING *, which
  // needs SELECT on custo_mensal and would fail for a restricted admin.
  const { data, error } = await supabase
    .from('membros')
    .insert({ ...m, user_id, conta_id })
    .select(MEMBRO_SAFE_COLUMNS)
    .single();
  if (error) throw error;
  return data as Membro;
}
```

- [ ] **Step 5: Update contract consumers of `addMembro`**

Run: `grep -rn "addMembro" apps --include="*.ts" --include="*.tsx" | grep -v node_modules`
For each test that mocks or asserts on `addMembro` (expected: `apps/crm/src/__tests__/store.crud-writes.test.ts`, `apps/crm/src/__tests__/store.core.test.ts`), make the mocked Supabase chain resolve `{ data: <membro row>, error: null }` and (only where the test asserts the return) assert the returned row. Callers in `EquipePage.tsx` compile unchanged (`await addMembro(...)` ignoring the return is valid).

- [ ] **Step 6: Run the frontend suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/store/team.ts apps/crm/src/services/invite.ts apps/crm/src/services/__tests__/invite.test.ts apps/crm/src/__tests__/
git commit -m "feat(crm): addMembro returns the created row; inviteUser carries membroId"
```

---

### Task 6: Seat math + invite-failure copy — `pages/equipe/inviteSupport.ts`

**Files:**
- Create: `apps/crm/src/pages/equipe/inviteSupport.ts`
- Test: `apps/crm/src/pages/equipe/__tests__/inviteSupport.test.ts`

**Interfaces:**
- Produces:
  - `type SeatStatus = 'loading' | 'unavailable' | 'unlimited' | 'ok' | 'full'`
  - `interface SeatState { status: SeatStatus; used: number; limit: number | null; remaining: number | null }`
  - `computeSeatState(args: { isLoading: boolean; isUnlimited: boolean; maxTeamMembers: number | null | undefined; membersCount: number; pendingCount: number }): SeatState`
  - `membroInviteErrorMessage(err: unknown): string` — "Membro salvo, mas o convite falhou: …" with entitlement mapping.
- Consumed by: Tasks 7 and 8.

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/equipe/__tests__/inviteSupport.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeSeatState, membroInviteErrorMessage } from '../inviteSupport';

describe('computeSeatState', () => {
  it('is loading while limits load, regardless of counts', () => {
    const s = computeSeatState({
      isLoading: true, isUnlimited: false, maxTeamMembers: undefined,
      membersCount: 3, pendingCount: 1,
    });
    expect(s.status).toBe('loading');
  });

  it('is unavailable when limits failed to load (never enabled-by-default)', () => {
    const s = computeSeatState({
      isLoading: false, isUnlimited: false, maxTeamMembers: undefined,
      membersCount: 3, pendingCount: 0,
    });
    expect(s.status).toBe('unavailable');
  });

  it('is unlimited via the isUnlimited flag', () => {
    const s = computeSeatState({
      isLoading: false, isUnlimited: true, maxTeamMembers: undefined,
      membersCount: 99, pendingCount: 5,
    });
    expect(s.status).toBe('unlimited');
    expect(s.limit).toBeNull();
  });

  it('is unlimited via an explicit max_team_members null', () => {
    const s = computeSeatState({
      isLoading: false, isUnlimited: false, maxTeamMembers: null,
      membersCount: 2, pendingCount: 0,
    });
    expect(s.status).toBe('unlimited');
  });

  it('counts members plus pending invites against the limit', () => {
    const s = computeSeatState({
      isLoading: false, isUnlimited: false, maxTeamMembers: 5,
      membersCount: 3, pendingCount: 1,
    });
    expect(s).toEqual({ status: 'ok', used: 4, limit: 5, remaining: 1 });
  });

  it('is full at zero remaining and clamps oversubscription to zero', () => {
    expect(computeSeatState({
      isLoading: false, isUnlimited: false, maxTeamMembers: 4,
      membersCount: 3, pendingCount: 1,
    }).status).toBe('full');
    expect(computeSeatState({
      isLoading: false, isUnlimited: false, maxTeamMembers: 2,
      membersCount: 3, pendingCount: 1,
    }).remaining).toBe(0);
  });
});

describe('membroInviteErrorMessage', () => {
  it('maps plan_limit_exceeded to the shared entitlement wording', () => {
    const err = Object.assign(new Error('plan_limit_exceeded'), {
      error: 'plan_limit_exceeded', resource: 'max_team_members',
    });
    expect(membroInviteErrorMessage(err)).toBe(
      'Membro salvo, mas o convite falhou: Você atingiu o limite de usuários do seu plano.',
    );
  });

  it('falls back to the error message for other failures', () => {
    expect(membroInviteErrorMessage(new Error('Este usuário já pertence a este workspace.'))).toBe(
      'Membro salvo, mas o convite falhou: Este usuário já pertence a este workspace.',
    );
  });

  it('never renders undefined for a non-Error', () => {
    expect(membroInviteErrorMessage('boom')).toBe(
      'Membro salvo, mas o convite falhou: erro desconhecido',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- inviteSupport`
Expected: FAIL (module `../inviteSupport` not found).

- [ ] **Step 3: Implement**

Create `apps/crm/src/pages/equipe/inviteSupport.ts`:

```ts
import { entitlementMessage, mapEntitlementError } from '../../lib/entitlement-errors';

export type SeatStatus = 'loading' | 'unavailable' | 'unlimited' | 'ok' | 'full';

export interface SeatState {
  status: SeatStatus;
  used: number;
  limit: number | null;
  remaining: number | null;
}

/**
 * Seat usage = workspace users + pending invites, against max_team_members.
 * `limits === null` from useWorkspaceLimits is ambiguous (loading, fetch
 * failure, or unlimited plan): unlimited is ONLY the isUnlimited flag or an
 * explicit max_team_members null; anything else unresolved is 'unavailable'
 * so the invite switch never enables on a failed limits fetch.
 */
export function computeSeatState(args: {
  isLoading: boolean;
  isUnlimited: boolean;
  maxTeamMembers: number | null | undefined;
  membersCount: number;
  pendingCount: number;
}): SeatState {
  const used = args.membersCount + args.pendingCount;
  if (args.isLoading) return { status: 'loading', used, limit: null, remaining: null };
  if (args.isUnlimited || args.maxTeamMembers === null) {
    return { status: 'unlimited', used, limit: null, remaining: null };
  }
  if (args.maxTeamMembers === undefined) {
    return { status: 'unavailable', used, limit: null, remaining: null };
  }
  const remaining = Math.max(0, args.maxTeamMembers - used);
  return {
    status: remaining <= 0 ? 'full' : 'ok',
    used,
    limit: args.maxTeamMembers,
    remaining,
  };
}

/** Toast copy when the membro saved but the invite call failed. */
export function membroInviteErrorMessage(err: unknown): string {
  const mapped = mapEntitlementError(err);
  const detail = mapped
    ? entitlementMessage(mapped)
    : err instanceof Error && err.message
      ? err.message
      : 'erro desconhecido';
  return `Membro salvo, mas o convite falhou: ${detail}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- inviteSupport`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/equipe/inviteSupport.ts apps/crm/src/pages/equipe/__tests__/inviteSupport.test.ts
git commit -m "feat(crm): seat math and invite-failure copy for the membro form"
```

---

### Task 7: `InviteSection` component

**Files:**
- Create: `apps/crm/src/pages/equipe/membroForm.ts` (schema + types, extracted so the section and the page share them without a cycle)
- Create: `apps/crm/src/pages/equipe/InviteSection.tsx`
- Test: `apps/crm/src/pages/equipe/__tests__/InviteSection.test.tsx`

**Interfaces:**
- Consumes: `SeatState` from Task 6.
- Produces:
  - `membroForm.ts`: `membroSchema` (zod), `type MembroFormValues` — the EXISTING EquipePage schema plus `inviteEnabled: z.boolean()`, `inviteEmail: z.string()`, `inviteRole: z.enum(['admin', 'agent'])`, with a `superRefine` requiring a valid email when `inviteEnabled`.
  - `InviteSection.tsx`: `function InviteSection(props: { form: UseFormReturn<MembroFormValues>; seat: SeatState; pendingInvite: { email: string; role: string; expires_at: string } | null }): JSX.Element` — renders the switch, email/role fields, seat meter, full-state notice, or the pending-invite notice.
- Consumed by: Task 8.

- [ ] **Step 1: Create `membroForm.ts`**

Move the schema out of `EquipePage.tsx` (lines 89-99) into `apps/crm/src/pages/equipe/membroForm.ts`, extended:

```ts
import { z } from 'zod';

export const membroSchema = z
  .object({
    nome: z.string().min(1, 'Nome obrigatório'),
    cargo: z.string().min(1, 'Cargo obrigatório'),
    tipo: z.enum(['clt', 'freelancer_mensal', 'freelancer_demanda']),
    custo: z.string(),
    diaPag: z
      .string()
      .refine((v) => v === '' || (Number(v) >= 1 && Number(v) <= 31), 'Dia deve ser entre 1 e 31'),
    crmUserId: z.string().optional(),
    inviteEnabled: z.boolean(),
    inviteEmail: z.string(),
    inviteRole: z.enum(['admin', 'agent']),
  })
  .superRefine((v, ctx) => {
    if (v.inviteEnabled && !/^\S+@\S+\.\S+$/.test(v.inviteEmail.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inviteEmail'],
        message: 'Email inválido',
      });
    }
  });

export type MembroFormValues = z.infer<typeof membroSchema>;

export const MEMBRO_FORM_DEFAULTS: MembroFormValues = {
  nome: '',
  cargo: '',
  tipo: 'clt',
  custo: '',
  diaPag: '',
  crmUserId: '',
  inviteEnabled: false,
  inviteEmail: '',
  inviteRole: 'agent',
};
```

- [ ] **Step 2: Write the failing component tests**

Create `apps/crm/src/pages/equipe/__tests__/InviteSection.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form } from '@/components/ui/form';
import { InviteSection } from '../InviteSection';
import { membroSchema, MEMBRO_FORM_DEFAULTS, type MembroFormValues } from '../membroForm';
import type { SeatState } from '../inviteSupport';

function Harness({
  seat,
  pendingInvite = null,
  inviteEnabled = false,
}: {
  seat: SeatState;
  pendingInvite?: { email: string; role: string; expires_at: string } | null;
  inviteEnabled?: boolean;
}) {
  const form = useForm<MembroFormValues>({
    resolver: zodResolver(membroSchema),
    defaultValues: { ...MEMBRO_FORM_DEFAULTS, inviteEnabled },
  });
  return (
    <Form {...form}>
      <InviteSection form={form} seat={seat} pendingInvite={pendingInvite} />
    </Form>
  );
}

const OK_SEAT: SeatState = { status: 'ok', used: 3, limit: 5, remaining: 2 };

describe('InviteSection', () => {
  it('shows the switch and the seat meter when seats are available', () => {
    render(<Harness seat={OK_SEAT} />);
    expect(screen.getByText('Convidar para o workspace')).toBeInTheDocument();
    expect(screen.getByText('3 de 5 vagas do plano usadas')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeEnabled();
    expect(screen.queryByLabelText(/Email/)).not.toBeInTheDocument();
  });

  it('reveals email and role fields when the switch is on', () => {
    render(<Harness seat={OK_SEAT} inviteEnabled />);
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
    expect(screen.getByText('Função no workspace')).toBeInTheDocument();
    expect(screen.getByText(/ocupará 1 vaga/)).toBeInTheDocument();
  });

  it('disables the switch and shows upgrade copy when full', () => {
    render(<Harness seat={{ status: 'full', used: 5, limit: 5, remaining: 0 }} />);
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText(/Todas as vagas do plano estão em uso/)).toBeInTheDocument();
  });

  it('disables the switch while limits load and when they are unavailable', () => {
    const { rerender } = render(
      <Harness seat={{ status: 'loading', used: 0, limit: null, remaining: null }} />,
    );
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('Carregando vagas do plano...')).toBeInTheDocument();
    rerender(<Harness seat={{ status: 'unavailable', used: 0, limit: null, remaining: null }} />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('hides the meter on unlimited plans but keeps the switch enabled', () => {
    render(<Harness seat={{ status: 'unlimited', used: 3, limit: null, remaining: null }} />);
    expect(screen.getByRole('switch')).toBeEnabled();
    expect(screen.queryByText(/vagas do plano usadas/)).not.toBeInTheDocument();
  });

  it('collapses into the pending notice when the membro already has a pending invite', () => {
    render(
      <Harness
        seat={OK_SEAT}
        pendingInvite={{ email: 'ju@x.com', role: 'agent', expires_at: '2099-01-01T00:00:00Z' }}
      />,
    );
    expect(screen.getByText(/Convite pendente para/)).toBeInTheDocument();
    expect(screen.getByText(/ju@x.com/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- InviteSection`
Expected: FAIL (`../InviteSection` not found).

- [ ] **Step 4: Implement `InviteSection.tsx`**

```tsx
import { UserPlus } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { InviteTimeLeft } from '../configuracao/inviteHelpers';
import type { MembroFormValues } from './membroForm';
import type { SeatState } from './inviteSupport';

const ROLE_PT: Record<string, string> = { owner: 'dono', admin: 'admin', agent: 'agente' };

function SeatMeter({ seat }: { seat: SeatState }) {
  if (seat.status === 'unlimited') return null;
  if (seat.status === 'loading' || seat.status === 'unavailable') {
    return (
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
        Carregando vagas do plano...
      </p>
    );
  }
  const pct = seat.limit ? Math.min(100, Math.round((seat.used / seat.limit) * 100)) : 0;
  const fill =
    seat.status === 'full'
      ? 'var(--danger)'
      : seat.remaining !== null && seat.remaining <= 1
        ? 'var(--warning)'
        : 'var(--success)';
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          height: 5,
          borderRadius: 999,
          background: 'var(--surface-2)',
          overflow: 'hidden',
          marginBottom: 5,
        }}
      >
        <div style={{ height: '100%', borderRadius: 999, width: `${pct}%`, background: fill }} />
      </div>
      <div
        style={{
          fontSize: '0.72rem',
          color: 'var(--text-light)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>
          {seat.used} de {seat.limit} vagas do plano usadas
        </span>
        <span>
          {seat.remaining} restante{seat.remaining === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

/**
 * "Acesso ao CRM" section of the membro dialog: opt-in workspace invite with
 * a seat meter. Renders the pending-invite notice instead when the membro
 * already has one (resend/cancel live in Configurações → Workspace).
 */
export function InviteSection({
  form,
  seat,
  pendingInvite,
}: {
  form: UseFormReturn<MembroFormValues>;
  seat: SeatState;
  pendingInvite: { email: string; role: string; expires_at: string } | null;
}) {
  const sectionTitle = (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: '0.8rem',
        fontWeight: 600,
      }}
    >
      <UserPlus className="h-3.5 w-3.5" /> Acesso ao CRM
    </span>
  );

  if (pendingInvite) {
    return (
      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
        {sectionTitle}
        <div
          style={{
            marginTop: 8,
            borderRadius: 8,
            padding: '9px 11px',
            fontSize: '0.75rem',
            lineHeight: 1.5,
            background: 'var(--surface-1)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-muted)',
          }}
        >
          Convite pendente para <strong>{pendingInvite.email}</strong> (
          {ROLE_PT[pendingInvite.role] ?? pendingInvite.role})
          <InviteTimeLeft expiresAt={pendingInvite.expires_at} status="pending" />. Reenviar ou
          cancelar em Configurações → Workspace.
        </div>
      </div>
    );
  }

  const inviteEnabled = form.watch('inviteEnabled');
  const switchDisabled = seat.status !== 'ok' && seat.status !== 'unlimited';

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {sectionTitle}
        <FormField
          control={form.control}
          name="inviteEnabled"
          render={({ field }) => (
            <Switch
              checked={field.value}
              disabled={switchDisabled}
              onCheckedChange={field.onChange}
              aria-label="Convidar para o workspace"
            />
          )}
        />
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
        <strong>Convidar para o workspace.</strong>{' '}
        {inviteEnabled
          ? 'A pessoa receberá um convite por e-mail e ocupará 1 vaga do plano. Quando aceitar, a conta será vinculada a este membro automaticamente.'
          : 'Sem convite, o membro serve para custos e atribuições, mas não faz login no CRM. Você pode convidar depois.'}
      </p>
      {inviteEnabled && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FormField
            control={form.control}
            name="inviteEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email *</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="inviteRole"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Função no workspace</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="agent">Agente</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
      <SeatMeter seat={seat} />
      {seat.status === 'full' && (
        <div
          style={{
            marginTop: 8,
            borderRadius: 8,
            padding: '8px 11px',
            fontSize: '0.72rem',
            lineHeight: 1.5,
            color: 'var(--danger-text)',
            background: 'var(--surface-1)',
            border: '1px solid var(--border-color)',
          }}
        >
          Todas as vagas do plano estão em uso. O membro pode ser salvo normalmente; para
          convidá-lo ao CRM, faça upgrade do plano ou remova um usuário.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- InviteSection`
Expected: PASS (6 tests). If the switch's `aria-label` query fails, prefer `screen.getByRole('switch')` as written.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/equipe/membroForm.ts apps/crm/src/pages/equipe/InviteSection.tsx apps/crm/src/pages/equipe/__tests__/InviteSection.test.tsx
git commit -m "feat(crm): InviteSection component with seat meter for the membro dialog"
```

---

### Task 8: Wire EquipePage — queries, orchestration, badge

**Files:**
- Modify: `apps/crm/src/pages/equipe/EquipePage.tsx`

**Interfaces:**
- Consumes: `membroSchema`/`MEMBRO_FORM_DEFAULTS`/`MembroFormValues` (Task 7), `InviteSection` (Task 7), `computeSeatState`/`membroInviteErrorMessage` (Task 6), `addMembro` returning `Membro` (Task 5), `inviteUser(email, role, membroId)` (Task 5).
- Produces: the finished dialog + card badge.

- [ ] **Step 1: Replace the local schema with the shared module**

Delete the `membroSchema` / `MembroFormValues` definitions (old lines 89-99) and import instead:

```ts
import { membroSchema, MEMBRO_FORM_DEFAULTS, type MembroFormValues } from './membroForm';
import { InviteSection } from './InviteSection';
import { computeSeatState, membroInviteErrorMessage } from './inviteSupport';
import { inviteUser } from '../../services/invite';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { computeEffectiveInviteStatus } from '../configuracao/inviteHelpers';
import { supabase } from '../../lib/supabase';
import { captureEvent } from '@/lib/analytics';
```

Replace every `form.reset({ nome: '', cargo: '', tipo: 'clt', custo: '', diaPag: '', crmUserId: '' })` and the `defaultValues` object with `MEMBRO_FORM_DEFAULTS` (spread for `openEdit`: `form.reset({ ...MEMBRO_FORM_DEFAULTS, nome: m.nome, cargo: m.cargo || '', tipo: m.tipo, custo: ..., diaPag: ..., crmUserId: m.crm_user_id ?? '' })`).

- [ ] **Step 2: Add workspace-role gating and the new queries**

Change the `useAuth()` destructure to:

```ts
const { role, canSeeFinancials, workspaceRole, membershipResolved, profile } = useAuth();
const isAgent = role === 'agent';
const canManageWorkspace =
  membershipResolved === true && (workspaceRole === 'owner' || workspaceRole === 'admin');
```

Add below the existing `workspace-users` query:

```ts
const { limits, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();
const { data: pendingInvites = [] } = useQuery({
  queryKey: ['invites', 'equipe-pending', profile?.conta_id],
  queryFn: async () => {
    const { data } = await supabase
      .from('invites')
      .select('id, email, role, membro_id, expires_at, status')
      .eq('conta_id', profile!.conta_id)
      .eq('status', 'pending');
    // Locally-expired invites must not render as pending.
    return computeEffectiveInviteStatus(data ?? []).filter((i) => i.status === 'pending');
  },
  enabled: canManageWorkspace && !!profile?.conta_id,
});
const pendingByMembroId = new Map(
  pendingInvites.filter((i) => i.membro_id != null).map((i) => [i.membro_id as number, i]),
);
const seat = computeSeatState({
  isLoading: limitsLoading,
  isUnlimited,
  maxTeamMembers: limits === null ? undefined : limits.max_team_members,
  membersCount: workspaceUsers.length,
  pendingCount: pendingInvites.length,
});
```

- [ ] **Step 3: Rewrite `onSubmit` with the invite orchestration**

```ts
const onSubmit = async (values: MembroFormValues) => {
  const diaPag = values.diaPag ? parseInt(values.diaPag, 10) : undefined;
  setSaving(true);
  try {
    const payload: Omit<Membro, 'id' | 'user_id' | 'conta_id'> = {
      nome: values.nome,
      cargo: values.cargo,
      tipo: values.tipo,
      custo_mensal: values.custo ? Number(values.custo) : null,
      avatar_url: '',
      data_pagamento: diaPag,
    };
    const safePayload = stripFinancialFields(payload, canSeeFinancials, ['custo_mensal']);
    let membroId: number | undefined;
    if (editing?.id) {
      const desiredCrmUser =
        values.crmUserId === '' || values.crmUserId == null ? null : values.crmUserId;
      const currentCrmUser = editing.crm_user_id ?? null;
      if (desiredCrmUser !== currentCrmUser) {
        await setMembroCrmUser(editing.id, desiredCrmUser);
      }
      await updateMembro(editing.id, safePayload);
      membroId = editing.id;
    } else {
      const created = await addMembro(safePayload as Omit<Membro, 'id' | 'user_id' | 'conta_id'>);
      membroId = created.id;
    }

    // The invite is a second, non-atomic operation: a failure here must not
    // roll back or hide the saved membro.
    const wantsInvite =
      values.inviteEnabled && canManageWorkspace && membroId != null && !editing?.crm_user_id;
    if (wantsInvite) {
      try {
        const result = await inviteUser(values.inviteEmail.trim(), values.inviteRole, membroId);
        toast.success(inviteSuccessMessage(result));
        captureEvent('invite_sent', { source: 'equipe' });
      } catch (err) {
        toast.error(membroInviteErrorMessage(err));
      }
    } else {
      toast.success(editing?.id ? 'Membro atualizado' : 'Membro adicionado');
    }

    qc.invalidateQueries({ queryKey: ['membros'] });
    qc.invalidateQueries({ queryKey: ['workspace-users'] });
    qc.invalidateQueries({ queryKey: ['invites'] });
    setModalOpen(false);
  } catch {
    toast.error('Erro ao salvar');
  } finally {
    setSaving(false);
  }
};
```

Also import `inviteSuccessMessage` from `../configuracao/inviteHelpers`.

- [ ] **Step 4: Render the section, the dynamic submit label, and the badge**

1. In the dialog form JSX, after the `crmUserId` FormField block:
   - Gate the existing `crmUserId` field on `canManageWorkspace && !!editing` instead of `!isAgent`: it disappears from ADD mode (the invite section replaces it) but stays in EVERY edit mode — the spec's `already-member` recovery path ("link manually via Conta CRM") depends on it being available for unlinked membros.
   - Below it add:

```tsx
{canManageWorkspace && !editing?.crm_user_id && (
  <InviteSection
    form={form}
    seat={seat}
    pendingInvite={editing?.id ? (pendingByMembroId.get(editing.id) ?? null) : null}
  />
)}
```

2. Submit button label:

```tsx
<Button type="submit" disabled={saving}>
  {saving && <Spinner size="sm" />}{' '}
  {form.watch('inviteEnabled') && !editing?.crm_user_id ? 'Salvar e convidar' : 'Salvar'}
</Button>
```

3. Card badge — replace the existing `sem conta vinculada` block with:

```tsx
{!isAgent && !m.crm_user_id && (
  pendingByMembroId.has(m.id!) ? (
    <Badge variant="warning" size="sm">
      convite pendente
    </Badge>
  ) : (
    <Badge variant="outline" size="sm">
      sem conta vinculada
    </Badge>
  )
)}
```

If the `Badge` component has no `warning` variant, use `variant="outline"` with `style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}`.

- [ ] **Step 5: Typecheck and run the frontend suite**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npm run test`
Expected: both PASS.

- [ ] **Step 6: Verify in the browser (staging)**

Start the CRM dev server via the preview tool (launch config for `npm run dev:staging`) and check, as an owner:

1. Adicionar Membro → section renders, meter shows real counts, switch off by default.
2. Switch on → email/role appear, button reads "Salvar e convidar".
3. Submit with invite → membro appears with "convite pendente" badge; invite listed in Configurações → Workspace.
4. Edit that membro → pending notice, no switch.
5. Dark theme spot-check of the section.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/equipe/EquipePage.tsx
git commit -m "feat(crm): workspace invite section in the membro dialog with seat meter and pending badge"
```

---

### Task 9: MembrosTab — shared query key + analytics source

**Files:**
- Modify: `apps/crm/src/pages/configuracao/tabs/MembrosTab.tsx:61` (query key), `:177` (captureEvent)

**Interfaces:**
- Consumes: nothing new. Produces: all three `getWorkspaceUsers` consumers (MembrosTab, EquipePage, WorkflowDrawer) share the `['workspace-users']` key, so Task 8's invalidation reaches the Configurações tab.

- [ ] **Step 1: Rename the key and tag the event**

In `MembrosTab.tsx`:

```ts
queryKey: ['workspace-users'],
```

(replacing `['workspaceUsers']`), and:

```ts
captureEvent('invite_sent', { source: 'configuracao' });
```

(replacing the bare `captureEvent('invite_sent')`).

- [ ] **Step 2: Check nothing else referenced the old key**

Run: `grep -rn "workspaceUsers" apps/crm/src --include="*.ts*"`
Expected: no remaining query-key usages (variable names like `wsUsers` are fine).

- [ ] **Step 3: Typecheck + test, then commit**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npm run test`
Expected: PASS.

```bash
git add apps/crm/src/pages/configuracao/tabs/MembrosTab.tsx
git commit -m "fix(crm): unify workspace-users query key and tag invite_sent with source"
```

---

### Task 10: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Run everything CI runs**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
npm run lint
npm run format:check
```

Expected: all PASS. If `format:check` fails, run `npm run format` and re-stage.

- [ ] **Step 2: Revert deno.lock if dirtied**

Run: `git status --short deno.lock` → if modified: `git checkout -- deno.lock`

- [ ] **Step 3: Re-verify the migration prefix against origin/main**

Run: `git fetch origin main && git ls-tree origin/main:supabase/migrations | awk '{print $4}' | tail -3`
Expected: every listed prefix is `< 20260731000002`. If not (e.g. PR #279 merged with `20260731000001` and something later landed), renumber the migration file above the new tail.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A && git commit -m "chore: verification fixups" || echo "clean"
```

---

## Deploy (after merge — from the spec's Rollout section)

1. Staging first: confirm link target (`cat supabase/.temp/project-ref` → staging is `wlyzhyfondykzpsiqsce`), then `npx supabase db push --linked` and `npx supabase functions deploy invite-user --use-api` (invite-user handles its own auth: keep its existing verify-jwt setting).
2. E2E on staging: the four dialog states + full invite → accept → `crm_user_id` set; accept twice → idempotent.
3. Prod: relink, same push + deploy, then merge for Vercel.
