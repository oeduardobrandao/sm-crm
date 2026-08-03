# Crisp customer sync — Design

**Date:** 2026-08-03
**Status:** Approved. Brainstorm 2026-08-03, revised the same day after an external review round
(gpt-5.6-terra) — see "Review resolutions". Ready for implementation, with two vendor facts to
confirm by `curl` at the top of implementation (see "Open vendor questions").

## Goal

Every CRM user exists as a **person profile in Crisp**, carrying enough context that support
recognises them the moment they get in touch, **on any channel** — the chat widget, email to
the support inbox, or WhatsApp — and not only while they happen to be sitting inside the CRM.

Today `apps/crm/index.html` loads the Crisp widget anonymously and
`apps/crm/src/context/AuthContext.tsx` pushes `user:email` and `user:nickname` once a session
hydrates. That is the whole of the integration. It has two gaps:

1. **It is CRM-session-bound.** Someone who emails support without opening the app is an
   unknown address. There is nothing to match against.
2. **It carries no context.** Even inside the app, the inbox shows a name and an email. Not
   the plan, not whether they pay, not how many clients they run, not whether they are the
   owner or an invited agent.

This spec closes both by making Postgres the source of truth and pushing profiles to Crisp
server-side on a cron sweep.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Population | **All confirmed CRM users** — workspace owners *and* invited members. |
| Consent gate | **None.** Crisp is support tooling for existing customers, not marketing. |
| Payload | Phone, plan + subscription state, workspace context, segments. |
| Mechanism | **Cron sweep only.** No writes inside `stripe-webhook` or the signup trigger. |
| Erasure | **`crisp_contacts` ledger + deletion sweep**, mirroring `loops_contacts`. |
| Change detection | **Payload fingerprint** in the ledger, advanced only on confirmed vendor success. The one deliberate departure from the Loops precedent. |
| Frontend | **Unchanged.** |
| Hub / Admin apps | Out of scope. Crisp is not loaded in either. |

### Why no consent gate

`loops-sync-cron` gates everything on `profiles.marketing_opt_in`, and that is correct for
Loops: it sends marketing email, which needs opt-in.

Crisp is a different legal basis. These are people who already hold an account, being made
identifiable to support so their own inbound request can be answered — execução do contrato /
legítimo interesse under the LGPD, not marketing consent. Reusing the marketing gate would
also defeat the stated goal, because the invited-member branch of
`handle_new_user_workspace()` never writes `marketing_opt_in` (see
`20260719000002_signup_marketing_opt_in.sql`, which documents this: "Invited users do not see
this checkbox, so their branch keeps the column default"). Gating on it would leave nearly
every invited member anonymous — precisely the population this spec exists to cover.

The erasure obligation is unaffected and is honoured in full by the deletion sweep.

### Why the fingerprint, and why it departs from Loops

The Loops trait sweep pushes 200 users per run on a rotating `synced_at asc nulls first`
order, with no change detection — the rotation *is* its convergence mechanism, and its comment
says so explicitly. Copying that here would mean roughly **19,200 Crisp writes per day in
steady state even when nothing changed** (200 × 4 runs/hour × 24).

Crisp does not publish the plugin daily quota. Its rate-limit guide states only that plugin
tokens bypass the per-minute limits and are instead subject to a "Plugin Quota" reset daily,
with an instruction to request an increase on the Marketplace if exceeded. A design whose
steady-state cost is a large unknown fraction of an unpublished ceiling is a design that finds
the ceiling in production, as a `420`/`429` storm filed into `cron_failures`.

So the candidate RPC computes an `md5()` over the exact payload it would send and returns only
rows whose hash differs from `crisp_contacts.synced_fingerprint`. Steady state costs
approximately zero vendor calls; a plan change still propagates within one sweep (≤15 min).
The `synced_at asc nulls first` ordering is kept on top of it, so the initial backfill still
converges front-to-back and no user can be starved.

## Architecture

| Piece | Purpose |
|---|---|
| `supabase/functions/_shared/crisp.ts` | Crisp REST client. Pure I/O: no candidate selection, no ledger writes. |
| `supabase/functions/crisp-sync-cron/handler.ts` | Sweep logic + pure payload/segment helpers, dependency-injected so tests drive it without a network. |
| `supabase/functions/crisp-sync-cron/index.ts` | `x-cron-secret` gate, service-role client, deps wiring, cron-failure triage. |
| `supabase/config.toml` | **`[functions.crisp-sync-cron] verify_jwt = false`.** Required: the caller authenticates with `x-cron-secret`, never a JWT. |
| `supabase/functions/__tests__/config-audit_test.ts` | Add the function to `REQUIRED_FUNCTIONS` so the omission above can never regress silently. |
| `20260804000001_crisp_contacts.sql` | Ledger table + RLS. |
| `20260804000002_crisp_sync_rpcs.sql` | Candidate / deletion / record / confirm RPCs + service-role grants. |
| `20260804000003_schedule_crisp_sync_cron.sql` | `cron.schedule`. Applied **last**. |

> Migration version prefixes are provisional. `main`'s tail at the time of writing is
> `20260803000008`. Re-verify with `git ls-tree origin/main:supabase/migrations | tail` and
> renumber above the real tail immediately before opening the PR — a shared prefix is silently
> skipped by Supabase and the `migration-version-guard` job fails the build.

### The frontend does not change

`AuthContext` already pushes `user:email`. Crisp binds a widget session to the person profile
carrying that address, so the profile this cron creates is the one the widget session lands
on — the two halves meet at the email with no extra wiring. Pushing `session:data` from the
client as well would put two writers on the same fields, with the client winning by recency
and carrying strictly less information (the existing comment at `AuthContext.tsx:257` records
that client count is not available from any existing hook, which is exactly why this moved
server-side).

### Secrets

| Variable | Notes |
|---|---|
| `CRISP_WEBSITE_ID` | `bc54b5a7-dc07-46a9-8b6a-1c3ba9923314`, already public in `index.html`. Still an env var, not a literal — staging must be able to point at a different Crisp website. |
| `CRISP_IDENTIFIER` | Plugin token identifier. |
| `CRISP_KEY` | Plugin token key. |

All three are **validated at module load in `index.ts` and throw if missing**, following the
`LOOPS_API_KEY` precedent and for a weaker version of the same reason: failing the whole
invocation before any ledger row is written keeps every candidate retryable once the secret is
actually set, instead of burning a sweep that records syncs which never reached the vendor.

Auth is `Authorization: Basic base64(identifier:key)` plus `X-Crisp-Tier: plugin`. The plugin
needs `website:people:manage` (write) and `website:people:read` (the read half of the
read-modify-write below).

**Prerequisite, and the one thing that can block deployment:** a plugin token with those
scopes must be created in the Crisp Marketplace for the Mesaas website. A development token
works for staging but carries lower quotas.

### Error handling

Every vendor call is bounded by `AbortSignal.timeout(10_000)`. This is not defensive
boilerplate: the edge runtime kills isolates on unbounded I/O in ways that bypass `catch`
entirely, a documented failure mode in this repo, and a hang must surface as a normal
retryable throw.

Thrown errors carry **HTTP status and a static route shape only — never the response body and
never the interpolated path**. Crisp error bodies can echo the person's email, *and so can the
URL itself* when a profile is addressed by email rather than by id. Both would land in
`cron_failures` and in the alert email. So the message is
`Crisp GET /people/profile/:ref failed: 503`, with `:ref` literal.

The service-role client gets the bounded-global-fetch wrapper copied from
`loops-sync-cron/index.ts`, for the same reason applied to PostgREST.

## Data model

```sql
create table if not exists crisp_contacts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid null unique references auth.users(id) on delete set null,
  synced_email       text not null,
  synced_people_id   text null,
  synced_fingerprint text null,
  synced_at          timestamptz not null default now(),
  deleted_at         timestamptz null
);

create index if not exists crisp_contacts_pending_delete
  on crisp_contacts (deleted_at) where deleted_at is null;

alter table crisp_contacts enable row level security;

create policy "crisp_contacts_service_role" on crisp_contacts
  for all to service_role using (true) with check (true);
```

`on delete set null`, **deliberately not cascade**: when the account goes, this row must
survive carrying `synced_email`, because after the `auth.users` row is gone that string is the
only remaining handle for erasing the person at Crisp. A cascade would destroy the evidence
needed to honour the erasure. This forces the surrogate `id` primary key — `SET NULL` on a PK
column is a constraint violation — and a nullable `unique user_id` gives the one-row-per-person
guarantee while surviving the deletion.

## The write protocol

Three ledger writes bracket each person, in this order. The split matters and is the direct
result of a review finding; do not collapse it back.

```
1. record_crisp_contact(user_id, email) -> boolean      BEFORE the vendor call
2. …vendor read-modify-write…
3. confirm_crisp_sync(user_id, people_id, fingerprint)  AFTER confirmed success
```

**Step 1 records the email and nothing else.** It runs under a per-user
`pg_advisory_xact_lock` in its own lock namespace and refuses (returns `false`) when a row
exists for this user with `deleted_at is null` and a `synced_email` different from the one
being written; the caller then skips that person entirely this sweep.

Recording the email *before* sending is the rule, not an ordering preference. The vendor call
*creates* the profile; a successful call followed by a failed ledger write leaves a person's
name, email and phone resident at a foreign vendor with nothing in our system able to name,
find or erase them. The refusal branch prevents the other half: overwriting `synced_email`
while a deletion is still owed for the previous address strands that address permanently,
because `user_id` is unique and the old value is gone.

**Step 3 advances the fingerprint, and only a confirmed vendor success reaches it.** An
earlier draft of this spec wrote the fingerprint in step 1, trading a rare stale record for
one fewer write. That trade was wrong and the review caught it: a transient failure on a
user's *first* sync would mark them synchronised while no profile existed at Crisp at all, and
the candidate RPC would then exclude them until their source data happened to change. The
failure mode is silent, permanent, and lands hardest on exactly the population this spec
exists to cover. Bounded extra writes beat silent omission.

If step 3 itself fails, the user is simply re-offered next sweep and the vendor
read-modify-write repeats. That is safe because it is idempotent, and it is self-limiting
because a persistently failing Postgres write is a much louder problem than one duplicated
`PUT`.

`confirm_crisp_sync` writes `synced_people_id` and `synced_fingerprint` in one statement, so
there is no window where one landed and the other did not.

## Identity resolution

Resolved per candidate, before any write:

1. `GET /website/{id}/people/profile/{ref}` where `ref` is `synced_people_id` when the ledger
   has one, else the email.
2. **200** → the profile exists. Use `data.people_id` from the response for every subsequent
   call in this iteration, even if `ref` was the email.
3. **404** → `POST /website/{id}/people/profile` with email + person + segments. Capture
   `data.people_id` from the response.
4. **409 / any conflict on create** → treat as "exists", re-issue the `GET` from step 1 once,
   and continue as step 2. A conflict here is expected: a person who used the chat widget
   already has a profile keyed on their email. It is not a failure and must not be counted as
   one.

`synced_people_id` is a **cache, not a record of what was sent** — `synced_email` is that
record. Its only job is to save the email-addressed lookup next time. This is why losing it is
harmless and why step 4 above can always recover by email.

The deletion sweep addresses the profile by `synced_people_id` when present, falling back to
`synced_email`, and **nulls `synced_people_id` in the same update that stamps `deleted_at`**.
Nulling it is not tidiness: on an email change the ledger row is reused by the next upsert, and
a retained id would address the profile that was just deleted.

## Payload

All singular fields describe the person's **primary workspace**, defined once and used
everywhere: *the oldest workspace they own, falling back to their oldest joined workspace when
they own none.* Concretely, `distinct on (user_id) … order by user_id, (role = 'owner') desc,
joined_at asc, workspace_id`. The `workspace_id` tiebreak makes it total, so two runs cannot
disagree.

Segments, by contrast, describe the **person across all their workspaces**. See below.

| Crisp field | Source | Notes |
|---|---|---|
| `email` | `auth.users.email` | The join key. `email_confirmed_at is not null` required. |
| `person.nickname` | `profiles.nome` | |
| `person.phone` | `coalesce(nullif(trim(profiles.whatsapp),''), nullif(trim(profiles.telefone),''))` | **WhatsApp number preferred** — matching an inbound WhatsApp is the channel gap this spec exists to close, and `profiles.whatsapp` is a distinct column from `telefone` (`20260301_baseline_schema.sql:31`). `trim`/`nullif` are required, not cosmetic: `PerfilTab.tsx` writes the raw input straight to both columns, so a cleared field persists as `''` and would otherwise be sent as an empty phone and hashed as a change. Omitted entirely when both are blank. |
| `data.plano` | `plans.name` of `coalesce(ws.plan_id, default_plan_id())` for the primary workspace | Mirrors `resolveEntitlements` exactly — see "Two plan questions" below. |
| `data.assinatura` | `workspace_subscriptions.status` of the primary workspace, else `nenhuma` | Raw Stripe status, not a derived label. Support should see the actual state. |
| `data.plan_source` | `workspaces.plan_source` | Surfaces manual grants, which otherwise look like mystery upgrades. |
| `data.papel` | highest `workspace_members.role` held (`owner` > `admin` > `agent`) | **`workspace_members.role`, not `profiles.role`.** `profiles.role` is a single value tied to `conta_id`, the workspace the account was created against; `workspace_members` (`20260317_multi_workspace.sql`, `check (role in ('owner','admin','agent'))`) is the multi-workspace truth. Someone who owns one workspace and is an agent in another must read as `owner`. |
| `data.workspaces` | `string_agg(ws.name, ', ' order by wm.joined_at, ws.id)` | Ordering is mandatory — see "Canonical serialisation". |
| `data.workspace_count` | `count(*)` over their memberships | |
| `data.clientes` | `sum` of per-workspace `count(clientes)` across their workspaces | |
| `data.cliente_desde` | `to_char(auth.users.email_confirmed_at, 'YYYY-MM-DD')` | **Not** the Loops trait's `days_since_signup`. A day counter changes every midnight, so hashing it would re-push every user once a day forever, and hashing around it would display a number that is silently wrong. An immutable date is stable in the hash and never goes stale. |
| `data.admin_url` | `{APP_BASE_URL}/admin/workspaces/{primary workspace id}` | Always present, for members as well as owners — an agent's workspace is exactly as useful to support. Route confirmed at `apps/admin/src/router.tsx:30`. Built in TypeScript, not SQL; if `APP_BASE_URL` is unset the field is omitted and the run continues. |
| `segments` | managed vocabulary, below | |

### Two plan questions, two different canonical sources

The first draft of this spec claimed `data.plano` follows "the same rule as
`_shared/entitlements.ts`" *and* then quoted the Loops
`plan_id = default_plan_id() and not exists (… 'trialing','active')` predicate. The review
established that those are not the same rule and that neither alone is right here. They answer
different questions:

- **"What can this person actually use?"** → `resolveEntitlements`
  ([`entitlements.ts:49`](supabase/functions/_shared/entitlements.ts#L49)) resolves from
  `workspaces.plan_id` alone, falling back to the default plan. That is what the product
  enforces at every gate, so it is what `data.plano` must report. Nothing else would match
  what the customer is experiencing.
- **"What is Stripe's view of their money?"** → `billing-logic.ts`. `MRR_STATUSES` is
  `{active, past_due}` and its comment is explicit that `past_due` counts because "the
  subscription still exists and Stripe is retrying, so the revenue is in-force". The segments
  must follow this.

These two never contradict, because `statusToPlanId` already returns `null` ("leave `plan_id`
unchanged") for `past_due` and `incomplete` — a customer in grace keeps their paid `plan_id`.
So a `past_due` workspace reports its real paid plan in `data.plano` *and* carries both
`pagante` and `inadimplente`. That is the correct and useful reading.

**The Loops predicate is deliberately not reused here, and must not be "unified" later.** It
exists to answer "should we send a conversion campaign", and it counts a lapsed-but-not-yet-
downgraded workspace as free *on purpose*. Support needs the opposite answer. Copying it would
have told an agent that a customer whose card just failed is a free user — the exact
mis-segmentation this spec elsewhere warns about, except spoken to the customer's face.

### Segments

A fixed managed vocabulary, in Portuguese to match the inbox:

| Segment | Condition |
|---|---|
| `owner` / `membro` | `data.papel = 'owner'` or not |
| `trial` | any workspace has status `trialing` |
| `pagante` | any workspace has status in `{active, past_due}` (= `MRR_STATUSES`) |
| `inadimplente` | any workspace has status `past_due` |
| `free` | any workspace resolves to the default plan and has no `trialing`/`active`/`past_due` subscription |

Segments are computed with `bool_or` **across every workspace the person belongs to**, not
from the primary workspace. This is intentional and is the one place person-level and
workspace-level views deliberately differ: someone who owns a paid workspace and a free one
genuinely carries both `pagante` and `free`, and hiding either would mislead. The singular
`data.*` fields disambiguate by naming the primary workspace, and `data.workspace_count` tells
the agent when to expect more than one.

Applied by **read-modify-write**, not a blind `PATCH`:

1. `GET` the current profile (already done by identity resolution).
2. Compute the managed set from live state.
3. Remove only members of the managed vocabulary that no longer apply. Leave every other
   segment — anything an operator tagged by hand — untouched.
4. Echo `notepad` and `company` back unchanged. `PUT` replaces the profile, so omitting them
   deletes them. These are operator-owned fields; this sync never authors them.
5. Write back.

A blind merge-`PATCH` would let `pagante` survive a downgrade and `trial` survive forever,
which is worse than showing nothing: a stale segment is read as fact.

### Canonical serialisation

The fingerprint is only as good as the determinism of the strings feeding it. Every aggregate
and every nullable is pinned:

- **Every `string_agg` and `array_agg` carries an explicit `ORDER BY`.** Without one
  PostgreSQL may serialise the same unchanged membership set differently between runs,
  which would defeat change detection and burn the exact quota the fingerprint exists to
  protect. `data.workspaces` orders by `joined_at, ws.id`; segments are sorted
  lexicographically before joining.
- **Every nullable is `coalesce(x, '')`** before hashing. Never bare, or one NULL turns the
  whole concatenation into NULL and every such user hashes identically.
- **Fields are joined with a literal `|`** in a fixed column order, so a value containing a
  comma cannot impersonate a field boundary.
- **`person.phone` is trimmed and NULLIF'd before both the payload and the hash**, so `''`
  and `NULL` and `'  '` all produce one identical hash.

### What the fingerprint covers

`md5()` over every SQL-derived field in the payload table, in the fixed order above, plus the
sorted segment set. It is computed **inside the candidate RPC**, so the hash and the payload
cannot drift apart in the way they would if the handler recomputed it.

`admin_url` is not hashed directly. It is a pure function of the primary workspace's id, which
is already covered — and `APP_BASE_URL` changing is a deploy-time event, not a per-user one.
If that base URL ever does change, the correct repair is a one-off
`update crisp_contacts set synced_fingerprint = null`, which re-offers everyone on the next
sweep. Any field added to the payload later **must** be added to the hash in the same commit,
or it will never propagate to a single existing user.

### Exclusions

- Users with no confirmed email.
- Users **all** of whose workspaces are `is_internal` (seed/demo accounts, including the
  team's own — `20260803000008_workspaces_is_internal.sql`). A user belonging to at least one
  real workspace is still synced. Unlike `fetchInternalWorkspaceIds`, this is expressed in the
  candidate RPC's SQL as `not bool_and(is_internal)`, because the exclusion is per-*user* and
  depends on an aggregate over their workspaces, not a per-row set-membership test.

## Sweeps

Ordering is deliberate and encodes priority. Do not tidy it.

### 1. Deletions first

`get_crisp_contact_deletions()` — limit 50, ordered `synced_at asc`:

```sql
where cc.deleted_at is null
  and (cc.user_id is null                                 -- account deleted
       or u.email::text is distinct from cc.synced_email) -- email changed
```

Per row: remove the profile at Crisp, then stamp `deleted_at` and null `synced_people_id`. A
`404` from Crisp counts as success — "already absent" *is* the goal state, and treating it as
a failure would retry an unresolvable delete forever. Same reasoning as `deleteContact`'s
`okStatuses: [404]`.

These run **first** because they are erasure obligations. If an invocation runs out of wall
clock, the upsert sweep is the right thing to lose: it self-heals next run, an unhonoured
erasure does not.

Note the absence of a consent-revocation branch, which `get_loops_contact_deletions` has.
That is the direct consequence of having no consent gate; if a `support_profile_opt_out` flag
is ever added, it becomes a third `or` here and a fourth predicate in the candidate RPC.

### 2. Upserts second

`get_crisp_sync_candidates()` — limit 200, ordered `synced_at asc nulls first, user_id`,
returning only rows where the computed fingerprint differs from `synced_fingerprint`.

Never-synced users sort first, so **the backfill of existing users is free**: it converges
over the first few runs with no one-off script. The `user_id` tiebreak keeps the order total.

The candidate RPC carries the same pending-deletion exclusion as
`get_loops_trait_candidates`, written as a correlated `not exists` rather than folded into a
left join — that RPC's comment explains why at length, and the trap is identical here:
`is distinct from` is two-valued, so the folded form silently drops every user who has no
ledger row at all, which on first deployment is everyone.

## Testing

Deno tests mirroring `loops-sync-cron_test.ts` and `loops-client_test.ts`, driving the handler
through injected deps with no network:

1. Deletions run before upserts, and a thrown deletion does not abort the upsert sweep.
2. `404` from the vendor delete marks `deleted_at` rather than counting a failure.
3. `record_crisp_contact` returning `false` skips the person and performs **no** vendor call.
4. **A vendor failure does not advance the fingerprint** — `confirm_crisp_sync` is not called.
   This is the regression test for the defect the review caught.
5. A `404` on `GET` creates the profile; a conflict on create re-reads and updates instead of
   counting a failure.
6. A plan transition `pagante → free` **removes** `pagante` and adds `free`, and leaves an
   unmanaged operator-added segment in place. `notepad` survives the `PUT`.
7. `person.phone` prefers `whatsapp` over `telefone`, and is omitted — not sent empty — when
   both are `''`.
8. An empty candidate list performs zero vendor calls and reports success.
9. Client errors carry status and a static route shape only: the assertion is that neither an
   email nor a response body ever appears in the thrown message.
10. Missing `CRISP_KEY` throws at module load before any candidate is recorded.
11. `config-audit_test.ts` lists `crisp-sync-cron` (extends the existing test's
    `REQUIRED_FUNCTIONS`).

`npm run test:functions` dirties the root `deno.lock`; revert it with
`git checkout -- deno.lock` before committing.

## Rollout

1. Create the plugin token in the Crisp Marketplace; set `CRISP_WEBSITE_ID`,
   `CRISP_IDENTIFIER`, `CRISP_KEY` via `supabase secrets`. Confirm `APP_BASE_URL` is set.
2. Apply `…000001` and `…000002`.
3. Deploy: `npx supabase functions deploy crisp-sync-cron --use-api --no-verify-jwt` (the local
   Docker bundler is broken in this repo; the function handles its own auth).
4. Invoke once by hand with the cron secret and read the response counts. Then **invoke a
   second time and assert the upsert count is zero** — that is the fingerprint working, and it
   is the check the whole quota argument rests on. If the second run re-pushes the same users,
   stop and fix the hash before scheduling.
5. Apply `…000003` — **the schedule fires immediately**.

Backfill cost is roughly `2 × user_count` vendor calls (the read-modify-write pair), spread
over `ceil(user_count / 200)` sweeps, i.e. one hour per 800 users. After that, near zero.

Staging first, then prod. Verify the linked project with
`cat supabase/.temp/project-ref` before every push; the link state flips.

**Rollback is the reverse**: `SELECT cron.unschedule('crisp-sync-cron')` first, then undeploy.
**Keep the `crisp_contacts` rows.** They are the record of what was pushed to a foreign
vendor; deleting them destroys the only handle for erasing those profiles later.

## Open vendor questions

Both are one `curl` each against the Mesaas website ID, to be resolved at the top of
implementation. Neither changes the protocol above — "Identity resolution" is written to be
correct either way, which is the point — but the first changes how often the fast path is hit.

1. **Does `{people_id}` accept an email in place of the Crisp UUID?** The official REST
   reference is silent; a secondary source says yes. If yes, first contact resolves in one
   `GET`. If no, the `GET` by email 404s and the flow falls through to create-then-conflict-
   then-lookup, which is correct but costs an extra round trip on first contact only. Either
   way `synced_people_id` is captured from the first successful response and used thereafter.
2. **What is the plugin daily quota?** Not published. The fingerprint design makes steady
   state cheap regardless, but the *initial backfill* pushes every existing user within the
   first few sweeps, and that burst is the one moment the quota could bind. If the number
   turns out to be tight, throttle by lowering the candidate limit for the first day rather
   than by widening the cron interval — the limit shapes the burst, the interval only delays
   it.

## Review resolutions

External review (gpt-5.6-terra), 2026-08-03, on the first draft. Seven of eight points
accepted; one was already fixed before the review landed.

| # | Point | Resolution |
|---|---|---|
| P1 | Fingerprint written before the vendor call makes a transient first-write failure permanent | **Accepted, and it was worse than stated.** Split into `record_crisp_contact` (email, before) and `confirm_crisp_sync` (people_id + fingerprint, after confirmed success). The original trade is documented in "The write protocol" so it is not reintroduced. |
| P1 | The `entitlements.ts` attribution is false, and `past_due`/`unpaid` are treated as live subscriptions elsewhere | **Accepted; the citation was wrong.** `resolveEntitlements` reads `plan_id` only. Rewritten as "Two plan questions": `data.plano` follows `entitlements.ts`, segments follow `billing-logic.ts`'s `MRR_STATUSES`. `past_due` now correctly reads as `pagante` **and** `inadimplente` rather than `free`. |
| P1 | Multi-workspace aggregation undefined for singular fields and segments | **Accepted.** "Primary workspace" defined once with a total ordering; segments explicitly `bool_or` across all workspaces, with the person-vs-workspace split stated as intentional. |
| P2 | Unresolved identity behaviour changes the protocol, not just client code | **Accepted.** New "Identity resolution" section pins the GET → 404 → POST → conflict → re-GET flow and states that `synced_people_id` is a recoverable cache. |
| P2 | `admin_url` undefined for members with no owned workspace | **Already fixed** before the review landed — the reviewer read the first draft. Now always present, via the primary-workspace fallback. |
| P2 | Fingerprint over comma-joined names is unstable without explicit ordering and null handling | **Accepted.** New "Canonical serialisation" section: mandatory `ORDER BY` on every aggregate, `coalesce(x,'')` on every nullable, `\|` separator, sorted segments. |
| P2 | `config.toml` entry and the config-audit test are missing from the file list | **Accepted.** Both added to the architecture table; the audit test is test 11. |
| P3 | "Omitted when null" is insufficient — the profile UI writes `''` | **Accepted, and it surfaced a better field.** `trim`/`nullif` now mandatory, and `person.phone` prefers `profiles.whatsapp` over `telefone` — a column the first draft missed entirely, and the one that actually matches an inbound WhatsApp. |

## Out of scope

- **Crisp in the Hub app.** The agencies' end clients contact their agency, not Mesaas.
- **Event pushes** at signup / Stripe change. Rejected in brainstorm: it puts vendor I/O in
  `stripe-webhook` and the signup trigger, paths where a timeout is a real risk.
- **Crisp conversation data flowing back into the CRM.** One direction only.
- **`support_profile_opt_out`.** Considered and not taken; the hook points where it would
  attach are named above so adding it later is a small change, not a redesign.
- **`profiles.whatsapp_opt_in`.** Not consulted. That flag governs whether *we* may message
  them; using the number to recognise a message *they* sent us is not outbound contact. Noted
  explicitly so the omission reads as a decision rather than an oversight.
