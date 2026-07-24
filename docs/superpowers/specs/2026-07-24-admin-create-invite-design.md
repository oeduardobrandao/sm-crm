# Admin-Created Invites — Design

**Date:** 2026-07-24
**Status:** Approved
**Origin:** Direct follow-on to the Admin Invites Panel (`docs/superpowers/specs/2026-07-23-admin-invites-panel-design.md`).
While live-testing that panel, a support case needed a *new* invite sent (not a resend of an existing
row) — the admin portal had no way to do that. This spec adds it.

## Goal

Let a platform admin send a brand-new workspace invite from the admin portal, for cases where the
workspace owner is stuck, confused, or otherwise can't do it themselves (e.g. repeated typos, exactly
like the case that motivated this spec).

**Use case:** support tool. Not a general "manage any workspace's team" capability — scoped to
unblocking a specific invite situation, same spirit as the existing Cancel/Resend actions.

**Out of scope (explicitly deferred):** the "already onboarded" case does **not** get a
confirm-to-join email in this slice — see below. That's a separate, larger feature (new email
template, a non-password confirmation link/token, a new CRM landing page) that would also change the
CRM owner's own "add team member" button, not just this admin action. Tracked as a future follow-up;
not blocking this spec.

## Key decisions

- **Reuses `inviteOrResend`.** The primitive already classifies a target email's real auth state and
  routes correctly (brand-new email → real invite email; a stale unconfirmed account → fresh
  set-password link; already-onboarded → report only when `addOnboarded: false`). A create entry
  point is the same call `admin-resend-invite` already makes, just without a pre-existing invite row
  to look up first. This is the payoff of Tasks 5/6/8 having already unified invite/resend onto one
  primitive. **One change to the primitive is in scope** — returning the id of the invite row it
  creates (see the audit decision below); everything else about it stays as-is.
- **`addOnboarded: false`**, matching `admin-resend-invite`. An admin-created invite to someone who
  already has a full account elsewhere reports "already has an account, not added" and does nothing
  further — it does **not** silently grant membership. Placeholder behavior until the confirm-to-join
  follow-up ships (which will upgrade this action and the CRM's own invite button together).
- **Role restricted to `admin` / `agent` — never `owner`.** Matches the existing CRM rule that a
  workspace admin can't invite an owner. Granting ownership of a customer's workspace is a
  significant, billing-adjacent action that doesn't belong in a support tool. Enforced **server-side**
  in the new handler (not just hidden in the UI) — the request body's `role` is validated before any
  call to `inviteOrResend`.
- **`invited_by` = the platform admin's own `user.id`.** There's no "on behalf of the owner" concept
  in the schema (and none is needed) — the invite is honestly attributed to the admin who sent it,
  which is *more* accurate for the audit trail than any alternative.
- **Seat limits inherited for free.** `inviteOrResend`'s seat pre-check (`max_team_members`) already
  runs for every route, including a brand-new invite. No new logic needed; an admin invite at a full
  workspace returns `plan-limit-exceeded` (403) exactly like a resend does today.
- **Create is an upsert, by design.** `inviteOrResend` calls `deletePriorInvites` on every mutating
  route, so creating an invite for an email that already has a `pending`/`expired` row in that
  workspace replaces that row and sends a fresh email — i.e. create silently behaves as resend. This
  is **intentional and documented**, not an accident: rejecting it with a 409 ("use Resend instead")
  would force the admin through more steps to reach an identical outcome, and the panel already shows
  the existing invite list right beside the form. The audit row's `route` field records which path
  actually ran, so the trail stays unambiguous even when the labels differ.
- **Audit records the real invite id.** `inviteOrResend` gains an optional `inviteId` on its return
  value, populated on every route that creates an `invites` row (`invited`, `reinvited`,
  `resent-link`, `added`). Cost is small — `sendPendingWorkspaceInvite` *already* returns the new id
  and `sendNewUserInvite` merely discards it; the other three sites need `.select("id").single()`
  appended to an existing insert, a chain the test fakes already support. This is worth doing rather
  than falling back on `conta_id` + `email`, which is not unique across history or concurrent
  attempts. It also repairs an existing defect in `handleAdminResendInvite`: it audits
  `resource_id: body.invite_id`, but the resend path's `deletePriorInvites` has *deleted* that row by
  then, so today's resend audit rows point at an id that no longer exists. Both handlers switch to
  the id returned by the outcome, falling back to the request's id when a route created no row.

### The `reinvited` route deletes globally — accepted, disclosed, not blocked

`inviteOrResend`'s `reinvite` route (target email has a **never-confirmed** auth user) calls
`deleteOrphanedAuthUser`, which deletes the user's `profiles` row, **all** of their
`workspace_members` rows (filtered by `user_id` only, no workspace filter), and the auth user itself.
So an admin-created invite can remove a pending invitee from *other* workspaces.

This is not new — the CRM's own invite button and `admin-resend-invite` both reach the identical code
path today. More importantly, **blocking it would break the case this feature exists for**: the
motivating support case was a typo'd address that had produced exactly such a never-confirmed auth
user. A 409 on `reinvite` would leave the admin unable to fix the very problem they opened the panel
for.

Decision: allow it, and make it visible rather than silent.

- **Disclosed after the fact.** When `outcome.route === 'reinvited'` and `affectedWorkspaceIds.length
  > 1`, the success message appends: `Note: this email had an unconfirmed account that was also
  pending in N other workspace(s); that account was replaced.` The admin sees the blast radius
  immediately instead of discovering it later.
- **Audited across every workspace touched**, via the existing `affectedWorkspaceIds` fan-out with a
  shared `operation_id` (below).

A preflight (classify first, then ask the admin to confirm) was considered and rejected: it costs a
second full paged `listUsers` scan, and a confirm prompt that must be shown *before* the route is
known would either fire on every create (noise) or duplicate the classification logic outside the
primitive.

## Backend

### New `platform-admin` action: `admin-create-invite`

`{workspace_id, email, role}` →

1. **Validate, before any expensive work.** Each failure returns a specific 400/404, never a generic
   500:
   - `workspace_id` — must be a string matching the UUID shape
     (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`), else 400
     `"workspace_id must be a valid uuid"`. A malformed value currently reaches the
     `effective_plan_limit` RPC and dies as a Postgres uuid cast error → opaque 500.
   - Then confirm the workspace **exists**: `svc.from("workspaces").select("id").eq("id",
     workspace_id).maybeSingle()` → 404 `"Workspace not found"` when absent. Without this, an unknown
     UUID returns a *misleading* 403: `effective_plan_limit` is written to `return 0` for an unknown
     workspace (`20260611130001_effective_plan_limit.sql`), and `seatsAvailable` then computes
     `0 + 0 < 0` → false → `plan-limit-exceeded`. Telling an admin "this workspace is out of seats"
     when the workspace does not exist is the wrong answer to the wrong question.
   - `email` — must be a **string** (`typeof body.email !== "string"` → 400), trimmed, non-empty, and
     match a minimal shape check `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` → else 400 `"A valid email is
     required"`. The type check is load-bearing: a truthy non-string (`{email: 123}`) would make
     `email.toLowerCase()` throw a TypeError → 500. The shape check is worth its one line because
     `findAuthUserByEmail` pages through **every** auth user before concluding "not found" — junk
     input buys a full-table scan. It deliberately does *not* try to catch typos; `iara41.ia@` and
     `iara41.ai@` are both perfectly valid addresses, which is the whole reason this panel exists.
   - `role` — required, and must be `'admin'` or `'agent'`, else 400 `"role must be admin or agent"`
     (explicitly rejecting `'owner'`, not merely failing to allow it).
2. Call `inviteOrResend(svc, { contaId: workspace_id, email: normalizedEmail, role, invitedBy:
   adminUserId, redirectBase }, { addOnboarded: false })` — identical shape to how
   `handleAdminResendInvite` already calls it (`platform-admin/invite-handlers.ts`), reusing
   `Deno.env.get("OAUTH_REDIRECT_BASE")` the same way.
3. Map the outcome via a new `createMessage(outcome)` in `invites-enrich.ts`, which delegates to the
   existing `resendMessage` for every route except the two whose copy is resend-specific:
   - `already-onboarded` — `resendMessage` says *"The pending invite was left in place."*, which is
     false for a create where no pending invite existed. Create says: `"This person already has an
     account and was NOT added to the workspace. No invite was created."`
   - `reinvited` — appends the cross-workspace disclosure sentence described above when more than one
     workspace was affected.
4. Audit: on success (`mapped.status < 300`), write one `admin-create-invite` row per entry in
   `outcome.affectedWorkspaceIds` (falling back to `[workspace_id]` when absent — the same
   degrade-to-single-row pattern `handleAdminResendInvite` already uses). Metadata:
   `{ email, role, route: outcome.route, operation_id }`, with `resource_id: outcome.inviteId` when
   the route created a row.

Lives in `platform-admin/invite-handlers.ts` alongside the other two invite handlers (same file,
same reasoning as before: importable without booting `Deno.serve`). One new import line and one new
`case` in `index.ts`'s switch.

### Two adjacent silent-failure fixes

Both are small, both are in the write path this feature depends on, and both are the same class of
bug — treating a `supabase-js` call as if it throws when it actually returns `{ error }`:

- **`_shared/audit.ts`** wraps its insert in `try/catch`, but `supabase-js` resolves with an error
  object rather than throwing, so a failed audit write is *completely* silent today. Change to
  destructure `{ error }` and `console.error` it. Logging only — audit failure still must never break
  the primary operation. Takes effect per-function on next deploy.
- **`_shared/invite-actions.ts:331`**, the `deletePendingInvite` rollback used when
  `inviteUserByEmail` throws: it ignores the delete's `{ error }`, so a failed rollback leaves a
  phantom `pending` invite row for an auth user that was never created. `sendPendingWorkspaceInvite`
  already has a `try/catch` + `console.error` around this call — it just never fires. Throw on
  `error` so the existing handler logs it.

## Frontend

- **`apps/admin/src/lib/api.ts`**: `adminCreateInvite(workspace_id: string, email: string, role:
  'admin' | 'agent')` → `adminApi<{ success?: boolean; route?: string; message?: string }>
  ('admin-create-invite', { workspace_id, email, role })`.
- **`WorkspaceInvitesCard.tsx`**: a "+ Invite" control in the card header. Clicking it reveals an
  inline form (not a modal — the card has no existing dialog infrastructure, and a two-field form
  doesn't need one): email input (`type="email"`, required), a role select (Admin / Agent, no Owner
  option — the restriction is visible in the UI *and* enforced server-side), a Send button, and a
  way to dismiss the form without sending. Role defaults to `agent` (the lower-privilege option).
  On submit: mutate via `adminCreateInvite`, `onSuccess` → invalidate the invites query (same
  `queryKey` the Cancel/Resend mutations already invalidate) + toast `res.message` + close/reset the
  form; `onError` → toast the error. Send button disabled while the mutation is in flight, matching
  the existing Resend/Cancel busy-state pattern. No confirm dialog: the one destructive path
  (`reinvited`) is disclosed in the result message rather than guessed at up front — see the
  `reinvited` section above for why a preflight confirm was rejected.

## Error handling

- 400: `workspace_id` missing or not a UUID; `email` missing, non-string, or malformed; `role` not in
  `{admin, agent}`.
- 404: `workspace_id` is a well-formed UUID that matches no workspace.
- 403 `plan_limit_exceeded`: inherited from `inviteOrResend`'s seat check — same shape the resend
  action already produces, so the existing `SEAT_LIMIT_MESSAGE` mapping in `WorkspaceInvitesCard.tsx`
  already covers this without new frontend work.
- 409 `blocked-anomalous`: inherited, same as resend.
- Generic 500 for anything unexpected, matching every other `platform-admin` handler.

## Testing

- **Backend (DI, `platform-admin-invites_test.ts`)**: each validation branch returns its specific
  status (owner role → 400; non-string email → 400 and *not* a 500; malformed uuid → 400; unknown
  workspace → 404 and *not* 403); a successful create routes through `inviteOrResend` with
  `addOnboarded: false` and the admin's `user.id` as `invitedBy`; the audit row carries
  `resource_id` from `outcome.inviteId` plus the expected metadata; the `reinvited` +
  multi-workspace case appends the disclosure sentence and writes one audit row per affected
  workspace sharing one `operation_id`. Does **not** re-test `inviteOrResend`'s own
  classification/routing — that's already covered by Task 5's suite.
- **`invite-actions_test.ts`**: extend for the new `inviteId` return — assert it is populated on
  `invited`/`reinvited`/`resent-link`/`added` and absent on the no-op routes. Existing assertions all
  read `out.route` specifically, so an added optional field breaks none of them.
- **`audit_test.ts`**: an insert that resolves with `{ error }` is logged and still does not throw.
- **Frontend (RTL, `WorkspaceInvitesCard.test.tsx`)**: the "+ Invite" control reveals the form; the
  role select offers only Admin/Agent (no Owner option in the DOM at all, not just visually hidden);
  submitting calls `adminCreateInvite` with the exact typed values; success invalidates the invites
  query and shows the returned message; error shows a toast; Send is disabled while pending.

## Deployment

No migrations (reuses `invites`/`audit_log`, already exist). This slice touches
`_shared/invite-actions.ts` and `_shared/audit.ts`, so **`invite-user` redeploys alongside
`platform-admin`** — the paired-deploy requirement from the original panel applies again here.
(`_shared/audit.ts` is imported far more widely; other functions simply pick up the logging fix on
their next unrelated deploy — no behavior change, so no fan-out deploy is required.)

Deploy with `--no-verify-jwt --use-api`, and **from the actual worktree/checkout with this branch's
code** — the CWD-matters gotcha from the original panel's post-merge incident applies identically
here (see `reference_edge_deploy_use_api.md` in project memory). Verify with `supabase functions
download` + grep for `admin-create-invite`, not just version/entrypoint metadata.
