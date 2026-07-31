# Event-triggered marketing emails via Loops — Design

**Date:** 2026-07-31
**Status:** Approved (brainstorm 2026-07-31)

## Goal

Convert free-plan workspaces into paid subscriptions with behaviour-triggered emails, using
**Loops** as the vendor that owns copy, timing and sending, and **Postgres** as the source of
truth that decides who qualifies.

Three triggers ship in slice 1:

1. **`paywall_hit`** — a free workspace reached for a gated feature and the plan said no.
2. **`checkout_abandoned`** — they started Stripe Checkout and did not finish within 24h.
3. **`dormant_signup`** — they confirmed their account and never created a client. This is an
   activation email, not a conversion one; it is in scope because it feeds the same funnel
   upstream, and it is named separately so its metrics are never conflated with the other two.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Who owns copy and timing | **Loops**, end to end. Copy lives in Loops, not in this repo, so wording and cadence change without a deploy. |
| Where triggers are decided | **Postgres**, swept server-side. Not PostHog webhooks. |
| Transactional emails | **Stay on Resend.** Welcome, thank-you, invite and dunning are not migrated. |
| Idempotency | Reuse the existing `lifecycle_emails` ledger and its claim protocol. |
| PostHog's role | Measurement and experiment readout only. Never in the delivery path. |
| Crisp's role | Identify the visitor so plan context is visible in the inbox. |
| Slice 2 | `activated_but_capped` (needs a usage-scoring query). Not in this spec. |

### Why server-side rather than PostHog → Loops

`apps/crm/src/lib/analytics.ts` captures client-side, which is lossy: adblockers drop events
outright, and the `sendInstantly` option exists precisely because the pagehide flush was not a
guarantee worth racing. A user who is silently never emailed is invisible in both PostHog and
Loops — nothing reports the absence. Every fact these triggers need (`plan_id`, client count,
subscription state, signup date) is already in Postgres, durably and completely.

### Why transactional stays on Resend

A marketing unsubscribe in Loops must never suppress an invite or a failed-payment notice.
Keeping the two on separate rails makes that structural instead of a setting that can be
misconfigured. Two further reasons:

- **Deliverability isolation.** `eduardo@mesaas.com.br` is a warmed domain carrying invites and
  dunning. Loops sends from its own subdomain, so a marketing reputation hit cannot poison the
  transactional path.
- **The Resend engine is already correct.** `lifecycle-email-cron` has stale-claim retry,
  attempt caps and Resend idempotency-key dedupe. Migrating it buys nothing and risks
  re-mailing everyone.

The accepted cost: emails live in two systems permanently. Anyone auditing "what did we send
this user" checks both. This is deliberate.

## Non-goals

- Migrating welcome / thank-you / invite / dunning to Loops.
- Multi-channel (push, SMS, in-app) messaging.
- The `activated_but_capped` trigger.
- Any change to `stripe-webhook`.

## Architecture

```
                          ┌─────────────────────────────────┐
                          │  Postgres (source of truth)     │
                          │  workspaces, workspace_subs,    │
                          │  clientes, paywall_hits         │
                          └──────────────┬──────────────────┘
                                         │  candidate RPCs
                                         ▼
   lifecycle_emails ledger  ◄──►  loops-sync-cron  ──►  Loops REST API
   (claim / delivered_at)          (*/15 * * * *)        · contacts/update  (traits)
                                         │               · events/send      (triggers)
                                         │
                                         └──────────►  PostHog (server-side capture,
                                                        measurement only)
```

`stripe-webhook` is not modified. Latency of up to 15 minutes is acceptable for all three
triggers; none of them is time-critical in a way a user would notice.

### 1. Edge function: `supabase/functions/loops-sync-cron/`

Split exactly like `lifecycle-email-cron`, for the same reason — the handler must be testable
without a network:

- `index.ts` — reads env, verifies `x-cron-secret` with `timingSafeEqual`, constructs the
  service-role client, injects real dependencies.
- `handler.ts` — `runLoopsSyncCron(deps)`, pure orchestration over an injected `LoopsDb` and
  injected send functions. No `Deno.env`, no `fetch`.

New env var: **`LOOPS_API_KEY`**, required, no fallback — throw at boot if missing, matching the
`TOKEN_ENCRYPTION_KEY` and `CRON_SECRET` convention.

### 2. Shared module: `supabase/functions/_shared/loops.ts`

Two exported functions, both throwing, both bounded by `AbortSignal.timeout(10_000)`. The
timeout is not optional: the edge runtime kills isolates on unbounded I/O in ways that bypass
`catch` entirely (documented repo failure mode), and a hang must surface as a normal retryable
throw.

```ts
updateContact(p: { email: string; traits: LoopsTraits }): Promise<void>
sendEvent(p: { email: string; eventName: string; properties: Record<string, unknown> }): Promise<void>
```

Errors are logged internally and never returned to a client; this function has no client-facing
surface, but the rule holds.

#### Contact traits

Pushed on every sweep for every free-plan workspace owner, so Loops segments stay fresh even
between triggers:

| Trait | Source |
|---|---|
| `firstName` | `firstNameFrom(profiles.nome)` — reuse the existing helper |
| `workspaceName` | `workspaces.name` |
| `planName` | `plans.name` via `workspaces.plan_id` |
| `isFree` | `plan_id` is null or resolves to the `is_default` plan |
| `clientCount` | `count(clientes)` for the workspace |
| `daysSinceSignup` | from `auth.users.email_confirmed_at` |
| `hasInstagram` | any connected Instagram account for the workspace |

`clientCount` and `hasInstagram` are what make the copy specific rather than generic, so they
are in slice 1 rather than deferred.

#### Events

| Event | Properties |
|---|---|
| `paywall_hit` | `feature`, `workspaceName`, `planName` |
| `checkout_abandoned` | `workspaceName`, `hoursSinceStarted` |
| `dormant_signup` | `workspaceName`, `daysSinceSignup` |

### 3. Idempotency: reuse the ledger

`lifecycle_emails` gains three `email_type` values and **no schema change**. Its existing
constraints already fit: `(email_type, workspace_id)` for the two workspace-scoped triggers,
`(email_type, user_id)` for `dormant_signup`.

The protocol is unchanged from `lifecycle-email-cron/handler.ts`: claim-upsert (refreshing
`sent_at`, incrementing `attempts`) → send → set `delivered_at`. Candidate RPCs exclude
delivered rows, rows claimed within the last hour, and rows past 30 attempts, so a crash goes
stale and retries rather than either duplicating or permanently suppressing.

> **Open item, resolve first.** Resend gives us a true `Idempotency-Key`, deduped for 24h. It is
> not yet confirmed that Loops' event API offers an equivalent. **Task 1 of implementation is to
> verify this against Loops' API docs**, because it decides whether a retry is safe or
> double-emails a customer. If there is no idempotency key, both belts are mandatory: the ledger
> claim *and* Loops' per-loop "a contact can only enter once" setting. That setting is
> configuration in Loops' UI, not code, so it must be written into the runbook section below and
> checked as part of rollout, not assumed.

### 4. `paywall_hits` table

Migration `20260731000001_paywall_hits.sql` (re-verify the version prefix against
`git ls-tree origin/main:supabase/migrations | tail` at PR-open time — main's tail is currently
`20260730000009`, and a duplicate prefix is silently skipped by Supabase).

```sql
create table paywall_hits (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid null references auth.users(id) on delete set null,
  feature      text not null,
  hit_at       timestamptz not null default now()
);
create index paywall_hits_workspace_hit_at on paywall_hits (workspace_id, hit_at desc);
alter table paywall_hits enable row level security;
-- No policies: service role only, like lifecycle_emails.
```

**The trap that must not be got wrong.** The hit cannot be recorded inside
`enforce_plan_feature_fn` or any other SQL gate that `RAISE`s. The raise aborts the
transaction, which rolls the `INSERT` back with it, producing a table that stays permanently
empty and a trigger that never fires — and it fails *silently*, so nothing surfaces the bug
except the absence of emails weeks later.

Recording therefore happens in the **edge function catch path**, as a fresh statement after the
failed one. `assertPlanFeature` in `_shared/entitlements.ts` already throws
`FeatureDisabledError` carrying the feature name; the insert goes in the handler that catches
it. Call sites that catch `FeatureDisabledError` are the enumeration of what gets recorded.

Limit-based gates (`max_clients` and friends) surface as a different error shape than feature
gates. Slice 1 records **feature gates only**; limit gates are recorded in slice 2 alongside
`activated_but_capped`, which is where they actually matter.

### 5. Candidate RPCs

All three are `security definer`, `set search_path = public`, `limit 50`, with a deterministic
`order by`, and locked down with an explicit `grant execute ... to service_role` — the
`revoke all from public` form alone also strips `service_role` on this instance, which has
bitten this repo before. Check `proacl`, not `has_function_privilege`.

`get_paywall_hit_candidates()` — free-plan workspaces with a `paywall_hits` row in the last 7
days, joined to a resolvable owner email, excluding delivered/fresh/capped ledger rows. Returns
the most recent `feature` so the email can name it.

`get_abandoned_checkout_candidates()` — `workspace_subscriptions` rows where
`stripe_customer_id is not null and stripe_subscription_id is null and created_at <= now() -
interval '24 hours'`. This reuses the placeholder-row semantics already documented in
`20260730000001`'s backfill seed: `billing-checkout` writes a row holding only the customer id
before Checkout completes, so its persistence past 24h *is* the abandonment signal. No new
schema.

`get_dormant_signup_candidates()` — confirmed self-serve owners on the default plan with zero
`clientes` rows and `email_confirmed_at` between 3 and 14 days ago. The self-serve
discriminator is copied verbatim from `get_welcome_email_candidates`: `workspaces.created_by =
u.id` **and** no `conta_id` in signup metadata. Both halves are required — invited users can
otherwise be misclassified as self-serve through the fallback path in `20260719000002`.

The 3-day floor keeps this from racing the welcome email; the 14-day ceiling stops the sweep
from re-litigating ancient signups on first deploy.

**Backfill seed.** The migration inserts terminal ledger rows (`delivered_at` set) for every
workspace that would qualify at migration time, so switching the cron on does not blast the
entire back catalogue. Same technique as `20260730000001`, `on conflict do nothing`.

### 6. PostHog and Crisp

**PostHog.** `loops-sync-cron` captures a server-side `lifecycle_email_triggered` event with
`{ type, workspace_id }` after each successful Loops event. This is measurement only — nothing
in the delivery path reads PostHog. It exists so the funnel from trigger to `checkout_started`
to subscription is answerable in one place; Loops reports opens and clicks, PostHog reports
whether it produced revenue.

This is a new server-side capture path (the existing `analytics.ts` is browser-only), so it
needs a small `_shared/posthog.ts` doing a bounded `fetch` to `https://eu.i.posthog.com/capture/`.
The env var is `POSTHOG_PROJECT_KEY` — the **project write key**, the same value as
`VITE_POSTHOG_KEY`, not a personal API key. Naming it explicitly here because
`POSTHOG_API_KEY` reads like the personal key and would send someone to the wrong page in
PostHog's settings. A failure here is logged and swallowed: measurement must never fail an
email.

**Crisp.** Currently loaded anonymously (`apps/crm/index.html:30`) — you cannot see who is
chatting or what plan they are on. Add `$crisp.push(['set', 'user:email', ...])` and
`['set', 'session:data', ...]` with plan and client count, wired where `identifyWorkspaceUser`
is already called so there is one identity point rather than two. Roughly twenty lines, and it
makes the paywall email and the ensuing chat the same conversation.

## Copy rules for Loops

Copy lives in Loops, so these are rules for the human writing there, not lint-enforceable:

- PT-BR throughout.
- **No em-dashes.** They read as AI slop. Use a period, a colon, or `·`.
- Positioning is "plataforma de gestão para agências de social media", never "CRM".
- Every marketing email carries a working unsubscribe. LGPD, and Loops handles the mechanics.

## Testing

- **`handler.ts` unit tests** (`deno test`) with injected deps, mirroring
  `__tests__/lifecycle-email-cron_test.ts`: claim-before-send ordering, `delivered_at` only
  after a successful send, a throwing send leaving the claim undelivered, per-candidate error
  isolation (one failure must not abort the sweep), and the empty-candidate no-op.
- **`_shared/loops.ts` unit tests** with a stubbed `fetch`: request shape, auth header, timeout
  wiring, throw-on-non-2xx.
- **RPC tests** via the existing psql harness: each candidate RPC excludes delivered, fresh
  (<1h) and attempt-capped rows, and the self-serve discriminator excludes invited users.
- **The rollback trap gets an explicit test**: a feature-gate rejection must leave a
  `paywall_hits` row behind. This is the failure mode that is silent in production.

Contract note: adding `email_type` values touches shared fixtures. Grep both
`apps/**/__tests__` and `supabase/functions/__tests__` for the old shape and run the full `npm
run test` and `npm run test:functions` before pushing.

## Rollout order

Order matters — the cron schedule fires immediately on apply.

1. Verify Loops event idempotency (the open item above). Configure each loop's "enter once"
   setting in Loops and record it in the runbook.
2. Set `LOOPS_API_KEY` and `POSTHOG_PROJECT_KEY` in Supabase secrets, staging first.
3. Apply `20260731000001_paywall_hits.sql`.
4. Deploy `loops-sync-cron` with `--no-verify-jwt --use-api` (it handles its own auth).
5. Apply `20260731000002_schedule_loops_sync_cron.sql`, which carries the candidate RPCs, the
   ledger backfill seed **and** the `cron.schedule` call, in that order within the file. It uses
   the `vault.decrypted_secrets` subselect form — `vault.decrypted_secret(...)` does not exist
   on this instance.
6. Verify on staging with a seeded free workspace before touching prod.

**Rollback is the reverse**: `cron.unschedule('loops-sync-cron')` first, then undeploy. Keep
`lifecycle_emails` rows — they are the record of what was already sent, and deleting them
re-mails everyone on a future re-rollout.

## Risks

| Risk | Mitigation |
|---|---|
| Loops event API has no idempotency key | Ledger claim + per-loop "enter once". Resolved before any code is written. |
| Double-emailing during the Resend/Loops overlap | Disjoint `email_type` values and disjoint audiences: Resend owns transactional, Loops owns marketing. Nothing qualifies for both. |
| Backfill blasts the back catalogue on deploy | Terminal-row seed in the same migration, applied before the schedule. |
| `paywall_hits` silently empty | Explicit test for the catch-path recording; verify a non-zero row count on staging before prod. |
| Marketing sends hurt transactional deliverability | Separate sending domains. Not shared. |
| Free users email-fatigued by three triggers at once | The 3-day floor on `dormant_signup` separates it from welcome. If overlap still shows up in Loops, add a global "one marketing email per workspace per 72h" guard in the candidate RPCs. |

## Slice 2 (out of scope)

`activated_but_capped`: free workspaces with real usage that have never hit a paywall. Needs a
usage-scoring query, and recording of limit-based gates in `paywall_hits`.
