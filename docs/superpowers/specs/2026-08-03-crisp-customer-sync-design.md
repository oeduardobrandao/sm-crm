# Crisp customer sync — Design

**Date:** 2026-08-03
**Status:** Approved. Brainstorm 2026-08-03, revised the same day after an external review round
(gpt-5.6-terra) — see "Review resolutions". Ready for implementation, with two vendor facts to
confirm by `curl` at the top of implementation (see "Open vendor questions").

## Goal

Every CRM user exists as a **person profile in Crisp**, carrying enough context that support
recognises them the moment they get in touch — through the chat widget or by email to the
support inbox — and not only while they happen to be sitting inside the CRM. A phone number
is populated in anticipation of WhatsApp matching, which is verified at rollout rather than
assumed; see "The WhatsApp claim is unproven".

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
| Frontend | **Changes: Crisp Identity Verification ships with this.** Reversed on review — see below. |
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
| `20260804000010_crisp_contacts.sql` | Ledger table + RLS. |
| `20260804000011_crisp_sync_rpcs.sql` | Candidate / deletion / record / confirm RPCs + service-role grants. |
| `20260804000012_schedule_crisp_sync_cron.sql` | `cron.schedule`. Applied **last**. |
| `supabase/functions/crisp-identity/index.ts` | Signs the **authenticated caller's own** email with `CRISP_IDENTITY_SECRET`. JWT-verified, so it is not a signing oracle. |
| `apps/crm/src/context/AuthContext.tsx` | Fetch the signature and pass it as the second element of the `user:email` push. |

> Migration version prefixes were renumbered once already: `main` gained
> `20260804000001_workspace_subscriptions_membership_read.sql` after this branch started, which
> collided with the original `20260804000001_crisp_contacts.sql`. The current prefixes leave
> headroom above `main`'s tail. Re-verify with
> `git ls-tree origin/main:supabase/migrations | tail` and renumber above the real tail
> immediately before opening the PR — a shared prefix is silently skipped by Supabase and the
> `migration-version-guard` job fails the build.

### The frontend does change: Identity Verification is a precondition

The first draft asserted the frontend needed no work. **The review overturned that, and it is
the most important finding in this document.**

`AuthContext` pushes `user:email` **unsigned**. Crisp binds a widget session to the person
profile carrying that address, which is what makes the server-created profile and the widget
session meet. But nothing proves the browser owns the address it claims: any visitor can open
the chatbox and assert any customer's email.

Today that is close to harmless, because the profile holds a name and an email — roughly what
the impersonator already had to know to attempt it. **This spec changes that.** After it
ships, claiming a customer's email shows the agent their plan, their subscription state, their
workspace names, their client count, and a deep link into the admin portal for their
workspace. That is a social-engineering aid: the agent sees a rich, confident-looking profile
and is far more likely to treat the request as authenticated. The enrichment is exactly what
creates the risk, so the mitigation ships in the same change.

**Crisp Identity Verification** is the vendor's answer: the backend computes an HMAC-SHA256 of
the user's email under a secret only Crisp and we hold, and the client passes it alongside the
address:

```ts
window.$crisp?.push(['set', 'user:email', [user.email, signature]]);
```

Sessions with a valid signature show as **Verified** in the inbox; unsigned or invalid ones
show as **Unverified**.

**Be precise about what this buys.** It is a *label on the session*, not an access control:
Crisp does not reject unsigned identifications, and the profile still exists and is still
matchable by email. What it delivers is that an agent can tell, at a glance, whether the
person in front of them proved ownership of the address — which is exactly the judgement the
enrichment would otherwise quietly erode. Pairing it with a written support rule ("do not act
on account requests from an Unverified session") is what closes the loop, and that rule is a
people process, not something this spec can enforce.

Required pieces:

| Piece | Purpose |
|---|---|
| `CRISP_IDENTITY_SECRET` | The Crisp-issued signing key. Server-side only, never in `VITE_*`. |
| A signing endpoint | Returns the HMAC for the **authenticated caller's own** email, taken from the verified JWT — never from a request parameter, or it becomes an oracle that signs any address on demand. |
| `AuthContext.tsx:271` | Fetch the signature and pass it as the second element of the `user:email` push. |

The rest of the original reasoning stands: pushing `session:data` from the client would put two
writers on the same fields, with the client winning by recency and carrying strictly less
information (the comment at `AuthContext.tsx:257` records that client count is not available
from any existing hook, which is why enrichment moved server-side).

### Secrets

| Variable | Notes |
|---|---|
| `CRISP_WEBSITE_ID` | `bc54b5a7-dc07-46a9-8b6a-1c3ba9923314`, already public in `index.html`. Still an env var, not a literal — staging must be able to point at a different Crisp website. |
| `CRISP_IDENTIFIER` | Plugin token identifier. |
| `CRISP_KEY` | Plugin token key. |
| `CRISP_IDENTITY_SECRET` | Identity-Verification signing key. Used by the signing endpoint, not by the cron. |

The first three are **validated at module load in `index.ts` and throw if missing**, following
the `LOOPS_API_KEY` precedent and for a weaker version of the same reason: failing the whole
invocation before any ledger row is written keeps every candidate retryable once the secret is
actually set, instead of burning a sweep that records syncs which never reached the vendor.

Auth is `Authorization: Basic base64(identifier:key)` plus `X-Crisp-Tier: plugin`.

**Scopes — these names are exact and the first draft had them wrong.** The plugin needs:

| Scope | Covers |
|---|---|
| `website:people:profiles` | "List and create CRM profiles" — the `GET`/`POST`/`PUT`/`DELETE` profile routes. |
| `website:people:data` | "List and push data in CRM profiles" — the `/people/data/{id}` routes. |

`website:people:manage` and `website:people:read`, named in the first draft, **do not exist**.
A production token requested with them would be rejected. Development tokens are not subject to
scopes at all, which is precisely how a wrong scope list survives staging and fails in prod.

**Prerequisite, and the one thing that can block deployment:** a plugin token with those two
scopes must be created in the Crisp Marketplace for the Mesaas website.

### Profile and custom data are two different APIs

Stated explicitly because the first draft's single payload table implied otherwise:

- `email`, `person.*` and `segments` live on the **profile** and are written by
  `POST /people/profile` or `PUT /people/profile/{id}`.
- Everything under `data.*` is a **separate People Data API**,
  `PATCH /people/data/{id}`, and cannot ride along on a profile write.

So each changed person costs a `GET` profile, a profile write, and a data `PATCH`.

The data call is `PATCH` (merge), not `PUT` (replace), on purpose: our key set is fixed and
always sent in full, so a merge can never leave one of our keys stale, while a replace would
erase any key an operator or another integration added.

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
`pg_advisory_xact_lock` in its own lock namespace and refuses (returns `false`) in two cases:

1. A row exists for this user with `deleted_at is null` and a `synced_email` different from
   the one being written — a deletion is owed for the old address.
2. **The candidate's email no longer matches `auth.users.email`, or the account is no longer
   confirmed.** This is a send-time re-check against the live row, and it closes a resurrection
   race the review found: the advisory lock is transaction-scoped, so it releases when this
   function commits — *before* the vendor call. Between the candidate `SELECT` and the vendor
   write, the user can change their email and the deletion sweep (in this run or an overlapping
   one) can delete the old profile. Without the re-check, the upsert then recreates the very
   profile that was just erased, and the ledger no longer points at it, so nothing can ever
   erase it again.

In both cases the caller skips that person entirely this sweep.

**A full lease across the external call is deliberately not taken.** With the re-check in
place, the only remaining consequence of two overlapping runs picking the same candidate is a
duplicated idempotent `PUT` — the same bytes written twice. Holding a lock, or an advisory
lease, across a 10-second vendor round trip to prevent a harmless duplicate would trade a real
availability risk for a cosmetic one.

**But the re-check alone does not close the window, and step 3 has to finish the job.** A
second review round found the residual race, which the re-check cannot reach because the
advisory lock is released the moment step 1 commits:

1. `record_crisp_contact` validates and commits.
2. The vendor write goes out and is in flight for up to 10 seconds.
3. The user changes their email. An overlapping run's deletion sweep sees `synced_email` no
   longer matching, deletes the profile at Crisp, and stamps `deleted_at`.
4. Our in-flight write lands and **recreates** the profile at the old address.
5. `confirm_crisp_sync` matches zero rows — its `where` carries `and deleted_at is null`.

Counting step 5 as success would leave a name, an email and a phone at a foreign vendor that
`get_crisp_contact_deletions` can never select, because it filters on the same `deleted_at`.
Unerasable: the single outcome this ledger exists to prevent.

So **`confirm_crisp_sync` returns a boolean**, and `false` means "the ledger moved under you".
The handler's obligation on `false` is to **delete the profile it just wrote** and surface the
failure. Widening the `where` to make the update match anyway is the wrong repair in the
obvious direction: it would resurrect a swept row and re-strand the address.

This is why `deleted_at`, `synced_people_id` **and `synced_fingerprint`** are all cleared in
the *same* statement at sweep time, and why `record_crisp_contact`'s reactivation branch also
clears a cached `synced_people_id`: a reactivated row must never hand the handler an id
addressing a profile that was already erased.

### Every ledger write asserts the state it observed

Three review rounds found three separate races in this ledger, all with one root cause: **a
write identified its target row by identity alone and did not assert what it believed that
row contained.** One `crisp_contacts` row per user is mutable and long-lived, and between any
read and its matching write the row can be swept, reactivated for a different address, and
re-synced by an overlapping invocation.

The rule is now uniform: *every* write names the state it expects, and a zero-row result is a
signal, not a no-op.

| Write | Asserts | On zero rows |
|---|---|---|
| `record_crisp_contact` | live `auth.users` email still matches, and no deletion is owed | returns false; skip this person this sweep |
| `confirm_crisp_sync` | `deleted_at is null` **and `synced_email = p_email`** | returns false; handler deletes the profile it just orphaned |
| `markContactDeleted` | `deleted_at is null` **and `synced_email` = the value the sweep read** | returns false; stale deletion, another run handled it, do not re-stamp |

The two email-scoped predicates were added last and close these:

- **Stale confirm attaches to a reactivated row.** Run A records `OLD` and its write goes in
  flight. Run B deletes profile `OLD`, stamps `deleted_at`, reactivates the row for `NEW`,
  creates profile `NEW`, confirms it. Run A's write lands, recreating `OLD`, and confirms
  against a row whose `synced_email` is now `NEW` — overwriting the pointer to `NEW` with
  `OLD`'s id and fingerprint. `OLD` becomes unreferenced and unerasable.
- **Delayed deletion stamp buries a fresh sync.** Run A deletes profile `OLD` and stalls
  before its ledger update. Run B sweeps the same row, stamps it, reactivates for `NEW`,
  creates and confirms profile `NEW`. Run A's delayed update matches by `id` alone, stamps the
  reactivated row deleted and clears its pointers — leaving `NEW` at the vendor where the
  deletion query, which filters `deleted_at is null`, can never reach it.

**Overlap is not hypothetical.** The cron fires every 15 minutes, and a worst-case sweep is
200 candidates at up to four vendor round trips each with a 10s timeout — comfortably longer.
Making the writes assert their observed state is the correctness fix; bounding the run so
overlap stops happening at all is a separate, still-open question (see "Known gaps").

### A swept row is unsynced, whatever its fingerprint says

`synced_fingerprint` means "the payload of what currently exists at the vendor". Once the
profile is deleted, nothing exists, so the fingerprint describes nothing — and must never
suppress a re-sync. A third review round found the case where forgetting this bites:

1. Ledger holds `{synced_email: A, synced_fingerprint: FP_A}` and profile A exists.
2. The user changes their email to B. The deletion sweep erases profile A and stamps
   `deleted_at`.
3. **Before B ever syncs**, the user changes back to A.
4. The candidate query recomputes their fingerprint as `FP_A` — the payload is byte-identical
   to step 1 — matches the stale stored hash, and excludes them.

They now have no profile at Crisp and the query will never re-offer them until some unrelated
payload field happens to change. Silent, indefinite absence from support tooling.

The A → B → A sequence where B *does* sync in between was already safe: the ledger then holds
`FP_B`, which differs. The bug needs the revert to land before the new address syncs.

Closed on both sides: the deletion sweep nulls `synced_fingerprint`, and the candidate
predicate is `(cc.deleted_at is not null or cc.synced_fingerprint is distinct from
f.fingerprint)` so a swept row is offered regardless. The second is redundant on the happy
path and deliberately kept as the backstop for a partial failure of the first.

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
| `person.nickname` | `coalesce(nullif(btrim(profiles.nome),''), split_part(email,'@',1))` | **`profiles.nome` is nullable** (`20260301_baseline_schema.sql:27`) and Crisp requires a nickname on profile create and replace, so a confirmed user with no name would 4xx forever. The fallback is the same one `handle_new_user_workspace()` already uses at signup, so the two agree. |
| `person.phone` | `coalesce(nullif(btrim(profiles.whatsapp),''), nullif(btrim(profiles.telefone),''))` | WhatsApp number preferred; `profiles.whatsapp` is a distinct column from `telefone` (`20260301_baseline_schema.sql:31`). `btrim`/`nullif` are required, not cosmetic: `PerfilTab.tsx` writes the raw input straight to both columns, so a cleared field persists as `''` and would otherwise be sent as an empty phone and hashed as a change. Omitted entirely when both are blank. **See the caveat below — do not assume this delivers WhatsApp matching.** |
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

### The WhatsApp claim is unproven, and is not counted as delivered

The first draft asserted that writing `person.phone` "is what actually delivers *regardless of
channel*". The review was right to challenge that: **a phone field being accepted is not the
same as a documented cross-channel identity-merge contract.** Crisp accepting the value proves
storage, not that an inbound WhatsApp message from that number resolves to the person profile
rather than opening an unlinked conversation.

So the honest statement of what this spec delivers is: **email and widget identification, plus
a phone number populated in anticipation of WhatsApp matching.** WhatsApp coverage is claimed
only after it is observed end to end — send a real WhatsApp message from a number belonging to
a synced person and confirm in the inbox that it attaches to their profile. That check is a
rollout step, not an assumption. If it fails, the phone field is still worth having (an agent
can eyeball it) but the channel gap stays open and closing it becomes separate work.

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
4. **Echo back every field the `GET` returned.** `PUT` replaces the whole profile, so the
   write body is the response object spread wholesale, with only `email`, `person.nickname`,
   `person.phone` and `segments` overridden. Naming `notepad` and `company` specifically, as
   the first draft did, silently erases everything it failed to enumerate — avatar, address,
   description, website, employment, geolocation, and any field Crisp adds later. An
   allowlist of fields to preserve is unmaintainable against a vendor schema we do not
   control; preserving by default and overriding by exception is the only version that stays
   correct.
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
12. A profile `PUT` **preserves every field the `GET` returned** — asserted with a stub
    profile carrying `avatar`, `address` and `description`, none of which the sync knows
    about, all of which must survive.
13. `person.nickname` falls back to the email local-part when `nome` is null or blank.
14. The signing endpoint signs the **JWT's** email and ignores any email in the request body
    — the oracle test. Plus: a valid signature verifies against a known-answer HMAC vector.

`npm run test:functions` dirties the root `deno.lock`; revert it with
`git checkout -- deno.lock` before committing.

## Rollout

1. Create the plugin token in the Crisp Marketplace; set `CRISP_WEBSITE_ID`,
   `CRISP_IDENTIFIER`, `CRISP_KEY` via `supabase secrets`. Confirm `APP_BASE_URL` is set.
2. Apply `…000010` and `…000011`.
3. Deploy: `npx supabase functions deploy crisp-sync-cron --use-api --no-verify-jwt` (the local
   Docker bundler is broken in this repo; the function handles its own auth).
4. Invoke once by hand with the cron secret and read the response counts. Then **invoke a
   second time and assert the upsert count is zero** — that is the fingerprint working, and it
   is the check the whole quota argument rests on. If the second run re-pushes the same users,
   stop and fix the hash before scheduling.
5. Apply `…000012` — **the schedule fires immediately**.

Backfill cost is roughly `2 × user_count` vendor calls (the read-modify-write pair), spread
over `ceil(user_count / 200)` sweeps, i.e. one hour per 800 users. After that, near zero.

Staging first, then prod. Verify the linked project with
`cat supabase/.temp/project-ref` before every push; the link state flips.

**Rollback is the reverse**: `SELECT cron.unschedule('crisp-sync-cron')` first, then undeploy.
**Keep the `crisp_contacts` rows.** They are the record of what was pushed to a foreign
vendor; deleting them destroys the only handle for erasing those profiles later.

## Open vendor questions

**Resolved and removed: "does `{people_id}` accept an email?"** The review established that the
REST reference states plainly that it does, for the `GET`/`PUT`/`DELETE` profile routes. The
first draft called the docs silent on the strength of a truncated page fetch, which was a weak
negative treated as a fact. Email addressing is therefore the expected path, and it is covered
by a test rather than a probe. The create-conflict-re-read branch in "Identity resolution"
stays regardless — it exists for the widget-created-profile case, not for this question.

Two open items remain:

1. **What is the plugin daily quota?** Not published. The fingerprint design makes steady
   state cheap regardless, but the *initial backfill* pushes every existing user within the
   first few sweeps, and that burst is the one moment the quota could bind. If the number
   turns out to be tight, throttle by lowering the candidate limit for the first day rather
   than by widening the cron interval — the limit shapes the burst, the interval only delays
   it.
2. **Does an inbound WhatsApp resolve to a profile by `person.phone`?** See "The WhatsApp
   claim is unproven". Verified in rollout, not assumed.

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

## Known gaps

Carried openly rather than closed, because each is a judgement call rather than a defect:

1. **Nothing prevents two invocations from overlapping.** The correctness fixes above make
   overlap *safe* — every write asserts its observed state, and the losing writer compensates.
   They do not make it *rare*. A bounded run would: either a deadline in the handler that
   stops taking new candidates after N seconds, or a lease row claimed atomically at the top
   of the invocation. A session-level `pg_try_advisory_lock` is **not** an option here, because
   Supabase's PostgREST pools transactionally and the lock would not survive between calls.
2. **A truncated run reports nothing at all.** `deps.report` fires once, at the end. If the
   edge runtime kills the isolate mid-sweep, the failures accumulated so far are lost along
   with it, so a chronically slow sweep is invisible in `cron_failures`. A deadline would fix
   this too, by making the terminal report reachable.
3. **`clientes` counts terminated clients.** `count(clientes)` has no status filter, so a
   support agent reading "clientes: 12" is seeing `encerrado` rows included. Consistent with
   the Loops precedent, and nothing in the payload says so.

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

## Review resolutions, round 2

External review (gpt-5.6-terra), 2026-08-03, on the revised spec. All seven points accepted;
two were confirmed against the vendor docs and the schema before folding in.

| # | Point | Resolution |
|---|---|---|
| P0 | Scopes are wrong and `data.*` is a separate API | **Accepted; confirmed against the Crisp token-scopes page.** `website:people:manage` / `website:people:read` do not exist. Corrected to `website:people:profiles` + `website:people:data`, with a new section stating that profile and custom data are two different APIs and three calls per changed person. Development tokens ignore scopes, which is how this would have passed staging and failed in prod. |
| P0 | Unsigned `user:email` lets any visitor claim a customer's identity, and the enrichment makes that dangerous | **Accepted; the strongest finding in the review.** "The frontend does not change" is reversed: Crisp Identity Verification (HMAC-SHA256, server-signed) ships with this. The section is explicit that it labels the session rather than blocking it, and that the paired support rule is a people process. |
| P1 | `profiles.nome` is nullable but Crisp requires a nickname | **Accepted; confirmed nullable** at `20260301_baseline_schema.sql:27`. Falls back to the email local-part, matching what `handle_new_user_workspace()` already does at signup. |
| P1 | Preserving only `notepad` and `company` still erases avatar, address, description, etc. | **Accepted.** Inverted to preserve-by-default: spread the entire `GET` response and override only the four owned fields. An allowlist against a vendor schema we do not control is unmaintainable. |
| P1 | The advisory lock ends before the vendor call; a stale candidate can resurrect a deleted profile | **Accepted for the resurrection race**, which is the real defect: `record_crisp_contact` now re-checks the live `auth.users` email and confirmation. **Rejected for the full lease** — with the re-check, overlapping runs at worst write the same bytes twice, and holding a lock across a 10s vendor round trip trades a real availability risk for a cosmetic one. |
| P1 | WhatsApp matching is assumed, not vendor-verified | **Accepted.** The claim is withdrawn: the spec now delivers "email and widget identification, plus a phone populated in anticipation", and WhatsApp coverage is claimed only after an observed end-to-end test in rollout. |
| P2 | The docs are not silent on email as `{people_id}` | **Accepted.** The first draft turned a truncated page fetch into a stated fact. The blocking probe is removed; the behaviour is covered by a test. |
