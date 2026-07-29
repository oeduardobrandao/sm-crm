# Lifecycle emails: welcome + subscription thank-you — Design

**Date:** 2026-07-29
**Status:** Approved (brainstorm 2026-07-29; revised after external spec review — all 8 points
folded in, none rejected)

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
   lifecycle-email-cron  ──►  get_welcome_email_candidates() RPC   (welcome sweep)
              │          ──►  workspace_subscriptions sweep        (thank-you sweep)
              │
   lifecycle_emails ledger (send-once guarantee, seeded at migration time)
```

Putting the thank-you in the cron rather than a webhook hook gives a guaranteed retry
(every run re-attempts unsent emails), makes "subscription start" well-defined (ledger
seed = anything pre-existing never gets mailed), and leaves the webhook — which has no
test harness today — untouched. Latency is ≤15 min, fine for a courtesy email.

### 1. Shared module: `supabase/functions/_shared/lifecycle-emails.ts`

Follows `invite-email.ts` / `dunning-email.ts`: exported pure `build*Email()` HTML builders
(unit-testable) plus `send*Email()` helpers that call the Resend REST API and **throw** on
failure (caller handles claim release). All dynamic values pass through `escapeHtml` from
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

### 2. Migration A — ledger, candidates RPC, backfill seed

One migration (unique timestamp prefix per repo rule) containing:

**`lifecycle_emails` table**

```sql
create table lifecycle_emails (
  id           uuid primary key default gen_random_uuid(),
  email_type   text not null,
  user_id      uuid null references auth.users(id) on delete cascade,
  workspace_id uuid null references workspaces(id) on delete cascade,
  sent_at      timestamptz not null default now()
);
create unique index lifecycle_emails_user_type
  on lifecycle_emails (email_type, user_id) where user_id is not null;
create unique index lifecycle_emails_workspace_type
  on lifecycle_emails (email_type, workspace_id) where workspace_id is not null;
alter table lifecycle_emails enable row level security;
-- no policies: service-role only
```

Claim protocol (both sweeps): `insert … on conflict do nothing` (claim) → if a row was
inserted, send → on send failure, delete the claim so the next run retries. Duplicates are
structurally impossible; a crash between claim and send loses at most one email
(acceptable; delete-on-failure covers the common failure mode).

Email types: `welcome` (keyed by `user_id`), `subscription_thanks` (keyed by
`workspace_id`).

**`get_welcome_email_candidates(p_since timestamptz)` RPC** — `auth.admin.listUsers`
cannot filter by `email_confirmed_at` (the existing helpers paginate the whole user set),
so candidates come from a `SECURITY DEFINER` SQL function reading `auth.users` directly:

- Joins `auth.users` (where `email_confirmed_at >= p_since`) to `workspace_members`
  (role `owner`) to `workspaces` on **`workspaces.created_by = auth.users.id`** — the
  self-serve discriminator. `handle_new_user_workspace` only sets `created_by` to the new
  user on the no-`conta_id`-metadata path; invited users (any role, including invited
  owners) join a workspace created by someone else and never match.
- Anti-joins `lifecycle_emails` on `(email_type = 'welcome', user_id)`.
- Returns `user_id, email, nome` (nome from `profiles`), ordered by `email_confirmed_at`,
  capped at 50.
- Grants: `revoke all … from public, anon, authenticated; grant execute … to
  service_role;` — grant explicitly, because REVOKE FROM PUBLIC alone also strips
  service_role (this bit the repo before).

**Backfill seed** — insert `('subscription_thanks', workspace_id)` claims for **every
existing `workspace_subscriptions` row regardless of status**. This defines "subscription
start" as a transition: nothing that exists at deploy time is mailed; only rows created
afterwards (first checkout for a workspace) are. A canceled workspace that later
re-subscribes keeps the same upserted row and stays claimed — one thank-you per workspace,
ever, by design.

### 3. `lifecycle-email-cron` edge function

- Auth: `x-cron-secret` header (existing cron convention); deployed `--no-verify-jwt`
  (plus the `supabase/config.toml` `[functions.lifecycle-email-cron]` entry).
- Schedule: every 15 minutes via pg_cron (Migration B).
- **Welcome sweep:** call `get_welcome_email_candidates(now() - interval '48 hours')`
  (window = no historic backfill on first deploy; 48h ≫ 15-min cadence so nothing slips
  through) → for each: claim → build with first name → send → delete claim on failure.
- **Thank-you sweep:** select `workspace_subscriptions` rows with
  `status in ('trialing','active')` that have no `subscription_thanks` ledger row
  (anti-join), capped at 50/run → for each: resolve recipient (below) → claim → send →
  delete claim on failure.
- **Thank-you recipient (deterministic primary owner):** the `workspaces.created_by` user
  if they still hold an `owner` row in `workspace_members`; otherwise the oldest owner by
  `joined_at asc, user_id asc`. Exactly one recipient. Email via
  `auth.admin.getUserById(user_id)`; skip (leave unclaimed, log) when no owner or no email
  resolves.
- Failure alerting: internal `console.error` + the existing Resend cron-alert helper
  (`_shared/notify.ts`) on unexpected errors, consistent with other crons (pg_cron-layer
  failures are silent, so alerting lives inside the function).
- `RESEND_API_KEY` missing: log + alert, no throw.

### 4. Migration B — pg_cron schedule

Separate, **later-timestamped** migration scheduling `lifecycle-email-cron` every 15 min,
using the `vault.decrypted_secrets` subselect form (not the nonexistent
`vault.decrypted_secret()` function), copied from `20260702000005`. Header comment states
it must be applied only **after** the function is deployed — the schedule fires
immediately (same ordering rule as the design-render sweep cron). Idempotent
(unschedule-if-exists first).

## Error handling summary

| Path | On failure |
|---|---|
| Welcome send | Delete claim, log, next run retries |
| Thank-you send | Delete claim, log, next run retries |
| No resolvable owner/email | Skip without claiming, log |
| Resend key missing | Log + cron alert, run continues |
| Cron function down | pg_cron keeps firing; alert-inside-function on errors |

## Testing

Deno tests alongside the existing edge suites (`supabase/functions/__tests__/`):

- **Template builders:** subjects/copy present, `firstName`/`workspaceName` escaping (XSS
  strings), all links built from `appBaseUrl`, nameless-greeting fallback, no unescaped
  interpolation.
- **Cron logic (mocked Supabase):** welcome — candidate sent, already-claimed skipped,
  claim deleted on send failure, batch cap respected; thank-you — trialing and active both
  send, seeded/claimed rows skipped, primary-owner rule (created_by preferred, oldest-owner
  fallback), no-owner rows skipped without claiming, claim deleted on send failure.
- No `stripe-webhook` changes, so no webhook-suite work. Grep both suites
  (`apps/**/__tests__`, `supabase/functions/__tests__`) for anything referencing the
  touched tables before merging (repo rule).

## Rollout

Order matters (the schedule migration fires the function immediately):

1. Verify `eduardo@mesaas.com.br` is usable as a Resend sender (domain already verified;
   this is address choice only).
2. Push **Migration A** (ledger + RPC + seed) — staging first (check link state per repo
   rule: `cat supabase/.temp/project-ref`), then prod.
3. Deploy `lifecycle-email-cron` (`--no-verify-jwt`, `--use-api`) to the same project.
4. Push **Migration B** (pg_cron schedule).
5. Verify on staging: confirm a fresh signup receives the welcome email within ~15 min;
   for the thank-you path, insert a synthetic `workspace_subscriptions` row (status
   `trialing`) for a test workspace and watch the next run send exactly once. (Staging
   shares the prod Stripe key and test-mode events are rejected by the webhook secret, so
   a real checkout is not testable there.)

## Out of scope (YAGNI)

- Email sequences / drip campaigns, open-tracking, unsubscribe management (transactional
  one-shots), admin UI for lifecycle emails, i18n beyond PT-BR, hosted screenshot assets,
  any `stripe-webhook` changes.
