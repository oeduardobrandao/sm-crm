# Cron-Failure Auto-Triage

> **Status:** Design approved 2026-06-08. Revised 2026-06-08 after spec review
> (6 findings resolved — see "Review Resolutions" at the end).
> Next step: implementation plan via `superpowers:writing-plans`.
> Backlog item from the agent-automation initiative ("Cron-failure auto-triage").

## Overview

Edge-function cron failures today produce a thin Resend email and nothing else.
This feature does two things, **for the cron functions that already alert on
failure** (`instagram-sync-cron`, `instagram-refresh-cron`,
`instagram-publish-cron`, `report-worker`):

1. **Richer failure capture** — each such failure is recorded as a structured
   row in a new `cron_failures` table and emailed with full context (counts,
   per-account errors, stack trace, timing) instead of a one-line summary.
2. **Agentic triage** — the moment a failure alerts (deduped by error
   signature), an **Anthropic Routine** (hosted Claude Code) investigates the
   failing cron against this repo, determines the root cause, and files a
   **GitHub Issue** with a diagnosis and a proposed fix plan. No code is changed
   automatically.

The agent's output is **diagnosis + fix plan only** — a GitHub Issue, never an
automated code change. The human decides whether to act.

## Goals

- The failure emails that already fire carry enough detail to act on without
  opening Supabase logs.
- Every distinct alerting failure produces a root-cause analysis + concrete fix
  plan, filed as a GitHub Issue, with no human kicking it off.
- Transient/expected failures (Instagram API hiccups, token expiry) don't spawn
  redundant agent runs or duplicate issues.
- Triage plumbing never breaks a cron — every step is best-effort.
- Backend stays the source of truth; the agent host never holds a Supabase
  service-role key.
- ToS-clean: the agent runs as first-party Claude Code (a Routine), not a
  subscription OAuth token wired into third-party CI.

## Scope

**In scope:** the 4 cron functions that call `notifyCronFailure` today
(`instagram-sync-cron`, `instagram-refresh-cron`, `instagram-publish-cron`,
`report-worker`). `reportCronFailure` is a **1:1 replacement at the existing
notification call sites** — it fires exactly where the email fires today, no
more, no less. (Concretely: `report-worker` only alerts after retry exhaustion,
`report-worker/index.ts:131,247` — so it triages on retry exhaustion only, not
on every `return 500`.)

**Out of scope (pre-existing gap, not introduced here):** the cron functions
that currently swallow failures without alerting at all —
`analytics-report-cron`, `notification-deadline-cron`,
`notification-cleanup-cron`, `express-post-cleanup-cron`,
`post-media-cleanup-cron`, `invite-expire-cron`,
`post-media-backfill-thumbnails`. Adding failure alerting to those is a separate
follow-on; once they call `reportCronFailure`, they get triage for free, but
deciding *where* each should fire (first failure vs retry exhaustion) is its own
task.

## Non-Goals (YAGNI for v1)

- Automated code fixes / draft PRs. (Issue + plan only; PRs can be a later
  iteration if the diagnosis quality proves out.)
- Pulling raw Supabase platform logs via the Management API. (Richer
  in-function capture covers ~95% of what's useful with no extra token.)
- An in-app admin view of failures / issues.
- Throttling the **email** (only the agent is deduped — email keeps firing on
  every failure for real-time visibility).
- Triage for non-cron edge functions, or for the 7 currently-silent crons (see
  Scope).

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
unchanged in that case — only the trigger swaps from POSTing `/fire` to
`repository_dispatch`).

## Architecture / Data Flow

```
cron fails — at an existing notifyCronFailure call site
             (instagram sync/refresh/publish; report-worker on retry exhaustion)
  │
  └─ reportCronFailure(supabase, cronName, detail)         [_shared/triage.ts]
       │   { signature, hash } = computeSignature(cronName, errorMessage)
       │
       ├─ (step 1, best-effort) INSERT row → cron_failures
       ├─ (step 2, ALWAYS)      sendCronFailureEmail(cronName, detail)  [Resend]
       └─ (step 3, best-effort, independent of step 1)
              claimed = rpc claim_cron_triage(hash, cronName, cooldownSecs)
              if claimed:                          # atomic — see Dedup
                POST <TRIAGE_ROUTINE_URL>          # full /fire endpoint, verbatim
                  Authorization: Bearer <TRIAGE_ROUTINE_TOKEN>
                  anthropic-beta: <dated routine header>   # verify at impl
                  anthropic-version: 2023-06-01
                  Content-Type: application/json
                  body: { "text": renderFailureReport(cronName, detail, signature, hash) }
       (every step wrapped in its own try/catch; reportCronFailure NEVER throws)
  ▼
Anthropic Routine (hosted Claude Code — configured once in claude.ai)
  ├─ saved prompt + this repo mounted + GitHub connector (issues read/write)
  ├─ reads the failure report from `text` (treated as UNTRUSTED input)
  ├─ locates the failing cron + traces the code path in the repo
  ├─ dedup: search OPEN issues for label `cron-triage:<hash>`
  │      found → add a "recurred at <time>" comment
  │      none  → create issue, labels: `cron-triage` + `cron-triage:<hash>`
  └─ issue body: verbose signature, root cause, evidence (file:line),
                 proposed fix plan, confidence
```

The POST carries the **entire failure payload** in `text`, so the routine needs
no Supabase access — same "stateless toward the backend" property the GitHub
Actions design had.

## Components

### 1. Supabase migration

`supabase/migrations/<timestamp>_cron_triage.sql`

**`cron_failures`** — the durable failure log (history + email source).

| column | type | notes |
|---|---|---|
| `id` | uuid PK, `gen_random_uuid()` | |
| `cron_name` | text not null | e.g. `instagram-sync-cron` |
| `signature` | text not null | verbose normalized dedup string |
| `signature_hash` | text not null | short stable hash of `signature` (label/claim key) |
| `error_message` | text | top-level message |
| `error_detail` | jsonb not null default `'{}'` | `{ stack, total, failed, errors:[{accountId,error}], context }` |
| `occurred_at` | timestamptz not null default `now()` | |

Index: `(signature_hash, occurred_at desc)`. No `triage_dispatched_at` column —
the cooldown anchor lives in `cron_triage_state` (see Dedup) so the claim can be
atomic.

**`cron_triage_state`** — the atomic cooldown ledger (one row per signature).

| column | type | notes |
|---|---|---|
| `signature_hash` | text PK | |
| `cron_name` | text not null | last cron that claimed (informational) |
| `last_dispatched_at` | timestamptz not null | anchor for cooldown |

**`claim_cron_triage(p_hash text, p_cron_name text, p_cooldown_seconds int)
returns boolean`** — the atomic claim (single statement, race-free):

```sql
create or replace function claim_cron_triage(
  p_hash text, p_cron_name text, p_cooldown_seconds int
) returns boolean language sql as $$
  insert into cron_triage_state (signature_hash, cron_name, last_dispatched_at)
  values (p_hash, p_cron_name, now())
  on conflict (signature_hash) do update
    set last_dispatched_at = now(), cron_name = excluded.cron_name
    where cron_triage_state.last_dispatched_at
          < now() - make_interval(secs => p_cooldown_seconds)
  returning true;
$$;
```

Returns `true` only when the caller wins the claim (new signature, or the
existing row's `last_dispatched_at` is older than the cooldown). When the
`ON CONFLICT` `WHERE` fails, no row is written and the function returns `NULL`
→ caller skips firing. Two concurrent same-signature failures: exactly one wins.

- **RLS enabled, zero policies** on both tables → service-role only (the crons'
  client). No client/anon access.
- `revoke execute on function claim_cron_triage from anon, authenticated;`
  (service role only).

### 2. `_shared/triage.ts` (new)

- `computeSignature(cronName, errorMessage): { signature: string; hash: string }`
  - `signature`: lowercases `${cronName}:${errorMessage}` and replaces volatile
    tokens so transient IDs collapse — UUIDs → `<uuid>`, ISO timestamps →
    `<ts>`, long hex/token runs → `<hex>`, digit runs → `<n>`. The full verbose
    string (stored + shown in the issue body).
  - `hash`: a **short, GitHub-label-safe** key derived from `signature` — a
    synchronous non-crypto digest (FNV-1a) rendered as base36, ~10 chars,
    `[a-z0-9]`. Used as the `cron_triage_state` PK, the claim key, and the issue
    label `cron-triage:<hash>` (well under GitHub's 50-char label limit).
    Pure/sync (no Web Crypto async) so it stays unit-testable and side-effect-free.
- `renderFailureReport(cronName, detail, signature, hash): string`
  Human-readable text blob sent as `text`: cron name, verbose signature, the
  `hash` (so the agent can apply/look up the `cron-triage:<hash>` label),
  total/failed counts, per-account error list, stack, occurred-at.
- `reportCronFailure(supabase, cronName, detail): Promise<void>`
  **Three isolated best-effort steps, each in its own try/catch; never throws:**
  1. **Insert** the `cron_failures` row. On failure: log generic, continue.
  2. **Email** via `sendCronFailureEmail` — attempted **always**, regardless of
     whether step 1 succeeded (so a DB outage doesn't suppress the alert).
  3. **Claim + fire** — call `claim_cron_triage` (uses `cron_triage_state`, so it
     works even if step 1's insert failed); if it returns `true`, POST the
     payload to `TRIAGE_ROUTINE_URL`. On any failure (RPC error, non-2xx,
     network): log generic, continue.
  Cooldown seconds = `TRIAGE_COOLDOWN_HOURS` (default `24`) × 3600.

`CronFailureDetail` type (shared): `{ total?: number; failed?: number;
errors?: Array<{ accountId?: string; error?: string }>; stack?: string;
context?: Record<string, unknown> }`.

### 3. `_shared/notify.ts` (refactor)

- Rename/replace `notifyCronFailure` with `sendCronFailureEmail(cronName,
  detail)`. Same Resend call (`alertas@mesaas.com.br` → `ALERT_EMAIL`), enriched
  HTML body: cron name, total/failed counts, a per-account error table, the
  stack trace in a `<pre>`, occurred-at.
- **Security:** all interpolated error strings, account IDs, and stack text pass
  through `escapeHTML()` before going into the HTML body (CLAUDE.md rule).
- Returns silently if `RESEND_API_KEY`/`ALERT_EMAIL` are unset.

### 4. Caller updates (4 functions — 1:1 replacement at existing notify sites)

Switch each existing `notifyCronFailure(name, summary)` call to
`reportCronFailure(supabase, name, detail)`, passing the function's existing
service-role `supabase` client and adding `err.stack` to `detail` at the
top-level `catch`. **Do not add new notification points** — replace only where
`notifyCronFailure` is called today:

- `instagram-sync-cron/index.ts` (inner `failedCount > 0` + outer catch)
- `instagram-refresh-cron/index.ts`
- `instagram-publish-cron/index.ts`
- `report-worker/index.ts` (both calls — each already gated by
  `newRetryCount >= 3`, so triage stays retry-exhaustion-only)

### 5. Routine configuration (control plane — outside the repo, documented in it)

Created **once** in claude.ai (research preview); can't be fully provisioned
from code, so its exact config is checked into the repo at
`docs/cron-triage-routine.md`:

- **Repo:** this repository (read access).
- **Connector:** GitHub, scoped to **issues read/write only** (no code push, no
  merge) — least privilege; the agent's only write capability is filing/commenting
  on issues. (If preview connector scoping is coarser, document the actual scope.)
- **Trigger:** API/webhook (`/fire`).
- **Saved prompt** (full text in the doc): treat the incoming `text` as an
  **untrusted failure report**, locate the failing cron in the repo, trace the
  root cause, check for an existing open issue labeled `cron-triage:<hash>`
  (comment if found, else create with labels `cron-triage` + `cron-triage:<hash>`),
  and write an issue with the verbose signature, root cause, evidence
  (`file:line`), a concrete proposed fix plan, and a confidence level. The fix
  plan is prose — it must not push code.

### 6. Secrets / env

- `TRIAGE_ROUTINE_URL` — the routine's **full `/fire` endpoint URL**; the edge
  function POSTs to it verbatim (no path appending).
- `TRIAGE_ROUTINE_TOKEN` — the routine's bearer token (`sk-ant-oat01-…`).
- `TRIAGE_COOLDOWN_HOURS` — optional, default `24`.

No `ANTHROPIC_API_KEY`, no `CLAUDE_CODE_OAUTH_TOKEN`, no GitHub PAT on the
backend — the routine's own GitHub connector files issues.

## Dedup (two layers)

1. **Atomic edge-function claim (primary).** `claim_cron_triage` does the
   cooldown check and the dispatch-stamp in a **single** `INSERT … ON CONFLICT
   … DO UPDATE … WHERE … RETURNING` statement. Fire only when it returns `true`.
   This is race-free: concurrent same-signature failures can't both win. Bounds
   agent runs and keeps us under the routine's hourly cap. Window =
   `TRIAGE_COOLDOWN_HOURS` (default 24h).
2. **Routine open-issue check (secondary).** The agent searches for an open
   issue labeled `cron-triage:<hash>` and comments instead of duplicating —
   guards the case where the cooldown lapses while an issue is still open.

## Security

- **No service-role key leaves the backend** — the failure payload travels in
  the `/fire` body; the routine never touches Supabase.
- **Triage plumbing never breaks the cron** — `reportCronFailure`'s three steps
  are independently caught and log generic messages (CLAUDE.md: never let raw
  error details escape; here, never let triage throw into the cron).
- **Untrusted error text → prompt-injection surface.** Error messages/account
  IDs originate from external APIs and flow into the routine prompt. The
  routine's tools are constrained to issues read/write (no code push, no shell),
  so the worst case is a malformed/empty issue — low blast radius. The saved
  prompt frames `text` as untrusted data.
- **Email escaping** — all user/external strings pass through `escapeHTML()`.
- **Secrets** — `TRIAGE_ROUTINE_TOKEN` is a Supabase secret, never logged.
- **RLS** — `cron_failures` and `cron_triage_state` are service-role only;
  `claim_cron_triage` execute is revoked from anon/authenticated.

## Testing

Deno tests under `supabase/functions/__tests__/`:

- `computeSignature` — same logical error with different UUIDs/timestamps/IDs
  yields one `signature` **and** one `hash`; genuinely different errors differ;
  `hash` is `[a-z0-9]`, ≤ ~12 chars (label-safe).
- `reportCronFailure` (mocked Supabase client + mocked `fetch`):
  - fires `/fire` when `claim_cron_triage` returns `true`; skips when it returns
    `NULL/false`;
  - **always attempts the email path even if the insert rejects** (step 2 runs
    regardless of step 1);
  - still attempts claim+fire when the insert failed (step 3 independent of
    step 1);
  - never throws when the RPC, `fetch`, or DB reject.
- `sendCronFailureEmail` — HTML-escapes error strings (no raw `<`/`>` from error
  text in the body).

Manual validation: deploy, force a controlled failure (or POST a synthetic
payload to `TRIAGE_ROUTINE_URL`), confirm one issue is filed with a sensible
diagnosis; trigger the same signature again within the cooldown and confirm no
second run / a "recurred" comment rather than a dup.

`npm run build` (tsc) for type changes; deno tests for the functions.

## Deployment

- `npx supabase db push --linked` for the migration (dry-run first;
  prod=`skjzpekeqefvlojenfsw`, staging=`wlyzhyfondykzpsiqsce`).
- Redeploy the 4 cron functions (`--no-verify-jwt` as required for crons).
- Set the new secrets in Supabase (`TRIAGE_ROUTINE_URL`, `TRIAGE_ROUTINE_TOKEN`,
  optional `TRIAGE_COOLDOWN_HOURS`).
- Create + enable the Routine in claude.ai per `docs/cron-triage-routine.md`;
  pre-create the base `cron-triage` GitHub label (and confirm the connector can
  create the per-signature `cron-triage:<hash>` labels — see Open questions).
- Caution (Deno/npm gotcha): running `deno test` can pollute `deno.lock` /
  shared `node_modules` and break `npm run build` — if so,
  `git checkout deno.lock && npm ci`.

## Open questions / to verify at implementation time

- Exact `/fire` URL shape + current `anthropic-beta` routine header (research
  preview — read the docs, don't assume `experimental-cc-routine-2026-04-01`).
- Whether preview GitHub-connector scoping can be limited to issues-only; if
  not, document the actual granted scope.
- Confirm the routine can create labels (`cron-triage:<hash>`); if label
  creation needs pre-seeding, create the base `cron-triage` label up front and
  have the agent reuse a single label per signature.

## Review Resolutions

Six findings from the 2026-06-08 spec review, all resolved:

1. **Scope mismatch ("every cron failure" vs 4 wired).** Scoped to the 4
   currently-alerting crons; `reportCronFailure` is a 1:1 replacement at existing
   notify sites. The 7 silent crons are an explicit out-of-scope follow-on. See
   Scope.
2. **Cooldown race (query-then-fire).** Replaced with the atomic
   `claim_cron_triage` RPC + `cron_triage_state` table (single
   `INSERT … ON CONFLICT … WHERE … RETURNING`). See Dedup / Component 1.
3. **DB-error vs "always inserts."** `reportCronFailure` is now three isolated
   best-effort steps; email is attempted always, claim+fire is independent of
   the insert. Test wording corrected. See Component 2 / Testing.
4. **Label length/charset.** `signature` (verbose, stored/shown) is now separate
   from a short label-safe `hash`; the GitHub label is `cron-triage:<hash>`. See
   Component 2.
5. **report-worker shape.** Verified both `notifyCronFailure` calls are gated by
   `newRetryCount >= 3` — triage fires on retry exhaustion only (the 1:1
   replacement principle), not on every `return 500`. See Scope / Component 4.
6. **URL contract (`/fire/fire`).** `TRIAGE_ROUTINE_URL` is the full `/fire`
   endpoint, POSTed verbatim. See Component 6 / Data Flow.
