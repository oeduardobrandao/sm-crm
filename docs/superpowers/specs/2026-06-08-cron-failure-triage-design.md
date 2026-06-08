# Cron-Failure Auto-Triage

> **Status:** Design approved 2026-06-08.
> Next step: implementation plan via `superpowers:writing-plans`.
> Backlog item from the agent-automation initiative ("Cron-failure auto-triage").

## Overview

Edge-function cron failures today produce a thin Resend email and nothing else.
This feature does two things:

1. **Richer failure capture** — every cron failure is recorded as a structured
   row in a new `cron_failures` table and emailed with full context (counts,
   per-account errors, stack trace, timing) instead of a one-line summary.
2. **Agentic triage** — the moment a failure occurs (deduped by error
   signature), an **Anthropic Routine** (hosted Claude Code) investigates the
   failing cron against this repo, determines the root cause, and files a
   **GitHub Issue** with a diagnosis and a proposed fix plan. No code is changed
   automatically.

The agent's output is **diagnosis + fix plan only** — a GitHub Issue, never an
automated code change. The human decides whether to act.

## Goals

- Failure emails carry enough detail to act on without opening Supabase logs.
- Every distinct failure produces a root-cause analysis + concrete fix plan,
  filed as a GitHub Issue, with no human kicking it off.
- Transient/expected failures (Instagram API hiccups, token expiry) don't spawn
  redundant agent runs or duplicate issues.
- Backend stays the source of truth; the agent host never holds a Supabase
  service-role key.
- ToS-clean: the agent runs as first-party Claude Code (a Routine), not a
  subscription OAuth token wired into third-party CI.

## Non-Goals (YAGNI for v1)

- Automated code fixes / draft PRs. (Issue + plan only; PRs can be a later
  iteration if the diagnosis quality proves out.)
- Pulling raw Supabase platform logs via the Management API. (Richer
  in-function capture covers ~95% of what's useful with no extra token.)
- An in-app admin view of failures / issues. (The `cron_failures` table + GitHub
  issues are enough; a UI can layer on later.)
- Throttling the **email** (only the agent is deduped — email keeps firing on
  every failure for real-time visibility).
- Triage for non-cron edge functions (JWT/OAuth/hub functions).

## Engine decision (and why)

The triage agent must read the codebase with tools (Read/Grep, trace the failing
path) — a tool-less LLM call can't do real root-cause analysis. Three auth/host
paths were evaluated:

- **Subscription `CLAUDE_CODE_OAUTH_TOKEN` in GitHub Actions** — rejected.
  Consumer Terms scope subscription OAuth tokens to "Claude Code and claude.ai";
  using one to drive `claude-code-action` in CI is a gray area, and Anthropic
  recommends the Console API key for company automation. (Also: from
  2026-06-15, subscription tokens used in CI/SDK draw from a separate Agent-SDK
  credit pool.)
- **Console `ANTHROPIC_API_KEY` + GitHub Actions** — viable, ToS-clean, metered.
  Held in reserve as the fallback if Routines don't work out.
- **Anthropic Routine (chosen)** — a hosted Claude Code config (prompt + repo +
  GitHub connector) triggered by an HTTP webhook (`/fire`). Running a Routine
  *is* first-party Claude Code, so subscription billing is compliant. Anthropic
  hosts the agent and the repo; the backend just POSTs the failure payload.

**Research-preview caveats (accepted):** the `/fire` endpoint and its
`anthropic-beta` header are dated/versioned and may change (verify against docs
at implementation time, do not hard-code from memory); the routine is owned by
an individual claude.ai account (not the org) and has per-account hourly trigger
caps during preview. The signature cooldown keeps firing volume far under any
cap. If the preview is retired or proves unstable, the fallback is the Console
API key + GitHub Actions path (the Supabase-side half of this design is
unchanged in that case — only the trigger swaps from `/fire` to
`repository_dispatch`).

## Architecture / Data Flow

```
cron fails (instagram-sync-cron, instagram-refresh-cron,
            instagram-publish-cron, report-worker, + their top-level catch)
  │
  └─ reportCronFailure(supabase, cronName, detail)         [_shared/triage.ts]
       ├─ signature = computeSignature(cronName, errorMessage)
       ├─ INSERT row → cron_failures (structured detail jsonb)
       ├─ sendCronFailureEmail(cronName, detail)           [_shared/notify.ts]
       │     → Resend, enriched HTML, fires on EVERY failure
       └─ cooldown check: max(triage_dispatched_at) for this signature
            within TRIAGE_COOLDOWN_HOURS?
              yes → skip (already recorded + emailed; no agent run)
              no  → UPDATE row.triage_dispatched_at = now()
                    POST <TRIAGE_ROUTINE_URL>/fire
                      Authorization: Bearer <TRIAGE_ROUTINE_TOKEN>
                      anthropic-beta: <dated routine header>   # verify at impl
                      anthropic-version: 2023-06-01
                      Content-Type: application/json
                      body: { "text": renderFailureReport(cronName, detail, signature) }
  ▼
Anthropic Routine (hosted Claude Code — configured once in claude.ai)
  ├─ saved prompt + this repo mounted + GitHub connector (issues: read/write)
  ├─ reads the failure report from `text` (treated as UNTRUSTED input)
  ├─ locates the failing cron + traces the code path in the repo
  ├─ dedup: search OPEN issues for label `cron-triage:<signature>`
  │      found → add a "recurred at <time>" comment
  │      none  → create issue, labels: `cron-triage` + `cron-triage:<signature>`
  └─ issue body: root cause, evidence (file:line), proposed fix plan, confidence
```

The POST carries the **entire failure payload** in `text`, so the routine needs
no Supabase access — same "stateless toward the backend" property the GitHub
Actions design had.

## Components

### 1. Supabase migration — `cron_failures` table

`supabase/migrations/<timestamp>_cron_failures.sql`

| column | type | notes |
|---|---|---|
| `id` | uuid PK, `gen_random_uuid()` | |
| `cron_name` | text not null | e.g. `instagram-sync-cron` |
| `signature` | text not null | normalized dedup key |
| `error_message` | text | top-level message |
| `error_detail` | jsonb not null default `'{}'` | `{ stack, total, failed, errors:[{accountId,error}], context }` |
| `occurred_at` | timestamptz not null default `now()` | |
| `triage_dispatched_at` | timestamptz null | set when `/fire` succeeds; cooldown anchor |

- **RLS enabled, zero policies** → only the service role (which crons use) can
  read/write. No client/anon access.
- Index: `create index on cron_failures (signature, triage_dispatched_at desc);`
- No `github_issue_url` column — the routine has no Supabase creds to write it
  back, so it would always be null. The GitHub issue + signature label is the
  durable link.

### 2. `_shared/triage.ts` (new)

- `computeSignature(cronName: string, errorMessage: string): string`
  Lowercases `${cronName}:${errorMessage}` and replaces volatile tokens so
  transient IDs collapse to one signature:
  - UUIDs → `<uuid>`
  - ISO-8601 timestamps → `<ts>`
  - long hex / token-like runs → `<hex>`
  - standalone digit runs → `<n>`
  Then trims/truncates to a bounded length. Deterministic and pure (unit-tested).
- `renderFailureReport(cronName, detail, signature): string`
  Builds the human-readable text blob sent as `text` to the routine: cron name,
  signature, total/failed counts, per-account error list, stack, occurred-at.
- `reportCronFailure(supabase, cronName, detail): Promise<void>`
  Orchestrates: compute signature → insert row → `sendCronFailureEmail` →
  cooldown query → conditionally `UPDATE triage_dispatched_at` + POST `/fire`.
  **Never throws** — all failure paths (DB error, Resend error, `/fire` non-2xx
  or network error) are caught and logged with a generic message so the cron is
  never broken by triage plumbing. Cooldown window from
  `TRIAGE_COOLDOWN_HOURS` (default `24`).

`CronFailureDetail` type (shared): `{ total?: number; failed?: number;
errors?: Array<{ accountId?: string; error?: string }>; stack?: string;
context?: Record<string, unknown> }`.

### 3. `_shared/notify.ts` (refactor)

- Rename/replace `notifyCronFailure` with `sendCronFailureEmail(cronName,
  detail)`. Same Resend call (`alertas@mesaas.com.br` → `ALERT_EMAIL`), but the
  HTML body is enriched: cron name, total/failed counts, a per-account error
  table, the stack trace in a `<pre>`, and occurred-at.
- **Security:** all interpolated error strings, account IDs, and stack text are
  passed through `escapeHTML()` before going into the HTML body (CLAUDE.md rule).
- Returns silently if `RESEND_API_KEY`/`ALERT_EMAIL` are unset (current
  behavior).

### 4. Caller updates (4 functions)

Switch `notifyCronFailure(name, summary)` → `reportCronFailure(supabase, name,
detail)`, and capture `err.stack` into `detail` at the top-level `catch`:

- `supabase/functions/instagram-sync-cron/index.ts`
- `supabase/functions/instagram-refresh-cron/index.ts`
- `supabase/functions/instagram-publish-cron/index.ts`
- `supabase/functions/report-worker/index.ts`
- (each file's inner per-account loop already collects `errors[]`; the change is
  passing the existing `supabase` service-role client + adding `stack` in the
  outer catch)

### 5. Routine configuration (control plane — outside the repo, documented in it)

The Routine is created **once** in claude.ai (research preview). It can't be
fully provisioned from code, so its exact config is checked into the repo for
reproducibility at `docs/cron-triage-routine.md`:

- **Repo:** this repository (read access).
- **Connector:** GitHub, scoped to **issues read/write only** (no code push, no
  merge) — least privilege; the agent's only write capability is filing/commenting
  on issues. (If preview connector scoping is coarser, note the actual scope.)
- **Trigger:** API/webhook (`/fire`).
- **Saved prompt** (full text in the doc): instructs the agent to treat the
  incoming `text` as an **untrusted failure report**, locate the failing cron in
  the repo, trace the root cause, check for an existing open issue labeled
  `cron-triage:<signature>` (comment if found, else create), and write an issue
  with root cause, evidence (`file:line`), a concrete proposed fix plan, and a
  confidence level. The fix plan is prose — it must not push code.

### 6. Secrets

Two new Supabase secrets (set via `npx supabase secrets set`):

- `TRIAGE_ROUTINE_URL` — the routine's base/fire URL.
- `TRIAGE_ROUTINE_TOKEN` — the routine's bearer token (`sk-ant-oat01-…`).

No `ANTHROPIC_API_KEY`, no `CLAUDE_CODE_OAUTH_TOKEN`, no GitHub PAT on the
backend. The routine's own GitHub connector handles issue creation.

`TRIAGE_COOLDOWN_HOURS` (optional, default `24`) tunes the dedup window.

## Dedup (two layers)

1. **Edge-function cooldown (primary):** before firing, query
   `cron_failures` for the latest `triage_dispatched_at` for this `signature`.
   If it's within `TRIAGE_COOLDOWN_HOURS`, skip the `/fire` call (the row is
   still inserted and the email still sent). This bounds agent runs and keeps us
   under the routine's hourly cap.
2. **Routine open-issue check (secondary):** the agent searches for an open
   issue labeled `cron-triage:<signature>` and comments instead of duplicating.
   Guards the case where the cooldown lapses while an issue is still open.

## Security

- **No service-role key leaves the backend** — the failure payload travels in
  the `/fire` body; the routine never touches Supabase.
- **`/fire` failures never break the cron** — `reportCronFailure` catches all
  errors and logs generic messages (CLAUDE.md: never return/log raw error
  details to clients; here, never let triage plumbing throw into the cron).
- **Untrusted error text → prompt-injection surface.** Error messages and
  account IDs originate from external APIs and flow into the routine prompt. The
  routine's tool surface is constrained to issues read/write (no code push, no
  arbitrary shell), so the worst case is a malformed/empty issue — low blast
  radius. The saved prompt explicitly frames the `text` as untrusted data.
- **Email escaping** — all user/external strings pass through `escapeHTML()`.
- **Secrets** — `TRIAGE_ROUTINE_TOKEN` is a Supabase secret, never logged.
- **`cron_failures` RLS** — service-role only; no client access.

## Testing

Deno tests under `supabase/functions/__tests__/`:

- `computeSignature` — same logical error with different UUIDs/timestamps/IDs
  produces one signature; genuinely different errors produce different ones.
- `reportCronFailure` cooldown — with a mocked Supabase client + mocked `fetch`:
  fires `/fire` when no recent dispatch; skips when within cooldown; always
  inserts the row and calls the email path; never throws when `fetch`/DB reject.
- `sendCronFailureEmail` — HTML escapes error strings (no raw `<`/`>` from error
  text in the body).

Manual validation: trigger one routine run (deploy, force a controlled cron
failure or POST a synthetic payload to `/fire`) and confirm an issue is filed
with a sensible diagnosis; then trigger the same signature again within the
cooldown and confirm no second run / a "recurred" comment rather than a dup.

`npm run build` (tsc) for the type changes; deno tests for the functions.

## Deployment

- `npx supabase db push --linked` for the migration (dry-run first;
  prod=`skjzpekeqefvlojenfsw`, staging=`wlyzhyfondykzpsiqsce`).
- Redeploy the 4 cron functions (`--no-verify-jwt` as required for crons).
- Set the two new secrets in Supabase.
- Create + enable the Routine in claude.ai per `docs/cron-triage-routine.md`.
- Caution (Deno/npm gotcha): running `deno test` can pollute `deno.lock` /
  shared `node_modules` and break `npm run build` — if so,
  `git checkout deno.lock && npm ci`.

## Open questions / to verify at implementation time

- Exact `/fire` URL shape + current `anthropic-beta` routine header (research
  preview — read the docs, don't assume `experimental-cc-routine-2026-04-01`).
- Whether preview GitHub-connector scoping can be limited to issues-only; if
  not, document the actual granted scope.
- Confirm the routine can apply labels (`cron-triage:<signature>`); if label
  creation needs pre-seeding, create the base `cron-triage` label up front.
