# Seat-limit first-row carve-out — design

## Problem

`public.handle_new_user_workspace()` (trigger on `AFTER INSERT ON auth.users`,
defined in `supabase/migrations/20260719000002_signup_marketing_opt_in.sql`)
inserts the new owner's row into `workspace_members` as part of every
fresh-signup transaction. That insert is gated by `trg_limit_seats`, which
calls `enforce_plan_count_limit('max_team_members', 'direct', 'workspace_id',
'workspace_id')`, which calls `effective_plan_limit(ws_id, 'max_team_members')`.

`effective_plan_limit()` fails closed to `0` when a workspace's `plan_id` is
`NULL` (true for every brand-new workspace, which relies on the `plans` table's
`is_default = true` row as a fallback) and no plan has `is_default = true`.
When that happens, the very first `workspace_members` insert for the new
workspace — the owner's own seat — raises `plan_limit_exceeded:max_team_members`
inside the `AFTER INSERT ON auth.users` trigger, which aborts the whole
signup transaction. A missing default plan doesn't break one feature; it
breaks every new signup, and (separately, not fixed here) every entitlement
check for any other workspace whose `plan_id` is `NULL`.

## Options considered

**A. Wrap the `workspace_members` insert in `BEGIN … EXCEPTION WHEN OTHERS …
RAISE WARNING` and skip it on failure** (the pattern used for the *optional*
`workflow_templates` seed on the unmerged `feat/onboarding-fluxo-template`
branch). Rejected: `workspace_members` is not optional convenience data.
Skipping it produces a user who can authenticate but has no seat row, so RLS
and `active_workspace_id` resolution fail for them — a silently broken
account, worse than a clear signup error.

**B. Add a hard DB constraint guaranteeing `plans` always has ≥1
`is_default = true` row** (e.g. a deferred constraint trigger). Rejected:
`supabase/functions/platform-admin/plan-mutations.ts` implements "set this
plan as the new default" (both the create-plan and update-plan paths) as two
separate, independently-committing Supabase JS calls — unset the old default,
then set the new one. A constraint requiring "always ≥1 default" would fail
the first of those two calls on every legitimate default-plan change in the
Admin today. Fixing that would require making the Admin's swap atomic first
(a separate, real piece of work — flagged as a follow-up, out of scope here).

**C. Make `effective_plan_limit()` fail open (return `NULL`/unlimited) instead
of `0` when no default plan is configured.** Rejected: every workspace with a
`NULL plan_id` relies on the default-plan fallback for *every* resource
(clients, leads, hub tokens, storage, seats, …), not just seats. Failing open
during a misconfiguration turns a signup bug into a billing hole.

**D. (Chosen) Narrow carve-out in `enforce_plan_count_limit()`: always allow
the first row for a given scope, on `trg_limit_seats` only.** A workspace can
never legitimately have zero members — someone has to own it — so the seat
limit should bind starting from the 2nd member, not the 1st, regardless of
plan/override/misconfiguration state. This is a business rule independent of
the specific "missing default plan" bug, and it fixes the reported failure
mode directly without touching `handle_new_user_workspace()` (no conflict
with the pending template-seed migration) and without changing behavior for
any of the other 8 triggers wired to `enforce_plan_count_limit()` (max_clients,
max_leads, max_hub_tokens, max_workflow_templates, max_instagram_accounts,
max_active_workflows_per_client, max_custom_properties_per_template,
max_posts_per_workflow) — those legitimately can and do start at 0.

## Design

`enforce_plan_count_limit()` gains one new optional trigger argument,
`TG_ARGV[5]`, `allow_first_row` (text `'true'`/absent, `coalesce`d and cast to
boolean same as the existing `status_pred` optional arg). Immediately after
`v_count` is computed (both the `direct` and `via_clientes` branches converge
before the limit check), short-circuit:

```sql
if v_allow_first and v_count = 0 then
  return NEW; -- first row for this scope is always allowed
end if;
```

The other 8 triggers must keep their original fast path: `effective_plan_limit()`
resolved first, returning immediately on `NULL` (unlimited) *before* ever running
the `COUNT(*)`. Only `trg_limit_seats` needs the count computed up front (to
decide the carve-out before the limit even matters), so the final function
branches on `v_allow_first` to compute the count either before or after the
`effective_plan_limit()` call, rather than always counting first — otherwise
every insert on every plan-gated table, including bulk imports on unlimited
plans, would pay for a `COUNT(*)` it used to skip entirely.

`trg_limit_seats` is recreated passing `''` for the existing `status_pred`
slot and `'true'` for the new slot — the only trigger touched by this
migration. `CREATE OR REPLACE FUNCTION` alone updates the behavior seen by
every other trigger that already calls `enforce_plan_count_limit()` (max_clients,
max_leads, etc.); none of those triggers need to be dropped or recreated,
since they never pass a 6th argument and `TG_ARGV[5]` is simply absent/NULL
for them, which `coalesce(..., 'false')` treats as off.

The carve-out is deliberately scoped to "first row for this `workspace_id`,
any role" rather than "first row AND role = owner" or "only during signup."
`workspace_members` has no invariant that the first row must be an owner —
`accept_workspace_invite()` (`supabase/migrations/20260731000002_invite_membro_link.sql`)
already inserts a non-owner as a workspace's first membership row whenever
the real seat limit is ≥1 (e.g. a `contas`-legacy workspace whose `workspaces`
row and first invite acceptance both post-date its owner's signup). That
flexibility is pre-existing and independent of this fix. Scoping the
carve-out to "any first row" rather than "owner only" extends the same
existing behavior to the misconfigured case, so an orphaned zero-member
workspace can also recover via invite acceptance, not just via fresh signup —
consistent with the underlying rule ("a workspace can never legitimately have
zero members") rather than a narrower, signup-only patch.

`profiles` inserts are not gated by `enforce_plan_count_limit` at all (no
trigger on `profiles` calls it) — no change needed there.

## Testing

New entitlement test file `supabase/tests/entitlements/93_seat_limit_first_row_carveout.sql`,
following the existing `begin; do $$ … end $$; rollback;` pattern used
throughout `supabase/tests/entitlements/`:

1. Force the exact failure condition inside the test's own (rolled-back)
   transaction: `UPDATE plans SET is_default = false WHERE is_default;`
   — now zero plans have `is_default = true`.
2. Insert a fresh `auth.users` row with no `conta_id` in its metadata (the
   existing tests' established pattern for firing the fresh-signup branch of
   `handle_new_user_workspace()`). Assert it does not raise, and that a
   `workspace_members` row with `role = 'owner'` now exists for that user.
3. With the workspace from step 2 and still zero default plans, attempt to
   insert a *second* `workspace_members` row for the same workspace and
   assert it IS blocked with `plan_limit_exceeded:max_team_members` — proving
   the carve-out exempts only the first seat, not the limit as a whole.
4. `rollback` — the forced zero-default-plan state never commits.

## Out of scope (flagged separately)

The Admin's non-atomic default-plan-swap flow (see option B) is a real, related
latent risk but is separate work; tracked as a follow-up task rather than
fixed here.
