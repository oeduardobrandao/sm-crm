# Admin Invites Panel — Design

**Date:** 2026-07-23
**Status:** Approved
**Origin:** Support case (Araripe MKT, "invitation emails never arrive"). Diagnosing it required
raw SQL against `invites` + the GoTrue admin API plus manual Supabase-dashboard actions that left
no audit trail. This feature makes that whole class of ticket resolvable from the admin portal.

## Goal

Give platform admins (admin portal, `platform_admins` gate) a per-workspace **Invites** panel on
`WorkspaceDetailPage` that:

1. Shows the workspace's invites (newest 50, with a total count when truncated — see finding 6)
   with enough enrichment to diagnose "the email never arrived" without touching SQL or the
   Supabase dashboard.
2. Offers **Cancel** and **Resend** actions that reuse the exact code paths of the CRM's
   `invite-user` function, audit-logged to the workspace `audit_log`.

Out of scope (explicitly): global invite lookup by email, member add/remove/role management from
the portal, impersonation, any change to the CRM-side invite flow's behavior.

## Background: how invites actually behave (drives the UI semantics)

- `invite-user` has four paths for an invited email: **new user** (GoTrue `inviteUserByEmail`
  sends the email), **fully onboarded** (`add-direct`: silently added to `workspace_members`,
  invite row written as `accepted` with `accepted_at ≈ created_at`, **no email sent**),
  **confirmed-but-passwordless** (`resend-link`: recovery link generated and emailed via Resend),
  **never-confirmed** (`reinvite`: auth user deleted and re-invited fresh).
- `confirmation_sent_at` on the auth user means GoTrue completed the SMTP handoff; the pending
  `invites` row surviving means the edge function did not roll back. Together they prove the app
  sent the email — remaining causes are recipient-side (spam) or link expiry.
- Real invite-link lifetime is the GoTrue dashboard setting (~24h), decoupled from the cosmetic
  7-day `invites.expires_at`.
- Cancelling an invite deletes the invite row and, when the invitee never finished onboarding
  (`reinvite`/`resend-link` classification), deletes the auth user **globally** — removing them
  from all workspaces (accepted consequence, PR #232).

## Architecture

Approach: extend `platform-admin` with three actions; extract the invite logic both functions
need into `supabase/functions/_shared/` so owner-initiated (CRM) and admin-initiated (portal)
actions share one code path. No migrations — `invites`, `audit_log`, and `user_has_password()`
all exist.

### Shared-module extraction (behavior-preserving)

| Module | Contents | Provenance |
|---|---|---|
| `_shared/invite-classify.ts` | `classifyExistingUser`, `coerceHasPassword` | moved from `invite-user/onboarding.ts` |
| `_shared/invite-pending.ts` | `sendPendingWorkspaceInvite` | moved from `invite-user/pending-invite.ts` |
| `_shared/invite-actions.ts` | `findAuthUserByEmail`, `getAuthStatesByEmails`, `cancelInvite`, `inviteOrResend` | extracted from `invite-user/index.ts` (+ new batching helper) |

- Physical moves, not re-export shims. Update imports in `invite-user/index.ts` and in the deno
  tests `invite-user-onboarding_test.ts` / `invite-user-pending_test.ts`; grep
  `apps/**/__tests__` and `supabase/functions/__tests__` for stale paths (contract-change rule).
- `cancelInvite(svc, {inviteId, contaId})`: verifies the invite belongs to `contaId` **and that
  its status is `pending` or `expired`** (an `accepted` invite is history + a live membership —
  refuse, see `admin-cancel-invite` below), then, before any global auth-user delete, captures the
  target user's full `workspace_members` set for cross-workspace auditing (see finding 5 below);
  deletes the invite row; then runs the existing unconfirmed-user cleanup (classification-guarded:
  never deletes an onboarded user or the anomalous confirmed-no-profile state).
- `inviteOrResend(svc, {contaId, email, role, invitedBy, redirectBase}, opts)` where
  `opts = { addOnboarded: boolean }`. **Classify FIRST, mutate only inside the chosen route** —
  no destructive step (row delete, user delete) runs before we know the route, so a
  `blocked-anomalous` outcome or an early failure never destroys the invite (plan-review finding
  4). Order:
  1. **Seat pre-check** — `effectivePlanLimit` + counts, but the pending count **excludes any
     existing pending row for this same email** (that row is being replaced, not added, so it
     consumes zero new seats). A brand-new or `expired → pending` transition still requires
     capacity (plan-review finding 3). Return `plan-limit-exceeded` when full.
  2. **Classify** the existing auth user (find + `classifyExistingUser`), before any mutation.
  3. **Route** (each route checks the `{ error }` on every Supabase mutation and throws on
     failure — never reports success after a failed insert/delete/deleteUser, plan-review
     finding 2):
     - `add-direct`, already a member → `already-member` (no mutation).
     - `add-direct`, **not** a member → depends on `opts.addOnboarded`:
       `true` (CRM/`invite-user`) adds the member + writes the `accepted` invite (existing CRM
       behavior — the finding-2 fix for the CRM path); `false` (admin resend) does **nothing**
       and returns `already-onboarded`, leaving the pending invite intact. Adding a member from a
       "Resend" click is membership management, which the portal excludes by scope
       (plan-review finding 1).
     - `resend-link` → delete prior `pending`/`expired` rows, `generateLink({type:'recovery'})` +
       `sendInviteEmail` (Resend), insert a fresh `pending` row.
     - `reinvite` → capture the never-confirmed user's `workspace_members` set first, delete
       prior rows + profiles/members + the auth user, then new-user. Returns those
       `affectedWorkspaceIds` so the admin caller can audit every workspace the user was removed
       from (plan-review finding 5 — symmetry with `cancelInvite`).
     - new-user → `sendPendingWorkspaceInvite` (insert-first, rollback-on-send-failure preserved).

  Returns `{ route, affectedWorkspaceIds? }` where `route ∈ added | already-member |
  already-onboarded | resent-link | reinvited | invited | plan-limit-exceeded | blocked-anomalous`.
  Preserves the **original** `invited_by`. **`inviteOrResend` is THE invite-or-resend primitive:**
  `invite-user`'s POST delegates to it with `addOnboarded: true` (mapping routes to its existing
  pt-BR responses); `admin-resend-invite` calls it with `addOnboarded: false`. The invite LOGIC is
  one code path; the single behavioral difference (whether a "Resend"/"Invite" click may add an
  onboarded person) is an explicit, tested flag, not a fork.
- `getAuthStatesByEmails(svc, emails[])`: resolves N emails in **one** paged
  `auth.admin.listUsers` scan (today's `findAuthUserByEmail` re-pages per email); per email
  returns `{ user_id, email_confirmed, confirmation_sent_at, invited_at, last_sign_in_at,
  has_password (via user_has_password RPC), onboarding_complete (via profiles) }` or absent.
- `invite-user/index.ts` keeps its own request parsing, auth/role checks, DELETE (cancel) handler,
  and response shapes — its POST body delegates the classify-and-route work to `inviteOrResend`. Its
  existing deno suite (incl. seat-limit and classification cases) is the regression net proving the
  delegation preserved behavior.

### New `platform-admin` actions

All run after the existing `platform_admins` verification; all validate
`invite.conta_id === workspace_id`; responses follow existing conventions (generic `{error}`
to the client, details only to `console.error`). Responses never include generated action links
(a set-password link visible to an admin is an account-takeover vector).

1. **`get-workspace-invites`** `{workspace_id}` → invite rows for the workspace, newest first,
   capped at 50, plus a `total` count so the UI can show "showing 50 of N" when a workspace
   exceeds the cap (finding 6: pagination deferred as YAGNI — no workspace approaches 50 invites;
   the count makes truncation visible rather than silent). Each row: `{ id, email, role, status,
   created_at, accepted_at, expires_at, invited_by, silent_add, link_expired, auth_state }` where
   - `silent_add` = `status === 'accepted' && |accepted_at − created_at| < 2s` (the
     add-direct/no-email signature);
   - `link_expired` = `status === 'pending' && (now − invite.created_at) > 24h`. Uses the
     invite's **own** `created_at`, NOT the auth user's `confirmation_sent_at`: that timestamp is
     user-global and a later invite from another workspace would refresh it, making an older
     invite look freshly sent (plan-review finding 6). An invite's link is minted when its row is
     created (both new-user and resend-link insert a row at send time), so `created_at` is the
     correct per-invite basis. `confirmation_sent_at` stays in `auth_state` as an account-level
     signal only.
   - `auth_state` = `{ user_exists, email_confirmed, has_password, onboarding_complete,
     confirmation_sent_at, last_sign_in_at, is_member }` (`is_member` = `workspace_members` row
     exists for this workspace), resolved via one `getAuthStatesByEmails` batch for all listed
     emails.
2. **`admin-cancel-invite`** `{workspace_id, invite_id}` → allowed only for `pending`/`expired`
   rows (**400 on `accepted`**; 404 for not-found/wrong-workspace). Calls `cancelInvite`, then
   audits. **Cross-workspace auditing (finding 5):** when the cancel triggers a global auth-user
   delete (non-onboarded invitee), `cancelInvite` returns the set of workspace_ids the user
   belonged to; the action writes an `admin-cancel-invite` audit row to **each** affected
   workspace, all sharing one `operation_id` (a caller-generated uuid), so a member vanishing from
   workspace B has a local trail. Metadata: `{ email, operation_id, deleted_user: bool }`. When no
   global delete occurs, a single audit row under `workspace_id`.
3. **`admin-resend-invite`** `{workspace_id, invite_id}` → allowed only for `pending`/`expired`
   rows (400 on `accepted`; 404 for not-found/wrong-workspace). Calls `inviteOrResend` with
   `addOnboarded: false` (so an onboarded non-member is **reported, not added** — plan-review
   finding 1), preserving the **original** `invited_by`. The seat pre-check runs inside
   `inviteOrResend` (finding 3). Audit action `admin-resend-invite`, `metadata: { email, route }`
   (route ∈ already-onboarded | already-member | resent-link | reinvited | invited). The
   `reinvited` route may have deleted a never-confirmed user from other workspaces, so when
   `inviteOrResend` returns `affectedWorkspaceIds`, the action fans out an `admin-resend-invite`
   audit row to **each**, sharing one `operation_id` (finding 5 — symmetry with cancel). The
   `already-onboarded` / `already-member` routes return 200 with the route flag so the UI phrases
   the outcome (not an error).

Audit writes are best-effort after the action succeeds (matching `insertAuditLog`'s existing
fire-and-forget usage): an audit failure must not roll back a completed cancel/resend.

## Admin UI

- **`apps/admin/src/lib/api.ts`**: `InviteInfo` type mirroring the enriched row; functions
  `getWorkspaceInvites`, `adminCancelInvite`, `adminResendInvite` via the `adminApi()` helper.
- **`apps/admin/src/pages/WorkspaceInvitesCard.tsx`** (new component; the detail page is already
  633 lines and uses page-local modules), rendered on `WorkspaceDetailPage` directly below the
  Members card. Fetch on mount, refetch after any action — same pattern as the MCP-keys card.
  Card copy in English, matching "Members". Desktop table + mobile stacked cards, following the
  Members card's responsive pattern.
- Columns: **Email · Role · Status · Sent · Auth state · Actions**.
  - **Status**: badge for `pending`/`accepted`/`expired`, plus derived tags: amber
    "added silently — no email was sent" when `silent_add`; "link expired" when `link_expired`.
  - **Auth state**: one plain-language chip, first match in escalating order (finding 4: the
    "never opened" label requires `confirmation_sent_at`, so a pre-existing/imported user with no
    recorded send gets a distinct chip instead of a false "never opened"):
    `is_member` → "member of this workspace"; `has_password && onboarding_complete` → "onboarded";
    `email_confirmed && !has_password` → "confirmed, no password";
    `user_exists && confirmation_sent_at` → "email sent, never opened";
    `user_exists` (no send recorded) → "account exists (no send recorded)";
    else → "no account".
  - **Sent**: the invite's `created_at`, formatted — the diagnostic timeline for "when did we
    send this". Both a desktop header row and this column are present (plan-review finding 8).
  - **Actions**: Resend + Cancel, rendered only on `pending`/`expired` rows. Cancel opens a
    confirm dialog: *"This deletes the invite and, if the person never finished onboarding,
    deletes their account — removing them from ALL workspaces."* Resend has no confirm.
- Feedback via the page's existing toast/error pattern. The `already-onboarded` / `already-member`
  resend routes render as an info toast ("this person already has an account — not added to the
  workspace" / "already a member"), not an error.

## Error handling

- Server: 404 invite not found / wrong workspace; 400 on `accepted` for **both** cancel and
  resend; `plan_limit_exceeded` (403) on a resend that would exceed `max_team_members`;
  GoTrue/Resend failures mid-resend keep `invite-user`'s rollback semantics (no phantom pending
  row) and surface as a generic error toast.
- Client: card-level error state with retry on fetch failure; action buttons disabled while an
  action is in flight.

> Note: bare "finding N" below refers to the **spec review** (round 1); the **plan review**
> (round 2) items are labelled "plan-review finding N".

## Testing

- **Deno**: moved-module tests keep passing with updated paths; new tests for
  `_shared/invite-actions.ts`:
  - `inviteOrResend` routing per classification, in **both** modes —
    `addOnboarded: true` adds an onboarded non-member (CRM), `addOnboarded: false` returns
    `already-onboarded` without mutating (admin, plan-review finding 1);
  - the seat pre-check **excluding a matching pending row** so a resend of an at-limit pending
    invite succeeds, while `expired → pending` at the limit is rejected (plan-review finding 3);
  - **classify-before-mutate**: a `blocked-anomalous` outcome leaves the invite row intact
    (plan-review finding 4);
  - **injected mutation errors**: a Supabase `{ error }` on a member/invite/deleteUser call makes
    `inviteOrResend`/`cancelInvite` throw rather than report success (plan-review finding 2);
  - `cancelInvite`'s refuse-`accepted` guard and refuse-to-delete-onboarded guard; affected-
    workspace_ids capture for both cancel and the `reinvite` route (findings 5 + plan-review 5);
  - `getAuthStatesByEmails` single-scan batching.
- **Deno (handlers)**: DI tests for the three `platform-admin` actions using a fake service
  client that records `audit_log` inserts (plan-review finding 7): admin gate, wrong-workspace →
  404, `accepted` → 400, and the **audit fan-out** — cancel/reinvite writes one row per affected
  workspace sharing an `operation_id`. Follows the `plan-mutations` DI pattern.
- **Frontend (RTL)**: `WorkspaceInvitesCard` — chip derivation across all six auth states (incl.
  the finding-4 "account exists (no send recorded)" vs "email sent, never opened" split), action
  visibility per status, the desktop header + Sent column, confirm-dialog copy, an actual
  cancel/resend mutation with refetch/invalidation, retry on fetch error, and buttons disabled
  while an action is in flight (plan-review finding 8).
- **Gates before pushing**: `npm run test`, `npm run build:admin` (finding 7 — the admin app is
  modified, so typecheck it), `npm run test:functions` (its `--allow-env/--allow-net/--allow-sys`
  flags are required by the env/fetch-stub tests — bare `deno test` fails on permissions,
  plan-review finding 10), `npm run lint`, `npm run format:check`. `test:functions` dirties the
  **root** `deno.lock`; restore it with `git checkout -- deno.lock` (the root file, not
  `supabase/functions/deno.lock`), and only that file — no task here changes a Deno dependency.
- **Live verification**: on prod, open Araripe MKT's workspace detail — the panel must show the
  historical `silent_add` rows and the typo invite (`iara41ia@gmail.com`, unconfirmed user with a
  recorded send) as "email sent, never opened".

## Deployment

- No migrations.
- `invite-user` and `platform-admin` MUST deploy **together** (shared-module extraction), each
  with **`--no-verify-jwt`** (both have `verify_jwt = false` in `config.toml` — they authenticate
  their own callers, so the platform JWT gate must stay off, plan-review finding 9) and `--use-api`
  (local Docker bundler is broken for this dep tree), plus the correct `--project-ref`. Staleness
  check after deploy: `functions list` version vs `entrypoint_path` suffix.
- Frontend ships via the normal Vercel build (admin app).
