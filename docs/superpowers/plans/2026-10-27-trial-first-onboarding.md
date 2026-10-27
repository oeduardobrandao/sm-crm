# Trial-first onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every eligible new owner a two-question plan picker that makes the 30-day card trial the primary action, send a reminder 7 days before every trial's first charge, and correct every wrongly advertised plan fact.

**Architecture:**
- A workspace column `trial_offer_seen_at` and an owner-only RPC record that the offer was shown. `ProtectedRoute` redirects eligible owners to `/comecar` until it is set.
- `/comecar` gets a new default view built from pure recommendation logic over the live `plans` rows.
- The reminder is a third sweep inside the existing `lifecycle-email-cron`. It runs every 15 minutes, is already monitored by `cron-health-cron`, and already has a claim/delivered ledger, so this adds a candidate RPC and two ledger columns.
- Copy fixes are a closed list from the spec's audit.

**Tech Stack:** React 19, TanStack Query, Vitest + Testing Library, Supabase Postgres (plpgsql/SQL RPCs, psql suites), Deno edge functions, Resend.

**Spec:** `docs/superpowers/specs/2026-10-27-trial-first-onboarding-design.md`. Read it. Its "Audit findings" table is the source for Tasks 8–10.

## Global Constraints

- All user-facing copy is pt-BR, sentence case, **no em dashes** (use a period or a colon).
- Trial facts: 30 days (`TRIAL_DAYS` in `supabase/functions/_shared/trial.ts`), once per workspace, card required, automatic charge at the end unless cancelled.
- Free facts: 2 clients, 1 user, 0 portal links (`max_hub_tokens = 0`), 0 reports/month (`rate_report_generations_per_month = 0`), scheduling **is** included.
- Plan facts on runtime surfaces come from the `plans` row, never literals. Static surfaces state no figure that an Admin plan edit can change.
- Migration version prefixes: start at `20261102000001` and must stay above `main`'s tail at PR time (renumber if needed).
- `REVOKE ... FROM PUBLIC` alone strips `service_role` too: name roles explicitly and `GRANT` explicitly.
- Never use `useBlocker`. New CRM CSS goes in `apps/crm/app.css` only if no public page uses the class; `/comecar` styles live in `apps/crm/src/pages/comecar/comecar.css`.
- Before pushing, run: `npm run lint`, `npm run format:check`, the four `tsc` commands (`npx tsc -p apps/crm/tsconfig.json --noEmit`, hub, admin, `npx tsc -p tsconfig.scripts.json`), `npm run test`, `npm run check:functions`, `npm run test:functions`.

## Review Focus

1. **Owner of several workspaces.** The marker and the eligibility are per **active** workspace (`profiles.conta_id`). Marking the offer seen in workspace A must not suppress it in a never-seen workspace B. *Pinned in Task 1 (SQL) and Task 6.*
2. **Non-owner members** (admin, agent) of an eligible Free workspace are never redirected and never mark the offer seen. *Pinned in Task 1 and Task 6.*
3. **Billing query failure in `ProtectedRoute`** (network/RLS blip): the app still renders the requested page. Fail open, no redirect, no endless skeleton. *Pinned in Task 6.*
4. **Trialing subscription with `current_period_end` null, or `amount_cents` null:** no reminder (null date), or a reminder that leaves out the figure (null amount). Never a crash, never a skipped batch. *Pinned in Task 1 and Task 2.*
5. **No selectable monthly plan** (catalog edited to annual-only or all unpriced): `/comecar` falls back to today's plan grid instead of a dead recommendation card. *Pinned in Task 4 and Task 5.*

---

### Task 1: Database: offer marker, reminder ledger columns, candidate RPC, switch marker

**Files:**
- Create: `supabase/migrations/20261102000001_trial_first_onboarding.sql`
- Create: `supabase/tests/trial_first_onboarding.sql` (psql suite, same begin/rollback style as `supabase/tests/*.sql`; use `supabase/tests/entitlements/_helpers.sql` helpers)

**Interfaces:**
- Produces:
  - column `workspaces.trial_offer_seen_at timestamptz null`. `workspaces` has table-level grants, so no grant bookkeeping is needed. Confirm with `\dp workspaces`.
  - `mark_trial_offer_seen() returns void`, SECURITY DEFINER, `set search_path = public`. It sets `trial_offer_seen_at = now()` on the caller's active workspace (`profiles.conta_id` of `auth.uid()`) **only if** the caller is an `owner` in `workspace_members` for that workspace and the column is null. Otherwise it is a no-op. `revoke all ... from public, anon` and `grant execute ... to authenticated`.
  - columns `lifecycle_emails.ref_at timestamptz null` (the first-charge date the row is about) and `lifecycle_emails.meta jsonb null` (`{to, amount_cents, amount_interval, provider, first_charge_at}` as announced).
  - column `workspace_subscriptions.switched_from_trialing boolean null`. Written by Task 2's `pagarme-checkout` change.
  - `get_trial_reminder_candidates() returns table (workspace_id uuid, workspace_name text, owner_email text, owner_nome text, plan_name text, provider text, amount_cents int, amount_interval text, billing_interval text, first_charge_at timestamptz, attempts int)`, SECURITY DEFINER, service_role only (same revoke/grant block as `get_thankyou_email_candidates` in `20260730000001`).
- Candidate rules, all required:
  - `s.status = 'trialing'`;
  - `s.cancel_at_period_end = false`;
  - `s.current_period_end is not null`;
  - `s.current_period_end between now() + interval '3 days' and now() + interval '7 days 1 hour'`;
  - `(s.switched_from_stripe_subscription_id is null or s.switched_from_trialing is true)`;
  - owner resolved exactly like `get_thankyou_email_candidates` (created_by if still owner, else oldest owner, tie by user_id);
  - `u.email is not null`;
  - ledger join on `email_type = 'trial_reminder'` and `workspace_id`. A row is a candidate when there is no ledger row, **or** `le.ref_at is distinct from s.current_period_end` (the trial end moved), **or** it is a stale undelivered claim (`delivered_at is null and sent_at <= now() - interval '1 hour' and attempts < 30`);
  - `attempts` returned as `0` when the `ref_at` differs (new identity);
  - order by `s.current_period_end asc, ws.id asc`, `limit 50`.

- [ ] **Step 1: Write the failing psql suite** `supabase/tests/trial_first_onboarding.sql` with these blocks (each `begin; … rollback;`, assertions via `do $$ … raise exception … $$`):
  - `mark_seen_owner`: as an owner (set `request.jwt.claims`), `select mark_trial_offer_seen()` sets the active workspace's `trial_offer_seen_at`; a second call leaves the timestamp unchanged.
  - `mark_seen_non_owner_noop`: as an `agent` member, the call leaves it null.
  - `mark_seen_active_workspace_only`: an owner of workspaces A and B with `conta_id = A` marks A only; B stays null.
  - `candidates_window`: trialing rows with `current_period_end` at now()+2d, +5d, +7d30m and +9d. Only +5d and +7d30m are returned.
  - `candidates_exclusions`: `cancel_at_period_end = true`, `current_period_end` null, a switch row with `switched_from_trialing` false or null. None are returned. A switch row with `switched_from_trialing = true` is returned.
  - `candidates_ledger`: a delivered `trial_reminder` row with `ref_at` equal to `current_period_end` excludes the workspace. Changing `current_period_end` makes it a candidate again with `attempts = 0`.
  - `candidates_acl`: `has_function_privilege('authenticated', 'get_trial_reminder_candidates()', 'execute')` is false and true for `service_role`. Check `proacl` too, as the lifecycle migration comment warns.

- [ ] **Step 2: Run it to verify it fails**
  Run: `npm run test:db` (needs Docker/colima; CI `entitlement-tests` runs it otherwise)
  Expected: FAIL, `function mark_trial_offer_seen() does not exist`.

- [ ] **Step 3: Write the migration** `20261102000001_trial_first_onboarding.sql` with the columns, both functions and grants above, plus `comment on column` for each new column. Header comment: spec path, "applied before deploying lifecycle-email-cron and pagarme-checkout", and rollback note "keep `lifecycle_emails` rows".

- [ ] **Step 4: Run the suite to verify it passes**
  Run: `npm run test:db`
  Expected: PASS for every block.

- [ ] **Step 5: Commit**
  `git add supabase/migrations/20261102000001_trial_first_onboarding.sql supabase/tests/trial_first_onboarding.sql && git commit -m "feat(db): trial offer marker and trial reminder candidates"`

---

### Task 2: Edge: trial reminder sweep, email template, switch marker write

**Files:**
- Modify: `supabase/functions/_shared/lifecycle-emails.ts`: add `buildTrialReminderEmail`, `TRIAL_REMINDER_SUBJECT`.
- Modify: `supabase/functions/lifecycle-email-cron/handler.ts`: third sweep in `runLifecycleEmailCron`.
- Modify: `supabase/functions/lifecycle-email-cron/index.ts`: only if the report/log shape needs the new counter.
- Modify: `supabase/functions/pagarme-checkout/handler.ts` (switch insert near line 499): write `switched_from_trialing`.
- Test: `supabase/functions/__tests__/lifecycle-emails_test.ts`, `supabase/functions/__tests__/lifecycle-email-cron_test.ts`, and the existing pagarme-checkout switch test file (find it with `rg -l "switched_from_stripe_subscription_id" supabase/functions/__tests__`).

**Interfaces:**
- Consumes: `get_trial_reminder_candidates()` rows (Task 1); the existing `claim` / `markDelivered` helpers and `LifecycleCronDeps` in `handler.ts`.
- Produces:
  - `formatFirstCharge(c: { provider: string; amount_cents: number | null; amount_interval: string | null; billing_interval: string | null }): string | null` returns:
    - `null` when `amount_cents` is null;
    - `"12x de R$ 129,90 (total de R$ 1.558,80)"` for `provider = 'pagarme'`, with the installment = `Math.round(amount_cents / 12)` and `amount_cents` the annual total;
    - `"R$ 1.343,00 por ano"` for Stripe yearly (`amount_interval` or `billing_interval` `'year'`);
    - `"R$ 139,90 por mês"` otherwise.

    pt-BR currency in all cases.
  - `buildTrialReminderEmail(p: { firstName: string | null; workspaceName: string; planName: string; firstCharge: string | null; firstChargeDate: string; daysLeft: number; appBaseUrl: string }): { subject: string; html: string }`.
  - `runLifecycleEmailCron` return type gains `trialRemindersSent: number`.

**Email content (exact copy, pt-BR):**
- Subject: `Seu teste do Mesaas ${planName} termina em ${daysLeft} dias` (`daysLeft` = whole days, `Math.ceil` of `(first_charge_at - now)` in days).
- Body paragraphs:
  1. "Oi, {firstName}," (or "Oi," when there is no first name)
  2. "Seu teste grátis do plano {planName} no workspace {workspaceName} termina em {firstChargeDate}."
  3. "Nesse dia fazemos a primeira cobrança de {firstCharge} no cartão cadastrado." When `firstCharge` is null: "Nesse dia fazemos a primeira cobrança do valor do seu plano no cartão cadastrado."
  4. "Se quiser continuar, não precisa fazer nada."
  5. Primary button "Ver meu plano" → `${appBaseUrl}/configuracao/cobranca`.
  6. "Se preferir cancelar ou trocar de plano, é só acessar Plano e cobrança antes dessa data: {link}." (same URL, visible text link)
  7. "No plano Free você volta a ter 2 clientes, só você na conta e nenhum portal de aprovação ou relatório."
- `firstChargeDate` is formatted in `America/Sao_Paulo`, long pt-BR date ("26 de novembro"). For Pagar.me, `current_period_end` is already the rounded `start_at`; don't re-round it.
- Escape every interpolated value with the module's existing `escapeHtml`, and run the subject through `sanitizeSubjectValue`.
- Sweep: for each candidate,
  1. `claim` the row with `{ email_type: 'trial_reminder', workspace_id, attempts: c.attempts + 1, ref_at: c.first_charge_at, delivered_at: null, meta: {...} }` (on conflict `email_type,workspace_id`);
  2. send from `LIFECYCLE_FROM` with idempotency key `trial_reminder/${workspace_id}/${first_charge_at}`;
  3. `markDelivered`.
- Log a warning `trial-reminder:late` with `daysLeft` when `first_charge_at - now < 7 days`. Log `trial-reminder:no-amount` when `firstCharge` is null.
- An error on one candidate is pushed to `errors` and does not stop the batch, same as the other sweeps.

- [ ] **Step 1: Write the failing template tests** in `lifecycle-emails_test.ts`:
  - `formatFirstCharge` returns `"R$ 139,90 por mês"` for `{provider:'stripe', amount_cents:13990, amount_interval:'month'}`;
  - `"R$ 1.343,00 por ano"` for `{provider:'stripe', amount_cents:134300, amount_interval:'year'}`;
  - `"12x de R$ 129,90 (total de R$ 1.558,80)"` for `{provider:'pagarme', amount_cents:155880}`;
  - `null` for a null `amount_cents`;
  - `buildTrialReminderEmail` subject equals `"Seu teste do Mesaas Pro termina em 7 dias"`, the html contains `"/configuracao/cobranca"` twice, contains "valor do seu plano" when `firstCharge` is null, and escapes a workspace name `"<b>x</b>"`;
  - the html contains no `—` character.
- [ ] **Step 2: Write the failing sweep tests** in `lifecycle-email-cron_test.ts`, using the file's existing fake `LifecycleDb`:
  - a candidate leads to a claim with `email_type 'trial_reminder'` and `ref_at` set, a send with idempotency key `trial_reminder/<ws>/<date>`, then delivered, with `trialRemindersSent === 1`;
  - a send failure on candidate 1 still sends candidate 2;
  - an RPC error is reported and the welcome/thank-you sweeps still run.
- [ ] **Step 3: Run them to verify they fail**
  Run: `deno test --no-check supabase/functions/__tests__/lifecycle-emails_test.ts supabase/functions/__tests__/lifecycle-email-cron_test.ts`
  Expected: FAIL (missing exports).
- [ ] **Step 4: Implement** `formatFirstCharge`, `buildTrialReminderEmail` (reuse the module's existing HTML layout helper used by `buildThankYouEmail`), and the sweep.
- [ ] **Step 5: Switch marker.** In `pagarme-checkout/handler.ts`, where the switch row is written with `switched_from_stripe_subscription_id`, also write `switched_from_trialing: <source Stripe row status> === 'trialing'`. Add a test asserting it is `true` for a trialing source and `false` for an active one.
- [ ] **Step 6: Run the tests and the type gate**
  Run: `deno test --no-check supabase/functions/__tests__/ && npm run check:functions`
  Expected: PASS, no type errors.
- [ ] **Step 7: Commit**
  `git commit -am "feat(email): trial reminder 7 days before the first charge"`

---

### Task 3: Frontend data: plan contract, offer marker, eligibility helpers

**Files:**
- Modify: `apps/crm/src/services/billing.ts` (`BillingPlan`, `listActivePlans` select, `EffectivePlan`, `fetchEffectivePlan` select, new `markTrialOfferSeen`); `PublicPricingPlan` + `listPublicPricingPlans` select gain `rate_report_generations_per_month` (for Task 9's A3).
- Modify: `apps/crm/src/pages/configuracao/cobranca/plan-display.ts`
- Test: `apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts` (create if absent), `apps/crm/src/services/__tests__/billing.test.ts` (extend if present)

**Interfaces:**
- Produces:
  - `BillingPlan` adds `max_hub_tokens: number | null; rate_report_generations_per_month: number | null; feature_instagram_ai: boolean; feature_auto_sync_cron: boolean; feature_leads: boolean; feature_financial: boolean; feature_contracts: boolean; feature_agenda: boolean; feature_mensagens: boolean; feature_team_chat: boolean; feature_instagram_automation: boolean; feature_briefing_audio: boolean`.
  - `EffectivePlan` adds `trialOfferSeenAt: string | null` (from `workspaces.trial_offer_seen_at`).
  - `markTrialOfferSeen(): Promise<void>` calls `supabase.rpc('mark_trial_offer_seen')`, throws on error.
  - `planHasPortal(p: { max_hub_tokens: number | null }): boolean` returns `max_hub_tokens === null || max_hub_tokens > 0`.
  - `planHasReports(p: { rate_report_generations_per_month: number | null }): boolean`, same rule.
  - `isTrialOfferEligible(plan: Pick<EffectivePlan, 'planId' | 'planSource' | 'wasDemo'> | null | undefined, sub: WorkspaceSubscription | null | undefined): boolean` returns `resolveCurrentPlanId(plan?.planId, sub?.plan_id) === 'free' && plan?.planSource !== 'manual' && !hasUsedTrial(sub, plan)`. It returns false when either argument is `undefined` (still loading).

- [ ] **Step 1: Write failing tests**:
  - `planHasPortal({max_hub_tokens:0})` is false; `null` and `5` give true. Same three cases for `planHasReports`.
  - `isTrialOfferEligible`:
    - true for `{planId:null, planSource:'system', wasDemo:false}` with `sub = null`;
    - false with `planSource:'manual'`;
    - false when `sub.hasEverSubscribed`;
    - false for `planId:'pro'`;
    - false when `sub` is `undefined`.
  - `markTrialOfferSeen` calls `rpc('mark_trial_offer_seen')`. Mock the supabase client the way neighbouring service tests do.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/configuracao/cobranca apps/crm/src/services`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update every existing test fixture that builds a `BillingPlan` or `EffectivePlan` literal (`rg -l "price_brl_annual" apps/crm/src --glob '*test*'`) so `tsc` passes.
- [ ] **Step 4: Run** the same vitest command plus `npx tsc -p apps/crm/tsconfig.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(billing): plan contract and trial offer eligibility"`

---

### Task 4: Recommendation logic

**Files:**
- Create: `apps/crm/src/pages/comecar/recommend.ts`
- Test: `apps/crm/src/pages/comecar/__tests__/recommend.test.ts`

**Interfaces:**
- Consumes: `BillingPlan`, `isSelectableTrialPlan` (Task 3 / existing).
- Produces:
  - `type ClientBucket = '1-2' | '3-5' | '6-15' | '16+'`; `type TeamBucket = '1' | '2' | '3-5' | '6+'`.
  - `CLIENT_BUCKETS: { id: ClientBucket; label: string; upper: number }[]`, labels and uppers: `1 a 2`/2, `3 a 5`/5, `6 a 15`/15, `Mais de 15`/`Infinity`.
  - `TEAM_BUCKETS`, same shape: `Só eu`/1, `2 pessoas`/2, `3 a 5`/5, `6 ou mais`/`Infinity`.
  - `trialCandidates(plans: BillingPlan[]): BillingPlan[]`: plans passing `isSelectableTrialPlan` with `price_brl > 0`, sorted by `price_brl`, then `sort_order`, then `id`.
  - `recommendPlan(plans: BillingPlan[], clients: ClientBucket, team: TeamBucket): BillingPlan | null`: the first candidate whose `max_clients` and `max_team_members` (null = unlimited) are both ≥ the bucket uppers. If none fits, the last candidate. `null` when there are no candidates.
  - `planUnlocks(plan: BillingPlan): string[]`. Ordered labels, each included only when its condition holds:

    | Condition | Label |
    |---|---|
    | `planHasPortal` | "Portal para o cliente aprovar os posts" |
    | `planHasReports` and `feature_instagram_ai` | "Relatórios do Instagram com IA" |
    | `planHasReports` without `feature_instagram_ai` | "Relatórios do Instagram" |
    | `feature_auto_sync_cron` | "Métricas atualizadas sozinhas" |
    | any of financial/contracts/leads | "Financeiro, contratos e leads" when all three; otherwise the present ones joined pt-BR ("Financeiro e leads") |
    | any of agenda/mensagens/team_chat | "Agenda, mensagens e chat da equipe" when all three; otherwise the present ones joined |
    | `feature_instagram_automation` | "Respostas automáticas no Instagram" |
    | `feature_briefing_audio` | "Briefing em áudio" |

  - `recommendationReason(clients: ClientBucket, team: TeamBucket): string` returns `` `Pensado para quem atende ${clientPhrase} ${teamPhrase}.` ``:
    - `clientPhrase`: `1 a 2 clientes` / `3 a 5 clientes` / `6 a 15 clientes` / `mais de 15 clientes`;
    - `teamPhrase`: `sem equipe` / `com mais uma pessoa` / `com uma equipe de 3 a 5` / `com uma equipe de 6 ou mais`.
  - `showFreeNote(clients: ClientBucket, team: TeamBucket): boolean` is true only for `'1-2'` with `'1'`.
  - `estimateFirstCharge(now: Date, days = 30): Date`.

- [ ] **Step 1: Write failing tests** with fixtures equal to production rows:
  - Start: R$ 99,90, 5 clients, 2 users, `max_hub_tokens` 5, reports 5, no automation or briefing.
  - Pro: R$ 139,90, 15 clients, 5 users, automation and briefing on.
  - Max: R$ 199,90, unlimited.
  - Free: price 0.
  - Lifetime: internal, price 0.

  Assertions:
  - `recommendPlan(…, '1-2','1')` gives start; `('3-5','2')` start; `('6-15','2')` pro; `('3-5','3-5')` pro; `('16+','1')` max; `('1-2','6+')` max.
  - With only Start and Pro in the list, `('16+','6+')` gives pro (the last candidate).
  - `recommendPlan([free, lifetime], …)` is `null`. Review Focus 5: a list where every plan has `price_brl` null and `price_brl_annual` > 0 also gives `null`.
  - `planUnlocks(start)` deep-equals `["Portal para o cliente aprovar os posts", "Relatórios do Instagram com IA", "Métricas atualizadas sozinhas", "Financeiro, contratos e leads", "Agenda, mensagens e chat da equipe"]`. `planUnlocks(pro)` additionally ends with `"Respostas automáticas no Instagram", "Briefing em áudio"`.
  - `planUnlocks(free)` contains neither portal nor reports.
  - `recommendationReason('6-15','3-5')` is `"Pensado para quem atende 6 a 15 clientes com uma equipe de 3 a 5."`.
  - `showFreeNote('1-2','1')` is true and `('1-2','2')` false.
  - No returned string contains `—`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/comecar/__tests__/recommend.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `recommend.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(comecar): plan recommendation logic"`

---

### Task 5: `/comecar` screen

**Files:**
- Create: `apps/crm/src/pages/comecar/TrialPlanPicker.tsx`, the presentational two-column view (artboard C of the spec's canvas).
- Modify: `apps/crm/src/pages/comecar/ComecarPage.tsx`, `apps/crm/src/pages/comecar/comecar.css`, `apps/crm/src/lib/analytics.ts` (event union), `apps/crm/src/lib/checkout-analytics.ts`.
- Test: `apps/crm/src/pages/comecar/__tests__/TrialPlanPicker.test.tsx`, extend `apps/crm/src/pages/comecar/__tests__/ComecarPage.test.tsx`.

**Interfaces:**
- Consumes: everything from Task 4; `markTrialOfferSeen`, `isTrialOfferEligible` (Task 3).
- Produces:
  - `TrialPlanPicker(props: { plans: BillingPlan[]; busyPlanId: string | null; now: Date; onStart(planId: string, recommendedPlanId: string): void; onSkip(): void; onShowAllPlans(): void; onRecommended(e: { clients: ClientBucket; team: TeamBucket; planId: string }): void })`.
  - `captureCheckoutStarted(planId, interval, source, provider = 'stripe', extra?: { recommended_plan_id?: string; accepted_recommendation?: boolean })`, merging `extra` into the event props.
  - New analytics event name `'trial_plan_recommended'`.

**Behaviour (`TrialPlanPicker`):**
- **Left column:**
  - `Badge` "Conta criada", h1 "Vamos montar sua conta", lead "Duas perguntas e mostramos o plano certo para você testar de graça por 30 dias.".
  - Two `fieldset`/`legend` groups of `<button type="button" aria-pressed>` chips from `CLIENT_BUCKETS` and `TEAM_BUCKETS`, legends "Quantos clientes você atende hoje?" and "Quantas pessoas trabalham com você, contando você?". Nothing is preselected.
  - A text button "Continuar no Free" → `onSkip`, followed by "2 clientes, só você, sem portal de aprovação nem relatórios.".
- **Right column card** (`aria-live="polite"`):
  - Until both answers are set it shows the plan with id `'pro'` if it is a candidate (else the first candidate), labelled "O mais escolhido". Once both are set it shows `recommendPlan(...)`, labelled "Recomendado para você", with the `recommendationReason` line.
  - Badges for client and user limits ("Até 15 clientes" / "Clientes ilimitados", "Até 5 usuários" / "Usuários ilimitados"), then the `planUnlocks` list and the `showFreeNote` paragraph (exact copy in the spec).
  - Primary button "Começar 30 dias grátis do {name}" → `onStart(plan.id, plan.id)`. When `busyPlanId === plan.id`, it is disabled and shows "Aguarde…".
  - Under the button: "R$ 0 hoje. Primeira cobrança de {price}/mês por volta de {estimateFirstCharge(now) as 'd \'de\' MMMM' pt-BR}, só se você continuar. Avisamos por e-mail 7 dias antes, com o valor e a data exatos."
  - Link button "Ver todos os planos" → `onShowAllPlans`.
- `onRecommended` fires when both answers are set and on each change.

**`ComecarPage` changes:**
- State `view: 'picker' | 'grid'`, default `'picker'`.
- If `trialCandidates(plans).length === 0` it renders the existing grid (Review Focus 5).
- The grid view is today's markup unchanged, plus a "Voltar" link to the picker.
- **Mark seen:** a `useRef` latch effect. When `eligible` becomes true (this includes the intent path), call `markTrialOfferSeen()` once, then `queryClient.invalidateQueries({ queryKey: ['billing','effective-plan-with-source'] })`. A rejected call is swallowed with `console.warn`, because the screen must still work.
- `onRecommended` calls `captureEvent('trial_plan_recommended', { clients_bucket, team_bucket, plan_id })`.
- `onStart` calls the existing `beginCheckout(planId, 'month')` and passes `extra` to `captureCheckoutStarted` (`accepted_recommendation: planId === recommendedPlanId`). The grid path passes no `extra`.
- Replace `planHighlights`' portal line with `planHasPortal(p)` (spec A2).
- Standby copy (spec B8): "Levamos você ao pagamento seguro. Nada é cobrado nos próximos 30 dias."
- Existing guards, intent auto-checkout, Pagar.me dialog, footer and WhatsApp link are untouched.

- [ ] **Step 1: Write failing `TrialPlanPicker` tests** (fixtures as in Task 4, `now = new Date('2026-10-27T12:00:00-03:00')`):
  - Initially it shows "O mais escolhido" and "Pro".
  - Clicking "1 a 2" and "Só eu" shows "Recomendado para você", "Start" and the Free note, and calls `onRecommended` with `{clients:'1-2', team:'1', planId:'start'}`. Both chips have `aria-pressed="true"`.
  - Clicking "6 a 15" and "3 a 5" shows "Pensado para quem atende 6 a 15 clientes com uma equipe de 3 a 5.".
  - The primary button text is "Começar 30 dias grátis do Pro", and clicking it calls `onStart('pro','pro')`.
  - The page shows "por volta de 26 de novembro" and "Avisamos por e-mail 7 dias antes".
  - "Continuar no Free" calls `onSkip`; "Ver todos os planos" calls `onShowAllPlans`.
  - The rendered text contains no `—`.
- [ ] **Step 2: Extend the `ComecarPage` tests:**
  - An eligible owner sees the picker and `markTrialOfferSeen` is called once.
  - A rejected `markTrialOfferSeen` still renders the picker.
  - With only annual-priced plans the grid renders.
  - "Ver todos os planos" shows the Mensal/Anual toggle.
  - Starting from the picker calls `startCheckout('pro','month','onboarding')`.
- [ ] **Step 3: Run** `npx vitest run apps/crm/src/pages/comecar`. Expected: FAIL.
- [ ] **Step 4: Implement** with the Mesaas tokens/classes already in `comecar.css`. The layout stacks under 768px (flex-wrap, both columns `flex: 1 1 420px; min-width: 0`).
- [ ] **Step 5: Run** the same command plus `npx tsc -p apps/crm/tsconfig.json --noEmit`. Expected: PASS.
- [ ] **Step 6: Verify in the browser.**
  - Start the CRM dev server with `preview_start` (`npm run dev:env` config; the worktree has no `.env`).
  - Sign in with a Free test owner using the seed-login approach from memory "Seed login p/ verificação no Browser pane", against staging data only.
  - Open `/comecar` and check desktop and the mobile preset. Screenshot both.
- [ ] **Step 7: Commit** `git commit -am "feat(comecar): two-question trial plan picker"`

---

### Task 6: Route eligible owners to `/comecar` once

**Files:**
- Create: `apps/crm/src/components/layout/useTrialOfferRedirect.ts`
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx` (after the `needsSetup` block)
- Test: `apps/crm/src/components/layout/__tests__/useTrialOfferRedirect.test.tsx`, and existing `ProtectedRoute` tests (mock the new hook there)

**Interfaces:**
- Consumes: `getEffectivePlanWithSource`, `getWorkspaceSubscription`, `isTrialOfferEligible` (Task 3). It uses the same query keys as `ComecarPage` (`['billing','effective-plan-with-source']`, `['billing','subscription']`) so the cache is shared.
- Produces:
  - `TRIAL_OFFER_EXEMPT_PREFIXES = ['/comecar', '/workspace-setup', '/oauth', '/conectar', '/configuracao']`.
  - `useTrialOfferRedirect(pathname: string): { pending: boolean; redirect: boolean }`:
    - Owner check: `(workspaceRole ?? role) === 'owner'`. For non-owners and exempt paths: `{pending:false, redirect:false}` with the queries disabled.
    - `pending` is true only while either query is loading.
    - On query error: `{pending:false, redirect:false}`.
    - Otherwise `redirect = isTrialOfferEligible(plan, sub) && plan.trialOfferSeenAt === null`.
- `ProtectedRoute`: `pending` renders `PageSkeleton`; `redirect` renders `<Navigate to="/comecar" replace />`.

- [ ] **Step 1: Write failing hook tests:**
  - An owner on `/dashboard` with eligible data and `trialOfferSeenAt: null` gets `redirect:true`.
  - The same with `trialOfferSeenAt` set gets `redirect:false`.
  - An agent gets `redirect:false` and no query is fired.
  - `/comecar` and `/configuracao/cobranca` get `redirect:false`.
  - `planSource:'manual'` gets `redirect:false`.
  - A rejected `getEffectivePlanWithSource` gives `{pending:false, redirect:false}`.
  - Review Focus 1: an owner whose active workspace has the marker set gets no redirect even though the user owns another unseen workspace. The hook only ever reads the active workspace through `getEffectivePlanWithSource`, so assert it is called with no workspace argument and the result alone decides.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/components/layout`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook and the two `ProtectedRoute` lines.
- [ ] **Step 4: Run** `npx vitest run apps/crm/src/components/layout apps/crm/src/pages/comecar` and `npx tsc -p apps/crm/tsconfig.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Browser check.**
  - A Free owner visiting `/dashboard` lands on `/comecar`.
  - After "Continuar no Free", `/dashboard` stays put on reload.
  - An agent user is never redirected.
- [ ] **Step 6: Commit** `git commit -am "feat(onboarding): send eligible owners to the trial offer once"`

---

### Task 7: In-app plan claims (A1, A2, B9, B10)

**Files:**
- Modify: `apps/crm/src/components/billing/TrialNudgeCard.tsx` (use `isTrialOfferEligible` instead of its inline free/hasUsedTrial check; new copy)
- Modify: `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx:86-104` (`planFeatures`)
- Modify: `apps/crm/src/pages/cliente-detalhe/hub/AcessoPage.tsx:70-71`
- Modify: `apps/crm/src/components/guide/guideContent.tsx` (step type + steps `t1p4` and the "Montar sua equipe" step) and the guide's gating code where `entitlementFlag` is evaluated
- Test: `components/billing/__tests__/TrialNudgeCard.test.tsx`, CobrancaPage tests, AcessoPage tests, guide tests (find with `rg -l "entitlementFlag" apps/crm/src --glob '*test*'`)

**Interfaces:**
- Consumes: `planHasPortal`, `planHasReports`, `isTrialOfferEligible` (Task 3); `useWorkspaceLimits().limits` (`max_hub_tokens`, `max_team_members`).
- Produces: guide step field `minLimit?: { key: 'max_hub_tokens' | 'max_team_members'; min: number }`. A step is hidden when `limits` is loaded, not null, and `limits[key] !== null && limits[key] < min`.

**Exact copy and logic:**
- **TrialNudgeCard** text: "Você está no plano Free. Teste um plano pago por 30 dias e libere o portal de aprovação, os relatórios, as métricas automáticas, o financeiro e a sua equipe." The title stays.
- **CobrancaPage:** the portal line only when `planHasPortal(p)`; "Relatórios de desempenho" only when `planHasReports(p)`. `planFeatures`' input type must include both fields: use the `BillingPlan` from Task 3.
- **AcessoPage:** `hubPortalEnabled = hasFeature('feature_hub_portal') && !(limits && limits.max_hub_tokens === 0)`. While limits load, keep today's optimistic `true` so the paywall never flashes.
- **Guide:** `t1p4` gets `minLimit: { key: 'max_hub_tokens', min: 1 }`; the team step gets `minLimit: { key: 'max_team_members', min: 2 }`.

- [ ] **Step 1: Write failing tests:**
  - TrialNudgeCard renders the new text and contains neither "agendamento" nor `—`, and is hidden for `planSource:'manual'`.
  - The CobrancaPage Free card shows neither "Portal de aprovação do cliente" nor "Relatórios de desempenho"; the Start card shows both.
  - AcessoPage with `max_hub_tokens: 0` renders "O Portal do Cliente faz parte dos planos pagos."; with `5` it renders the generate button.
  - The guide with `max_hub_tokens: 0` and `max_team_members: 1` omits both steps; with unlimited limits (`limits: null`) it shows them.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/components apps/crm/src/pages/configuracao apps/crm/src/pages/cliente-detalhe`. Expected: the new assertions FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "fix(billing): in-app plan claims match plan limits"`

---

### Task 8: Landing, pricing and marketing claims (A3, A4, A5, B1–B7, headline/CTA)

**Files:**
- Modify: `apps/crm/src/pages/landing/PricingSection.tsx`, `apps/crm/src/pages/landing/PlanComparison.tsx`, `apps/crm/src/pages/landing/LandingPage.tsx:516-517`, `apps/crm/src/content/landing.content.ts` (lines 48, 93, 151-167), `apps/crm/src/content/precos.content.ts` (lines 3, 16-17, 25), `apps/crm/src/content/site-meta.ts:78`, `apps/crm/src/pages/marketing/MarketingPage.tsx:66`, `apps/crm/src/content/paginas/aprovacao-de-post.ts:54`, `apps/crm/src/content/paginas/portal-do-cliente.ts` (55 and the brand FAQ near 41-42)
- Test: existing tests that snapshot or assert these strings (`rg -l "sem cartão|30 dias grátis|Começar grátis" apps/crm/src --glob '*test*'`), plus `apps/crm/src/pages/landing/__tests__/PricingSection.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `PublicPricingPlan.rate_report_generations_per_month` (Task 3), `planHasReports` (Task 3), `getWorkspaceSubscription`, `getEffectivePlanWithSource`, `hasUsedTrial`.

**Exact replacements:**

| Where | New copy / behaviour |
|---|---|
| PricingSection section `<p>` | "Teste qualquer plano pago por 30 dias e só pague se continuar. Sem fidelidade, cancele quando quiser." |
| PricingSection `PLAN_MARKETING.free.cta` | "Usar o Free" |
| PricingSection logged-in + `hasUsedTrial` (B2) | Paid CTAs read `Assinar ${plan.name}`, and `.plan-trial-note` is not rendered. The queries run only when `user` is set, with keys `['billing','subscription']` and `['billing','effective-plan-with-source']`. Same in the `PlanComparison` CTA row via `actionFor` |
| PlanComparison row `feature_analytics_reports` (A3) | Becomes a limit row on `rate_report_generations_per_month`, label "Relatórios por mês", rendered like "Portais do cliente" (0 → "—", null → "Ilimitado", n → "n") |
| LandingPage CtaFinal (A4) | "Teste qualquer plano pago por 30 dias e organize seus clientes ainda hoje. Cancele quando quiser." |
| landing.content `hero.note` (A5) | "30 dias grátis em qualquer plano pago." |
| landing.content metrics card (B5) | "…atualizados todo dia nos planos pagos, direto da API oficial." (keep the rest of the sentence) |
| landing.content how-it-works step 01 (B4) | "Comece o teste grátis de 30 dias, importe seus clientes por planilha e configure os modelos de contrato." |
| precos.content sub (B1) | "Teste qualquer plano pago por 30 dias. O Free não pede cartão. Mude de plano quando quiser, sem fidelidade e sem multa de cancelamento." |
| precos.content per-client FAQ answer (B6) | "Não. Os planos do Mesaas são por workspace e se diferenciam pelo número de clientes e de usuários, sem cobrança extra por cliente atendido." |
| precos.content payment answer (B7) | "Cartão de crédito, pela Stripe. O plano anual também pode ser pago em 12x no cartão, pela Pagar.me." |
| site-meta /precos description (B1) | "Compare os planos Free, Start, Pro e Max do Mesaas. Teste os planos pagos por 30 dias e evolua conforme sua agência cresce." |
| MarketingPage line under CTA (B1) | "O Free não pede cartão · planos pagos com 30 dias grátis" |
| aprovacao-de-post CTA (B3) | "Teste grátis por 30 dias e envie o primeiro link de aprovação em minutos." |
| portal-do-cliente CTA (B3) | "Teste grátis por 30 dias e gere o primeiro link de portal em minutos." The brand-identity FAQ answer gains the sentence "A identidade visual da agência está disponível nos planos pagos." |

- [ ] **Step 1: Write failing tests:**
  - PricingSection (logged out) shows "Usar o Free" and the new paragraph.
  - PricingSection (logged in, `hasEverSubscribed: true`) shows "Assinar Pro" and no "30 dias grátis para começar".
  - The PlanComparison Free column shows "—" for "Relatórios por mês".
  - A test over the content modules asserts that none of `precos.content`, `landing.content`, `site-meta` and `paginas/*` contains "sem cartão de crédito" adjacent to "teste", or `—` in the changed strings. At minimum, assert the exact new strings.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/landing apps/crm/src/content apps/crm/src/pages/marketing`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `.seo.ts` mirrors in sync: they import from these content modules, so check with `rg -l "precos.content|landing.content" apps/crm/src`.
- [ ] **Step 4: Run** the vitest command, then `npm run build && npm run prerender`, then `grep -c "Usar o Free" dist/index.html`. Expected: PASS, and the count ≥ 1 if the pricing block is prerendered. Otherwise confirm `data-ssr="landing"` is still present.
- [ ] **Step 5: Browser check.** Landing `/#pricing` and `/precos`, logged out, desktop and mobile. Screenshot both.
- [ ] **Step 6: Commit** `git commit -am "fix(landing): plan and trial claims match the plans"`

---

### Task 9: Welcome email and Terms (B11, A6)

**Files:**
- Modify: `supabase/functions/_shared/lifecycle-emails.ts` (`buildWelcomeEmail`, lines ~30-44)
- Modify: `apps/crm/src/pages/termos-de-uso/TermosPage.tsx:126-145` (section 5)
- Test: `supabase/functions/__tests__/lifecycle-emails_test.ts`, the Terms page test if present (`rg -l TermosPage apps/crm/src --glob '*test*'`)

**Welcome email:**
- Keep the structure.
- Change the feature bullets so the portal, team and reports bullets are introduced by "No teste grátis de 30 dias dos planos pagos você também tem:".
- Add a secondary link "Começar meu teste grátis" → `${appBaseUrl}/comecar`.
- The bullets stay as today, minus anything promised to Free.

**Terms section 5:** replace the two beta sentences and the "Quando os planos pagos entrarem em vigor:" lead with this text. **Draft for the product owner's approval.** Do not merge Task 9's Terms change until they approve it in writing on the PR.

> O Mesaas oferece um plano gratuito (Free), com limites de uso, e planos pagos de assinatura com mais recursos e limites maiores, descritos na página de preços.
>
> Teste grátis: cada workspace pode testar um plano pago uma única vez, por 30 dias. Para iniciar o teste pedimos um cartão de crédito. Nada é cobrado durante o teste. Enviamos um e-mail 7 dias antes da primeira cobrança, com o valor e a data. Se você não cancelar até o fim do teste, a assinatura começa e a primeira cobrança é feita automaticamente.
>
> Nos planos pagos:

Keep the existing bullet list after it, and read it to check it still holds.

- [ ] **Step 1: Write failing tests:**
  - The welcome html contains "/comecar" and "No teste grátis de 30 dias", and contains no `—`.
  - The Terms page renders "Teste grátis: cada workspace pode testar" and not "período beta".
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/lifecycle-emails_test.ts` and `npx vitest run apps/crm/src/pages/termos-de-uso`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both commands. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "fix(copy): welcome email and terms describe the trial"`

---

### Task 10: Docs, spec corrections, release checklist

**Files:**
- Modify: `CLAUDE.md` (Gotchas: a "Trial-first onboarding" bullet)
- Modify: `docs/superpowers/specs/2026-10-27-trial-first-onboarding-design.md`

**The CLAUDE.md bullet must say:**
- `/comecar` is shown once per workspace, gated by `workspaces.trial_offer_seen_at` (set by `mark_trial_offer_seen()`). Redirects come from `useTrialOfferRedirect` in `ProtectedRoute`.
- The trial reminder is a sweep in `lifecycle-email-cron` (`get_trial_reminder_candidates`, `lifecycle_emails.email_type = 'trial_reminder'`, `ref_at` = first-charge date). Stripe's built-in trial reminder must stay **off**.
- Pagar.me `amount_cents` is the annual total; the installment is `amount_cents / 12`.
- Plan facts on static pages: none that an Admin plan edit can change. If one is ever added, a plan edit needs a frontend redeploy.
- Deploy order: migration `20261102000001` → `lifecycle-email-cron` + `pagarme-checkout` → frontend merge. Rollback: frontend first, then the functions. Keep `lifecycle_emails` rows.

**Spec corrections:**
- The reminder runs in `lifecycle-email-cron` (every 15 minutes, already monitored), not in a new daily function. The window is 7 days to 7 days + 1 hour, with catch-up down to 3 days.
- The 12x installment is `amount_cents / 12`. There is no `installment_amount_cents` subscription column.
- A null `amount_cents` omits the figure. No live provider fetch: both webhooks write it.
- Add `switched_from_trialing`.

- [ ] **Step 1: Edit both files.**
- [ ] **Step 2: Run the full pre-push gate** from Global Constraints. Expected: all green.
- [ ] **Step 3: Commit** `git commit -am "docs: trial-first onboarding notes"`

## Release (after review, not a task for the implementer)

1. Renumber the migration above `main`'s tail if needed.
2. `npx supabase db push --linked`, staging first and then prod. Verify `\df mark_trial_offer_seen` and the ACL of `get_trial_reminder_candidates`.
3. Deploy `lifecycle-email-cron` and `pagarme-checkout` (`--no-verify-jwt` for the cron, as today), staging, then prod.
4. Confirm Stripe Dashboard → Billing → Customer emails → "Send reminders when free trials end" is **off**.
5. Get the product owner's approval of the Terms text on the PR, then merge (Vercel deploys the frontend immediately).
