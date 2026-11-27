# Workspace Language (US launch part 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `pt`/`en` language per workspace drives the CRM default, the Hub, every workspace email and push, Auth emails, and client reports, so a US agency and its clients get English end to end.

**Architecture:** A `workspaces.language` column, writable only through an owner-checked RPC, is the single source. The browser keeps two keys (explicit choice vs `/en` hint) and resolves explicit → workspace → hint → `pt`. Edge functions get a small `_shared/i18n/` layer (lang resolution, formatters, per-family pt/en catalogs) and every in-scope sender loads the workspace language and passes it down.

**Tech Stack:** Postgres/Supabase migrations + psql entitlement suites, React 19 + i18next (`@mesaas/i18n`), Deno edge functions, Vitest, `deno test`.

**Spec:** `docs/superpowers/specs/2026-11-26-workspace-language-design.md`

## Global Constraints

- Languages are exactly `'pt' | 'en'`. Default and every failure path is `pt`.
- Brazilian (`pt`) output of every email, push and report stays identical to today.
- Language is never derived from `billing_currency` except the signup default and the one-time backfill.
- A person's explicit pt/EN toggle wins for their own screen only; it never changes what the workspace sends.
- Only `workspace_set_language()` (owner) and the service role may change `workspaces.language`.
- Edge functions: language lookup failure logs and falls back to `pt`; it never fails a send. No raw errors to clients.
- `<html lang>` follows the rendered language (CRM via existing `languageChanged` sync; emails via the shell).
- No em-dashes in user-facing copy in either language. English copy is US English.
- Resend `type` tags do not change with language.
- Out of scope: per-person language, Admin app, Mesaas-internal emails (`notify.ts` cron-failure mail, founder signup notice, retention radar, affiliates, `platform-admin` backfill), Portuguese public site + its legal pages, blog, KB, server error strings shown in the CRM, the comments-analysis `?lang=` contract.
- Migration version: `20261210000001` (main's tail is `20261209000002`; re-check and renumber above main's tail before opening the PR).
- Before every push: `npm run lint`, `npm run format:check`, the five `tsc` commands from CLAUDE.md, `npm run test`, `npm run check:functions`, `npm run test:functions`.

## Review Focus

1. `billing_market_apply()` is re-run by `/workspace-setup` after the owner already chose `pt` → must not flip the workspace back to `en` (Task 1 test `market_apply_respects_owner_choice`).
2. An admin (not owner) PATCHes `workspaces.language` directly through PostgREST → refused with 42501 (Task 1 test `admin_direct_update_refused`).
3. A browser that already has `mesaas-language = 'pt'` from before this ships, in an `en` workspace → after migration it shows English (legacy value became a hint), and after the person toggles to `pt` it stays `pt` (Task 2 tests).
4. An unknown or missing language value reaches an edge sender (old row, null join, typo) → Portuguese output, no throw (Task 7 test `resolveLang_unknown_is_pt` + each sender test passes `undefined`).
5. A Brazilian workspace's emails must not change by a byte → each email family's test asserts the `pt` render equals the pre-change render (Tasks 8-11, "pt unchanged" tests captured before editing).

---

## Phase A: storage, browser resolution, Settings, Hub (PR 1)

Deploy order for PR 1: migration (staging, then prod) → `hub-bootstrap` + `hub-auth` (both `--no-verify-jwt`) → merge.

### Task 1: Migration: column, guard, RPC, signup default, backfill

**Files:**
- Create: `supabase/migrations/20261210000001_workspace_language.sql`
- Create: `supabase/tests/entitlements/99_workspace_language.sql`

**Interfaces:**
- Produces:
  - `workspaces.language text not null default 'pt' check (language in ('pt','en'))`
  - `workspaces.language_set_at timestamptz null` (set when the owner chooses; signup/backfill leave it null)
  - `public.workspace_set_language(p_language text) returns text` — SECURITY DEFINER, `search_path = ''`, EXECUTE to `authenticated` only. Resolves the caller's active workspace like `billing_market_apply()` (`coalesce(active_workspace_id, conta_id)`), requires `workspace_members.role = 'owner'` for it, raises `42501` otherwise, raises `22023` for a value not in `('pt','en')`, sets `language` and `language_set_at = now()`, also writes `raw_user_meta_data.language` of the caller (`auth.users`, jsonb merge), returns the stored language.
  - Trigger `trg_workspaces_guard_language` (BEFORE UPDATE) calling `public.workspaces_guard_language()`: SECURITY INVOKER, raises `workspace_language_read_only` / `42501` when `current_user in ('anon','authenticated')` and `language` or `language_set_at` changes. A separate function, not an edit of `workspaces_guard_billing_columns()`.
  - `handle_new_user_billing_market()` recreated: the same `market = 'us'` branch also sets `language = 'en'`. It does not touch user metadata: the signup already carries `market = 'us'`, and the Auth templates read `language` with a `market` fallback (Task 12).
  - `billing_market_apply()` recreated: when `market = 'us'` and caller is owner, also `update workspaces set language = 'en' where id = v_ws and language_set_at is null and language <> 'en'`. Return type and currency logic unchanged.
  - Backfill: `update workspaces set language = 'en' where billing_currency = 'usd' and language_set_at is null`.
  - Add `language` to every CRM-readable select path that needs it: `workspaces` has no column allowlist (confirm with `\dp workspaces`); if it does, grant SELECT on the new columns.

- [ ] **Step 1: Write the failing entitlement suite** `99_workspace_language.sql` (follow `99_workspace_billing_column_guard.sql` + `_helpers.sql`, call `et_grant_hosted_parity()` first). Cases:
  - `default_is_pt`: new workspace row → `language = 'pt'`.
  - `owner_sets_en`: as owner, `select workspace_set_language('en')` → `'en'`, row `language='en'`, `language_set_at` not null, `auth.users.raw_user_meta_data->>'language' = 'en'`.
  - `admin_rpc_refused`: as admin member → 42501.
  - `admin_direct_update_refused`: as admin, `update workspaces set language='en' where id = <ws>` → 42501 `workspace_language_read_only`.
  - `owner_direct_update_refused`: same as owner → 42501 (only the RPC writes).
  - `bad_value_refused`: `workspace_set_language('es')` → 22023.
  - `signup_us_sets_en`: insert auth user with `raw_user_meta_data = {"market":"us"}` → owned workspace `language='en'`, `billing_currency='usd'`.
  - `market_apply_respects_owner_choice`: US owner calls `workspace_set_language('pt')`, then `billing_market_apply()` → language stays `'pt'`.
  - `market_apply_sets_en_when_unset`: US owner with `language='pt'`, `language_set_at` null → `billing_market_apply()` sets `'en'`.
- [ ] **Step 2:** Run `npm run test:db` (needs Docker/colima; see memory "Local Supabase runs on colima") → FAIL (column missing).
- [ ] **Step 3:** Write the migration as specified in Interfaces, with a header comment in Portuguese like its neighbors and a post-condition `DO $$` block asserting the trigger exists and `anon` has no EXECUTE on the RPC.
- [ ] **Step 4:** `npm run test:db` → PASS. Also `bash scripts/check-migration-versions.sh` if present, else confirm no duplicate prefix with `ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` → empty.
- [ ] **Step 5: Commit** `feat(db): idioma por workspace (coluna, guarda, RPC, padrão no cadastro)`.

### Task 2: `@mesaas/i18n`: explicit choice vs hint

**Files:**
- Modify: `packages/i18n/index.ts`
- Test: `packages/i18n/__tests__/index.test.ts`

**Interfaces:**
- Produces (all exported from `@mesaas/i18n`):
  - `LANGUAGE_EXPLICIT_KEY = 'mesaas-language'`, `LANGUAGE_HINT_KEY = 'mesaas-site-language'`
  - `getExplicitLanguage(): Language | null`
  - `getLanguageHint(): Language | null`
  - `setLanguageHint(lang: Language): void` — writes the hint key and calls the non-saving `i18n.changeLanguage(lang)`
  - `setActiveWorkspaceLanguage(lang: Language | null): void` — module-level value, no storage
  - `effectiveLanguage(): Language` — `explicit ?? activeWorkspace ?? hint ?? 'pt'`
  - `migrateLegacyLanguageKey(): void` — once per browser (marker key `mesaas-language-migrated = '1'`): if the explicit key holds a valid value and no marker exists, move it to the hint key and delete the explicit key; then set the marker. All storage access in try/catch.
  - `getSavedLanguage()` becomes `explicit ?? hint ?? 'pt'` (pre-auth meaning, same signature).
  - `changeLanguage(lang)` unchanged: writes the explicit key.

- [ ] **Step 1: Failing tests:**
  - `effectiveLanguage prefers explicit over workspace over hint` (set each, assert order; nothing set → `'pt'`).
  - `migrateLegacyLanguageKey moves an old value to the hint once` (explicit `'en'` → after: hint `'en'`, explicit null; calling again after `changeLanguage('pt')` leaves explicit `'pt'`).
  - `storage that throws returns pt and does not throw` (stub `localStorage.getItem` to throw).
  - `setLanguageHint does not touch the explicit key`.
- [ ] **Step 2:** `npx vitest run packages/i18n` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npx vitest run packages/i18n` → PASS.
- [ ] **Step 5: Commit** `feat(i18n): escolha explícita separada da dica do site`.

### Task 3: CRM: hint writers, workspace language sync

**Files:**
- Modify: `apps/crm/src/pages/en/EnglishPage.tsx` (call `setLanguageHint('en')` instead of `changeLanguage('en')`)
- Modify: `apps/crm/src/lib/signupMarket.ts` (same; keep its reads working with the hint key)
- Modify: `apps/crm/src/main.tsx` (call `migrateLegacyLanguageKey()` before `initI18n`; non-`/en`, non-PT-site paths start in `getSavedLanguage()`)
- Modify: `apps/crm/src/boot/SavedLanguageSync.tsx` (target for non-site, non-`/en` paths becomes `effectiveLanguage()`)
- Modify: `apps/crm/src/store/workspace.ts` (`getCurrentWorkspace` selects `language`; add `setWorkspaceLanguage`)
- Create: `apps/crm/src/boot/WorkspaceLanguageSync.tsx`, mounted inside the signed-in layout (`components/layout/AppLayout.tsx` or `ProtectedRoute.tsx`, whichever renders only for an authenticated user with an active workspace)
- Test: `apps/crm/src/__tests__/savedLanguageSync.test.tsx`, `apps/crm/src/boot/__tests__/WorkspaceLanguageSync.test.tsx`

**Interfaces:**
- Consumes: Task 1 column + RPC; Task 2 API.
- Produces:
  - `getCurrentWorkspace(): Promise<{ id; name; logo_url; language: 'pt' | 'en' }>` (normalize unknown → `'pt'`)
  - `setWorkspaceLanguage(lang: 'pt' | 'en'): Promise<'pt' | 'en'>` — `supabase.rpc('workspace_set_language', { p_language: lang })`
  - `WorkspaceLanguageSync`: reads the current-workspace query (reuse the existing query key used by `WorkspaceTab`), calls `setActiveWorkspaceLanguage(lang)` and then `i18n.changeLanguage(effectiveLanguage())` when it differs; on unmount (sign-out) `setActiveWorkspaceLanguage(null)`.

- [ ] **Step 1: Failing tests:**
  - `en workspace with no explicit choice renders English` (mock workspace `language:'en'`, no storage).
  - `explicit pt wins over en workspace` (`changeLanguage('pt')` before render → stays `pt`).
  - `/en visit writes only the hint` (render `EnglishPage`, assert explicit key null, hint `'en'`).
  - `navigating from /dashboard to /login keeps the effective language` (SavedLanguageSync with active workspace `en` set).
  - Existing #882 cases stay green (Portuguese site pages force `pt`).
- [ ] **Step 2:** `npx vitest run apps/crm/src/__tests__/savedLanguageSync.test.tsx apps/crm/src/boot` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS; plus `npx vitest run apps/crm/src/__tests__/App.test.tsx`.
- [ ] **Step 5: Commit** `feat(crm): app abre no idioma do workspace`.

### Task 4: Settings: workspace language select

**Files:**
- Modify: `apps/crm/src/pages/configuracao/tabs/WorkspaceTab.tsx`
- Modify: `packages/i18n/locales/{pt,en}/settings.json`
- Test: `apps/crm/src/pages/configuracao/__tests__/WorkspaceTab.language.test.tsx`

**Interfaces:**
- Consumes: `setWorkspaceLanguage`, `getCurrentWorkspace` (Task 3), `changeLanguage` (Task 2), `useAuth().role`.
- Behavior: shadcn `Select` with "Português (Brasil)" / "English (US)", owner only (others see the value read-only), helper line (pt: "Define o idioma dos e-mails e do portal do cliente para a equipe e os clientes."; en: "Sets the language of emails and the client portal for your team and clients."). On change: RPC → invalidate the current-workspace query → `changeLanguage(lang)` (saves explicit for the owner's browser, spec §2) → `toast()` success; on error `toast.error` with a generic message.

- [ ] **Step 1: Failing tests:** `owner sees an enabled select`, `admin sees read-only value`, `choosing English calls the RPC and switches the UI`, `RPC failure shows an error toast and keeps the old value`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(configuracoes): idioma do workspace`.

### Task 5: Hub: bootstrap language and login screen

**Files:**
- Modify: `supabase/functions/hub-bootstrap/handler.ts` (select `language`; add `language` at the top level of the success payload and at `login.workspace.language` in the `login_required` payload)
- Modify: `supabase/functions/hub-auth/handler.ts` (`resolveLink` selects `language`, passes it on; its user-facing response messages use the catalog from Task 7 — if Task 7 is not merged yet, only thread the value here and translate in Task 11)
- Modify: `apps/hub/src/types.ts`, `apps/hub/src/api.ts` / `queries.ts` (type the field), Hub shell where bootstrap resolves (`apps/hub/src/shell/HubShell.tsx` and the login screen component)
- Test: `supabase/functions/__tests__/hub-bootstrap_test.ts` (extend), Hub Vitest next to the shell

**Interfaces:**
- Produces: bootstrap JSON `language: 'pt' | 'en'` and `login.workspace.language`.
- Hub behavior: on bootstrap (either payload) call `setActiveWorkspaceLanguage(lang)` then `i18n.changeLanguage(effectiveLanguage())`. The existing toggles (`HubSidebar`, `HubMobileNav`) already call `changeLanguage` and so write the explicit key; no change there. Call `migrateLegacyLanguageKey()` in `apps/hub/src/main.tsx` before `initI18n`.

- [ ] **Step 1: Failing tests:** deno `bootstrap returns language for an en workspace`, `login_required payload carries language`, `missing column value → 'pt'`; Vitest `Hub renders English for an en workspace without explicit choice`, `explicit pt toggle wins`.
- [ ] **Step 2:** `deno test --no-check supabase/functions/__tests__/hub-bootstrap_test.ts` + Hub vitest → FAIL. **Step 3:** implement. **Step 4:** PASS, plus `npm run check:functions`.
- [ ] **Step 5: Commit** `feat(hub): portal abre no idioma do workspace`.

### Task 6: Guard against new hard-coded Portuguese

**Files:**
- Create: `apps/crm/src/__tests__/noHardcodedPortuguese.test.ts`
- Create: `apps/crm/src/__tests__/noHardcodedPortuguese.baseline.json`

**Interfaces:**
- Scans signed-in CRM `.tsx` under `apps/crm/src/pages` and `apps/crm/src/components` (not `__tests__`), flags JSX text or string literals containing `[ãâáàçéêíóôõú]` that are not inside `t(`…`)` default values or comments. Allowlist (never scanned): the Portuguese public pages (`pages/landing`, `pages/precos`, `pages/sobre`, `pages/blog`, `pages/novidades`, `pages/lgpd`, `pages/termos-de-uso`, `pages/politica-privacidade`, marketing pages listed in `content/site-meta.ts` `PUBLIC_ROUTES` with `locale: 'pt'`).
- The baseline lists the files that fail today. Test fails when a file outside the baseline has hits, and when a baseline file has no hits anymore (forces the list to shrink).

- [ ] **Step 1:** Write the test; generate the baseline from its own scan; commit both. **Step 2:** `npx vitest run apps/crm/src/__tests__/noHardcodedPortuguese.test.ts` → PASS. Add a throwaway accented string in a non-baseline file → FAIL; revert.
- [ ] **Step 3: Commit** `test(crm): barra português novo fora das traduções`.

---

## Phase B: emails, push and Auth (PR 2)

Deploy order for PR 2: (PR 1 deployed) → edge functions listed in each task → Auth templates (Task 12, staging then prod) → merge. Edge senders read a column PR 1 created, so PR 1's migration must be on the target first.

### Task 7: Edge i18n core and email shell

**Files:**
- Create: `supabase/functions/_shared/i18n/lang.ts`
- Create: `supabase/functions/_shared/i18n/workspace-lang.ts`
- Create: `supabase/functions/_shared/i18n/catalog.ts`
- Modify: `supabase/functions/_shared/email/shell.ts`
- Test: `supabase/functions/__tests__/edge-i18n_test.ts`

**Interfaces:**
- Produces:
  - `type Lang = 'pt' | 'en'`; `resolveLang(value: unknown): Lang`; `intlLocale(lang: Lang): 'pt-BR' | 'en-US'`
  - `formatDate(iso: string, lang: Lang, opts?: Intl.DateTimeFormatOptions & { timeZone?: string }): string` (default timeZone `America/Sao_Paulo` for `pt`, `America/New_York` for `en`)
  - `formatMoney(cents: number, currency: 'brl' | 'usd', lang: Lang): string`
  - `workspaceLang(db: DbClient, contaId: string): Promise<Lang>` — selects `workspaces.language`; error or missing → logs `[i18n] workspace lang lookup failed` and returns `'pt'`
  - `ownerLang(db: DbClient, userId: string): Promise<Lang>` — oldest workspace where the user is `owner` in `workspace_members`; none → `'pt'`
  - `defineCatalog<T extends Record<string, unknown>>(c: { pt: T; en: T }): (lang: Lang) => T` — catalogs are plain objects whose values are strings or `(args) => string`
  - `mesaasEmail` / `brandedEmail` inputs gain `lang?: Lang` (default `'pt'`): `<html lang>` (`pt-BR`/`en`) and `MESAAS_TAGLINE` become per-language (en: "Mesaas · Management platform for social media agencies").
  - Every catalog file added in Tasks 8-11 registers in `supabase/functions/__tests__/edge-i18n-catalogs_test.ts`, which asserts identical key sets (deep) between `pt` and `en` and that no `en` string contains `[ãçõ]` or an em-dash.

- [ ] **Step 1: Failing tests:** `resolveLang_unknown_is_pt` (`undefined`, `null`, `'es'`, `'EN'` → `'pt'`), `formatMoney` (`(12345,'usd','en')` → `"$123.45"`, `(12345,'brl','pt')` → `"R$ 123,45"` with the NBSP Intl emits — assert via `Intl` itself), `workspaceLang falls back to pt on db error`, `ownerLang picks the oldest owned workspace`, shell `lang en sets html lang en`, shell `pt output unchanged` (snapshot the current `mesaasEmail` output for a fixed input BEFORE editing and compare).
- [ ] **Step 2:** `deno test --no-check supabase/functions/__tests__/edge-i18n_test.ts` → FAIL. **Step 3:** implement. **Step 4:** PASS + `npm run check:functions`.
- [ ] **Step 5: Commit** `feat(edge): base de idioma para e-mails`.

### Tasks 8-11 common pattern

For each email family: (1) before editing, add a test that renders the current Portuguese output for fixed inputs and stores it as the expected value ("pt unchanged"); (2) move every user-facing string of the family into a catalog `supabase/functions/_shared/i18n/catalogs/<family>.ts` via `defineCatalog`; (3) the builder gains `lang: Lang` (required in builders, so `check:functions` finds every caller); (4) the sender loads the language with `workspaceLang`/`ownerLang` once per workspace per run (cache in a `Map` inside the handler) and passes it; (5) add an `en` test asserting the English subject and one body phrase plus `<html lang="en"`; (6) dates/money via Task 7 formatters. Redeploy every function that bundles a changed module (find with `grep -rl "<module>" supabase/functions/*/index.ts supabase/functions/*/handler.ts`).

### Task 8: Owner lifecycle: welcome, thank-you, trial reminder, reverse trial, nurture, unsubscribe page

**Files:** `_shared/lifecycle-emails.ts`, `_shared/nurture-emails.ts`, `lifecycle-email-cron/handler.ts`, `nurture-unsub/handler.ts`; catalogs `lifecycle.ts`, `nurture.ts`, `nurture-unsub.ts`; tests in `supabase/functions/__tests__/` next to the existing lifecycle/nurture tests.
- Language source: `ownerLang(db, ownerUserId)` (spec §4). `nurture-unsub` resolves the profile's `ownerLang`; token format unchanged; old tokens keep working (test `legacy token renders pt page for a pt owner`).
- `buildFounderSignupNotice` and `FOUNDER_NOTICE_FROM` stay Portuguese (internal).
- `formatFirstCharge`/`subscriptionValueLine` use `formatMoney` with the workspace currency.
- Deploy: `lifecycle-email-cron`, `nurture-unsub` (`--no-verify-jwt`), `reverse-trial-cron` if it imports the module.
- [ ] Steps per common pattern; commit `feat(emails): ciclo de vida do dono no idioma do workspace`.

### Task 9: Team notifications: digest email and iOS push

**Files:** `_shared/notification-render.ts`, `_shared/notification-email.ts`, `notification-email-cron` handler, `notification-push-cron/handler.ts`; catalog `notifications.ts`.
- `renderNotification(row, lang: Lang)`; `digestSubject(items, lang)`, `digestPreheader(items, lang)`, `buildDigestHtml(items, appBase, lang)`; push grouped title "`{n}` new notifications on Mesaas" / list joiner "and `{n}` more".
- Language source: the notification's workspace (`row.conta_id` or the column the row carries; confirm in `NotificationRow`), via `workspaceLang`. A digest mixing two workspaces of different languages (multi-workspace member) renders in the language of the majority workspace, ties → `pt` (my call, not in spec; record in the PR).
- Deploy: `notification-email-cron`, `notification-push-cron` (`--no-verify-jwt`).
- [ ] Steps per common pattern, plus test `mixed-workspace digest uses majority language`; commit `feat(notificacoes): e-mail e push no idioma do workspace`.

### Task 10: Team transactional: invites, dunning, Instagram connect, report-ready

**Files:** `_shared/invite-email.ts` (`buildInviteEmail({ actionLink, workspaceName, lang })`; `buildDemoAccessEmail` stays pt, admin-only), `_shared/invite-actions.ts` (loads `workspaceLang` of the inviting workspace), `_shared/dunning-email.ts` (`buildDunningCopy(..., lang)`), `_shared/instagram-connect-email.ts`, `report-worker/index.ts` and `instagram-analytics/index.ts` report-ready mails, `_shared/report-template/email.ts`; catalogs `invite.ts`, `dunning.ts`, `instagram-connect.ts`, `report-email.ts`.
- Deploy: `manage-workspace-user` and every importer of `invite-actions.ts`, `stripe-webhook` / `billing-dunning-cron` (whichever import `dunning-email.ts`), `instagram-connect-link`, `instagram-integration`, `report-worker`, `instagram-analytics`.
- [ ] Steps per common pattern; commit `feat(emails): convites, cobrança e avisos no idioma do workspace`.

### Task 11: Client-facing: client events, agenda, Hub login code

**Files:** `_shared/client-event-email.ts`, `client-event-email-cron/index.ts`, `_shared/agenda-cliente-email.ts`, `agenda-cliente-email/handler.ts`, `_shared/agenda-email.ts`, `agenda-lembretes-email/handler.ts`, `hub-auth/email.ts`, `hub-auth/handler.ts` messages; catalogs `client-event.ts`, `agenda.ts`, `hub-login.ts`.
- Includes the `.ics` text (`montarEmailAgendaCliente`) and the external-invitee variant; `formatarQuandoAgenda(q, lang)`.
- Client unsubscribe pages that these mails link to render in the workspace language (resolve by the token's cliente/convidado → workspace).
- Deploy: `client-event-email-cron`, `agenda-cliente-email`, `agenda-lembretes-email`, `hub-auth`, and the unsubscribe function (all per CLAUDE.md `--no-verify-jwt` list).
- [ ] Steps per common pattern; commit `feat(emails): e-mails do cliente no idioma do workspace`.

### Task 12: Auth emails: metadata language and templates runbook

**Files:**
- Modify: `_shared/invite-actions.ts` (pass `language` in `inviteUserByEmail(..., { data: { ..., language } })` and on the resend/`generateLink` path update the invitee's `user_metadata.language` via `auth.admin.updateUserById` when they are not yet confirmed)
- Create: `docs/workspace-language-runbook.md` (deploy order for all four PRs, the Auth template edits, rollback)
- Test: extend `supabase/functions/__tests__/invite-actions_test.ts`

**Interfaces:**
- Consumes: Task 1 (`workspace_set_language` already writes the owner's metadata), Task 7 `workspaceLang`.
- Templates (Reset password, Invite user, Magic link; staging then prod in the Supabase dashboard) branch on `{{ if or (eq (printf "%v" .Data.language) "en") (eq (printf "%v" .Data.market) "us") }}` English `{{ else }}` current Portuguese, verbatim `{{ end }}`; same for subjects. The runbook carries the English copy for each.
- [ ] **Step 1:** Failing test `invite passes the inviting workspace language in data`. **Step 2-4:** implement, PASS. **Step 5:** write the runbook. **Step 6: Commit** `feat(auth): idioma do workspace nos e-mails do Supabase Auth`.

---

## Phase C: CRM string sweep (PR 3)

No deploy dependency beyond PR 1. Each task moves the listed files' hard-coded Portuguese into `packages/i18n/locales/{pt,en}` (new keys in the existing namespace of that page, or a new namespace registered where its neighbors are), replaces `ptBR` date-fns imports with `useDateFnsLocale()` / `getDateFnsLocale()` and `toLocale*('pt-BR')` with `getIntlLocale()`, removes the files from `noHardcodedPortuguese.baseline.json`, and keeps existing tests green (tests that assert Portuguese text keep doing so: the default test language is `pt`). Each task adds one test rendering one of its screens with `i18n.changeLanguage('en')` and asserting an English heading.

### Task 13: Analytics (account, phone, flows) and dashboard phone
Files: `pages/analytics-conta/**`, `pages/analytics/**`, `pages/analytics-fluxos/**`, `pages/dashboard/phone/TodayPhone.tsx`. Commit `i18n(crm): analytics em inglês`.

### Task 14: Report editor, import wizard, contracts, paywall
Files: `pages/relatorio-editor/**`, `pages/importar/**`, `pages/contratos/ContratosPage.tsx`, `components/paywall/UpgradeLockedScreen.tsx`. Commit `i18n(crm): editor de relatório, importação e contratos em inglês`.

### Task 15: Guide, consent, set-password, cookie button, everything else in the baseline
Files: `components/guide/guideContent.tsx`, `pages/oauth/ConsentPage.tsx`, `pages/configurar-senha/ConfigurarSenhaPage.tsx`, the `/login` "Preferências de cookies" button (`components/consent/*`), `components/layout/*`, remaining baseline entries except the allowlisted public pages and `pages/afiliados/**` (Brazil-only program; move it to the allowlist with a comment). End state: baseline file is empty and deleted, test only uses the allowlist. Commit `i18n(crm): restante do app em inglês`.

---

## Phase D: reports and AI text (PR 4)

Deploy order: `report-docs`, `instagram-report-generator-v2` → merge (frontend changes none beyond Phase C).

### Task 16: Block reports in the workspace language

**Files:** `supabase/functions/report-docs/generate.ts` (+ refresh-data and pdf paths), `_shared/report-template/{render,charts,fallback,email-kpis,brand-header,template-string}.ts`; catalog `report-template.ts`; the CRM print page that Gotenberg loads (it reads the document; add the workspace language to what `report-docs` returns to it).
- `report-docs` loads `workspaceLang(db, contaId)` once per request and threads `lang` into render; month names, KPI labels, chart axis labels and empty states via catalog and Task 7 formatters. Stored `pdf_storage_path` is not invalidated.
- [ ] Steps per common pattern (pt render unchanged; en render has English labels); commit `feat(relatorios): rótulos no idioma do workspace`.

### Task 17: AI narrative in reports

**Files:** `_shared/report-template/ai.ts` and the Gemini caller(s) in `instagram-analytics` / `instagram-report-generator-v2`.
- Prompt gains an output-language instruction from `lang` (`pt` prompt text unchanged; `en` adds "Write in US English."). Comments analysis untouched.
- [ ] Test `en prompt asks for English`, `pt prompt unchanged`; commit `feat(relatorios): narrativa de IA no idioma do workspace`.

### Task 18: Docs

**Files:** `CLAUDE.md` (Gotchas entry: workspace language, its guard, explicit vs hint keys, catalogs in `_shared/i18n/catalogs` with the parity test, deploy order pointer to the runbook), `docs/workspace-language-runbook.md` (final).
- [ ] Commit `docs: idioma por workspace`.
