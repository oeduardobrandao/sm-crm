# Closing the `add-direct` invite trap

**Date:** 2026-07-21
**Status:** design approved; DB half already applied to prod by hand (see Deployment state)

## Problem

Inviting an existing user routes through `classifyExistingUser` in
`supabase/functions/invite-user/onboarding.ts`. When it returns `add-direct`,
`invite-user` adds the person to `workspace_members`, writes an `invites` row
already marked `status='accepted'`, and **sends no e-mail at all**.

That branch is correct only if the person genuinely has a working password. It
fires on a single signal, `profiles.onboarding_complete`, and that signal is not
trustworthy:

- Migration `20260629000001_invite_onboarding_complete.sql` line 26 ran a blanket
  `UPDATE profiles SET onboarding_complete = true WHERE onboarding_complete = false`.
  It was a deliberate safety measure — it stops the destructive `reinvite` branch
  from ever wiping a real account — but it marked every pre-2026-06-29 invitee as
  onboarded, including those who clicked an invite link (which confirms the e-mail
  and mints a session) and then abandoned the set-password form.
- The `healPendingInvite` bug fixed in PR #175 independently set the flag `true`
  for users who had never set a password.

So a passwordless invitee is classified `add-direct` forever: every re-invite
silently adds them to the workspace and mails nothing, while they remain unable to
log in. The CRM compounds it — `apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx`
discards the function's `message` and unconditionally toasts `'Convite enviado!'`,
so the owner is actively told an e-mail was sent when none was.

Observed 2026-07-21 in the Araripe MKT workspace: an invite row written
`accepted` with `accepted_at == created_at` and no e-mail ever sent, which led the
owner to delete the auth user by hand while trying to recover access.

### Why the admin API can't answer this

The ground truth is `auth.users.encrypted_password`, which the Supabase admin API
does not expose. `listUsers()` returns `email_confirmed_at`, `last_sign_in_at`,
and identities, none of which discriminate: clicking an invite link sets
`last_sign_in_at` without any password existing. A DB-side helper is required.

## Design

### 1. Migration `20260721000001_invite_password_truth.sql`

A `SECURITY DEFINER` helper exposing the withheld fact:

```sql
CREATE OR REPLACE FUNCTION public.user_has_password(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(u.encrypted_password, '') <> '' FROM auth.users u WHERE u.id = p_user_id;
$$;
REVOKE EXECUTE ON FUNCTION public.user_has_password(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_password(uuid) TO service_role;
```

`coalesce(..., '') <> ''` covers both representations GoTrue has used for
passwordless users (`NULL` and `''`). The `REVOKE` is load-bearing: "does this
address have a password" is an account-enumeration primitive and must remain
service-role only.

The `GRANT` back to `service_role` is equally load-bearing, not decorative.
`anon`, `authenticated`, and `service_role` all reach `public`-schema functions
only through the implicit `PUBLIC` grant Postgres attaches by default; revoking
`PUBLIC` removes it from all three at once, including `service_role`. `invite-user`
calls this RPC with the service-role key, so without the explicit grant-back the
call always errors, `coerceHasPassword` maps that to "unknown", and the veto
never fires — the fix silently does nothing.

**`PUBLIC` is the operative target.** Postgres grants `EXECUTE` on a new function
to `PUBLIC` by default and every role inherits that grant, so revoking from
`anon`/`authenticated` alone leaves the function callable by any signed-in user.
The first hand-applied version of this migration (prod, 2026-07-21) omitted
`PUBLIC` and had to be corrected. The psql test case asserting `authenticated` cannot
execute it exists to catch exactly this.

One-time repair, with no date filter — "has no password" is itself the correct
discriminator, so it also catches rows the `healPendingInvite` bug corrupted:

```sql
UPDATE profiles p SET onboarding_complete = false
FROM auth.users u
WHERE u.id = p.id AND p.onboarding_complete = true AND coalesce(u.encrypted_password,'') = '';
```

Safe because login is password-only: no `signInWithOAuth`, `signInWithOtp`, or
`signInWithIdToken` call exists in `apps/crm`, `apps/hub`, or `apps/admin`, so no
legitimate user has an empty password.

Both statements are idempotent: `CREATE OR REPLACE`, and the `UPDATE` cannot match
a second time.

### 2. `classifyExistingUser` stops treating the flag as authoritative

```ts
args: { emailConfirmed, hasProfile, onboardingComplete, hasPassword?: boolean | null }
if (onboardingComplete && hasPassword !== false) return "add-direct";
// remaining branches unchanged
```

A confirmed user with no password now falls through to `resend-link` — the
existing non-destructive branch that mints a recovery link via
`admin.generateLink` and delivers it through Resend from `convites@mesaas.com.br`,
independent of Supabase's auth SMTP.

`hasPassword` is optional on purpose. `undefined`/`null` means "unknown" and
preserves current behavior, which gives two properties:

- the six existing cases in `invite-user-onboarding_test.ts` keep passing untouched
- an RPC failure degrades to the status quo rather than blocking every invite

Both call sites in `invite-user/index.ts` (`deleteUnconfirmedInvitedUser`, and the
main invite path) fetch it via the RPC alongside the existing profile lookup.

### 3. The CRM stops reporting a send that didn't happen

`ConfiguracaoPage.tsx` surfaces the server's `message` instead of the hardcoded
`'Convite enviado!'`.

## Consequences accepted

**Cancelling an invite now deletes these users.** `deleteUnconfirmedInvitedUser`
deletes on `reinvite`/`resend-link`. A repaired passwordless user previously
classified `add-direct` and was skipped; they now classify `resend-link` and will
be deleted on cancel. This is correct — cancelling is meant to remove the invitee
entirely, and an account with no password has nothing to lose — but it is a real
behavior change. Note the scope of that delete: it removes the `workspace_members`
row filtered only by `user_id` (no `conta_id` filter) and deletes the auth user
globally, so cancelling the invite in one workspace removes the user from every
workspace they belong to. Harmless in practice, since these accounts cannot log
in, but worth having written down.

**Users flipped to `onboarding_complete = false` no longer pass the
`healPendingInvite` gate** at `apps/crm/src/lib/supabase.ts:164`. Intended: healing
restores lost membership for an already-onboarded user, and per PR #175 must never
treat "has a session" as "has a password". No live user is affected — these
accounts cannot log in at all.

## Deployment

Order-independent by design, deliberately, because the 2026-07-21 outage was caused
by an edge function and a migration that had to ship together and didn't:

- function deployed before the RPC exists → `hasPassword` is `null` → current behavior
- migration applied before the function → repair lands, function doesn't consult it yet

### Deployment state as of this spec

The two SQL statements in §1 were run by hand in the prod SQL editor on 2026-07-21,
after the operator ran the count query and reviewed the affected addresses. So:

- **prod**: RPC + repair applied; **not recorded** in `supabase_migrations.schema_migrations`
- **staging**: neither applied
- **repo**: migration file not yet written

Remaining work is therefore to write the file as the record of what is already
live, register its version on prod so history matches, and deliver it to staging.
Because both statements are idempotent, a replay is harmless — the file is a
record and a staging-delivery mechanism, not a re-run risk.

Note that the repair **alone** already closes the trap on prod: the deployed
`invite-user` v69 routes `onboarding_complete = false` + confirmed e-mail to
`resend-link`. The `hasPassword` change is defense-in-depth against the flag
drifting a third time, not the thing that fixes it.

## Testing

Deno, in `supabase/functions/__tests__/invite-user-onboarding_test.ts`: 8 new cases
(6 pre-existing cases unchanged, 14 total).

`classifyExistingUser`, 4 new cases:

- `onboardingComplete: true, hasPassword: false` → `resend-link` (the trap)
- `onboardingComplete: true, hasPassword: undefined`/`null` → `add-direct` (degradation)
- `onboardingComplete: true, hasPassword: true` → `add-direct`
- `emailConfirmed: false, hasPassword: false` → `reinvite` (still destructive when unconfirmed)

`coerceHasPassword`, 4 new cases:

- RPC error → `null` (unknown, does not veto)
- `true`/`false` pass through unchanged
- a `null` row (unknown user) → `null`
- a non-boolean payload → `null`

Plain psql (`DO $$ … assert … $$`, matching the house style of
`supabase/tests/post_media_set_from_uploads.sql` — not pgTAP), in `supabase/tests/`:

- `user_has_password` returns `false` for `NULL`, `false` for `''`, `true` for a real hash
- `authenticated` and `anon` cannot execute it
- `service_role` CAN execute it

## Out of scope

Reworking the invite flow's reliance on Supabase auth SMTP for brand-new users
(`inviteUserByEmail`), and any change to invite-link expiry, which is a Supabase
dashboard setting with no config-as-code representation.
