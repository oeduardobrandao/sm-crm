# Trial-first onboarding

Status: draft for approval · 2026-10-27

## Why

New accounts end up on Free without ever being offered the trial, and Free is too
limited for them to see what Mesaas does. Data from the last 60 days (Admin MCP +
PostHog, pulled 2026-10-27):

- 47 workspaces created; 29 are on Free and none of those has more than 2 clients. Paid
  workspaces typically run 4 to 44 clients.
- 40 tracked signups (`signup_completed`). 17 people viewed the trial screen
  (`/comecar`); 13 of them came with no plan chosen on the landing page. **All 13 signups
  who viewed it opened checkout.**
- **20 signups never loaded `/comecar`.** Cause, confirmed in code: email confirmation is
  on, the confirmation link lands on `/login` already signed in, and
  `LoginPage`'s `authRedirected` effect sends anyone without a landing-page plan choice to
  `/dashboard`. `/workspace-setup` (which forwards to `/comecar`) never runs, because the
  signup form already collects the company name.
- About 5 of ~20 who opened Stripe checkout left without entering a card; about 5 started
  a trial and cancelled.
- In-app copy oversells the trial. `TrialNudgeCard` says the trial unlocks "agendamento",
  which Free already has. The landing pricing headline tells visitors to "Comece no plano
  Free".

The competitive benchmark run on 2026-10-27 found:
- card-required trials convert 25-35% vs 4-6% without a card (ChartMogul 2026, 200
  products);
- Brazilian competitors (mLabs, Reportei, Postgrain and others) run short trials, and none
  that states a card policy asks for one;
- Visa and Mastercard rules require a reminder before the first charge of a card trial
  longer than 7 days. Mesaas sends no such reminder today.

## Decisions already made (by the product owner)

- Build **option C**: a post-signup screen that asks two questions and recommends one plan
  to try free for 30 days, with Free as a secondary choice. Mockup: canvas
  "Primeira tela pós-cadastro", artboard C (https://claude.ai/artifact/EEnFF9SE1gvMe4Ndyri3jt).
- **Keep the card requirement** and the 30-day trial length. Prices and plan limits do not
  change.
- Scope is three parts: the screen (and routing to it), the day-23 reminder email, and
  fixing every wrongly advertised plan feature.

## Goals

1. Every new owner sees the screen once, on their first visit to the app after signing up,
   whatever path they arrive by.
2. The screen recommends the plan that fits their answers and makes the 30-day trial the
   primary action.
3. The screen says roughly when the first charge happens and promises a reminder email,
   with the exact amount and date, 7 days before it.
4. Every card trial (Stripe and Pagar.me) gets that reminder email 7 days before the first
   charge, with the amount, the date and how to cancel.
5. Every plan fact the CRM, landing pages and emails advertise matches the `plans` table.

## Non-goals

- No-card trials, reverse trials, Pix at checkout, changes to trial length or prices.
- In-app trial countdown banners (worth doing later; not this round).
- Hub and Admin apps.

## Anti-goals (would be a failure even if it works)

- Free hidden or made hard to reach. It stays one click away on the screen.
- Pressure tactics: fake urgency, countdown timers, pre-checked boxes, guilt copy on the
  Free link.
- Promising a reminder that is not actually sent, or sending two (ours plus Stripe's).
- Plan claims that drift from the `plans` table again after this fix.
- Returning users being bounced to the screen on every login.

## Part 1: routing

The `/login` already-authenticated effect can't tell an email-confirmation visit from any
restored session, so routing keys off a **workspace-scoped "offer seen" marker**, not off
the login path.

- New nullable timestamp on the workspace, e.g. `workspaces.trial_offer_seen_at`. It is set
  the first time `/comecar` renders the screen (not the standby or error states) for an
  eligible owner of the **active** workspace. Once set, it is never cleared.
- `ProtectedRoute` (it already holds the `/workspace-setup` redirect) sends an owner to
  `/comecar` when the active workspace has the marker unset **and** is eligible by the
  same rules `/comecar` uses: Free, never trialed, not a comp/internal plan. Exempt
  `/comecar`, `/workspace-setup` and checkout return paths so it can't loop.
- So every new owner sees the screen once, by whatever path they arrive (confirmation
  link, signup without confirmation, a later login on another device), and never again.
  Skip, checkout start and plain navigation away all count as "seen". After that,
  `TrialNudgeCard` remains the way back.
- **Existing Free workspaces** that never saw the screen (20 of the last 60 days' signups)
  get it once on their next visit. *(Flagged for review: the alternative is to backfill the
  marker for every workspace created before the deploy.)*
- Plan intent from the landing page (`?plan=…&interval=…`) keeps auto-starting checkout,
  unchanged. A page load with intent also sets the marker.
- The marker must be readable and writable by the owner under RLS, and must not trip the
  column-grant allowlists (CLAUDE.md, `membros`/`clientes`). The builder checks how
  `workspaces` is granted.

## Part 2: the screen (`/comecar`)

It replaces the plan grid as the default view of `ComecarPage`. All existing guards,
error/retry states, the intent auto-checkout, the Stripe redirect, the Pagar.me 12x dialog
and the "Preparando seu teste" standby screen stay as they are.

**Layout** (artboard C): left column with the heading, two questions and the Free link;
right column with the recommendation card. Stacks on phone width.

**Questions**, answered by tapping chips (real `<button aria-pressed>`):

| Question | Options |
|---|---|
| Quantos clientes você atende hoje? | 1 a 2 · 3 a 5 · 6 a 15 · Mais de 15 |
| Quantas pessoas trabalham com você, contando você? | Só eu · 2 pessoas · 3 a 5 · 6 ou mais |

**Recommendation rule:**
- Candidates are the plans that pass `isSelectableTrialPlan` **and** have a positive
  monthly `price_brl`, because the primary button starts a monthly checkout. This rules
  out Free, internal plans like `lifetime`, and annual-only or unpriced plans.
- Order the candidates by `price_brl` ascending, ties broken by `sort_order`, then `id`.
- Pick the first plan whose `max_clients` and `max_team_members` both fit the upper end of
  the answers (null = unlimited). "Mais de 15" and "6 ou mais" need an unlimited value or
  a limit above 15 and 5. If nothing fits, pick the last candidate.
- With today's limits: 1–5 clients and ≤2 people → Start; ≤15 clients and ≤5 people → Pro;
  otherwise Max.
- If there are no candidates (catalog misconfigured), fall back to today's plan grid.

**Before any answer** the card shows Pro (the existing `RECOMMENDED_ID`) labelled "O mais
escolhido", and switches to "Recomendado para você" once both questions are answered.
*(Builder's call, flagged for review.)*

**Recommendation card**:
- Plan name and one sentence saying why ("Pensado para quem atende 6 a 15 clientes com uma
  equipe de 3 a 5.").
- Client and user limits as badges, from the plan row.
- What the plan unlocks, in agency terms, derived from the plan's own flags and limits (no
  hard-coded list that can drift):
  - approval portal (`max_hub_tokens > 0`);
  - Instagram reports with AI (`rate_report_generations_per_month > 0`,
    `feature_instagram_ai`);
  - automatic metrics (`feature_auto_sync_cron`);
  - financeiro, contratos and leads;
  - agenda, mensagens and chat da equipe;
  - Pro/Max extras when present: respostas automáticas no Instagram
    (`feature_instagram_automation`), briefing em áudio.

  `BillingPlan` / `listActivePlans` (`apps/crm/src/services/billing.ts`) carry none of
  these fields today. Extend that contract (the query's select list, the type, and its
  callers' tests) with exactly the fields above. The plans table's read policy already
  exposes them through `PublicPricingPlan`, which the builder can reuse.
- When the answers are "1 a 2" and "Só eu", a muted note: "O Free também cobre 2
  clientes, mas sem portal de aprovação, relatórios e métricas automáticas. Teste o Start e
  decida depois."
- Primary button: "Começar 30 dias grátis do {plano}" → monthly checkout for that plan
  (existing `beginCheckout`).
- Under the button: "R$ 0 hoje. Primeira cobrança de {preço mensal} por volta de {data},
  só se você continuar. Avisamos por e-mail 7 dias antes, com o valor e a data exatos."
  - `{data}` = today + 30 days, pt-BR long date ("26 de novembro").
  - `{preço mensal}` = the catalog monthly price.
  - Both are labelled as approximate on purpose. The trial starts when Checkout
    completes, a promotion code can lower the price, and Pagar.me rounds `start_at`. The
    reminder email carries the authoritative values.
- Secondary link "Ver todos os planos" opens the existing plan grid (Mensal/Anual toggle,
  12x Pagar.me path) so annual buyers and people who disagree with the recommendation are
  not stuck.

**Free link** (left column, below the questions): "Continuar no Free", followed by one plain
line of what Free is: "2 clientes, só você, sem portal de aprovação nem relatórios." It
fires `trial_skipped` and goes to the dashboard, as today.

**Footer:** the WhatsApp help link stays. "Pedimos o cartão agora, mas nada é cobrado nos
primeiros 30 dias." stays.

**Analytics** (PostHog via `captureEvent`): keep `trial_step_viewed` (`has_intent`) and
`trial_skipped`. Add `trial_plan_recommended` with `clients_bucket`, `team_bucket`,
`plan_id` (fired once both answers are set, and again if they change), and add
`recommended_plan_id` and `accepted_recommendation` to the onboarding
`checkout_started` capture.

**Copy rules:** pt-BR, sentence case, no em dashes, Mesaas design system tokens and
components (`apps/crm` shadcn primitives + existing `comecar.css`).

## Part 3: the day-23 reminder email

**Who:** every `workspace_subscriptions` row with `status = 'trialing'`, for both
providers. Pagar.me's remote `future` status is stored as `trialing`
(`normalizePagarmeStatus`), so the same filter catches Pagar.me trials. One reminder per
trial, keyed by subscription and first-charge date.

**When:** the first-charge date is the row's `current_period_end`: the trial end for Stripe
trials, and `start_at` for Pagar.me (the builder verifies both writers).
- **Target window:** 7 to 8 days before the charge. The cron runs daily, so the first run
  that sees a trial in this window sends. That is ≥7 days ahead (Visa) and as close to 7
  as a daily cron allows (Mastercard's 3 to 7 days).
- **Catch-up:** if a run was missed, still send while the charge is 3 or more days away.
  A late reminder beats none, and it still meets Mastercard. Log a warning with the
  number of days left.
- **Cutoff:** under 3 days, send nothing. Log it as an error so it surfaces.
- **Monitoring:** register the function with `cron-health-cron`, so a missed or failing run
  alerts like the other crons.
- **Trial end moves** (the trial is extended, or the plan changes): that is a new
  first-charge date, so it is a new reminder identity and the rules above apply to it.

**Mechanism (builder's call, flagged):** our own email, not Stripe's built-in trial
reminder.
- Why: one pt-BR message in the Mesaas voice for both Stripe and Pagar.me. Prod and staging
  share one Stripe account, so a dashboard setting would also hit staging customers.
  Stripe's built-in trial reminder must stay **off**.
- A daily cron edge function (`x-cron-secret`, deployed with `--no-verify-jwt`) that
  follows the **existing lifecycle-email ledger pattern** (migrations `20260730000001` /
  `…0002`):
  - a claim/delivered ledger with attempts and stale-claim recovery;
  - Resend idempotency keys;
  - a deterministic primary owner, resolved the same way the thank-you email resolves it.
- Extend that ledger, or add a sibling table. Its identity is (subscription id,
  first-charge date), and it stores the recipient and the amount and date it announced.
  Never delete ledger rows, so a rollback and redeploy can't re-mail anyone.

**Content:** from `LIFECYCLE_FROM`, to the primary owner. Subject along the lines of "Seu
teste do Mesaas {plano} termina em 7 dias". The body states:
- the plan;
- the amount of the first charge, from the subscription's own mirror
  (`workspace_subscriptions.amount_cents`, net of coupons, written by the webhooks), never
  the current catalog row. If `amount_cents` is null, fetch it live from the provider. If
  that fails, leave the exact figure out ("o valor do seu plano") rather than guess, and
  log it;
- the exact charge date;
- a button to keep the plan (no action needed) and a clearly visible link to cancel or
  change it at `/configuracao/cobranca`, where the Stripe Billing Portal already handles
  cancellation;
- a reminder of what they'd lose on Free.

Reuse the email layout and helpers in `_shared/lifecycle-emails.ts` / `_shared/email`.

**Deploy order:** ledger migration → deploy the function → the migration that schedules
it, so pg_cron never calls a function that doesn't exist (see CLAUDE.md, blog metrics).
The `/comecar` copy promising the reminder must not reach production before the cron is
scheduled. **Rollback:** unschedule the cron first, then undeploy the function. Keep the
ledger.

**Pagar.me amount mirror:** the `amount_cents` comment describes Stripe. The builder checks
whether the Pagar.me webhook writes it (the 12x installment value) and, if not, adds that
write as part of this work.

## Part 4: wrongly advertised plan features

The scope is the **closed list under "Audit findings"** below: each item has a file, the
current copy and the fix. Nothing outside that list is in scope. A wrong claim found
during the build goes back for review before it is added.

Besides the audit list, the landing pricing section gets two messaging changes:
- The headline "Comece no plano Free e suba quando fizer sentido" pushes Free. Lead with the
  30-day trial instead.
- The Free CTA "Começar grátis" and the paid "Começar teste grátis" read as the same offer.
  Relabel Free so the two are clearly different (e.g. "Usar o Free").

**Guard against drift:** plans are edited live in the Admin without a deploy (Start, Pro
and Max were edited on 2026-10-27), so a test pinned to today's values can't keep static
copy honest.
- Any surface that renders at runtime reads the plan row (`listPublicPricingPlans` /
  `listActivePlans`).
- Static surfaces (prerendered pages, `.seo.ts`, help articles, blog posts) do not state
  numbers or features an Admin plan edit can change. Where a static page truly needs a
  figure, it is fetched at build time from the `plans` table, the way `blog:sync` works,
  and a plan edit is followed by a frontend redeploy (document that next to the Admin plan
  editor).

The builder picks per surface, and the audit list says which applies.

## Measuring it

Watch over the first ~60 days of new signups:
- share of email-confirmed owners who load `/comecar`: target close to all of them, up
  from 13 of 40;
- trial starts per signup;
- **Stripe checkout abandonment** (opened checkout, no subscription created). If it stays at
  a quarter or more, revisit the no-card trial, as agreed;
- recommended plan vs plan chosen (`accepted_recommendation`).

## Left to the builder

The exact component structure, how the grid is revealed, the email's HTML, the cron
schedule and send window, the sent-marker storage, and how the drift guard is implemented.
Anything that changes what is listed under Goals, Anti-goals or the copy rules goes back to
the product owner.

## Audit findings

Read-only audit of the repo on 2026-10-27 against the production `plans` rows. This is the
closed list for Part 4. "Free facts" in short: 2 clients, 1 user, 0 portal links,
0 reports/month, no AI, no automatic sync, no contracts/financial/leads/agenda/mensagens/
team chat/brand customization, 100 MB. Scheduling **is** on Free. Paid trials: 30 days,
once per workspace, card required, charged at the end unless cancelled.

**A. Wrong claims (fix)**

| # | Where | Current copy | Fix |
|---|---|---|---|
| A1 | `components/billing/TrialNudgeCard.tsx:73` | "Ative o teste para liberar relatórios, portal do cliente e agendamento." | Drop "agendamento". Name what the trial really unlocks (approval portal, reports, automatic metrics, financeiro/contratos/leads, equipe) |
| A2 | `pages/configuracao/cobranca/CobrancaPage.tsx:100-101` (`planFeatures`), same in `ComecarPage` `planHighlights` | Free card lists "Portal de aprovação do cliente" and "Relatórios de desempenho" | Portal only when `max_hub_tokens` is null or >0; reports only when `rate_report_generations_per_month` is null or >0 |
| A3 | `pages/landing/PlanComparison.tsx:39` | "Relatórios e analytics" ✓ for Free | Drive the row from `rate_report_generations_per_month` ("—" / "5/mês" / …), like the "Portais do cliente" row already does |
| A4 | `pages/landing/LandingPage.tsx:516-517` (final CTA) | "Sem cartão de crédito, sem compromisso." next to "Começar teste grátis" | "30 dias grátis nos planos pagos. Cancele quando quiser." Don't claim no card next to a trial CTA |
| A5 | `content/landing.content.ts:48` (hero note) | "30 dias grátis em qualquer plano." | "30 dias grátis em qualquer plano pago." |
| A6 | `pages/termos-de-uso/TermosPage.tsx:130-133` | "Durante o período beta, todas as funcionalidades estão disponíveis gratuitamente." / "Quando os planos pagos entrarem em vigor:" | Paid plans are in force. Describe the trial: 30 days, once per workspace, card required, automatic charge at the end unless cancelled, reminder 7 days before. **Legal text: the product owner signs off on the final wording** |

**B. Misleading claims (fix)**

| # | Where | Issue | Fix |
|---|---|---|---|
| B1 | `content/precos.content.ts:3`, `content/site-meta.ts:78`, `pages/marketing/MarketingPage.tsx:66` | "Comece grátis, sem cartão de crédito" sits beside trial CTAs | Say it about Free explicitly ("O Free não pede cartão") or lead with the trial. `jsonld.ts:42` and `llms.ts:33` name Free and stay |
| B2 | `pages/landing/PricingSection.tsx` (+ `PlanComparison` CTA row) | Logged-in workspaces that already used their trial still see "Começar teste grátis" / "30 dias grátis", then get charged at once | When logged in, hide the trial wording if `hasUsedTrial`. Use "Assinar {plano}" |
| B3 | `content/paginas/aprovacao-de-post.ts:54`, `content/paginas/portal-do-cliente.ts:55` | "Crie sua conta grátis e envie o primeiro link…" (Free has 0 links); portal page implies brand customization on Free | Point to the trial ("Teste grátis por 30 dias e envie o primeiro link…"). Note brand customization is on paid plans |
| B4 | `content/landing.content.ts:151-167` (how it works) | "Crie sua conta grátis… configure os modelos de contrato"; "Envie o link do portal" | Start the steps from the trial, not the free account |
| B5 | `content/landing.content.ts:93` | metrics "atualizados todo dia" | Add "nos planos pagos" or similar. Free has no automatic sync |
| B6 | `content/precos.content.ts:16-17` | per-client FAQ cites only Instagram limits | Say the tiers are split by number of clients and users, with no per-client fee |
| B7 | `content/precos.content.ts:25` | "Cartão de crédito, processado pela Stripe." | Mention the annual 12x through Pagar.me |
| B8 | `pages/comecar/ComecarPage.tsx:222` | standby says "pagamento seguro do Stripe" on the Pagar.me path too | Name the provider by path, or just "pagamento seguro" |
| B9 | `pages/cliente-detalhe/hub/AcessoPage.tsx:71` (copy at 284-288, 545-549) | Gate reads `feature_hub_portal` (true on Free), so Free owners skip the upsell and hit "Você atingiu o limite de portais" on a limit of 0 | Gate on `max_hub_tokens` being 0, so Free sees the existing upsell copy |
| B10 | `components/guide/guideContent.tsx:130-147` | "Gere o link do Hub" step (and "Montar sua equipe") shown to Free, which can't do either | Gate those steps on `max_hub_tokens` / `max_team_members > 1`, or make them point to the trial |
| B11 | `supabase/functions/_shared/lifecycle-emails.ts:30, 36, 43, 44` (welcome email) | Promises portal whitelabel, team invites and reports to accounts that start on Free | Frame those as what the 30-day trial gives, with a link to `/comecar` |

**C. Out of scope (noted, not fixed here)**
- `content/landing.content.ts:201` vs `pages/lgpd/LgpdPage.tsx:261`: data export "por 30 dias
  após o cancelamento" vs data "eliminados em até 30 dias". This is a data-retention
  question, not a plan claim.
- Hard-coded "30 dias" literals (about 15 places) that mirror `TRIAL_DAYS`, and the
  "Disponível nos planos Pro e Max" lock tooltip. Correct today; centralising them is
  optional cleanup.
- Help-center articles and blog posts stored in the database were not audited, only the 6
  repo blog files (no issues there). A follow-up audit through the Admin MCP is needed.
