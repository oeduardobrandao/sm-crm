# Lifecycle emails: welcome + subscription thank-you — Design

**Date:** 2026-07-29
**Status:** Approved (brainstorm 2026-07-29; revised after two external review rounds —
see "Review resolutions" at the end)

## Goal

Two one-shot transactional emails, both PT-BR, both visually rich (CSS-only), both sent via
Resend from the founder's address:

1. **Welcome email** — sent to new self-serve users after they confirm their email. Welcomes
   them, explains what Mesaas is, points to resources, and pushes the `/importar` wizard
   (Notion, Trello, ClickUp, CSV).
2. **Thank-you email** — sent once per workspace when a subscription starts (trial or paid,
   same copy). Thanks the owner for their trust.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Sender (both emails) | `Eduardo do Mesaas <eduardo@mesaas.com.br>` |
| Welcome trigger | Cron sweep after email confirmation |
| Trial vs paid thank-you | Identical copy for both |
| Visual approach | Rich CSS-only (inline-styled tables, zero external images) |
| Welcome audience | **Self-serve signups only** (see discriminator below) — invited members, including invited owners, already get the invite email and must not get "import your agency's data" |

## Architecture

A single cron function sends both email types; `stripe-webhook` is **not modified**.

```
_shared/lifecycle-emails.ts        (template builders + send helpers)
              ▲
              │
   lifecycle-email-cron  ──►  get_welcome_email_candidates() RPC    (welcome sweep)
              │          ──►  get_thankyou_email_candidates() RPC   (thank-you sweep)
              │
   lifecycle_emails ledger (at-most-once-ish via Resend Idempotency-Key,
                            seeded at migration time for both email types)
```

Putting the thank-you in the cron rather than a webhook hook gives a guaranteed retry
(every run re-attempts unsent emails), makes "subscription start" well-defined (ledger
seed = anything pre-existing never gets mailed), and leaves the webhook — which has no
test harness today — untouched. Latency is ≤15 min, fine for a courtesy email.

### 1. Shared module: `supabase/functions/_shared/lifecycle-emails.ts`

Follows `invite-email.ts` / `dunning-email.ts`: exported pure `build*Email()` HTML builders
(unit-testable) plus `send*Email()` helpers that call the Resend REST API and **throw** on
failure. Each send carries a deterministic **`Idempotency-Key` header**
(`welcome/<user_id>` or `subscription_thanks/<workspace_id>`) so a retry after an
ambiguous failure (response lost, function crash after Resend accepted) is deduped by
Resend rather than delivered twice. The fetch is bounded by
`AbortSignal.timeout(10_000)` — the edge runtime kills isolates on unbounded I/O in ways
that bypass `catch` (documented repo failure mode), and a timeout must surface as a
retryable throw instead. A Resend **409 `invalid_idempotent_request`** (same key, drifted
payload — e.g. `profiles.nome` changed between attempts) means the key was already
accepted, i.e. the original send happened: it is treated as **success**, not an error. All dynamic values pass through `escapeHtml` from
`_shared/report-template/escape.ts`. Palette matches the existing emails: green `#1a3d2b`
on cream `#f5f3ee`, white 16px-radius card, Arial stack. A shared internal layout function
provides header/footer so both emails render as one family.

**Name handling (both builders):** `firstName` = first whitespace-separated word of
`profiles.nome`, which `handle_new_user_workspace` populates from signup metadata `nome`
or the email local-part. When null/empty after trimming, the greeting renders without a
name ("Olá!" instead of "Olá, {firstName}!"). `profiles.nome` is the single authoritative
source; auth metadata is not read.

**`buildWelcomeEmail({ firstName, appBaseUrl })`**
Subject: `Bem-vindo ao Mesaas 👋`. Sections, top to bottom:

1. Branded header — "Mesaas" text wordmark on green.
2. Personal opening from Eduardo (2–3 sentences, first person, greets by first name).
3. One-line positioning: CRM para agências de social media — clientes, entregas, aprovações
   e analytics em um lugar só.
4. Four feature cards (2×2 table-based, stacking gracefully), emoji icons:
   - 👥 Clientes & CRM
   - 📋 Entregas — kanban + calendário editorial
   - ✅ Aprovações pelo Hub do cliente (portal whitelabel)
   - 📈 Analytics de Instagram + relatórios
5. "Comece em 3 passos" numbered block:
   1. Cadastre seu primeiro cliente
   2. **Importe seus dados** — Notion, Trello, ClickUp ou CSV, com CTA button →
      `{appBaseUrl}/importar`
   3. Convide sua equipe e compartilhe o Hub com o cliente
6. Resources row: Central de Ajuda → `{appBaseUrl}/ajuda`; Novidades →
   `{appBaseUrl}/novidades`.
7. Sign-off from Eduardo explicitly inviting a direct reply ("é só responder este e-mail").
8. Footer (why you received this: você criou uma conta no Mesaas).

**`buildThankYouEmail({ firstName, workspaceName, appBaseUrl })`**
Subject: `Obrigado pela confiança 💚`. Shorter, warmer, personal — no "cobrança"/charge
language so it reads correctly for a trial that has not been billed:

1. Same branded header.
2. Personal thank-you from Eduardo for the trust in Mesaas (2–3 sentences).
3. "Aproveite ao máximo" mini-list: conectar o Instagram, importar seus dados
   (`/importar`), ativar o Hub para os clientes.
4. Where to manage the plan: `{appBaseUrl}/configuracao`.
5. Sign-off asking them to reply with what would make Mesaas better for their agency.
6. Footer.

### 2. Migration A — ledger, candidate RPCs, backfill seeds

One migration (unique timestamp prefix per repo rule) containing:

**`lifecycle_emails` table**

```sql
create table lifecycle_emails (
  id           uuid primary key default gen_random_uuid(),
  email_type   text not null,
  user_id      uuid null references auth.users(id) on delete cascade,
  workspace_id uuid null references workspaces(id) on delete cascade,
  sent_at      timestamptz not null default now(),   -- last claim/attempt time
  delivered_at timestamptz null,                      -- Resend accepted the send
  attempts     int not null default 0                 -- send attempts so far
);
-- Plain UNIQUE constraints, NOT partial unique indexes: PostgREST's on_conflict
-- (used by the claim upsert) cannot target a partial index. NULLs are distinct,
-- so welcome rows dedupe on (type, user_id) and thank-you rows on
-- (type, workspace_id); the cross-type NULL columns never collide.
alter table lifecycle_emails
  add constraint lifecycle_emails_user_type unique (email_type, user_id),
  add constraint lifecycle_emails_workspace_type unique (email_type, workspace_id);
alter table lifecycle_emails enable row level security;
-- no policies: service-role only
```

**Claim / delivery protocol (both sweeps)** — designed so an ambiguous failure can
neither duplicate nor permanently suppress an email:

1. Candidate RPCs exclude subjects whose ledger row is *terminal* (`delivered_at` set
   or `attempts >= 30`) or *fresh* (`sent_at` within the last hour). A row that is
   neither is a **stale claim** — a previous attempt crashed or failed — and its
   subject is a candidate again. The RPCs return the current `attempts` count.
2. The handler upserts the claim (`onConflict` on the matching unique constraint,
   refreshing `sent_at` and writing `attempts + 1`), sends with the deterministic
   `Idempotency-Key`, then sets `delivered_at`. No ownership check and no
   delete-on-failure: overlapping runs or stale retries re-send with the same key and
   Resend dedupes (keys are honored for 24h; a drifted-payload 409 counts as
   delivered, see §1).
3. Failure containment: the 1-hour freshness gate means persistently failing claims
   are excluded from ~3 of every 4 runs (15-min cadence), so they slow but cannot
   starve the batch; the 30-attempt cap (~30 hourly retries, outlasting both the 24h
   idempotency window and a full-day outage) makes a permanently unreachable
   recipient terminal instead of infinitely noisy. Residual risk, explicitly
   accepted: a stale retry more than 24h after a send whose acceptance was lost can
   duplicate one courtesy email; a capped-out recipient never gets it (visible in
   `cron_failures` history).

Email types: `welcome` (keyed by `user_id`), `subscription_thanks` (keyed by
`workspace_id`).

**`get_welcome_email_candidates()` RPC** — `auth.admin.listUsers` cannot filter by
`email_confirmed_at` (the existing helpers paginate the whole user set), so candidates
come from a `SECURITY DEFINER` SQL function (with `SET search_path = public`, per the
repo's security-definer convention) reading `auth.users` directly:

- Joins `auth.users` (where `email_confirmed_at is not null`) to `workspace_members`
  (role `owner`) to `workspaces` on **`workspaces.created_by = auth.users.id`**, AND
  requires **`nullif(u.raw_user_meta_data->>'conta_id','') is null`** — the combined
  self-serve discriminator. The trigger's invite branch is only entered when `conta_id`
  metadata is present (self-serve signup never sets it), and the metadata check covers
  the invite-path fallback where a missing workspace with no prior owner is created with
  `created_by = NEW.id` (see `20260719000002`'s `COALESCE(ws_created_by, NEW.id)`),
  which `created_by` alone would misclassify.
- Excludes terminal/fresh ledger rows per the protocol above. **No time window**: the
  welcome seed (below) is the eligibility boundary, so a >48h cron or Resend outage
  delays emails instead of dropping them.
- Returns `user_id, email, nome` (nome from `profiles`), ordered by
  `email_confirmed_at asc, user_id asc` (deterministic), capped at 50.
- Grants: `revoke all … from public, anon, authenticated; grant execute … to
  service_role;` — grant explicitly, because REVOKE FROM PUBLIC alone also strips
  service_role (this bit the repo before).

**`get_thankyou_email_candidates()` RPC** — same `SECURITY DEFINER` + `search_path` +
grants shape:

- `workspace_subscriptions` rows with `status in ('trialing','active')`, excluding
  terminal/fresh ledger rows, ordered by `created_at asc, workspace_id asc`
  (deterministic), capped at 50.
- **Primary owner resolved in the query**: the `workspaces.created_by` user if they
  still hold an `owner` row in `workspace_members`; otherwise the oldest owner by
  `joined_at asc, user_id asc`. Exactly one recipient; email read from `auth.users`.
  Workspaces with no resolvable owner/email produce no candidate row at all (they
  cannot occupy the batch; they become eligible if an owner appears later).
- Returns `workspace_id, workspace_name, owner_email, owner_nome`.

**Backfill seeds** — both inserted with `delivered_at = now()` (terminal, nothing is
mailed), `on conflict do nothing` (idempotent):

- `subscription_thanks`: every `workspace_subscriptions` row **where
  `stripe_subscription_id is not null`**. Row existence is NOT the boundary —
  `billing-checkout` creates a placeholder row holding only `stripe_customer_id`
  before the user completes Stripe Checkout, and a checkout in flight during deploy
  must still be thanked when it completes. A subscription id means a subscription
  actually started at some point (any status). A canceled workspace that later
  re-subscribes keeps the same upserted row and stays claimed — one thank-you per
  workspace, ever, by design.
- `welcome`: every currently confirmed self-serve owner (same join AND `conta_id`
  metadata check as the candidates RPC). This replaces a time-window: post-migration,
  *any* confirmed self-serve owner without a ledger row gets the email, whenever that
  happens.

### 3. `lifecycle-email-cron` edge function

- Auth: `x-cron-secret` header (existing cron convention); deployed `--no-verify-jwt`
  (plus the `supabase/config.toml` `[functions.lifecycle-email-cron]` entry).
- Schedule: every 15 minutes via pg_cron (Migration B).
- **Welcome sweep:** call `get_welcome_email_candidates()` → for each: claim-upsert →
  send (idempotency key) → set `delivered_at`. Per-candidate errors are collected and
  do not stop the batch.
- **Thank-you sweep:** call `get_thankyou_email_candidates()` → same protocol.
- Failure reporting: `reportCronFailure` from `_shared/triage.ts` (the established cron
  pattern — persists `cron_failures` and can dispatch GitHub triage; it wraps the
  Resend alert internally, and the DB leg still records the failure even when
  `RESEND_API_KEY` is the thing that is missing). Plus detailed `console.error`
  internally; generic responses externally.

### 4. Migration B — pg_cron schedule

Separate, **later-timestamped** migration scheduling `lifecycle-email-cron` every 15 min,
using the `vault.decrypted_secrets` subselect form (not the nonexistent
`vault.decrypted_secret()` function), copied from `20260702000005`. Header comment states
it must be applied only **after** the function is deployed — the schedule fires
immediately (same ordering rule as the design-render sweep cron). Idempotent
(unschedule-if-exists first).

## Error handling summary

| Path | Behavior |
|---|---|
| Send fails, times out (10s `AbortSignal`), or crashes mid-attempt | Ledger row stays with `delivered_at` null → stale after 1h → retried with the same idempotency key (up to 30 attempts) |
| Resend accepted but response lost | Retry re-sends with the same key → deduped (24h key window); a drifted-payload 409 counts as delivered |
| No resolvable owner/email | No candidate row; eligible again if an owner appears |
| Resend key missing | Sends fail + `reportCronFailure` persists to `cron_failures` (DB leg works without Resend) |
| Cron function down / never invoked | **Not self-reported** — `reportCronFailure` only runs inside a running function. This is the platform-wide gap shared by every cron here (pg_cron layer is silent); detection stays with the existing cron-triage tooling and `cron.job_run_details`. No new monitoring in this feature. |

## Testing

Deno tests alongside the existing edge suites (`supabase/functions/__tests__/`):

- **Template builders:** subjects/copy present, `firstName`/`workspaceName` escaping (XSS
  strings), all links built from `appBaseUrl`, nameless-greeting fallback, no unescaped
  interpolation.
- **Senders:** payload shape, founder from-address, `Idempotency-Key` header value,
  bounded fetch (`AbortSignal` present), 409 treated as success, throw on other
  non-2xx / missing key.
- **Cron logic (mocked Supabase):** candidate sent and marked delivered; failed send
  leaves the claim undelivered and a later (stale) pass retries with the same key;
  one candidate's failure doesn't stop the batch; first-name extraction;
  per-sweep counts.
- Grep both suites (`apps/**/__tests__`, `supabase/functions/__tests__`) for anything
  referencing the touched tables before merging (repo rule).

## Rollout

Order matters (the schedule migration fires the function immediately):

1. Verify `eduardo@mesaas.com.br` is usable as a Resend sender (domain already verified;
   this is address choice only), and verify the `APP_BASE_URL` secret is set on **both**
   staging and prod (`npx supabase secrets list`) — the cron has no request Origin to
   fall back on, and `appBaseUrl()` throws without it.
2. Push **Migration A** (ledger + RPCs + seeds) — staging first (check link state per repo
   rule: `cat supabase/.temp/project-ref`), then prod.
3. Deploy `lifecycle-email-cron` (`--no-verify-jwt`, `--use-api`) to the same project.
4. Push **Migration B** (pg_cron schedule).
5. Verify on staging: confirm a fresh signup receives the welcome email within ~15 min;
   for the thank-you path, insert a synthetic `workspace_subscriptions` row (status
   `trialing`, non-null `stripe_subscription_id`) for a test workspace and watch the next
   run send exactly once. (Staging shares the prod Stripe key and test-mode events are
   rejected by the webhook secret, so a real checkout is not testable there.)

**Rollback order (reverse):** unschedule first —
`select cron.unschedule('lifecycle-email-cron')` (or re-apply Migration B's unschedule
block) — then undeploy/ignore the function. The `lifecycle_emails` table and its rows are
**retained** on rollback: they are the record of what was already sent, and deleting them
would re-mail everyone on a future re-rollout.

## Out of scope (YAGNI)

- Email sequences / drip campaigns, open-tracking, unsubscribe management (transactional
  one-shots), admin UI for lifecycle emails, i18n beyond PT-BR, hosted screenshot assets,
  any `stripe-webhook` changes, per-recipient attempt caps.

## Review resolutions

Round 1 (all 8 accepted): RPC instead of `listUsers` pagination; split migrations so the
pg_cron schedule applies only after function deploy; `workspaces.created_by` as the
self-serve discriminator (invited owners exist); thank-you moved from a webhook hook into
the cron (guaranteed retry, well-defined start, no webhook test-harness work);
`profiles.nome` as the single name source with a nameless fallback; deterministic
primary-owner rule; ledger seed defines "subscription start" as a transition; no
stripe-webhook test changes needed.

Round 2: **accepted** — seed boundary is `stripe_subscription_id is not null` (checkout
placeholder rows exist); Resend `Idempotency-Key` + `delivered_at` + stale-claim retry
replaces delete-on-failure ("structurally impossible" was overclaimed); deterministic
ordering on both candidate queries; `reportCronFailure` (triage) instead of raw
`notify.ts`; `SET search_path = public` stated explicitly; welcome seed replaces the 48h
window (outages delay instead of drop); rollback order documented (unschedule first,
ledger retained). **Rejected** — the no-owner-starvation premise: owner resolution lives
inside the candidate RPC's lateral join, so ownerless workspaces produce no candidate row
and cannot occupy the batch (the reviewer read the earlier TS-side-resolution draft).

Round 3: **accepted** — 30-attempt terminal cap (bounds retry noise; the freshness gate
already prevented true starvation, so the "blocks forever" premise was overstated but the
cap is right); `AbortSignal.timeout(10_000)` on the Resend fetch (edge kills bypass
`catch` on unbounded I/O — documented repo failure mode); `conta_id`-metadata check added
to the self-serve discriminator and seed (the invite-path fallback can set
`created_by = NEW.id`); `APP_BASE_URL` verification on both projects added to rollout;
Resend 409 on payload drift treated as delivered (the key's existence proves the original
send was accepted — simpler than persisting payloads); "cron down" reporting claim
corrected to name the platform-wide silent-pg_cron gap. **Rejected** — adding new
external monitoring infrastructure for the pg_cron layer: pre-existing gap shared by all
crons, out of scope here.
