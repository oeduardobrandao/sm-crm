# Admin — "Last activity" column on the Workspaces page

**Date:** 2026-07-16
**Status:** Approved, ready for implementation

## Goal

Let a platform admin see, from the Workspaces list, which workspaces are actively used and
which have gone quiet — without opening each one.

## Problem

There is no last-access data in the schema. `workspaces` carries only `created_at`, and no
`last_seen` / `last_active` column exists anywhere. So the column cannot surface an existing
field; a source has to be chosen.

## Decisions

> **Revised 2026-07-16 after the first cut shipped wrong.** The original source below
> (`audit_log` alone) was mistaken and is superseded by "Revision" at the end of this doc.
> Read that section first — the reasoning here is kept because the mistake is instructive.

| Decision | Choice | Why |
|---|---|---|
| Source | ~~`max(audit_log.created_at)` per `conta_id`~~ → see Revision | Real actions, and history already exists, so the column is useful on day one |
| Scope | Display + dormant highlight | Answers "who's dormant" at a glance; sorting would need DB-side aggregation |
| Threshold | Tiered 7d / 30d | Shows a workspace cooling off before it's fully dead |
| Never active | `Nunca`, dormant unless the workspace itself is new | A brand-new workspace has not had a chance to be used |
| Index | Add composite `(conta_id, created_at DESC)` | Keeps the lookup a top-1 index hit as `audit_log` grows |

### Sources considered and rejected

- **`auth.users.last_sign_in_at`** — Supabase only updates it on an actual sign-in, not on
  token refresh. Daily users on persistent sessions would look months-stale, making live
  workspaces read as dead. Rejected: it would misinform the exact decision this column exists for.
- **New `last_seen_at` + heartbeat** — most faithful to "actively used" (catches read-only
  browsing), but needs a migration, a client write path, an edge deploy, and starts empty, so
  the column stays blank for months. Rejected for now as disproportionate.

### Known blind spot

`audit_log` is written only where `insertAuditLog` is called (17 edge functions: approvals,
deletions, bulk ops, MCP, Estúdio). A workspace whose users only *browse* records nothing and
will read as dormant. Accepted: this measures meaningful work, not page views.

## Design

### Data contract

`WorkspaceSummary` gains one additive field:

```ts
last_activity_at: string | null; // ISO timestamp; null = no audited activity ever
```

No existing test asserts this shape, and the only platform-admin deno test covers plan
mutations, so the addition is non-breaking.

### Backend — `supabase/functions/platform-admin/index.ts`

In `handleListWorkspaces`, inside the enrichment `Promise.all` that already issues ~5 queries
per workspace, add:

```ts
const { data: lastAudit } = await svc
  .from("audit_log")
  .select("created_at")
  .eq("conta_id", ws.id)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
```

Returned as `last_activity_at: lastAudit?.created_at ?? null`. Page size is 20, so this adds
20 top-1 lookups per page.

### Migration

```sql
CREATE INDEX IF NOT EXISTS idx_audit_log_conta_created
  ON audit_log (conta_id, created_at DESC);
```

Additive and safe. Prod `db push` is blocked by a duplicate-timestamp migration, so apply via
the SQL editor and record the version manually.

### Frontend — pure rule module

`apps/admin/src/pages/workspace-activity.ts` (mirrors `plan-form.ts` / `login-error.ts`:
logic lives in a pure, unit-tested module, not in the component).

```ts
export type ActivityTone = 'active' | 'cooling' | 'dormant';

export function describeActivity(
  lastActivityAt: string | null,
  createdAt: string,
  now: Date,
): { label: string; tone: ActivityTone }
```

Rules:

| Condition | Label | Tone |
|---|---|---|
| activity ≤ 7 days ago | relative ("há 3 dias") | `active` |
| activity 8–30 days ago | relative | `cooling` |
| activity > 30 days ago | relative | `dormant` |
| never, workspace < 30 days old | `Nunca` | `cooling` |
| never, workspace ≥ 30 days old | `Nunca` | `dormant` |

Boundaries are inclusive at 7 and 30 days (`≤ 7` is active; `≤ 30` is cooling). "Never" never
renders as `active` — an unused workspace is never healthy, only ungraded.

Labels use `Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })`, matching the page's
existing native-`Intl` date handling (`toLocaleDateString('pt-BR')`). No new dependency.
Headers stay English, matching the rest of the admin UI.

### Frontend — presentation

`WorkspacesPage.tsx`:

- Desktop grid grows from 8 to 9 columns; "Last activity" sits after "Created".
- Mobile card gains one line alongside clients/members.
- Tones map to existing tokens: `cooling` → `text-muted-foreground`, `dormant` →
  the `warning` token already used by the OVERRIDES badge. `active` → default foreground.

## Testing

- Unit tests for `describeActivity`: each tier, both boundaries (exactly 7d, exactly 30d),
  never+new, never+old, same-day.
- `now` is injected, never read from the clock inside the function, so tests are deterministic.
- Full frontend suite + `npm run build:admin` must stay green.

## Revision — `audit_log` alone was the wrong source

Caught in review of live prod data: a workspace ("Araripe MKT") that had Instagram accounts
connected the previous day was rendering amber `mês passado`.

Two defects, one shallow and one fundamental:

1. **`instagram-link` wrote an unattributable audit row.** The call in
   `instagram-integration/index.ts` omitted `conta_id` — the only one of 17 call sites that
   did — so the row landed with `conta_id = NULL` and no per-workspace query could ever see
   it. `verifySignedState` already returned `contaId`/`userId`; the callback simply was not
   destructuring them. Fixed at the source. This is a pre-existing bug: it also means every
   per-workspace view of the audit trail silently missed Instagram links.

2. **`audit_log` does not record what the CRM actually does.** The everyday records —
   `clientes`, `workflow_posts`, `contratos`, `briefings` — are written client-side through
   RLS from `store.ts` and never reach an edge function, so they produce no audit row. Only a
   narrow band of actions (file ops, member management, MCP, Estúdio, reports) is audited. A
   workspace in daily use could read `Nunca` indefinitely.

The original claim that the only blind spot was "read-only browsing" was wrong. Broad coverage
was inferred from 17 varied call sites without checking whether core CRM writes flow through
them. They do not.

### New source: `admin_workspace_last_activity(workspace_ids uuid[])`

`GREATEST` over the timestamps real work leaves behind, one round trip per page:

| Source | Column | Why |
|---|---|---|
| `workflow_posts` | `max(updated_at)` | The core artifact |
| `designs` | `max(updated_at)` | Estúdio work |
| `clientes`, `contratos`, `briefings` | `max(created_at)` | No `updated_at` on these |
| `audit_log` | `max(created_at)` | Keeps the original signal |
| `instagram_accounts` via `clientes` | `max(created_at)` | Connecting is a real human action, and the only workspace-attributable trace it leaves |

`GREATEST` ignores NULLs, returning NULL only when every source is NULL — a workspace where
nothing has genuinely ever happened.

**Excluded: `instagram_accounts.last_synced_at`** and any cron-written column. A background job
touching a row is not a human using the workspace; including it would make every workspace look
alive — the same class of error as the original `audit_log` choice.

**Not backfilled.** Araripe's existing `instagram-link` row keeps `conta_id = NULL`:
`audit_log` carries a deliberate `no_update` policy, and that immutability is worth more than
retrofitting one row. The workspace surfaces correctly anyway via `instagram_accounts.created_at`,
which records the same connection.

**Security.** The RPC is `SECURITY DEFINER` (it must read across every workspace), so execute is
revoked from `PUBLIC`/`anon`/`authenticated` and granted only to `service_role`. Reachable only
through `platform-admin`, which authenticates the caller as a platform admin first. Were it
callable by a workspace user, it would leak activity across all workspaces.

**Failure mode.** An RPC error is logged and degrades to `null` (`Nunca`) rather than failing
the Workspaces page.

## Out of scope

- Sorting/filtering by activity (needs DB-side aggregation — a view or RPC).
- Backfilling activity for workspaces predating `audit_log`.
- Tracking read-only usage.
