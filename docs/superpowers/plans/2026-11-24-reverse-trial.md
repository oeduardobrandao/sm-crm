# Reverse Trial (14 days of Pro without a card) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every eligible new owner starts on Pro for 14 days without a card, sees a countdown, can add a card that is charged on the trial end date, and drops to Free on day 14 with data kept, Financeiro/Contratos read-only, DM replies stopped and Hub links paused 7 days later.

**Architecture:** The trial is `workspaces.plan_id = 'pro'` with a new `plan_source = 'trial'` and `reverse_trial_*` columns, because every entitlement check already reads `plan_id`. All state changes go through locked SQL functions (start, convert, end) shared by the CRM, the payment webhooks and a new `reverse-trial-cron`. The CRM, Hub and Admin read the columns; nothing else about entitlements changes.

**Tech Stack:** Postgres (Supabase migrations, psql entitlement suites), Deno edge functions, React 19 + TanStack Query (CRM, Hub, Admin), Vitest, Stripe Checkout, Pagar.me v5.

**Spec:** `docs/superpowers/specs/2026-11-24-reverse-trial-design.md` (read it first; mockups linked at its top).

## Global Constraints

- Trial plan `pro`, length 14 days, Hub pause 7 days after `reverse_trial_ended_at`.
- One reverse trial per person (`profiles.reverse_trial_used_at`) and per workspace, ever.
- `plan_source` values: `system | stripe | manual | pagarme | demo | trial`.
- `reverse_trial_outcome` values: `converted | downgraded | ended_by_admin`.
- Stripe trial end = `max(reverse_trial_ends_at, now + 48h)`; Pagar.me `start_at` = trial end date via `resolveStartAt` rounding.
- Days left: whole days, rounded down, `America/Sao_Paulo`; never increases.
- Migrations `20261130000001` (schema/functions) and `20261130000002` (cron schedule); renumber above main's tail before `gh pr create`.
- Edge functions: `buildCorsHeaders(req)`, generic error bodies, crons check `x-cron-secret`, deploy `--no-verify-jwt` for `reverse-trial-cron`, `hub-*`, `hub-auth`.
- SECURITY DEFINER functions: `set search_path`, `revoke ... from public, anon, authenticated` then grant explicitly.
- iOS (`isNativeApp()`): no button, price, link or end-of-trial modal; trial still starts.
- pt-BR copy, sentence case, no em dashes; Mesaas tokens and shadcn primitives; icons `lucide-react`.
- Never delete or clear `reverse_trial_*`, `reverse_trial_used_at` or `lifecycle_emails` rows.
- Before pushing: `npm run lint`, `npm run format:check`, the five `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`.

## Review Focus

1. A Stripe webhook arriving after the sweep downgraded the workspace: expect the paid plan, `outcome = 'converted'`, no Hub pause, no pending downgrade email (Task 2 test `late_convert_after_downgrade`).
2. Card added, then first charge fails or subscription cancelled before any payment: expect `outcome = 'downgraded'` and the full downgrade experience (Task 5 test `fallback_on_never_paid_trial_conversion_marks_downgraded`).
3. Owner with a second workspace created during the trial: the second workspace is never eligible (Task 1 test `second_workspace_same_person_not_eligible`).
4. Last-day card add (2h left): Stripe `trial_end` is now + 48h, not the past (Task 6 test `trial_end_floor_48h`).
5. A Free workspace with a stored Hub session hitting a paused workspace: 403 `hub_paused`, session not cleared (Task 8 test `paused_keeps_session`).

---

### Task 1: Schema, eligibility and start

**Files:**
- Create: `supabase/migrations/20261130000001_reverse_trial.sql`
- Test: `supabase/tests/entitlements/70_reverse_trial.sql`

**Interfaces:**
- Produces: columns `workspaces.reverse_trial_started_at|ends_at|plan_id|ended_at|outcome|card_added_at`, `profiles.reverse_trial_used_at`; table `platform_settings(key text primary key, value jsonb)` row `reverse_trial_enabled = false` (reuse an existing settings table if the builder finds one); `reverse_trial_eligible(p_workspace uuid, p_user uuid) returns boolean` (service_role + used internally); `start_reverse_trial() returns jsonb` (`authenticated`; `{started: bool, ends_at timestamptz, reason?: 'not_eligible'|'disabled'}`, active workspace from `get_my_conta_id()`).

- [ ] **Step 1: Write the failing SQL suite** with cases: `new_owner_eligible`, `invited_member_not_eligible`, `manual_comp_not_eligible`, `demo_not_eligible`, `ever_subscribed_not_eligible` (each of the four `paid_ws` arms), `second_workspace_same_person_not_eligible`, `disabled_switch_returns_disabled`, `start_sets_plan_pro_source_trial_ends_14d`, `start_is_idempotent` (second call returns same `ends_at`), `start_stamps_profile_and_offer_seen`, `owner_cannot_update_reverse_trial_columns` (direct UPDATE as authenticated fails or is a no-op). Use `_helpers.sql` and `et_grant_hosted_parity()`.
- [ ] **Step 2: Run** `bash scripts/test-entitlements.sh 70_reverse_trial` — expect FAIL (functions missing).
- [ ] **Step 3: Write the migration**: columns, outcome check, `'trial'` added to `workspaces_plan_source_check` (copy the constraint list from `20261030000001`), settings row, both functions with a `for update` lock on the workspace in `start_reverse_trial`, grants. Confirm the owner can still `select` the new columns (no column allowlist on `workspaces`).
- [ ] **Step 4: Run** the suite — expect PASS.
- [ ] **Step 5: Commit** `feat(billing): schema e início do teste reverso`.

### Task 2: Convert, end and Hub pause in SQL

**Files:**
- Modify: `supabase/migrations/20261130000001_reverse_trial.sql`
- Test: `supabase/tests/entitlements/70_reverse_trial.sql`

**Interfaces:**
- Produces (service_role only): `convert_reverse_trial(p_workspace uuid, p_plan text, p_source text) returns text` (`'converted' | 'rewritten_late' | 'not_trial'`); `end_reverse_trial(p_workspace uuid, p_outcome text default 'downgraded') returns boolean` (false when a paid sub is in force or not a trial); `mark_reverse_trial_unpaid(p_workspace uuid) returns boolean` (converted-but-never-paid → `downgraded`, `ended_at = now()`); `hub_workspace_paused(p_conta uuid) returns boolean` (`outcome = 'downgraded'` and `now() >= ended_at + interval '7 days'` and effective plan is the default plan); `grant_pagarme_plan` branches to `convert_reverse_trial` when the workspace is `trial` or `downgraded`-from-trial.

- [ ] **Step 1: Add failing cases**: `convert_from_trial`, `late_convert_after_downgrade` (outcome rewritten to `converted`, `hub_workspace_paused` false), `end_noop_when_paid_sub_active`, `end_sets_system_free_downgraded`, `end_by_admin_no_pause`, `pause_false_before_7_days`, `pause_true_after_7_days`, `pause_false_after_upgrade`, `unpaid_conversion_marked_downgraded`, `grant_pagarme_converts_trial`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the four functions and the `grant_pagarme_plan` branch, all locking the workspace row; "paid sub in force" = `workspace_subscriptions.status in ('active','trialing')` with a provider subscription id.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(billing): conversão e fim do teste reverso com lock`.

### Task 3: Read-only Financeiro and Contratos in the database

**Files:**
- Modify: `supabase/migrations/20261130000001_reverse_trial.sql`
- Test: `supabase/tests/entitlements/70_reverse_trial.sql`

**Interfaces:**
- Produces: `enforce_plan_feature` triggers `before update or delete` (in addition to the insert ones) on `transacoes`, `contratos` and every other table the Financeiro v1 and Contratos screens write (builder lists them from `apps/crm/src/store/` and the pages; record the list in the migration comment).

- [ ] **Step 1: Add failing cases**: `free_workspace_cannot_update_contrato`, `free_workspace_cannot_delete_transacao`, `pro_workspace_can_update_contrato`, `free_workspace_can_select_contratos`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the triggers (reuse `enforce_plan_feature('feature_contracts'|'feature_financial', 'direct', 'conta_id')`; for DELETE use `OLD` — add a variant or extend the function to read `OLD` when `TG_OP = 'DELETE'`).
- [ ] **Step 4: Run** the whole entitlements suite (`bash scripts/test-entitlements.sh`) — expect PASS, including existing financeiro suites.
- [ ] **Step 5: Commit** `feat(billing): financeiro e contratos só leitura sem o plano`.

### Task 4: RPCs that bucket by plan

**Files:**
- Modify: `supabase/migrations/20261130000001_reverse_trial.sql` (redefine `get_nurture_candidates`, Loops RPCs from `20260803000004`, Crisp RPC from `20260804000011`, `admin_list_workspaces` from `20261127000001`, `get_trial_reminder_candidates` only if needed)
- Test: `supabase/tests/entitlements/70_reverse_trial.sql`, `supabase/tests/entitlements/69_admin_list_workspaces_snapshot.sql`

**Interfaces:**
- Produces: nurture excludes `plan_source = 'trial'` and returns a new column `ex_reverse_trial boolean`; Loops/Crisp payloads gain `reverse_trial_ends_at` and treat `trial` as its own segment; `admin_list_workspaces` returns `reverse_trial_ends_at`, `reverse_trial_outcome` and accepts `p_status = 'teste_sem_cartao'`.

- [ ] **Step 1: Add failing cases**: `nurture_skips_running_trial`, `nurture_flags_ex_trial`, `admin_list_filter_teste_sem_cartao`; update the snapshot.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Redefine** each function from its latest body (copy, then change; never from an older version).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(billing): nurture, loops, crisp e admin conhecem o teste reverso`.

### Task 5: Plan writer and webhooks

**Files:**
- Modify: `supabase/functions/_shared/plan-writer.ts`, `supabase/functions/stripe-webhook/index.ts`, `supabase/functions/pagarme-subscription/handler.ts`, `supabase/functions/pagarme-checkout/handler.ts` (~170, ~620)
- Test: `supabase/functions/__tests__/plan-writer_test.ts`

**Interfaces:**
- Consumes: Task 2 SQL functions.
- Produces: `writeWorkspacePlan(svc, ws, planId, source, kind)` unchanged signature; reads `plan_source, reverse_trial_outcome, reverse_trial_card_added_at`; `subscribed` on `trial` or downgraded-trial → `rpc('convert_reverse_trial')`; `fallback` on `trial` → no-op; `fallback` when `outcome = 'converted'` and the subscription never paid → write default plan then `rpc('mark_reverse_trial_unpaid')`. "Never paid" = no `ever_subscribed_at`-style first-payment marker; builder picks the existing field that the webhooks set on first `invoice.paid` / Pagar.me first charge and names it here in the PR.

- [ ] **Step 1: Write failing tests**: `subscribed_on_trial_calls_convert`, `fallback_on_trial_is_noop`, `fallback_on_never_paid_trial_conversion_marks_downgraded`, `fallback_on_paid_customer_unchanged`, `manual_still_never_overridden`.
- [ ] **Step 2: Run** `deno test supabase/functions/__tests__/plan-writer_test.ts --no-check` — expect FAIL.
- [ ] **Step 3: Implement**; in `pagarme-checkout` treat `trial` like Free for the switch gate.
- [ ] **Step 4: Run** the test, then `npm run check:functions` — expect PASS.
- [ ] **Step 5: Commit** `feat(billing): webhooks convertem o teste reverso`.

### Task 6: Checkout dates

**Files:**
- Modify: `supabase/functions/_shared/billing-logic.ts`, `supabase/functions/billing-checkout/index.ts`, `supabase/functions/pagarme-checkout/handler.ts`, `supabase/functions/pagarme-checkout/logic.ts`
- Test: `supabase/functions/__tests__/billing-logic_test.ts` (create if absent), `supabase/functions/__tests__/pagarme-checkout-logic_test.ts` (existing name may differ; add to it)

**Interfaces:**
- Produces: `resolveCheckoutTrial(ws: {plan_source, reverse_trial_ends_at, reverse_trial_started_at}, sub, now: Date): { kind: 'reverse', trialEnd: Date } | { kind: 'days', days: 30 } | { kind: 'none' }`; `hasEverSubscribed` also true when `reverse_trial_started_at` is set.

- [ ] **Step 1: Failing tests**: `reverse_trial_uses_trial_end`, `trial_end_floor_48h` (ends in 2h → now + 48h), `after_reverse_trial_no_trial`, `never_trialed_gets_30_days`, `pagarme_start_at_is_trial_end_date`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement**; `billing-checkout` sends `subscription_data.trial_end` (unix seconds) for `reverse`, `trial_period_days` for `days`; select the new workspace columns. Verify the 48h minimum in Stripe docs and note the link in the commit body.
- [ ] **Step 4: Run** tests and `npm run check:functions` — expect PASS.
- [ ] **Step 5: Commit** `feat(billing): checkout cobra no fim do teste reverso`.

### Task 7: `reverse-trial-cron`

**Files:**
- Create: `supabase/functions/reverse-trial-cron/index.ts`, `supabase/functions/reverse-trial-cron/handler.ts`, `supabase/migrations/20261130000002_reverse_trial_cron.sql`
- Test: `supabase/functions/__tests__/reverse-trial-cron-handler_test.ts`

**Interfaces:**
- Consumes: `end_reverse_trial`.
- Produces: `runReverseTrialCron(deps: { db, now, capture }): Promise<{ ended: number; skipped: number; errors: string[] }>`; per-row errors pushed, loop continues; `capturePostHog('reverse_trial_ended', {outcome:'downgraded'})` best-effort; `reportCronFailure` on errors; registered in `cron-health-cron`'s list; schedule `*/15 * * * *` via vault secret as other crons.

- [ ] **Step 1: Failing tests**: `ends_expired_trials`, `skips_future_trials`, `one_failure_does_not_stop_batch`, `rejects_missing_cron_secret`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** following `billing-downgrade-cron/index.ts` (bounded fetch, triage, generic errors).
- [ ] **Step 4: Run** tests and `npm run check:functions` — expect PASS.
- [ ] **Step 5: Commit** `feat(billing): cron que encerra o teste reverso`.

### Task 8: Hub pause

**Files:**
- Modify: `supabase/functions/_shared/hub-token.ts`, `supabase/functions/hub-auth/handler.ts`, `supabase/functions/hub-bootstrap/*`, every caller of `resolveHubToken` (grep), `apps/hub/src/router.tsx`, `apps/hub/src/api.ts`
- Create: `apps/hub/src/pages/PortalPausado.tsx`
- Test: `supabase/functions/__tests__/hub-token_test.ts`, `hub-access_test.ts`, `hub-access-structural_test.ts`, `apps/hub/src/__tests__/PortalPausado.test.tsx`

**Interfaces:**
- Consumes: `hub_workspace_paused`.
- Produces: `resolveHubToken(...): Promise<{ ok: true; token: HubToken } | { ok: false; reason: 'invalid' | 'paused' }>`; `HubAccess` failure reasons gain `'paused'`; `hubAccessDenied('paused', ctx)` → 403 `{ code: 'hub_paused', agency_name }`; Hub API client maps `hub_paused` to a `HubPausedError` the router renders as `PortalPausado`.

- [ ] **Step 1: Failing tests**: `paused_workspace_returns_paused` (token found, paused true → `reason:'paused'` before feature gate), `invalid_token_still_invalid`, `hub_auth_paused_returns_hub_paused`, `paused_keeps_session` (response has no session-clearing header/body), structural test still passes; Hub: `renders_agency_name_no_plan_words` (no "plano", "pagamento", "Free").
- [ ] **Step 2: Run** `deno test supabase/functions/__tests__/hub-*_test.ts --no-check` and `npx vitest run apps/hub/src/__tests__/PortalPausado.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement**; copy: title "Este portal está pausado", body "Fale com {agência} para voltar a acessar suas aprovações, posts e materiais.", note "Nada foi perdido. Quando a agência reativar o portal, este mesmo link volta a funcionar." Fire `hub_paused_viewed` with no identifiers.
- [ ] **Step 4: Run** tests, `npm run check:functions`, `npx tsc -p apps/hub/tsconfig.json --noEmit` — expect PASS.
- [ ] **Step 5: Commit** `feat(hub): portal pausado depois do teste reverso`.

### Task 9: Stop automatic DM replies off-plan

**Files:**
- Modify: `supabase/functions/instagram-webhook/*` (send path), `supabase/functions/instagram-automation-cron/handler.ts`
- Test: `supabase/functions/__tests__/instagram-automation-*_test.ts` (add to the existing suite)

**Interfaces:**
- Consumes: `effectivePlanFeature(db, contaId, 'feature_instagram_automation')` from `_shared/entitlements-rpc.ts`.

- [ ] **Step 1: Failing tests**: `webhook_skips_send_when_feature_off`, `cron_skips_workspace_when_feature_off`, `rules_untouched_when_feature_off`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the check right before each send; log at info, no error.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(instagram): respostas automáticas param sem o plano`.
- [ ] **Step 6: Audit note** — in the PR description list TikTok sync, scheduled automations and briefing transcription and what each does off-plan today (no code change).

### Task 10: Emails

**Files:**
- Modify: `supabase/functions/_shared/lifecycle-emails.ts`, `supabase/functions/_shared/nurture-emails.ts`, `supabase/functions/_shared/email-classify.ts`, `supabase/functions/lifecycle-email-cron/handler.ts`; migration from Task 1 gains `get_reverse_trial_email_candidates(p_now timestamptz)` (service_role)
- Test: `supabase/functions/__tests__/lifecycle-emails_test.ts`, `lifecycle-email-cron_test.ts`, nurture tests

**Interfaces:**
- Produces: `email_type`s `reverse_trial_ending` (3 days before end, running trial), `reverse_trial_ended` (outcome downgraded, not yet sent for this `ended_at`), `reverse_trial_hub_pausing` (day before pause, workspace has active Hub tokens); idempotency `reverse_trial/<type>/<ws>/<ends_at|ended_at>`; welcome email variant for `plan_source = 'trial'`; nurture a3 variant "Recupere o Pro" when `ex_reverse_trial`; trial-reminder cutoff logs info when the workspace has `reverse_trial_card_added_at`.

- [ ] **Step 1: Failing tests**: one builder test per email (subject, date in pt-BR, add-card link to `/configuracao/cobranca`, no em dash), `ended_email_states_pause_date`, `hub_pausing_only_with_tokens`, `welcome_trial_variant_no_30_dias`, `nurture_a3_ex_trial_variant`, `skip_ended_email_after_late_convert`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** using the existing ledger claim/deliver pattern and `tags` for `email-classify`.
- [ ] **Step 4: Run** tests and `npm run check:functions` — expect PASS.
- [ ] **Step 5: Commit** `feat(email): e-mails do teste reverso`.

### Task 11: CRM data layer

**Files:**
- Modify: `apps/crm/src/services/billing.ts`, `apps/crm/src/pages/configuracao/cobranca/plan-display.ts`
- Create: `apps/crm/src/lib/reverseTrial.ts`
- Test: `apps/crm/src/services/__tests__/billing.test.ts`, `apps/crm/src/lib/__tests__/reverseTrial.test.ts`

**Interfaces:**
- Produces: `EffectivePlan` gains `reverseTrial: { startedAt: string|null; endsAt: string|null; endedAt: string|null; outcome: 'converted'|'downgraded'|'ended_by_admin'|null; cardAddedAt: string|null }`; `startReverseTrial(): Promise<{ started: boolean; endsAt: string | null; reason?: 'not_eligible' | 'disabled' }>`; `getReverseTrialEnabled(): Promise<boolean>`; `reverseTrialPhase(now: Date, endsAt: string): { phase: 'normal'|'ending'|'last_day'|'ended'; daysLeft: number }` (normal ≥4 days, ending 1–3, last_day same São Paulo date, rounding down); `hubPauseDate(endedAt: string): Date`; `hasUsedTrial` true when `reverseTrial.startedAt`.

- [ ] **Step 1: Failing tests**: `phase_normal_10_days`, `phase_ending_3_days`, `phase_last_day_sao_paulo` (23:30 UTC case), `days_left_monotonic`, `hasUsedTrial_true_after_reverse_trial`, `fetchEffectivePlan_maps_columns`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/lib/__tests__/reverseTrial.test.ts apps/crm/src/services/__tests__/billing.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; use `date-fns`/`dayjs` per repo rule; update every test fixture of `EffectivePlan` (grep both `__tests__` trees).
- [ ] **Step 4: Run** tests and `npx tsc -p apps/crm/tsconfig.json --noEmit` — expect PASS.
- [ ] **Step 5: Commit** `feat(crm): estado do teste reverso no serviço de cobrança`.

### Task 12: Start path and welcome

**Files:**
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx`, `apps/crm/src/components/layout/useTrialOfferRedirect.ts`
- Create: `apps/crm/src/components/layout/useReverseTrialStart.ts`, `apps/crm/src/components/billing/ReverseTrialWelcomeDialog.tsx`
- Test: `apps/crm/src/components/layout/__tests__/useReverseTrialStart.test.tsx`, `useTrialOfferRedirect.test.tsx`

**Interfaces:**
- Consumes: Task 11.
- Produces: `useReverseTrialStart(pathname): { pending: boolean }` — owner, switch on, workspace eligible-looking (Free, no `reverseTrial.startedAt`): calls `startReverseTrial` once per mount, invalidates `['billing']`, opens the welcome dialog on `started`; runs on native too; never blocks rendering for more than the existing `pending` contract; error → no retry this mount. `useTrialOfferRedirect` returns no redirect when the switch is on.

- [ ] **Step 1: Failing tests**: `starts_once_for_new_owner`, `runs_on_native`, `agent_never_starts`, `not_eligible_falls_back_to_offer_logic`, `rpc_error_no_loop`, `redirect_off_when_switch_on`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement**; dialog copy "Seu workspace está no Pro por 14 dias" + end date + "Sem cartão. No fim, você escolhe se continua."; native: same text, no CTA. Fire `reverse_trial_started {source:'signup'}`.
- [ ] **Step 4: Run** tests — expect PASS.
- [ ] **Step 5: Commit** `feat(crm): teste reverso começa no primeiro acesso`.

### Task 13: Countdown banner, end-of-trial prompt, Cobrança, nudge card

**Files:**
- Create: `apps/crm/src/components/billing/ReverseTrialBanner.tsx`, `apps/crm/src/components/billing/ReverseTrialEndDialog.tsx`
- Modify: `apps/crm/src/components/layout/AppLayout.tsx` (mount point per shell), `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`, `CobrancaPhone.tsx`, `apps/crm/src/components/billing/TrialNudgeCard.tsx`, `apps/crm/src/pages/comecar/ComecarPage.tsx`, `apps/crm/app.css`
- Test: `__tests__` beside each component

**Interfaces:**
- Consumes: `reverseTrialPhase`, `startReverseTrial`, existing `beginCheckout`.
- Produces: banner copy exactly as spec Part 3 for each phase; dismiss (normal phase only) in `sessionStorage` with try/catch; end dialog once per session in `ending`/`last_day`, owner only; "Adicionar cartão" opens `/comecar?plan=pro&interval=month&from=reverse_trial`; `TrialNudgeCard` opt-in copy "Teste o Pro por 14 dias, sem cartão" calling `startReverseTrial` (`source:'nudge'`); `/comecar` copy per Part 2; events `reverse_trial_banner_viewed` (once/day), `reverse_trial_add_card_clicked {surface}`, `checkout_started` + `reverse_trial`, `days_left`.

- [ ] **Step 1: Failing tests**: `banner_normal_copy_and_dismiss`, `banner_ending_not_dismissible`, `banner_card_added_shows_amount_date`, `banner_hidden_for_agent`, `banner_native_no_button_no_price`, `end_dialog_once_per_session`, `end_dialog_never_on_native`, `nudge_starts_trial`, `comecar_copy_during_trial_says_charge_on_end_date`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** matching the mockups; CSS in `app.css` (signed-in only), fixed elements follow the shell rules in `DESIGN_SYSTEM.md`.
- [ ] **Step 4: Run** tests, `npx tsc -p apps/crm/tsconfig.json --noEmit`; verify in the Browser pane (desktop, phone shell, dark mode) with a seed workspace in a trial.
- [ ] **Step 5: Commit** `feat(crm): banner e aviso de fim do teste reverso`.

### Task 14: Downgrade state and read-only modules

**Files:**
- Create: `apps/crm/src/components/billing/ReverseTrialEndedBanner.tsx`, `ReverseTrialEndedDialog.tsx`, `apps/crm/src/components/paywall/useReadOnlyGrandfather.ts`
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx` (route gate), Financeiro and Contratos pages/components that render create/edit/delete actions
- Test: beside each

**Interfaces:**
- Produces: `useReadOnlyGrandfather(flag: 'feature_financial'|'feature_contracts'): boolean` — true when the flag is off and `reverseTrial.outcome === 'downgraded'`; `ProtectedRoute` renders the page (not `UpgradeLockedScreen`) when true; pages hide every mutating control and show "Só para consulta no Free. Recupere o Pro para editar."; downgrade banner and one-time dialog copy per spec Part 5, counts from existing usage queries (`useWorkspaceLimits`).

- [ ] **Step 1: Failing tests**: `financeiro_read_only_for_ex_trial`, `financeiro_locked_for_other_free`, `contratos_no_mutating_controls`, `ended_banner_shows_pause_date_then_paused`, `ended_dialog_once`, `ended_native_text_only`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** tests and typecheck; verify in the Browser pane with a seed ex-trial workspace.
- [ ] **Step 5: Commit** `feat(crm): estado depois do teste e módulos só leitura`.

### Task 15: Admin

**Files:**
- Modify: `supabase/functions/platform-admin/index.ts`, `workspace-detail.ts`, `revert-target.ts`; `apps/admin/src/lib/api.ts`, `apps/admin/src/pages/workspaces/WorkspacesTable.tsx`, `WorkspacesPhone.tsx`, `apps/admin/src/pages/workspace-detail/*`, Admin dashboard page
- Test: `supabase/functions/__tests__/platform-admin-*_test.ts`, `apps/admin/src/pages/__tests__/*`

**Interfaces:**
- Produces: actions `extend-reverse-trial {workspace_id, ends_at}` (only while `plan_source='trial'`, `ends_at` in the future, at most 30 days after start) and `end-reverse-trial {workspace_id}` (→ `end_reverse_trial(ws,'ended_by_admin')`); comp on a trial workspace ends it with `ended_by_admin`; revert never restores `trial`; list/detail show "Teste Pro sem cartão até {data}" and the filter; dashboard funnel card from the columns (started, activated by day 7, card added, paid, downgraded).

- [ ] **Step 1: Failing tests**: `extend_refused_after_conversion`, `extend_refused_when_ended`, `end_now_sets_ended_by_admin`, `comp_ends_trial`, `revert_never_restores_trial`, Admin UI `shows_trial_badge_and_filter`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement**; audit log via `insertAuditLog`.
- [ ] **Step 4: Run** tests, `npx tsc -p apps/admin/tsconfig.json --noEmit` — expect PASS.
- [ ] **Step 5: Commit** `feat(admin): ver e gerenciar o teste reverso`.

### Task 16: Public copy and terms (ships last)

**Files:**
- Modify: files in spec Part 7 (`content/landing.content.ts`, `pages/landing/PricingSection.tsx`, `LandingPage.tsx`, `content/precos.content.ts`, `content/site-meta.ts`, `pages/marketing/MarketingPage.tsx`, `pages/termos-de-uso/TermosPage.tsx`) and their tests; `CLAUDE.md` (Gotchas entry: deploy order, kill switch, copy rule)

- [ ] **Step 1: Update tests** that pin the old copy to the new strings ("14 dias de Pro grátis, sem cartão").
- [ ] **Step 2: Run** `npm run test` — expect FAIL on the pinned strings.
- [ ] **Step 3: Change the copy**; Termos clause per spec Part 7, marked in the PR as waiting for the product owner's approval.
- [ ] **Step 4: Run** `npm run test`, `npm run build`, `npm run prerender` — expect PASS and `dist/index.html` with `data-ssr="landing"`.
- [ ] **Step 5: Commit** `feat(site): copy do teste de 14 dias sem cartão`. This commit deploys only after the kill switch is on (spec deploy step 5); keep it as the last commit or a follow-up PR.

### Task 17: Full verification

- [ ] Run every command in Global Constraints' "Before pushing" line; all green.
- [ ] Staging: apply migrations, deploy functions in spec order, switch on, sign up a fresh owner, confirm Pro + banner; set `reverse_trial_ends_at` to the past, run the cron, confirm Free + downgrade dialog + read-only Financeiro; set `ended_at` 8 days back, open a Hub link, confirm "Este portal está pausado".
- [ ] Record what could not be verified (Stripe live trial_end, real iPhone) in the PR description.
