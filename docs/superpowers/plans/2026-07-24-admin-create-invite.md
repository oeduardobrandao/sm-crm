# Admin-Created Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform admin send a brand-new workspace invite from the admin portal's existing Invites card.

**Architecture:** One new `platform-admin` action (`admin-create-invite`) that validates its input, confirms the workspace exists, then calls the existing shared `inviteOrResend` primitive with `addOnboarded: false` — the same call `admin-resend-invite` already makes, minus the invite-row lookup. The primitive gains one addition: it now returns the id of the `invites` row it created, so audit rows carry a real `resource_id`. Two adjacent silent-failure bugs in the write path are fixed alongside.

**Tech Stack:** Deno edge functions (Supabase), `supabase-js@2`, React 19 + TanStack Query + Vitest/RTL (admin app), Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-24-admin-create-invite-design.md`

## Global Constraints

Every task's requirements implicitly include this section. Exact values, copied from the spec:

- **Role allow-list:** `'admin'` or `'agent'` only. `'owner'` is rejected **server-side** with HTTP 400 and the exact error string `role must be admin or agent`. The UI must not render an Owner option at all.
- **`addOnboarded: false`** on every `inviteOrResend` call from the admin portal. An already-onboarded target is reported, never added.
- **`invitedBy`** = the platform admin's own `user.id` (the `adminUserId` argument), never the workspace owner's.
- **UUID pattern (exact):** `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
- **Email pattern (exact):** `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- **Exact error strings:** `workspace_id must be a valid uuid` (400), `Workspace not found` (404), `A valid email is required` (400), `role must be admin or agent` (400).
- **Exact copy — already-onboarded on create:** `This person already has an account and was NOT added to the workspace. No invite was created.`
- **Cross-workspace confirmation gate:** a `reinvite` whose measured impact reaches beyond the target workspace returns the route `needs-confirmation` **before any mutation** unless `opts.confirmCrossWorkspace === true`. Impact = the union of the user's `workspace_members` workspaces and other workspaces holding a `pending` invite for that email. `invite-user` (CRM) passes `confirmCrossWorkspace: true` so its behavior is unchanged; both admin actions pass the admin's explicit flag.
- **Exact error token for the gate:** `cross_workspace_confirmation_required`, HTTP 409, body also carrying `other_workspace_count` (a number).
- **Every Supabase read used to make a decision must inspect `{ error }`**, not just `data`. A failed query returning no rows must not be reported as "not found".
- **Pre-existing dirty files:** this worktree already has an unrelated modified `.superpowers/sdd/task-2-report.md` (git-ignored SDD scratch). "Clean tree" checks below are scoped to `supabase/ apps/ docs/` so that file never masks — or is mistaken for — a real change.
- **Audit action name:** `admin-create-invite`. One row per entry in `outcome.affectedWorkspaceIds` (falling back to `[workspaceId]`), all sharing one `operation_id`.
- **No new migrations.** Reuses the existing `invites` and `audit_log` tables.
- **Never** use wildcard `*` for CORS; never return raw error details to clients (project security rules — the handlers here return only fixed strings).
- **New UI buttons must not be named "Cancel"** — the invite rows already expose a Cancel button and the RTL suite queries it by accessible name. The dismiss control is named **Dismiss**.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/functions/_shared/audit.ts` | Modify: inspect the insert's returned `{ error }` | 1 |
| `supabase/functions/__tests__/audit_test.ts` | Create: audit logging tests | 1 |
| `supabase/functions/_shared/invite-actions.ts` | Modify: `inviteId` on `InviteOutcome`; rollback error check | 2 |
| `supabase/functions/_shared/invite-actions.ts` | Modify: split capture from delete; `needs-confirmation` gate | 3 |
| `supabase/functions/invite-user/index.ts` | Modify: pass `confirmCrossWorkspace: true` (CRM behavior unchanged) | 3 |
| `supabase/functions/__tests__/invite-actions_test.ts` | Modify: `inviteId` + rollback tests (T2), gate tests (T3) | 2, 3 |
| `supabase/functions/platform-admin/invites-enrich.ts` | Modify: `validateCreateInvite`, `createMessage`, `resendOutcomeMessage` | 4 |
| `supabase/functions/__tests__/platform-admin-invites_test.ts` | Modify: pure tests (T4), handler DI tests (T5) | 4, 5 |
| `supabase/functions/platform-admin/invite-handlers.ts` | Modify: add `handleAdminCreateInvite`; thread the confirm flag; fix resend's `resource_id` | 5 |
| `supabase/functions/platform-admin/index.ts` | Modify: one import + one `case` | 5 |
| `apps/admin/src/lib/api.ts` | Modify: attach the error body to thrown errors; add `adminCreateInvite`; confirm param on resend | 6 |
| `apps/admin/src/pages/WorkspaceInvitesCard.tsx` | Modify: "+ Invite" form + cross-workspace confirm on create and resend | 6 |
| `apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx` | Modify: form + confirmation tests | 6 |

---

### Task 1: Make audit-log write failures visible

**Why:** `supabase-js` resolves with `{ error }` instead of throwing, so `insertAuditLog`'s `try/catch` never fires and a failed audit write is completely silent today. This feature's support trail depends on those rows.

**Files:**
- Modify: `supabase/functions/_shared/audit.ts:13-18`
- Test: `supabase/functions/__tests__/audit_test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `insertAuditLog` keeps its exact signature — `(svc: { from: (table: string) => any }, entry: {...}) => Promise<void>`. Behavior change is logging only; it still never throws.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/audit_test.ts`:

```ts
// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import { insertAuditLog } from "../_shared/audit.ts";

/** Swap console.error for the duration of `fn`, returning what it captured. */
async function captureErrors(fn: () => Promise<void>): Promise<unknown[][]> {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return logged;
}

const ENTRY = { action: "admin-create-invite", resource_type: "invite" };

Deno.test("insertAuditLog logs a RETURNED { error } (supabase-js resolves, never throws)", async () => {
  const svc: any = { from: () => ({ insert: () => Promise.resolve({ error: { message: "boom" } }) }) };
  const logged = await captureErrors(() => insertAuditLog(svc, ENTRY));
  assertEquals(logged.length, 1);
  assert(String(logged[0][0]).includes("[audit]"), "expected the [audit] prefix");
});

Deno.test("insertAuditLog still swallows a THROWN error", async () => {
  const svc: any = { from: () => ({ insert: () => Promise.reject(new Error("network")) }) };
  const logged = await captureErrors(() => insertAuditLog(svc, ENTRY));
  assertEquals(logged.length, 1);
});

Deno.test("insertAuditLog is silent on success", async () => {
  const svc: any = { from: () => ({ insert: () => Promise.resolve({ error: null }) }) };
  const logged = await captureErrors(() => insertAuditLog(svc, ENTRY));
  assertEquals(logged.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npm run test:functions -- --filter "insertAuditLog"`
Expected: FAIL — `insertAuditLog logs a RETURNED { error }` reports `Values are not equal: 0 !== 1` (nothing is logged today). The other two PASS.

- [ ] **Step 3: Implement**

Replace the body of `insertAuditLog` in `supabase/functions/_shared/audit.ts` (keep the file's existing `// deno-lint-ignore-file no-explicit-any` header and the full signature above it unchanged):

```ts
): Promise<void> {
  try {
    const { error } = await svc.from('audit_log').insert(entry);
    // supabase-js RESOLVES with { error } rather than throwing, so the catch
    // below never sees a rejected insert — this check is what makes an audit
    // write failure visible at all.
    if (error) console.error('[audit] Failed to write audit log:', error);
  } catch (e) {
    // Audit log failure must never break the primary operation
    console.error('[audit] Failed to write audit log:', e);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions -- --filter "insertAuditLog"`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the existing suites that use insertAuditLog**

Run: `npm run test:functions -- --filter "handleAdminCancelInvite"`
Expected: PASS — the existing cancel fake's `insert` returns `Promise.resolve({ error: null })`, which destructures cleanly.

- [ ] **Step 6: Commit**

```bash
git diff --quiet -- deno.lock || git checkout -- deno.lock
git add supabase/functions/_shared/audit.ts supabase/functions/__tests__/audit_test.ts
git commit -m "fix(audit): surface audit-log write failures instead of swallowing them"
```

> `npm run test:functions` always dirties the root `deno.lock`, and that churn must never be committed. **Before starting Task 1, confirm the baseline:** run `git diff --quiet -- deno.lock; echo $?` — it must print `0`. If it prints `1`, `deno.lock` was already modified for some unrelated reason; stop and resolve that first, because the discard step below would destroy it. Every commit in this plan is preceded by that same guarded discard.

---

### Task 2: Return the created invite id from `inviteOrResend`

**Why:** Audit rows need a real `resource_id`. This also repairs an existing defect: `handleAdminResendInvite` audits `resource_id: body.invite_id`, but the resend path's `deletePriorInvites` has already **deleted** that row — today's resend audit rows point at an id that no longer exists.

**Files:**
- Modify: `supabase/functions/_shared/invite-actions.ts` — `InviteOutcome` (line 196), the `added` route (266-271), the `resent-link` route (286-290), the `reinvited`/`invited` returns (296-306), `sendNewUserInvite` (315-336)
- Test: `supabase/functions/__tests__/invite-actions_test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface InviteOutcome { route: InviteRoute; affectedWorkspaceIds?: string[]; inviteId?: string; }` — `inviteId` is present on the four routes that create an `invites` row (`added`, `resent-link`, `reinvited`, `invited`) and absent on the no-op routes (`already-member`, `already-onboarded`, `plan-limit-exceeded`, `blocked-anomalous`).
  - `sendNewUserInvite` becomes `Promise<string>` (returns the new invite id). It is module-private; only `inviteOrResend` calls it.

- [ ] **Step 1: Add two additive knobs to the test fake**

In `supabase/functions/__tests__/invite-actions_test.ts`, inside `makeInviteAdmin`'s options type (the object literal that currently ends with `failTable?: string;`), add two fields:

```ts
  failTable?: string;               // e.g. "workspace_members" -> insert/delete returns { error }
  failAuthInvite?: boolean;         // inviteUserByEmail returns { error } -> send throws
  failInviteDeleteById?: boolean;   // ONLY the rollback delete (.eq("id", ...)) returns { error }
  insertReturnsNoId?: boolean;      // insert resolves with NO error and NO row
```

Honor the third knob in `insert`'s `.select().single()` branch:

```ts
        insert: (row: any) => {
          events.push("ins:" + table + ":" + (row.status ?? ""));
          const err = opts.failTable === table ? failErr : null;
          const inserted = err || opts.insertReturnsNoId ? null : { id: "new-invite" };
          return { select: () => ({ single: () => Promise.resolve({ data: inserted, error: err }) }), then: (r: (x: any) => unknown) => Promise.resolve(r({ data: null, error: err })) };
        },
```

Then make three additive edits inside `makeInviteAdmin`. Existing tests set neither new knob, so their behavior is unchanged.

(a) `inviteUserByEmail` honors `failAuthInvite`:

```ts
        inviteUserByEmail: (_e: string, _o: any) => { events.push("authInvite"); return Promise.resolve({ error: opts.failAuthInvite ? failErr : null }); },
```

(b) inside `from(table)`, record which columns `.eq()` filtered on and whether the chain is a delete. Replace the `const neqFilters` line and the `eq` / `delete` entries:

```ts
      const neqFilters: Array<{ col: string; val: unknown }> = [];
      const eqCols: string[] = [];
      let isDelete = false;
```

```ts
        eq: (col?: string) => { if (col) eqCols.push(col); return api; },
```

```ts
        delete: () => { events.push("del:" + table); isDelete = true; return { ...api, _err: opts.failTable === table }; },
```

(c) in `then`, fail only the by-id delete when `failInviteDeleteById` is set. Insert this as the FIRST line of the `then` callback, before the `api._head` checks:

```ts
        then: (r: (x: any) => unknown) => {
          if (isDelete && table === "invites" && eqCols.includes("id") && opts.failInviteDeleteById) {
            return Promise.resolve(r({ data: null, error: failErr }));
          }
```

> `deletePriorInvites` filters on `email`/`conta_id`/`status` and never on `id`, so it is unaffected — only the rollback's `.eq("id", id)` matches.

- [ ] **Step 2: Write the failing tests**

Append to `supabase/functions/__tests__/invite-actions_test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:functions -- --filter "inviteOrResend"`
Expected: FAIL — the five new tests fail (`inviteId` is `undefined` on every route; the no-id test gets no throw; the rollback test finds no `cleanup failed` log). All pre-existing `inviteOrResend` tests still PASS.

- [ ] **Step 4: Add `inviteId` to the outcome type**

In `supabase/functions/_shared/invite-actions.ts`, replace line 196:

```ts
export interface InviteOutcome {
  route: InviteRoute;
  affectedWorkspaceIds?: string[];
  /** Id of the invites row this call created. Present on added / resent-link /
   * reinvited / invited; absent on the no-op routes. Callers audit it as
   * resource_id — conta_id + email is not unique across history. */
  inviteId?: string;
}
```

- [ ] **Step 5: Capture the id at all four creation sites**

(a) Add a helper immediately below `ensureOk` (after line 91). Checking `error` alone is not enough: an insert that resolves with no error *and* no row would silently drop the id and quietly break the contract that `inviteId` is always present on a creating route.

```ts
/** An insert's new row id, failing loudly rather than silently returning undefined. */
function insertedId(res: { data?: { id?: string } | null; error: unknown }, op: string): string {
  ensureOk(res.error, op);
  if (!res.data?.id) {
    console.error(`[invite-actions:${op}] insert reported no error but returned no id`);
    throw new Error(`invite_mutation_failed:${op}`);
  }
  return res.data.id;
}
```

(b) `added` route — replace the `iIns` block (currently lines 266-271):

```ts
      const iIns = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy,
        status: "accepted", accepted_at: new Date().toISOString(),
      }).select("id").single();
      return { route: "added", inviteId: insertedId(iIns, "invite_insert_accepted") };
```

(c) `resent-link` route — replace the `ins` block (currently lines 286-290):

```ts
      const ins = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy, status: "pending",
      }).select("id").single();
      return { route: "resent-link", inviteId: insertedId(ins, "invite_insert_pending") };
```

(d) `reinvited` route — replace the two lines that send and return (currently 299-300):

```ts
    const inviteId = await sendNewUserInvite(adminClient, input, email);
    return { route: "reinvited", affectedWorkspaceIds, inviteId };
```

(e) new-user route — replace lines 304-306:

```ts
  // (3) New user.
  await deletePriorInvites(adminClient, email, input.contaId);
  const inviteId = await sendNewUserInvite(adminClient, input, email);
  return { route: "invited", inviteId };
```

- [ ] **Step 6: Return the id from `sendNewUserInvite` and check the rollback's error**

Replace `sendNewUserInvite` (currently lines 315-336) in its entirety:

```ts
/** Returns the id of the pending invites row it created. */
async function sendNewUserInvite(adminClient: any, input: InviteOrResendInput, email: string): Promise<string> {
  return await sendPendingWorkspaceInvite({
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
    // Throw on a failed rollback so sendPendingWorkspaceInvite's catch actually
    // logs it — supabase-js RESOLVES with { error }, so ignoring it left a
    // phantom pending row with no trace anywhere.
    deletePendingInvite: async (id) => {
      const { error } = await adminClient.from("invites").delete().eq("id", id);
      if (error) throw error;
    },
  }, {
    contaId: input.contaId, email, role: input.role, invitedBy: input.invitedBy,
    redirectTo: input.redirectBase + "/configurar-senha",
  });
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:functions -- --filter "inviteOrResend"`
Expected: PASS — all pre-existing `inviteOrResend` tests plus the five new ones.

- [ ] **Step 8: Run the wider invite suites for regressions**

Run: `npm run test:functions -- --filter "invite"`
Expected: PASS — `invite-actions_test.ts`, `invite-user-onboarding_test.ts`, `invite-user-pending_test.ts`, `invite-user-seats_test.ts`, `invite-email_test.ts`, `manage-workspace-invite-contract_test.ts` all green.

- [ ] **Step 9: Commit**

```bash
git diff --quiet -- deno.lock || git checkout -- deno.lock
git add supabase/functions/_shared/invite-actions.ts supabase/functions/__tests__/invite-actions_test.ts
git commit -m "feat(invites): return the created invite id from inviteOrResend

Also throws on a failed rollback delete so the existing cleanup catch
actually logs it."
```

---

### Task 3: Gate the cross-workspace delete behind an explicit confirmation

**Why:** the `reinvite` route deletes a never-confirmed auth user **globally** — every
`workspace_members` row (`.eq("user_id", …)`, no workspace filter) plus the auth record, which also
kills the invite links of pending `invites` rows for that email in other workspaces. Verified who is
actually exposed: an already-accepted user is **never** at risk (route `add-direct` → the admin path
returns `already-onboarded` and mutates nothing), and an ordinary pending invitee has no
`workspace_members` row at all (the `handle_new_user` trigger's invited branch creates only a
`profiles` row). The real victim is a **self-signup who never confirmed** — the trigger's `ELSE`
branch gives them a workspace and an owner membership immediately — plus any workspace holding a
pending invite for the same address, whose link dies silently.

**Files:**
- Modify: `supabase/functions/_shared/invite-actions.ts` — `deleteOrphanedAuthUser` (102-116), `cancelInvite`'s call site (165-167), `InviteOrResendOpts` (188-192), `InviteRoute` (193-195), the reinvite branch (293-300)
- Modify: `supabase/functions/invite-user/index.ts` — pass `confirmCrossWorkspace: true`
- Test: `supabase/functions/__tests__/invite-actions_test.ts`

**Interfaces:**
- Consumes: `InviteOutcome` from Task 2.
- Produces:
  - `InviteRoute` gains `"needs-confirmation"`.
  - `InviteOrResendOpts` gains `confirmCrossWorkspace?: boolean`.
  - `captureOrphanImpact(adminClient, userId, email, contaId): Promise<{ memberWorkspaceIds: string[]; pendingWorkspaceIds: string[]; otherWorkspaceIds: string[] }>` — module-private. `otherWorkspaceIds` is the de-duplicated union minus `contaId`.
  - `deleteOrphanedAuthUser(adminClient, userId): Promise<void>` — deletes only; no capture, no return.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/invite-actions_test.ts`:

```ts
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
```

`cancelInvite` calls `captureOrphanImpact` too, and its query chain now includes `.neq(...)` — which
`makeCancelSvc` does not implement, so **the existing cancel tests would crash with a TypeError**
before they ever assert anything. Add it to that fake's `api` object beside the other filters:

```ts
        select: () => api, eq: () => api, neq: () => api, in: () => api, delete: () => api,
```

Its `then` already returns `{ data: null }` for `invites`, which `captureOrphanImpact` reads as "no
pending invites elsewhere" — so the existing cancel assertions keep their current expected values.

Add the new fake knob to `makeInviteAdmin`'s options type:

```ts
  otherPendingWorkspaceIds?: string[];  // pending invites for this email in OTHER workspaces
```

and serve it from the `invites` non-head read. In `then`, immediately after the existing
`api._head && table === "invites"` branch, add:

```ts
          if (table === "invites" && !isDelete) {
            return Promise.resolve(r({ data: (opts.otherPendingWorkspaceIds ?? []).map((w) => ({ conta_id: w })), error: null }));
          }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions -- --filter "inviteOrResend"`
Expected: FAIL — the three gating tests report `reinvited` instead of `needs-confirmation`; the union test reports `["c1","c2"]` (no `c3`). The other two PASS already (they assert existing behavior, and are here to pin it).

- [ ] **Step 3: Add the route and the opt**

In `supabase/functions/_shared/invite-actions.ts`, extend the union (line 193) and the opts (188-192):

```ts
export type InviteRoute =
  | "added" | "already-member" | "already-onboarded" | "resent-link" | "reinvited"
  | "invited" | "plan-limit-exceeded" | "blocked-anomalous" | "needs-confirmation";
```

```ts
export interface InviteOrResendOpts {
  /** true (CRM/invite-user): add-direct adds an onboarded non-member. false
   * (admin resend): report instead of adding — membership mgmt is out of scope. */
  addOnboarded: boolean;
  /** true = the caller holds an explicit human confirmation for a reinvite whose
   * blast radius reaches other workspaces. Omitted/false = refuse with
   * "needs-confirmation" before mutating anything. invite-user passes true so
   * the CRM's own invite button behaves exactly as it does today. */
  confirmCrossWorkspace?: boolean;
}
```

- [ ] **Step 4: Split capture from delete**

Replace `deleteOrphanedAuthUser` (currently lines 93-116) with a capture function plus a
delete-only function:

```ts
export interface OrphanImpact {
  /** Workspaces where this user holds a membership row — deleted with the user. */
  memberWorkspaceIds: string[];
  /** OTHER workspaces holding a pending invite for this email. The rows survive
   * (no FK on the email) but their links die with the auth user, leaving an
   * invite that looks pending and can never be redeemed. */
  pendingWorkspaceIds: string[];
  /** De-duplicated union, minus the workspace being acted on. */
  otherWorkspaceIds: string[];
}

/**
 * Everything deleting this orphan auth user would destroy or invalidate.
 * Measured BEFORE any mutation so a caller can refuse; measuring only
 * workspace_members would miss the dead-link half entirely, which is the more
 * common of the two (the invited-user trigger creates no membership row).
 */
async function captureOrphanImpact(
  adminClient: any,
  userId: string,
  email: string,
  contaId: string,
): Promise<OrphanImpact> {
  const { data: memberships, error: membershipsErr } = await adminClient
    .from("workspace_members").select("workspace_id").eq("user_id", userId);
  ensureOk(membershipsErr, "capture_memberships");
  const memberWorkspaceIds = [...new Set((memberships ?? []).map((m: any) => m.workspace_id))] as string[];

  const { data: pending, error: pendingErr } = await adminClient
    .from("invites").select("conta_id")
    .eq("email", email).eq("status", "pending").neq("conta_id", contaId);
  ensureOk(pendingErr, "capture_pending_invites");
  const pendingWorkspaceIds = [...new Set((pending ?? []).map((i: any) => i.conta_id))] as string[];

  const otherWorkspaceIds = [...new Set([...memberWorkspaceIds, ...pendingWorkspaceIds])]
    .filter((id) => id !== contaId);

  return { memberWorkspaceIds, pendingWorkspaceIds, otherWorkspaceIds };
}

/**
 * Delete the orphan's profile, ALL of their membership rows, and the auth
 * record — every mutation's { error } checked. Capture the impact FIRST via
 * captureOrphanImpact: once this runs there is nothing left to measure.
 */
async function deleteOrphanedAuthUser(adminClient: any, userId: string): Promise<void> {
  ensureOk((await adminClient.from("profiles").delete().eq("id", userId)).error, "profile_delete");
  ensureOk((await adminClient.from("workspace_members").delete().eq("user_id", userId)).error, "member_delete");
  ensureOk((await adminClient.auth.admin.deleteUser(userId)).error, "auth_user_delete");
}
```

- [ ] **Step 5: Update `cancelInvite`'s call site**

Cancel already carries its own explicit ALL-workspaces confirmation in the UI, so it is never gated —
it only needs the same two-step call. Replace lines 164-168:

```ts
    if (action === "reinvite" || action === "resend-link") {
      const impact = await captureOrphanImpact(adminClient, authUser.id, email, args.contaId);
      await deleteOrphanedAuthUser(adminClient, authUser.id);
      affectedWorkspaceIds = [...new Set([...impact.memberWorkspaceIds, ...impact.pendingWorkspaceIds])];
      deletedUser = true;
    }
```

- [ ] **Step 6: Gate the reinvite branch**

Replace the reinvite block (currently lines 293-300). The capture and the refusal both move **above**
`deletePriorInvites` so a refusal leaves the target workspace's own pending invite untouched:

```ts
    // reinvite: never-confirmed. Measure the blast radius BEFORE touching
    // anything — this route deletes the auth user globally, which drops every
    // membership they hold and kills the invite links of pending invites for
    // this email in other workspaces.
    const impact = await captureOrphanImpact(adminClient, existingUser.id, email, input.contaId);
    if (impact.otherWorkspaceIds.length > 0 && !opts.confirmCrossWorkspace) {
      return { route: "needs-confirmation", affectedWorkspaceIds: impact.otherWorkspaceIds };
    }
    await deletePriorInvites(adminClient, email, input.contaId);
    await deleteOrphanedAuthUser(adminClient, existingUser.id);
    const affectedWorkspaceIds = [...new Set([
      ...impact.memberWorkspaceIds, ...impact.pendingWorkspaceIds, input.contaId,
    ])];
    const inviteId = await sendNewUserInvite(adminClient, input, email);
    return { route: "reinvited", affectedWorkspaceIds, inviteId };
```

- [ ] **Step 7: Keep the CRM path unchanged**

In `supabase/functions/invite-user/index.ts`, find the POST handler's `inviteOrResend` call and add
the flag to its opts object:

```ts
  }, { addOnboarded: true, confirmCrossWorkspace: true });
```

Without this the CRM's own invite button would start returning `needs-confirmation`, a route its UI
cannot handle. Adding a confirmation flow to the CRM is a separate piece of work.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test:functions -- --filter "inviteOrResend"`
Expected: PASS — the five new tests plus every pre-existing one. Note the pre-existing
`reports affected workspaces (finding 5)` test uses `memberships: ["c1","c2"]` with `contaId` `"c1"`,
so it now hits the gate: update that test to pass `{ addOnboarded: false, confirmCrossWorkspace: true }`,
which is what an admin who confirmed would send.

- [ ] **Step 9: Run the wider invite suites**

Run: `npm run test:functions -- --filter "invite"`
Expected: PASS, including `invite-user-*` (the CRM path is behaviorally unchanged).

- [ ] **Step 10: Commit**

```bash
git diff --quiet -- deno.lock || git checkout -- deno.lock
git add supabase/functions/_shared/invite-actions.ts supabase/functions/invite-user/index.ts supabase/functions/__tests__/invite-actions_test.ts
git commit -m "feat(invites): require confirmation before a reinvite deletes across workspaces

Measures memberships AND other workspaces' pending invites before any
mutation; refuses with needs-confirmation unless the caller confirmed.
invite-user passes confirmCrossWorkspace: true, so CRM behavior is
unchanged."
```

---

### Task 4: Pure validation + create-specific response mapping

**Why:** Keep the branchy input checks and the copy decisions in pure functions so they are unit-tested without a live DB, matching how `validateResendTarget` / `resendMessage` already work in this file.

**Files:**
- Modify: `supabase/functions/platform-admin/invites-enrich.ts` (append; also extend the type import on line 1)
- Test: `supabase/functions/__tests__/platform-admin-invites_test.ts` (append)

**Interfaces:**
- Consumes: `InviteOutcome` from Task 2 (`{ route, affectedWorkspaceIds?, inviteId? }`) and the `"needs-confirmation"` route from Task 3.
- Produces:
  - `type CreateInviteValidation = { ok: false; status: number; error: string } | { ok: true; workspaceId: string; email: string; role: "admin" | "agent" }`
  - `validateCreateInvite(body: { workspace_id?: unknown; email?: unknown; role?: unknown }): CreateInviteValidation` — on `ok: true`, `email` is trimmed and lower-cased.
  - `createMessage(outcome: InviteOutcome): { status: number; body: Record<string, unknown> }`
  - `resendOutcomeMessage(outcome: InviteOutcome): { status: number; body: Record<string, unknown> }`

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/platform-admin-invites_test.ts`:

```ts
import { validateCreateInvite, createMessage, resendOutcomeMessage } from "../platform-admin/invites-enrich.ts";

const WS = "11111111-2222-3333-4444-555555555555";

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

Deno.test("validateCreateInvite: accepts admin/agent and normalises the email", () => {
  const r = validateCreateInvite({ workspace_id: WS.toUpperCase(), email: "  Iara41.AI@Gmail.com ", role: "admin" });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.email, "iara41.ai@gmail.com");
    assertEquals(r.role, "admin");
    assertEquals(r.workspaceId, WS.toUpperCase());
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions -- --filter "validateCreateInvite"`
Expected: FAIL at module load — `The requested module '../platform-admin/invites-enrich.ts' does not provide an export named 'validateCreateInvite'`.

- [ ] **Step 3: Implement**

In `supabase/functions/platform-admin/invites-enrich.ts`, widen the type import on line 1:

```ts
import type { InviteOutcome, InviteRoute } from "../_shared/invite-actions.ts";
```

Then append to the end of the file:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CreateInviteValidation =
  | { ok: false; status: number; error: string }
  | { ok: true; workspaceId: string; email: string; role: "admin" | "agent" };

/**
 * Validate + normalise an admin-create-invite body BEFORE any DB or auth work.
 * Pure, so every branch is unit-tested without a live DB.
 *
 * The email type check is load-bearing: a truthy non-string reached
 * `email.toLowerCase()` and threw a TypeError -> opaque 500. The shape check
 * earns its keep because findAuthUserByEmail pages through EVERY auth user
 * before concluding "not found", so junk input buys a full scan. It
 * deliberately does not try to catch typos — `iara41.ia@` and `iara41.ai@` are
 * both valid addresses, which is the whole reason this panel exists.
 */
export function validateCreateInvite(body: {
  workspace_id?: unknown;
  email?: unknown;
  role?: unknown;
}): CreateInviteValidation {
  const workspaceId = body.workspace_id;
  if (typeof workspaceId !== "string" || !UUID_RE.test(workspaceId)) {
    return { ok: false, status: 400, error: "workspace_id must be a valid uuid" };
  }
  const rawEmail = body.email;
  if (typeof rawEmail !== "string") {
    return { ok: false, status: 400, error: "A valid email is required" };
  }
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: "A valid email is required" };
  }
  const role = body.role;
  // 'owner' is rejected explicitly, not merely absent from the allow-list:
  // granting ownership of a customer's workspace is billing-adjacent and does
  // not belong in a support tool.
  if (role !== "admin" && role !== "agent") {
    return { ok: false, status: 400, error: "role must be admin or agent" };
  }
  return { ok: true, workspaceId, email, role };
}

/**
 * 409 payload when a reinvite would reach other workspaces and the caller has
 * not confirmed. Null for every other route. Shared by both admin actions —
 * create and resend hit the same destructive path through the same primitive.
 * `other_workspace_count` is machine-readable on purpose: the UI names it in
 * its confirmation prompt.
 */
function confirmationRequired(
  outcome: InviteOutcome,
): { status: number; body: Record<string, unknown> } | null {
  if (outcome.route !== "needs-confirmation") return null;
  const count = outcome.affectedWorkspaceIds?.length ?? 0;
  return {
    status: 409,
    body: {
      error: "cross_workspace_confirmation_required",
      route: outcome.route,
      other_workspace_count: count,
      message:
        `This email has an unconfirmed account tied to ${count} other workspace(s). Sending will delete that account — removing its memberships and killing its pending invite links there. Nothing has been changed yet.`,
    },
  };
}

/** Map an admin-RESEND outcome, gating first. */
export function resendOutcomeMessage(outcome: InviteOutcome): { status: number; body: Record<string, unknown> } {
  return confirmationRequired(outcome) ?? resendMessage(outcome.route);
}

/**
 * Map an admin-CREATE outcome to an HTTP status + body. Delegates to
 * resendMessage for every route whose copy is already route-accurate; overrides
 * only the gate and the one line that reads wrong for a create.
 */
export function createMessage(outcome: InviteOutcome): { status: number; body: Record<string, unknown> } {
  const gate = confirmationRequired(outcome);
  if (gate) return gate;

  if (outcome.route === "already-onboarded") {
    // resendMessage says "The pending invite was left in place" — for a create
    // there was no pending invite to leave.
    return {
      status: 200,
      body: {
        success: true,
        route: outcome.route,
        message:
          "This person already has an account and was NOT added to the workspace. No invite was created.",
      },
    };
  }

  return resendMessage(outcome.route);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions -- --filter "CreateInvite"` then `npm run test:functions -- --filter "createMessage"`
Expected: PASS (6 validation tests, 3 createMessage tests)

- [ ] **Step 5: Commit**

```bash
git diff --quiet -- deno.lock || git checkout -- deno.lock
git add supabase/functions/platform-admin/invites-enrich.ts supabase/functions/__tests__/platform-admin-invites_test.ts
git commit -m "feat(admin-invites): pure validation + create-specific response mapping"
```

---

### Task 5: The `admin-create-invite` handler and its dispatch

**Files:**
- Modify: `supabase/functions/platform-admin/invite-handlers.ts` — new handler + `resource_id` fix in `handleAdminResendInvite` (line 136)
- Modify: `supabase/functions/platform-admin/index.ts` — import (line 5) + `case` (after line 80)
- Test: `supabase/functions/__tests__/platform-admin-invites_test.ts` (append)

**Interfaces:**
- Consumes: `inviteOrResend` returning `{ route, affectedWorkspaceIds?, inviteId? }` (Task 2) with the `confirmCrossWorkspace` opt and `needs-confirmation` route (Task 3); `validateCreateInvite` / `createMessage` / `resendOutcomeMessage` (Task 4); `insertAuditLog(svc, entry)` (Task 1).
- Produces: `handleAdminCreateInvite(svc, body, adminUserId, headers): Promise<Response>` — same 4-argument shape as `handleAdminCancelInvite` / `handleAdminResendInvite`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/platform-admin-invites_test.ts`:

```ts
import { handleAdminCreateInvite } from "../platform-admin/invite-handlers.ts";

/**
 * Fake svc covering the whole create path: the workspaces existence check, the
 * seat RPC, the auth scan inside inviteOrResend, and the invites/audit_log
 * writes. `_audits()` and `_inserts()` expose what was written.
 */
function makeCreateSvc(opts: {
  workspaceExists?: boolean;
  workspaceLookupFails?: boolean;
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
        eq: () => api, neq: () => api, in: () => api,
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
          if (table === "invites") return Promise.resolve({ data: opts.invite ?? null, error: null });
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions -- --filter "handleAdminCreateInvite"`
Expected: FAIL at module load — `does not provide an export named 'handleAdminCreateInvite'`.

- [ ] **Step 3: Implement the handler**

In `supabase/functions/platform-admin/invite-handlers.ts`, widen the import on line 4 (`resendMessage`
is no longer used directly — `resendOutcomeMessage` wraps it):

```ts
import { computeInviteFlags, createMessage, resendOutcomeMessage, validateCreateInvite, validateResendTarget } from "./invites-enrich.ts";
```

Then append to the end of the file:

```ts
export async function handleAdminCreateInvite(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: unknown; email?: unknown; role?: unknown; confirm_cross_workspace?: unknown },
  adminUserId: string,
  headers: Record<string, string>,
) {
  const input = validateCreateInvite(body);
  if (!input.ok) {
    return new Response(JSON.stringify({ error: input.error }), { status: input.status, headers });
  }

  // Confirm the workspace exists BEFORE inviteOrResend: effective_plan_limit
  // returns 0 for an unknown workspace, which would surface as a misleading
  // "out of seats" 403 for a workspace that does not exist at all.
  //
  // Rethrow on error rather than falling through: a PostgREST/network failure
  // also yields no row, and reporting that as a confident "Workspace not found"
  // would send an admin chasing the wrong problem. Throwing lands on the
  // dispatcher's generic 500.
  const { data: workspace, error: workspaceError } = await svc.from("workspaces")
    .select("id").eq("id", input.workspaceId).maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace) {
    return new Response(JSON.stringify({ error: "Workspace not found" }), { status: 404, headers });
  }

  const redirectBase = Deno.env.get("OAUTH_REDIRECT_BASE") || "http://localhost:5173";
  const outcome = await inviteOrResend(svc, {
    contaId: input.workspaceId,
    email: input.email,
    role: input.role,
    invitedBy: adminUserId, // honest attribution: the admin who actually sent it
    redirectBase,
  }, {
    addOnboarded: false, // a support tool never silently grants membership
    // Only an explicit `true` counts — a missing or truthy-but-not-true value
    // must not be read as consent to delete another workspace's data.
    confirmCrossWorkspace: body.confirm_cross_workspace === true,
  });

  const mapped = createMessage(outcome);
  if (mapped.status < 300) {
    // reinvite may have deleted a never-confirmed user out of other workspaces —
    // audit each one, sharing a single operation_id (symmetric with cancel/resend).
    const operationId = crypto.randomUUID();
    const workspaces = outcome.affectedWorkspaceIds?.length
      ? outcome.affectedWorkspaceIds
      : [input.workspaceId];
    for (const wsId of workspaces) {
      await insertAuditLog(svc, {
        action: "admin-create-invite",
        conta_id: wsId,
        actor_user_id: adminUserId,
        resource_type: "invite",
        ...(outcome.inviteId ? { resource_id: outcome.inviteId } : {}),
        metadata: { email: input.email, role: input.role, route: outcome.route, operation_id: operationId },
      });
    }
  }
  return new Response(JSON.stringify(mapped.body), { status: mapped.status, headers });
}
```

- [ ] **Step 4: Gate the resend handler too, and fix its dangling `resource_id`**

Resend reaches the same destructive `reinvite` route through the same primitive, from the same panel,
so it takes the identical gate. In `handleAdminResendInvite`:

(a) widen its body type (line 91):

```ts
  body: { workspace_id?: string; invite_id?: string; confirm_cross_workspace?: unknown },
```

(b) pass the flag on the `inviteOrResend` call (replace line 119):

```ts
  }, {
    addOnboarded: false, // admin resend never adds a member (finding 1)
    confirmCrossWorkspace: body.confirm_cross_workspace === true,
  });
```

(c) map through the gating wrapper (replace line 121):

```ts
  const mapped = resendOutcomeMessage(outcome);
```

(d) audit the invite that actually exists (replace line 136):

```ts
        // The row body.invite_id pointed at was deleted by deletePriorInvites;
        // audit the row that actually exists now.
        resource_id: outcome.inviteId ?? body.invite_id,
```

- [ ] **Step 5: Wire the dispatch**

In `supabase/functions/platform-admin/index.ts`, replace the import on line 5:

```ts
import { handleGetWorkspaceInvites, handleAdminCancelInvite, handleAdminResendInvite, handleAdminCreateInvite } from "./invite-handlers.ts";
```

and add one `case` immediately after the `admin-resend-invite` case (line 80):

```ts
      case "admin-create-invite":
        return await handleAdminCreateInvite(svc, body, user.id, headers);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:functions -- --filter "handleAdmin"`
Expected: PASS — the 8 new tests plus the 4 pre-existing cancel/resend handler tests.

- [ ] **Step 7: Run the whole edge suite**

Run: `npm run test:functions`
Expected: PASS (~780 tests, 0 failures)

- [ ] **Step 8: Commit**

```bash
git diff --quiet -- deno.lock || git checkout -- deno.lock
git add supabase/functions/platform-admin/invite-handlers.ts supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-invites_test.ts
git commit -m "feat(admin-invites): add the admin-create-invite action

Also fixes admin-resend-invite auditing an invite id that
deletePriorInvites had already deleted."
```

---

### Task 6: Admin portal UI — "+ Invite" form

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (append after `adminResendInvite`, line 400)
- Modify: `apps/admin/src/pages/WorkspaceInvitesCard.tsx`
- Test: `apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx`

**Interfaces:**
- Consumes: the `admin-create-invite` action from Task 5, returning `{ success?: boolean; route?: string; message?: string }` on 2xx; on failure `{ error: string }`, and for the gate `{ error: 'cross_workspace_confirmation_required', other_workspace_count: number, message: string }` with HTTP 409.
- Produces:
  - `interface AdminApiError extends Error { body?: Record<string, unknown>; status?: number }`
  - `adminCreateInvite(workspace_id: string, email: string, role: 'admin' | 'agent', confirm_cross_workspace?: boolean)`
  - `adminResendInvite(workspace_id: string, invite_id: string, confirm_cross_workspace?: boolean)` — third parameter added, defaulted, so no other caller changes.

- [ ] **Step 1: Let thrown errors carry the response body**

`adminApi` currently keeps only `body.error` and discards everything else, so the 409's
`other_workspace_count` never reaches the component. Replace the error branch (lines 244-247):

```ts
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    const error = new Error(err.error || `API error: ${res.status}`) as AdminApiError;
    // Keep the whole payload: structured errors (e.g. the cross-workspace
    // confirmation gate) carry fields the caller needs, not just a message.
    error.body = err;
    error.status = res.status;
    throw error;
  }
```

and declare the type just above `adminApi` (after line 227's section comment):

```ts
export interface AdminApiError extends Error {
  body?: Record<string, unknown>;
  status?: number;
}
```

Purely additive — every existing `catch` still reads `.message` exactly as before.

- [ ] **Step 2: Add the API function and the resend confirm param**

In `apps/admin/src/lib/api.ts`, replace `adminResendInvite` (lines 395-400) and append the new
function:

```ts
export function adminResendInvite(
  workspace_id: string,
  invite_id: string,
  confirm_cross_workspace = false,
) {
  return adminApi<{ success?: boolean; route?: string; message?: string }>('admin-resend-invite', {
    workspace_id,
    invite_id,
    confirm_cross_workspace,
  });
}

export function adminCreateInvite(
  workspace_id: string,
  email: string,
  role: 'admin' | 'agent',
  confirm_cross_workspace = false,
) {
  return adminApi<{ success?: boolean; route?: string; message?: string }>('admin-create-invite', {
    workspace_id,
    email,
    role,
    confirm_cross_workspace,
  });
}
```

- [ ] **Step 3: Write the failing tests**

In `apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx`, add `adminCreateInvite` to BOTH the mock factory and the import — the factory replaces the whole module, so a missing key makes the component's import `undefined` at runtime:

```ts
vi.mock('../../lib/api', () => ({
  getWorkspaceInvites: vi.fn(),
  adminCancelInvite: vi.fn(),
  adminResendInvite: vi.fn(),
  adminCreateInvite: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import {
  getWorkspaceInvites,
  adminCancelInvite,
  adminResendInvite,
  adminCreateInvite,
} from '../../lib/api';
```

Then append these tests inside the existing `describe('WorkspaceInvitesCard', ...)` block:

```ts
  it('reveals the create form only after clicking + Invite', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    renderCard();
    expect(await screen.findByText(/no invites/i)).toBeTruthy();
    expect(screen.queryByLabelText(/email/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /\+ invite/i }));
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
  });

  it('offers Admin and Agent roles and NO Owner option in the DOM', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));

    const roleSelect = screen.getByLabelText(/role/i) as HTMLSelectElement;
    const values = Array.from(roleSelect.options).map((o) => o.value);
    expect(values).toEqual(['agent', 'admin']);
    expect(roleSelect.value).toBe('agent'); // defaults to the lower-privilege role
    expect(screen.queryByRole('option', { name: /owner/i })).toBeNull();
  });

  it('submits the typed values, toasts the returned message and refetches', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    (adminCreateInvite as any).mockResolvedValue({
      success: true,
      route: 'invited',
      message: 'Invitation email sent.',
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'iara41.ai@gmail.com' } });
    fireEvent.change(screen.getByLabelText(/role/i), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(adminCreateInvite).toHaveBeenCalledWith('c1', 'iara41.ai@gmail.com', 'admin', false),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invitation email sent.'));
    await waitFor(() => expect((getWorkspaceInvites as any).mock.calls.length).toBeGreaterThan(1));
  });

  it('closes and clears the form after a successful send', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    (adminCreateInvite as any).mockResolvedValue({ success: true, message: 'Invitation email sent.' });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(screen.queryByLabelText(/email/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /\+ invite/i }));
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('');
  });

  it('maps a seat-limit error to readable prose', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    (adminCreateInvite as any).mockRejectedValue(new Error('plan_limit_exceeded'));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/team-member limit/i)),
    );
  });

  it('disables Send while the create is in flight', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    let resolveCreate: (v: { success: boolean; message: string }) => void;
    (adminCreateInvite as any).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    const send = screen.getByRole('button', { name: /^send$/i });
    expect(send).not.toBeDisabled();

    fireEvent.click(send);
    await waitFor(() => expect(send).toBeDisabled());
    resolveCreate!({ success: true, message: 'Invitation email sent.' });
    await waitFor(() => expect(screen.queryByLabelText(/email/i)).toBeNull());
  });

  it('Dismiss closes the form without calling the API', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(adminCreateInvite).not.toHaveBeenCalled();
  });

  it('turns the cross-workspace 409 into a confirmation and retries with consent', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    const gate = Object.assign(new Error('cross_workspace_confirmation_required'), {
      body: {
        error: 'cross_workspace_confirmation_required',
        other_workspace_count: 2,
        message: 'This email has an unconfirmed account tied to 2 other workspace(s).',
      },
      status: 409,
    });
    (adminCreateInvite as any)
      .mockRejectedValueOnce(gate)
      .mockResolvedValueOnce({ success: true, message: 'Invitation email sent.' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/2 other workspace/)));
    // second attempt carries consent
    await waitFor(() =>
      expect(adminCreateInvite).toHaveBeenLastCalledWith('c1', 'a@x.com', 'agent', true),
    );
    // the gate is a question, not a failure — it must not surface as an error toast
    expect(toast.error).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('declining the cross-workspace confirmation sends nothing further', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    (adminCreateInvite as any).mockRejectedValue(
      Object.assign(new Error('cross_workspace_confirmation_required'), {
        body: { error: 'cross_workspace_confirmation_required', other_workspace_count: 1 },
        status: 409,
      }),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect((adminCreateInvite as any).mock.calls.length).toBe(1); // no retry
    expect(toast.error).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('Resend gates on the same 409 and retries with consent', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [inv({ status: 'pending' })], total: 1 });
    (adminResendInvite as any)
      .mockRejectedValueOnce(
        Object.assign(new Error('cross_workspace_confirmation_required'), {
          body: { error: 'cross_workspace_confirmation_required', other_workspace_count: 3 },
          status: 409,
        }),
      )
      .mockResolvedValueOnce({ success: true, message: 'Invitation email sent.' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /resend/i }));
    await waitFor(() => expect(adminResendInvite).toHaveBeenCalledWith('c1', 'i1', false));
    await waitFor(() => expect(adminResendInvite).toHaveBeenLastCalledWith('c1', 'i1', true));
    confirmSpy.mockRestore();
  });

  it('Dismiss resets the role back to the lower-privilege default', async () => {
    // Picking Admin, dismissing, then reopening must NOT leave the form primed
    // to invite the next person as an admin.
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/role/i), { target: { value: 'admin' } });
    expect((screen.getByLabelText(/role/i) as HTMLSelectElement).value).toBe('admin');

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    fireEvent.click(screen.getByRole('button', { name: /\+ invite/i }));
    expect((screen.getByLabelText(/role/i) as HTMLSelectElement).value).toBe('agent');
  });
```

The `toast` assertions need the mocked module in scope — add this import beside the others at the top of the file:

```ts
import { toast } from 'sonner';
```

Two pre-existing tests now see the extra `adminResendInvite` argument. Update both:

- `resend calls the API and refetches on success` — `toHaveBeenCalledWith('c1', 'i1')` becomes `toHaveBeenCalledWith('c1', 'i1', false)`.
- `disables Resend and Cancel while a resend is in flight` — unchanged assertions, but its `mockReturnValue` promise is now resolved by a mutation called with an object payload; no edit needed as long as it does not assert on arguments. Verify it still passes rather than assuming.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm run test -- WorkspaceInvitesCard`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /\+ invite/i` on each new test. The 8 pre-existing tests still PASS.

- [ ] **Step 5: Implement the form**

In `apps/admin/src/pages/WorkspaceInvitesCard.tsx`:

(a) widen the API import (lines 4-9):

```tsx
import {
  getWorkspaceInvites,
  adminCancelInvite,
  adminResendInvite,
  adminCreateInvite,
  type AdminApiError,
  type InviteInfo,
} from '../lib/api';
```

(b) add form state beside the existing `busyId` state (after line 20):

```tsx
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'agent'>('agent');
```

and, immediately after them, one close routine used by EVERY close path so the
form can never reopen pre-set to the higher-privilege role:

```tsx
  const closeForm = () => {
    setFormOpen(false);
    setEmail('');
    setRole('agent');
  };
```

(c) add the mutation after `cancelMutation` (after line 55):

```tsx
  const createMutation = useMutation({
    mutationFn: (confirmCrossWorkspace: boolean) =>
      adminCreateInvite(workspaceId, email.trim(), role, confirmCrossWorkspace),
    onSuccess: (res) => {
      toast.success(res.message ?? 'Invitation sent.');
      closeForm();
      invalidate();
    },
    onError: (e: unknown) => {
      if (confirmedCrossWorkspace(e, () => createMutation.mutate(true))) return;
      const message = (e as Error).message;
      toast.error(message === 'plan_limit_exceeded' ? SEAT_LIMIT_MESSAGE : message);
    },
  });
```

and change `resendMutation`'s `mutationFn`/`onError` to take the same two-step path (replace lines
31 and 38-41):

```tsx
    mutationFn: ({ inviteId, confirm }: { inviteId: string; confirm: boolean }) =>
      adminResendInvite(workspaceId, inviteId, confirm),
    onMutate: ({ inviteId }) => setBusyId(inviteId),
```

```tsx
    onError: (e: unknown, vars) => {
      if (confirmedCrossWorkspace(e, () => resendMutation.mutate({ inviteId: vars.inviteId, confirm: true }))) return;
      const message = (e as Error).message;
      toast.error(message === 'plan_limit_exceeded' ? SEAT_LIMIT_MESSAGE : message);
    },
```

with its call site updated to `resendMutation.mutate({ inviteId: it.id, confirm: false })`.

(c) add the shared gate handler above the component, beside the other message constants:

```tsx
/**
 * A 409 from the cross-workspace gate is a question, not a failure: nothing has
 * been mutated yet. Ask, and on a yes re-run the same request with consent.
 * Returns true when it handled the error.
 */
function confirmedCrossWorkspace(e: unknown, retry: () => void): boolean {
  const body = (e as AdminApiError).body as
    | { error?: string; other_workspace_count?: number; message?: string }
    | undefined;
  if (body?.error !== 'cross_workspace_confirmation_required') return false;
  const count = body.other_workspace_count ?? 0;
  const warning =
    `${body.message ?? ''}\n\nThis will remove that account from ${count} other workspace(s) and break their pending invite links. Continue?`.trim();
  if (window.confirm(warning)) retry();
  return true;
}
```

(d) add the "+ Invite" control to the header. Replace the header block (lines 62-69):

```tsx
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold">Invites ({total})</h2>
        <div className="flex items-center gap-3">
          {total > invites.length && (
            <span className="text-xs text-muted-foreground">
              showing {invites.length} of {total}
            </span>
          )}
          <button
            onClick={() => setFormOpen((open) => !open)}
            className="text-xs font-medium text-primary hover:underline"
          >
            + Invite
          </button>
        </div>
      </div>

      {formOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(false); // unconfirmed; the gate may ask
          }}
          className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          <input
            aria-label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            className="min-w-0 flex-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm font-sf text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <select
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'agent')}
            className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm font-sf text-foreground focus:outline-none focus:border-primary transition-colors"
          >
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            Send
          </button>
          <button
            type="button"
            onClick={closeForm}
            className="text-xs font-medium text-muted-foreground hover:underline"
          >
            Dismiss
          </button>
        </form>
      )}
```

> The form sits **outside** the loading/error/empty conditional below it, so an admin can still send an invite when the list is empty or failed to load. The dismiss control is named **Dismiss**, not Cancel — the invite rows already own that accessible name. The input/select/button classes mirror the existing invite form in `apps/admin/src/pages/AdminsPage.tsx:48-64` so the control looks native to the portal.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -- WorkspaceInvitesCard`
Expected: PASS (19 passed — 8 pre-existing + 11 new)

- [ ] **Step 7: Typecheck, lint and format**

```bash
npm run build:admin && npm run lint && npm run format:check
```
Expected: all three exit 0. If `format:check` fails, run `npm run format` and re-run it.

> `npm run build` typechecks **CRM only** (`tsc -p apps/crm/tsconfig.json`). Every change in this task is in `apps/admin`, which that command never reads — `build:admin` is the one that would actually catch a type error here. CI typechecks all three apps separately.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/lib/api.ts apps/admin/src/pages/WorkspaceInvitesCard.tsx apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx
git commit -m "feat(admin-invites): send a new invite from the workspace invites card"
```

---

### Task 7: Full gates, browser verification, and deploy

**Files:** none modified (verification only, plus any fixes the gates surface).

- [ ] **Step 1: Run every CI gate**

These mirror `.github/workflows/ci.yml` exactly — the typecheck job runs `tsc` for CRM, Hub, Admin **and** scripts separately, so `npm run build` alone (CRM only) would let an Admin type error reach CI:

```bash
npm run lint && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json
```

```bash
npm run format:check && npm run test:coverage && npm run coverage:check && npm run test:functions
```
Expected: every command exits 0. `coverage:check` enforces a coverage floor — new untested branches fail it.

- [ ] **Step 2: Restore deno.lock and confirm a clean tree**

```bash
git diff --quiet -- deno.lock || git checkout -- deno.lock
git status --short -- supabase apps docs
```
Expected: **no output.** `test:functions` always dirties the root `deno.lock`; that churn must never be committed. The status check is scoped to `supabase apps docs` because this worktree carries an unrelated modified `.superpowers/sdd/task-2-report.md` that would otherwise make a genuinely clean tree look dirty.

- [ ] **Step 3: Verify in the browser**

Start the admin dev server against staging and open a workspace detail page:

```bash
npm run dev:admin:staging
```

Then, in the Browser pane: navigate to the admin app, sign in, open any workspace, scroll to the Invites card, click **+ Invite**, and confirm the form renders with an email field, a role select showing only Agent/Admin, Send and Dismiss. Check `read_console_messages` for errors. Do **not** submit against staging until Step 5 has deployed the backend there — the action does not exist yet and would 400 with `Unknown action`.

- [ ] **Step 4: Confirm the CLI is pointed at the right project**

```bash
cat supabase/.temp/project-ref
```
Translate the ref before acting: PROD = `skjzpekeqefvlojenfsw`, STAGING = `wlyzhyfondykzpsiqsce`. Never assume the link state — pass `--project-ref` explicitly on every command below.

- [ ] **Step 5: Deploy to staging, from THIS worktree**

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && npx supabase functions deploy platform-admin --no-verify-jwt --use-api --project-ref wlyzhyfondykzpsiqsce
```

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && npx supabase functions deploy invite-user --no-verify-jwt --use-api --project-ref wlyzhyfondykzpsiqsce
```

> `--use-api` bundles from the **shell's current working directory**, not from any git-branch-aware location. Deploying from the main checkout silently ships that tree's code while still reporting success and incrementing the version. Both functions must go out together: `invite-user` also imports the changed `_shared/invite-actions.ts`.

- [ ] **Step 6: Verify the deploy by CONTENT, not metadata**

`functions download` **overwrites** the local files at that path with whatever the server is actually serving. That is what makes it a real check — but only if there is nothing uncommitted to lose first. Confirm that, then download:

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && git status --short -- supabase && npx supabase functions download platform-admin --project-ref wlyzhyfondykzpsiqsce
```
The `git status` must print nothing before the download runs. If it prints anything, stop and commit or stash it — the download would destroy it.

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && grep -c "admin-create-invite" supabase/functions/platform-admin/index.ts supabase/functions/platform-admin/invite-handlers.ts && git diff --stat -- supabase/functions/platform-admin
```
Expected: non-zero counts for both files, and an **empty** `git diff --stat` — the served bundle is byte-identical to this branch. A non-empty diff means the live code differs from what you committed: read the diff before concluding anything, since it distinguishes a wrong-source-tree deploy from a harmless CLI formatting difference.

Version numbers and entrypoint suffixes are **not** content-aware and pass even on a wrong-source-tree deploy — that is exactly how the previous branch shipped stale code to prod twice while every check reported green.

- [ ] **Step 7: Live-test on staging**

Reload the admin app (still on `npm run dev:admin:staging`), open a workspace, click **+ Invite**, send to an address you control, and confirm: the toast shows the returned message, the new row appears in the list after the refetch, and the email arrives. Then re-submit the same address to confirm the upsert path replaces the pending row rather than erroring.

- [ ] **Step 8: Get explicit approval before touching prod**

Stop and ask. Prod deploys are outward-facing and this one runs from an unmerged branch — do not proceed on the strength of the plan alone. Report: staging is verified, what the two functions change, and that the backend must land **before** the merge (below) rather than after.

- [ ] **Step 9: Deploy to prod, backend FIRST**

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && npx supabase functions deploy platform-admin --no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw
```

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && npx supabase functions deploy invite-user --no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw
```

> **Order matters.** Merging first would let Vercel ship the "+ Invite" button to prod while `admin-create-invite` does not yet exist there — every click would 400 with `Unknown action`. Deploying the backend first is inert: the new action exists but nothing calls it until the UI lands.

- [ ] **Step 10: Verify prod by content**

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && git status --short -- supabase && npx supabase functions download platform-admin --project-ref skjzpekeqefvlojenfsw
```
`git status` must print nothing before the download runs.

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && grep -c "admin-create-invite" supabase/functions/platform-admin/invite-handlers.ts && git diff --stat -- supabase/functions/platform-admin
```
Expected: non-zero count, empty diff.

- [ ] **Step 11: Ship the frontend — finish and merge the branch**

The Admin UI reaches prod only via Vercel, which builds from `main`. Until this merges, prod has the backend action and no way to call it.

```bash
git diff --quiet -- deno.lock || git checkout -- deno.lock
git status --short -- supabase apps docs
```
Expected: no output. Then use `superpowers:finishing-a-development-branch` to push the branch, open the PR, get CI green, and merge.

- [ ] **Step 12: Verify the prod Admin build**

After the merge, confirm the Vercel deployment for `main` succeeded and that the built Admin bundle includes the new control: open the prod admin portal, load a workspace, and check that **+ Invite** renders. Then send one real invite end-to-end to an address you control and confirm the email arrives — this is the first time the full prod path (prod UI → prod function) has ever run.
