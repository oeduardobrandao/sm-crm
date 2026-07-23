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
- `inviteOrResend(svc, {contaId, email, role, invitedBy, redirectBase})`: **mirrors `invite-user`'s
  full classification outcomes** so the two paths can never diverge. Order: (1) run the seat
  pre-check (same `effectivePlanLimit` + members/pending count as `invite-user`; return
  `plan_limit_exceeded` if a would-be-new pending row exceeds `max_team_members`); (2) resolve the
  auth state / classification; (3) route:
  - `add-direct` → **add the member + write the `accepted` invite** exactly as `invite-user` does
    (if already a member, no-op and return `already-member`). This is the finding-2 fix: never
    delete the invite and grant nothing.
  - `resend-link` → delete prior `pending`/`expired` rows, `generateLink({type:'recovery'})` +
    `sendInviteEmail` (Resend), insert a fresh `pending` row.
  - `reinvite` → delete prior rows + delete the never-confirmed auth user, fall through to
    new-user.
  - new-user → `sendPendingWorkspaceInvite` (insert-first, rollback-on-send-failure preserved).

  Returns which route ran (`added` | `already-member` | `resent-link` | `reinvited` | `invited`)
  and, on the seat-check failure, `plan_limit_exceeded`, so callers can phrase the outcome.
  Preserves the **original** `invited_by`. **`inviteOrResend` is THE invite-or-resend primitive:
  `invite-user`'s POST handler is refactored to delegate to it** (mapping the returned route to
  its existing pt-BR success/`plan_limit_exceeded` responses) so the CRM and admin paths are
  literally the same code and cannot diverge — that unification is the point of the extraction,
  not a parallel reimplementation.
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
   - `link_expired` = `status === 'pending' && confirmation_sent_at` older than 24h;
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
   rows (400 on `accepted`; 404 for not-found/wrong-workspace). Runs the seat pre-check inside
   `inviteOrResend` (**finding 3: enforce `max_team_members`** — returns `plan_limit_exceeded`
   rather than sending an invite that can't become a membership). Preserves the **original**
   `invited_by` (the workspace owner remains the inviter of record). Audit action
   `admin-resend-invite` with `metadata: { email, route }` (route ∈ added | already-member |
   resent-link | reinvited | invited). The `added` / `already-member` routes return 200 with the
   route flag so the UI can phrase the outcome (not an error).

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
  - **Actions**: Resend + Cancel, rendered only on `pending`/`expired` rows. Cancel opens a
    confirm dialog: *"This deletes the invite and, if the person never finished onboarding,
    deletes their account — removing them from ALL workspaces."* Resend has no confirm.
- Feedback via the page's existing toast/error pattern. The `added` / `already-member` resend
  routes render as an info toast ("this person already has an account — added to the workspace" /
  "already a member"), not an
  error.

## Error handling

- Server: 404 invite not found / wrong workspace; 400 on `accepted` for **both** cancel and
  resend; `plan_limit_exceeded` (403) on a resend that would exceed `max_team_members`;
  GoTrue/Resend failures mid-resend keep `invite-user`'s rollback semantics (no phantom pending
  row) and surface as a generic error toast.
- Client: card-level error state with retry on fetch failure; action buttons disabled while an
  action is in flight.

## Testing

- **Deno**: moved-module tests keep passing with updated paths; new tests for
  `_shared/invite-actions.ts` (resend routing per classification — incl. `add-direct` → adds
  member rather than destroying the invite (finding 2), and the seat pre-check rejecting an
  over-limit resend (finding 3); `cancelInvite`'s refuse-`accepted` guard (finding 1) and
  refuse-to-delete-onboarded guard; the affected-workspace_ids capture for cross-workspace audit
  (finding 5); `getAuthStatesByEmails` single-scan batching) and for the three `platform-admin`
  actions (admin gate, wrong-workspace rejection, status-based action rules, `accepted` → 400),
  following the `plan-mutations` DI test pattern.
- **Frontend (RTL)**: `WorkspaceInvitesCard` — chip derivation across all six auth states (incl.
  the finding-4 "account exists (no send recorded)" vs "email sent, never opened" split), action
  visibility per status, confirm-dialog copy, truncation notice when `total > 50`, refetch after
  action.
- **Gates before pushing**: `npm run test`, `npm run build:admin` (finding 7 — the admin app is
  modified, so typecheck it), `deno test supabase/functions/`, `npm run lint`,
  `npm run format:check`. After the deno run, restore `deno.lock` **only if the run dirtied that
  file alone** (`git checkout -- deno.lock`) — `test:functions` always touches it; never blanket-
  discard other changes.
- **Live verification**: on prod, open Araripe MKT's workspace detail — the panel must show the
  historical `silent_add` rows and the typo invite (`iara41ia@gmail.com`, unconfirmed user with a
  recorded send) as "email sent, never opened".

## Deployment

- No migrations.
- `invite-user` and `platform-admin` MUST deploy **together** (shared-module extraction), each
  with `--use-api` (local Docker bundler is broken for this dep tree) and the correct
  `--project-ref`. Staleness check after deploy: `functions list` version vs `entrypoint_path`
  suffix.
- Frontend ships via the normal Vercel build (admin app).
