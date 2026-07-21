# Closing the `add-direct` Invite Trap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `invite-user` from silently adding a passwordless invitee to a workspace and mailing nothing, by making `auth.users.encrypted_password` — not the drift-prone `profiles.onboarding_complete` flag — the authority on whether someone can actually log in.

**Architecture:** A `SECURITY DEFINER` RPC exposes the one fact the Supabase admin API withholds (does this user have a password). `classifyExistingUser` gains an optional `hasPassword` input that can veto the silent `add-direct` branch but never blocks an invite when unknown. Both `invite-user` call sites consult the RPC; the CRM stops reporting a send that didn't happen.

**Tech Stack:** Deno edge functions (`npm:@supabase/supabase-js@2`), Postgres/Supabase migrations, React 19 + Vitest + Testing Library, `sonner` toasts.

## Global Constraints

- Migration filename prefix must be unique: use exactly `20260721000001`. Duplicate prefixes silently skip in `schema_migrations` and fail the `migration-version-guard` CI job.
- ESLint and Prettier are both CI gates. Run `npm run format`, `npm run lint`, and `npm run format:check` before pushing.
- Edge-function tests: `npm run test:functions`. This **always** dirties root `deno.lock` — run `git checkout -- deno.lock` afterward. Do not commit root `deno.lock`.
- Frontend tests: `npm run test`. Typecheck via `npm run build`.
- Edge deploys use `--use-api` (the local Docker bundler is broken). Prod project ref is `skjzpekeqefvlojenfsw`; staging is `wlyzhyfondykzpsiqsce`. Never assume the linked project — pass `--project-ref` explicitly.
- Never return raw error details to clients from edge functions.
- All user-facing UI copy is Portuguese (pt-BR).
- `supabase/tests/*.sql` are plain psql scripts (`begin; do $$ … assert … end $$; rollback;`), not wired into CI. They are run by hand against a database.

**Deployment state this plan starts from:** the two SQL statements in Task 1 were already applied by hand to **prod** on 2026-07-21. They are idempotent. Staging does not have them, and nothing is recorded in `supabase_migrations.schema_migrations`. Task 1 closes that gap; it does not introduce the change.

---

### Task 1: Record the migration and prove the RPC's contract

**Files:**
- Create: `supabase/migrations/20260721000001_invite_password_truth.sql`
- Create: `supabase/tests/user_has_password.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: SQL function `public.user_has_password(p_user_id uuid) RETURNS boolean` — `true` when the user has a non-empty password, `false` when it is `NULL` or `''`, and `NULL` when no such user exists. Executable by service role only.

- [ ] **Step 1: Write the database test**

Create `supabase/tests/user_has_password.sql`:

```sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  v_no_pw    uuid := gen_random_uuid();
  v_empty_pw uuid := gen_random_uuid();
  v_real_pw  uuid := gen_random_uuid();
begin
  insert into auth.users (id, encrypted_password) values (v_no_pw, null);
  insert into auth.users (id, encrypted_password) values (v_empty_pw, '');
  insert into auth.users (id, encrypted_password) values (v_real_pw, '$2a$10$C6UzMDM.H6dfI/f/IKcEe.');

  assert user_has_password(v_no_pw) = false, 'NULL password must read as false';
  assert user_has_password(v_empty_pw) = false, 'empty-string password must read as false';
  assert user_has_password(v_real_pw) = true, 'real hash must read as true';
  assert user_has_password(gen_random_uuid()) is null, 'unknown user must read as null';

  assert has_function_privilege('authenticated', 'public.user_has_password(uuid)', 'execute') = false,
    'authenticated must NOT be able to execute user_has_password';
  assert has_function_privilege('anon', 'public.user_has_password(uuid)', 'execute') = false,
    'anon must NOT be able to execute user_has_password';

  raise notice 'user_has_password: all cases passed';
end $$;
rollback;
```

The `NULL`-for-unknown-user case is load-bearing: it is what `coerceHasPassword` in Task 3 maps to "unknown", preserving current behavior rather than vetoing `add-direct`.

- [ ] **Step 2: Run the test against staging to verify it fails**

Paste the contents of `supabase/tests/user_has_password.sql` into the Supabase SQL editor for **staging** (`wlyzhyfondykzpsiqsce`), which does not yet have the function.

Expected: `ERROR: function user_has_password(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260721000001_invite_password_truth.sql`:

```sql
-- Make auth.users.encrypted_password the authority on "can this person log in",
-- instead of the drift-prone profiles.onboarding_complete flag.
--
-- The Supabase admin API does not expose encrypted_password, and last_sign_in_at
-- cannot substitute: clicking an invite link mints a session without any password
-- ever being set. invite-user needs a DB-side answer.
--
-- Applied by hand to PROD on 2026-07-21 (SQL editor) ahead of this file; both
-- statements are idempotent, so re-application is a no-op.

CREATE OR REPLACE FUNCTION public.user_has_password(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(u.encrypted_password, '') <> ''
  FROM auth.users u
  WHERE u.id = p_user_id;
$$;

-- "Does this address have a password" is an account-enumeration primitive.
-- Service role only.
--
-- PUBLIC is the one that matters: Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and every role inherits it. Revoking from anon/authenticated
-- alone leaves the function callable by any signed-in user. The named roles are
-- listed too so the intent survives a future default-privileges change.
REVOKE EXECUTE ON FUNCTION public.user_has_password(uuid) FROM PUBLIC, anon, authenticated;

-- One-time repair. 20260629000001 blanket-set onboarding_complete = true for every
-- pre-existing profile as a safety measure against the destructive reinvite branch;
-- that marked passwordless invitees as onboarded, pinning them to the silent
-- add-direct path forever. No date filter: "has no password" is itself the correct
-- discriminator, so this also catches rows corrupted by the healPendingInvite bug
-- (PR #175). Safe because login is password-only — no OAuth/OTP sign-in exists in
-- either app, so no legitimate user has an empty password.
UPDATE profiles p
SET onboarding_complete = false
FROM auth.users u
WHERE u.id = p.id
  AND p.onboarding_complete = true
  AND coalesce(u.encrypted_password, '') = '';
```

- [ ] **Step 4: Apply the migration to staging**

In the staging SQL editor, run the contents of the migration file.

Expected: `CREATE FUNCTION`, `REVOKE`, then `UPDATE <n>`.

- [ ] **Step 5: Run the test against staging to verify it passes**

Re-run `supabase/tests/user_has_password.sql` in the staging SQL editor.

Expected: `NOTICE: user_has_password: all cases passed`, then `ROLLBACK`.

- [ ] **Step 6: Register the migration as applied on prod**

Prod already has both statements but no history row, so `db push` would try to replay them. Recording the version keeps prod's history honest. In the **prod** SQL editor (`skjzpekeqefvlojenfsw`):

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20260721000001', 'invite_password_truth')
on conflict (version) do nothing;
```

Verify:

```sql
select version, name from supabase_migrations.schema_migrations
where version = '20260721000001';
```

Expected: one row.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260721000001_invite_password_truth.sql supabase/tests/user_has_password.sql
git commit -m "feat(invite): user_has_password RPC + repair mislabelled onboarding_complete"
```

---

### Task 2: Let `classifyExistingUser` veto `add-direct`

**Files:**
- Modify: `supabase/functions/invite-user/onboarding.ts`
- Test: `supabase/functions/__tests__/invite-user-onboarding_test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (the RPC is wired in Task 3).
- Produces: `classifyExistingUser(args: { emailConfirmed: boolean; hasProfile: boolean; onboardingComplete: boolean; hasPassword?: boolean | null }): InviteAction`. `hasPassword` is optional; `undefined`/`null` mean "unknown" and preserve today's behavior. Only the literal `false` vetoes `add-direct`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/invite-user-onboarding_test.ts`:

```ts
Deno.test("classifyExistingUser: onboarded flag does NOT win when the user has no password", () => {
  // The 2026-06-29 backfill marked passwordless invitees onboarding_complete=true.
  // Trusting it sent them down add-direct, which mails nothing.
  assertEquals(
    classifyExistingUser({
      emailConfirmed: true,
      hasProfile: true,
      onboardingComplete: true,
      hasPassword: false,
    }),
    "resend-link",
  );
});

Deno.test("classifyExistingUser: unknown password status preserves add-direct", () => {
  // RPC missing or failing must degrade to current behavior, never block invites.
  assertEquals(
    classifyExistingUser({
      emailConfirmed: true,
      hasProfile: true,
      onboardingComplete: true,
      hasPassword: null,
    }),
    "add-direct",
  );
});

Deno.test("classifyExistingUser: a real password confirms add-direct", () => {
  assertEquals(
    classifyExistingUser({
      emailConfirmed: true,
      hasProfile: true,
      onboardingComplete: true,
      hasPassword: true,
    }),
    "add-direct",
  );
});

Deno.test("classifyExistingUser: passwordless AND unconfirmed is still a destructive reinvite", () => {
  assertEquals(
    classifyExistingUser({
      emailConfirmed: false,
      hasProfile: true,
      onboardingComplete: true,
      hasPassword: false,
    }),
    "reinvite",
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:functions -- --filter "classifyExistingUser"
```

Expected: the three `hasPassword: false` / `null` cases fail — the first returns `"add-direct"` where `"resend-link"` is expected. Then:

```bash
git checkout -- deno.lock
```

- [ ] **Step 3: Implement the change**

In `supabase/functions/invite-user/onboarding.ts`, replace the signature and first branch.

Old:

```ts
export function classifyExistingUser(
  args: { emailConfirmed: boolean; hasProfile: boolean; onboardingComplete: boolean },
): InviteAction {
  if (args.onboardingComplete) return "add-direct";
```

New:

```ts
export function classifyExistingUser(
  args: {
    emailConfirmed: boolean;
    hasProfile: boolean;
    onboardingComplete: boolean;
    /**
     * Ground truth from auth.users.encrypted_password. `undefined`/`null` mean
     * "unknown" (RPC missing or failed) and preserve the flag-only behavior, so a
     * broken lookup degrades instead of blocking every invite. Only an explicit
     * `false` vetoes add-direct.
     */
    hasPassword?: boolean | null;
  },
): InviteAction {
  // onboarding_complete is not authoritative: the 20260629000001 backfill set it
  // true for every pre-existing profile, and the healPendingInvite bug (PR #175)
  // set it true for users who never set a password. Both pinned real people to
  // add-direct, which adds them to the workspace and mails nothing.
  if (args.onboardingComplete && args.hasPassword !== false) return "add-direct";
```

Also update the doc comment above the function: after the `- "add-direct"` bullet, add:

```
 * `hasPassword === false` overrides `onboardingComplete`: a user with no password
 * cannot log in, so they are routed to "resend-link" no matter what the flag says.
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:functions -- --filter "classifyExistingUser"
```

Expected: all ten cases pass (six pre-existing, four new). Then:

```bash
git checkout -- deno.lock
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/invite-user/onboarding.ts supabase/functions/__tests__/invite-user-onboarding_test.ts
git commit -m "fix(invite): no password vetoes the silent add-direct branch"
```

---

### Task 3: Wire the RPC into both `invite-user` call sites

**Files:**
- Modify: `supabase/functions/invite-user/onboarding.ts`
- Modify: `supabase/functions/invite-user/index.ts` (two call sites: `deleteUnconfirmedInvitedUser`, ~line 33; and the main invite path, ~line 172)
- Test: `supabase/functions/__tests__/invite-user-onboarding_test.ts`

**Interfaces:**
- Consumes: `user_has_password` from Task 1; `classifyExistingUser`'s `hasPassword` field from Task 2.
- Produces: `coerceHasPassword(data: unknown, error: unknown): boolean | null` exported from `onboarding.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/invite-user-onboarding_test.ts`, and add `coerceHasPassword` to the existing import from `../invite-user/onboarding.ts`:

```ts
Deno.test("coerceHasPassword: an RPC error is unknown, not 'no password'", () => {
  // Must not veto add-direct on a transport failure.
  assertEquals(coerceHasPassword(false, { message: "boom" }), null);
});

Deno.test("coerceHasPassword: booleans pass through", () => {
  assertEquals(coerceHasPassword(true, null), true);
  assertEquals(coerceHasPassword(false, null), false);
});

Deno.test("coerceHasPassword: a null row (unknown user) is unknown", () => {
  assertEquals(coerceHasPassword(null, null), null);
});

Deno.test("coerceHasPassword: a non-boolean payload is unknown", () => {
  assertEquals(coerceHasPassword("true", null), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:functions -- --filter "coerceHasPassword"
```

Expected: FAIL — `coerceHasPassword` is not exported. Then `git checkout -- deno.lock`.

- [ ] **Step 3: Implement the helper**

Append to `supabase/functions/invite-user/onboarding.ts`:

```ts
/**
 * Normalise a `user_has_password` RPC result into the tri-state
 * `classifyExistingUser` expects. Anything that is not an explicit boolean —
 * an error, a missing row, an unexpected payload — is "unknown", which
 * preserves the flag-only behavior rather than vetoing add-direct.
 */
export function coerceHasPassword(data: unknown, error: unknown): boolean | null {
  if (error) return null;
  return typeof data === "boolean" ? data : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:functions -- --filter "coerceHasPassword"
```

Expected: PASS. Then `git checkout -- deno.lock`.

- [ ] **Step 5: Wire the first call site**

In `supabase/functions/invite-user/index.ts`, update the import on line 4:

```ts
import { classifyExistingUser, coerceHasPassword } from "./onboarding.ts";
```

Then in `deleteUnconfirmedInvitedUser`, replace:

```ts
  const { data: profile } = await adminClient
    .from('profiles')
    .select('onboarding_complete')
    .eq('id', authUser.id)
    .maybeSingle();
  const action = classifyExistingUser({
    emailConfirmed: !!authUser.email_confirmed_at,
    hasProfile: !!profile,
    onboardingComplete: profile?.onboarding_complete === true,
  });
```

with:

```ts
  const { data: profile } = await adminClient
    .from('profiles')
    .select('onboarding_complete')
    .eq('id', authUser.id)
    .maybeSingle();
  const { data: pwData, error: pwError } = await adminClient
    .rpc('user_has_password', { p_user_id: authUser.id });
  const action = classifyExistingUser({
    emailConfirmed: !!authUser.email_confirmed_at,
    hasProfile: !!profile,
    onboardingComplete: profile?.onboarding_complete === true,
    hasPassword: coerceHasPassword(pwData, pwError),
  });
```

- [ ] **Step 6: Wire the second call site**

In the same file, in the main invite path, replace:

```ts
      const { data: existingOnboarding } = await adminClient
        .from('profiles')
        .select('onboarding_complete')
        .eq('id', existingUser.id)
        .maybeSingle();

      const action = classifyExistingUser({
        emailConfirmed: !!existingUser.email_confirmed_at,
        hasProfile: !!existingOnboarding,
        onboardingComplete: existingOnboarding?.onboarding_complete === true,
      });
```

with:

```ts
      const { data: existingOnboarding } = await adminClient
        .from('profiles')
        .select('onboarding_complete')
        .eq('id', existingUser.id)
        .maybeSingle();

      const { data: existingPw, error: existingPwError } = await adminClient
        .rpc('user_has_password', { p_user_id: existingUser.id });

      const action = classifyExistingUser({
        emailConfirmed: !!existingUser.email_confirmed_at,
        hasProfile: !!existingOnboarding,
        onboardingComplete: existingOnboarding?.onboarding_complete === true,
        hasPassword: coerceHasPassword(existingPw, existingPwError),
      });
```

- [ ] **Step 7: Run the full edge suite**

```bash
npm run test:functions
```

Expected: all tests pass, no regressions in `invite-user-pending_test.ts` or `workspace-invite-security_test.ts`. Then `git checkout -- deno.lock`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/invite-user/onboarding.ts supabase/functions/invite-user/index.ts supabase/functions/__tests__/invite-user-onboarding_test.ts
git commit -m "feat(invite): consult user_has_password at both classification sites"
```

---

### Task 4: Stop the CRM reporting a send that didn't happen

**Files:**
- Modify: `apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx` (~line 454)
- Test: `apps/crm/src/pages/configuracao/__tests__/inviteHelpers.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `inviteSuccessMessage(result: { message?: string }): string` exported from `ConfiguracaoPage.tsx`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/crm/src/pages/configuracao/__tests__/inviteHelpers.test.tsx`, adding `inviteSuccessMessage` to the existing import from `../ConfiguracaoPage`:

```tsx
describe('inviteSuccessMessage', () => {
  it("uses the server's message so add-direct isn't reported as a send", () => {
    expect(
      inviteSuccessMessage({ message: 'malu@example.com foi adicionado ao workspace como agent.' }),
    ).toBe('malu@example.com foi adicionado ao workspace como agent.');
  });

  it('falls back to a generic confirmation when the server sends no message', () => {
    expect(inviteSuccessMessage({})).toBe('Convite enviado!');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test -- inviteHelpers
```

Expected: FAIL — `inviteSuccessMessage` is not exported.

- [ ] **Step 3: Implement the helper and use it**

In `apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx`, add near the other exported helpers:

```tsx
/**
 * invite-user has three success shapes: an invite was mailed, a fresh
 * set-password link was mailed, or an existing user was added to the workspace
 * with no e-mail at all. Reporting all three as "Convite enviado!" hid the third
 * case from owners, who then assumed a mail was in flight.
 */
export function inviteSuccessMessage(result: { message?: string }): string {
  return result.message?.trim() || 'Convite enviado!';
}
```

Then replace the hardcoded toast:

```tsx
      toast.success('Convite enviado!');
```

with:

```tsx
      toast.success(inviteSuccessMessage(result));
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test -- inviteHelpers
```

Expected: PASS.

- [ ] **Step 5: Typecheck, lint and format**

```bash
npm run build && npm run lint && npm run format:check
```

Expected: all clean. If `format:check` fails, run `npm run format` and re-check.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx apps/crm/src/pages/configuracao/__tests__/inviteHelpers.test.tsx
git commit -m "fix(crm): surface the real invite result instead of always 'Convite enviado!'"
```

---

### Task 5: Deploy and verify on prod

**Files:** none (deployment only).

**Interfaces:**
- Consumes: everything from Tasks 1–4.

- [ ] **Step 1: Run the full suite one more time**

```bash
npm run test && npm run test:functions && npm run lint && npm run format:check
git checkout -- deno.lock
```

Expected: all green.

- [ ] **Step 2: Deploy `invite-user` to prod**

```bash
npx supabase functions deploy invite-user --use-api --project-ref skjzpekeqefvlojenfsw
```

Expected: `"message":"Deployed Functions."`. The RPC already exists on prod (Task 1), so the new code path is live immediately.

- [ ] **Step 3: Confirm the deployed version bumped**

```bash
npx supabase functions list --project-ref skjzpekeqefvlojenfsw 2>&1 | tr ',' '\n' | grep -A2 '"slug":"invite-user"'
```

Expected: `version` incremented from 69, and the `_N` suffix in `entrypoint_path` matches that version. A suffix lower than the version means a stale build is still being served.

- [ ] **Step 4: Verify end-to-end with a throwaway address**

In the CRM settings page, invite an address you control that has never existed in the system.

Expected: the toast reads `Convite enviado para <email> como agent.` (the server's message, not the old hardcoded string), a `pending` row appears in `invites`, and the set-password e-mail arrives.

- [ ] **Step 5: Verify the trap is closed**

Pick a repaired user (`onboarding_complete = false` with an empty password) and invite them:

```sql
select p.id, u.email from profiles p join auth.users u on u.id = p.id
where p.onboarding_complete = false and coalesce(u.encrypted_password,'') = ''
limit 5;
```

Expected: the toast reads `Novo link de acesso enviado para <email>.` — the `resend-link` branch — and a Resend e-mail from `convites@mesaas.com.br` arrives. It must **not** read `foi adicionado ao workspace`.

- [ ] **Step 6: Push to staging**

Apply `20260721000001_invite_password_truth.sql` to staging if Task 1 Step 4 was skipped, then:

```bash
npx supabase functions deploy invite-user --use-api --project-ref wlyzhyfondykzpsiqsce
```

---

## Notes for the implementer

**Do not "fix" the optional `hasPassword` into a required parameter.** Optionality is the degradation contract: if the RPC is missing or erroring, invites must keep working exactly as they do today rather than failing closed. It is also what keeps the six pre-existing `classifyExistingUser` tests valid without modification.

**Cancelling an invite now deletes these users.** `deleteUnconfirmedInvitedUser` deletes on `reinvite`/`resend-link`. A repaired passwordless user previously classified `add-direct` and was skipped. This is intended — cancel means "remove the invitee", and an account with no password has nothing to lose — but do not be surprised by it, and do not add a guard to "protect" them.

**Migration and function are independently safe to ship in either order**, by design. This plan's change was shaped by the 2026-07-21 outage, where a migration tightened a trigger's contract and the edge function that satisfied it was never redeployed, breaking every new-user invite in production. Do not introduce a hard dependency between the two halves.
