# Agency-user notification emails — design

**Date:** 2026-08-13
**Status:** Approved (design), pending spec review → implementation plan
**Author:** brainstormed with Eduardo

## Problem

Agency team members get **no** email for their own in-app notification events
beyond `mention`. The `notifications` bell (≈20 types) is otherwise in-app only,
so a scheduled post that silently fails to publish, a client who requested
changes, a new client message, an approaching deadline, or a task just assigned
to you are all invisible until you happen to log in and open the bell. The
`mention` email (shipped in PR #287) is the single exception.

This design adds email delivery for a curated, high-value subset of notification
types, delivered as **one consolidated digest** per user, gated by **per-user,
per-type opt-out preferences**, reusing the proven claim-first cron machinery the
mention email already runs on.

Out of scope: emailing the agency's **end clients** (`clientes`). Clients are not
`auth.users` and never appear in the `notifications` table, so client-facing
event emails are a separate, net-new outbound path — deferred to its own spec.

## Goals

- Email agency users about events where a *missed* one has real cost (someone is
  blocked/waiting, or work was assigned to them personally).
- Never recreate the spam problem the bell was built to avoid: a curated type
  set + per-type opt-out + a master "pause all" switch + a settle window that
  only emails what wasn't already caught in-app.
- Reuse, not reinvent: inherit every reliability property the mention cron
  already proved (claim-first at-most-once, deadline release, failure reset,
  skip-without-claiming when Resend is unconfigured).
- Retroactively give the existing `mention` email an opt-out by folding it into
  the same system.

## Non-goals

- Client-facing (Hub) event emails.
- Per-workspace preference granularity (preferences are per-user, global).
- Real-time / instant email. A ~5–15 min digest latency is acceptable and
  desirable (it lets the settle window suppress anything read in-app first).
- SMS / push / any channel other than email.

## Scope: which notification types email

Eight types become email-worthy. Everything else stays bell-only.

| Type | Recipients today | Tier | Rationale |
|---|---|---|---|
| `post_publish_failed` | owners/admins | A | A scheduled post silently died; needs republish |
| `post_correction` | owners/admins + responsável | A | Client asked for changes; client is waiting |
| `post_message` | owners/admins + responsável | A | Client wrote on a post |
| `client_message` | owners/admins | A | Client sent a message (consolidated feed) |
| `deadline_approaching` | responsável + owners/admins | A | Step due tomorrow |
| `task_assigned` | assignee | B | You personally got a task |
| `post_assigned` | assignee | B | You personally got a post |
| `mention` | mentioned user | — | Folds in; picks up the new opt-out |

Recipients are already resolved correctly by the existing triggers /
`resolve_notification_targets`. This design changes nothing about **who** gets a
notification — only whether that user *also* receives an email.

## Architecture

### Reuse the existing substrate

The `notifications` table already carries everything needed: `user_id`
(→ `auth.users`), `workspace_id`, `type`, `metadata jsonb`, `link`, `read_at`,
`dismissed_at`, `emailed_at` (added by `20260803000006_mencoes`), `created_at`.
No schema change to `notifications` itself, except see "Publish-failure metadata"
below.

### Data model — per-user preferences

New table, per-user (global across their workspaces), storing **only overrides**:

```sql
CREATE TABLE notification_email_prefs (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type     text NOT NULL,   -- one of the 8 email-worthy types, or '__all__'
  enabled  boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type)
);
```

- **No row = default ON.** A user with zero rows is opted in to all eight.
- A row `(user, type, false)` = opted out of that one type.
- The reserved `type = '__all__'` row is the **master pause**: `enabled=false`
  suppresses every email for that user.
- A `type` CHECK constrains values to the eight types plus `'__all__'`.

**RLS:** `user_id = auth.uid()` for SELECT / INSERT / UPDATE / DELETE. Users
manage only their own rows. The cron reads through the candidate RPC as
`service_role`.

### Delivery — supersede the mention cron

A new edge function **`notification-email-cron`** supersedes
`mention-email-cron`. Running a second cron over the same table would fight over
`emailed_at` for `mention` rows, so the new cron owns all eight types and the old
one is retired (function left dormant; its pg_cron job unscheduled).

The new cron keeps the mention cron's two-layer shape verbatim
(`handler.ts` = DI business logic; `index.ts` = auth wrapper + bounded
`global.fetch`) and every reliability property:

- **Claim-first at-most-once**: eligibility read → `UPDATE ... SET emailed_at
  RETURNING`, re-checking `emailed_at/read_at/dismissed_at IS NULL` at claim time
  to keep concurrent runs disjoint and to skip anything read/dismissed in the gap.
- `CLAIM_BATCH_SIZE = 100`, `SEND_DEADLINE_MS = 60_000` soft budget releasing
  unprocessed claims (`emailed_at → NULL`) so the next run retries them.
- Per-user send failure → best-effort claim reset.
- `RESEND_API_KEY` unset (staging) → **skip without claiming**, so rows stay
  eligible for when a key is configured.
- Errors → `reportCronFailure(svc, 'notification-email-cron', …)`.
- Every I/O bounded by `AbortSignal.timeout(10_000)`.

### Preference filtering happens BEFORE the claim

This is the load-bearing invariant. An opted-out (or master-paused) notification
must **never** be claimed, because claiming stamps `emailed_at` and would suppress
that row forever while still leaving it in the bell. So filtering lives in the
eligibility step, not in the send loop.

A new SECURITY DEFINER RPC (owned by postgres, `EXECUTE` to `service_role`):

```sql
get_notification_email_candidates(
  p_settle_before timestamptz,   -- now - 10 min
  p_after         timestamptz,   -- now - 24 h
  p_limit         int            -- CLAIM_BATCH_SIZE
) RETURNS TABLE (id uuid, user_id uuid, type text, metadata jsonb,
                 link text, created_at timestamptz)
```

Body selects from `notifications n` where:

```
n.type = ANY(<the 8 types>)
AND n.read_at IS NULL AND n.dismissed_at IS NULL AND n.emailed_at IS NULL
AND n.created_at <= p_settle_before AND n.created_at >= p_after
AND NOT EXISTS (
  SELECT 1 FROM notification_email_prefs p
  WHERE p.user_id = n.user_id AND p.enabled = false
    AND (p.type = n.type OR p.type = '__all__')
)
ORDER BY n.created_at ASC
LIMIT p_limit
```

The cron then claims exactly those ids via the same
`UPDATE … WHERE id IN (ids) AND emailed_at IS NULL AND read_at IS NULL AND
dismissed_at IS NULL RETURNING id, user_id, type, metadata, link, created_at`.

Optional supporting index to keep the cross-user sweep cheap:
`CREATE INDEX idx_notifications_email_pending ON notifications (created_at)
WHERE read_at IS NULL AND dismissed_at IS NULL AND emailed_at IS NULL;`

### The digest email

New shared module `_shared/notification-email.ts` (supersedes
`_shared/mention-email.ts`; the mention rendering folds in). Same visual family as
the other transactional emails (green `#1a3d2b` header, cream page, white 16px
card) so it stays consistent with `mention-email.ts` / `lifecycle-emails.ts` /
`invite-email.ts`.

One email per user per run. Claimed rows are grouped by `user_id`, then within a
user ordered by a fixed **urgency priority**:

1. **Publish failures** — rendered with the actionable título/explicação/solução
   from `getPublishErrorDisplay()` in `_shared/publish-error-codes.ts` (reused),
   keyed off the failure's error code in `metadata`.
2. Client corrections & messages (`post_correction`, `post_message`,
   `client_message`).
3. Approaching deadlines (`deadline_approaching`).
4. Assignments (`task_assigned`, `post_assigned`).
5. Mentions (`mention`).

Each line: a type-specific label + context (client · post/task title), optional
excerpt, and a deep link (`appBaseUrl()` + `notification.link`). All user data
runs through `escapeHtml()`.

**Subject** is count-led: `"Você tem 3 novidades no Mesaas"`; when a single item,
name it (e.g. `"Falha ao publicar um post no Mesaas"`). No em dashes in any
user-facing copy (period / colon / "·" instead).

Sender: the existing `Mesaas <notificacoes@mesaas.com.br>`.

The send function returns `{ skipped: true }` (no throw) when `RESEND_API_KEY` is
unset or the item list is empty, matching `sendMentionEmail`.

### Publish-failure metadata

The digest renders `post_publish_failed` via `getPublishErrorDisplay(errorCode)`.
The `post_publish_failed` notification trigger
(`20260807000003_post_publish_failed_notification.sql`) must therefore carry the
error code in `metadata`. **Implementation must confirm** the trigger already
stores it; if not, add it to the trigger's `jsonb_build_object`. The digest falls
back to a generic "falha ao publicar" line when the code is absent, so a missing
code degrades gracefully rather than breaking the email.

### Preferences UI

A new **Notificações** tab under the existing `/configuracao` layout:

- Route `/configuracao/notificacoes` → `NotificacoesTab.tsx`, registered in
  `pages/configuracao/configTabs.ts` and `App.tsx`. `/configuracao` is already
  covered by the `vercel.json` named route pattern, so a child route needs **no**
  `vercel.json` change (confirm during implementation).
- Unlike the workspace-scoped tabs, this tab edits the **current user's personal**
  preferences and is available to every role.
- A master "Pausar todos os e-mails" switch at the top, then one labeled toggle
  per type with a friendly PT description. `mention` appears here too.
- Data access via new `store.ts` functions — `getNotificationEmailPrefs()`,
  `setNotificationEmailPref(type, enabled)`, `setMasterEmailPause(enabled)` —
  wrapped in TanStack Query `useQuery`/`useMutation` in the component. Writes are
  upserts into `notification_email_prefs`.

## Error handling & reliability

Inherited wholesale from the mention cron (see "supersede the mention cron"):
claim-first at-most-once, deadline release, per-user failure reset,
skip-without-claiming on missing key, bounded fetch, `reportCronFailure` on
failure. A crash between claim and send loses at most that one digest (accepted:
email is a courtesy copy of the reliable in-app bell). No new failure modes are
introduced; the only additions are read-only (the candidate RPC) and idempotent
(pref upserts).

## Testing

- **Deno** (`test:functions`), extending the mention-cron suite:
  - opted-out rows and master-paused users are never returned as candidates (so
    never claimed / `emailed_at` never stamped);
  - digest groups per user and orders sections by the urgency priority;
  - claim/release/deadline and per-user failure reset paths (inherited);
  - `RESEND_API_KEY` unset → skip without claiming.
- **Entitlement / RLS** (`entitlement-tests`, psql): a user can select/update only
  their own `notification_email_prefs` rows; the candidate RPC is not executable
  by `authenticated`.
- **Vitest** (frontend): `NotificacoesTab` renders all types, toggles persist,
  master pause round-trips.
- Full `npm run test` + `npm run test:functions` after the change (contract change
  to the cron + shared email module).

## Deploy order

Ordering matters because the reschedule fires immediately (same rule as
`20260803000007` / `20260730000002`):

1. Deploy the **`notification-email-cron`** function (`--no-verify-jwt --use-api`).
2. Apply the migration bundle in one `db push`:
   - `notification_email_prefs` table + RLS + grants;
   - `get_notification_email_candidates()` RPC;
   - optional `idx_notifications_email_pending`;
   - **unschedule** `mention-email-cron` job, **schedule** `notification-email-cron`
     every `*/5 * * * *` (vault `decrypted_secrets` subselect form, per
     `20260803000007`);
   - (if needed) add error code to the `post_publish_failed` trigger metadata.
3. Deploy the frontend (new settings tab) via the branch merge → Vercel.
4. Optionally undeploy the dormant `mention-email-cron` function after confirming
   the new job runs.

**Migration version prefixes:** pick unique prefixes **above `origin/main`'s
migrations tail at PR-open time** and re-verify right before `gh pr create`
(the `migration-version-guard` CI job fails on duplicates; this project has hit
version collisions more than once). Rollback is the reverse: unschedule the new
job, re-schedule the old, undeploy.

**Staging caveat:** staging has no `RESEND_API_KEY`, so the cron skips
without claiming there. End-to-end email delivery is verified on prod (first real
qualifying event → Resend dashboard).

## Open items to confirm during implementation

1. Whether the `post_publish_failed` trigger already stores the error code in
   `metadata` (add it if not).
2. That `/configuracao/notificacoes` is covered by the existing `vercel.json`
   prefix (expected yes; every other `/configuracao/*` child already works in
   prod).
3. Exact rename mechanics for superseding `mention-email-cron` (new function dir
   + retire old vs. broaden in place) — a plan-level detail; recommendation is a
   new `notification-email-cron` dir with the old left dormant.
