# Loops Lifecycle Marketing Emails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send behaviour-triggered marketing emails to free-plan workspaces via Loops, driven entirely by Postgres state, to convert them to paid subscriptions.

**Architecture:** A new `loops-sync-cron` edge function sweeps every 15 minutes. It syncs person-level contact traits to Loops, emits three trigger events (`paywall_hit`, `checkout_abandoned`, `dormant_signup`), and deletes contacts whose consent was revoked. Copy and timing live in Loops; Postgres decides who qualifies. Transactional email (welcome, thank-you, invite, dunning) stays on Resend and is not touched.

**Tech Stack:** Deno edge functions, Postgres (Supabase), Loops REST API, React 19 + TanStack Query (CRM), PostHog (measurement only).

**Spec:** `docs/superpowers/specs/2026-07-31-loops-lifecycle-marketing-emails-design.md`

## Global Constraints

- **Consent:** `profiles.marketing_opt_in = true` is required in **every** candidate RPC and the trait sync. Opted-out users are never synced to Loops at all.
- **Recipient:** exactly one owner per workspace, chosen by `order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc limit 1`. Consent does **not** fall through to another owner.
- **Attempt cap:** `attempts < 20`. Derived from Loops' 24h idempotency window; do not raise it.
- **Loops idempotency:** `Idempotency-Key` header, deterministic value `<event_type>/<workspace_id>`. **409 is success.**
- **Loops contact delete:** `POST /v1/contacts/delete`, exactly one of `email` or `userId`. **404 is success.**
- **72h frequency cap:** one marketing email per workspace per 72h, enforced by `claim_marketing_email`, not by a predicate alone.
- **Migration versions:** `20260731000001`–`20260731000005`. Re-verify against `git ls-tree origin/main:supabase/migrations | tail` at PR-open time; a duplicate prefix is silently skipped.
- **No em-dashes in user-facing copy.** Period, colon, or `·`.
- **Edge function rules:** never return raw error detail to clients; `buildCorsHeaders(req)` never wildcard; every outbound `fetch` bounded by `AbortSignal.timeout(10_000)`.
- **CI gates before pushing:** `npm run lint`, `npm run format:check`, `npm run test`, `npm run test:functions`. `git checkout -- deno.lock` after `test:functions` (it always dirties the root lockfile).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/loops.ts` | Loops REST client: `updateContact`, `deleteContact`, `sendEvent`. Pure I/O, no business logic. |
| `supabase/functions/_shared/posthog.ts` | Server-side PostHog capture. Failures swallowed. |
| `supabase/functions/loops-sync-cron/handler.ts` | Sweep orchestration over injected deps. No `Deno.env`, no `fetch`. |
| `supabase/functions/loops-sync-cron/index.ts` | Env, cron-secret auth, dependency construction. |
| `supabase/functions/paywall-report/index.ts` | Authenticated paywall-hit recorder. Membership check is the security boundary. |
| `supabase/migrations/20260731000001_paywall_hits.sql` | `paywall_hits` table. |
| `supabase/migrations/20260731000002_checkout_attempts.sql` | `checkout_attempts` table. |
| `supabase/migrations/20260731000003_loops_contacts.sql` | `loops_contacts` vendor-identity ledger. |
| `supabase/migrations/20260731000004_loops_sync_rpcs.sql` | `claim_marketing_email`, three candidate RPCs, backfill seed, cron schedule. |
| `supabase/migrations/20260731000005_schedule_loops_sync_cron.sql` | `cron.schedule`, applied last. |
| `apps/crm/src/lib/paywall-report.ts` | Browser-side reporter with per-session dedupe. |
| `apps/crm/src/components/paywall/FeatureGate.tsx` | Report on locked render + upgrade click (2 features). |
| `apps/crm/src/lib/entitlement-toast.tsx` | Report trigger-based denials (7 features). The load-bearing source. |

---

## Task 1: Loops REST client

**Files:**
- Create: `supabase/functions/_shared/loops.ts`
- Test: `supabase/functions/__tests__/loops-client_test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `updateContact(p: { email: string; traits: Record<string, unknown> }, fetchImpl?: typeof fetch): Promise<void>`
  - `deleteContact(p: { email: string }, fetchImpl?: typeof fetch): Promise<void>`
  - `sendEvent(p: { email: string; eventName: string; properties: Record<string, unknown>; idempotencyKey: string }, fetchImpl?: typeof fetch): Promise<void>`

The optional `fetchImpl` parameter exists solely so tests can inject a stub without touching globals; production callers omit it.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/loops-client_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { deleteContact, sendEvent, updateContact } from "../_shared/loops.ts";

Deno.env.set("LOOPS_API_KEY", "test-key");

function stubFetch(status: number, capture?: { req?: Request }) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (capture) capture.req = new Request(input as string, init);
    return Promise.resolve(new Response(JSON.stringify({ success: status < 300 }), { status }));
  };
}

Deno.test("sendEvent posts eventName and the idempotency key", async () => {
  const cap: { req?: Request } = {};
  await sendEvent({
    email: "a@b.com",
    eventName: "paywall_hit",
    properties: { feature: "feature_hub_portal" },
    idempotencyKey: "paywall_hit/ws-1",
  }, stubFetch(200, cap));

  assertEquals(cap.req!.headers.get("Idempotency-Key"), "paywall_hit/ws-1");
  assertEquals(cap.req!.headers.get("Authorization"), "Bearer test-key");
  const body = await cap.req!.json();
  assertEquals(body.eventName, "paywall_hit");
  assertEquals(body.email, "a@b.com");
  assertEquals(body.eventProperties.feature, "feature_hub_portal");
});

Deno.test("sendEvent treats 409 as success (key already accepted)", async () => {
  await sendEvent({
    email: "a@b.com",
    eventName: "paywall_hit",
    properties: {},
    idempotencyKey: "paywall_hit/ws-1",
  }, stubFetch(409));
});

Deno.test("sendEvent throws on 500 so the claim stays undelivered", async () => {
  let threw = false;
  try {
    await sendEvent({
      email: "a@b.com",
      eventName: "paywall_hit",
      properties: {},
      idempotencyKey: "k",
    }, stubFetch(500));
  } catch {
    threw = true;
  }
  assert(threw, "expected a throw on 500");
});

Deno.test("deleteContact treats 404 as success (already absent)", async () => {
  await deleteContact({ email: "gone@b.com" }, stubFetch(404));
});

Deno.test("deleteContact throws on 500", async () => {
  let threw = false;
  try {
    await deleteContact({ email: "a@b.com" }, stubFetch(500));
  } catch {
    threw = true;
  }
  assert(threw, "expected a throw on 500");
});

Deno.test("updateContact posts email plus traits flattened at the top level", async () => {
  const cap: { req?: Request } = {};
  await updateContact({ email: "a@b.com", traits: { firstName: "Ana", anyFree: true } }, stubFetch(200, cap));
  const body = await cap.req!.json();
  assertEquals(body.email, "a@b.com");
  assertEquals(body.firstName, "Ana");
  assertEquals(body.anyFree, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx deno test --allow-env --allow-net supabase/functions/__tests__/loops-client_test.ts
```

Expected: FAIL — `Module not found ../_shared/loops.ts`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/loops.ts`:

```ts
/**
 * Loops REST client. Pure I/O: no candidate selection, no ledger writes.
 *
 * Every call is bounded by AbortSignal.timeout — the edge runtime kills isolates
 * on unbounded I/O in ways that bypass catch entirely (documented repo failure
 * mode), and a hang must surface as a normal retryable throw instead.
 */

const BASE = "https://app.loops.so/api/v1";

function apiKey(): string {
  const key = Deno.env.get("LOOPS_API_KEY");
  if (!key) throw new Error("LOOPS_API_KEY not configured");
  return key;
}

async function post(
  path: string,
  body: unknown,
  opts: { idempotencyKey?: string; okStatuses?: number[] },
  fetchImpl: typeof fetch,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
  };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetchImpl(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok || (opts.okStatuses ?? []).includes(res.status)) return res;
  // Status only. Loops error bodies can echo the contact's email, and this
  // message reaches cron_failures.
  throw new Error(`Loops ${path} failed: ${res.status}`);
}

/**
 * Upsert a contact. Loops keys contacts by email and expects custom properties
 * flattened alongside `email`, not nested.
 */
export async function updateContact(
  p: { email: string; traits: Record<string, unknown> },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post("/contacts/update", { email: p.email, ...p.traits }, {}, fetchImpl);
}

/**
 * Remove a contact. 404 means "already absent", which IS the goal state — the
 * revocation sweep would otherwise retry an unresolvable delete to the cap.
 * Deletes by email (not userId) so a post-email-change or post-account-deletion
 * cleanup can still target the old address recorded in loops_contacts.
 */
export async function deleteContact(
  p: { email: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post("/contacts/delete", { email: p.email }, { okStatuses: [404] }, fetchImpl);
}

/**
 * Fire a trigger event. 409 means this Idempotency-Key was already accepted
 * within Loops' 24h window: the event happened, so this is success and the
 * caller marks the claim delivered. Mirrors the Resend 409 branch in
 * _shared/lifecycle-emails.ts.
 */
export async function sendEvent(
  p: {
    email: string;
    eventName: string;
    properties: Record<string, unknown>;
    idempotencyKey: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post(
    "/events/send",
    { email: p.email, eventName: p.eventName, eventProperties: p.properties },
    { idempotencyKey: p.idempotencyKey, okStatuses: [409] },
    fetchImpl,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx deno test --allow-env --allow-net supabase/functions/__tests__/loops-client_test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/loops.ts supabase/functions/__tests__/loops-client_test.ts
git commit -m "feat(loops): add Loops REST client with 409/404 success semantics"
```

---

## Task 2: Schema — paywall_hits, checkout_attempts, loops_contacts

**Files:**
- Create: `supabase/migrations/20260731000001_paywall_hits.sql`
- Create: `supabase/migrations/20260731000002_checkout_attempts.sql`
- Create: `supabase/migrations/20260731000003_loops_contacts.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `paywall_hits`, `checkout_attempts`, `loops_contacts` for Tasks 3, 4, 7 and 8.

- [ ] **Step 1: Verify no version-prefix collision**

```bash
git ls-tree --name-only origin/main:supabase/migrations | tail -5
```

Expected: the tail is `20260730000009_ideias_solicitacoes.sql`. If anything at `20260731*` already exists on main, renumber all four migrations in this plan upward and update every reference.

- [ ] **Step 2: Write `20260731000001_paywall_hits.sql`**

```sql
-- Paywall denials, recorded so free workspaces that reached for a gated feature
-- can be emailed about it.
-- Spec: docs/superpowers/specs/2026-07-31-loops-lifecycle-marketing-emails-design.md
--
-- NOT written by enforce_plan_feature: that function RAISEs, and the raise
-- aborts the transaction, rolling any INSERT back with it. Writes come from the
-- paywall-report edge function (service role) instead.
create table if not exists paywall_hits (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  user_id         uuid null references auth.users(id) on delete set null,
  feature         text not null,
  clicked_upgrade boolean not null default false,
  hit_at          timestamptz not null default now()
);

create index if not exists paywall_hits_workspace_hit_at
  on paywall_hits (workspace_id, hit_at desc);

alter table paywall_hits enable row level security;

create policy "paywall_hits_service_role" on paywall_hits
  for all to service_role using (true) with check (true);
-- No authenticated policy: the CRM never writes here directly, only via
-- paywall-report, which authorises against workspace_members first.
```

- [ ] **Step 3: Write `20260731000002_checkout_attempts.sql`**

```sql
-- One row per Stripe Checkout session actually created.
--
-- workspace_subscriptions.created_at cannot serve this purpose: it is set once
-- at first customer creation, billing-checkout writes the customer row BEFORE
-- stripe.checkout.sessions.create can fail, and the on-conflict upsert never
-- refreshes the timestamp. Using it would email people who never reached a
-- checkout page and could never detect a second abandonment.
create table if not exists checkout_attempts (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  stripe_session_id text not null unique,
  plan_id           text null references plans(id),
  created_at        timestamptz not null default now()
);

create index if not exists checkout_attempts_workspace_created
  on checkout_attempts (workspace_id, created_at desc);

alter table checkout_attempts enable row level security;

create policy "checkout_attempts_service_role" on checkout_attempts
  for all to service_role using (true) with check (true);
```

- [ ] **Step 4: Write `20260731000003_loops_contacts.sql`**

```sql
-- Vendor-identity ledger: which email address was actually synced to Loops.
--
-- Loops keys contacts by email, so honouring a consent revocation, an email
-- change, or an account deletion requires knowing the address that was sent.
-- None of that is derivable from live state after the fact.
--
-- on delete SET NULL, deliberately NOT cascade: when the account goes, this row
-- must SURVIVE carrying synced_email, because that is the only remaining handle
-- for deleting the contact at Loops. A cascade would erase the evidence needed
-- to honour the erasure.
--
-- Hence the surrogate `id` primary key: user_id cannot be the PK, because SET
-- NULL on a primary key column is a constraint violation. A nullable UNIQUE
-- user_id gives the one-row-per-user guarantee AND survives the user's
-- deletion; the PK guarantees the row remains addressable afterwards, which is
-- what markContactDeleted(id) needs.
create table if not exists loops_contacts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid null unique references auth.users(id) on delete set null,
  synced_email text not null,
  synced_at    timestamptz not null default now(),
  deleted_at   timestamptz null
);

create index if not exists loops_contacts_pending_delete
  on loops_contacts (deleted_at) where deleted_at is null;

alter table loops_contacts enable row level security;

create policy "loops_contacts_service_role" on loops_contacts
  for all to service_role using (true) with check (true);
```

- [ ] **Step 5: Apply locally and verify**

Apply to the **local** database only. Pushing to staging or prod is the human partner's step in Task 13, not this task's — these migrations must not reach a shared environment before the functions that use them are deployed.

```bash
npx supabase start
```

```bash
npx supabase db reset
```

Confirm all three tables exist and that `loops_contacts.user_id` is nullable (a `not null` here means the `on delete set null` FK was written wrong and account deletion will fail):

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d loops_contacts"
```

Expected: `user_id | uuid | |` with no `not null`, and a unique constraint on it.

If Docker is unavailable and `npx supabase start` fails, **report `DONE_WITH_CONCERNS`**: commit the migrations, state that they were not applied anywhere, and do not claim verification. Do not substitute staging.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260731000001_paywall_hits.sql supabase/migrations/20260731000002_checkout_attempts.sql supabase/migrations/20260731000003_loops_contacts.sql
git commit -m "feat(loops): add paywall_hits, checkout_attempts and loops_contacts tables"
```

---

## Task 3: Atomic claim function and candidate RPCs

**Files:**
- Create: `supabase/migrations/20260731000004_loops_sync_rpcs.sql`
- Test: `supabase/tests/entitlements/58_loops_candidates.sql`

**Interfaces:**
- Consumes: `paywall_hits`, `checkout_attempts` (Task 2).
- Produces, for Task 8:
  - `claim_marketing_email(p_email_type text, p_workspace_id uuid, p_user_id uuid, p_attempts int) returns boolean`
  - `get_paywall_hit_candidates()` → `(workspace_id uuid, workspace_name text, owner_user_id uuid, owner_email text, owner_nome text, plan_name text, client_count int, feature text, clicked_upgrade boolean, attempts int)`
  - `get_abandoned_checkout_candidates()` → `(workspace_id, workspace_name, owner_user_id, owner_email, owner_nome, plan_name, hours_since_attempt int, attempts int)`
  - `get_dormant_signup_candidates()` → `(workspace_id, workspace_name, owner_user_id, owner_email, owner_nome, days_since_signup int, attempts int)`
  - `get_loops_trait_candidates()` → `(user_id uuid, email text, nome text, days_since_signup int, workspace_count int, any_free boolean)`
  - `get_loops_contact_deletions()` → `(id uuid, synced_email text)`

- [ ] **Step 1: Write the migration**

> **SUPERSEDED — do not re-execute this block verbatim.** The SQL below is the
> pre-review draft. Five fix rounds landed on top of it and the SHIPPED version is
> `supabase/migrations/20260731000004_loops_sync_rpcs.sql` in git. Re-running this
> block would silently regress four fixes: the `distinct on (u.id)` per-user dedupe
> in `get_dormant_signup_candidates` (duplicate emails), the owner-membership
> re-check in `claim_marketing_email` (tenant disclosure to a removed member),
> `user_id` being dropped from the non-dormant ledger insert (uncaught unique
> violation), and the trialing/active exclusion in `any_free` and two candidate RPCs.
> Read the committed file, not this block.

Create `supabase/migrations/20260731000004_loops_sync_rpcs.sql`:

```sql
-- Candidate RPCs + atomic claim for the Loops marketing sweep.
-- Spec: docs/superpowers/specs/2026-07-31-loops-lifecycle-marketing-emails-design.md
--
-- Shared predicates in every candidate RPC:
--   1. profiles.marketing_opt_in = true, for the ONE deterministically chosen owner
--   2. effective free plan (null plan_id resolves to the is_default plan)
--   3. 72h cap (prefilter only; claim_marketing_email is the authority)
--   4. ledger exclusion: undelivered, stale >1h, attempts < 20

-- Helper: the single default plan id. plans has a unique partial index
-- guaranteeing at most one is_default row (20260501000002).
create or replace function default_plan_id()
returns text language sql stable set search_path = public as $$
  select id from plans where is_default limit 1
$$;

-- ---------------------------------------------------------------------------
-- Atomic claim. Returns true if the caller won.
--
-- Why a function and not a predicate: two overlapping cron runs both SELECT
-- before either writes, so run A can pick paywall_hit and run B
-- checkout_abandoned for the SAME workspace and both pass a SELECT-time cap.
-- The per-type idempotency key cannot help — it dedupes a type against itself,
-- never two different types against each other.
--
-- The advisory lock is transaction-scoped: it releases on commit or crash with
-- no cleanup path to get wrong.
-- ---------------------------------------------------------------------------
create or replace function claim_marketing_email(
  p_email_type text,
  p_workspace_id uuid,
  p_user_id uuid,
  p_attempts int
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  -- Send-time re-check, inside the lock rather than as a separate round trip.
  -- Between the candidate RPC's SELECT and this call the workspace can have
  -- subscribed or the user can have revoked consent. Re-verifying here makes the
  -- decision atomic with the claim; a separate query would reopen the same race
  -- it is meant to close.
  if not exists (
    select 1 from profiles p
    where p.id = p_user_id and p.marketing_opt_in = true
  ) then
    return false;
  end if;

  if not exists (
    select 1 from workspaces w
    where w.id = p_workspace_id
      and coalesce(w.plan_id, default_plan_id()) = default_plan_id()
  ) then
    return false;
  end if;

  if exists (
    select 1 from workspace_subscriptions s
    where s.workspace_id = p_workspace_id and s.status in ('trialing', 'active')
  ) then
    return false;
  end if;

  if exists (
    select 1 from lifecycle_emails
    where workspace_id = p_workspace_id
      and email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
      and sent_at > now() - interval '72 hours'
      and (delivered_at is not null or sent_at > now() - interval '1 hour')
  ) then
    return false;
  end if;

  -- dormant_signup dedupes on (email_type, user_id); the other two on
  -- (email_type, workspace_id). Both rows carry workspace_id regardless, so the
  -- 72h check above sees every marketing send for the workspace.
  if p_email_type = 'dormant_signup' then
    insert into lifecycle_emails (email_type, workspace_id, user_id, sent_at, attempts)
    values (p_email_type, p_workspace_id, p_user_id, now(), p_attempts)
    on conflict (email_type, user_id) do update
      set sent_at = now(), attempts = excluded.attempts, workspace_id = excluded.workspace_id;
  else
    insert into lifecycle_emails (email_type, workspace_id, user_id, sent_at, attempts)
    values (p_email_type, p_workspace_id, p_user_id, now(), p_attempts)
    on conflict (email_type, workspace_id) do update
      set sent_at = now(), attempts = excluded.attempts;
  end if;

  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Candidate RPCs
-- ---------------------------------------------------------------------------

create or replace function get_paywall_hit_candidates()
returns table (
  workspace_id uuid, workspace_name text, owner_user_id uuid, owner_email text,
  owner_nome text, plan_name text, client_count int, feature text,
  clicked_upgrade boolean, attempts int
)
language sql security definer set search_path = public as $$
  select ws.id, ws.name, o.user_id, u.email::text, p.nome,
         pl.name, (select count(*)::int from clientes c where c.conta_id = ws.id),
         h.feature, hc.clicked_upgrade, coalesce(le.attempts, 0)
  from workspaces ws
  cross join lateral (
    select wm.user_id from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) o
  join auth.users u on u.id = o.user_id
  join profiles p on p.id = o.user_id
  left join plans pl on pl.id = coalesce(ws.plan_id, default_plan_id())
  -- Two separate laterals, deliberately: the most recent feature and whether
  -- ANY hit in the window was an upgrade click are different aggregations over
  -- the same rows. Combining them with a window function under LIMIT 1 works but
  -- reads as a bug and breaks the moment someone adds an ORDER BY.
  cross join lateral (
    select ph.feature
    from paywall_hits ph
    where ph.workspace_id = ws.id and ph.hit_at > now() - interval '7 days'
    order by ph.hit_at desc
    limit 1
  ) h
  cross join lateral (
    select coalesce(bool_or(ph.clicked_upgrade), false) as clicked_upgrade
    from paywall_hits ph
    where ph.workspace_id = ws.id and ph.hit_at > now() - interval '7 days'
  ) hc
  left join lifecycle_emails le
    on le.email_type = 'paywall_hit' and le.workspace_id = ws.id
  where p.marketing_opt_in = true
    and u.email is not null
    and coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
    and not exists (
      select 1 from lifecycle_emails le2
      where le2.workspace_id = ws.id
        and le2.email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
        and le2.sent_at > now() - interval '72 hours'
        and (le2.delivered_at is not null or le2.sent_at > now() - interval '1 hour')
    )
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 20))
  order by ws.created_at asc, ws.id asc
  limit 50
$$;

create or replace function get_abandoned_checkout_candidates()
returns table (
  workspace_id uuid, workspace_name text, owner_user_id uuid, owner_email text,
  owner_nome text, plan_name text, hours_since_attempt int, attempts int
)
language sql security definer set search_path = public as $$
  select ws.id, ws.name, o.user_id, u.email::text, p.nome,
         pl.name,
         extract(epoch from (now() - a.created_at))::int / 3600,
         coalesce(le.attempts, 0)
  from workspaces ws
  cross join lateral (
    select wm.user_id from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) o
  join auth.users u on u.id = o.user_id
  join profiles p on p.id = o.user_id
  cross join lateral (
    select ca.created_at, ca.plan_id from checkout_attempts ca
    where ca.workspace_id = ws.id
    order by ca.created_at desc
    limit 1
  ) a
  left join plans pl on pl.id = a.plan_id
  left join lifecycle_emails le
    on le.email_type = 'checkout_abandoned' and le.workspace_id = ws.id
  where p.marketing_opt_in = true
    and u.email is not null
    and a.created_at <= now() - interval '24 hours'
    and coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
    -- A cancelled workspace keeps its subscription mirror row, so row existence
    -- is NOT a proxy for paid. Check status.
    and not exists (
      select 1 from workspace_subscriptions s
      where s.workspace_id = ws.id and s.status in ('trialing', 'active')
    )
    and not exists (
      select 1 from lifecycle_emails le2
      where le2.workspace_id = ws.id
        and le2.email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
        and le2.sent_at > now() - interval '72 hours'
        and (le2.delivered_at is not null or le2.sent_at > now() - interval '1 hour')
    )
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 20))
  order by a.created_at asc, ws.id asc
  limit 50
$$;

create or replace function get_dormant_signup_candidates()
returns table (
  workspace_id uuid, workspace_name text, owner_user_id uuid, owner_email text,
  owner_nome text, days_since_signup int, attempts int
)
language sql security definer set search_path = public as $$
  select ws.id, ws.name, u.id, u.email::text, p.nome,
         extract(epoch from (now() - u.email_confirmed_at))::int / 86400,
         coalesce(le.attempts, 0)
  from auth.users u
  join workspaces ws on ws.created_by = u.id
  join workspace_members wm
    on wm.user_id = u.id and wm.workspace_id = ws.id and wm.role = 'owner'
  join profiles p on p.id = u.id
  left join lifecycle_emails le
    on le.email_type = 'dormant_signup' and le.user_id = u.id
  where p.marketing_opt_in = true
    and u.email is not null
    and u.email_confirmed_at is not null
    and u.email_confirmed_at <= now() - interval '3 days'
    and u.email_confirmed_at >= now() - interval '14 days'
    -- Self-serve discriminator: BOTH halves required. The invite-path fallback
    -- in 20260719000002 sets created_by to the INVITED user when no workspace
    -- exists, which the created_by join alone would misclassify as self-serve.
    and nullif(u.raw_user_meta_data ->> 'conta_id', '') is null
    and coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
    and not exists (select 1 from clientes c where c.conta_id = ws.id)
    and not exists (
      select 1 from lifecycle_emails le2
      where le2.workspace_id = ws.id
        and le2.email_type in ('paywall_hit', 'checkout_abandoned', 'dormant_signup')
        and le2.sent_at > now() - interval '72 hours'
        and (le2.delivered_at is not null or le2.sent_at > now() - interval '1 hour')
    )
    and (le.id is null
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 20))
  order by u.email_confirmed_at asc, u.id asc
  limit 50
$$;

-- Person-level traits only. Workspace facts (name, plan, client count) travel
-- in event properties instead: Loops keys contacts by email, and one person can
-- own several workspaces (max_workspaces_per_user is a real entitlement), so
-- per-workspace traits would be clobbered by whichever workspace synced last.
create or replace function get_loops_trait_candidates()
returns table (
  user_id uuid, email text, nome text, days_since_signup int,
  workspace_count int, any_free boolean
)
language sql security definer set search_path = public as $$
  select u.id, u.email::text, p.nome,
         extract(epoch from (now() - u.email_confirmed_at))::int / 86400,
         count(ws.id)::int,
         bool_or(coalesce(ws.plan_id, default_plan_id()) = default_plan_id())
  from auth.users u
  join profiles p on p.id = u.id
  join workspace_members wm on wm.user_id = u.id and wm.role = 'owner'
  join workspaces ws on ws.id = wm.workspace_id
  where p.marketing_opt_in = true
    and u.email is not null
    and u.email_confirmed_at is not null
  group by u.id, u.email, p.nome, u.email_confirmed_at
  order by u.id
  limit 200
$$;

-- Contacts to remove at Loops: consent revoked, email changed (delete the OLD
-- address), or the account was deleted (user_id nulled by the FK).
create or replace function get_loops_contact_deletions()
returns table (id uuid, synced_email text)
language sql security definer set search_path = public as $$
  select lc.id, lc.synced_email
  from loops_contacts lc
  left join auth.users u on u.id = lc.user_id
  left join profiles p on p.id = lc.user_id
  where lc.deleted_at is null
    and (lc.user_id is null
         or p.marketing_opt_in is distinct from true
         or u.email::text is distinct from lc.synced_email)
  order by lc.synced_at asc
  limit 50
$$;

-- ---------------------------------------------------------------------------
-- Lock everything to the service role.
-- REVOKE FROM PUBLIC alone ALSO strips service_role on this instance (it has
-- bitten this repo before). Grant explicitly, and verify with proacl, not
-- has_function_privilege.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'claim_marketing_email(text,uuid,uuid,int)',
    'get_paywall_hit_candidates()',
    'get_abandoned_checkout_candidates()',
    'get_dormant_signup_candidates()',
    'get_loops_trait_candidates()',
    'get_loops_contact_deletions()',
    'default_plan_id()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Backfill seed: terminal rows so switching the cron on does not blast the
-- entire back catalogue. Same technique as 20260730000001.
-- ---------------------------------------------------------------------------
insert into lifecycle_emails (email_type, workspace_id, delivered_at)
select 'paywall_hit', workspace_id, now() from (
  select distinct workspace_id from paywall_hits
) s
on conflict do nothing;

insert into lifecycle_emails (email_type, workspace_id, delivered_at)
select 'checkout_abandoned', workspace_id, now() from (
  select distinct workspace_id from checkout_attempts
) s
on conflict do nothing;

insert into lifecycle_emails (email_type, user_id, workspace_id, delivered_at)
select distinct 'dormant_signup', u.id, ws.id, now()
from auth.users u
join workspaces ws on ws.created_by = u.id
where u.email_confirmed_at is not null
on conflict do nothing;
```

- [ ] **Step 2: Write the SQL tests**

Create `supabase/tests/entitlements/58_loops_candidates.sql`. The harness convention is `\set ON_ERROR_STOP on`, `\i supabase/tests/entitlements/_helpers.sql`, then one `begin` / `rollback` block per case with `raise exception` on a failed assertion. `et_make_workspace(p_plan_id text, p_overrides jsonb)` creates a workspace and returns its id.

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Fixture builder: a confirmed self-serve owner of a fresh workspace on the
-- given plan, with the given consent. Returns (user_id, workspace_id).
create or replace function et_loops_fixture(
  p_plan_id text, p_opt_in boolean, p_confirmed_days_ago int default 5
) returns table (user_id uuid, workspace_id uuid) language plpgsql as $$
declare v_uid uuid := gen_random_uuid(); v_ws uuid;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    values (v_uid, v_uid || '@et.test',
            now() - make_interval(days => p_confirmed_days_ago), '{}'::jsonb);
  v_ws := et_make_workspace(p_plan_id);
  update workspaces set created_by = v_uid where id = v_ws;
  insert into workspace_members (user_id, workspace_id, role)
    values (v_uid, v_ws, 'owner');
  insert into profiles (id, conta_id, role, nome, marketing_opt_in)
    values (v_uid, v_ws, 'owner', 'Ana Silva', p_opt_in);
  return query select v_uid, v_ws;
end $$;

-- 1. An opted-out owner produces NO candidate from any of the three RPCs.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), false);
    insert into paywall_hits (workspace_id, feature) values (f.workspace_id, 'feature_hub_portal');
    insert into checkout_attempts (workspace_id, stripe_session_id)
      values (f.workspace_id, 'cs_' || f.workspace_id);
    update checkout_attempts set created_at = now() - interval '30 hours'
      where workspace_id = f.workspace_id;

    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'opted-out owner produced a paywall_hit candidate'; end if;
    select count(*) into n from get_abandoned_checkout_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'opted-out owner produced a checkout_abandoned candidate'; end if;
    select count(*) into n from get_dormant_signup_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'opted-out owner produced a dormant_signup candidate'; end if;
    select count(*) into n from get_loops_trait_candidates() where user_id = f.user_id;
    if n <> 0 then raise exception 'opted-out owner was synced to Loops'; end if;
  end $$;
rollback;

-- 2. A workspace on a paid (non-default) plan produces no candidate.
begin;
  do $$
  declare f record; n int; v_paid text;
  begin
    select id into v_paid from plans where not is_default limit 1;
    select * into f from et_loops_fixture(v_paid, true);
    insert into paywall_hits (workspace_id, feature) values (f.workspace_id, 'feature_hub_portal');
    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'paid workspace produced a candidate'; end if;
  end $$;
rollback;

-- 3. A CANCELLED subscription still counts as free: the mirror row survives
--    cancellation, so row existence is not a proxy for paid.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    insert into workspace_subscriptions (workspace_id, stripe_customer_id, status)
      values (f.workspace_id, 'cus_' || f.workspace_id, 'canceled');
    insert into paywall_hits (workspace_id, feature) values (f.workspace_id, 'feature_leads');
    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'cancelled workspace was not treated as free (got %)', n; end if;
  end $$;
rollback;

-- 4. THE REGRESSION: a dormant_signup sent 12h ago must suppress a paywall_hit
--    for the same workspace. Before dormant rows carried workspace_id, the cap
--    predicate could not see them at all.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    insert into lifecycle_emails (email_type, user_id, workspace_id, sent_at, delivered_at)
      values ('dormant_signup', f.user_id, f.workspace_id, now() - interval '12 hours', now() - interval '12 hours');
    insert into paywall_hits (workspace_id, feature) values (f.workspace_id, 'feature_hub_portal');
    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception '72h cap did not cross event types'; end if;
  end $$;
rollback;

-- 5. Two claim_marketing_email calls for DIFFERENT types on one workspace:
--    exactly one wins.
begin;
  do $$
  declare f record; a boolean; b boolean;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    a := claim_marketing_email('paywall_hit', f.workspace_id, f.user_id, 1);
    b := claim_marketing_email('checkout_abandoned', f.workspace_id, f.user_id, 1);
    if not a then raise exception 'first claim should have won'; end if;
    if b then raise exception 'second claim of a different type should have been refused'; end if;
  end $$;
rollback;

-- 6. Send-time re-check: a workspace that subscribed after the RPC selected it
--    loses the claim.
begin;
  do $$
  declare f record; won boolean;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    insert into workspace_subscriptions (workspace_id, stripe_customer_id, status)
      values (f.workspace_id, 'cus_' || f.workspace_id, 'active');
    won := claim_marketing_email('paywall_hit', f.workspace_id, f.user_id, 1);
    if won then raise exception 'claim succeeded for a workspace with an active subscription'; end if;
  end $$;
rollback;

-- 7. An invited user (conta_id in signup metadata) is not a dormant_signup
--    candidate, even though workspaces.created_by points at them.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    update auth.users set raw_user_meta_data = jsonb_build_object('conta_id', f.workspace_id::text)
      where id = f.user_id;
    select count(*) into n from get_dormant_signup_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'invited user produced a dormant_signup candidate'; end if;
  end $$;
rollback;

-- 8. Attempt cap: 20 is terminal, 19 with a stale claim is still eligible.
begin;
  do $$
  declare f record; n int;
  begin
    select * into f from et_loops_fixture((select id from plans where is_default), true);
    insert into paywall_hits (workspace_id, feature) values (f.workspace_id, 'feature_leads');
    insert into lifecycle_emails (email_type, workspace_id, sent_at, attempts)
      values ('paywall_hit', f.workspace_id, now() - interval '2 hours', 20);
    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'attempts = 20 should be terminal'; end if;

    update lifecycle_emails set attempts = 19
      where email_type = 'paywall_hit' and workspace_id = f.workspace_id;
    select count(*) into n from get_paywall_hit_candidates() where workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'attempts = 19 with a stale claim should be eligible (got %)', n; end if;
  end $$;
rollback;

drop function if exists et_loops_fixture(text, boolean, int);
```

Note on case 8: the stale claim is 2 hours old, which clears the 1-hour freshness gate, but it also sits inside the 72h cap window. The cap's `not exists` clause excludes rows that are `delivered_at is not null OR sent_at > now() - 1 hour` — a stale undelivered claim satisfies neither, so it does not suppress its own retry. Confirm this by running the case; if it fails, the cap clause is wrong, not the test.

- [ ] **Step 3: Run the tests against the LOCAL database**

The entitlements harness runs against a local Supabase, **not** staging — see `scripts/test-entitlements.sh` (`SUPABASE_DB_URL` defaults to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`). Never point this suite at a shared environment: the fixtures insert into `auth.users` and `workspaces`, and only the `begin`/`rollback` blocks keep that clean.

```bash
npx supabase start
```

```bash
npm run test:db
```

Expected: a PASS line for `58_loops_candidates.sql` along with every other suite.

If Docker is unavailable and `npx supabase start` fails, **stop and report `DONE_WITH_CONCERNS`**: commit the migration and the test file, state clearly that the SQL tests were written but not executed, and do not claim they pass. Do not substitute staging.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260731000004_loops_sync_rpcs.sql supabase/tests/entitlements/58_loops_candidates.sql
git commit -m "feat(loops): add claim_marketing_email and candidate RPCs"
```

---

## Task 4: paywall-report edge function

**Files:**
- Create: `supabase/functions/paywall-report/index.ts`
- Test: `supabase/functions/__tests__/paywall-report_test.ts`

**Interfaces:**
- Consumes: `paywall_hits` (Task 2).
- Produces: `POST /functions/v1/paywall-report` accepting `{ workspace_id: string, feature: string, clicked_upgrade?: boolean }` with an `Authorization: Bearer <user JWT>` header. Returns `{ success: true }` / 401 / 403 / 400.
- Produces: `createPaywallReportHandler(deps)` and `PaywallReportDeps`, exported so the test can drive the handler without a network.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/paywall-report_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import { createPaywallReportHandler, type PaywallReportDeps } from "../paywall-report/index.ts";

function makeDeps(over: Partial<PaywallReportDeps> = {}): PaywallReportDeps {
  return {
    getUser: () => Promise.resolve({ id: "user-1" }),
    isMember: () => Promise.resolve(true),
    insertHit: () => Promise.resolve(),
    ...over,
  };
}

function req(body: unknown, auth = "Bearer tok"): Request {
  return new Request("https://x/paywall-report", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("rejects a request with no Authorization header", async () => {
  const res = await createPaywallReportHandler(makeDeps())(
    new Request("https://x/paywall-report", { method: "POST", body: "{}" }),
  );
  assertEquals(res.status, 401);
});

Deno.test("rejects when the token resolves to no user", async () => {
  const deps = makeDeps({ getUser: () => Promise.resolve(null) });
  const res = await createPaywallReportHandler(deps)(req({ workspace_id: "ws-1", feature: "f" }));
  assertEquals(res.status, 401);
});

Deno.test("rejects a workspace the caller is not a member of", async () => {
  let inserted = false;
  const deps = makeDeps({
    isMember: () => Promise.resolve(false),
    insertHit: () => {
      inserted = true;
      return Promise.resolve();
    },
  });
  const res = await createPaywallReportHandler(deps)(
    req({ workspace_id: "someone-elses-ws", feature: "feature_hub_portal" }),
  );
  assertEquals(res.status, 403);
  assertEquals(inserted, false, "must not insert for a non-member");
});

Deno.test("membership is checked against the AUTHENTICATED user id, not the body", async () => {
  const seen: Array<{ userId: string; workspaceId: string }> = [];
  const deps = makeDeps({
    getUser: () => Promise.resolve({ id: "real-user" }),
    isMember: (userId, workspaceId) => {
      seen.push({ userId, workspaceId });
      return Promise.resolve(true);
    },
  });
  await createPaywallReportHandler(deps)(
    req({ workspace_id: "ws-1", feature: "f", user_id: "spoofed-user" }),
  );
  assertEquals(seen, [{ userId: "real-user", workspaceId: "ws-1" }]);
});

Deno.test("rejects a body missing workspace_id or feature", async () => {
  const res = await createPaywallReportHandler(makeDeps())(req({ feature: "f" }));
  assertEquals(res.status, 400);
});

Deno.test("inserts the hit for a valid member and defaults clicked_upgrade to false", async () => {
  const rows: Array<Record<string, unknown>> = [];
  const deps = makeDeps({
    insertHit: (row) => {
      rows.push(row);
      return Promise.resolve();
    },
  });
  const res = await createPaywallReportHandler(deps)(
    req({ workspace_id: "ws-1", feature: "feature_hub_portal" }),
  );
  assertEquals(res.status, 200);
  assertEquals(rows, [{
    workspace_id: "ws-1",
    user_id: "user-1",
    feature: "feature_hub_portal",
    clicked_upgrade: false,
  }]);
});

Deno.test("passes clicked_upgrade through when set", async () => {
  const rows: Array<Record<string, unknown>> = [];
  const deps = makeDeps({ insertHit: (row) => { rows.push(row); return Promise.resolve(); } });
  await createPaywallReportHandler(deps)(
    req({ workspace_id: "ws-1", feature: "f", clicked_upgrade: true }),
  );
  assertEquals(rows[0].clicked_upgrade, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx deno test --allow-env --allow-net supabase/functions/__tests__/paywall-report_test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/paywall-report/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder } from "../_shared/http.ts";

export interface PaywallReportDeps {
  getUser: (token: string) => Promise<{ id: string } | null>;
  isMember: (userId: string, workspaceId: string) => Promise<boolean>;
  insertHit: (row: {
    workspace_id: string;
    user_id: string;
    feature: string;
    clicked_upgrade: boolean;
  }) => Promise<void>;
}

/**
 * Records a paywall denial.
 *
 * SECURITY BOUNDARY: authorisation is a workspace_members lookup for the
 * AUTHENTICATED user id against the workspace_id in the body. It is deliberately
 * NOT a profiles.conta_id check — conta_id tracks the ACTIVE workspace
 * (get_my_conta_id returns active_workspace_id, 20260317_multi_workspace.sql),
 * so in a multi-workspace account it routinely diverges from the target. Using
 * it would turn this into a cross-tenant write path.
 *
 * The body is attacker-controlled and is trusted for nothing except being the
 * subject of that membership check.
 */
export function createPaywallReportHandler(deps: PaywallReportDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return json({ error: "Unauthorized" }, 401);

    try {
      const user = await deps.getUser(token);
      if (!user) return json({ error: "Unauthorized" }, 401);

      const body = await req.json().catch(() => null) as
        | { workspace_id?: unknown; feature?: unknown; clicked_upgrade?: unknown }
        | null;
      const workspaceId = typeof body?.workspace_id === "string" ? body.workspace_id : "";
      const feature = typeof body?.feature === "string" ? body.feature : "";
      if (!workspaceId || !feature) return json({ error: "Invalid request" }, 400);

      if (!(await deps.isMember(user.id, workspaceId))) {
        return json({ error: "Forbidden" }, 403);
      }

      await deps.insertHit({
        workspace_id: workspaceId,
        user_id: user.id,
        feature,
        clicked_upgrade: body?.clicked_upgrade === true,
      });
      return json({ success: true }, 200);
    } catch (e) {
      // Never leak detail: log internally, return generic.
      console.error("[paywall-report] error:", e instanceof Error ? e.message : String(e));
      return json({ error: "Internal server error" }, 500);
    }
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service-role client + getUser(token) is the repo's user-token verification
// pattern; the anon client cannot verify these tokens.
const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(createPaywallReportHandler({
  getUser: async (token) => {
    const { data } = await svc.auth.getUser(token);
    return data?.user ? { id: data.user.id } : null;
  },
  isMember: async (userId, workspaceId) => {
    const { data, error } = await svc
      .from("workspace_members")
      .select("user_id")
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  },
  insertHit: async (row) => {
    const { error } = await svc.from("paywall_hits").insert(row);
    if (error) throw error;
  },
}));
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx deno test --allow-env --allow-net supabase/functions/__tests__/paywall-report_test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/paywall-report/index.ts supabase/functions/__tests__/paywall-report_test.ts
git commit -m "feat(loops): add paywall-report function with workspace_members authorization"
```

---

## Task 5: CRM paywall reporting

**Files:**
- Create: `apps/crm/src/lib/paywall-report.ts`
- Create: `apps/crm/src/lib/__tests__/paywall-report.test.ts`
- Modify: `apps/crm/src/components/paywall/FeatureGate.tsx`

**Interfaces:**
- Consumes: `POST /functions/v1/paywall-report` (Task 4).
- Produces: `reportPaywallHit(p: { workspaceId: string; feature: string; clickedUpgrade?: boolean }): void` — fire-and-forget, deduped per session.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/paywall-report.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { __resetPaywallReportDedupe, reportPaywallHit } from '../paywall-report';

describe('reportPaywallHit', () => {
  beforeEach(() => {
    __resetPaywallReportDedupe();
    vi.restoreAllMocks();
  });

  it('posts workspace_id and feature once per session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_hub_portal' });
    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_hub_portal' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      workspace_id: 'ws-1',
      feature: 'feature_hub_portal',
      clicked_upgrade: false,
    });
  });

  it('treats a different feature on the same workspace as a distinct report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_leads' });
    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_ideas' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('always sends an upgrade click, even after the render was already reported', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_leads' });
    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_leads', clickedUpgrade: true });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).clicked_upgrade).toBe(true);
  });

  it('never throws when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(() => reportPaywallHit({ workspaceId: 'ws-1', feature: 'f' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- paywall-report
```

Expected: FAIL — cannot resolve `../paywall-report`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/lib/paywall-report.ts`:

```ts
import { supabase } from './supabase';

/**
 * Records that a free workspace was denied a gated feature, feeding the
 * `paywall_hit` marketing trigger.
 *
 * Fire-and-forget on purpose: this is a marketing signal, never worth delaying
 * or failing a user action. Every failure path is swallowed.
 *
 * FeatureGate renders on every page view, so renders are deduped per
 * (workspace, feature) per session. An upgrade CLICK is always sent: it is a
 * strictly higher-intent signal and must not be swallowed by the render dedupe.
 */
const reported = new Set<string>();

/** Test-only: clears the per-session dedupe set. */
export function __resetPaywallReportDedupe(): void {
  reported.clear();
}

export function reportPaywallHit(p: {
  workspaceId: string;
  feature: string;
  clickedUpgrade?: boolean;
}): void {
  const clicked = p.clickedUpgrade === true;
  const key = `${p.workspaceId}:${p.feature}`;
  if (!clicked) {
    if (reported.has(key)) return;
    reported.add(key);
  }

  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paywall-report`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: p.workspaceId,
          feature: p.feature,
          clicked_upgrade: clicked,
        }),
      });
    } catch {
      // Marketing signal only. Never surface to the user.
    }
  })();
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test -- paywall-report
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into FeatureGate**

Replace `apps/crm/src/components/paywall/FeatureGate.tsx` with:

```tsx
import { ReactNode, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEntitlements } from '../../hooks/useEntitlements';
import { AuthContext } from '../../context/AuthContext';
import { reportPaywallHit } from '../../lib/paywall-report';

/** Renders children only if the feature is enabled; otherwise an inline upgrade nudge. */
export function FeatureGate({
  flag,
  label,
  children,
}: {
  flag: string;
  label?: string;
  children: ReactNode;
}) {
  const { hasFeature, isLoading } = useEntitlements();
  const navigate = useNavigate();
  const { profile } = useContext(AuthContext);
  const workspaceId = profile?.conta_id ?? null;
  const locked = !isLoading && !hasFeature(flag);

  // Reported from an effect, not during render: render must stay side-effect
  // free, and StrictMode double-invokes render in dev. The per-session dedupe in
  // reportPaywallHit absorbs the effect's own double-invoke.
  useEffect(() => {
    if (locked && workspaceId) reportPaywallHit({ workspaceId, feature: flag });
  }, [locked, workspaceId, flag]);

  if (isLoading || hasFeature(flag)) return <>{children}</>;
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      <p>{label ?? 'Este recurso'} não está disponível no seu plano.</p>
      <button
        className="mt-2 underline text-primary"
        onClick={() => {
          if (workspaceId) {
            reportPaywallHit({ workspaceId, feature: flag, clickedUpgrade: true });
          }
          navigate('/configuracao/cobranca');
        }}
      >
        Fazer upgrade
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Run the existing FeatureGate tests to check for regressions**

```bash
npm run test -- FeatureGate
```

Expected: PASS. If the existing tests fail because `AuthContext` is not provided in their render tree, wrap the renders in the existing test file with the same provider those tests already use elsewhere in the suite, or supply a default context value. Do not change `FeatureGate`'s rendering behaviour to make them pass.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

```bash
git add apps/crm/src/lib/paywall-report.ts apps/crm/src/lib/__tests__/paywall-report.test.ts apps/crm/src/components/paywall/FeatureGate.tsx
git commit -m "feat(loops): report paywall hits from FeatureGate"
```

---

## Task 6: Report paywalls from the central mutation error handler

**Files:**
- Modify: `apps/crm/src/lib/entitlement-toast.tsx`
- Modify: `apps/crm/src/App.tsx:65` (pass the workspace id through)
- Test: `apps/crm/src/lib/__tests__/entitlement-toast.test.tsx`

**Interfaces:**
- Consumes: `reportPaywallHit` (Task 5), `mapEntitlementError` (existing).
- Produces: nothing consumed by later tasks.

**Why this task is load-bearing, not a fallback:** `FeatureGate` exists at only 5 call sites covering `feature_csv_import` and `feature_mcp`. Everything in `20260611140003_feature_triggers.sql` — `feature_hub_portal`, `feature_ideas`, `feature_financial`, `feature_contracts`, `feature_leads`, `feature_brand_customization`, `feature_custom_properties` — is a database trigger reached by a direct client write, with no edge function in the path. Those denials surface **only** here. Without this task the `paywall_hit` trigger misses most real paywalls, including `feature_hub_portal`.

The hook point already exists: `handleEntitlementMutationError` is wired into the global `MutationCache.onError` in `App.tsx:65`, and `mapEntitlementError` already parses both the DB-trigger shape (`"feature_disabled:feature_hub_portal"` in the PostgREST message) and the edge-function JSON shape (`{ error, feature }`).

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/entitlement-toast.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';

const reportPaywallHit = vi.fn();
vi.mock('../paywall-report', () => ({ reportPaywallHit: (...a: unknown[]) => reportPaywallHit(...a) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { handleEntitlementMutationError } from '../entitlement-toast';

describe('handleEntitlementMutationError paywall reporting', () => {
  beforeEach(() => reportPaywallHit.mockClear());

  it('reports a DB-trigger feature denial', () => {
    handleEntitlementMutationError(
      { message: 'feature_disabled:feature_hub_portal' },
      'ws-1',
    );
    expect(reportPaywallHit).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      feature: 'feature_hub_portal',
    });
  });

  it('reports an edge-function feature denial', () => {
    handleEntitlementMutationError({ error: 'feature_disabled', feature: 'feature_mcp' }, 'ws-1');
    expect(reportPaywallHit).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      feature: 'feature_mcp',
    });
  });

  it('does NOT report a limit error (limit gates are slice 2)', () => {
    handleEntitlementMutationError({ message: 'plan_limit_exceeded:max_clients' }, 'ws-1');
    expect(reportPaywallHit).not.toHaveBeenCalled();
  });

  it('does not report when no workspace id is known', () => {
    handleEntitlementMutationError({ message: 'feature_disabled:feature_leads' }, null);
    expect(reportPaywallHit).not.toHaveBeenCalled();
  });

  it('returns false and reports nothing for an unrelated error', () => {
    expect(handleEntitlementMutationError(new Error('network'), 'ws-1')).toBe(false);
    expect(reportPaywallHit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- entitlement-toast
```

Expected: FAIL — `handleEntitlementMutationError` takes one argument, so the workspace-id assertions fail.

- [ ] **Step 3: Update `entitlement-toast.tsx`**

```tsx
import { toast } from 'sonner';
import { mapEntitlementError, entitlementMessage } from './entitlement-errors';
import { reportPaywallHit } from './paywall-report';

/**
 * If `err` is an entitlement error, shows an upgrade toast and returns true.
 * Owners get a "Fazer upgrade" action to /configuracao/cobranca; non-owner copy
 * is handled by the upgrade-unlock screen (Plan 2) — here we always offer the link,
 * since only owners trigger plan-limited create flows in practice.
 *
 * Also records feature denials for the `paywall_hit` marketing trigger. This is
 * the ONLY observation point for the trigger-based gates in
 * 20260611140003_feature_triggers.sql (hub portal, ideias, financial, contracts,
 * leads, brand, custom properties): those are DB triggers fired by direct client
 * writes, with no edge function in the path. FeatureGate covers only
 * feature_csv_import and feature_mcp.
 *
 * Limit errors are deliberately NOT reported: limit gates are slice 2.
 */
export function handleEntitlementMutationError(
  err: unknown,
  workspaceId: string | null,
): boolean {
  const mapped = mapEntitlementError(err);
  if (!mapped) return false;

  if (mapped.kind === 'feature' && workspaceId) {
    reportPaywallHit({ workspaceId, feature: mapped.key });
  }

  toast.error(entitlementMessage(mapped), {
    action: {
      label: 'Fazer upgrade',
      onClick: () => {
        window.location.href = '/configuracao/cobranca';
      },
    },
  });
  return true;
}
```

- [ ] **Step 4: Pass the workspace id at the call site**

Read `apps/crm/src/App.tsx` around line 55-75 first. The `MutationCache.onError` callback lives outside React's tree, so it cannot use `useContext`. Read the active workspace from the same source the rest of the app uses at module scope — the cached profile in `lib/supabase.ts` (`getCachedProfile()` or equivalent). Grep for the accessor:

```bash
grep -n "export function get.*Profile\|cachedProfile" apps/crm/src/lib/supabase.ts
```

Then update the call to pass `conta_id` from that cached profile, falling back to `null`:

```ts
    onError: (error) => {
      // ... existing comment retained
      handleEntitlementMutationError(error, getCachedProfile()?.conta_id ?? null);
    },
```

If no synchronous accessor exists, add one to `lib/supabase.ts` that returns the already-cached profile without a network call. Do **not** make `onError` async.

- [ ] **Step 5: Run the tests**

```bash
npm run test -- entitlement-toast
```

Expected: PASS, 5 tests.

```bash
npm run test
```

Expected: PASS — the signature change is source-breaking, so grep for other callers first:

```bash
grep -rn "handleEntitlementMutationError" apps/crm/src
```

Every call site must pass the second argument.

- [ ] **Step 6: Add the MCP server-side inserts**

`mcp-keys/index.ts:54` and `mcp-oauth-consent/index.ts:127` already catch `FeatureDisabledError`. In each catch block, before returning the 403, insert the hit directly with the service-role client already in scope:

```ts
        if (e instanceof FeatureDisabledError) {
          // Marketing signal; never let it change the response.
          try {
            await svc.from("paywall_hits").insert({
              workspace_id: workspaceId,
              user_id: userId,
              feature: "feature_mcp",
            });
          } catch (insErr) {
            console.error("[mcp] paywall_hits insert failed:", insErr instanceof Error ? insErr.message : String(insErr));
          }
          return json({ error: "feature_disabled", feature: "feature_mcp" }, 403);
        }
```

Read each file first to confirm the exact names of the in-scope service client, workspace id and user id variables — they differ between the two functions. Do not assume `svc`, `workspaceId` or `userId`.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

```bash
npm run test:functions
```

```bash
git checkout -- deno.lock
git add apps/crm/src/lib/entitlement-toast.tsx apps/crm/src/lib/__tests__/entitlement-toast.test.tsx apps/crm/src/App.tsx supabase/functions/mcp-keys/index.ts supabase/functions/mcp-oauth-consent/index.ts
git commit -m "feat(loops): report trigger-based and MCP paywall denials"
```

---

## Task 7: Record checkout attempts

**Files:**
- Modify: `supabase/functions/billing-checkout/index.ts` (after `stripe.checkout.sessions.create`, before the URL is returned)

**Interfaces:**
- Consumes: `checkout_attempts` (Task 2).
- Produces: rows in `checkout_attempts` for `get_abandoned_checkout_candidates()` (Task 3).

- [ ] **Step 1: Add the insert**

In `supabase/functions/billing-checkout/index.ts`, immediately after the existing `if (!session.url) throw new Error("Stripe returned no checkout URL");` line and before `return json({ url: session.url }, 200, headers);`, insert:

```ts
    // Marketing signal for the checkout_abandoned trigger. Placed AFTER the
    // session exists so only a reachable checkout page is recorded.
    //
    // Log and swallow, never fail the checkout: the Stripe session is already
    // live at this point, so throwing would 500 a user who is one click from
    // paying and push them to start another session. Losing one marketing
    // trigger is by far the cheaper failure. stripe_session_id is UNIQUE, so a
    // retried request reusing a session is a no-op, not a duplicate.
    try {
      await svc.from("checkout_attempts").insert({
        workspace_id: workspaceId,
        stripe_session_id: session.id,
        plan_id: planId,
      });
    } catch (e) {
      console.error(
        "[billing-checkout] checkout_attempts insert failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
```

- [ ] **Step 2: Verify the insert cannot reject the request**

Read the surrounding function and confirm:
- the `try/catch` is nested **inside** the handler's existing outer `try`, not replacing it;
- no `return` or `throw` was introduced in the catch;
- `planId` and `workspaceId` are both in scope at that point (they are — `planId` is used in `subscription_data.metadata`).

- [ ] **Step 3: Run the edge-function suite**

```bash
npm run test:functions
```

Expected: PASS with no new failures.

- [ ] **Step 4: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/billing-checkout/index.ts
git commit -m "feat(loops): record checkout attempts for the abandonment trigger"
```

---

## Task 8: Sweep handler

**Files:**
- Create: `supabase/functions/loops-sync-cron/handler.ts`
- Test: `supabase/functions/__tests__/loops-sync-cron_test.ts`

**Interfaces:**
- Consumes: `sendEvent`, `updateContact`, `deleteContact` (Task 1); the RPCs and `claim_marketing_email` (Task 3).
- Produces: `runLoopsSyncCron(deps: LoopsCronDeps): Promise<{ traitsSynced: number; eventsSent: number; contactsDeleted: number; failed: number }>` and the exported `LoopsCronDeps` interface for Task 9.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/loops-sync-cron_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { type LoopsCronDeps, runLoopsSyncCron } from "../loops-sync-cron/handler.ts";

type Sent = { email: string; eventName: string; properties: Record<string, unknown>; idempotencyKey: string };

function makeDeps(over: Partial<LoopsCronDeps> = {}): LoopsCronDeps & {
  sent: Sent[];
  claimed: string[];
  deleted: string[];
  traits: Array<{ email: string; traits: Record<string, unknown> }>;
} {
  const sent: Sent[] = [];
  const claimed: string[] = [];
  const deleted: string[] = [];
  const traits: Array<{ email: string; traits: Record<string, unknown> }> = [];
  const base = {
    sent,
    claimed,
    deleted,
    traits,
    rpc: (_name: string) => Promise.resolve({ data: [], error: null }),
    claim: (type: string, wsId: string) => {
      claimed.push(`${type}/${wsId}`);
      return Promise.resolve(true);
    },
    markDelivered: () => Promise.resolve(),
    recordContactSync: () => Promise.resolve(),
    markContactDeleted: () => Promise.resolve(),
    sendEvent: (p: Sent) => {
      sent.push(p);
      return Promise.resolve();
    },
    updateContact: (p: { email: string; traits: Record<string, unknown> }) => {
      traits.push(p);
      return Promise.resolve();
    },
    deleteContact: (p: { email: string }) => {
      deleted.push(p.email);
      return Promise.resolve();
    },
    capture: () => Promise.resolve(),
    report: () => Promise.resolve(),
  };
  return { ...base, ...over } as LoopsCronDeps & typeof base;
}

const PAYWALL_ROW = {
  workspace_id: "ws-1",
  workspace_name: "Agência A",
  owner_user_id: "user-1",
  owner_email: "a@b.com",
  owner_nome: "Ana Silva",
  plan_name: "Free",
  client_count: 3,
  feature: "feature_hub_portal",
  clicked_upgrade: true,
  attempts: 0,
};

Deno.test("sends a paywall_hit event with a deterministic idempotency key", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW] : [],
        error: null,
      }),
  });
  const res = await runLoopsSyncCron(deps);

  assertEquals(res.eventsSent, 1);
  assertEquals(deps.sent[0].eventName, "paywall_hit");
  assertEquals(deps.sent[0].idempotencyKey, "paywall_hit/ws-1");
  assertEquals(deps.sent[0].email, "a@b.com");
  assertEquals(deps.sent[0].properties.feature, "feature_hub_portal");
  assertEquals(deps.sent[0].properties.clickedUpgrade, true);
  assertEquals(deps.sent[0].properties.workspaceName, "Agência A");
  assertEquals(deps.sent[0].properties.clientCount, 3);
});

// Regression guard. dormant_signup's ledger row keys on user_id and its
// workspace_id MOVES when the reported workspace changes, so a workspace-scoped
// key would change between a send and its retry, Loops would not dedupe, and the
// person would get a second email. See the comment in handler.ts.
Deno.test("dormant_signup uses a USER-scoped idempotency key, not workspace-scoped", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_dormant_signup_candidates"
          ? [{
            workspace_id: "ws-9",
            workspace_name: "Agência B",
            owner_user_id: "user-7",
            owner_email: "d@e.com",
            owner_nome: "Bruno",
            days_since_signup: 5,
            attempts: 0,
          }]
          : [],
        error: null,
      }),
  });
  await runLoopsSyncCron(deps);

  assertEquals(deps.sent[0].idempotencyKey, "dormant_signup/user-7");
  assert(
    !deps.sent[0].idempotencyKey.includes("ws-9"),
    "dormant key must not be scoped to the workspace",
  );
});

Deno.test("claims before sending", async () => {
  const order: string[] = [];
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW] : [],
        error: null,
      }),
    claim: () => {
      order.push("claim");
      return Promise.resolve(true);
    },
    sendEvent: () => {
      order.push("send");
      return Promise.resolve();
    },
  });
  await runLoopsSyncCron(deps);
  assertEquals(order, ["claim", "send"]);
});

Deno.test("a lost claim skips the send entirely (72h cap arbitration)", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW] : [],
        error: null,
      }),
    claim: () => Promise.resolve(false),
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.eventsSent, 0);
  assertEquals(deps.sent.length, 0);
});

Deno.test("a failed send leaves the claim undelivered and is counted as failed", async () => {
  let delivered = 0;
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW] : [],
        error: null,
      }),
    sendEvent: () => Promise.reject(new Error("Loops 500")),
    markDelivered: () => {
      delivered++;
      return Promise.resolve();
    },
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.eventsSent, 0);
  assertEquals(res.failed, 1);
  assertEquals(delivered, 0, "must not mark delivered after a failed send");
});

Deno.test("one failing candidate does not abort the rest of the sweep", async () => {
  const second = { ...PAYWALL_ROW, workspace_id: "ws-2", owner_email: "c@d.com" };
  let calls = 0;
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW, second] : [],
        error: null,
      }),
    sendEvent: (p: Sent) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve();
    },
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.eventsSent, 1);
  assertEquals(res.failed, 1);
});

Deno.test("syncs traits and records the synced email", async () => {
  const recorded: Array<{ userId: string; email: string }> = [];
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_loops_trait_candidates"
          ? [{
            user_id: "user-1",
            email: "a@b.com",
            nome: "Ana Silva",
            days_since_signup: 5,
            workspace_count: 2,
            any_free: true,
          }]
          : [],
        error: null,
      }),
    recordContactSync: (userId: string, email: string) => {
      recorded.push({ userId, email });
      return Promise.resolve();
    },
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.traitsSynced, 1);
  assertEquals(deps.traits[0].traits.firstName, "Ana");
  assertEquals(deps.traits[0].traits.workspaceCount, 2);
  assertEquals(deps.traits[0].traits.anyFree, true);
  assertEquals(recorded, [{ userId: "user-1", email: "a@b.com" }]);
});

Deno.test("traits carry no workspace-specific facts", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_loops_trait_candidates"
          ? [{
            user_id: "user-1",
            email: "a@b.com",
            nome: "Ana",
            days_since_signup: 5,
            workspace_count: 2,
            any_free: true,
          }]
          : [],
        error: null,
      }),
  });
  await runLoopsSyncCron(deps);
  const keys = Object.keys(deps.traits[0].traits);
  for (const forbidden of ["workspaceName", "planName", "clientCount", "hasInstagram"]) {
    assert(!keys.includes(forbidden), `${forbidden} must not be a contact trait`);
  }
});

Deno.test("deletes revoked contacts by their synced email and marks them deleted", async () => {
  const marked: string[] = [];
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_loops_contact_deletions"
          ? [{ id: "lc-1", synced_email: "old@b.com" }]
          : [],
        error: null,
      }),
    markContactDeleted: (id: string) => {
      marked.push(id);
      return Promise.resolve();
    },
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.contactsDeleted, 1);
  assertEquals(deps.deleted, ["old@b.com"]);
  assertEquals(marked, ["lc-1"]);
});

Deno.test("an RPC error is reported and does not throw", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      name === "get_paywall_hit_candidates"
        ? Promise.resolve({ data: null, error: { message: "boom" } })
        : Promise.resolve({ data: [], error: null }),
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.failed, 1);
});

Deno.test("no candidates is a clean no-op", async () => {
  const deps = makeDeps();
  const res = await runLoopsSyncCron(deps);
  assertEquals(res, { traitsSynced: 0, eventsSent: 0, contactsDeleted: 0, failed: 0 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx deno test --allow-env --allow-net supabase/functions/__tests__/loops-sync-cron_test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/loops-sync-cron/handler.ts`:

```ts
/**
 * Sweep logic for the Loops marketing sync, dependency-injected so tests can
 * drive it without a network.
 *
 * Per trigger candidate:
 *   claim_marketing_email (atomic, arbitrates the 72h cap across ALL marketing
 *   types for the workspace) → send with a deterministic Idempotency-Key →
 *   mark delivered.
 *
 * A lost claim means another sweep, or another trigger type, already spoke to
 * this workspace inside 72h. Skip silently; it is not a failure.
 *
 * A failed send leaves the claim undelivered, so the candidate RPC re-offers it
 * after an hour and Loops dedupes the retry on the unchanged key (24h window,
 * which is why the attempt cap is 20).
 */

import { firstNameFrom } from "../_shared/lifecycle-emails.ts";

interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface LoopsCronDeps {
  rpc: (name: string) => Promise<DbResult<unknown>>;
  claim: (
    emailType: string,
    workspaceId: string,
    userId: string,
    attempts: number,
  ) => Promise<boolean>;
  markDelivered: (
    emailType: string,
    keyCol: "user_id" | "workspace_id",
    keyVal: string,
  ) => Promise<void>;
  recordContactSync: (userId: string, email: string) => Promise<void>;
  markContactDeleted: (id: string) => Promise<void>;
  sendEvent: (p: {
    email: string;
    eventName: string;
    properties: Record<string, unknown>;
    idempotencyKey: string;
  }) => Promise<void>;
  updateContact: (p: { email: string; traits: Record<string, unknown> }) => Promise<void>;
  deleteContact: (p: { email: string }) => Promise<void>;
  capture: (event: string, props: Record<string, unknown>) => Promise<void>;
  report: (detail: { failed: number; errors: Array<{ accountId?: string; error?: string }> }) => Promise<void>;
}

interface TriggerRow {
  workspace_id: string;
  workspace_name: string;
  owner_user_id: string;
  owner_email: string;
  owner_nome: string | null;
  attempts: number;
}

interface PaywallRow extends TriggerRow {
  plan_name: string | null;
  client_count: number;
  feature: string;
  clicked_upgrade: boolean;
}

interface AbandonedRow extends TriggerRow {
  plan_name: string | null;
  hours_since_attempt: number;
}

interface DormantRow extends TriggerRow {
  days_since_signup: number;
}

interface TraitRow {
  user_id: string;
  email: string;
  nome: string | null;
  days_since_signup: number;
  workspace_count: number;
  any_free: boolean;
}

interface DeletionRow {
  id: string;
  synced_email: string;
}

export async function runLoopsSyncCron(
  deps: LoopsCronDeps,
): Promise<{ traitsSynced: number; eventsSent: number; contactsDeleted: number; failed: number }> {
  let traitsSynced = 0;
  let eventsSent = 0;
  let contactsDeleted = 0;
  const errors: Array<{ accountId?: string; error?: string }> = [];

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // --- Trait sync ----------------------------------------------------------
  const traitRes = await deps.rpc("get_loops_trait_candidates");
  if (traitRes.error) {
    errors.push({ error: `trait candidates: ${traitRes.error.message}` });
  } else {
    for (const c of (traitRes.data ?? []) as TraitRow[]) {
      try {
        // Person-level only. Workspace facts go in event properties: Loops keys
        // contacts by email and one person can own several workspaces, so a
        // workspace trait would be clobbered by whichever synced last.
        await deps.updateContact({
          email: c.email,
          traits: {
            firstName: firstNameFrom(c.nome),
            daysSinceSignup: c.days_since_signup,
            workspaceCount: c.workspace_count,
            anyFree: c.any_free,
          },
        });
        await deps.recordContactSync(c.user_id, c.email);
        traitsSynced++;
      } catch (e) {
        errors.push({ accountId: c.user_id, error: msg(e) });
      }
    }
  }

  // --- Trigger sweeps ------------------------------------------------------
  const sweep = async <T extends TriggerRow>(
    rpcName: string,
    emailType: string,
    keyCol: "user_id" | "workspace_id",
    props: (row: T) => Record<string, unknown>,
  ) => {
    const res = await deps.rpc(rpcName);
    if (res.error) {
      errors.push({ error: `${rpcName}: ${res.error.message}` });
      return;
    }
    for (const c of (res.data ?? []) as T[]) {
      try {
        const won = await deps.claim(
          emailType,
          c.workspace_id,
          c.owner_user_id,
          c.attempts + 1,
        );
        // Claim refused. Either another type or another run already emailed
        // this workspace inside 72h, or the send-time re-check found the
        // workspace subscribed / consent revoked between the RPC's SELECT and
        // now. Both are correct outcomes, not failures. No ledger row was
        // written, so if the workspace becomes eligible again it qualifies
        // naturally on a later sweep.
        if (!won) continue;

        // The idempotency key MUST be scoped the same way the ledger row is
        // keyed, or a retry changes key and Loops stops deduping it.
        //
        // `dormant_signup` keys on user_id: it is an email about a PERSON, and
        // its ledger row's workspace_id moves when the reported workspace
        // changes. Concretely: U owns free W1 and W2. The claim writes
        // workspace_id=W1, sendEvent succeeds, markDelivered FAILS (a tolerated,
        // logged outcome). W1 later gains a client and stops qualifying, so the
        // next sweep picks W2; the claim's 72h cap looks for workspace_id=W2,
        // does not see the W1 row, and passes. With a workspace-scoped key the
        // retry would carry `dormant_signup/W2`, Loops would NOT recognise it,
        // and the person gets a second email — bypassing both the cap and Loops
        // dedupe. A user-scoped key makes that retry a 409, which is success.
        //
        // The other two types key on workspace_id in the ledger and legitimately
        // send once per workspace, so their key stays workspace-scoped.
        const idKey = keyCol === "user_id"
          ? `${emailType}/${c.owner_user_id}`
          : `${emailType}/${c.workspace_id}`;

        await deps.sendEvent({
          email: c.owner_email,
          eventName: emailType,
          properties: { workspaceName: c.workspace_name, ...props(c) },
          idempotencyKey: idKey,
        });
        await deps.markDelivered(
          emailType,
          keyCol,
          keyCol === "user_id" ? c.owner_user_id : c.workspace_id,
        );
        // Measurement only: a capture failure must never fail an email.
        try {
          await deps.capture("lifecycle_email_triggered", {
            type: emailType,
            workspace_id: c.workspace_id,
          });
        } catch (e) {
          console.error("[loops-sync-cron] posthog capture failed:", msg(e));
        }
        eventsSent++;
      } catch (e) {
        errors.push({ accountId: c.workspace_id, error: msg(e) });
      }
    }
  };

  await sweep<PaywallRow>(
    "get_paywall_hit_candidates",
    "paywall_hit",
    "workspace_id",
    (r) => ({
      feature: r.feature,
      clickedUpgrade: r.clicked_upgrade,
      planName: r.plan_name,
      clientCount: r.client_count,
    }),
  );

  await sweep<AbandonedRow>(
    "get_abandoned_checkout_candidates",
    "checkout_abandoned",
    "workspace_id",
    (r) => ({ planName: r.plan_name, hoursSinceAttempt: r.hours_since_attempt }),
  );

  await sweep<DormantRow>(
    "get_dormant_signup_candidates",
    "dormant_signup",
    "user_id",
    (r) => ({ daysSinceSignup: r.days_since_signup }),
  );

  // --- Revocation ----------------------------------------------------------
  const delRes = await deps.rpc("get_loops_contact_deletions");
  if (delRes.error) {
    errors.push({ error: `contact deletions: ${delRes.error.message}` });
  } else {
    for (const d of (delRes.data ?? []) as DeletionRow[]) {
      try {
        await deps.deleteContact({ email: d.synced_email });
        await deps.markContactDeleted(d.id);
        contactsDeleted++;
      } catch (e) {
        errors.push({ accountId: d.id, error: msg(e) });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[loops-sync-cron] ${errors.length} failure(s)`, errors);
    await deps.report({ failed: errors.length, errors });
  }
  return { traitsSynced, eventsSent, contactsDeleted, failed: errors.length };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx deno test --allow-env --allow-net supabase/functions/__tests__/loops-sync-cron_test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/loops-sync-cron/handler.ts supabase/functions/__tests__/loops-sync-cron_test.ts
git commit -m "feat(loops): add loops-sync-cron sweep handler"
```

---

## Task 9: Cron entrypoint and PostHog capture

**Files:**
- Create: `supabase/functions/_shared/posthog.ts`
- Create: `supabase/functions/loops-sync-cron/index.ts`

**Interfaces:**
- Consumes: `runLoopsSyncCron`, `LoopsCronDeps` (Task 8); `_shared/loops.ts` (Task 1).
- Produces: the deployable `loops-sync-cron` function and `capturePostHog(event, distinctId, props)`.

- [ ] **Step 1: Write `_shared/posthog.ts`**

```ts
/**
 * Server-side PostHog capture. Measurement only — nothing in a delivery path
 * reads PostHog, and a failure here must never fail the thing being measured,
 * so callers swallow the throw.
 *
 * POSTHOG_PROJECT_KEY is the PROJECT WRITE key (the same value as the frontend's
 * VITE_POSTHOG_KEY), not a personal API key. Unset is a silent no-op so staging
 * and local runs work without it.
 */
const HOST = Deno.env.get("POSTHOG_HOST") ?? "https://eu.i.posthog.com";

export async function capturePostHog(
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const key = Deno.env.get("POSTHOG_PROJECT_KEY");
  if (!key) return;
  const res = await fetch(`${HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event,
      distinct_id: distinctId,
      properties,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`PostHog capture failed: ${res.status}`);
}
```

- [ ] **Step 2: Write `loops-sync-cron/index.ts`**

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { deleteContact, sendEvent, updateContact } from "../_shared/loops.ts";
import { capturePostHog } from "../_shared/posthog.ts";
import { type LoopsCronDeps, runLoopsSyncCron } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const CRON_NAME = "loops-sync-cron";

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const json = createJsonResponder(cors);

  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Bounded global fetch: a stalled PostgREST call would otherwise hang until
  // the edge runtime kills the isolate, bypassing catch and cron-failure triage
  // entirely (documented repo failure mode).
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
            : AbortSignal.timeout(10_000),
        }),
    },
  });

  try {
    const deps: LoopsCronDeps = {
      rpc: (name) => svc.rpc(name) as unknown as Promise<{ data: unknown; error: { message: string } | null }>,
      claim: async (emailType, workspaceId, userId, attempts) => {
        const { data, error } = await svc.rpc("claim_marketing_email", {
          p_email_type: emailType,
          p_workspace_id: workspaceId,
          p_user_id: userId,
          p_attempts: attempts,
        });
        if (error) throw new Error(`claim failed: ${error.message}`);
        return data === true;
      },
      markDelivered: async (emailType, keyCol, keyVal) => {
        const { error } = await svc
          .from("lifecycle_emails")
          .update({ delivered_at: new Date().toISOString() })
          .eq("email_type", emailType)
          .eq(keyCol, keyVal);
        // A failed update leaves an undelivered claim: the stale retry re-sends
        // with the same idempotency key and Loops dedupes. Log, don't throw.
        if (error) {
          console.error(
            `[${CRON_NAME}] delivered_at update failed for ${emailType}/${keyVal}:`,
            error.message,
          );
        }
      },
      recordContactSync: async (userId, email) => {
        const { error } = await svc.from("loops_contacts").upsert(
          { user_id: userId, synced_email: email, synced_at: new Date().toISOString(), deleted_at: null },
          { onConflict: "user_id" },
        );
        if (error) throw new Error(`contact sync record failed: ${error.message}`);
      },
      markContactDeleted: async (id) => {
        const { error } = await svc
          .from("loops_contacts")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw new Error(`contact delete record failed: ${error.message}`);
      },
      sendEvent,
      updateContact,
      deleteContact,
      capture: (event, props) =>
        capturePostHog(event, String(props.workspace_id ?? "unknown"), props),
      report: (detail) => reportCronFailure(svc, CRON_NAME, detail),
    };

    const result = await runLoopsSyncCron(deps);
    return json({ success: true, ...result });
  } catch (e) {
    console.error(`[${CRON_NAME}] run failed:`, e instanceof Error ? e.message : String(e));
    await reportCronFailure(svc, CRON_NAME, {
      failed: 1,
      errors: [{ error: e instanceof Error ? e.message : String(e) }],
    });
    return json({ error: "Cron run failed" }, 500);
  }
});
```

- [ ] **Step 3: Verify the whole edge suite still passes**

```bash
npm run test:functions
```

Expected: PASS, including the new `loops-client_test.ts`, `paywall-report_test.ts` and `loops-sync-cron_test.ts`.

- [ ] **Step 4: Commit**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/posthog.ts supabase/functions/loops-sync-cron/index.ts
git commit -m "feat(loops): add loops-sync-cron entrypoint and server-side PostHog capture"
```

---

## Task 10: Crisp identification

**Files:**
- Modify: `apps/crm/src/context/AuthContext.tsx` (at the `identifyWorkspaceUser` call, around line 186)

**Interfaces:**
- Consumes: `profile` from `AuthContext`.
- Produces: nothing consumed by later tasks.

**Scope note:** the spec says to cut the `session:data` half if plan and client count are not available at one call site. **Client count is not available anywhere in `useEntitlements` or `useWorkspaceLimits`** (verified — neither exposes it). So this task ships `user:email` and `user:nickname` only. Do **not** build a client-count query for a support nicety.

- [ ] **Step 1: Add the Crisp identification**

In `apps/crm/src/context/AuthContext.tsx`, immediately after the existing `identifyWorkspaceUser({...})` call, add:

```ts
          // Crisp is loaded anonymously in index.html, so the inbox shows no
          // identity. Email + name only: client count is not available from any
          // existing hook, and the spec explicitly says not to build a data path
          // for it. Guarded because Crisp's script may not have loaded yet.
          try {
            const p = nextProfile as Profile;
            window.$crisp?.push(['set', 'user:email', [session.user.email ?? '']]);
            if (p.nome) window.$crisp?.push(['set', 'user:nickname', [p.nome]]);
          } catch {
            // Never let a support-tooling nicety break auth.
          }
```

If `session` is not in scope at that point, use the email already available on the resolved user object in that closure. Read the surrounding 30 lines before editing to confirm which identifier is in scope — do not guess.

- [ ] **Step 2: Confirm the `$crisp` type declaration exists**

```bash
grep -rn "\$crisp" apps/crm/src --include="*.d.ts" --include="*.ts" --include="*.tsx" | grep -v "push(\[" 
```

`AppLayout.tsx:95` already calls `window.$crisp?.push(...)`, so a declaration exists somewhere. If `tsc` reports `Property '$crisp' does not exist on type 'Window'`, add the declaration to the same file that declares it for `AppLayout`.

- [ ] **Step 3: Typecheck and run the auth tests**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

```bash
npm run test -- AuthContext
```

Expected: PASS. The existing `AuthContext.test.tsx` runs in jsdom where `window.$crisp` is undefined, which the optional chaining handles.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/context/AuthContext.tsx
git commit -m "feat(loops): identify the user in Crisp"
```

---

## Task 11: Privacy policy subprocessor entry

**Files:**
- Modify: `apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx` (subprocessor list, near line 75)

**Interfaces:** none.

**Why this is a task and not a footnote:** Loops is a new US-hosted subprocessor receiving names and email addresses. Shipping sends without the policy entry is the LGPD failure mode here, and no test catches it.

- [ ] **Step 1: Read the existing subprocessor list**

```bash
sed -n '60,95p' apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx
```

Match the exact markup and tone of the neighbouring entries (PostHog is at line 75).

- [ ] **Step 2: Add the Loops entry**

Following the same JSX shape as its siblings, add an entry reading:

```
Loops · envio de e-mails de marketing e ciclo de vida (nome e e-mail).
Dados processados nos Estados Unidos.
```

No em-dashes: use `·` as the separator, matching the sibling entries.

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

```bash
git add apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx
git commit -m "docs(privacy): add Loops to the subprocessor list"
```

---

## Task 12: Schedule the cron

**Files:**
- Create: `supabase/migrations/20260731000005_schedule_loops_sync_cron.sql`

**Interfaces:** none.

**Ordering requirement:** this migration must be applied **only after** `loops-sync-cron` is deployed and `20260731000004` is applied, because `cron.schedule` fires immediately. It is a separate migration for exactly that reason.

- [ ] **Step 1: Write the migration**

```sql
-- Schedule loops-sync-cron every 15 minutes.
-- Spec: docs/superpowers/specs/2026-07-31-loops-lifecycle-marketing-emails-design.md
--
-- Apply ONLY AFTER the loops-sync-cron function is deployed AND 20260731000004
-- (RPCs + claim + backfill seed) is applied: the schedule fires immediately.
--
-- Rollback order is the REVERSE: SELECT cron.unschedule('loops-sync-cron')
-- first, then undeploy. Keep the lifecycle_emails and loops_contacts rows —
-- they are the record of what was already sent and synced; deleting them
-- re-mails everyone on a future re-rollout.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...)
-- (that function form does not exist on this instance).
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'loops-sync-cron') THEN
    PERFORM cron.unschedule('loops-sync-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'loops-sync-cron',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/loops-sync-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

- [ ] **Step 2: Commit (do not apply yet)**

```bash
git add supabase/migrations/20260731000005_schedule_loops_sync_cron.sql
git commit -m "feat(loops): schedule loops-sync-cron every 15 minutes"
```

---

## Task 13: Full verification and staging rollout

**Files:** none modified.

- [ ] **Step 1: Run every CI gate**

```bash
npm run lint
```

```bash
npm run format:check
```

```bash
npm run test
```

```bash
npm run test:functions
```

```bash
git checkout -- deno.lock
```

- [ ] **Step 2: Typecheck all three apps and the scripts**

`npm run build` only typechecks the CRM. CI checks all four, so run all four:

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

```bash
npx tsc -p apps/hub/tsconfig.json --noEmit
```

```bash
npx tsc -p apps/admin/tsconfig.json --noEmit
```

```bash
npx tsc -p tsconfig.scripts.json
```

- [ ] **Step 3: Confirm the migration prefixes are still free**

```bash
git ls-tree --name-only origin/main:supabase/migrations | tail -5
```

If main has moved and now contains any `20260731*` prefix, renumber all five migrations upward. A duplicate prefix is silently skipped by Supabase, which surfaces as a missing table weeks later.

- [ ] **Step 4: Confirm you are linked to STAGING**

```bash
cat supabase/.temp/project-ref
```

Must read `wlyzhyfondykzpsiqsce`. The link state flips between sessions.

- [ ] **Step 5: Set the staging secrets**

Set `LOOPS_API_KEY` and `POSTHOG_PROJECT_KEY` via the Supabase dashboard. Do **not** pass secrets as literal CLI arguments; use file redirection or the dashboard.

- [ ] **Step 6: Deploy the functions**

```bash
npx supabase functions deploy paywall-report --no-verify-jwt --use-api
```

```bash
npx supabase functions deploy loops-sync-cron --no-verify-jwt --use-api
```

```bash
npx supabase functions deploy billing-checkout --use-api
```

- [ ] **Step 7: Apply migrations 1–4, then verify before scheduling**

```bash
npx supabase db push --linked
```

Then confirm the backfill seeded terminal rows rather than leaving live candidates:

```sql
select email_type, count(*) filter (where delivered_at is not null) as seeded,
       count(*) filter (where delivered_at is null) as pending
from lifecycle_emails
where email_type in ('paywall_hit','checkout_abandoned','dormant_signup')
group by email_type;
```

Expected: `pending` is 0 for all three immediately after the seed.

- [ ] **Step 8: Smoke-test with one opted-in free workspace**

On staging, pick a workspace on the default plan whose chosen owner has `marketing_opt_in = true`, insert a `paywall_hits` row for it, delete its seeded `paywall_hit` ledger row, then invoke the cron manually with the `x-cron-secret` header. Confirm:
- the response reports `eventsSent: 1`;
- the event appears in Loops;
- a second immediate invocation reports `eventsSent: 0` (the 72h cap held);
- `loops_contacts` has a row with the synced email.

- [ ] **Step 9: Schedule the cron on staging**

Apply `20260731000005` and confirm `SELECT jobname, schedule FROM cron.job WHERE jobname = 'loops-sync-cron';` returns one row.

- [ ] **Step 10: Open the PR**

```bash
gh pr create --title "feat: event-triggered marketing emails via Loops" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-07-31-loops-lifecycle-marketing-emails-design.md

Three triggers for free-plan workspaces: paywall_hit, checkout_abandoned,
dormant_signup. Loops owns copy and timing; Postgres decides who qualifies.
Transactional email stays on Resend and is untouched.

Gated on profiles.marketing_opt_in throughout, including the contact sync.
72h frequency cap enforced by an atomic SQL claim, not a predicate.

Prod deploy is NOT part of this merge. See the rollout order in the spec.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-merge production rollout

Not part of implementation. Follow the spec's rollout order exactly: secrets → migrations 1–4 → deploy `paywall-report`, `billing-checkout`, `loops-sync-cron` → ship the CRM change → **let `checkout_attempts` accumulate for at least 24h** (the abandonment trigger is meaningless against an empty table) → privacy policy live → migration 5 (schedule).

Configure the three loops in Loops itself before scheduling. The events arrive whether or not a loop exists to receive them.
