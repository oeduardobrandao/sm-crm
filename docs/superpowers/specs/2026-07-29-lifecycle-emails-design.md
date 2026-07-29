# Lifecycle emails: welcome + subscription thank-you — Design

**Date:** 2026-07-29
**Status:** Approved (brainstorm 2026-07-29)

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
| Welcome audience | Workspace **owners** only — invited members already get the invite email and must not get "import your agency's data" |

## Architecture

Three pieces, all following existing repo patterns:

```
_shared/lifecycle-emails.ts     (template builders + send helpers)
        ▲                ▲
        │                │
welcome-email-cron    stripe-webhook (post-syncSubscription hook)
        │                │
        └── lifecycle_emails ledger (send-once guarantee) ──┘
```

### 1. Shared module: `supabase/functions/_shared/lifecycle-emails.ts`

Follows `invite-email.ts` / `dunning-email.ts`: exported pure `build*Email()` HTML builders
(unit-testable) plus `send*Email()` helpers that call the Resend REST API. All dynamic values
pass through `escapeHtml` from `_shared/report-template/escape.ts`. Palette matches the
existing emails: green `#1a3d2b` on cream `#f5f3ee`, white 16px-radius card, Arial stack.
A shared internal layout function provides header/footer so both emails render as one family.

**`buildWelcomeEmail({ firstName, appBaseUrl })`**
Subject: `Bem-vindo ao Mesaas 👋`. Sections, top to bottom:

1. Branded header — "Mesaas" text wordmark on green.
2. Personal opening from Eduardo (2–3 sentences, first person, uses the user's first name).
3. One-line positioning: CRM para agências de social media — clientes, entregas, aprovações
   e analytics em um lugar só.
4. Four feature cards (2×2 on desktop clients, stacked on mobile — table-based), emoji icons:
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

**Send helpers** — `sendWelcomeEmail` / `sendThankYouEmail`: POST to
`https://api.resend.com/emails`, from `Eduardo do Mesaas <eduardo@mesaas.com.br>`.
Best-effort semantics differ by caller (see below): the helpers **throw** on failure like
`sendInviteEmail`; each caller decides whether to swallow.

### 2. Send-once ledger: `lifecycle_emails` table

Migration (unique timestamp prefix per repo rule):

```sql
create table lifecycle_emails (
  id          uuid primary key default gen_random_uuid(),
  email_type  text not null,
  user_id     uuid null references auth.users(id) on delete cascade,
  workspace_id uuid null references workspaces(id) on delete cascade,
  sent_at     timestamptz not null default now()
);
create unique index lifecycle_emails_user_type
  on lifecycle_emails (email_type, user_id) where user_id is not null;
create unique index lifecycle_emails_workspace_type
  on lifecycle_emails (email_type, workspace_id) where workspace_id is not null;
alter table lifecycle_emails enable row level security;
-- no policies: service-role only
```

Claim protocol (both senders): `insert … on conflict do nothing` (claim) → if a row was
inserted, send → on send failure, delete the claim so a later run retries. Duplicates are
structurally impossible; a crash between claim and send loses at most one email (acceptable
for a courtesy email; the delete-on-failure covers the common failure mode).

Email types: `welcome` (keyed by `user_id`), `subscription_thanks` (keyed by
`workspace_id`).

### 3. Welcome trigger: `welcome-email-cron` edge function

- Auth: `x-cron-secret` header (existing cron convention); deployed `--no-verify-jwt`.
- Schedule: every 15 minutes via pg_cron migration using the vault-secret pattern
  (`vault.decrypted_secrets` view, Authorization header from vault — copy an existing
  cron-schedule migration such as `20260702000005`).
- Logic per run:
  1. List recently confirmed users: `auth.admin.listUsers` filtered to
     `email_confirmed_at` within the last **48 hours** (window = no historic backfill on
     first deploy; 48h >> 15min cadence so nothing slips through).
  2. Filter to workspace owners: user has a `workspace_members` row with `role = 'owner'`.
  3. Skip users already in the ledger; claim → send → delete claim on failure.
  4. Batch cap 50/run.
- Failure alerting: internal `console.error` + the existing Resend cron-alert helper
  (`_shared/notify.ts`) on unexpected errors, consistent with other crons (pg_cron-layer
  failures are silent, so alerting lives inside the function).

### 4. Thank-you trigger: `stripe-webhook` hook

At the end of `syncSubscription`, when `sub.status` is `trialing` or `active`:

1. Claim `(subscription_thanks, workspace_id)` in the ledger; bail if already claimed.
2. Resolve recipient exactly like `notifyOwnerOfFailure` does: `workspace_members`
   role=owner → `auth.admin.getUserById` → email. Reuse/extract that resolution into a
   small helper if convenient.
3. Send; **swallow all errors** (try/catch, internal log only) — a throw would 500 the
   webhook and Stripe would redeliver, re-firing the handler. The ledger claim additionally
   makes redelivery idempotent. Delete claim on send failure so a later subscription event
   retries.

`checkout.session.completed` and every subsequent `customer.subscription.updated` funnel
through `syncSubscription`, so the ledger — not the event type — is the once-only guard.

## Error handling summary

| Path | On failure |
|---|---|
| Welcome cron send | Delete claim, log, next run retries |
| Thank-you send | Delete claim, swallow (no 500), next subscription event retries |
| Resend key missing | Welcome cron: log + alert. Webhook: silent return (dunning precedent) |
| Cron function down | pg_cron keeps firing; alert-inside-function on errors |

## Testing

Deno tests alongside the existing edge suites (`supabase/functions/__tests__/`):

- **Template builders:** subjects/copy present, `firstName`/`workspaceName` escaping (XSS
  strings), all four links built from `appBaseUrl`, no unescaped interpolation.
- **Cron logic:** mocked Supabase — confirmed-owner is selected, non-owner skipped,
  already-claimed skipped, claim deleted on send failure, batch cap respected.
- **Webhook hook:** trialing and active both send; second event no-ops (ledger); send
  failure does not throw out of the handler.
- Check existing `stripe-webhook` tests for contract breakage (repo rule: grep both suites).

## Rollout

1. Verify `eduardo@mesaas.com.br` is usable as a Resend sender (domain already verified;
   this is address choice only).
2. `npx supabase db push --linked` (staging first — check link state per repo rule), then prod.
3. Deploy `welcome-email-cron` (`--no-verify-jwt`, `--use-api`) and redeploy
   `stripe-webhook`.
4. pg_cron schedule migration (staging + prod).
5. Verify: confirm a fresh signup on staging receives the welcome email. For the thank-you
   path, note that staging shares the prod Stripe key and the webhook secret rejects
   test-mode events, so it is verified by unit tests plus the next real subscription
   (or a manual staging invocation with a crafted event).

## Out of scope (YAGNI)

- Email sequences / drip campaigns, open-tracking, unsubscribe management (transactional
  one-shots), admin UI for lifecycle emails, i18n beyond PT-BR, hosted screenshot assets.
