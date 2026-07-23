# Admin Invites Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give platform admins a per-workspace Invites panel on the admin portal's `WorkspaceDetailPage` that diagnoses invite/email problems and offers audit-logged cancel/resend actions sharing the CRM's exact invite code path.

**Architecture:** Extract `invite-user`'s invite logic into `supabase/functions/_shared/` modules, refactor `invite-user`'s POST to delegate to a single shared `inviteOrResend` primitive, then add three new actions to the existing `platform-admin` edge function (`get-workspace-invites`, `admin-cancel-invite`, `admin-resend-invite`). The admin React app gets a new card that consumes them.

**Tech Stack:** Deno edge functions (`npm:@supabase/supabase-js@2`), Deno std test; React 19 + TanStack Query + Tailwind (admin app); Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-23-admin-invites-panel-design.md`

## Global Constraints

- **Edge runtime is Deno**, not Node. Imports use `npm:` or relative `.ts` paths.
- **CORS:** always `buildCorsHeaders(req)` from `_shared/cors.ts`; never wildcard `*`.
- **Errors from edge functions:** return generic messages to the client; log details only via `console.error`. Never return raw error text.
- **Admin auth:** every `platform-admin` action runs *after* the existing `platform_admins` gate; new handlers additionally validate `invite.conta_id === workspace_id`.
- **No action links in responses:** never return a generated set-password / recovery link to the client (account-takeover vector).
- **Copy:** CRM (`invite-user`) responses stay pt-BR and byte-identical to today; admin-app UI copy is English, matching the neighboring "Members" card.
- **`inviteOrResend` is THE invite-or-resend primitive** — both `invite-user`'s POST and `admin-resend-invite` call it; no parallel reimplementation.
- **Seat rule:** resend enforces `max_team_members` exactly as `invite-user` does today (same order: seat-check counts current members+pending, then delete prior rows, then route).
- **No migrations.** `invites`, `audit_log`, `user_has_password(uuid)`, `effective_plan_limit(ws_id, limit_key)` all already exist in prod.
- **Deploy:** `invite-user` and `platform-admin` MUST deploy together (shared modules), each `--use-api` with the correct `--project-ref`.
- **Gates before pushing:** `npm run test`, `npm run build:admin`, `npm run test:functions`, `npm run lint`, `npm run format:check`. Use `npm run test:functions` (never bare `deno test`) — its `--allow-env/--allow-net/--allow-sys` flags are required by the env/fetch-stub tests. It dirties the **root** `deno.lock`; restore only that file with `git checkout -- deno.lock` (not `supabase/functions/deno.lock` — no task here changes a Deno dependency). Per-task, narrow with `npm run test:functions -- --filter "<name>"`. Type-check an edge function with `deno check --node-modules-dir=auto --config supabase/functions/deno.json <path>`.

---

## File Structure

**Backend (Deno):**
- `supabase/functions/_shared/invite-classify.ts` — CREATE (move of `invite-user/onboarding.ts`)
- `supabase/functions/_shared/invite-pending.ts` — CREATE (move of `invite-user/pending-invite.ts`)
- `supabase/functions/_shared/invite-seats.ts` — CREATE (move of `invite-user/seats.ts`, Task 5 Step 0)
- `supabase/functions/_shared/invite-actions.ts` — CREATE (`findAuthUserByEmail`, `getAuthStatesByEmails`, `cancelInvite`, `inviteOrResend`)
- `supabase/functions/invite-user/index.ts` — MODIFY (imports + POST delegates to `inviteOrResend`)
- `supabase/functions/invite-user/onboarding.ts`, `invite-user/pending-invite.ts`, `invite-user/seats.ts` — DELETE (moved to `_shared/`)
- `supabase/functions/platform-admin/invite-handlers.ts` — CREATE (3 action handlers, kept out of index.ts for testability)
- `supabase/functions/platform-admin/invites-enrich.ts` — CREATE (pure flags + resend mapping/validation)
- `supabase/functions/platform-admin/index.ts` — MODIFY (imports + 3 dispatch cases)
- Tests: `supabase/functions/__tests__/invite-user-onboarding_test.ts` (retarget import), `invite-user-pending_test.ts` (retarget import), `invite-user-seats_test.ts` (retarget import), `invite-actions_test.ts` (CREATE), `platform-admin-invites_test.ts` (CREATE)

**Frontend (React):**
- `apps/admin/src/lib/api.ts` — MODIFY (types + 3 functions)
- `apps/admin/src/pages/workspace-invites.ts` — CREATE (pure derivation: chip label + status tags)
- `apps/admin/src/pages/__tests__/workspace-invites.test.ts` — CREATE
- `apps/admin/src/pages/WorkspaceInvitesCard.tsx` — CREATE (the card component)
- `apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx` — CREATE (light RTL)
- `apps/admin/src/pages/WorkspaceDetailPage.tsx` — MODIFY (render the card)

---

## Task 1: Move onboarding.ts → _shared/invite-classify.ts

Pure relocation so `platform-admin` can import the classifier without reaching into `invite-user/`. No behavior change.

**Files:**
- Create: `supabase/functions/_shared/invite-classify.ts`
- Delete: `supabase/functions/invite-user/onboarding.ts`
- Modify: `supabase/functions/invite-user/index.ts:4` (import path)
- Modify: `supabase/functions/__tests__/invite-user-onboarding_test.ts:2` (import path)

**Interfaces:**
- Produces: `classifyExistingUser(args): InviteAction` and `coerceHasPassword(data, error): boolean | null` (unchanged signatures), now at `_shared/invite-classify.ts`. `InviteAction = "reinvite" | "resend-link" | "add-direct" | "blocked-anomalous"`.

- [ ] **Step 1: Move the file verbatim**

```bash
git mv supabase/functions/invite-user/onboarding.ts supabase/functions/_shared/invite-classify.ts
```

- [ ] **Step 2: Update the import in invite-user/index.ts**

In `supabase/functions/invite-user/index.ts`, change line 4 from:

```ts
import { classifyExistingUser, coerceHasPassword } from "./onboarding.ts";
```

to:

```ts
import { classifyExistingUser, coerceHasPassword } from "../_shared/invite-classify.ts";
```

- [ ] **Step 3: Update the test import**

In `supabase/functions/__tests__/invite-user-onboarding_test.ts`, change line 2 from:

```ts
import { classifyExistingUser, coerceHasPassword } from "../invite-user/onboarding.ts";
```

to:

```ts
import { classifyExistingUser, coerceHasPassword } from "../_shared/invite-classify.ts";
```

- [ ] **Step 4: Verify no stragglers reference the old path**

Run: `grep -rn "invite-user/onboarding" supabase/functions apps`
Expected: no output.

- [ ] **Step 5: Run the moved test**

Run: `npm run test:functions`
Expected: all 13 tests PASS.

- [ ] **Step 6: Commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add -A supabase/functions
git commit -m "refactor: move invite classifier to _shared/invite-classify.ts"
```

---

## Task 2: Move pending-invite.ts → _shared/invite-pending.ts

Same rationale as Task 1 for the new-user invite helper.

**Files:**
- Create: `supabase/functions/_shared/invite-pending.ts`
- Delete: `supabase/functions/invite-user/pending-invite.ts`
- Modify: `supabase/functions/invite-user/index.ts:7` (import path)
- Modify: `supabase/functions/__tests__/invite-user-pending_test.ts:3` (import path)

**Interfaces:**
- Produces: `sendPendingWorkspaceInvite(deps, input): Promise<string>`, plus types `WorkspaceRole`, `PendingWorkspaceInviteInput`, `PendingWorkspaceInviteDeps` — unchanged, now at `_shared/invite-pending.ts`.

- [ ] **Step 1: Move the file verbatim**

```bash
git mv supabase/functions/invite-user/pending-invite.ts supabase/functions/_shared/invite-pending.ts
```

- [ ] **Step 2: Update the import in invite-user/index.ts**

Change line 7 from `import { sendPendingWorkspaceInvite } from "./pending-invite.ts";` to:

```ts
import { sendPendingWorkspaceInvite } from "../_shared/invite-pending.ts";
```

- [ ] **Step 3: Update the test import**

In `supabase/functions/__tests__/invite-user-pending_test.ts`, change line 3 to:

```ts
import { sendPendingWorkspaceInvite } from "../_shared/invite-pending.ts";
```

- [ ] **Step 4: Verify no stragglers**

Run: `grep -rn "invite-user/pending-invite" supabase/functions apps`
Expected: no output.

- [ ] **Step 5: Run the moved test**

Run: `npm run test:functions`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add -A supabase/functions
git commit -m "refactor: move pending-invite helper to _shared/invite-pending.ts"
```

---

## Task 3: Create invite-actions.ts with findAuthUserByEmail + getAuthStatesByEmails

The auth-state reader for the diagnostics panel. `getAuthStatesByEmails` resolves N emails in ONE paged `listUsers` scan (today's `findAuthUserByEmail` re-pages per email).

**Files:**
- Create: `supabase/functions/_shared/invite-actions.ts`
- Create: `supabase/functions/__tests__/invite-actions_test.ts`

**Interfaces:**
- Consumes: `classifyExistingUser`, `coerceHasPassword` from `_shared/invite-classify.ts`.
- Produces:
  - `findAuthUserByEmail(adminClient, email): Promise<AuthUser | null>`
  - `getAuthStatesByEmails(adminClient, emails: string[]): Promise<Map<string, AuthState>>` where
    `AuthState = { user_id: string; email_confirmed: boolean; confirmation_sent_at: string | null; invited_at: string | null; last_sign_in_at: string | null; has_password: boolean | null; onboarding_complete: boolean }`.
    Key is the lower-cased email. Absent email ⇒ no map entry.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/invite-actions_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { getAuthStatesByEmails } from "../_shared/invite-actions.ts";

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
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm run test:functions`
Expected: FAIL ("Module not found" for `invite-actions.ts`).

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/invite-actions.ts` (this step adds only the two readers; later tasks append `cancelInvite` and `inviteOrResend`):

```ts
// deno-lint-ignore-file no-explicit-any
import { classifyExistingUser, coerceHasPassword } from "./invite-classify.ts";

export interface AuthState {
  user_id: string;
  email_confirmed: boolean;
  confirmation_sent_at: string | null;
  invited_at: string | null;
  last_sign_in_at: string | null;
  has_password: boolean | null;
  onboarding_complete: boolean;
}

export async function findAuthUserByEmail(adminClient: any, email: string) {
  let page = 1;
  const target = email.toLowerCase();
  while (true) {
    const result = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    const users = result.data?.users;
    if (!users || users.length === 0) return null;
    const found = users.find((u: any) => u.email?.toLowerCase() === target);
    if (found) return found;
    page++;
  }
}

/**
 * Resolve auth state for many emails in ONE paged listUsers scan (not one per
 * email). Returns a Map keyed by lower-cased email; emails with no auth user
 * are simply absent from the Map.
 */
export async function getAuthStatesByEmails(
  adminClient: any,
  emails: string[],
): Promise<Map<string, AuthState>> {
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  const byEmail = new Map<string, any>();

  let page = 1;
  while (wanted.size > byEmail.size) {
    const result = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw result.error;
    const users = result.data?.users;
    if (!users || users.length === 0) break;
    for (const u of users) {
      const key = u.email?.toLowerCase();
      if (key && wanted.has(key) && !byEmail.has(key)) byEmail.set(key, u);
    }
    page++;
  }

  const ids = [...byEmail.values()].map((u) => u.id);
  const onboardedById = new Map<string, boolean>();
  if (ids.length) {
    const { data: profiles } = await adminClient
      .from("profiles").select("id, onboarding_complete").in("id", ids);
    for (const p of profiles ?? []) onboardedById.set(p.id, p.onboarding_complete === true);
  }

  const out = new Map<string, AuthState>();
  for (const [key, u] of byEmail) {
    const { data: pw, error: pwErr } = await adminClient
      .rpc("user_has_password", { p_user_id: u.id });
    out.set(key, {
      user_id: u.id,
      email_confirmed: !!u.email_confirmed_at,
      confirmation_sent_at: u.confirmation_sent_at ?? null,
      invited_at: u.invited_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      has_password: coerceHasPassword(pw, pwErr),
      onboarding_complete: onboardedById.get(u.id) ?? false,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:functions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/_shared/invite-actions.ts supabase/functions/__tests__/invite-actions_test.ts
git commit -m "feat: add getAuthStatesByEmails batch auth-state reader"
```

---

## Task 4: Add cancelInvite to invite-actions.ts

Hard-delete a `pending`/`expired` invite and clean up an orphan never-onboarded auth user, capturing the user's full workspace set first for cross-workspace auditing (finding 5). Rejects `accepted` (finding 1).

**Files:**
- Modify: `supabase/functions/_shared/invite-actions.ts` (append)
- Modify: `supabase/functions/__tests__/invite-actions_test.ts` (append)

**Interfaces:**
- Consumes: `classifyExistingUser`, `coerceHasPassword`, `findAuthUserByEmail` (same module).
- Produces: `cancelInvite(adminClient, { inviteId, contaId }): Promise<CancelResult>` where
  `CancelResult = { status: "cancelled"; email: string; deletedUser: boolean; affectedWorkspaceIds: string[] }`.
  Throws `Error("invite_not_found")` when the row is missing or `conta_id` mismatches, and `Error("invite_not_cancellable")` when status is `accepted`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/invite-actions_test.ts`:

```ts
import { cancelInvite } from "../_shared/invite-actions.ts";

// Recording fake for cancelInvite: invites lookup + delete, profiles/members/auth deletes.
function makeCancelAdmin(opts: {
  invite: { id: string; conta_id: string; email: string; status: string } | null;
  authUser?: { id: string; email_confirmed_at: string | null } | null;
  onboarding?: boolean;
  hasPassword?: boolean | null;
  memberships?: string[]; // workspace_ids the user belongs to
}) {
  const deletes: string[] = [];
  const inviteRow = opts.invite;
  return {
    _deletes: () => deletes,
    auth: {
      admin: {
        // deno-lint-ignore no-explicit-any
        listUsers: (_a: any) => Promise.resolve({
          data: { users: opts.authUser ? [{ ...opts.authUser, email: inviteRow?.email }] : [] },
          error: null,
        }),
        deleteUser: (id: string) => { deletes.push("auth:" + id); return Promise.resolve({ error: null }); },
      },
    },
    // deno-lint-ignore no-explicit-any
    rpc: (_fn: string, _p: any) => Promise.resolve({ data: opts.hasPassword ?? null, error: null }),
    from: (table: string) => {
      const api: any = {
        select: () => api,
        eq: () => api,
        in: () => api,
        maybeSingle: () => {
          if (table === "profiles") return Promise.resolve({ data: opts.onboarding !== undefined ? { onboarding_complete: opts.onboarding } : null, error: null });
          if (table === "invites") return Promise.resolve({ data: inviteRow, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        delete: () => { deletes.push("del:" + table); return api; },
        then: (r: (x: any) => unknown) => {
          if (table === "workspace_members") {
            return Promise.resolve(r({ data: (opts.memberships ?? []).map((w) => ({ workspace_id: w })), error: null }));
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:functions`
Expected: FAIL ("cancelInvite is not a function" / not exported).

- [ ] **Step 3: Implement cancelInvite**

Append to `supabase/functions/_shared/invite-actions.ts`:

```ts
export interface CancelResult {
  status: "cancelled";
  email: string;
  deletedUser: boolean;
  affectedWorkspaceIds: string[];
}

/**
 * Admin-side invite cancel. Only pending/expired invites may be cancelled
 * (accepted is live membership + history — refuse). When the invitee never
 * finished onboarding the orphan auth user is deleted globally; we capture its
 * full workspace_members set BEFORE the delete so callers can audit every
 * workspace the user vanished from.
 */
export async function cancelInvite(
  adminClient: any,
  args: { inviteId: string; contaId: string },
): Promise<CancelResult> {
  const { data: invite } = await adminClient
    .from("invites")
    .select("id, conta_id, email, status")
    .eq("id", args.inviteId)
    .eq("conta_id", args.contaId)
    .maybeSingle();

  if (!invite) throw new Error("invite_not_found");
  if (invite.status === "accepted") throw new Error("invite_not_cancellable");

  const email: string = invite.email;

  // Decide whether the orphan auth user should be deleted, and if so capture
  // its workspace set first.
  let deletedUser = false;
  let affectedWorkspaceIds: string[] = [];
  const authUser = await findAuthUserByEmail(adminClient, email);
  if (authUser) {
    const { data: profile } = await adminClient
      .from("profiles").select("onboarding_complete").eq("id", authUser.id).maybeSingle();
    const { data: pw, error: pwErr } = await adminClient
      .rpc("user_has_password", { p_user_id: authUser.id });
    const action = classifyExistingUser({
      emailConfirmed: !!authUser.email_confirmed_at,
      hasProfile: !!profile,
      onboardingComplete: profile?.onboarding_complete === true,
      hasPassword: coerceHasPassword(pw, pwErr),
    });
    if (action === "reinvite" || action === "resend-link") {
      const { data: memberships } = await adminClient
        .from("workspace_members").select("workspace_id").eq("user_id", authUser.id);
      affectedWorkspaceIds = [...new Set((memberships ?? []).map((m: any) => m.workspace_id))] as string[];
      await adminClient.from("profiles").delete().eq("id", authUser.id);
      await adminClient.from("workspace_members").delete().eq("user_id", authUser.id);
      await adminClient.auth.admin.deleteUser(authUser.id);
      deletedUser = true;
    }
  }

  await adminClient.from("invites").delete().eq("id", args.inviteId);

  // Always include the target workspace even when no global delete happened.
  if (!affectedWorkspaceIds.includes(args.contaId)) affectedWorkspaceIds.push(args.contaId);

  return { status: "cancelled", email, deletedUser, affectedWorkspaceIds };
}
```

- [ ] **Step 4: Run the tests to verify pass**

Run: `npm run test:functions`
Expected: PASS (all cancelInvite + getAuthStatesByEmails tests).

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/_shared/invite-actions.ts supabase/functions/__tests__/invite-actions_test.ts
git commit -m "feat: add cancelInvite with accepted-guard and cross-workspace capture"
```

---

## Task 5: Add inviteOrResend to invite-actions.ts

The single invite-or-resend primitive. Order: (1) seat pre-check (excluding a matching pending row — finding 3); (2) classify the existing auth user; (3) route, deleting prior rows only **inside** the chosen mutating route (finding 4). `add-direct` adds the member only when `opts.addOnboarded` (CRM), else reports `already-onboarded` (finding 1). Every mutation's `{ error }` is checked (finding 2); `reinvite` returns `affectedWorkspaceIds` (finding 5).

**Files:**
- Modify: `supabase/functions/_shared/invite-actions.ts` (append)
- Modify: `supabase/functions/__tests__/invite-actions_test.ts` (append)

**Interfaces:**
- Consumes: `sendPendingWorkspaceInvite` from `_shared/invite-pending.ts`; `effectivePlanLimit` from `_shared/entitlements-rpc.ts`; `seatsAvailable` from `_shared/invite-seats.ts` (moved in Step 0); `sendInviteEmail` from `_shared/invite-email.ts`.
- Produces: `inviteOrResend(adminClient, input, opts): Promise<InviteOutcome>` where
  `input = { contaId: string; email: string; role: "owner"|"admin"|"agent"; invitedBy: string; redirectBase: string }`,
  `opts = { addOnboarded: boolean }` (true = CRM adds onboarded non-members; false = admin reports),
  `InviteRoute = "added" | "already-member" | "already-onboarded" | "resent-link" | "reinvited" | "invited" | "plan-limit-exceeded" | "blocked-anomalous"`,
  `InviteOutcome = { route: InviteRoute; affectedWorkspaceIds?: string[] }`.

- [ ] **Step 0: Move seats.ts into _shared (fix dependency direction)**

After Task 6, only the shared module consumes `seatsAvailable`, so relocate it out of the function dir:

```bash
git mv supabase/functions/invite-user/seats.ts supabase/functions/_shared/invite-seats.ts
```

Update the seats test import in `supabase/functions/__tests__/invite-user-seats_test.ts` line 2 to:

```ts
import { seatsAvailable } from "../_shared/invite-seats.ts";
```

Update the still-standing import in `supabase/functions/invite-user/index.ts` (line 3) — it is removed entirely in Task 6, but this task runs first, so retarget it now to keep the tree compiling:

```ts
import { seatsAvailable } from "../_shared/invite-seats.ts";
```

Run: `grep -rn "invite-user/seats" supabase/functions apps` → expect no output. Then `npm run test:functions -- --filter "seatsAvailable"` → PASS.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/invite-actions_test.ts`. This fake models the branch inputs; each test asserts the chosen route.

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:functions`
Expected: FAIL ("inviteOrResend is not a function").

- [ ] **Step 3: Implement inviteOrResend**

Append to `supabase/functions/_shared/invite-actions.ts`. Add these imports at the TOP of the file (below the existing `invite-classify` import):

```ts
import { sendPendingWorkspaceInvite } from "./invite-pending.ts";
import { sendInviteEmail } from "./invite-email.ts";
import { effectivePlanLimit } from "./entitlements-rpc.ts";
import { seatsAvailable } from "./invite-seats.ts";
```

Then append:

```ts
export interface InviteOrResendInput {
  contaId: string;
  email: string;
  role: "owner" | "admin" | "agent";
  invitedBy: string;
  redirectBase: string;
}
export interface InviteOrResendOpts {
  /** true (CRM/invite-user): add-direct adds an onboarded non-member. false
   * (admin resend): report instead of adding — membership mgmt is out of scope. */
  addOnboarded: boolean;
}
export type InviteRoute =
  | "added" | "already-member" | "already-onboarded" | "resent-link" | "reinvited"
  | "invited" | "plan-limit-exceeded" | "blocked-anomalous";
export interface InviteOutcome { route: InviteRoute; affectedWorkspaceIds?: string[]; }

/** Throw on a Supabase mutation error — never report success after a failed write. */
function ensureOk(error: unknown, op: string): void {
  if (error) throw new Error(`invite_mutation_failed:${op}`);
}

/**
 * THE invite-or-resend primitive shared by invite-user (CRM, addOnboarded:true)
 * and admin-resend-invite (portal, addOnboarded:false). Classifies BEFORE any
 * mutation so a blocked-anomalous / failed path never destroys the invite; the
 * seat check excludes a matching pending row (a resend consumes no new seat);
 * every mutation's { error } is inspected.
 */
export async function inviteOrResend(
  adminClient: any,
  input: InviteOrResendInput,
  opts: InviteOrResendOpts,
): Promise<InviteOutcome> {
  const email = input.email.toLowerCase();

  // (1) Seat pre-check. The pending count EXCLUDES a matching pending row for
  // this email (it is being replaced, not added — finding 3), so members +
  // pending-for-OTHER-emails < limit correctly leaves room for this one row.
  const limit = await effectivePlanLimit(adminClient, input.contaId, "max_team_members");
  const [membersRes, pendingRes] = await Promise.all([
    adminClient.from("workspace_members").select("*", { count: "exact", head: true })
      .eq("workspace_id", input.contaId),
    adminClient.from("invites").select("*", { count: "exact", head: true })
      .eq("conta_id", input.contaId).eq("status", "pending").neq("email", email),
  ]);
  ensureOk(membersRes.error, "count_members");
  ensureOk(pendingRes.error, "count_pending");
  if (!seatsAvailable({ limit, members: membersRes.count ?? 0, pendingInvites: pendingRes.count ?? 0 })) {
    return { route: "plan-limit-exceeded" };
  }

  // (2) Classify the existing auth user BEFORE mutating anything.
  const existingUser = await findAuthUserByEmail(adminClient, email);
  if (existingUser) {
    const { data: prof } = await adminClient
      .from("profiles").select("onboarding_complete, id").eq("id", existingUser.id).maybeSingle();
    const { data: pw, error: pwErr } = await adminClient
      .rpc("user_has_password", { p_user_id: existingUser.id });
    const action = classifyExistingUser({
      emailConfirmed: !!existingUser.email_confirmed_at,
      hasProfile: !!prof,
      onboardingComplete: prof?.onboarding_complete === true,
      hasPassword: coerceHasPassword(pw, pwErr),
    });

    // No mutation yet — safe to bail on the non-actionable states.
    if (action === "blocked-anomalous") return { route: "blocked-anomalous" };

    if (action === "add-direct") {
      const { data: membership } = await adminClient
        .from("workspace_members").select("id")
        .eq("user_id", existingUser.id).eq("workspace_id", input.contaId).maybeSingle();
      if (membership) return { route: "already-member" };
      if (!opts.addOnboarded) return { route: "already-onboarded" }; // admin: report, don't add
      // CRM: add the member (finding-2 fix for the CRM path).
      await deletePriorInvites(adminClient, email, input.contaId);
      const mIns = await adminClient.from("workspace_members")
        .insert({ user_id: existingUser.id, workspace_id: input.contaId, role: input.role });
      ensureOk(mIns.error, "member_insert");
      const { data: existingProfile } = await adminClient
        .from("profiles").select("id").eq("id", existingUser.id).maybeSingle();
      if (!existingProfile) {
        const pIns = await adminClient.from("profiles").insert({
          id: existingUser.id, conta_id: input.contaId, role: input.role,
          nome: existingUser.user_metadata?.nome || email.split("@")[0],
          active_workspace_id: input.contaId, onboarding_complete: true,
        });
        ensureOk(pIns.error, "profile_insert");
      }
      const iIns = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy,
        status: "accepted", accepted_at: new Date().toISOString(),
      });
      ensureOk(iIns.error, "invite_insert_accepted");
      return { route: "added" };
    }

    if (action === "resend-link") {
      await deletePriorInvites(adminClient, email, input.contaId);
      const { data: link, error: linkErr } = await adminClient.auth.admin.generateLink({
        type: "recovery", email, options: { redirectTo: input.redirectBase + "/configurar-senha" },
      });
      if (linkErr || !link?.properties?.action_link) throw new Error("generate_link_failed");
      const { data: conta } = await adminClient
        .from("contas").select("nome").eq("id", input.contaId).maybeSingle();
      await sendInviteEmail({ to: email, actionLink: link.properties.action_link, workspaceName: conta?.nome || "seu workspace" });
      const ins = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy, status: "pending",
      });
      ensureOk(ins.error, "invite_insert_pending");
      return { route: "resent-link" };
    }

    // reinvite: never-confirmed. Capture the user's workspaces for audit BEFORE
    // deleting, then delete + fresh invite.
    const { data: memberships } = await adminClient
      .from("workspace_members").select("workspace_id").eq("user_id", existingUser.id);
    const affectedWorkspaceIds = [...new Set((memberships ?? []).map((m: any) => m.workspace_id))] as string[];
    if (!affectedWorkspaceIds.includes(input.contaId)) affectedWorkspaceIds.push(input.contaId);
    await deletePriorInvites(adminClient, email, input.contaId);
    ensureOk((await adminClient.from("profiles").delete().eq("id", existingUser.id)).error, "profile_delete");
    ensureOk((await adminClient.from("workspace_members").delete().eq("user_id", existingUser.id)).error, "member_delete");
    ensureOk((await adminClient.auth.admin.deleteUser(existingUser.id)).error, "user_delete");
    await sendNewUserInvite(adminClient, input, email);
    return { route: "reinvited", affectedWorkspaceIds };
  }

  // (3) New user.
  await deletePriorInvites(adminClient, email, input.contaId);
  await sendNewUserInvite(adminClient, input, email);
  return { route: "invited" };
}

async function deletePriorInvites(adminClient: any, email: string, contaId: string): Promise<void> {
  const { error } = await adminClient.from("invites").delete()
    .eq("email", email).eq("conta_id", contaId).in("status", ["pending", "expired"]);
  ensureOk(error, "prior_invites_delete");
}

async function sendNewUserInvite(adminClient: any, input: InviteOrResendInput, email: string): Promise<void> {
  await sendPendingWorkspaceInvite({
    createPendingInvite: async (p) => {
      const { data, error } = await adminClient.from("invites").insert({
        conta_id: p.contaId, email: p.email, role: p.role, invited_by: p.invitedBy, status: "pending",
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
    deletePendingInvite: async (id) => { await adminClient.from("invites").delete().eq("id", id); },
  }, {
    contaId: input.contaId, email, role: input.role, invitedBy: input.invitedBy,
    redirectTo: input.redirectBase + "/configurar-senha",
  });
}
```

> Note the ordering change vs. the old inline `invite-user`: `deletePriorInvites` now runs **inside** each mutating route (after classification), never before it. That is the finding-4 fix — a `blocked-anomalous` or `already-onboarded` result returns with the pending invite still intact.

- [ ] **Step 4: Run the tests to verify pass**

Run: `npm run test:functions`
Expected: PASS (all inviteOrResend routes + earlier tests).

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/_shared/invite-actions.ts supabase/functions/__tests__/invite-actions_test.ts
git commit -m "feat: add inviteOrResend shared invite-or-resend primitive"
```

---

## Task 6: Refactor invite-user POST to delegate to inviteOrResend

Make `invite-user`'s POST call the shared primitive, mapping routes back to the existing pt-BR responses so CRM behavior is byte-identical. The DELETE (owner cancel) handler and all request parsing/role checks stay.

**Files:**
- Modify: `supabase/functions/invite-user/index.ts` (POST body from ~line 144 to ~line 354)

**Interfaces:**
- Consumes: `inviteOrResend` from `_shared/invite-actions.ts`.

**What stays untouched:** the file's local `findAuthUserByEmail` (lines 10–23), `deleteUnconfirmedInvitedUser` (lines 25–51), the whole DELETE branch, and the auth/profile/role setup at the top of the handler. The `classifyExistingUser`/`coerceHasPassword` import (now from `_shared/invite-classify.ts` after Task 1) stays — `deleteUnconfirmedInvitedUser` still uses it.

- [ ] **Step 1: Swap imports for the POST path**

In `supabase/functions/invite-user/index.ts`, add:

```ts
import { inviteOrResend } from "../_shared/invite-actions.ts";
```

Then delete these four imports, which only the old POST body used (the DELETE branch does not reference them): `seatsAvailable` (`../_shared/invite-seats.ts`, retargeted in Task 5 Step 0), `sendInviteEmail` (`../_shared/invite-email.ts`), `effectivePlanLimit` (`../_shared/entitlements-rpc.ts`), and `sendPendingWorkspaceInvite` (`../_shared/invite-pending.ts`). Leave every other import in place. Step 4's `deno check` will flag it if one of these was still referenced.

- [ ] **Step 2: Replace the POST-branch body**

Replace everything from the seat pre-check comment (`// Seat pre-check:` ~line 144) through the final success `return new Response(... Convite enviado para ...)` (~line 354) with a single delegation that maps routes to the existing messages:

```ts
    const redirectBase = Deno.env.get('OAUTH_REDIRECT_BASE') || 'http://localhost:5173';
    let outcome;
    try {
      // addOnboarded: true — the CRM "invite" action adds an onboarded person
      // (existing behavior). The admin resend passes false. 'already-onboarded'
      // is therefore unreachable here.
      outcome = await inviteOrResend(adminClient, {
        contaId: profile.conta_id,
        email: email.toLowerCase(),
        role,
        invitedBy: user.id,
        redirectBase,
      }, { addOnboarded: true });
    } catch (err: any) {
      if (err?.message === 'generate_link_failed') {
        throw new Error('Não foi possível gerar o link de acesso.');
      }
      throw err;
    }

    switch (outcome.route) {
      case 'plan-limit-exceeded':
        return new Response(
          JSON.stringify({ error: 'plan_limit_exceeded', resource: 'max_team_members' }),
          { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
        );
      case 'blocked-anomalous':
        throw new Error(
          'Conta com e-mail confirmado mas sem perfil. Não foi possível reenviar o convite automaticamente — contate o suporte.',
        );
      case 'already-member':
        return new Response(JSON.stringify({ error: 'Este usuário já pertence a este workspace.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      case 'added':
        return new Response(JSON.stringify({ success: true, message: `${email} foi adicionado ao workspace como ${role}.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
        });
      case 'resent-link':
        return new Response(JSON.stringify({ success: true, message: `Novo link de acesso enviado para ${email}.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
        });
      case 'reinvited':
      case 'invited':
      default:
        return new Response(JSON.stringify({ success: true, message: `Convite enviado para ${email} como ${role}.` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
        });
    }
```

> Note: the old `add-direct` path returned "foi adicionado ao workspace como ${role}" only when a NEW membership was inserted and 400 "já pertence" when already a member — the mapping above preserves both. The DELETE handler and `deleteUnconfirmedInvitedUser` above it are unchanged.

- [ ] **Step 3: Confirm the DELETE branch is intact**

Visually confirm the DELETE branch, the local `findAuthUserByEmail`, and `deleteUnconfirmedInvitedUser` are unchanged by this task. They must remain — only the POST body and its four imports changed.

- [ ] **Step 4: Typecheck the function (deno check)**

Run: `deno check --node-modules-dir=auto --config supabase/functions/deno.json supabase/functions/invite-user/index.ts`
Expected: no errors. This is the gate that catches a deleted import still being referenced (a missing-symbol type error) — `npm run test:functions` runs with `--no-check` and would not.

- [ ] **Step 5: Run the full edge test suite (regression net)**

Run: `npm run test:functions`
Expected: PASS — including the pre-existing `invite-user-onboarding_test.ts` and `invite-user-pending_test.ts`, which prove the classifier and new-user helper still behave.

- [ ] **Step 6: Commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/invite-user/index.ts
git commit -m "refactor: invite-user POST delegates to shared inviteOrResend"
```

---

## Task 7: Add get-workspace-invites action to platform-admin

Read the workspace's invites (newest 50 + total count), enriched with `silent_add`, `link_expired`, and batched `auth_state`.

**Files:**
- Create: `supabase/functions/platform-admin/invites-enrich.ts` (pure flag logic)
- Create: `supabase/functions/platform-admin/invite-handlers.ts` (handlers, kept out of `index.ts` so they're testable without booting `Deno.serve`)
- Modify: `supabase/functions/platform-admin/index.ts` (import + dispatch case)
- Create: `supabase/functions/__tests__/platform-admin-invites_test.ts`

**Interfaces:**
- Consumes: `getAuthStatesByEmails` from `_shared/invite-actions.ts`.
- Produces: handler `handleGetWorkspaceInvites(svc, body, headers)` in `invite-handlers.ts`; response `{ invites: EnrichedInvite[]; total: number }` where
  `EnrichedInvite = { id, email, role, status, created_at, accepted_at, expires_at, invited_by, silent_add: boolean, link_expired: boolean, auth_state: (AuthState & { is_member: boolean }) | null }`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/platform-admin-invites_test.ts`:

```ts
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
```

> The pure flag logic lives in a small `invites-enrich.ts` so it is unit-testable without a live DB (mirrors how `plan-mutations.ts` splits out testable logic).

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:functions`
Expected: FAIL ("Module not found" for `invites-enrich.ts`).

- [ ] **Step 3: Create the pure flag module**

Create `supabase/functions/platform-admin/invites-enrich.ts`:

```ts
export interface InviteFlagInput {
  status: string;
  created_at: string;
  accepted_at: string | null;
}

const SILENT_ADD_WINDOW_MS = 2_000;
const LINK_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * silent_add: an accepted invite whose accepted_at is within 2s of created_at
 *   is the add-direct signature (member added, NO email sent).
 * link_expired: a pending invite older than 24h, measured from the invite's OWN
 *   created_at — NOT the auth user's confirmation_sent_at, which is user-global
 *   and would be refreshed by a later invite from another workspace, making an
 *   old invite look freshly sent (plan-review finding 6). An invite's link is
 *   minted when its row is created, so created_at is the correct per-invite basis.
 */
export function computeInviteFlags(
  invite: InviteFlagInput,
  now: number = Date.now(),
): { silent_add: boolean; link_expired: boolean } {
  const silent_add = invite.status === "accepted" && invite.accepted_at != null &&
    Math.abs(new Date(invite.accepted_at).getTime() - new Date(invite.created_at).getTime()) < SILENT_ADD_WINDOW_MS;
  const link_expired = invite.status === "pending" &&
    (now - new Date(invite.created_at).getTime()) > LINK_TTL_MS;
  return { silent_add, link_expired };
}
```

- [ ] **Step 4: Run the pure test to verify pass**

Run: `npm run test:functions`
Expected: PASS.

- [ ] **Step 5: Add the handler (own module) + dispatch case**

The handlers live in a **separate module** `platform-admin/invite-handlers.ts` — NOT inline in `index.ts` — so the Task 8 DI tests can import them without executing `index.ts`'s top-level `Deno.serve` (this is exactly why `plan-mutations.ts` is its own file). Create `supabase/functions/platform-admin/invite-handlers.ts` with (value import of `createClient` so `ReturnType<typeof createClient>` resolves, matching `index.ts`'s handler signatures):

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAuthStatesByEmails } from "../_shared/invite-actions.ts";
import { computeInviteFlags } from "./invites-enrich.ts";

export async function handleGetWorkspaceInvites(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string },
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { count } = await svc.from("invites")
    .select("*", { count: "exact", head: true }).eq("conta_id", body.workspace_id);
  const { data: rows, error } = await svc.from("invites")
    .select("id, email, role, status, created_at, accepted_at, expires_at, invited_by")
    .eq("conta_id", body.workspace_id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  const invites = rows ?? [];
  const states = await getAuthStatesByEmails(svc, invites.map((r) => r.email));

  // Which of these users are members of THIS workspace?
  const userIds = [...states.values()].map((s) => s.user_id);
  const memberIds = new Set<string>();
  if (userIds.length) {
    const { data: members } = await svc.from("workspace_members")
      .select("user_id").eq("workspace_id", body.workspace_id).in("user_id", userIds);
    for (const m of members ?? []) memberIds.add(m.user_id);
  }

  const enriched = invites.map((r) => {
    const auth = states.get(r.email.toLowerCase()) ?? null;
    const flags = computeInviteFlags(r); // link_expired from the invite's own created_at
    return {
      ...r,
      silent_add: flags.silent_add,
      link_expired: flags.link_expired,
      auth_state: auth ? { ...auth, is_member: memberIds.has(auth.user_id) } : null,
    };
  });

  return new Response(JSON.stringify({ invites: enriched, total: count ?? enriched.length }), { status: 200, headers });
}
```

Then wire it into `supabase/functions/platform-admin/index.ts` — add the import near the top:

```ts
import { handleGetWorkspaceInvites } from "./invite-handlers.ts";
```

and the dispatch case in the `switch (action)` block (next to the other workspace reads):

```ts
      case "get-workspace-invites":
        return await handleGetWorkspaceInvites(svc, body, headers);
```

- [ ] **Step 6: Typecheck**

Run: `deno check --node-modules-dir=auto --config supabase/functions/deno.json supabase/functions/platform-admin/index.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/platform-admin/index.ts supabase/functions/platform-admin/invite-handlers.ts supabase/functions/platform-admin/invites-enrich.ts supabase/functions/__tests__/platform-admin-invites_test.ts
git commit -m "feat: add get-workspace-invites admin action with enrichment"
```

---

## Task 8: Add admin-cancel-invite + admin-resend-invite actions

The two mutating actions, audit-logged. Cancel (and the resend→reinvite route) writes one audit row per affected workspace sharing an `operation_id` (finding 5); resend records the route and never adds a member (finding 1).

**Files:**
- Modify: `supabase/functions/platform-admin/invite-handlers.ts` (two handlers, created in Task 7)
- Modify: `supabase/functions/platform-admin/invites-enrich.ts` (`validateResendTarget`, `resendMessage`)
- Modify: `supabase/functions/platform-admin/index.ts` (imports + dispatch cases)
- Modify: `supabase/functions/__tests__/platform-admin-invites_test.ts` (pure mapping + DI handler tests)

**Interfaces:**
- Consumes: `cancelInvite`, `inviteOrResend` from `_shared/invite-actions.ts`; `insertAuditLog` from `_shared/audit.ts`.
- Produces: `resendMessage(route): { status: number; body: Record<string, unknown> }` (pure mapping, exported for test) and handlers `handleAdminCancelInvite`, `handleAdminResendInvite`.

- [ ] **Step 1: Write the failing test for the pure route→response mapping**

Append to `supabase/functions/__tests__/platform-admin-invites_test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:functions`
Expected: FAIL ("resendMessage is not exported").

- [ ] **Step 3: Add resendMessage to invites-enrich.ts**

Append to `supabase/functions/platform-admin/invites-enrich.ts`:

```ts
import type { InviteRoute } from "../_shared/invite-actions.ts";

/**
 * Pre-flight for admin-resend-invite: reject a missing/wrong-workspace invite
 * (404) or an already-accepted one (400). Returns null when the invite may be
 * resent. Pure so the guard is unit-tested without a live DB.
 */
export function validateResendTarget(
  invite: { status: string } | null,
): { status: number; error: string } | null {
  if (!invite) return { status: 404, error: "Invite not found" };
  if (invite.status === "accepted") return { status: 400, error: "Cannot resend an accepted invite" };
  return null;
}

/** Map an inviteOrResend route to an admin-facing HTTP status + JSON body. */
export function resendMessage(route: InviteRoute): { status: number; body: Record<string, unknown> } {
  switch (route) {
    case "plan-limit-exceeded":
      return { status: 403, body: { error: "plan_limit_exceeded", resource: "max_team_members" } };
    case "blocked-anomalous":
      return { status: 409, body: { error: "Account has a confirmed email but no profile — resolve manually." } };
    case "already-onboarded":
      // Admin resend never adds a member (finding 1) — report and leave the invite.
      return { status: 200, body: { success: true, route, message: "This person already has an account and was NOT added to the workspace. The pending invite was left in place." } };
    case "already-member":
      return { status: 200, body: { success: true, route, message: "User is already a member of this workspace." } };
    case "resent-link":
      return { status: 200, body: { success: true, route, message: "A fresh set-password link was emailed." } };
    case "added": // only reachable via the CRM path; admin uses addOnboarded:false
    case "reinvited":
    case "invited":
    default:
      return { status: 200, body: { success: true, route, message: "Invitation email sent." } };
  }
}
```

- [ ] **Step 4: Run the pure test to verify pass**

Run: `npm run test:functions`
Expected: PASS.

- [ ] **Step 5: Add the two handlers (same module) + dispatch cases**

Append the two handlers to `supabase/functions/platform-admin/invite-handlers.ts` (the module created in Task 7 — keeping them out of `index.ts` so the Step 6 DI tests import them without booting `Deno.serve`). Add these imports at the TOP of `invite-handlers.ts`:

```ts
import { cancelInvite, inviteOrResend } from "../_shared/invite-actions.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { resendMessage, validateResendTarget } from "./invites-enrich.ts";
```

In `index.ts`, extend the existing `./invite-handlers.ts` import and add dispatch cases:

```ts
import { handleGetWorkspaceInvites, handleAdminCancelInvite, handleAdminResendInvite } from "./invite-handlers.ts";
```
```ts
      case "admin-cancel-invite":
        return await handleAdminCancelInvite(svc, body, user.id, headers);
      case "admin-resend-invite":
        return await handleAdminResendInvite(svc, body, user.id, headers);
```

Append the handlers to `invite-handlers.ts`. `operation_id` is derived with `crypto.randomUUID()` (available in the Deno edge runtime):

```ts
export async function handleAdminCancelInvite(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string; invite_id?: string },
  adminUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id || !body.invite_id) {
    return new Response(JSON.stringify({ error: "workspace_id and invite_id are required" }), { status: 400, headers });
  }
  let result;
  try {
    result = await cancelInvite(svc, { inviteId: body.invite_id, contaId: body.workspace_id });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "invite_not_found") {
      return new Response(JSON.stringify({ error: "Invite not found" }), { status: 404, headers });
    }
    if (msg === "invite_not_cancellable") {
      return new Response(JSON.stringify({ error: "Only pending or expired invites can be cancelled" }), { status: 400, headers });
    }
    throw err;
  }

  const operationId = crypto.randomUUID();
  for (const wsId of result.affectedWorkspaceIds) {
    await insertAuditLog(svc, {
      action: "admin-cancel-invite",
      conta_id: wsId,
      actor_user_id: adminUserId,
      resource_type: "invite",
      resource_id: body.invite_id,
      metadata: { email: result.email, operation_id: operationId, deleted_user: result.deletedUser },
    });
  }

  return new Response(JSON.stringify({ success: true, deleted_user: result.deletedUser }), { status: 200, headers });
}

export async function handleAdminResendInvite(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string; invite_id?: string },
  adminUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id || !body.invite_id) {
    return new Response(JSON.stringify({ error: "workspace_id and invite_id are required" }), { status: 400, headers });
  }

  const { data: invite } = await svc.from("invites")
    .select("id, conta_id, email, role, status, invited_by")
    .eq("id", body.invite_id).eq("conta_id", body.workspace_id).maybeSingle();
  const invalid = validateResendTarget(invite);
  if (invalid) {
    return new Response(JSON.stringify({ error: invalid.error }), { status: invalid.status, headers });
  }
  // validateResendTarget returned null ⇒ invite is present and resendable.
  // Re-assert for the type-checker (it does not narrow through the helper).
  if (!invite) {
    return new Response(JSON.stringify({ error: "Invite not found" }), { status: 404, headers });
  }

  const redirectBase = Deno.env.get("OAUTH_REDIRECT_BASE") || "http://localhost:5173";
  const outcome = await inviteOrResend(svc, {
    contaId: invite.conta_id,
    email: invite.email,
    role: invite.role,
    invitedBy: invite.invited_by, // preserve the ORIGINAL inviter
    redirectBase,
  }, { addOnboarded: false }); // admin resend never adds a member (finding 1)

  const mapped = resendMessage(outcome.route);
  if (mapped.status < 300) {
    // The reinvited route may have deleted a never-confirmed user from other
    // workspaces — audit each affected workspace, sharing one operation_id
    // (finding 5, symmetric with cancel). Other routes affect only this one.
    const operationId = crypto.randomUUID();
    const workspaces = outcome.affectedWorkspaceIds?.length
      ? outcome.affectedWorkspaceIds
      : [body.workspace_id];
    for (const wsId of workspaces) {
      await insertAuditLog(svc, {
        action: "admin-resend-invite",
        conta_id: wsId,
        actor_user_id: adminUserId,
        resource_type: "invite",
        resource_id: body.invite_id,
        metadata: { email: invite.email, route: outcome.route, operation_id: operationId },
      });
    }
  }
  return new Response(JSON.stringify(mapped.body), { status: mapped.status, headers });
}
```

- [ ] **Step 6: Add DI handler tests (finding 7)**

Append to `supabase/functions/__tests__/platform-admin-invites_test.ts`. A fake service client drives `cancelInvite`'s internals and records `audit_log` inserts, so we exercise workspace scoping, error→HTTP mapping, and the audit fan-out — not just the pure helpers.

```ts
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
        select: () => api, eq: () => api, in: () => api, delete: () => api,
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
```

- [ ] **Step 7: Typecheck + full edge suite**

Run: `deno check --node-modules-dir=auto --config supabase/functions/deno.json supabase/functions/platform-admin/index.ts && npm run test:functions`
Expected: no type errors; all tests PASS.

- [ ] **Step 8: Commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/platform-admin/index.ts supabase/functions/platform-admin/invite-handlers.ts supabase/functions/platform-admin/invites-enrich.ts supabase/functions/__tests__/platform-admin-invites_test.ts
git commit -m "feat: add admin-cancel-invite and admin-resend-invite actions"
```

---

## Task 9: Add API client types + functions (admin app)

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (append near the OAuth-grant block, ~line 355)

**Interfaces:**
- Produces: `InviteAuthState`, `InviteInfo` types; `getWorkspaceInvites(workspace_id): Promise<{ invites: InviteInfo[]; total: number }>`, `adminCancelInvite(workspace_id, invite_id): Promise<{ success: boolean; deleted_user: boolean }>`, `adminResendInvite(workspace_id, invite_id): Promise<{ success?: boolean; route?: string; message?: string; error?: string }>`.

- [ ] **Step 1: Append the types and functions**

Add to `apps/admin/src/lib/api.ts`:

```ts
export interface InviteAuthState {
  user_id: string;
  email_confirmed: boolean;
  confirmation_sent_at: string | null;
  invited_at: string | null;
  last_sign_in_at: string | null;
  has_password: boolean | null;
  onboarding_complete: boolean;
  is_member: boolean;
}

export interface InviteInfo {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired';
  created_at: string;
  accepted_at: string | null;
  expires_at: string | null;
  invited_by: string;
  silent_add: boolean;
  link_expired: boolean;
  auth_state: InviteAuthState | null;
}

export function getWorkspaceInvites(workspace_id: string) {
  return adminApi<{ invites: InviteInfo[]; total: number }>('get-workspace-invites', { workspace_id });
}

export function adminCancelInvite(workspace_id: string, invite_id: string) {
  return adminApi<{ success: boolean; deleted_user: boolean }>('admin-cancel-invite', { workspace_id, invite_id });
}

export function adminResendInvite(workspace_id: string, invite_id: string) {
  return adminApi<{ success?: boolean; route?: string; message?: string }>('admin-resend-invite', { workspace_id, invite_id });
}
```

- [ ] **Step 2: Typecheck the admin app**

Run: `npm run build:admin`
Expected: build succeeds (tsc clean).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/lib/api.ts
git commit -m "feat: admin api client for workspace invites"
```

---

## Task 10: Pure derivation module for the invites card

The chip label (finding 4) and status tags as pure functions, unit-tested like `login-error.ts`.

**Files:**
- Create: `apps/admin/src/pages/workspace-invites.ts`
- Create: `apps/admin/src/pages/__tests__/workspace-invites.test.ts`

**Interfaces:**
- Consumes: `InviteInfo`, `InviteAuthState` from `../lib/api`.
- Produces: `authStateLabel(auth: InviteAuthState | null): string`; `statusTags(invite: InviteInfo): string[]`; `canActOnInvite(invite: InviteInfo): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/pages/__tests__/workspace-invites.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { authStateLabel, statusTags, canActOnInvite } from '../workspace-invites';
import type { InviteInfo, InviteAuthState } from '../../lib/api';

const auth = (o: Partial<InviteAuthState>): InviteAuthState => ({
  user_id: 'u1', email_confirmed: false, confirmation_sent_at: null, invited_at: null,
  last_sign_in_at: null, has_password: null, onboarding_complete: false, is_member: false, ...o,
});
const inv = (o: Partial<InviteInfo>): InviteInfo => ({
  id: 'i1', email: 'a@x.com', role: 'agent', status: 'pending', created_at: '2026-07-23T00:00:00Z',
  accepted_at: null, expires_at: null, invited_by: 'o1', silent_add: false, link_expired: false, auth_state: null, ...o,
});

describe('authStateLabel', () => {
  it('no account when there is no auth user', () => {
    expect(authStateLabel(null)).toBe('no account');
  });
  it('member of this workspace wins over everything', () => {
    expect(authStateLabel(auth({ is_member: true, has_password: true, onboarding_complete: true }))).toBe('member of this workspace');
  });
  it('onboarded when password + onboarding complete', () => {
    expect(authStateLabel(auth({ has_password: true, onboarding_complete: true }))).toBe('onboarded');
  });
  it('confirmed, no password', () => {
    expect(authStateLabel(auth({ email_confirmed: true, has_password: false }))).toBe('confirmed, no password');
  });
  it('email sent, never opened requires a recorded send (finding 4)', () => {
    expect(authStateLabel(auth({ confirmation_sent_at: '2026-07-23T00:00:00Z' }))).toBe('email sent, never opened');
  });
  it('account exists (no send recorded) when a user exists but no send is on file', () => {
    expect(authStateLabel(auth({ confirmation_sent_at: null }))).toBe('account exists (no send recorded)');
  });
});

describe('statusTags', () => {
  it('adds a silent-add tag', () => {
    expect(statusTags(inv({ status: 'accepted', silent_add: true }))).toContain('added silently — no email was sent');
  });
  it('adds a link-expired tag', () => {
    expect(statusTags(inv({ status: 'pending', link_expired: true }))).toContain('link expired');
  });
  it('a clean pending invite has no extra tags', () => {
    expect(statusTags(inv({ status: 'pending' }))).toEqual([]);
  });
});

describe('canActOnInvite', () => {
  it('allows actions on pending/expired only', () => {
    expect(canActOnInvite(inv({ status: 'pending' }))).toBe(true);
    expect(canActOnInvite(inv({ status: 'expired' }))).toBe(true);
    expect(canActOnInvite(inv({ status: 'accepted' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- workspace-invites`
Expected: FAIL ("Cannot find module '../workspace-invites'").

- [ ] **Step 3: Implement the module**

Create `apps/admin/src/pages/workspace-invites.ts`:

```ts
import type { InviteInfo, InviteAuthState } from '../lib/api';

/**
 * One plain-language chip per invited email, first match wins (escalating).
 * "email sent, never opened" requires a recorded confirmation_sent_at so a
 * pre-existing / imported auth user is not mislabeled (spec finding 4).
 */
export function authStateLabel(auth: InviteAuthState | null): string {
  if (!auth) return 'no account';
  if (auth.is_member) return 'member of this workspace';
  if (auth.has_password === true && auth.onboarding_complete) return 'onboarded';
  if (auth.email_confirmed && auth.has_password === false) return 'confirmed, no password';
  if (auth.confirmation_sent_at) return 'email sent, never opened';
  return 'account exists (no send recorded)';
}

export function statusTags(invite: InviteInfo): string[] {
  const tags: string[] = [];
  if (invite.silent_add) tags.push('added silently — no email was sent');
  if (invite.link_expired) tags.push('link expired');
  return tags;
}

export function canActOnInvite(invite: InviteInfo): boolean {
  return invite.status === 'pending' || invite.status === 'expired';
}
```

- [ ] **Step 4: Run the test to verify pass**

Run: `npm run test -- workspace-invites`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/workspace-invites.ts apps/admin/src/pages/__tests__/workspace-invites.test.ts
git commit -m "feat: pure derivation for the admin invites card"
```

---

## Task 11: WorkspaceInvitesCard component + wire into the page

**Files:**
- Create: `apps/admin/src/pages/WorkspaceInvitesCard.tsx`
- Create: `apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx`
- Modify: `apps/admin/src/pages/WorkspaceDetailPage.tsx` (import + render below Members)

**Interfaces:**
- Consumes: `getWorkspaceInvites`, `adminCancelInvite`, `adminResendInvite`, `InviteInfo` (api); `authStateLabel`, `statusTags`, `canActOnInvite` (workspace-invites).

- [ ] **Step 1: Write the failing RTL test**

Create `apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkspaceInvitesCard from '../WorkspaceInvitesCard';
import type { InviteInfo } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getWorkspaceInvites: vi.fn(),
  adminCancelInvite: vi.fn(),
  adminResendInvite: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { getWorkspaceInvites, adminCancelInvite, adminResendInvite } from '../../lib/api';

const inv = (o: Partial<InviteInfo>): InviteInfo => ({
  id: 'i1', email: 'a@x.com', role: 'agent', status: 'pending', created_at: '2026-07-23T00:00:00Z',
  accepted_at: null, expires_at: null, invited_by: 'o1', silent_add: false, link_expired: false, auth_state: null, ...o,
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceInvitesCard workspaceId="c1" />
    </QueryClientProvider>,
  );
}

describe('WorkspaceInvitesCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a silent-add invite with its diagnostic tag and no action buttons', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({
      invites: [inv({ status: 'accepted', silent_add: true, accepted_at: '2026-07-23T00:00:00Z' })],
      total: 1,
    });
    renderCard();
    expect(await screen.findByText(/added silently/i)).toBeTruthy();
    // accepted rows expose no Cancel/Resend
    expect(screen.queryByRole('button', { name: /resend/i })).toBeNull();
  });

  it('shows a desktop header (incl. Sent) and Resend + Cancel for a pending invite', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [inv({ status: 'pending' })], total: 1 });
    renderCard();
    expect(await screen.findByText('Sent')).toBeTruthy(); // header column (finding 8)
    expect(screen.getByRole('button', { name: /resend/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });

  it('renders the auth-state chip for an onboarded non-member', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({
      invites: [inv({ auth_state: { user_id: 'u1', email_confirmed: true, confirmation_sent_at: '2026-07-23T00:00:00Z', invited_at: null, last_sign_in_at: null, has_password: true, onboarding_complete: true, is_member: false } })],
      total: 1,
    });
    renderCard();
    expect(await screen.findByText('onboarded')).toBeTruthy();
  });

  it('notes truncation when total exceeds the shown rows', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [inv({})], total: 73 });
    renderCard();
    expect(await screen.findByText(/showing 1 of 73/i)).toBeTruthy();
  });

  it('resend calls the API and refetches on success', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [inv({ status: 'pending' })], total: 1 });
    (adminResendInvite as any).mockResolvedValue({ success: true, route: 'invited', message: 'Invitation email sent.' });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /resend/i }));
    await waitFor(() => expect(adminResendInvite).toHaveBeenCalledWith('c1', 'i1'));
    // refetch: getWorkspaceInvites called again after the mutation
    await waitFor(() => expect((getWorkspaceInvites as any).mock.calls.length).toBeGreaterThan(1));
  });

  it('cancel prompts the ALL-workspaces warning and only proceeds on confirm', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [inv({ status: 'pending' })], total: 1 });
    (adminCancelInvite as any).mockResolvedValue({ success: true, deleted_user: false });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/ALL workspaces/));
    expect(adminCancelInvite).not.toHaveBeenCalled(); // declined
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(adminCancelInvite).toHaveBeenCalledWith('c1', 'i1'));
    confirmSpy.mockRestore();
  });

  it('shows a retry control when the fetch fails', async () => {
    (getWorkspaceInvites as any).mockRejectedValue(new Error('boom'));
    renderCard();
    expect(await screen.findByText(/failed to load invites/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- WorkspaceInvitesCard`
Expected: FAIL ("Cannot find module '../WorkspaceInvitesCard'").

- [ ] **Step 3: Implement the component**

Create `apps/admin/src/pages/WorkspaceInvitesCard.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  getWorkspaceInvites,
  adminCancelInvite,
  adminResendInvite,
  type InviteInfo,
} from '../lib/api';
import { authStateLabel, statusTags, canActOnInvite } from './workspace-invites';

const CANCEL_WARNING =
  'This deletes the invite and, if the person never finished onboarding, deletes their account — removing them from ALL workspaces. Continue?';

export default function WorkspaceInvitesCard({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'workspace', workspaceId, 'invites'],
    queryFn: () => getWorkspaceInvites(workspaceId),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', workspaceId, 'invites'] });

  const resendMutation = useMutation({
    mutationFn: (inviteId: string) => adminResendInvite(workspaceId, inviteId),
    onMutate: (id) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (res) => { toast.success(res.message ?? 'Invitation sent.'); invalidate(); },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const cancelMutation = useMutation({
    mutationFn: (inviteId: string) => adminCancelInvite(workspaceId, inviteId),
    onMutate: (id) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (res) => {
      toast.success(res.deleted_user ? 'Invite cancelled and account removed.' : 'Invite cancelled.');
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const invites = data?.invites ?? [];
  const total = data?.total ?? invites.length;

  return (
    <div className="min-w-0 overflow-hidden bg-card border border-border rounded-2xl p-5 mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Invites ({total})</h2>
        {total > invites.length && (
          <span className="text-xs text-muted-foreground">showing {invites.length} of {total}</span>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <button onClick={() => refetch()} className="text-sm text-destructive hover:underline">
          Failed to load invites — retry
        </button>
      ) : invites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invites.</p>
      ) : (
        <>
          {/* Desktop header row (finding 8) */}
          <div className="hidden md:grid grid-cols-[2fr_0.7fr_1fr_1.1fr_1.6fr_1fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-2 border-b border-border">
            <span>Email</span><span>Role</span><span>Status</span><span>Sent</span><span>Auth state</span><span>Actions</span>
          </div>
          <div className="flex flex-col gap-2">
            {invites.map((it) => (
              <InviteRow
                key={it.id}
                invite={it}
                busy={busyId === it.id}
                onResend={() => resendMutation.mutate(it.id)}
                onCancel={() => { if (window.confirm(CANCEL_WARNING)) cancelMutation.mutate(it.id); }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatSent(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function InviteRow({ invite, busy, onResend, onCancel }: {
  invite: InviteInfo; busy: boolean; onResend: () => void; onCancel: () => void;
}) {
  const tags = statusTags(invite);
  const actable = canActOnInvite(invite);
  return (
    <div className="min-w-0 border-b border-border/50 py-2.5 md:grid md:grid-cols-[2fr_0.7fr_1fr_1.1fr_1.6fr_1fr] md:gap-2 md:items-center">
      <div className="min-w-0">
        <span className="block truncate text-sm">{invite.email}</span>
        {tags.map((t) => (
          <span key={t} className="mt-0.5 mr-1 inline-block text-[0.6rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-warning/10 text-warning">
            {t}
          </span>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{invite.role}</span>
      <span className="text-xs text-muted-foreground">{invite.status}</span>
      <span className="text-xs text-muted-foreground">{formatSent(invite.created_at)}</span>
      <span className="text-xs text-muted-foreground">{authStateLabel(invite.auth_state)}</span>
      <div className="flex shrink-0 gap-3">
        {actable && (
          <>
            <button onClick={onResend} disabled={busy}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-50">Resend</button>
            <button onClick={onCancel} disabled={busy}
              className="text-xs font-medium text-destructive hover:underline disabled:opacity-50">Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the RTL test to verify pass**

Run: `npm run test -- WorkspaceInvitesCard`
Expected: PASS.

- [ ] **Step 5: Wire the card into WorkspaceDetailPage**

In `apps/admin/src/pages/WorkspaceDetailPage.tsx`, add the import:

```ts
import WorkspaceInvitesCard from './WorkspaceInvitesCard';
```

Render it immediately after the Members card's closing `</div>`. Find the Members card (`<h2 ...>Members ({data.members.length})</h2>`) and place after its container div closes:

```tsx
      <WorkspaceInvitesCard workspaceId={id!} />
```

- [ ] **Step 6: Typecheck the admin app**

Run: `npm run build:admin`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/pages/WorkspaceInvitesCard.tsx apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx apps/admin/src/pages/WorkspaceDetailPage.tsx
git commit -m "feat: WorkspaceInvitesCard on the admin workspace detail page"
```

---

## Task 12: Full gates, browser verification, and deploy

**Files:** none (verification + deploy).

- [ ] **Step 1: Run every gate**

```bash
npm run test
npm run build:admin
npm run test:functions
npm run lint
npm run format:check
```

Expected: all green. `npm run test:functions` dirties the root `deno.lock`; restore only that file with `git checkout -- deno.lock` (never blanket-discard other changes).

- [ ] **Step 2: Browser-verify the panel against staging (or a local admin dev server)**

Start the admin app and open a workspace with a rich invite history. Confirm:
- Invites card renders below Members.
- A `silent_add` row shows the amber "added silently — no email was sent" tag and exposes no action buttons.
- A pending row shows Resend + Cancel; Cancel prompts the ALL-workspaces warning.
- The auth-state chip reads sensibly per row.

Use the preview/browser tools (`preview_start` name for the admin dev server, then `read_page`/`computer`), and capture a screenshot for the user.

- [ ] **Step 3: Deploy both edge functions together**

Both functions have `verify_jwt = false` in `config.toml` (they self-authenticate), so both deploy with `--no-verify-jwt`. Confirm the linked project ref first (`cat supabase/.temp/project-ref`, translate against prod `skjzpekeqefvlojenfsw` / staging `wlyzhyfondykzpsiqsce`), then:

```bash
npx supabase functions deploy invite-user --no-verify-jwt --use-api --project-ref <ref>
npx supabase functions deploy platform-admin --no-verify-jwt --use-api --project-ref <ref>
```

Expected: both deploy. Staleness check: `npx supabase functions list --project-ref <ref>` — the `_N` suffix on each `entrypoint_path` must equal its `version`.

- [ ] **Step 4: Post-deploy smoke test**

In the deployed admin portal, open the Araripe MKT workspace detail and confirm the two historical `silent_add` rows and the `iara41ia@gmail.com` typo invite (chip: "email sent, never opened") appear. Do NOT mutate anything during the smoke test.

- [ ] **Step 5: Final commit / push**

```bash
git push -u origin claude/invitation-emails-not-sending-ec79cb
```

Then open a PR summarizing the feature and linking the spec.

---

## Plan-review resolutions (round 2)

- **F1 (resend ≠ membership mgmt):** `inviteOrResend` takes `opts.addOnboarded`; admin resend passes `false` → onboarded non-member returns `already-onboarded`, no add (Task 5, 8).
- **F2 (ignored mutation errors):** every consequential Supabase write is `ensureOk`-checked; injected-error test (Task 5).
- **F3 (seat check rejects replacement):** pending count excludes a matching pending row via `.neq("email", email)`; at-limit resend test (Task 5).
- **F4 (failed anomalous resend destroyed invite):** classify-before-mutate; `deletePriorInvites` runs only inside the chosen route; blocked-anomalous test (Task 5).
- **F5 (unaudited reinvite cross-workspace delete):** `reinvite` returns `affectedWorkspaceIds`; resend handler fans out audit rows sharing an `operation_id` (Task 5, 8).
- **F6 (per-invite timestamp):** `computeInviteFlags` bases `link_expired` on the invite's own `created_at`, not the user-global `confirmation_sent_at` (Task 7).
- **F7 (untested handlers):** handlers moved to `invite-handlers.ts` (importable without `Deno.serve`); DI tests assert scoping/mapping/audit fan-out (Task 8).
- **F8 (card UI gaps):** Sent column + desktop header; RTL covers confirm copy, resend+refetch, cancel-confirm gating, retry (Task 11).
- **F9 (deploy flag):** both deploys use `--no-verify-jwt` (both are `verify_jwt=false` in config.toml) (Task 12).
- **F10 (test perms + lock):** `npm run test:functions` (not bare `deno test`); restore the **root** `deno.lock` (Global Constraints, all tasks).

## Self-Review Notes

- **Spec coverage:** shared extraction (Tasks 1–5); inviteOrResend unification (Tasks 5–6); three admin actions (Tasks 7–8); enrichment flags + total count, findings 4 & 6 (Tasks 7, 10); cross-workspace audit, finding 5 (Tasks 4, 8); seat enforcement, finding 3 (Task 5); accepted-guard, finding 1 (Tasks 4, 8); add-direct-adds-member, finding 2 (Task 5); UI card (Tasks 9–11); build:admin + scoped deno.lock, finding 7 (Global Constraints, Task 12).
- **Type consistency:** `InviteRoute` defined in Task 5, type-only imported into `invites-enrich.ts` in Task 8 (erased at runtime, so the pure test stays dependency-free); `AuthState` (backend) and `InviteAuthState` (frontend `api.ts`) field names match; `computeInviteFlags`/`resendMessage`/`validateResendTarget` names stable across Tasks 7–8; `InviteFlagInput` is a structural subset of the invite row passed in Task 7's handler.
- **Test boundary (honest):** unit tests cover every pure decision — classifier, `inviteOrResend` routing, `cancelInvite` guards, `computeInviteFlags`, `resendMessage`, `validateResendTarget`, and the frontend derivation. The thin handler HTTP wiring (`platform-admin` dispatch, audit-row fan-out) is proven by the Task 12 browser + post-deploy smoke checks rather than a heavyweight fake-svc integration test — the risky logic lives in the tested pure units.
- **Known limits stated:** newest-50 with a visible total instead of pagination; resend seat-check counts the pending row being replaced (preserved invite-user semantics, not a new behavior).
