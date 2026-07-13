# Tenant Invitation Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workspace membership and role assignment depend on persisted, unexpired invitations instead of user-editable Auth metadata.

**Architecture:** Persist a pending invitation before creating the Auth user, validate it in the Auth-user trigger, and accept it through one service-role-only transactional SQL function. Keep public owner sign-up unchanged and provide a read-only historical membership audit.

**Tech Stack:** Supabase Auth, PostgreSQL/PLpgSQL, Supabase JS, Deno TypeScript tests.

## Global Constraints

- Never trust `raw_user_meta_data.role` for authorization.
- A metadata `conta_id` is only an invitation selector; the invitation row supplies workspace and role.
- Unexpected Edge Function failures are generic to clients and detailed only in server logs.
- Do not deploy from this branch.
- Preserve existing-user, resend-link, and owner sign-up behavior.
- Every production change starts with a failing focused test.

---

### Task 1: Persist the Invitation Before Creating the Auth User

**Files:**
- Create: `supabase/functions/invite-user/pending-invite.ts`
- Create: `supabase/functions/__tests__/invite-user-pending_test.ts`
- Modify: `supabase/functions/invite-user/index.ts:290-330`

**Interfaces:**
- Consumes: normalized email, caller workspace/ID, role, and redirect URL.
- Produces: `sendPendingWorkspaceInvite(deps, input): Promise<string>` returning the exact new invitation ID.

- [ ] **Step 1: Write the failing tests**

```ts
import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertEquals } from "./assert.ts";
import { sendPendingWorkspaceInvite } from "../invite-user/pending-invite.ts";

const input = {
  contaId: "11111111-1111-4111-8111-111111111111",
  email: "invitee@example.com",
  role: "agent" as const,
  invitedBy: "22222222-2222-4222-8222-222222222222",
  redirectTo: "https://app.example/configurar-senha",
};

Deno.test("pending invite is persisted before Auth invitation", async () => {
  const events: string[] = [];
  const id = await sendPendingWorkspaceInvite({
    createPendingInvite: async () => { events.push("create"); return { id: "invite-1" }; },
    sendAuthInvite: async () => { events.push("send"); },
    deletePendingInvite: async () => { events.push("delete"); },
  }, input);
  assertEquals(id, "invite-1");
  assertEquals(events, ["create", "send"]);
});

Deno.test("Auth failure removes only the newly persisted invite", async () => {
  const deleted: string[] = [];
  await assertRejects(() => sendPendingWorkspaceInvite({
    createPendingInvite: async () => ({ id: "invite-new" }),
    sendAuthInvite: async () => { throw new Error("auth unavailable"); },
    deletePendingInvite: async (id) => { deleted.push(id); },
  }, input), Error, "auth unavailable");
  assertEquals(deleted, ["invite-new"]);
});

Deno.test("cleanup failure preserves the original Auth error", async () => {
  await assertRejects(() => sendPendingWorkspaceInvite({
    createPendingInvite: async () => ({ id: "invite-new" }),
    sendAuthInvite: async () => { throw new Error("auth unavailable"); },
    deletePendingInvite: async () => { throw new Error("cleanup unavailable"); },
  }, input), Error, "auth unavailable");
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
deno test --no-check --allow-env --allow-read supabase/functions/__tests__/invite-user-pending_test.ts
```

Expected: FAIL because `pending-invite.ts` does not exist.

- [ ] **Step 3: Implement the pure helper**

```ts
export type WorkspaceRole = "owner" | "admin" | "agent";

export interface PendingWorkspaceInviteInput {
  contaId: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string;
  redirectTo: string;
}

export interface PendingWorkspaceInviteDeps {
  createPendingInvite(input: Omit<PendingWorkspaceInviteInput, "redirectTo">): Promise<{ id: string }>;
  sendAuthInvite(input: PendingWorkspaceInviteInput): Promise<void>;
  deletePendingInvite(id: string): Promise<void>;
}

export async function sendPendingWorkspaceInvite(
  deps: PendingWorkspaceInviteDeps,
  input: PendingWorkspaceInviteInput,
): Promise<string> {
  const invite = await deps.createPendingInvite(input);
  try {
    await deps.sendAuthInvite(input);
    return invite.id;
  } catch (error) {
    try {
      await deps.deletePendingInvite(invite.id);
    } catch (cleanupError) {
      console.error("[invite-user] pending invite cleanup failed", cleanupError);
    }
    throw error;
  }
}
```

- [ ] **Step 4: Wire the helper into `invite-user/index.ts`**

Import the helper and replace the current Auth-first block with:

```ts
await sendPendingWorkspaceInvite({
  createPendingInvite: async (pending) => {
    const { data, error: insertError } = await adminClient.from("invites").insert({
      conta_id: pending.contaId,
      email: pending.email,
      role: pending.role,
      invited_by: pending.invitedBy,
      status: "pending",
    }).select("id").single();
    if (insertError || !data) throw insertError ?? new Error("invite_insert_failed");
    return data;
  },
  sendAuthInvite: async (pending) => {
    const { error: authInviteError } = await adminClient.auth.admin.inviteUserByEmail(
      pending.email,
      {
        data: { conta_id: pending.contaId, role: pending.role, nome: pending.email.split("@")[0] },
        redirectTo: pending.redirectTo,
      },
    );
    if (authInviteError) throw authInviteError;
  },
  deletePendingInvite: async (inviteId) => {
    const { error: cleanupError } = await adminClient.from("invites").delete().eq("id", inviteId);
    if (cleanupError) throw cleanupError;
  },
}, {
  contaId: profile.conta_id,
  email: email.toLowerCase(),
  role,
  invitedBy: user.id,
  redirectTo: redirectBase + "/configurar-senha",
});
```

Remove the duplicated pending insert after `inviteUserByEmail`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
deno test --no-check --allow-env --allow-read supabase/functions/__tests__/invite-user-pending_test.ts supabase/functions/__tests__/invite-user-onboarding_test.ts supabase/functions/__tests__/invite-user-seats_test.ts
```

Expected: all selected tests PASS.

```bash
git add supabase/functions/invite-user/index.ts supabase/functions/invite-user/pending-invite.ts supabase/functions/__tests__/invite-user-pending_test.ts
git commit -m "fix(auth): persist workspace invite before auth user"
```

---

### Task 2: Validate Invitation Data in the Auth Trigger

**Files:**
- Create: `supabase/migrations/20260713000001_secure_workspace_invites.sql`
- Create: `supabase/functions/__tests__/workspace-invite-security_test.ts`

**Interfaces:**
- Consumes: the pending invite persisted by Task 1.
- Produces: replacement `public.handle_new_user_workspace()` and `public.accept_workspace_invite(uuid)` restricted to `service_role`.

- [ ] **Step 1: Write the failing migration contract test**

```ts
import { assert, assertEquals } from "./assert.ts";

const migrationUrl = new URL("../../migrations/20260713000001_secure_workspace_invites.sql", import.meta.url);

Deno.test("workspace invite authorization comes from invites", async () => {
  const sql = await Deno.readTextFile(migrationUrl);
  assert(sql.includes("lower(i.email) = lower(NEW.email)"));
  assert(sql.includes("i.status = 'pending'"));
  assert(sql.includes("i.expires_at > now()"));
  assert(sql.includes("v_invite.role::user_role"));
  assertEquals(sql.includes("NEW.raw_user_meta_data ->> 'role'"), false);
  assert(sql.includes("RAISE EXCEPTION 'invalid_workspace_invitation'"));
  assert(sql.includes("EXISTS ("));
  assert(sql.includes("wm.user_id = auth.uid()"));
  assert(sql.includes("wm.workspace_id = p.active_workspace_id"));
});

Deno.test("acceptance RPC is transactional and service-role-only", async () => {
  const sql = await Deno.readTextFile(migrationUrl);
  assert(sql.includes("CREATE OR REPLACE FUNCTION public.accept_workspace_invite"));
  assert(sql.includes("ON CONFLICT (user_id, workspace_id) DO UPDATE"));
  assert(sql.includes("REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC"));
  assert(sql.includes("GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) TO service_role"));
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
deno test --no-check --allow-read supabase/functions/__tests__/workspace-invite-security_test.ts
```

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement the trigger body**

Copy the latest owner-workspace branch from `20260629000002_invite_preventative_workspace_row.sql`. Replace only its invite branch with a lookup that:

```sql
BEGIN
  meta_conta_id := NULLIF(NEW.raw_user_meta_data ->> 'conta_id', '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'invalid_workspace_invitation';
END;

IF meta_conta_id IS NOT NULL THEN
  SELECT i.* INTO v_invite
  FROM public.invites i
  WHERE lower(i.email) = lower(NEW.email)
    AND i.conta_id = meta_conta_id
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_workspace_invitation'; END IF;

  INSERT INTO profiles (id, conta_id, role, nome, active_workspace_id, onboarding_complete)
  VALUES (
    NEW.id,
    v_invite.conta_id,
    v_invite.role::user_role,
    COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email, '@', 1)),
    v_invite.conta_id,
    false
  )
  ON CONFLICT (id) DO UPDATE SET
    conta_id = EXCLUDED.conta_id,
    role = EXCLUDED.role,
    active_workspace_id = EXCLUDED.active_workspace_id;
```

Retain the existing guarded creation of a missing `workspaces` row after the invite lookup and before the profile insert. Reject a missing `contas` row instead of creating an orphan workspace.

Replace `get_my_conta_id()` in the same migration so a profile without membership cannot satisfy tenant RLS:

```sql
CREATE OR REPLACE FUNCTION public.get_my_conta_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.active_workspace_id
  FROM profiles p
  WHERE p.id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM workspace_members wm
      WHERE wm.user_id = auth.uid()
        AND wm.workspace_id = p.active_workspace_id
    );
$$;
```

- [ ] **Step 4: Implement the transactional acceptance RPC**

Start with this exact signature and state:

```sql
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
```

Load and lock server-authoritative state with:

```sql
SELECT lower(email) INTO v_email FROM auth.users WHERE id = p_user_id;
SELECT conta_id INTO v_conta_id FROM profiles WHERE id = p_user_id FOR UPDATE;
SELECT i.* INTO v_invite
FROM invites i
WHERE lower(i.email) = v_email
  AND i.conta_id = v_conta_id
  AND i.status = 'pending'
  AND i.expires_at > now()
ORDER BY i.created_at DESC
LIMIT 1
FOR UPDATE;
```

If no pending row exists, return the newest matching `accepted` invite only when the membership already exists. Otherwise raise `invite_not_found` with SQLSTATE `P0002`. For a pending row execute:

```sql
INSERT INTO workspace_members (user_id, workspace_id, role)
VALUES (p_user_id, v_invite.conta_id, v_invite.role)
ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = EXCLUDED.role;

UPDATE profiles SET
  conta_id = v_invite.conta_id,
  active_workspace_id = v_invite.conta_id,
  role = v_invite.role::user_role,
  onboarding_complete = true
WHERE id = p_user_id;

UPDATE invites SET status = 'accepted', accepted_at = now() WHERE id = v_invite.id;
```

Return `invite_id`, `conta_id`, `role`, `email`, and `already_accepted`. End with:

```sql
END;
$$;

REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) TO service_role;
```

- [ ] **Step 5: Verify GREEN and commit**

```bash
deno test --no-check --allow-read supabase/functions/__tests__/workspace-invite-security_test.ts
git add supabase/migrations/20260713000001_secure_workspace_invites.sql supabase/functions/__tests__/workspace-invite-security_test.ts
git commit -m "fix(auth): validate workspace invitations in database"
```

---

### Task 3: Accept Invitations with Authenticated Server Data

**Files:**
- Modify: `supabase/functions/manage-workspace-user/index.ts:20-110`
- Modify: `apps/crm/src/lib/supabase.ts:145-205`
- Modify: `apps/crm/src/pages/configurar-senha/ConfigurarSenhaPage.tsx:170-185`
- Modify: `apps/crm/src/lib/__tests__/supabase.test.ts:270-310`
- Modify: `apps/crm/src/pages/configurar-senha/__tests__/ConfigurarSenhaPage.test.tsx:230-285`
- Create: `supabase/functions/__tests__/manage-workspace-invite-contract_test.ts`

**Interfaces:**
- Consumes: `public.accept_workspace_invite(p_user_id uuid)` from Task 2.
- Produces: request body `{ action: "accept-invite" }`; no email or authorization selector comes from the client.

- [ ] **Step 1: Write failing client and Edge contract tests**

Update both client assertions to require:

```ts
expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ action: "accept-invite" });
```

Create the Deno source contract:

```ts
import { assert, assertEquals } from "./assert.ts";

Deno.test("manage-workspace-user accepts with JWT user and RPC only", async () => {
  const source = await Deno.readTextFile(new URL("../manage-workspace-user/index.ts", import.meta.url));
  assert(source.includes('.rpc("accept_workspace_invite", { p_user_id: user.id })'));
  assertEquals(source.includes("const { email } = body"), false);
  assertEquals(source.includes('.eq("email", email.toLowerCase())'), false);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
npm run test -- apps/crm/src/lib/__tests__/supabase.test.ts apps/crm/src/pages/configurar-senha/__tests__/ConfigurarSenhaPage.test.tsx
deno test --no-check --allow-read supabase/functions/__tests__/manage-workspace-invite-contract_test.ts
```

Expected: FAIL because callers still send `email` and the Edge Function still updates tables directly.

- [ ] **Step 3: Replace direct acceptance with the RPC**

Require `user.email`, then use:

```ts
const { data: acceptedRows, error: acceptError } = await serviceClient
  .rpc("accept_workspace_invite", { p_user_id: user.id });

if (acceptError) {
  if (acceptError.message?.includes("invite_not_found")) {
    return new Response(JSON.stringify({ error: "Convite não encontrado ou expirado." }), {
      status: 404,
      headers,
    });
  }
  throw acceptError;
}

const accepted = Array.isArray(acceptedRows) ? acceptedRows[0] : acceptedRows;
if (!accepted) throw new Error("invite_acceptance_missing_result");
```

Use `accepted.conta_id`, `accepted.email`, and `accepted.invite_id` in `insertAuditLog`. Remove the direct `invites.update`, `workspace_members.insert`, and `profiles.update` blocks because the RPC owns that transaction. Change both CRM callers to send only `{ action: "accept-invite" }`.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm run test -- apps/crm/src/lib/__tests__/supabase.test.ts apps/crm/src/pages/configurar-senha/__tests__/ConfigurarSenhaPage.test.tsx
deno test --no-check --allow-read supabase/functions/__tests__/manage-workspace-invite-contract_test.ts supabase/functions/__tests__/workspace-invite-security_test.ts
git add supabase/functions/manage-workspace-user/index.ts apps/crm/src/lib/supabase.ts apps/crm/src/pages/configurar-senha/ConfigurarSenhaPage.tsx apps/crm/src/lib/__tests__/supabase.test.ts apps/crm/src/pages/configurar-senha/__tests__/ConfigurarSenhaPage.test.tsx supabase/functions/__tests__/manage-workspace-invite-contract_test.ts
git commit -m "fix(auth): accept workspace invites transactionally"
```

Expected: all selected tests PASS.

---

### Task 4: Add a Read-only Historical Membership Audit

**Files:**
- Create: `scripts/audit-workspace-memberships.sql`

**Interfaces:**
- Consumes: `workspace_members`, `profiles`, `auth.users`, `workspaces`, and `invites`.
- Produces: a read-only result set of non-owner memberships without accepted invitation history.

- [ ] **Step 1: Add the query**

```sql
-- Read-only: review every returned row before taking action.
SELECT
  wm.user_id,
  u.email,
  wm.workspace_id,
  wm.role AS membership_role,
  p.conta_id AS profile_conta_id,
  p.active_workspace_id,
  wm.joined_at
FROM public.workspace_members wm
JOIN auth.users u ON u.id = wm.user_id
LEFT JOIN public.profiles p ON p.id = wm.user_id
LEFT JOIN public.workspaces w ON w.id = wm.workspace_id
WHERE wm.role <> 'owner'
  AND wm.user_id IS DISTINCT FROM w.created_by
  AND NOT EXISTS (
    SELECT 1
    FROM public.invites i
    WHERE lower(i.email) = lower(u.email)
      AND i.conta_id = wm.workspace_id
      AND i.status = 'accepted'
  )
ORDER BY wm.joined_at DESC, wm.workspace_id, u.email;
```

- [ ] **Step 2: Verify it is read-only**

Run:

```bash
rg -n "^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)" scripts/audit-workspace-memberships.sql
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-workspace-memberships.sql
git commit -m "docs(security): add workspace membership audit query"
```
