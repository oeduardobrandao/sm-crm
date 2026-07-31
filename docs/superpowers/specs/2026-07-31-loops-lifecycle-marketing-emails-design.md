# Event-triggered marketing emails via Loops — Design

**Date:** 2026-07-31
**Status:** Revised after external review (brainstorm 2026-07-31; revised same day — see
"Review resolutions" at the end). **Blocked on B1** (Loops event dedupe contract) before
implementation starts.

## Goal

Convert free-plan workspaces into paid subscriptions with behaviour-triggered emails, using
**Loops** as the vendor that owns copy, timing and sending, and **Postgres** as the source of
truth that decides who qualifies.

Three triggers ship in slice 1:

1. **`paywall_hit`** — a free workspace reached for a gated feature and the plan said no.
2. **`checkout_abandoned`** — they reached Stripe Checkout and did not finish within 24h.
3. **`dormant_signup`** — they confirmed their account and never created a client. This is an
   activation email, not a conversion one; it is in scope because it feeds the same funnel
   upstream, and it is named separately so its metrics are never conflated with the other two.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Who owns copy and timing | **Loops**, end to end. Copy lives in Loops, not in this repo, so wording and cadence change without a deploy. |
| Where triggers are decided | **Postgres**, swept server-side. Not PostHog webhooks. |
| Transactional emails | **Stay on Resend.** Welcome, thank-you, invite and dunning are not migrated. |
| Consent | **`profiles.marketing_opt_in` gates everything**, including the trait sync. |
| Idempotency | Reuse the existing `lifecycle_emails` ledger and its claim protocol. |
| Frequency cap | One marketing email per workspace per 72h, enforced **in SQL**. |
| PostHog's role | Measurement and experiment readout only. Never in the delivery path. |
| Crisp's role | Identify the visitor so plan context is visible in the inbox. |
| Slice 2 | `activated_but_capped`, limit-gate recording. Not in this spec. |

### Why server-side rather than PostHog → Loops

`apps/crm/src/lib/analytics.ts` captures client-side, which is lossy: adblockers drop events
outright, and the `sendInstantly` option exists precisely because the pagehide flush was not a
guarantee worth racing. A user who is silently never emailed is invisible in both PostHog and
Loops — nothing reports the absence.

**This holds for two of the three triggers.** `checkout_abandoned` and `dormant_signup` are
derived purely from server state. `paywall_hit` cannot be, for reasons in §4 — it needs a
first-party reporting call from the browser. That is a weaker guarantee than the other two and
is called out explicitly rather than hidden.

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

## Consent: `marketing_opt_in` gates everything

`profiles.marketing_opt_in` is `boolean NOT NULL DEFAULT false`, set from the register-form
checkbox (`LoginPage.tsx:75` → auth metadata → `handle_new_user_workspace`) and editable in
`PerfilTab.tsx`. Invited users never see the checkbox, so they keep the `false` default.

**Two consequences, both mandatory:**

1. **Every candidate RPC requires `p.marketing_opt_in = true`.** Not a filter applied in the
   edge function — in the SQL, so there is no code path that can skip it.
2. **Opted-out contacts are never synced to Loops at all.** Not synced-but-unmailed. Pushing
   email, name and workspace to a US vendor for someone who declined marketing contact is the
   LGPD exposure, independent of whether an email is ever sent. The trait sweep is gated by the
   same predicate.

Because the default is `false` and invited users never opt in, the eligible population is
smaller than it looks. That is correct behaviour, not a bug to work around: expect the first
sweep to qualify a minority of free workspaces.

**Revocation needs a sync ledger.** A user who unticks the box in `PerfilTab` stops qualifying
on the next sweep, but their Loops contact persists. Deleting it requires knowing **which email
address was actually sent to Loops** — and that cannot be derived from current state:

- Loops contacts are keyed by email, so a user who changes their email leaves an orphaned
  contact under the old address that no query over live data can find.
- A deleted account takes its `profiles` row with it, erasing the only pointer to what was
  synced.
- Nothing in `lifecycle_emails` records a contact sync at all; it records sends.

So slice 1 adds a vendor-identity ledger, written on every successful `updateContact`:

```sql
create table loops_contacts (
  user_id      uuid primary key references auth.users(id) on delete set null,
  synced_email text not null,
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz null
);
create index loops_contacts_pending_delete on loops_contacts (deleted_at) where deleted_at is null;
alter table loops_contacts enable row level security;
create policy "loops_contacts_service_role" on loops_contacts
  for all to service_role using (true) with check (true);
```

`on delete set null` rather than `cascade` is deliberate: when the account goes, the row must
**survive** carrying `synced_email`, because that is the only remaining handle for deleting the
contact at the vendor. A cascade would erase the evidence needed to honour the erasure.

A fourth sweep pass deletes from Loops every row where `deleted_at is null` and any of:
consent revoked, the user's current email differs from `synced_email` (delete the old address,
then re-sync the new one), or `user_id` is now null (account deleted). `deleted_at` is stamped
on success so the pass is idempotent.

The exact contact-deletion endpoint is unverified and is confirmed alongside B1. If Loops offers
no delete, the fallback is setting an `unsubscribed` property and relying on Loops' suppression
— acceptable for sends, but it leaves the PII resident at the vendor.

**Privacy policy update is a slice-1 deliverable, not a follow-up.**
`apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx` enumerates subprocessors by name
(PostHog is listed at line 75). Loops is a new US-hosted subprocessor receiving names and email
addresses, so it must be added there *before* the first send, alongside a note that transfer is
outside Brazil. Shipping the sends without the policy entry is the LGPD failure mode here, and
it is the kind of thing that gets forgotten because no test catches it.

## Non-goals

- Migrating welcome / thank-you / invite / dunning to Loops.
- Multi-channel (push, SMS, in-app) messaging.
- The `activated_but_capped` trigger and limit-gate (`max_clients`) recording.
- Any change to `stripe-webhook`.

## Architecture

```
                          ┌─────────────────────────────────┐
                          │  Postgres (source of truth)     │
                          │  workspaces, workspace_subs,    │
                          │  clientes, profiles,            │
                          │  paywall_hits, checkout_attempts│
                          └──────────────┬──────────────────┘
                                         │  candidate RPCs (consent + 72h cap inside)
                                         ▼
   lifecycle_emails ledger  ◄──►  loops-sync-cron  ──►  Loops REST API
   (claim / delivered_at)          (*/15 * * * *)        · contacts/update  (traits)
                                         │               · contacts/delete  (revocation)
                                         │               · events/send      (triggers)
                                         │
                                         └──────────►  PostHog (server-side, measurement only)

   CRM browser ──► paywall-report (authenticated edge fn) ──► paywall_hits
```

`stripe-webhook` is not modified. Latency of up to 15 minutes is acceptable for all three
triggers.

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

Three exported functions, all throwing, all bounded by `AbortSignal.timeout(10_000)`. The
timeout is not optional: the edge runtime kills isolates on unbounded I/O in ways that bypass
`catch` entirely (documented repo failure mode), and a hang must surface as a normal retryable
throw.

```ts
updateContact(p: { email: string; traits: LoopsTraits }): Promise<void>
deleteContact(p: { email: string }): Promise<void>
sendEvent(p: { email: string; eventName: string; properties: Record<string, unknown> }): Promise<void>
```

#### Contact traits: person-level only

**Loops contacts are keyed by email, but a person can own several workspaces** —
`max_workspaces_per_user` is a real entitlement column, so this is a supported product state,
not an edge case. Writing workspace facts as contact traits means whichever workspace the sweep
processes last silently wins, and the email then names the wrong agency.

The rule that avoids this entirely: **contact traits carry person-level facts; every
workspace-specific fact travels in event properties.**

| Trait | Source | Why person-level |
|---|---|---|
| `firstName` | `firstNameFrom(profiles.nome)` | One per person |
| `daysSinceSignup` | `auth.users.email_confirmed_at` | One per person |
| `workspaceCount` | count of owned workspaces | Aggregate, not per-workspace |
| `anyFree` | true if **any** owned workspace is on the effective free plan | Aggregate, drives segmentation |

`workspaceName`, `planName`, `clientCount` and `hasInstagram` are **event properties only**. The
copy in Loops references them from the event payload, which is scoped to the workspace that
actually triggered.

#### Events

| Event | Properties |
|---|---|
| `paywall_hit` | `feature`, `clickedUpgrade`, `workspaceName`, `planName`, `clientCount` |
| `checkout_abandoned` | `workspaceName`, `planName`, `hoursSinceAttempt` |
| `dormant_signup` | `workspaceName`, `daysSinceSignup` |

### 3. Idempotency — **BLOCKER B1**

`lifecycle_emails` gains three `email_type` values and **no schema change**. Its existing
constraints already fit: `(email_type, workspace_id)` for the two workspace-scoped triggers,
`(email_type, user_id)` for `dormant_signup`. The protocol is unchanged from
`lifecycle-email-cron/handler.ts`: claim-upsert → send → set `delivered_at`.

**The ledger alone does not prevent duplicate sends.** It makes a failed attempt *eligible for
retry* after an hour; it does not make the retry safe. Resend gives us a true `Idempotency-Key`
deduped for 24h, which is what closes that gap today. Whether Loops offers an equivalent on
`events/send` is **unverified**.

> **B1 — deployment blocker. Owner: Eduardo. Evidence required before any code is written.**
> Confirm from Loops' API documentation whether `POST /v1/events/send` accepts an idempotency
> key or otherwise dedupes — and, critically, **on what scope and for how long**. "Accepts a
> key" is not the contract that matters. Three facts are required:
>
> 1. **Scope** — is dedupe per key, per key+contact, or per key+event-name?
> 2. **Retention window** — how long is a key remembered?
> 3. **Behaviour on a repeated key** — silently ignored, or an error the handler must treat as
>    success (Resend's 409 case)?
>
> **The retention window sets the attempt cap, not the other way round.** The existing Resend
> path retries hourly up to 30 attempts, a ~30h window against a 24h key retention — meaning a
> retry landing between hours 24 and 30 can genuinely duplicate. That gap is pre-existing and
> accepted for a courtesy thank-you; it is not acceptable for a marketing send to a prospect.
> **Set `attempts < 25` so the retry window stays inside a 24h retention**, and adjust if Loops'
> window differs. This is why the ledger exclusion above says 25 rather than 30.
>
> - **If yes:** use `<event_type>/<workspace_id>` as the key, exactly as the Resend path does,
>   with the attempt cap tuned to the confirmed retention window.
> - **If no:** the ledger cannot carry this alone. Every loop in Loops must be configured
>   "a contact can only enter this loop once", which is **UI configuration outside this repo**
>   and therefore must be screenshotted into the rollout runbook and re-checked after any Loops
>   workspace change. A UI setting is a weaker guarantee than an idempotency key, and if it also
>   proves unavailable per-loop, the delivery design changes before implementation rather than
>   after.
>
> This item is why the spec status is Blocked. It is not a nice-to-have verification — it
> decides whether an ambiguous network failure re-emails a paying prospect.

Additionally, concurrent cron runs must not both claim the same candidate. The candidate RPCs'
one-hour freshness gate handles the normal case, but the claim upsert and the send are not
atomic. Slice 1 relies on the same guarantee the Resend path relies on, which is precisely why
B1 must resolve first.

### 4. `paywall_hits` — the reporting path had to change

**The original design was wrong and is replaced.** It proposed recording in the edge-function
catch path for `FeatureDisabledError`. Verification against the code shows that cannot work:

- Only two functions catch that class: `mcp-keys/index.ts:54` and `mcp-oauth-consent/index.ts:127`.
- **Most feature gates are database triggers** — `trg_feature_hub_tokens`, `trg_feature_ideias`,
  `trg_feature_financial`, `trg_feature_contracts`, `trg_feature_leads`, `trg_feature_brand`
  (`20260611140003_feature_triggers.sql`) — fired by *direct client writes from the CRM*. There
  is no edge function in the path at all.
- Recording inside `enforce_plan_feature` is impossible anyway: it `RAISE`s, and the raise
  aborts the transaction, rolling the `INSERT` back with it. Silently. The table would stay
  permanently empty.

**Replacement: a small authenticated edge function `paywall-report`**, fed by three sources,
because no single one covers the gated surface.

**Authorization — the earlier draft of this was a cross-tenant write hole.** It said to check
`conta_id` ownership. That is wrong: `profiles.conta_id` tracks the **active** workspace
(`get_my_conta_id()` returns `active_workspace_id`, per `20260317_multi_workspace.sql`), so in a
multi-workspace account it routinely diverges from the `workspace_id` in the request body. A
check against it would either reject legitimate reports or, worse, be waved through while the
service-role insert writes a row attributed to a workspace the caller has no relationship with.

The correct check, and the security boundary of this function:

1. Verify the JWT and resolve `user.id` from it. Use a service-role client with
   `getUser(token)` — never the anon client.
2. `select 1 from workspace_members where user_id = <authenticated user.id> and workspace_id =
   <body workspace_id>`. No row, no insert, 403.
3. Only then insert with the service role.

The `workspace_id` in the body is attacker-controlled input and is never trusted for anything
except being the subject of that membership check.

| Source | Covers | Reliability |
|---|---|---|
| **`FeatureGate` locked-state render** (`components/paywall/FeatureGate.tsx`) | `feature_csv_import`, `feature_mcp` | Best. Fires when the user is *shown* the denial, before any write is attempted. |
| **CRM mutation error handler** on the PostgREST `feature_disabled` shape | `feature_hub_portal`, `feature_ideas`, `feature_financial`, `feature_contracts`, `feature_leads`, `feature_brand_customization`, `feature_custom_properties` | Good. Requires the user to actually attempt the write. |
| **MCP edge functions** (`mcp-keys:54`, `mcp-oauth-consent:127`) | `feature_mcp` | Server-side insert, no browser involved. |

The split matters: `FeatureGate` exists at only 5 call sites covering 2 features, so it cannot
carry this alone. Everything in `20260611140003_feature_triggers.sql` — including
`feature_hub_portal`, which is the gate most likely to block activation — is a database trigger
reached by a direct client write and can only be observed from the error handler.

`FeatureGate` renders on every page view, so the report is debounced to once per
(workspace, feature) per session in the browser; the 7-day window in the candidate RPC absorbs
the rest.

The "Fazer upgrade" button inside `FeatureGate` is a strictly higher-intent signal than the
render. It sets `clicked_upgrade: true` on the row so Loops can segment "saw the wall" from
"reached for the door".

**Honest tradeoff:** this reintroduces a browser dependency for one of the three triggers,
partially walking back the "server-side only" decision. It is still substantially better than a
PostHog webhook — a first-party authenticated POST to your own Supabase domain, not a
third-party analytics beacon, so adblockers are not the failure mode. But a user who closes the
tab in the same tick loses the report. Accepted for slice 1; the alternative is instrumenting
each gated route individually, which is slice-2-sized.

**Slice 1 records feature gates only.** Limit gates (`max_clients` and friends) surface as a
different error shape and are deferred to slice 2 alongside `activated_but_capped`.

Migration `20260731000001_paywall_hits.sql` (re-verify the version prefix against
`git ls-tree origin/main:supabase/migrations | tail` at PR-open time — main's tail is currently
`20260730000009`, and a duplicate prefix is silently skipped by Supabase):

```sql
create table paywall_hits (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  user_id         uuid null references auth.users(id) on delete set null,
  feature         text not null,
  clicked_upgrade boolean not null default false,
  hit_at          timestamptz not null default now()
);
create index paywall_hits_workspace_hit_at on paywall_hits (workspace_id, hit_at desc);
alter table paywall_hits enable row level security;
create policy "paywall_hits_service_role" on paywall_hits
  for all to service_role using (true) with check (true);
-- No authenticated policy: writes go through paywall-report (service role).
```

### 5. `checkout_attempts` — the original predicate was unusable

**Also replaced.** The original proposed
`stripe_customer_id is not null and stripe_subscription_id is null and created_at <= now() - 24h`.
Three verified defects:

- `billing-checkout/index.ts:57` creates the Stripe customer and upserts the row **before**
  `stripe.checkout.sessions.create`. If session creation throws, the row persists and the user
  never saw a checkout page. They would be emailed about abandoning something they never
  reached.
- `workspace_subscriptions.created_at` is a table default set once. The on-conflict upsert
  writes only `stripe_customer_id`, so the timestamp is *first customer creation ever*, not a
  checkout attempt.
- Consequently a second or third abandonment is undetectable — the timestamp never moves.

**Replacement: record the attempt where it actually happens.** `billing-checkout` gains one
insert, placed **after** `sessions.create` succeeds and before the URL is returned, so only a
real reachable checkout page is recorded:

```sql
create table checkout_attempts (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  stripe_session_id  text not null unique,
  plan_id            text null references plans(id),
  created_at         timestamptz not null default now()
);
create index checkout_attempts_workspace_created on checkout_attempts (workspace_id, created_at desc);
alter table checkout_attempts enable row level security;
create policy "checkout_attempts_service_role" on checkout_attempts
  for all to service_role using (true) with check (true);
```

**If that insert fails, log and continue — never fail the checkout.** The Stripe session already
exists at that point. Propagating the error returns 500 to a user who is one click from paying,
blocks them from reaching a checkout page that is live, and pushes them to start another
session. Losing one marketing trigger is the cheaper failure by a wide margin, and the tradeoff
is not close enough to leave to whoever writes the code. The insert is wrapped in its own
try/catch that logs and swallows; `stripe_session_id` is `unique`, so a retried request that
reuses a session is a no-op rather than a duplicate.

Abandonment is then well-defined: the workspace's **most recent** attempt is older than 24h and
the workspace still has no active subscription. Each new attempt resets the clock, so repeat
abandonment works, and the ledger's `(email_type, workspace_id)` uniqueness means a workspace is
emailed about it once regardless.

### 6. Candidate RPCs

All three are `security definer`, `set search_path = public`, `limit 50`, with a deterministic
`order by`, and locked down with an explicit `grant execute ... to service_role` — the
`revoke all from public` form alone also strips `service_role` on this instance, which has
bitten this repo before. Check `proacl`, not `has_function_privilege`.

**Four predicates are shared by all three** and must appear in each:

1. `profiles.marketing_opt_in = true` (consent) — **for the one deterministically chosen
   recipient**, defined below.
2. **Effective free plan.** Not `plan_id is null` alone — the convention in
   `_shared/entitlements.ts:51` is that a null `plan_id` resolves to the plan with
   `is_default = true`. The predicate is therefore
   `coalesce(w.plan_id, (select id from plans where is_default)) = (select id from plans where is_default)`.
   A workspace that subscribed and later cancelled retains a `workspace_subscriptions` mirror
   row, so subscription-row existence is **not** a proxy for paid.
3. **72h frequency cap** — as a prefilter only. The authoritative enforcement is the atomic
   claim below, because a predicate evaluated at SELECT time cannot arbitrate between two
   concurrent sweeps.
4. Ledger exclusion: not delivered, not claimed within the last hour, `attempts < 25` (see B1
   for why 25 and not 30).

#### The 72h cap needs an atomic claim, not a predicate

Two independent defects in evaluating the cap inside the candidate RPCs:

- **Concurrency.** Two overlapping cron runs both SELECT before either claims. Run A picks
  `paywall_hit` for workspace W, run B picks `checkout_abandoned` for the same W. Both pass the
  cap because neither has written yet, and the per-type idempotency key
  `<event_type>/<workspace_id>` cannot help — it dedupes a type against itself, not two
  different types against each other. The workspace gets two marketing emails minutes apart.
  A 15-minute schedule and a sweep that can exceed 15 minutes makes this reachable, not
  theoretical.
- **`dormant_signup` is invisible to the cap.** It claims on `(email_type, user_id)`, leaving
  `workspace_id` NULL, so `le2.workspace_id = w.id` never matches it. A dormant email sent an
  hour ago does not suppress anything.

**Fix, both parts:**

1. **`dormant_signup` writes both keys.** The ledger has both columns and the uniqueness
   constraint is `(email_type, user_id)`, so populating `workspace_id` as well changes no
   dedupe behaviour and makes the row visible to every workspace-scoped query. The workspace is
   the one the dormant owner created.
2. **A single SQL claim function is the arbiter**, replacing the edge function's bare upsert:

```sql
-- Returns true if the caller won the claim. All checks happen inside one
-- transaction under a per-workspace advisory lock, so concurrent sweeps
-- serialise rather than both winning.
create function claim_marketing_email(
  p_email_type text, p_workspace_id uuid, p_user_id uuid, p_attempts int
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));
  if exists (
    select 1 from lifecycle_emails
    where workspace_id = p_workspace_id
      and email_type in ('paywall_hit','checkout_abandoned','dormant_signup')
      and sent_at > now() - interval '72 hours'
  ) then
    return false;
  end if;
  insert into lifecycle_emails (email_type, workspace_id, user_id, sent_at, attempts)
  values (p_email_type, p_workspace_id, p_user_id, now(), p_attempts)
  on conflict (email_type, workspace_id) do update
    set sent_at = now(), attempts = excluded.attempts;
  return true;
end $$;
```

The candidate RPCs keep the cap predicate as a cheap prefilter so the common case does not
reach the lock. `handler.ts` skips any candidate whose claim returns false. The advisory lock is
transaction-scoped, so it releases on commit or crash with no cleanup path to get wrong.

Note the `on conflict` target is the workspace constraint; the `dormant_signup` path conflicts
on `(email_type, user_id)` instead, so the function takes the constraint name as a parameter or
branches on `p_email_type`. Implementation detail, but it must not be left to inference — the
wrong target silently creates duplicate ledger rows.

#### Who receives a workspace-scoped event

`workspace_members` is `UNIQUE(user_id, workspace_id)` with a role CHECK, and **nothing
constrains a workspace to one owner**. Left unspecified, two implementers would reasonably pick
`workspaces.created_by`, the oldest owner, or every opted-in owner — three different recipient
sets with three different consent stories.

**The rule is the one `get_thankyou_email_candidates` already uses, copied verbatim:**

```sql
cross join lateral (
  select wm.user_id
  from workspace_members wm
  where wm.workspace_id = ws.id and wm.role = 'owner'
  order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
  limit 1
) owner_pick
```

One owner, deterministically chosen, consistent with the transactional emails so a workspace
never hears from Mesaas at two different addresses.

**Consent applies to that chosen owner, and does not fall through.** If the chosen owner has
`marketing_opt_in = false`, the workspace produces **no candidate** — the sweep does not look
for a different, opted-in owner. Falling through would mean the person who declined marketing
determines that someone *else* gets marketed to about their workspace, and would make the
recipient depend on consent state, so the same workspace could be emailed at different
addresses over time. One workspace, one marketing recipient, or none.

`get_paywall_hit_candidates()` — workspaces with a `paywall_hits` row in the last 7 days,
returning the most recent `feature` and whether any hit in that window had
`clicked_upgrade = true`, so the email can name the feature and Loops can segment intent.

`get_abandoned_checkout_candidates()` — latest `checkout_attempts` row older than 24h, and the
workspace has no `workspace_subscriptions` row in `('trialing','active')`.

`get_dormant_signup_candidates()` — confirmed self-serve owners with zero `clientes` rows and
`email_confirmed_at` between 3 and 14 days ago. The self-serve discriminator is copied verbatim
from `get_welcome_email_candidates`: `workspaces.created_by = u.id` **and** no `conta_id` in
signup metadata. Both halves are required — invited users can otherwise be misclassified as
self-serve through the fallback path in `20260719000002`. The 3-day floor keeps this from racing
the welcome email; the 14-day ceiling stops the sweep from re-litigating ancient signups.

**Send-time re-check.** Between the RPC returning a candidate and the Loops event being sent, a
workspace can subscribe or a user can revoke consent. `handler.ts` re-reads consent and
effective plan immediately before `sendEvent` and skips (marking the claim delivered so it does
not retry forever) if either changed. Cheap, and it is the difference between a courteous email
and one that congratulates a paying customer on being free.

**Backfill seed.** The migration inserts terminal ledger rows (`delivered_at` set) for every
workspace that would qualify at migration time, so switching the cron on does not blast the
entire back catalogue. Same technique as `20260730000001`, `on conflict do nothing`.

### 7. PostHog and Crisp

**PostHog.** `loops-sync-cron` captures a server-side `lifecycle_email_triggered` event with
`{ type, workspace_id }` after each successful Loops event. Measurement only — nothing in the
delivery path reads PostHog. Loops reports opens and clicks; PostHog reports whether it produced
revenue.

This is a new server-side capture path (`analytics.ts` is browser-only), so it needs a small
`_shared/posthog.ts` doing a bounded `fetch` to `https://eu.i.posthog.com/capture/`. The env var
is `POSTHOG_PROJECT_KEY` — the **project write key**, the same value as `VITE_POSTHOG_KEY`, not a
personal API key. A failure here is logged and swallowed: measurement must never fail an email.

**Crisp.** The original wiring point was wrong: `AuthContext.tsx:186` deliberately passes
`plan_id: null` because it resolves before entitlements load, and it has no client count. It
cannot supply the traits.

Corrected, two-stage:

- **At `identifyWorkspaceUser`** (`AuthContext`): push what is genuinely available there —
  `['set', 'user:email', ...]` and `['set', 'user:nickname', profile.nome]`.
- **When `useEntitlements` resolves**: push `['set', 'session:data', [['plan', planName],
  ['clients', clientCount]]]`. This is the same follow-up the existing comment at
  `AuthContext.tsx:184` already anticipates for the PostHog `workspace` group, so both
  enrichments land at one point rather than two.

If `useEntitlements` does not already expose `planName` and a client count at a single call
site, **cut the `session:data` half from slice 1** rather than building a data path for a
support nicety. The `user:email` half is unconditionally worth keeping.

## Copy rules for Loops

Copy lives in Loops, so these are rules for the human writing there, not lint-enforceable:

- PT-BR throughout.
- **No em-dashes.** They read as AI slop. Use a period, a colon, or `·`.
- Positioning is "plataforma de gestão para agências de social media", never "CRM".
- Every marketing email carries a working unsubscribe. Loops handles the mechanics; the
  revocation sweep in the consent section handles the part Loops cannot see.

## Testing

- **`handler.ts` unit tests** (`deno test`) with injected deps, mirroring
  `__tests__/lifecycle-email-cron_test.ts`: claim-before-send ordering, `delivered_at` only
  after a successful send, a throwing send leaving the claim undelivered, per-candidate error
  isolation, the empty-candidate no-op, and **the send-time re-check skipping a workspace that
  subscribed or revoked consent mid-sweep**.
- **`_shared/loops.ts` unit tests** with a stubbed `fetch`: request shape, auth header, timeout
  wiring, throw-on-non-2xx.
- **`paywall-report` tests**: rejects an unauthenticated call; **rejects a caller posting a
  `workspace_id` they are not a `workspace_members` row for, including the case where it is a
  workspace they once belonged to and the case where their `conta_id` points elsewhere** — this
  is the security boundary and the exact shape of the hole the earlier draft had.
- **Concurrency test for the cap**: two `claim_marketing_email` calls for different event types
  on the same workspace, interleaved, must produce exactly one winner.
- **`dormant_signup` participates in the cap**: a dormant claim must suppress a `paywall_hit`
  claim for the same workspace within 72h (the regression that the NULL `workspace_id` caused).
- **RPC tests** via the existing psql harness, one per shared predicate:
  - an opted-out user produces **no** candidate from any of the three RPCs;
  - a workspace on a paid plan produces no candidate;
  - a workspace mailed 12h ago produces no candidate from a *different* trigger (the 72h cap);
  - a cancelled-but-mirrored workspace is treated as free;
  - delivered / fresh / attempt-capped ledger rows are excluded;
  - the self-serve discriminator excludes invited users.
- **Consent revocation**: flipping `marketing_opt_in` to false results in a Loops contact
  delete on the next sweep.

Contract note: adding `email_type` values touches shared fixtures. Grep both
`apps/**/__tests__` and `supabase/functions/__tests__` for the old shape and run the full
`npm run test` and `npm run test:functions` before pushing.

## Rollout order

Order matters — the cron schedule fires immediately on apply.

0. **Resolve B1.** No code before this. Record the answer and, if the fallback applies, the
   per-loop "enter once" configuration evidence, in the runbook.
1. Set `LOOPS_API_KEY` and `POSTHOG_PROJECT_KEY` in Supabase secrets, staging first.
2. Apply `20260731000001_paywall_hits.sql`, `20260731000002_checkout_attempts.sql` and
   `20260731000003_loops_contacts.sql`.
3. Deploy `billing-checkout` (now writing `checkout_attempts`) and `paywall-report`.
   `paywall-report` verifies its own JWT, so deploy it with `--no-verify-jwt --use-api`.
4. Ship the CRM change that calls `paywall-report`, and let `checkout_attempts` accumulate for
   at least 24h — the abandonment trigger is meaningless against an empty table.
5. Deploy `loops-sync-cron` with `--no-verify-jwt --use-api`.
6. Apply `20260731000004_schedule_loops_sync_cron.sql` (candidate RPCs, `claim_marketing_email`,
   ledger backfill seed, `cron.schedule`, in that order within the file). It uses the
   `vault.decrypted_secrets`
   subselect form — `vault.decrypted_secret(...)` does not exist on this instance.
7. **Add Loops to the subprocessor list in `PoliticaPage.tsx` and ship it.** Before any send.
8. Verify on staging with a seeded free workspace that has opted in, before touching prod.

**Rollback is the reverse**: `cron.unschedule('loops-sync-cron')` first, then undeploy. Keep
`lifecycle_emails` rows — they are the record of what was already sent, and deleting them
re-mails everyone on a future re-rollout.

## Risks

| Risk | Mitigation |
|---|---|
| Loops event API has no idempotency key | **B1, a blocker.** Ledger + per-loop "enter once", evidenced in the runbook, or the delivery design changes. |
| Emailing users who declined marketing contact | `marketing_opt_in` in every RPC, plus opted-out contacts never synced, plus a revocation delete sweep. |
| `paywall_hit` misses real denials | Accepted for slice 1 and stated plainly: a closed tab loses the report. First-party authenticated POST, so adblockers are not the failure mode. |
| Emailing a workspace that just subscribed | Send-time re-check of consent and effective plan. |
| Wrong workspace named in an email | Workspace facts live only in event properties, never contact traits. |
| Three emails landing the same hour | 72h cap enforced in SQL, not in Loops. |
| Backfill blasts the back catalogue | Terminal-row seed in the same migration, applied before the schedule. |
| Marketing sends hurt transactional deliverability | Separate sending domains. |

## Review resolutions

Two external review rounds, both gpt-5.6-terra, 2026-07-31. Fifteen points raised, all fifteen
verified against the code and accepted, none rejected.

### Round 1

All eight points verified against the code and accepted; none rejected.

| # | Point | Resolution |
|---|---|---|
| P0 | `marketing_opt_in` omitted | New consent section. Gates all RPCs **and** the trait sync; adds a revocation delete sweep (goes further than the review: syncing PII for an opted-out user is exposure even with no send). |
| P1 | Catch-path cannot capture paywalls | §4 rewritten. New `paywall-report` edge function fed by three sources, with the per-feature coverage split named. Follow-up finding: `FeatureGate` covers only 2 of the ~8 gated features, so the error handler is load-bearing, not a fallback. |
| P1 | `workspace_subscriptions.created_at` unusable | §5 rewritten. New `checkout_attempts` table written after `sessions.create` succeeds. |
| P1 | Checkout candidates not constrained to free | Shared predicate 2, using the `is_default` convention, plus a send-time re-check. |
| P1 | Loops contacts keyed by email vs per-workspace traits | Traits are person-level only; workspace facts moved to event properties. |
| P1 | Idempotency unresolved but status Approved | Status changed to Blocked; B1 given an owner and required evidence. |
| P2 | 72h cap deferred to a Loops setting | Made slice 1, enforced in SQL. |
| P2 | Crisp wiring point has no plan data | Two-stage wiring, with an explicit instruction to cut the second stage if the data is not already at one call site. |

### Round 2

External review (gpt-5.6-terra), 2026-07-31, on the revised spec. All seven points verified and
accepted; none rejected.

| # | Point | Resolution |
|---|---|---|
| P1 | `clicked_upgrade` required but never persisted or carried | Column added to `paywall_hits`; surfaced by the candidate RPC and sent as the `clickedUpgrade` event property. Self-inflicted inconsistency from the round-1 edit. |
| P1 | 72h cap unsafe under concurrency; `dormant_signup` invisible to it | Cap demoted to a prefilter; authority moved to `claim_marketing_email`, an atomic SQL claim under a per-workspace advisory lock. `dormant_signup` now writes `workspace_id` too. |
| P1 | B1 must pin dedupe scope and retention, not just existence | B1 expanded to three required facts. Attempt cap cut 30 → 25 so the retry window stays inside a 24h retention. Documents the pre-existing ~30h-vs-24h gap on the Resend path. |
| P1 | Recipient undefined when a workspace has several owners | Deterministic owner pick copied verbatim from `get_thankyou_email_candidates`; consent applies to that owner and explicitly does **not** fall through to another. |
| P1 | Revocation sweep has no sync state; email change and account deletion orphan contacts | New `loops_contacts` ledger with `on delete set null` so `synced_email` survives account deletion. |
| P1 | `conta_id` check is a cross-tenant write path | Replaced with a `workspace_members` membership check on the authenticated `user.id`. `conta_id` is the *active* workspace and diverges. |
| P2 | `checkout_attempts` insert failure undefined | Log and swallow, never fail the checkout; `stripe_session_id` unique makes retries no-ops. |

## Slice 2 (out of scope)

`activated_but_capped`: free workspaces with real usage that have never hit a paywall. Needs a
usage-scoring query and recording of limit-based gates in `paywall_hits`.
