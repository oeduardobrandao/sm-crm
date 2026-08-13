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
  already proved (claim-first delivery, deadline release, failure reset,
  skip-without-claiming when Resend is unconfigured), hardened into a single
  atomic claim to close the removed-user and opt-out-race gaps.
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
manage only their own rows. The cron reaches these rows only through the atomic
claim RPC (below), running as `service_role`.

### Delivery — supersede the mention cron

A new edge function **`notification-email-cron`** supersedes
`mention-email-cron`. Running a second cron over the same table would fight over
`emailed_at` for `mention` rows, so the new cron owns all eight types and the old
one is retired (function left dormant; its pg_cron job unscheduled).

The new cron keeps the mention cron's two-layer shape verbatim
(`handler.ts` = DI business logic; `index.ts` = auth wrapper + bounded
`global.fetch`) and every reliability property:

- **Claim-first, single atomic statement** (see "The atomic claim" below):
  one `UPDATE … RETURNING` embeds every predicate (type set, window,
  `read/dismissed/emailed IS NULL`, workspace membership, preference opt-out) so
  the send/no-send decision is atomic with the claim. `FOR UPDATE SKIP LOCKED`
  keeps concurrent runs disjoint. This is a deliberate departure from the mention
  cron's two-call (SELECT-then-UPDATE) shape, forced by the P0/P1 findings below.
- `CLAIM_BATCH_SIZE = 100`, `SEND_DEADLINE_MS = 60_000` soft budget releasing
  unprocessed claims (`emailed_at → NULL`) so the next run retries them.
- Per-user send failure → best-effort claim reset (`emailed_at → NULL`).
- `RESEND_API_KEY` unset (staging) → **skip without claiming**, so rows stay
  eligible for when a key is configured.
- Errors → `reportCronFailure(svc, 'notification-email-cron', …)`.
- Every I/O bounded by `AbortSignal.timeout(10_000)`.

**Delivery guarantee — at-most-once *claim*, at-least-once *delivery*.** The claim
stamps `emailed_at` atomically, so no two runs email the same row twice on the
happy path. But the per-user failure reset (and deadline release) set
`emailed_at → NULL` to retry, and Resend has no server-side transaction with us:
a timeout *after* Resend accepted the request resets the rows and re-sends next
run. To deduplicate the common case, each digest send carries a Resend
`Idempotency-Key` derived from the sorted set of claimed notification ids (the
pattern `_shared/lifecycle-emails.ts` already uses); an identical re-claim within
Resend's 24h window is 409'd (treated as success). Residual, accepted: if a *new*
qualifying notification arrives for that user inside the ~5-min retry gap, the
re-claim is a superset, the key differs, and one or two lines can repeat. Losing a
"your post failed to publish" email is worse than a rare repeated line, so the
mention cron's retry-on-failure stance is kept, not inverted.

### The atomic claim (closes the opt-out race AND the removed-user leak)

Two invariants must hold, and neither survives a two-call *select-then-claim*
design where a candidate RPC picks rows and a separate `UPDATE` claims them:

1. **An opted-out / master-paused notification must never be claimed.** Claiming
   stamps `emailed_at`, which would both email it and suppress it in the bell
   forever. A user who opts out *between* a candidate SELECT and the claim UPDATE
   would still be emailed.
2. **A user removed from a workspace must never be emailed its content.** Nothing
   deletes a removed user's `notifications` rows (verified: no cleanup on
   `workspace_members` delete; `notify_member_removed` only *inserts*), and the
   bell's RLS is `user_id = auth.uid()` with no membership check. With the type
   set broadened to real client content (`client_message`, `post_message`,
   `post_correction`), an ex-contractor could be emailed a former client's
   message. A candidate-side membership filter alone reopens the same gap in the
   select→claim window.

Both are closed the way the repo's Loops sweep already closes the identical
removal race ([`claim_marketing_email`](../../supabase/migrations/20260803000004_loops_sync_rpcs.sql),
lines 36–100): **make every predicate part of one atomic claim.** A single
SECURITY DEFINER RPC (owned by postgres, `EXECUTE` to `service_role` only —
`REVOKE FROM PUBLIC` also strips `service_role` on this instance, so grant
explicitly and verify with `proacl`):

```sql
claim_notification_emails(
  p_settle_before timestamptz,   -- now - 10 min
  p_after         timestamptz,   -- now - 24 h
  p_limit         int            -- CLAIM_BATCH_SIZE
) RETURNS TABLE (id uuid, user_id uuid, type text, metadata jsonb,
                 link text, created_at timestamptz)
```

Body claims and returns in one statement:

```sql
UPDATE notifications n SET emailed_at = now()
WHERE n.id IN (
  SELECT n2.id FROM notifications n2
  WHERE n2.type = ANY(<the 8 types>)
    AND n2.read_at IS NULL AND n2.dismissed_at IS NULL AND n2.emailed_at IS NULL
    AND n2.created_at <= p_settle_before AND n2.created_at >= p_after
    -- (P0) recipient must still belong to the workspace
    AND EXISTS (SELECT 1 FROM workspace_members wm
                WHERE wm.workspace_id = n2.workspace_id AND wm.user_id = n2.user_id)
    -- (P1) preference opt-out / master pause, evaluated at claim time
    AND NOT EXISTS (SELECT 1 FROM notification_email_prefs p
                    WHERE p.user_id = n2.user_id AND p.enabled = false
                      AND (p.type = n2.type OR p.type = '__all__'))
  ORDER BY n2.created_at ASC
  LIMIT p_limit
  FOR UPDATE SKIP LOCKED
)
RETURNING n.id, n.user_id, n.type, n.metadata, n.link, n.created_at;
```

`FOR UPDATE SKIP LOCKED` on the inner select makes concurrent cron runs disjoint
without relying on the `emailed_at` re-check alone. The **preference-change and
membership cutoff is therefore the claim instant**: a user who opts out or is
removed before this statement evaluates its `WHERE` is excluded; one who does so
after is already claimed (and, for membership, this is a courtesy copy of a bell
notification they can no longer see anyway — bounded and acceptable). The cron's
`handler.ts` calls this via `db.rpc(...)` and receives the claimed rows directly;
release/reset paths keep NULL-ing `emailed_at` by id as before (no membership
re-check needed — they only make a row eligible again).

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

1. **Publish failures** — rendered with `getPublishErrorDisplay()` from
   `_shared/publish-error-codes.ts` (reused), keyed off the failure's error code
   in `metadata`. That helper returns `{ titulo, explicacao }` — **there is no
   separate `solução` field**; `explicacao` already carries the actionable "faça
   X" guidance (e.g. "Reconecte a conta na página do cliente e reagende o post").
   The digest line shows `titulo` as the heading and `explicacao` as the body.
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
deadline release, per-user failure reset, skip-without-claiming on missing key,
bounded fetch, `reportCronFailure` on failure. Delivery is at-most-once *claim* /
at-least-once *delivery* (see "Delivery guarantee" above): a crash between claim
and send loses at most that one digest, and a timeout-after-accept can repeat it,
deduped best-effort by the Resend idempotency key. Both are accepted because email
is a courtesy copy of the reliable in-app bell. The only new pieces are the atomic
claim RPC (which mirrors the Loops `claim_marketing_email` precedent) and the
idempotent preference upserts.

## Testing

- **Deno** (`test:functions`), extending the mention-cron suite:
  - digest groups per user and orders sections by the urgency priority;
  - claim/release/deadline and per-user failure reset paths (inherited);
  - `RESEND_API_KEY` unset → skip without claiming;
  - the idempotency key is stable for an identical re-claim and differs when the
    claimed id set changes.
- **Entitlement / RLS + atomic claim** (`entitlement-tests`, psql — this suite
  IS gated by CI): the `claim_notification_emails` predicates, which are the
  security boundary and can only be exercised against a real database:
  - an opted-out type and a `'__all__'` master-paused user are never claimed
    (`emailed_at` stays NULL, row still visible in the bell);
  - a notification whose `user_id` is no longer in `workspace_members` for its
    `workspace_id` is never claimed (the P0 removed-user leak);
  - concurrent claims are disjoint (`FOR UPDATE SKIP LOCKED`);
  - a user can select/update only their own `notification_email_prefs` rows, and
    the claim RPC is not executable by `authenticated`.
- **Vitest** (frontend): `NotificacoesTab` renders all types, toggles persist,
  master pause round-trips.

**Full local verification before pushing** (this is a contract change to the cron
and the shared email module, and it touches four projects' typechecks). Run the
same gates CI runs, not just the two test commands:

```bash
npx tsc -p apps/crm/tsconfig.json   --noEmit
npx tsc -p apps/hub/tsconfig.json   --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run lint
npm run format:check          # npm run format auto-fixes
npm run test                  # Vitest
npm run test:functions        # deno test (reverts root deno.lock afterward)
```

`entitlement-tests` needs Docker/colima locally but is enforced by CI regardless.

## Deploy order

Ordering matters because the reschedule fires immediately (same rule as
`20260803000007` / `20260730000002`):

0. Add the tracked `supabase/config.toml` entry
   `[functions.notification-email-cron]` / `verify_jwt = false`, mirroring the
   existing `[functions.mention-email-cron]` block. The `--no-verify-jwt` deploy
   flag works for the one-off deploy, but without the config.toml entry local
   `functions serve` and later config-driven deploys would verify JWT and 401 the
   cron. Commit it with the code.
1. Deploy the **`notification-email-cron`** function (`--no-verify-jwt --use-api`).
2. Apply the migration bundle in one `db push`:
   - `notification_email_prefs` table + RLS + grants;
   - `claim_notification_emails()` atomic-claim RPC (explicit `service_role`
     grant, verified via `proacl`);
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
