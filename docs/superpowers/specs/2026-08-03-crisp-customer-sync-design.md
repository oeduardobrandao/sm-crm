# Crisp customer sync — Design

**Date:** 2026-08-03
**Status:** Approved. Brainstorm 2026-08-03. Ready for implementation, with two vendor facts
to confirm by `curl` at the top of implementation (see "Open vendor questions").

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
| Change detection | **Payload fingerprint** in the ledger. This is the one deliberate departure from the Loops precedent — see below. |
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
| `supabase/functions/crisp-sync-cron/handler.ts` | Sweep logic, dependency-injected so tests drive it without a network. |
| `supabase/functions/crisp-sync-cron/index.ts` | `x-cron-secret` gate, service-role client, deps wiring, cron-failure triage. |
| `20260804000001_crisp_contacts.sql` | Ledger table + RLS. |
| `20260804000002_crisp_sync_rpcs.sql` | Candidate / deletion / record RPCs + service-role grants. |
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
needs the `website:people:manage` scope (write) and `website:people:read` (the read half of
the read-modify-write below).

**Prerequisite, and the one thing that can block deployment:** a plugin token with those
scopes must be created in the Crisp Marketplace for the Mesaas website. A development token
works for staging but carries lower quotas.

### Error handling

Every vendor call is bounded by `AbortSignal.timeout(10_000)`. This is not defensive
boilerplate: the edge runtime kills isolates on unbounded I/O in ways that bypass `catch`
entirely, a documented failure mode in this repo, and a hang must surface as a normal
retryable throw.

Thrown errors carry **HTTP status only, never the response body**. Crisp error bodies can echo
the person's email, and this message lands in `cron_failures` and in the alert email. Same
rule as `_shared/loops.ts`.

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

`synced_people_id` is nullable because it is only known after the first successful vendor
round trip, and because the design must not depend on Crisp accepting an email in the
`{people_id}` route position (see "Open vendor questions").

## Payload

| Crisp field | Source | Notes |
|---|---|---|
| `email` | `auth.users.email` | The join key. `email_confirmed_at is not null` required. |
| `person.nickname` | `profiles.nome` | |
| `person.phone` | `profiles.telefone` | Best-effort. This is the field that makes an inbound WhatsApp/SMS matchable. Only self-signup owners have it — the invited-member branch of `handle_new_user_workspace()` never writes `telefone`. Omitted when null rather than sent empty. |
| `data.plano` | `plans.name` of the effective plan | |
| `data.assinatura` | `workspace_subscriptions.status`, else `nenhuma` | |
| `data.plan_source` | `workspaces.plan_source` | Surfaces manual grants, which otherwise look like mystery upgrades. |
| `data.papel` | highest `workspace_members.role` held (`owner` > `admin` > `agent`) | **`workspace_members.role`, not `profiles.role`.** `profiles.role` is a single value tied to `conta_id`, the workspace the account was created against; `workspace_members` (`20260317_multi_workspace.sql`, `check (role in ('owner','admin','agent'))`) is the multi-workspace truth. Someone who owns one workspace and is an agent in another must read as `owner`. |
| `data.workspaces` | comma-joined `workspaces.name` | |
| `data.workspace_count` | int | |
| `data.clientes` | `count(clientes)` across their workspaces | |
| `data.dias_desde_signup` | from `auth.users.email_confirmed_at` | Matches the Loops trait definition. |
| `data.admin_url` | `{APP_BASE_URL}/admin/workspaces/{id}` | The **oldest owned workspace**, deterministically, so multi-workspace owners get a stable link. Route confirmed at `apps/admin/src/router.tsx:30`. |
| `segments` | managed vocabulary, below | |

### What the fingerprint covers

`md5()` over every SQL-derived field in the table above, in a fixed column order, plus the
computed segment set. It is computed **inside the candidate RPC**, so the hash and the payload
cannot drift apart in the way they would if the handler recomputed it.

`admin_url` is not hashed directly. It is a pure function of the oldest owned workspace's id,
which is already covered by the workspace facts — and `APP_BASE_URL` changing is a deploy-time
event, not a per-user one. If that base URL ever does change, the correct repair is a one-off
`update crisp_contacts set synced_fingerprint = null`, which re-offers everyone on the next
sweep. Any field added to the payload later **must** be added to the hash in the same commit,
or it will never propagate to a single existing user.

### The effective-plan rule is not negotiable

`data.plano` and the `pagante` / `free` segments must use the same rule as
`_shared/entitlements.ts` and the Loops candidate RPCs:

```sql
coalesce(ws.plan_id, default_plan_id()) = default_plan_id()
and not exists (
  select 1 from workspace_subscriptions s
  where s.workspace_id = ws.id and s.status in ('trialing', 'active')
)
```

`plan_id` alone is **not sufficient** — it drifts out of sync with real subscription state on
Stripe webhook lag, on a manual action in the Stripe dashboard, and whenever
`plan_source = 'manual'`. The `get_loops_trait_candidates` comment documents this at length.
Here the consequence is worse than mis-segmentation in a campaign: an agent opens a
conversation, reads `free`, and treats a paying customer as a free user to their face.

### Segments

A fixed managed vocabulary, in Portuguese to match the inbox:

`owner` · `membro` · `trial` · `pagante` · `free` · `inadimplente`

Applied by **read-modify-write**, not a blind `PATCH`:

1. `GET` the current profile.
2. Compute the managed set from live state.
3. Remove only members of the managed vocabulary that no longer apply. Leave every other
   segment — anything an operator tagged by hand — untouched.
4. Leave `notepad` and `company` untouched. Those are operator-owned fields; this sync never
   writes them.
5. Write back.

Two vendor calls per **changed** user, which is affordable precisely because the fingerprint
means unchanged users cost nothing. A blind merge-`PATCH` would let `pagante` survive a
downgrade and `trial` survive forever, which is worse than showing nothing: a stale segment is
read as fact.

### Exclusions

- Users with no confirmed email.
- Users **all** of whose workspaces are `is_internal` (seed/demo accounts, including the
  team's own — `20260803000008_workspaces_is_internal.sql`). A user belonging to at least one
  real workspace is still synced. Unlike `fetchInternalWorkspaceIds`, this is expressed in the
  candidate RPC's SQL, because the exclusion is per-*user* and depends on an aggregate over
  their workspaces, not a per-row set-membership test.

## Sweeps

Ordering is deliberate and encodes priority. Do not tidy it.

### 1. Deletions first

`get_crisp_contact_deletions()` — limit 50, ordered `synced_at asc`:

```sql
where lc.deleted_at is null
  and (lc.user_id is null                              -- account deleted
       or u.email::text is distinct from lc.synced_email)  -- email changed
```

Per row: remove the profile at Crisp — addressed by `synced_people_id` when known, falling
back to `synced_email` — then stamp `deleted_at`. A `404` from Crisp counts as
success — "already absent" *is* the goal state, and treating it as a failure would retry an
unresolvable delete forever. Same reasoning as `deleteContact`'s `okStatuses: [404]`.

These run **first** because they are erasure obligations. If an invocation runs out of wall
clock, the upsert sweep is the right thing to lose: it self-heals next run, an unhonoured
erasure does not.

Note the absence of a consent-revocation branch, which `get_loops_contact_deletions` has.
That is the direct consequence of having no consent gate; if a `support_profile_opt_out` flag
is ever added, it becomes a third `or` here and a fourth predicate in the candidate RPC.

### 2. Upserts second

`get_crisp_sync_candidates()` — limit 200, ordered `synced_at asc nulls first, u.id`,
returning only rows where the computed fingerprint differs from `synced_fingerprint`.

Never-synced users sort first, so **the backfill of existing users is free**: it converges
over the first few runs with no one-off script. The `u.id` tiebreak keeps the order total.

The candidate RPC carries the same pending-deletion exclusion as
`get_loops_trait_candidates`, written as a correlated `not exists` rather than folded into a
left join — that RPC's comment explains why at length, and the trap is identical here:
`is distinct from` is two-valued, so the folded form silently drops every user who has no
ledger row at all, which on first deployment is everyone.

### `record_crisp_contact()` is called before the vendor write

```
record_crisp_contact(p_user_id, p_email, p_fingerprint) -> boolean
```

Under a per-user `pg_advisory_xact_lock` in its own lock namespace, it refuses (returns
`false`) when a row exists for this user with `deleted_at is null` and a `synced_email`
different from the one being written. The caller then **skips that person entirely this
sweep**.

Recording before sending is the rule, not an ordering preference. The vendor call *creates*
the profile; a successful call followed by a failed ledger write leaves a person's name,
email and phone resident at a foreign vendor with nothing in our system able to name, find or
erase them. The refusal branch prevents the other half: overwriting `synced_email` while a
deletion is still owed for the previous address strands that address permanently, because
`user_id` is unique and the old value is gone.

### How `synced_people_id` gets written

`record_crisp_contact` cannot write it: it runs *before* the vendor call, and the id is only
known *after*. So a separate `set_crisp_people_id(p_user_id, p_people_id)` is called once, on
the first response that carries an id.

**Its failure is logged and swallowed, never thrown.** `synced_people_id` is a cache, not a
record of what was sent — `synced_email` is that record, and it is already committed by this
point. Losing the cached id costs one extra lookup on the next sweep; throwing here would fail
a person whose profile was already written correctly.

`synced_fingerprint` is written by `record_crisp_contact`, *before* the vendor round trip. That is a
deliberate trade: a fingerprint recorded for a push that then fails means the change is not
retried until the payload changes again. The alternative — writing the fingerprint after the
push — needs a second ledger write per user that can itself fail, and a failure there loops
the same user forever on every sweep. Bounded staleness on a rare failure beats an unbounded
retry loop. The failure is still visible: it is counted, logged, and filed to `cron_failures`.

## Testing

Deno tests mirroring `loops-sync-cron_test.ts` and `loops-client_test.ts`, driving the handler
through injected deps with no network:

1. Deletions run before upserts, and a thrown deletion does not abort the upsert sweep.
2. `404` from the vendor delete marks `deleted_at` rather than counting a failure.
3. `record_crisp_contact` returning `false` skips the person and performs **no** vendor call.
4. A candidate list that comes back empty performs zero vendor calls and reports success —
   the steady state the fingerprint exists to produce. (The fingerprint *comparison* itself is
   SQL and is covered by the psql check in "Rollout", not by a Deno test.)
5. A plan transition `pagante → free` **removes** `pagante` and adds `free`, and leaves an
   unmanaged operator-added segment in place.
6. `person.phone` is omitted, not sent empty, when `telefone` is null.
7. Client errors carry status only — the assertion is that a body containing an email never
   appears in the thrown message.
8. Missing `CRISP_KEY` throws at module load before any candidate is claimed.

`npm run test:functions` dirties the root `deno.lock`; revert it with
`git checkout -- deno.lock` before committing.

## Rollout

1. Create the plugin token in the Crisp Marketplace; set `CRISP_WEBSITE_ID`,
   `CRISP_IDENTIFIER`, `CRISP_KEY` via `supabase secrets`. Confirm `APP_BASE_URL` is set.
2. Apply `…000001` and `…000002`.
3. Deploy: `npx supabase functions deploy crisp-sync-cron --use-api` (the local Docker bundler
   is broken in this repo; the function handles its own auth, so it also needs
   `--no-verify-jwt`).
4. Invoke once by hand with the cron secret and read the response counts. Then **invoke a
   second time and assert the upsert count is zero** — that is the fingerprint working, and it
   is the check that the whole quota argument rests on. If the second run re-pushes the same
   users, stop and fix the hash before scheduling.
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
implementation. Neither changes the design — the ledger stores `synced_people_id` precisely so
the answer to the first does not matter — but both change the client code.

1. **Does `{people_id}` accept an email in place of the Crisp UUID?** The official REST
   reference is silent; a secondary source says yes. If yes, first contact can address the
   profile directly by email. If no, first contact needs a lookup or a create-then-capture-id
   flow. Either way `synced_people_id` is captured from the first successful response and used
   thereafter.
2. **What is the plugin daily quota?** Not published. The fingerprint design makes steady
   state cheap regardless, but the *initial backfill* pushes every existing user within the
   first few sweeps, and that burst is the one moment the quota could bind. If the number
   turns out to be tight, throttle by lowering the candidate limit for the first day rather
   than by widening the cron interval — the limit shapes the burst, the interval only delays
   it.

A third, smaller unknown: whether creating a profile for an email that already exists (from a
prior widget session) returns a conflict status or succeeds idempotently. The read-modify-write
flow starts with a `GET`, so the create path is only reached on a genuine 404 and the window is
narrow — but the client must treat a conflict on create as "exists, re-read and update", not as
a failure.

## Out of scope

- **Crisp in the Hub app.** The agencies' end clients contact their agency, not Mesaas.
- **Event pushes** at signup / Stripe change. Rejected in brainstorm: it puts vendor I/O in
  `stripe-webhook` and the signup trigger, paths where a timeout is a real risk.
- **Crisp conversation data flowing back into the CRM.** One direction only.
- **`support_profile_opt_out`.** Considered and not taken; the hook points where it would
  attach are named above so adding it later is a small change, not a redesign.
