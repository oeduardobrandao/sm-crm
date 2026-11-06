# Conta demo criada pelo Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A platform admin creates a free, pre-filled demo workspace for an e-mail on a chosen plan, the person gets a "conta pronta" e-mail, and the demo converts to paid (no trial) on the first payment.

**Architecture:** One new `platform-admin` action orchestrates: Auth `generateLink` (fires the existing fresh-signup trigger) → set `plan_source='demo'` → one atomic SQL seed function → audit → Resend e-mail. Billing learns the `demo` source in both plan writers (TS `writeWorkspacePlan`, SQL `grant_pagarme_plan`) and a permanent `workspaces.demo_created_at` marker kills the trial in both checkouts and in the CRM. Admin gets the dialog, badges, affiliate edit and "Reenviar acesso"; the CRM gets an "Assinar" CTA on the current plan and a discreet demo note.

**Tech Stack:** Postgres migrations + psql suites (`scripts/test-entitlements.sh`), Deno edge functions (`deno test`), React 19 + Vitest (Admin, CRM).

**Spec:** `docs/superpowers/specs/2026-10-26-conta-demo-admin-design.md` (read it; this plan does not repeat its rationale).

## Global Constraints

- All user-facing copy in Portuguese, **no em-dashes** (use period or colon).
- Edge functions: never return raw error details; CORS via `buildCorsHeaders(req)`; detailed errors only in `console.error`.
- New SQL functions callable by `service_role` only: `revoke all ... from public, anon, authenticated; grant execute ... to service_role;` (name the roles explicitly).
- Migration versions must be unique and above `origin/main`'s tail at PR time (today `20261029000003`). This plan uses `20261030000001` and `20261030000002`; renumber if main moved.
- Example data: every record name ends in `(exemplo)`; e-mails on `.example`; no phone numbers; no `valor_mensal`/`data_pagamento`/`custo_mensal`.
- Post statuses only `rascunho`, `revisao_interna`, `enviado_cliente`, `aprovado_cliente`. Never `agendado`, `postado`, `falha_publicacao`.
- Demo plan picker/validation: exclude the default plan and internal plans (`isInternalPlan`, e.g. `lifetime`).
- Never use `useBlocker`; modal dialogs use the existing `DialogContent` (`confirmClose` covers unsaved work).
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` projects, `npm run test`, `npm run check:functions`, `npm run test:functions`, and `bash scripts/test-entitlements.sh` (needs local Supabase).

## Review Focus

1. **Admin double-clicks "Criar e enviar acesso"** (two concurrent requests, same e-mail): exactly one account; the other gets the 409 message, never a 500. Test in Task 6 (`createDemoWorkspace maps Auth duplicate-user error to 409`) and Task 8 (button disabled while pending).
2. **E-mail typed with capitals/spaces** (`" Ana@Gmail.com "`) or an existing account under different case: normalised before both the existence check and `generateLink`. Test in Task 6.
3. **Plan without leads/ideas/Agenda or with `max_posts_per_workflow` < 4**: seed omits/trims, never fails, e-mail lists only what exists. Tests in Task 2 and Task 5.
4. **Stripe `incomplete_expired` / `canceled` (or Pagar.me `canceled`) on a demo that never paid**: demo stays on its plan. Tests in Task 1 (SQL) and Task 3 (TS).
5. **Admin later moves an ex-demo to Free or a comp**: no trial anywhere (backend checkout and CRM `/comecar`, Cobrança, `TrialNudgeCard`). Tests in Task 4 and Task 9.

---

### Task 0: Sync the branch

- [ ] **Step 1:** Bring the branch up to date with `main` (use the ccd_host `sync_with_base_branch` tool; the branch is one commit behind, #745).
- [ ] **Step 2:** `git log --oneline -1 origin/main` and `ls supabase/migrations | tail -1`; if the tail is ≥ `20261030000001`, pick the next free versions for Tasks 1 and 2 and use them everywhere below.

### Task 1: Schema migration (demo source, marker, Pagar.me writer, list RPC)

**Files:**
- Create: `supabase/migrations/20261030000001_demo_workspace_schema.sql`
- Create: `supabase/tests/entitlements/99_demo_workspace_schema.sql`

**Interfaces:**
- Produces: `workspaces.plan_source` accepts `'demo'`; `workspaces.demo_created_at timestamptz null`; `workspaces.demo_created_by uuid null references auth.users(id) on delete set null`; `grant_pagarme_plan(uuid,text,text,text)` same signature with demo rule; `admin_list_workspaces(...)` same signature, each workspace object gains `'plan_source'`.

- [ ] **Step 1: Write the failing psql suite** `99_demo_workspace_schema.sql` (style of `99_workspace_slug_unaccent.sql`: `\i _helpers.sql`, each case in `begin; do $$ ... $$; rollback;`, `raise exception` on failure). Cases:
  - `99d-1` updating a workspace to `plan_source='demo'` succeeds; `'bogus'` still fails the check.
  - `99d-2` `grant_pagarme_plan` on a demo workspace with a pagarme sub row in status `active` writes the plan, returns 1, sets `plan_source='pagarme'`, `demo_created_at` unchanged.
  - `99d-3` same with status `canceled` returns 0 and leaves `plan_id` + `plan_source='demo'`.
  - `99d-4` `manual` still returns 0 for `active` (regression).
  - `99d-5` `admin_list_workspaces(...)` JSON for a demo workspace has `plan_source = 'demo'`.
- [ ] **Step 2:** Run `bash scripts/test-entitlements.sh` → `99_demo_workspace_schema.sql` FAILS.
- [ ] **Step 3: Write the migration.**
  - Drop/re-add the `plan_source` check (constraint name from `20260812000001_pagarme_provider.sql:35`) with `('system','stripe','manual','pagarme','demo')`.
  - Add the two columns.
  - `create or replace function public.grant_pagarme_plan` copied from `20260813000002`, with the update guard becoming `w.plan_source is distinct from 'manual' and not (w.plan_source = 'demo' and p_status not in ('active','trialing'))`. Re-apply its revoke/grant.
  - `create or replace` `admin_list_workspaces` copied from the latest definition (`20260912000001_admin_list_workspaces_instagram_accounts.sql`), adding `w.plan_source` to the `base` CTE's column list (next to `plan_name`, ~line 36; the later CTEs carry it via `b.*`/`p.*`) AND `'plan_source', p.plan_source` next to `'plan_name'` in the per-workspace jsonb object. Keep its grants.
- [ ] **Step 4:** `npx supabase db reset` locally (or apply the file), rerun the suite → PASS; whole script green.
- [ ] **Step 5: Commit** `feat(db): plan_source demo, demo marker, demo-aware grant_pagarme_plan`.

### Task 2: Seed and discard SQL functions

**Files:**
- Create: `supabase/migrations/20261030000002_demo_workspace_seed.sql`
- Create: `supabase/tests/entitlements/99_demo_workspace_seed.sql`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces:
  - `public.demo_workspace_seed(p_conta uuid, p_owner uuid) returns jsonb`, returning `{"membros":int,"clientes":int,"workflows":int,"posts":int,"ideias":int,"leads":int,"eventos":int}`.
  - `public.demo_workspace_discard(p_conta uuid) returns void` (does not touch `auth.users`).

- [ ] **Step 1: Write the failing suite.** Fixture: insert an `auth.users` row with `raw_user_meta_data = {"empresa":"Agência Teste"}` (fires the fresh-signup trigger, see `93_default_workflow_template_seed.sql`), set the workspace's `plan_id` to a paid plan with every feature and `plan_source='demo'`. Cases:
  - `99s-1` full plan: returns counts `membros 1, clientes 1, workflows 1, posts 4, ideias 3, leads 3, eventos 1`; table counts match; every `clientes.nome`, `membros.nome`, `leads.nome`, `workflows.titulo` ends with `(exemplo)`; no `workflow_posts.status` in `('agendado','postado','falha_publicacao')`; the Mídia etapa is `ativo` with `responsavel_id` = Camila's `membros.id`; `agenda_ocorrencias` has ≥1 row for the event.
  - `99s-2` plan overrides `feature_leads=false, feature_ideas=false, feature_agenda=false`: returns `leads 0, ideias 0, eventos 0`, no error.
  - `99s-3` override `max_posts_per_workflow=2`: returns `posts 2`.
  - `99s-4` `demo_workspace_discard(conta)` after a seed, followed by `delete from auth.users where id = v_uid` (must succeed: this is the FK path the TS rollback's `deleteUser` depends on, see #616), leaves zero rows with that `conta_id`/`workspace_id` in: `agenda_ocorrencias`, `agenda_eventos`, `workflow_posts`, `workflow_etapas` (via workflows), `workflows`, `workflow_templates`, `ideias`, `leads`, `clientes`, `membros`, `workspace_plan_overrides`, `affiliate_referrals`, `workspace_members`, `profiles` (by `conta_id`), `workspaces`, `contas`.
  - `99s-5` both functions are not executable by `authenticated` (`has_function_privilege('authenticated', ..., 'execute') = false`).
- [ ] **Step 2:** Run the script → FAIL.
- [ ] **Step 3: Write `demo_workspace_seed`** (`security definer`, `set search_path = public`), content exactly per the spec's §4 table. Decisions:
  - Read features with `public.effective_plan_feature(p_conta, 'feature_leads' | 'feature_ideas' | 'feature_agenda')`; read limits with the existing effective-limit function (the one `trg_limit_posts` uses) for posts per workflow; trim the post list from the end (keep order carrossel, reels, feed, stories).
  - Workflow from the trigger's "Padrão" template of `p_conta`: etapas Copy + Aprovação da Copy `concluido`, Mídia `ativo` (`iniciado_em = now()`, `responsavel_id` = Camila), the rest `pendente`; `etapa_atual` pointing at Mídia.
  - Posts: statuses carrossel `rascunho`, reels `revisao_interna`, feed `enviado_cliente`, stories `aprovado_cliente`; planned dates `now() + 2, 5, 9, 12 days`; `platform 'instagram'`; captions Portuguese, no em-dashes.
  - Event: `dtstart` = next business day after tomorrow 10:00 local, `duracao_min 60`, `tz 'America/Sao_Paulo'`, `organizador_id = p_owner`, no participants; then `perform agenda_materializar(<id>, current_date + 90)` (signature is `(bigint, date)`; a timestamptz argument does not resolve).
  - `workflow_posts`: find the current DDL first (the table is not in the baseline; status CHECK in `20260427000001_instagram_publishing.sql:17`, `platform` in `20261010100002_post_targets.sql:60`, `cliente_id` NOT NULL since `20260830000001`); take the `tipo` CHECK values and the planned-date column name from there.
  - `user_id` columns = `p_owner`.
  - Before writing, read each insert trigger on these tables (`trg_limit_posts`, `trg_limit_posts_avulsos`, `workflow_posts_z6_seed_targets`, `z4b_platform_on_insert`, `trg_guard_clientes_valor`, `trg_guard_membros_custo`, `trg_financeiro_v2_*_legado`, and any `enviado_cliente`/`aprovado_cliente` notification trigger) and confirm none needs `auth.uid()` or sends anything when there is no hub token; if one does, note it in the commit message and set what it needs explicitly.
- [ ] **Step 4: Write `demo_workspace_discard`**: deletes in dependency order the tables listed in `99s-4`, child tables first. Revoke/grant both functions. Cascade-child lists cannot be trusted from a grep of migrations: drive the final list from `99s-4` failures (FK violations on the `workspaces`/`contas` delete name the missing table). `audit_log.conta_id` is `ON DELETE SET NULL`, so it needs no delete.
- [ ] **Step 5:** Run the script → PASS.
- [ ] **Step 6: Commit** `feat(db): demo_workspace_seed and demo_workspace_discard`.

### Task 3: Demo rules in `writeWorkspacePlan`

**Files:**
- Modify: `supabase/functions/_shared/plan-writer.ts`
- Modify: `supabase/functions/stripe-webhook/index.ts:291-293`
- Modify (call sites, explicit `"subscribed"`): `supabase/functions/pagarme-checkout/handler.ts:611,705`, `supabase/functions/pagarme-subscription/handler.ts:350`
- Create: `supabase/functions/__tests__/plan-writer_test.ts`

**Interfaces:**
- Produces: `writeWorkspacePlan(svc, workspaceId: string, planId: string, planSource: "stripe" | "pagarme", kind: "subscribed" | "fallback" = "subscribed"): Promise<void>`. Read selects `plan_source`; skip when `manual`; skip when `demo` and `kind === "fallback"`.

- [ ] **Step 1: Failing tests** with a fake svc recording the update (pattern from `platform-admin-workspace-overrides_test.ts`):
  - `writeWorkspacePlan replaces a demo on a subscribed write` → update `{plan_id, plan_source:'stripe'}`.
  - `writeWorkspacePlan skips a demo on a fallback write` → no update.
  - `writeWorkspacePlan still skips manual on a subscribed write`.
  - `writeWorkspacePlan writes system/stripe sources on a fallback write` (regression).
- [ ] **Step 2:** `deno test supabase/functions/__tests__/plan-writer_test.ts` → FAIL.
- [ ] **Step 3:** Implement. In `stripe-webhook` pass `kind = resolved && (sub.status === "active" || sub.status === "trialing") ? "subscribed" : "fallback"` (`resolved` from ~line 197: an unresolved price falls back to the default plan and must not end a demo).
- [ ] **Step 4:** Run the test, then `npm run check:functions` and `npm run test:functions` → PASS. (Restore `deno.lock` and run `npm ci` if they dirty it, per memory.)
- [ ] **Step 5: Commit** `feat(billing): a paid write ends a demo, a fallback write keeps it`.

### Task 4: No trial for ex-demos (backend)

**Files:**
- Modify: `supabase/functions/_shared/billing-logic.ts` (`hasEverSubscribed`)
- Modify: `supabase/functions/billing-checkout/index.ts` (~line 72-179)
- Modify: `supabase/functions/pagarme-checkout/handler.ts` (~line 349)
- Test: `supabase/functions/__tests__/billing-logic_test.ts`, `supabase/functions/__tests__/pagarme-checkout-handler_test.ts`

**Interfaces:**
- Produces: `hasEverSubscribed(row, workspace?: { demo_created_at?: string | null } | null): boolean` (true also when `workspace?.demo_created_at`).

- [ ] **Step 1: Failing tests:**
  - `hasEverSubscribed is true for a never-subscribed workspace with demo_created_at`.
  - `hasEverSubscribed is false with no row and no demo marker` (regression).
  - In `pagarme-checkout-handler_test.ts`: `a fresh (non-switch) checkout for an ex-demo workspace gets no trial` (drive the NON-switch path; assert the subscription request has no future `start_at` / trial).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Both checkouts read `workspaces.demo_created_at` for the workspace and call `hasEverSubscribed(row, ws)`. In `pagarme-checkout` do NOT reuse the `plan_id, plan_source` read at ~172-177: it sits inside `if (isSwitch) {` (opens ~131), and the trial at ~349 is only computed on the non-switch path. Add a separate `workspaces` read before step (4), outside the switch block. `billing-checkout` has no workspace read today: add one.
- [ ] **Step 4:** Run tests + `npm run check:functions` → PASS.
- [ ] **Step 5: Commit** `feat(billing): ex-demo workspaces never get the checkout trial`.

### Task 5: "Conta pronta" e-mail

**Files:**
- Modify: `supabase/functions/_shared/invite-email.ts`
- Test: `supabase/functions/__tests__/invite-email_test.ts`

**Interfaces:**
- Produces:
  - `type DemoSeedCounts = { membros: number; clientes: number; workflows: number; posts: number; ideias: number; leads: number; eventos: number }`
  - `buildDemoAccessEmail(p: { actionLink: string; nome: string | null; planName: string; counts: DemoSeedCounts }): string`
  - `sendDemoAccessEmail(p: { to: string; actionLink: string; nome: string | null; planName: string; counts: DemoSeedCounts }): Promise<void>` (Resend, from `Mesaas <convites@mesaas.com.br>`, subject `Sua conta Mesaas está pronta`, throws on non-2xx like `sendInviteEmail`).

- [ ] **Step 1: Failing tests:**
  - `buildDemoAccessEmail greets by name and names the plan` (contains `Olá, Ana.` and `plano Pro`).
  - `buildDemoAccessEmail without a name greets with "Olá."`.
  - `buildDemoAccessEmail lists only seeded examples` (counts with `leads 0, eventos 0` → no "evento na agenda" text, no "leads").
  - `buildDemoAccessEmail has the button and never says "convidado" or an em-dash`.
  - `buildDemoAccessEmail escapes the name` (`<b>` is escaped).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `mesaasEmail` + blocks (eyebrow `Conta demo`, heading `Sua conta Mesaas está pronta`, body from the spec §5 draft with the example list built from non-zero counts joined as "um cliente, posts, ideias e um evento na agenda", button `Definir minha senha`, `fallbackLink`, small line about link expiry consistent with `buildInviteEmail`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(email): conta demo pronta`.

### Task 6: `create-demo-workspace` and `resend-demo-access` actions

**Files:**
- Create: `supabase/functions/platform-admin/demo-workspace.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (dispatch cases)
- Create: `supabase/functions/__tests__/platform-admin-demo-workspace_test.ts`

**Interfaces:**
- Consumes: Task 2 RPCs, Task 5 `sendDemoAccessEmail`, `insertAuditLog`.
- There is no backend `isInternalPlan`. Add `DEMO_EXCLUDED_PLAN_IDS = new Set(["lifetime"])` in `demo-workspace.ts`, with a comment that it mirrors `INTERNAL_PLAN_IDS` in `apps/crm/src/pages/configuracao/cobranca/plan-display.ts:11`; the default plan is excluded by reading `plans.is_default`.
- Produces:
  - `validateDemoInput(body: unknown): { ok: true; email: string; planId: string; nome: string | null; empresa: string; refCode: string | null } | { ok: false; status: 400; error: string }` (trim+lowercase e-mail; blank `nome` → null; blank `empresa` → `"Minha agência"`; `refCode` trimmed+lowercased, must match `^[a-z0-9]{4,32}$` when present).
  - `interface DemoDeps { db: SupabaseClient; generateInviteLink(email: string, data: Record<string,string>, redirectTo: string): Promise<{ userId: string; actionLink: string }>; deleteUser(userId: string): Promise<void>; sendEmail: typeof sendDemoAccessEmail; redirectBase: string }`
  - `createDemoWorkspace(deps: DemoDeps, body: unknown, adminId: string): Promise<{ status: number; body: Record<string, unknown> }>`; success body `{ workspace_id, email, email_sent: boolean }`.
  - `resendDemoAccess(deps: DemoDeps, body: { workspace_id?: string }, adminId: string)`: owner of a workspace with `demo_created_at` and no password yet (reuse `user_has_password`/auth-state helper from `_shared/invite-actions.ts`) → `generateLink` type `recovery` → same e-mail; 409 `"O dono já definiu a senha."` otherwise.
  - Dispatcher: `case "create-demo-workspace"`, `case "resend-demo-access"` building real deps from the service client (`auth.admin.generateLink({ type: 'invite', email, options: { data, redirectTo } })`; fallback per spec if that does not create the user: `createUser` + `recovery`).

- [ ] **Step 1: Failing tests** (fake deps; assert calls and order):
  - `validateDemoInput normalises " Ana@Gmail.com "` → `ana@gmail.com`; blank empresa → `Minha agência`; blank nome → null.
  - `createDemoWorkspace rejects the default plan and internal plans with 400`.
  - `createDemoWorkspace returns 409 when an auth user already exists for the e-mail` (no generateLink call).
  - `createDemoWorkspace maps Auth duplicate-user error to 409` (generateLink fails with Supabase's `error.code === "email_exists"`, status 422; match the code, never the message text; no discard call).
  - `createDemoWorkspace rejects an unknown, inactive or self affiliate code with 400 before creating anything`.
  - `createDemoWorkspace sets plan_source demo and demo marker before seeding` (order: generateLink → workspaces update → seed RPC → affiliate insert → audit → sendEmail).
  - `createDemoWorkspace rolls back on seed failure` (seed RPC errors → `demo_workspace_discard` + `deleteUser` called, 500 body `Não foi possível criar a conta demo. Nada foi criado.`, no e-mail).
  - `createDemoWorkspace keeps the account when the e-mail fails` (sendEmail throws → 200 with `email_sent: false`, no discard).
  - `createDemoWorkspace audits admin-create-demo with email and plan_id`.
  - `resendDemoAccess refuses when the owner already has a password (409)` and `sends a recovery link otherwise`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. The `workspaces` update sets `plan_id`, `plan_source='demo'`, `demo_created_at=now()`, `demo_created_by=adminId`; then create or reset `workspace_plan_overrides` exactly as `handleSetWorkspacePlan` (`platform-admin/index.ts:426-469`) does. Affiliate: look up `affiliates` by code with `status='active'`; refuse if `affiliates.email = email`; insert `affiliate_referrals {workspace_id, affiliate_id, ref_code}` (never put `ref_code` in the Auth metadata). Rollback failure: `console.error("[platform-admin:create-demo] CRITICAL rollback failed", {userId, workspaceId})` and audit with `metadata.rollback_failed = true`.
- [ ] **Step 4:** Run + `npm run check:functions` → PASS.
- [ ] **Step 5: Commit** `feat(admin): create-demo-workspace and resend-demo-access`.

### Task 7: Affiliate on any workspace + detail payload

**Files:**
- Create: `supabase/functions/platform-admin/workspace-affiliate.ts`
- Modify: `supabase/functions/platform-admin/workspace-detail.ts`, `supabase/functions/platform-admin/index.ts`
- Test: `supabase/functions/__tests__/platform-admin-workspace-affiliate_test.ts`, `supabase/functions/__tests__/platform-admin-workspace-detail_test.ts`

**Interfaces:**
- Produces:
  - action `set-workspace-affiliate` body `{ workspace_id: string; ref_code: string | null }` → `{ affiliate: { id, name, code } | null }`; 400 `Código de afiliado não encontrado ou inativo.`; 400 on self-referral (owner e-mail = affiliate e-mail); audit `admin-set-affiliate` with `{ old_affiliate_id, new_affiliate_id }`.
  - `get-workspace` response gains `affiliate: { id: string; name: string; code: string } | null` and `workspace.demo_created_at: string | null`.
- [ ] **Step 1: Failing tests:** set (insert), change (update), clear (delete), unknown code 400, self 400, audit metadata; detail includes `affiliate` and `demo_created_at`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Never modify `affiliate_commissions`. The commission window is `sum(affiliate_commissions.covered_months)` per `workspace_id` (`_shared/affiliate-commission.ts:188-197`), so months already paid to the old affiliate keep counting against the window for the new one; that matches the spec, no extra work.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(admin): edit a workspace's affiliate`.

### Task 8: Admin UI

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (types + wrappers)
- Create: `apps/admin/src/pages/workspaces/CreateDemoDialog.tsx`
- Modify: `apps/admin/src/pages/workspaces/WorkspacesDesktop.tsx` (PageHeader `actions`), `apps/admin/src/pages/workspaces/WorkspacesPhone.tsx` (`phoneActions`), `apps/admin/src/pages/workspaces-columns.ts` (plan cell badge)
- Modify: `apps/admin/src/pages/workspace-detail/WorkspaceDetailDesktop.tsx:140`, `PanelsDesktop.tsx:128-131`, `WorkspaceDetailPhone.tsx:88` (Demo badge, affiliate row, "Reenviar acesso")
- Create: `apps/admin/src/pages/workspace-detail/AffiliateRow.tsx`
- Tests: `apps/admin/src/pages/__tests__/CreateDemoDialog.test.tsx`, `apps/admin/src/pages/__tests__/AffiliateRow.test.tsx`, extend the existing workspace list/detail tests for the badge.

**Interfaces:**
- Consumes: Tasks 6-7 actions.
- Produces in `api.ts`: `WorkspaceSummary.plan_source: string | null`; `WorkspaceDetail.workspace.demo_created_at?: string | null`; `WorkspaceDetail.affiliate?: { id: string; name: string; code: string } | null`; `createDemoWorkspace(p: { email: string; plan_id: string; nome?: string; empresa?: string; ref_code?: string }): Promise<{ workspace_id: string; email: string; email_sent: boolean }>`; `resendDemoAccess(workspaceId: string)`; `setWorkspaceAffiliate(workspaceId: string, refCode: string | null)`.

- [ ] **Step 1: Failing tests:**
  - `CreateDemoDialog lists only active, non-default, non-internal plans`.
  - `CreateDemoDialog requires a valid e-mail and a plan`.
  - `CreateDemoDialog disables submit while pending` (Review Focus 1).
  - `CreateDemoDialog shows the 409/400 message inline`.
  - `CreateDemoDialog on success toasts "Conta demo criada. O acesso foi enviado para ana@x.com." and navigates to the workspace`; with `email_sent:false` shows `Conta criada, mas o e-mail não foi enviado. Use Reenviar acesso.`.
  - `plan cell shows a Demo badge for plan_source demo and Comp for manual`.
  - `AffiliateRow shows the current affiliate and saves a new code / clears it`.
  - `workspace detail offers "Encerrar demo" for plan_source demo` (desktop and phone): the "Remover comp" control is gated on `plan_source === 'manual'` today (`WorkspaceDetailPhone.tsx:88`, same in Desktop); extend it to `'demo'` with the label `Encerrar demo`, calling the existing `unsetWorkspacePlan` (backend already handles demo).
- [ ] **Step 2:** `npx vitest run apps/admin/src/pages/__tests__/CreateDemoDialog.test.tsx apps/admin/src/pages/__tests__/AffiliateRow.test.tsx` → FAIL.
- [ ] **Step 3:** Implement with the Admin `components/ui` copies (import `cn` from `../../lib/utils`). Labels: `Criar conta demo`, `E-mail`, `Nome (opcional)`, `Nome da agência (opcional)`, `Plano`, `Código de afiliado (opcional)`, submit `Criar e enviar acesso`. Detail: `Demo` badge where `Comp` shows today; `Afiliado` row on every workspace; `Reenviar acesso` button only when `demo_created_at` is set.
- [ ] **Step 4:** Run tests + `npx tsc -p apps/admin/tsconfig.json --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(admin): Criar conta demo, Demo badge, afiliado do workspace`.

### Task 9: CRM: trial gate, "Assinar" on the current plan, demo note

**Files:**
- Modify: `apps/crm/src/services/billing.ts`
- Modify: `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx` (lines ~144, 313-345, 357, 510, 586, 682), `CobrancaPhone.tsx` (same CTA/note), `apps/crm/src/pages/configuracao/cobranca/plan-display.ts` (`canUpgradeTo`)
- Modify: `apps/crm/src/components/billing/TrialNudgeCard.tsx`, `apps/crm/src/pages/comecar/ComecarPage.tsx` (switch their effective-plan query to `getEffectivePlanWithSource`, key `['billing','effective-plan-with-source']`)
- Tests: `apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts`, `CobrancaPage.test.tsx`, `CobrancaPage.phone.test.tsx`, existing TrialNudgeCard/Comecar tests.

**Interfaces:**
- Produces:
  - `EffectivePlan` gains `wasDemo: boolean` (from `demo_created_at` in the same `workspaces` select).
  - `export function hasUsedTrial(sub: WorkspaceSubscription | null | undefined, plan: Pick<EffectivePlan, 'wasDemo'> | null | undefined): boolean` = `Boolean(sub?.hasEverSubscribed || plan?.wasDemo)`. Every former `subscription?.hasEverSubscribed` read for trial purposes (the five CobrancaPage/Comecar/TrialNudgeCard sites listed above) uses it.
  - `canUpgradeTo(planId, currentPlanId, hasActiveSub, planSource?: string | null)`: when `planSource === 'demo'`, the current plan is upgradable too.
  - **The real lever is `renderCta`:** it returns the static "Plano atual" (`CobrancaPage.tsx:342`) before `canUpgradeTo` is ever called. That early return must be skipped when `planSource === 'demo'`. `CobrancaPhone.tsx` is presentational (gets `plans` as a ReactNode from `CobrancaPage`, ~line 532), so `renderCta` covers both layouts; the phone only needs a slot/prop for the demo note. `canUpgradeTo` still gets the parameter for every other caller.
- [ ] **Step 1: Failing tests:**
  - `canUpgradeTo allows the current plan when the source is demo` and `still refuses it otherwise`.
  - `hasUsedTrial is true for wasDemo without a subscription row`.
  - `CobrancaPage on a demo shows "Assinar" on the current plan card and no trial copy`.
  - `CobrancaPage on a demo shows the note "Conta demo: você está usando o plano Pro sem custo. Para continuar depois, é só assinar um plano."`; not shown for `manual`/`stripe`.
  - `TrialNudgeCard and ComecarPage hide trial offers for an ex-demo on Free` (Review Focus 5).
- [ ] **Step 2:** `npx vitest run apps/crm/src/pages/configuracao/cobranca apps/crm/src/components/billing apps/crm/src/pages/comecar` → FAIL.
- [ ] **Step 3:** Implement. The current-plan "Assinar" uses the same checkout handlers a non-current card uses (monthly/annual and 12x where the plan allows), with `firstTime=false`.
- [ ] **Step 4:** Run tests + `npx tsc -p apps/crm/tsconfig.json --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(crm): demo can subscribe its current plan, no trial, discreet note`.

### Task 10: Full verification

- [ ] **Step 1:** Run every gate from Global Constraints; all green. `npm ci` afterwards if Deno touched `node_modules`.
- [ ] **Step 2: Browser check (local, seed login per memory):** Admin `npm run dev:admin` against local Supabase with stubbed Resend: open Workspaces → "Criar conta demo" → create → detail shows Demo badge, Afiliado row, Reenviar acesso. CRM: log in as the new owner (set a password via the generated link) → dashboard, Clientes, Ideias, Leads, Fluxos, Agenda show the examples; Configurações > Cobrança shows the note and "Assinar" on the current plan. Screenshot both.
- [ ] **Step 3: Staging rollout (from the spec):** migrations (`npx supabase db push --linked` on staging) → deploy `platform-admin`, `billing-checkout`, `pagarme-checkout`, `pagarme-subscription`, `pagarme-webhook`, `stripe-webhook`, `billing-downgrade-cron` with `--use-api` (and `--no-verify-jwt` for the ones that already use it: see memory `feedback_deploy_edge_functions.md` and CLAUDE.md "Gotchas"; `stripe-webhook`, `pagarme-webhook` and `billing-downgrade-cron` handle their own auth) → create a demo on staging, receive the e-mail, set the password, subscribe with a Stripe test card: no trial, plan switches, Demo badge gone.
- [ ] **Step 4:** Prod: same migrations and functions BEFORE merging the PR (merge deploys the frontend immediately).
