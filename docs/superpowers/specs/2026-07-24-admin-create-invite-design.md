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

- **Reuses `inviteOrResend` unchanged.** The primitive already classifies a target email's real auth
  state and routes correctly (brand-new email → real invite email; a stale unconfirmed account →
  fresh set-password link; already-onboarded → report only when `addOnboarded: false`). A new
  admin-facing *create* entry point needs **zero changes** to `_shared/invite-actions.ts` — it's the
  same call `admin-resend-invite` already makes, just without a pre-existing invite row to look up
  first. This is the payoff of Tasks 5/6/8 having already unified invite/resend onto one primitive.
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
  which is *more* accurate for the audit trail than any alternative, and consistent with how
  `admin-cancel-invite`/`admin-resend-invite` already behave when *creating* new rows internally
  (e.g. the `add-direct` → `added` route on the CRM side).
- **Seat limits inherited for free.** `inviteOrResend`'s seat pre-check (`max_team_members`) already
  runs for every route, including a brand-new invite. No new logic needed; an admin invite at a full
  workspace returns `plan-limit-exceeded` (403) exactly like a resend does today.
- **Audit metadata carries `email` instead of a pre-known `resource_id`.** Unlike cancel/resend
  (which act on an existing invite row and know its id upfront), a create action doesn't have an
  invite id until *after* `inviteOrResend` runs, and the primitive doesn't return one (by design — it
  returns only `{ route, affectedWorkspaceIds? }`). Extending `inviteOrResend`'s return shape just for
  an audit-log convenience would touch an already-hardened, heavily-tested primitive for a small gain.
  The audit row omits `resource_id` and includes `email` in `metadata` instead — enough to identify
  the action; the resulting invite row is findable by `conta_id` + `email` if ever needed.

## Backend

### New `platform-admin` action: `admin-create-invite`

`{workspace_id, email, role}` →

1. Validate: `workspace_id` required (400), `email` required (400), `role` required and must be
   `'admin'` or `'agent'` (400 `"role must be admin or agent"` otherwise — explicitly rejecting
   `'owner'`, not just failing to allow it). No server-side email *format* check beyond presence —
   matches the existing `invite-user` handler's own validation (none beyond presence/type), relying
   on the frontend's `type="email"` input and, ultimately, Supabase's own rejection of a malformed
   address inside `inviteOrResend`.
2. Call `inviteOrResend(svc, { contaId: workspace_id, email: email.toLowerCase(), role, invitedBy:
   adminUserId, redirectBase }, { addOnboarded: false })` — identical shape to how
   `handleAdminResendInvite` already calls it (`platform-admin/invite-handlers.ts`), reusing
   `Deno.env.get("OAUTH_REDIRECT_BASE")` the same way.
3. Map the outcome via the **existing** `resendMessage(route)` from `invites-enrich.ts` — no new
   mapping function. Its wording is already generic enough ("Invitation email sent.", "already has an
   account and was NOT added...", etc.) to read correctly for a *new* invite, not just a resend.
4. Audit: on success (`mapped.status < 300`), write one `admin-create-invite` row per entry in
   `outcome.affectedWorkspaceIds` (falling back to `[workspace_id]` when absent — the same
   degrade-to-single-row pattern `handleAdminResendInvite` already uses, relevant here only for the
   rare case where the target email has a stale, unrelated, never-confirmed account from some other
   invite attempt, which routes through `reinvited` and can affect other workspaces). Metadata:
   `{ email, role, route: outcome.route, operation_id }`, no `resource_id`.

Lives in `platform-admin/invite-handlers.ts` alongside the other two invite handlers (same file,
same reasoning as before: importable without booting `Deno.serve`). One new import line and one new
`case` in `index.ts`'s switch — no existing handler touched.

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
  the existing Resend/Cancel busy-state pattern. No confirm dialog — sending an invite isn't
  destructive, unlike Cancel.

## Error handling

- 400: missing `workspace_id`/`email`, or `role` not in `{admin, agent}`.
- 403 `plan_limit_exceeded`: inherited from `inviteOrResend`'s seat check — same shape the resend
  action already produces, so the existing `SEAT_LIMIT_MESSAGE` mapping in `WorkspaceInvitesCard.tsx`
  (added in the final-review fix batch) already covers this without new frontend work.
- 409 `blocked-anomalous`: inherited, same as resend.
- Generic 500 for anything unexpected, matching every other `platform-admin` handler.

## Testing

- **Backend (DI, `platform-admin-invites_test.ts`)**: role validation (owner rejected with 400,
  admin/agent accepted), a successful create routes through `inviteOrResend` with `addOnboarded:
  false` and the admin's `user.id` as `invitedBy`, and the audit row is written with the expected
  metadata shape (no `resource_id`, `email`/`role`/`route`/`operation_id` present). Does **not**
  re-test `inviteOrResend`'s own classification/routing — that's already covered by Task 5's suite;
  this only verifies the handler's own wiring (validation, the call shape, audit logging).
- **Frontend (RTL, `WorkspaceInvitesCard.test.tsx`)**: the "+ Invite" control reveals the form; the
  role select offers only Admin/Agent (no Owner option in the DOM at all, not just visually hidden);
  submitting calls `adminCreateInvite` with the exact typed values; success invalidates the invites
  query and shows the returned message; error shows a toast; Send is disabled while pending.

## Deployment

No migrations (reuses `invites`/`audit_log`, already exist). `platform-admin` deploys alone this
time — this feature doesn't touch `invite-user` or `_shared/invite-actions.ts` at all, so there's no
paired-deploy requirement like the original panel had. Still deploy with `--no-verify-jwt --use-api`,
and **from the actual worktree/checkout with this branch's code** — the CWD-matters gotcha from the
original panel's post-merge incident applies identically here (see
`reference_edge_deploy_use_api.md` in project memory). Verify with `supabase functions download` +
grep for `admin-create-invite`, not just version/entrypoint metadata.
