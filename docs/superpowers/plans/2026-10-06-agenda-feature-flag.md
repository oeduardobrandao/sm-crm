# Agenda behind a feature flag (`feature_agenda`) — Implementation Plan

> Two parallel lanes (1: SQL + suites + edge; 2: CRM + Admin + e2e) off the base commit
> named in the dispatch. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the whole Agenda (sub-project 1, already on this branch, unreleased) ships dark.
With the flag off a workspace sees exactly the pre-branch `/calendario` page, cannot create,
edit, delete or answer events through the RPCs, and gets no reminder e-mails/notifications.
Turning it on per workspace (Admin → workspace overrides) enables everything. Launch later =
flip the plan columns to true (the "all plans" product decision still stands; the flag is the
rollout gate).

**Template to copy:** `feature_post_processes` (migration
`20260918000001_plans_feature_post_processes.sql`, SQL gate
`supabase/migrations/20260919000004_apply_post_process.sql:79-81`, edge
`supabase/functions/_shared/entitlements.ts` FEATURE_COLUMNS + Deno test
`supabase/functions/__tests__/entitlements_feature_post_processes_test.ts`, Admin
`apps/admin/src/lib/api.ts:101,247,274`, CRM `apps/crm/src/hooks/useWorkspaceLimits.ts:50`,
`apps/crm/src/lib/entitlement-errors.ts:39`, CRM usage `features?.feature_post_processes === true`).

## Global constraints

- Flag key exactly `feature_agenda`; `plans.feature_agenda boolean NOT NULL DEFAULT false`.
- Error string exactly `feature_disabled:feature_agenda` (`ERRCODE = 'P0001'`), so the CRM's
  existing entitlement-error parsing shows it.
- PT label "Agenda" (CRM error label and Admin flag label).
- Migrations `20261005000001_agenda_eventos.sql` / `20261005000002_agenda_lembretes.sql` are
  unreleased: edit them IN PLACE; do not add a migration that redefines their functions.
- Do not touch `client-event-email-cron`. The 27-type notification CHECKs stay as they are.
- No em-dashes in user-facing copy. Never `useBlocker`.
- Flag off = the pre-branch page: compare against `git show origin/main:apps/crm/src/pages/calendario/CalendarioPage.tsx`.

---

### Lane 1: SQL, entitlement suites, edge

**Files:** `supabase/migrations/20261005000001_agenda_eventos.sql`,
`supabase/migrations/20261005000002_agenda_lembretes.sql`,
`supabase/tests/entitlements/99_agenda_*.sql` (+ any other suite that calls the agenda RPCs,
e.g. the updated `96_*`), `supabase/functions/_shared/entitlements.ts`, new
`supabase/functions/__tests__/entitlements_feature_agenda_test.ts`,
`docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql` (drop the column too).

- [ ] **1.1 Column.** Top of migration A: `ALTER TABLE plans ADD COLUMN IF NOT EXISTS
  feature_agenda boolean NOT NULL DEFAULT false;` with a PT comment like the template's.
- [ ] **1.2 Write gates.** First statement after resolving the workspace in
  `agenda_evento_criar`, `agenda_evento_editar`, `agenda_evento_excluir`, `agenda_responder`:
  `IF NOT effective_plan_feature(<conta>, 'feature_agenda') THEN RAISE EXCEPTION
  'feature_disabled:feature_agenda' USING ERRCODE = 'P0001'; END IF;` — place it before any
  permission/row checks that could leak existence, after the caller's workspace is known.
- [ ] **1.3 Read gate.** `agenda_listar` returns zero rows when the caller's workspace has the
  flag off (no raise: stale clients and prefetches stay quiet).
- [ ] **1.4 Reminders.** Migration B: the tick's candidate selection and the e-mail claim only
  consider events whose `conta_id` has `effective_plan_feature(conta_id, 'feature_agenda')`;
  rows already claimed for a now-disabled workspace are not sent (re-check at claim). Leave
  `agenda_gerar_horizonte` (materialization) ungated.
- [ ] **1.5 Suites.** Every suite that calls agenda RPCs enables the flag for its workspace
  first (template: `update plans set feature_post_processes = true where id = (select plan_id
  from workspaces where id = ws);` in `88_apply_post_process.sql:31`, or a
  `workspace_plan_overrides` row; pick whichever keeps other suites unaffected — plans may be
  shared between test workspaces, so prefer the override when a suite has several
  workspaces). New suite `99_agenda_feature_flag.sql`: with the flag off, create/edit/delete/
  answer raise `feature_disabled:feature_agenda`, `agenda_listar` returns 0 rows for an existing
  event, and the tick creates no reminder for a disabled workspace while it does for an
  enabled one; with an override `{"feature_agenda": true}` on a plan that has it false, create
  works.
- [ ] **1.6 Edge.** Add `"feature_agenda"` to `FEATURE_COLUMNS`; Deno test copying the
  template's. Run only that test file (`deno test --no-check <file>`; afterwards
  `git checkout deno.lock` and report whether `node_modules/.deno` appeared).
- [ ] **1.7 Gates.** Local stack (see dispatch), apply migrations from scratch, run
  `bash scripts/test-entitlements.sh` (all suites, 0 failures), `npm run check:functions`.

### Lane 2: CRM, Admin, e2e

**Files:** `apps/crm/src/hooks/useWorkspaceLimits.ts`, `apps/crm/src/lib/entitlement-errors.ts`,
`apps/crm/src/pages/calendario/CalendarioPage.tsx` (+ tests), `apps/crm/src/context/AuthContext.tsx`,
`apps/crm/src/lib/notification-config.ts` /
`apps/crm/src/pages/configuracao/**/SuasNotificacoesSection.tsx` (+ tests), `apps/admin/src/lib/api.ts`,
`apps/admin/src/lib/__tests__/featureFlags.test.ts`, `apps/admin/src/pages/__tests__/plan-form.test.ts`,
`e2e/screenshots/primeiro-post.spec.ts`, `e2e/screenshots/landing-features.spec.ts`.

- [ ] **2.1 Types/labels.** `feature_agenda: boolean` in `FeatureFlags`; `feature_agenda:
  'Agenda'` in `FEATURE_LABELS`; Admin `api.ts` type, `FEATURE_FLAG_KEYS`, label "Agenda";
  update the two Admin tests' fixtures/expectations.
- [ ] **2.2 CalendarioPage.** `const agendaAtiva = features?.feature_agenda === true` (from
  `useWorkspaceLimits`). Off (including `features === null` while loading): render exactly the
  pre-branch page (tabs, default tab, document title) — the Agenda tab does not exist.
  On: today's behaviour (Agenda tab, default Agenda, per-tab title). Avoid a visible jump on a
  cold load: while `features` is null, render the off layout but do not lock the choice in;
  when it resolves to on and the user has not picked a tab and the URL has no explicit tab,
  switch to Agenda once. A `?evento=` deep link with the flag on still opens Agenda. Read how
  the page stores its active tab (URL param / state) before writing this.
- [ ] **2.3 Prefetch.** `AuthContext.tsx` agenda prefetch only when the flag is on (it already
  has access to the limits, or move the prefetch where `features` is known; read the current
  code). If gating there is awkward, drop the prefetch rather than run it for everyone.
- [ ] **2.4 Notification preferences.** The agenda event types are hidden from the
  preferences UI when the flag is off; visible when on. Keep the catalog (rendering of
  existing notifications) ungated.
- [ ] **2.5 e2e.** CI's e2e workspace has the flag OFF. Revert this branch's edits to
  `primeiro-post.spec.ts` and `landing-features.spec.ts` to `origin/main` unless the pre-branch
  page still needs them (check with `git diff origin/main...HEAD -- e2e/` and the pre-branch
  CalendarioPage). Flag-off rendering must make the original specs pass unchanged.
- [ ] **2.6 Tests.** CalendarioPage: off → no Agenda tab, pre-branch default; on → Agenda
  default; null→on resolves to Agenda without a user choice, and does not override a tab the
  user clicked. Notification prefs: types hidden when off. Gates: eslint, the four `tsc`,
  prettier, `npx vitest run apps/crm apps/admin`.

### Integration (controller)

- [ ] Cherry-pick both lanes; full `npm run test`, four `tsc`, lint, format, `check:functions`;
  entitlement harness on a fresh local stack.
- [ ] Browser: flag off (stub `feature_agenda: false`) → pre-branch page; on → Agenda works.
- [ ] Rollout checklist in memory gains: redeploy `workspace-limits` and `platform-admin`
  (they bundle `FEATURE_COLUMNS`; a stale `workspace-limits` hides the key even with the
  override set), then set `{"feature_agenda": true}` on the pilot workspace's overrides.

---

## Amendments after Fable review (these OVERRIDE the sections above where they conflict)

**Lane 1**
- **A1 (1.2/1.3 placement).** The workspace variable is `v_conta` (`get_my_conta_id()`). Put
  the gate right after the `IF v_conta IS NULL OR v_user IS NULL ... END IF;` block in
  `agenda_evento_criar`, `agenda_evento_editar`, `agenda_evento_excluir`, `agenda_responder`,
  before `has_permission` / scope validation. In `agenda_listar`: `RETURN;` (0 rows) before
  `has_permission` and before the "período inválido" raise. `effective_plan_feature` is
  callable from these DEFINER functions (granted to authenticated/service_role).
- **A2 (1.4 mechanisms).** Claim (`agenda_claim_emails_lembrete`): add `OR NOT
  effective_plan_feature(l.conta_id, 'feature_agenda')` to the stale-settle UPDATE's OR-list
  (the block that settles rows to `'nao'`), so claimed rows of a disabled workspace are never
  sent. Tick (`agenda_tick_lembretes`): do NOT call it inside the per-row LATERAL of `cand`
  (non-inlinable plpgsql, would run per series × minute × occurrence). Filter once per
  workspace before the insert, e.g. a CTE of `SELECT DISTINCT conta_id FROM cand` kept only
  where `effective_plan_feature(conta_id, 'feature_agenda')`, joined in `dest` before `ins`.
- **A3 (1.5 suites).** `scripts/test-entitlements.sh` runs each file in its own psql and every
  file is one `begin; ... rollback;`, so there is no cross-suite leakage: put
  `update plans set feature_agenda = true;` right after `begin;` in every suite that calls the
  agenda RPCs (all `99_agenda_*.sql` and any other, e.g. `96_*`; grep `agenda_`). Note
  `et_make_workspace(p_plan, p_overrides)` writes `resource_overrides`, NOT
  `feature_overrides`; for the new suite's "override on a false plan" case insert directly:
  `insert into workspace_plan_overrides (workspace_id, feature_overrides) values (ws,
  '{"feature_agenda": true}')`.

**Lane 2**
- **A4 (replaces 2.3).** There is no agenda prefetch. The branch's `AuthContext.tsx` change
  only adds `'agenda-ocorrencias'` to `MODULE_QUERY_KEYS.calendario` (purge on permission
  downgrade). Leave `AuthContext.tsx` unchanged.
- **A5 (replaces the switching design in 2.2).** `ProtectedRoute` shows a full-page spinner
  while `useWorkspaceLimits().isLoading`, so the page never mounts with `features === null` on
  a cold load. Derive the tab, no effect: keep the user's pick in state (`escolha`, initially
  null) and compute `activeTab = escolha && (escolha !== 'agenda' || agendaAtiva) ? escolha :
  agendaAtiva ? 'agenda' : <pre-branch default tab>`. Gate the existing `?evento=`/`?data=`
  effect (CalendarioPage.tsx ~:714) on `agendaAtiva` (off: it must not select a tab that does
  not render). Title: keep the branch's per-tab title and restore-on-unmount in BOTH modes (it
  fixes a known title leak; pre-branch set no title), do not strip it for parity.
  Lazy-load the agenda: `const AgendaTab = lazy(() => import('./agenda/AgendaTab'))` +
  `Suspense` (flag-off workspaces must not download FullCalendar); the test's
  `vi.mock('../agenda/AgendaTab')` keeps working.
- **A6 (error copy).** Agenda paths format errors with `formatAgendaError`
  (`store/agenda.ts` ~:180), which ignores entitlement errors. Make it run
  `mapEntitlementError` first and return `entitlementMessage(...)` on a match (test it).
- **A7 (2.4 detail).** `SuasNotificacoesSection` maps `CATEGORY_ORDER` then filters rows: skip
  a category whose rows are all hidden (no empty "Agenda" header). `NotificacoesTab.test.tsx`
  and `CalendarioPage.test.tsx` need a `useWorkspaceLimits` mock (pattern:
  `components/layout/__tests__/Sidebar.test.tsx:9`).
- **A8 (2.5 confirmed).** Revert both e2e specs to `origin/main`.

**Integration**
- **A9 (rollout reason, replaces the last bullet).** `mergeEntitlements` spreads
  `feature_overrides` after the column loop, so a stale `workspace-limits` still emits an
  override; it only misses the plan column. Redeploy `workspace-limits` and `platform-admin`
  anyway (the Admin plan form/plan-mutations only round-trip the column once deployed). Order:
  `db push` (both migrations) → deploy `workspace-limits`, `platform-admin`,
  `notification-email-cron`, `agenda-lembretes-email` → merge → set the pilot override.
- **A10 (node_modules).** Lane 1's deno run pollutes the shared `node_modules`; the controller
  runs `npm ci` before integration gates.
