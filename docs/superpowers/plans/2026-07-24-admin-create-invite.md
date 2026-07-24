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
- **Exact copy — cross-workspace disclosure (appended to the reinvited message, space-separated):** `Note: this email had an unconfirmed account that was also pending in N other workspace(s); that account was replaced.` where `N` = `affectedWorkspaceIds.length - 1`. Appended only when `affectedWorkspaceIds.length > 1`.
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
| `supabase/functions/__tests__/invite-actions_test.ts` | Modify: `inviteId` + rollback tests, two new fake knobs | 2 |
| `supabase/functions/platform-admin/invites-enrich.ts` | Modify: add pure `validateCreateInvite` + `createMessage` | 3 |
| `supabase/functions/__tests__/platform-admin-invites_test.ts` | Modify: pure tests (T3), handler DI tests (T4) | 3, 4 |
| `supabase/functions/platform-admin/invite-handlers.ts` | Modify: add `handleAdminCreateInvite`; fix resend's `resource_id` | 4 |
| `supabase/functions/platform-admin/index.ts` | Modify: one import + one `case` | 4 |
| `apps/admin/src/lib/api.ts` | Modify: add `adminCreateInvite` | 5 |
| `apps/admin/src/pages/WorkspaceInvitesCard.tsx` | Modify: "+ Invite" control + inline form | 5 |
| `apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx` | Modify: form tests | 5 |

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
git checkout -- deno.lock
git add supabase/functions/_shared/audit.ts supabase/functions/__tests__/audit_test.ts
git commit -m "fix(audit): surface audit-log write failures instead of swallowing them"
```

> `npm run test:functions` always dirties the root `deno.lock`; `git checkout -- deno.lock` before every commit in this plan.

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
Expected: FAIL — the four new tests fail (`inviteId` is `undefined` on every route; the rollback test finds no `cleanup failed` log). All pre-existing `inviteOrResend` tests still PASS.

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

(a) `added` route — replace the `iIns` block (currently lines 266-271):

```ts
      const iIns = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy,
        status: "accepted", accepted_at: new Date().toISOString(),
      }).select("id").single();
      ensureOk(iIns.error, "invite_insert_accepted");
      return { route: "added", inviteId: iIns.data?.id };
```

(b) `resent-link` route — replace the `ins` block (currently lines 286-290):

```ts
      const ins = await adminClient.from("invites").insert({
        conta_id: input.contaId, email, role: input.role, invited_by: input.invitedBy, status: "pending",
      }).select("id").single();
      ensureOk(ins.error, "invite_insert_pending");
      return { route: "resent-link", inviteId: ins.data?.id };
```

(c) `reinvited` route — replace the two lines that send and return (currently 299-300):

```ts
    const inviteId = await sendNewUserInvite(adminClient, input, email);
    return { route: "reinvited", affectedWorkspaceIds, inviteId };
```

(d) new-user route — replace lines 304-306:

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
Expected: PASS — all pre-existing `inviteOrResend` tests plus the four new ones.

- [ ] **Step 8: Run the wider invite suites for regressions**

Run: `npm run test:functions -- --filter "invite"`
Expected: PASS — `invite-actions_test.ts`, `invite-user-onboarding_test.ts`, `invite-user-pending_test.ts`, `invite-user-seats_test.ts`, `invite-email_test.ts`, `manage-workspace-invite-contract_test.ts` all green.

- [ ] **Step 9: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/invite-actions.ts supabase/functions/__tests__/invite-actions_test.ts
git commit -m "feat(invites): return the created invite id from inviteOrResend

Also throws on a failed rollback delete so the existing cleanup catch
actually logs it."
```

---

### Task 3: Pure validation + create-specific response mapping

**Why:** Keep the branchy input checks and the copy decisions in pure functions so they are unit-tested without a live DB, matching how `validateResendTarget` / `resendMessage` already work in this file.

**Files:**
- Modify: `supabase/functions/platform-admin/invites-enrich.ts` (append; also extend the type import on line 1)
- Test: `supabase/functions/__tests__/platform-admin-invites_test.ts` (append)

**Interfaces:**
- Consumes: `InviteOutcome` from Task 2 (`{ route, affectedWorkspaceIds?, inviteId? }`).
- Produces:
  - `type CreateInviteValidation = { ok: false; status: number; error: string } | { ok: true; workspaceId: string; email: string; role: "admin" | "agent" }`
  - `validateCreateInvite(body: { workspace_id?: unknown; email?: unknown; role?: unknown }): CreateInviteValidation` — on `ok: true`, `email` is trimmed and lower-cased.
  - `createMessage(outcome: InviteOutcome): { status: number; body: Record<string, unknown> }`

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/platform-admin-invites_test.ts`:

```ts
import { validateCreateInvite, createMessage } from "../platform-admin/invites-enrich.ts";

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

Deno.test("createMessage: reinvited discloses cross-workspace impact only when there IS any", () => {
  const single = createMessage({ route: "reinvited", affectedWorkspaceIds: ["c1"], inviteId: "i9" });
  assertEquals(single.body.message, "Invitation email sent.");

  const multi = createMessage({ route: "reinvited", affectedWorkspaceIds: ["c1", "c2", "c3"], inviteId: "i9" });
  assertEquals(
    multi.body.message,
    "Invitation email sent. Note: this email had an unconfirmed account that was also pending in 2 other workspace(s); that account was replaced.",
  );
});

Deno.test("createMessage: delegates every other route to resendMessage", () => {
  assertEquals(createMessage({ route: "plan-limit-exceeded" }).status, 403);
  assertEquals(createMessage({ route: "blocked-anomalous" }).status, 409);
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
 * Map an admin-CREATE outcome to an HTTP status + body. Delegates to
 * resendMessage for every route whose copy is already route-accurate; overrides
 * only the two that read wrong for a create.
 */
export function createMessage(outcome: InviteOutcome): { status: number; body: Record<string, unknown> } {
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

  const mapped = resendMessage(outcome.route);

  // The reinvite route deletes a never-confirmed auth user GLOBALLY, which can
  // remove them from other workspaces. Disclose the blast radius rather than
  // leaving it silent (a preflight confirm would cost a second full listUsers
  // scan and still fire before the route is known).
  const affected = outcome.affectedWorkspaceIds?.length ?? 0;
  if (outcome.route === "reinvited" && affected > 1) {
    return {
      status: mapped.status,
      body: {
        ...mapped.body,
        message:
          `${mapped.body.message} Note: this email had an unconfirmed account that was also pending in ${affected - 1} other workspace(s); that account was replaced.`,
      },
    };
  }

  return mapped;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions -- --filter "CreateInvite"` then `npm run test:functions -- --filter "createMessage"`
Expected: PASS (6 validation tests, 3 createMessage tests)

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/platform-admin/invites-enrich.ts supabase/functions/__tests__/platform-admin-invites_test.ts
git commit -m "feat(admin-invites): pure validation + create-specific response mapping"
```

---

### Task 4: The `admin-create-invite` handler and its dispatch

**Files:**
- Modify: `supabase/functions/platform-admin/invite-handlers.ts` — new handler + `resource_id` fix in `handleAdminResendInvite` (line 136)
- Modify: `supabase/functions/platform-admin/index.ts` — import (line 5) + `case` (after line 80)
- Test: `supabase/functions/__tests__/platform-admin-invites_test.ts` (append)

**Interfaces:**
- Consumes: `inviteOrResend` returning `{ route, affectedWorkspaceIds?, inviteId? }` (Task 2); `validateCreateInvite` / `createMessage` (Task 3); `insertAuditLog(svc, entry)` (Task 1).
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
  limit?: number | null;
  members?: number;
  authUser?: { id: string; email_confirmed_at: string | null } | null;
  onboarding?: boolean;
  hasPassword?: boolean | null;
  memberships?: string[];
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
        eq: () => api, neq: () => api, in: () => api, delete: () => api,
        insert: (row: any) => {
          if (table === "audit_log") { audits.push(row); return Promise.resolve({ error: null }); }
          inserts.push({ table, row });
          return {
            select: () => ({ single: () => Promise.resolve({ data: { id: "created-invite" }, error: null }) }),
            then: (r: (x: any) => unknown) => Promise.resolve(r({ data: null, error: null })),
          };
        },
        maybeSingle: () => {
          if (table === "workspaces") return Promise.resolve({ data: opts.workspaceExists === false ? null : { id: "ws" }, error: null });
          if (table === "invites") return Promise.resolve({ data: opts.invite ?? null, error: null });
          if (table === "profiles") return Promise.resolve({ data: opts.onboarding === undefined ? null : { onboarding_complete: opts.onboarding, id: "u1" }, error: null });
          if (table === "contas") return Promise.resolve({ data: { nome: "WS" }, error: null });
          return Promise.resolve({ data: null, error: null }); // workspace_members: not a member
        },
        then: (r: (x: any) => unknown) => {
          if (api._head && table === "workspace_members") return Promise.resolve(r({ count: opts.members ?? 0, error: null }));
          if (api._head && table === "invites") return Promise.resolve(r({ count: 0, error: null }));
          if (table === "workspace_members") return Promise.resolve(r({ data: (opts.memberships ?? []).map((w) => ({ workspace_id: w })), error: null }));
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

Deno.test("handleAdminCreateInvite: reinvite discloses cross-workspace impact and audits each workspace", async () => {
  const svc = makeCreateSvc({
    authUser: { id: "u1", email_confirmed_at: null }, // never confirmed -> reinvite
    // WS is the target workspace, so affectedWorkspaceIds is exactly [WS, "c2"]
    // -> length 2 -> the disclosure reports 1 OTHER workspace.
    onboarding: false, hasPassword: false, memberships: [WS, "c2"], members: 1,
  });
  const res = await handleAdminCreateInvite(svc as any, OK_BODY, "admin1", H);
  assertEquals(res.status, 200);
  assert(String((await res.json()).message).includes("1 other workspace(s)"));

  const audits = svc._audits();
  assertEquals(audits.length, 2);
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

In `supabase/functions/platform-admin/invite-handlers.ts`, widen the import on line 4:

```ts
import { computeInviteFlags, createMessage, resendMessage, validateCreateInvite, validateResendTarget } from "./invites-enrich.ts";
```

Then append to the end of the file:

```ts
export async function handleAdminCreateInvite(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: unknown; email?: unknown; role?: unknown },
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
  const { data: workspace } = await svc.from("workspaces")
    .select("id").eq("id", input.workspaceId).maybeSingle();
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
  }, { addOnboarded: false }); // a support tool never silently grants membership

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

- [ ] **Step 4: Fix the resend handler's dangling `resource_id`**

In the same file, in `handleAdminResendInvite`, replace line 136:

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
git checkout -- deno.lock
git add supabase/functions/platform-admin/invite-handlers.ts supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-invites_test.ts
git commit -m "feat(admin-invites): add the admin-create-invite action

Also fixes admin-resend-invite auditing an invite id that
deletePriorInvites had already deleted."
```

---

### Task 5: Admin portal UI — "+ Invite" form

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (append after `adminResendInvite`, line 400)
- Modify: `apps/admin/src/pages/WorkspaceInvitesCard.tsx`
- Test: `apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx`

**Interfaces:**
- Consumes: the `admin-create-invite` action from Task 4, returning `{ success?: boolean; route?: string; message?: string }` on 2xx and `{ error: string }` on failure (`adminApi` throws `new Error(body.error)` for any non-2xx).
- Produces: `adminCreateInvite(workspace_id: string, email: string, role: 'admin' | 'agent')`.

- [ ] **Step 1: Add the API function**

In `apps/admin/src/lib/api.ts`, immediately after `adminResendInvite` (which ends on line 400):

```ts
export function adminCreateInvite(workspace_id: string, email: string, role: 'admin' | 'agent') {
  return adminApi<{ success?: boolean; route?: string; message?: string }>('admin-create-invite', {
    workspace_id,
    email,
    role,
  });
}
```

- [ ] **Step 2: Write the failing tests**

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
      expect(adminCreateInvite).toHaveBeenCalledWith('c1', 'iara41.ai@gmail.com', 'admin'),
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
```

The `toast` assertions need the mocked module in scope — add this import beside the others at the top of the file:

```ts
import { toast } from 'sonner';
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- WorkspaceInvitesCard`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /\+ invite/i` on each new test. The 8 pre-existing tests still PASS.

- [ ] **Step 4: Implement the form**

In `apps/admin/src/pages/WorkspaceInvitesCard.tsx`:

(a) widen the API import (lines 4-9):

```tsx
import {
  getWorkspaceInvites,
  adminCancelInvite,
  adminResendInvite,
  adminCreateInvite,
  type InviteInfo,
} from '../lib/api';
```

(b) add form state beside the existing `busyId` state (after line 20):

```tsx
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'agent'>('agent');
```

(c) add the mutation after `cancelMutation` (after line 55):

```tsx
  const createMutation = useMutation({
    mutationFn: () => adminCreateInvite(workspaceId, email.trim(), role),
    onSuccess: (res) => {
      toast.success(res.message ?? 'Invitation sent.');
      setFormOpen(false);
      setEmail('');
      setRole('agent');
      invalidate();
    },
    onError: (e: unknown) => {
      const message = (e as Error).message;
      toast.error(message === 'plan_limit_exceeded' ? SEAT_LIMIT_MESSAGE : message);
    },
  });
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
            createMutation.mutate();
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
            onClick={() => {
              setFormOpen(false);
              setEmail('');
            }}
            className="text-xs font-medium text-muted-foreground hover:underline"
          >
            Dismiss
          </button>
        </form>
      )}
```

> The form sits **outside** the loading/error/empty conditional below it, so an admin can still send an invite when the list is empty or failed to load. The dismiss control is named **Dismiss**, not Cancel — the invite rows already own that accessible name. The input/select/button classes mirror the existing invite form in `apps/admin/src/pages/AdminsPage.tsx:48-64` so the control looks native to the portal.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- WorkspaceInvitesCard`
Expected: PASS (15 passed — 8 pre-existing + 7 new)

- [ ] **Step 6: Typecheck, lint and format**

```bash
npm run build && npm run lint && npm run format:check
```
Expected: all three exit 0. If `format:check` fails, run `npm run format` and re-run it.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/lib/api.ts apps/admin/src/pages/WorkspaceInvitesCard.tsx apps/admin/src/pages/__tests__/WorkspaceInvitesCard.test.tsx
git commit -m "feat(admin-invites): send a new invite from the workspace invites card"
```

---

### Task 6: Full gates, browser verification, and deploy

**Files:** none modified (verification only, plus any fixes the gates surface).

- [ ] **Step 1: Run every CI gate**

```bash
npm run lint && npm run format:check && npm run test && npm run build && npm run test:functions
```
Expected: all five exit 0. CI enforces `lint`, `format:check`, the Vitest suite with a coverage ratchet, and the Deno edge suite — a failure here fails the build.

- [ ] **Step 2: Restore deno.lock**

```bash
git checkout -- deno.lock && git status --short
```
Expected: clean tree. `test:functions` always dirties the root `deno.lock`; that change must never be committed.

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

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && npx supabase functions download platform-admin --project-ref wlyzhyfondykzpsiqsce && grep -c "admin-create-invite" supabase/functions/platform-admin/index.ts supabase/functions/platform-admin/invite-handlers.ts
```
Expected: non-zero counts for both files. Version numbers and entrypoint suffixes are **not** content-aware and pass even on a wrong-source-tree deploy.

```bash
git status --short
```
Expected: clean. `functions download` overwrites local files at that path with the live server content — if anything shows as modified, the downloaded copy differs from the branch and the deploy did not ship this code.

- [ ] **Step 7: Live-test on staging**

Reload the admin app (still on `npm run dev:admin:staging`), open a workspace, click **+ Invite**, send to an address you control, and confirm: the toast shows the returned message, the new row appears in the list after the refetch, and the email arrives. Then re-submit the same address to confirm the upsert path replaces the pending row rather than erroring.

- [ ] **Step 8: Deploy to prod**

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && npx supabase functions deploy platform-admin --no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw
```

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && npx supabase functions deploy invite-user --no-verify-jwt --use-api --project-ref skjzpekeqefvlojenfsw
```

- [ ] **Step 9: Verify prod by content**

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/invitation-emails-not-sending-ec79cb && npx supabase functions download platform-admin --project-ref skjzpekeqefvlojenfsw && grep -c "admin-create-invite" supabase/functions/platform-admin/invite-handlers.ts && git status --short
```
Expected: non-zero count, clean tree.

- [ ] **Step 10: Commit any gate fixes**

```bash
git checkout -- deno.lock
git status --short
```
If the gates required changes, commit them; otherwise there is nothing to commit and the branch is ready for `superpowers:finishing-a-development-branch`.
