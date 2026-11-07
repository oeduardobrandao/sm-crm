# Landing + Signup Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the hero CTA on the first screen, cut the signup form to three fields with inline errors (company + phone move to a restyled setup step), shorten the phone features section, and add "Entrar" to the phone header.

**Architecture:** Frontend only (CRM app). The landing (`/`, SSR-prerendered and hydrated) loses its promo bar and gets smaller hero type, a CSS-only features disclosure and a header label swap. The cookie banner becomes compact everywhere. Signup sends `empresa: ''`, so the existing `needsSetup` gate (`!profile.empresa`) routes new owners to `/workspace-setup?next=…`, which now collects company, phone and opt-in, rewrites the placeholder slug, refreshes the profile silently and continues to `next`.

**Tech Stack:** React 19, React Router v7 (data router), TanStack Query, Supabase JS, Vitest + Testing Library, i18next (`packages/i18n`), Tailwind + hand-written CSS.

**Spec:** `docs/superpowers/specs/2026-11-06-landing-signup-conversion-design.md`. Mockups: https://claude.ai/artifact/97PiggcESMFGRmtKcbitWE

## Global Constraints

- No migration, no edge-function change. `handle_new_user` is untouched.
- UI copy: Portuguese, sentence case, no em dashes (use a period or colon).
- Icons: `lucide-react` only on public pages (no Phosphor `<i class="ph">` on landing/login).
- Landing render must be hydration-stable: no `localStorage`/`document`/`matchMedia`/`innerWidth` reads during render; new state starts identical on server and first client render.
- CSS placement: landing rules in `apps/crm/src/pages/landing/landing.css` / `landing-v2.css`; cookie-banner rules in `apps/crm/style.css` (core); setup-page rules in `apps/crm/src/pages/workspace-setup/workspace-setup.css`. Never move a rule into `apps/crm/app.css`.
- Error copy uses `--danger-text` (`#b91c1c` light), never `--danger`.
- "Rejeitar" and "Aceitar" keep the same button variant (LGPD).
- Run prettier only on files you touched (`npx prettier --write <paths>`), never repo-wide.
- Parallel execution: when tasks run concurrently in one worktree, implementers do not commit; the orchestrator commits each task's paths after review.

## Review Focus

1. `next` that is missing, external (`https://x.com`, `//x.com`), or `/workspace-setup` itself → setup continues to `/comecar`. Test in Task 6 (`safeNextPath`).
2. Company names with accents, non-decomposing letters, symbols or only emoji ("Agência Ótima", "Straße", "✨") → slug `agencia-otima-<hex>` / `strasse-<hex>`; emoji-only keeps `workspace-<hex>`. Test in Task 6 (`slugifyWorkspaceName`).
3. Phone typed with formatting ("(11) 99999-9999", "+55 11 99999-9999") is valid; "1234" and 14+ digits are not. Test in Task 6 (`isValidBrPhone`).
4. Double tap on "Continuar" or "Criar conta" → one save / one `signUp` call (button disabled while in flight). Tests in Tasks 5 and 7.
5. Signed-in visitor on the landing sees "Acessar painel" in the new features CTA and no "Entrar"/"Criar conta". Test in Task 2.

---

## Task 1: Remove promo bar, fold the offer into the hero, resize the hero

**Files:**
- Modify: `apps/crm/src/pages/landing/LandingPage.tsx` (delete `PromoBanner`, its store `PROMO_DISMISSED_KEY` … `dismissPromo`, its render at line ~109; update the `data-ssr` comment at ~72 to drop "dismissed promo"; Hero offer note markup)
- Modify: `apps/crm/src/content/landing.content.ts` (`hero.note`)
- Modify: `apps/crm/index.html` (pre-paint script: delete the `mesaas_promo_dismissed` branch, keep `data-js` and `data-consent-stored`)
- Modify: `apps/crm/src/pages/landing/landing.css` (delete `.promo-banner*` rules ~227-296 and any `data-promo-dismissed` rules), `apps/crm/src/pages/landing/landing-v2.css` (delete promo rules ~388-405; hero sizing ~444-540 and the ≤720px/≤980px blocks)
- Test: `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx`, `LandingHydration.test.tsx`, `LandingSsr.test.tsx`, `apps/crm/src/__tests__/prePaintScript.test.ts`, `apps/crm/src/content/__tests__/trial-claims.test.ts` (:21 asserts the exact `hero.note`; set it to the new sentence)
- Remove imports left unused in `LandingPage.tsx` (`X`, `useSyncExternalStore` if nothing else uses them).

**Interfaces:**
- Produces: `LANDING.hero.note: string` = `'30 dias grátis em qualquer plano pago. Cancele quando quiser.'`; the Hero renders "30 dias grátis" inside `<strong>` (split the note on the first `'30 dias grátis'` occurrence, or add `noteStrong`/`noteRest` fields; builder's call, but `note` keeps the full sentence for the SSR/SEO mirrors that read it).

- [ ] **Step 1: Update tests to the new contract**
  - `LandingPage.test.tsx`: delete the test "shows the promo banner and hides it (persisted) after dismissing"; add `it('renders no promo banner and shows the offer in the hero')` asserting `screen.queryByRole('region', { name: 'Oferta de lançamento' })` is null and `document.querySelector('.lp2-offer-text')` has text `30 dias grátis em qualquer plano pago. Cancele quando quiser.`. In the CTA-count test, leave the counts for Task 2 but fix nothing yet.
  - `LandingHydration.test.tsx` (~88, 131, 138) and `LandingSsr.test.tsx` (~64-68, 93-95): remove promo expectations (`data-promo-dismissed`, "Oferta de lançamento"); keep every other hydration assertion.
  - `prePaintScript.test.ts` (~23, 32, 41-47): remove the promo cases; add `it('never sets data-promo-dismissed')` with `localStorage.setItem('mesaas_promo_dismissed','1')` → attribute absent.
- [ ] **Step 2: Run them and see the new ones fail**
  Run: `npx vitest run apps/crm/src/pages/landing apps/crm/src/__tests__/prePaintScript.test.ts`
  Expected: FAIL on the new no-promo/offer assertions.
- [ ] **Step 3: Remove the promo bar (component, store, CSS, pre-paint branch) and update `hero.note` + offer markup**
- [ ] **Step 4: Resize the hero.** Starting values (verify in the browser in Task 8, adjust until Goal 1 holds):
  - `.lp-v2 .hero-wrap` padding-top `clamp(24px, 3vw, 44px)`.
  - `.lp-v2 .hero-title` `font-size: clamp(2.05rem, 4.6vw, 4.5rem)`, `line-height: 1.03`, `max-width: 1000px`.
  - `.lp-v2 .hero-sub` `margin-top: 16px`, `font-size: clamp(1rem, 1.35vw, 1.25rem)`, `line-height: 1.38`, `max-width: 760px`.
  - `.lp-v2 .lp2-offer` `margin-top: 24px`; `.lp2-offer-text` shows the strong part on the first line (desktop pill: two lines left of the buttons).
  - `.lp-v2 .hero-stage` `margin-top: 44px`.
  - ≤720px: title `clamp(2.05rem, 9.4vw, 2.3rem)` (≈33px at 360, 36px at 384), sub `1rem`, offer `padding: 14px 16px; gap: 10px; border-radius: 22px`, hero CTA buttons `height: 50px` (`min-height`, keep the `lg` padding otherwise).
- [ ] **Step 5: Run tests**
  Run: `npx vitest run apps/crm/src/pages/landing apps/crm/src/__tests__/prePaintScript.test.ts`
  Expected: PASS except the CTA-count test, which Task 2 settles (if it fails now on 12/6, update it to 12/6 with the promo removed from the comment; Task 2 brings it back to 13/7).
- [ ] **Step 6: Commit**
  `git add` the files above; `git commit -m "feat(landing): sem faixa promocional, oferta no hero e hero menor"`

## Task 2: Phone features disclosure + CTA after the features section

**Files:**
- Modify: `apps/crm/src/pages/landing/LandingPage.tsx` (`Features`)
- Modify: `apps/crm/src/pages/landing/landing-v2.css` (bento ≤900px block ~868)
- Test: `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx`

**Interfaces:**
- Consumes: `useLandingAuth()` from `LandingChrome.tsx` (`{ user, ready }`), as the Hero uses it.
- Produces: classes `lp2-card--extra` (cards at index 4 and 5), `lp2-bento[data-expanded]`, `lp2-more` (the toggle button), `lp2-features-cta` (CTA block).

- [ ] **Step 1: Write the failing tests** in `LandingPage.test.tsx`:
  - `it('keeps all six feature cards in the DOM and toggles the extra two')`: `document.querySelectorAll('.lp2-bento .lp2-card')` has length 6; the two with `.lp2-card--extra` are the Calendário and Automações cards (headings "Calendário editorial por cliente ou da operação inteira" and the "Comentou a palavra-chave…" one); button `getByRole('button', { name: 'Ver todas as funcionalidades' })` has `aria-expanded="false"` and `aria-controls` equal to the bento's `id`; after click, `aria-expanded="true"` and the bento has `data-expanded`.
  - `it('shows a trial CTA after the features for visitors')`: inside `.lp2-features-cta`, link "Começar teste grátis" → `/login?tab=register`, and the text `Teste tudo isso na sua agência.`.
  - `it('shows Acessar painel in the features CTA for signed-in users')`: with the signed-in auth mock the file already uses for the hero, `.lp2-features-cta` has link "Acessar painel" → `/dashboard` and no `/login?tab=register` link.
  - CTA-count test: promo link gone, features CTA added → `registerLinks` 13, `plainRegisterLinks` 7; update the comment to "Header + hero + features CTA + agent section + final CTA…".
  - `LandingHydration.test.tsx`: add `'.lp2-features-cta a'` to the `ctaLinks()` selectors so the new auth-gated CTA is hydration-covered, and extend its expectations with "Começar teste grátis" / "Acessar painel".
- [ ] **Step 2: Run, expect FAIL**
  Run: `npx vitest run apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx`
- [ ] **Step 3: Implement.** `const [expanded, setExpanded] = useState(false)` (same value on server and client). All six `<article>`s always render; index 4 and 5 add `lp2-card--extra`. Bento gets `id="lp2-bento"` and `data-expanded={expanded ? '' : undefined}`. After the bento: the `lp2-more` button (`type="button"`, `aria-expanded`, `aria-controls="lp2-bento"`, label "Ver todas as funcionalidades" + `ChevronDown`) and the note `<p className="lp2-more-note">Calendário editorial e resposta automática a comentários</p>`. The button stays mounted after expanding (the test reads its `aria-expanded`); CSS hides it and the note via `.lp-v2 .lp2-bento[data-expanded] ~ .lp2-more, .lp-v2 .lp2-bento[data-expanded] ~ .lp2-more-note { display: none }`. Then the `lp2-features-cta` block: heading-styled `<p>` "Teste tudo isso na sua agência.", the offer line ("<strong>30 dias grátis</strong> em qualquer plano pago. Cancele quando quiser."), and the auth-gated CTA (`!ready ? null : user ? Acessar painel → /dashboard : Começar teste grátis → /login?tab=register`, classes `lp-btn lp-btn-cta lg`, `ArrowRight`). CSS: `.lp2-more, .lp2-more-note { display: none }` by default; inside the existing `@media (max-width: 900px)` bento block only (do not add a `min-width` query that meets it at exactly 900px; one already exists at landing-v2.css ~1173): `.lp-v2 .lp2-bento:not([data-expanded]) .lp2-card--extra { display: none }` and the button shown full-width, outline pill, 52px. The CTA block is centered, max-width 560px, on all viewports. Do not add `reveal` to the new elements.
- [ ] **Step 4: Run, expect PASS** (same command)
- [ ] **Step 5: Commit** `git commit -m "feat(landing): funcionalidades com 'Ver todas' no celular e CTA depois da seção"`

## Task 3: Phone header shows "Entrar"; short CTA label ≤400px

**Files:**
- Modify: `apps/crm/src/pages/landing/LandingChrome.tsx` (`LandingHeader`, ~151-165)
- Modify: `apps/crm/src/pages/landing/landing.css` (≤820px block ~360; add ≤400px block), `landing-v2.css` (`.hdr-actions` ~429-441)
- Test: `apps/crm/src/pages/landing/__tests__/LandingChrome.links.test.tsx`, `LandingHydration.test.tsx` (`ctaLinks()` ~74-79 reads `textContent`, which becomes "Criar conta grátisCriar conta": change it to `a.getAttribute('aria-label') ?? a.textContent`)
- Also fix the stale promo-banner comment at `LandingChrome.tsx` ~79-80.

**Interfaces:**
- Produces: header CTA `<a href="/login?tab=register" className="lp-btn lp-btn-primary" aria-label="Criar conta grátis">` containing `<span className="hdr-cta-long">Criar conta grátis</span><span className="hdr-cta-short" aria-hidden="true">Criar conta</span>`.

- [ ] **Step 1: Write the failing tests** in `LandingChrome.links.test.tsx`, for both `variant="landing"` and `variant="subpage"`: `getByRole('link', { name: 'Entrar' })` → `/login`; `getAllByRole('link', { name: 'Criar conta grátis' })` has exactly one header match (scope to `.site-hdr`) → `/login?tab=register`; `.hdr-cta-short` has `aria-hidden="true"`.
- [ ] **Step 2: Run, expect FAIL** `npx vitest run apps/crm/src/pages/landing/__tests__/LandingChrome.links.test.tsx`
- [ ] **Step 3: Implement.** Markup per Interfaces. CSS: in the ≤820px block keep `.hdr-nav { display: none }` but show `.hdr-actions .link` with `padding: 8px` and hide its icon (`.hdr-actions .link svg { display: none }`); `.hdr-cta-short { display: none }` by default; `@media (max-width: 400px) { .hdr-cta-long { display: none } .hdr-cta-short { display: inline } .hdr-actions { gap: 4px } .hdr-inner { padding-inline: 16px } }` (adjust to the real header inner class). Logo height on phones ≈18px. Must fit one row at 360px including the subpage theme toggle (checked in Task 8).
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `git commit -m "feat(landing): 'Entrar' no cabeçalho do celular"`

## Task 4: Compact cookie banner (global)

**Files:**
- Modify: `apps/crm/src/components/consent/CookieConsent.tsx` (banner markup ~57-106)
- Modify: `packages/i18n/locales/pt/common.json`, `packages/i18n/locales/en/common.json` (`cookies.banner`)
- Modify: `apps/crm/style.css` (banner rules ~2200-2260)
- Test: `apps/crm/src/components/consent/__tests__/CookieConsent.test.tsx`

**Interfaces:**
- Produces i18n keys (pt / en):
  - `cookies.banner.bodyShort`: `Usamos cookies para análise de uso, incluindo gravação de sessão, chat de suporte e medição de anúncios.` / `We use cookies for usage analytics, including session recording, support chat and ad measurement.`
  - `cookies.banner.details`: `Detalhes` / `Details`
  - `cookies.banner.acceptAll` value → `Aceitar` / `Accept`; `cookies.banner.rejectAll` value → `Rejeitar` / `Reject` (only the banner uses them).
  - `title` stays (aria-label); `body` and `learnMore` may be deleted if unused, in both locales or neither (`packages/i18n/__tests__/locales.test.ts` checks parity).
- Keep the rule `html[data-consent-stored] #root[data-ssr] .cookie-banner` in `style.css` verbatim (`prePaintScript.test.ts` regex-matches it).

- [ ] **Step 1: Update tests**: button names `Rejeitar` / `Aceitar` / `Personalizar`; region `aria-label` "Cookies e privacidade" still present; add `it('shows one short sentence and no visible title')`: region text contains `gravação de sessão` and the link `Detalhes` → `/lgpd`, and no element inside the region has text exactly `Cookies e privacidade`.
- [ ] **Step 2: Run, expect FAIL** `npx vitest run apps/crm/src/components/consent`
- [ ] **Step 3: Implement.** Remove the title `<p>`; one `<p className="text-muted-foreground text-xs sm:text-sm">` with `bodyShort` + `<Link to="/lgpd" className="underline">{details}</Link>`. Container: `fixed inset-x-2.5 bottom-2.5 sm:inset-x-4 sm:bottom-4 … px-3 py-2.5 sm:px-5 sm:py-3`, `flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5`. Buttons row: `grid grid-cols-3 gap-1.5 sm:flex sm:shrink-0`, each `Button size="sm"` with `h-8` on phones. Same variants as today (ghost, outline, outline). Keep `aria-live`, focus/dialog logic untouched. In `style.css` delete nothing that the landing override needs; the `p.text-muted-foreground` landing selector keeps working. Target ≈110px tall at 360px wide.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `git commit -m "feat(consent): banner de cookies compacto"`

## Task 5: Three-field signup form with inline errors

**Files:**
- Create: `apps/crm/src/pages/login/signupValidation.ts`
- Modify: `apps/crm/src/pages/login/LoginPage.tsx` (register state ~, `handleRegister` ~159-230, form ~447-536)
- Modify: `packages/i18n/locales/pt/auth.json`, `packages/i18n/locales/en/auth.json` (`register`; add/delete keys in both locales or neither)
- Test: `apps/crm/src/pages/login/__tests__/signupValidation.test.ts` (create), `apps/crm/src/pages/login/__tests__/LoginPage.test.tsx`, `apps/crm/src/pages/login/__tests__/signupStarted.test.tsx` (:56 focuses `reg-telefone`; change it to `reg-password`)
- Remove imports left unused in `LoginPage.tsx` (`Checkbox`, anything else).

**Interfaces:**
- Produces:
  - `export type SignupField = 'nome' | 'email' | 'password'`
  - `export function validateSignup(v: { nome: string; email: string; password: string }): Partial<Record<SignupField, 'nameRequired' | 'emailInvalid' | 'passwordShort'>>` (trims nome/email; email regex `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`; password length ≥ 8)
  - `export function signupErrorKey(error: { code?: string; status?: number; message?: string }): 'rateLimit' | 'weakPassword' | 'emailInvalid' | 'generic'` (`status === 429` or code containing `rate_limit` → rateLimit; code `weak_password` → weakPassword; code `email_address_invalid` or `validation_failed` with "email" in message → emailInvalid; else generic)
- i18n keys (pt; en mirrors): `register.fullName` "Nome completo", `register.submit` "Criar conta", `register.passwordPlaceholder` "Crie uma senha", `register.passwordHelp` "Mínimo de 8 caracteres.", `register.nextStepNote` "Depois de confirmar o e-mail, você informa o nome da agência e o telefone.", `register.errors.nameRequired` "Informe seu nome.", `register.errors.emailInvalid` "Informe um e-mail válido, como nome@empresa.com.", `register.errors.passwordShort` "A senha precisa ter pelo menos 8 caracteres.", `register.errors.rateLimit` "Muitas tentativas. Aguarde um minuto e tente de novo.", `register.errors.weakPassword` "Essa senha é fraca. Use uma senha mais longa ou menos comum.", `register.errors.generic` "Não foi possível criar a conta. Tente de novo em instantes.". Keep `register.phoneHint` and `register.marketingOptIn` (the setup page copies their text). The `tabs.register` label stays.

- [ ] **Step 1: Write `signupValidation.test.ts`**: `validateSignup({nome:'  ', email:'ana@agencia', password:'abc123'})` → `{ nome:'nameRequired', email:'emailInvalid', password:'passwordShort' }`; `validateSignup({nome:'Ana', email:' ana@agencia.com ', password:'12345678'})` → `{}`; `signupErrorKey({status:429})` → `'rateLimit'`; `signupErrorKey({code:'weak_password'})` → `'weakPassword'`; `signupErrorKey({code:'email_address_invalid'})` → `'emailInvalid'`; `signupErrorKey({message:'boom'})` → `'generic'`.
- [ ] **Step 2: Update `LoginPage.test.tsx`**: `fillRegisterForm` (~103-115) stops setting `reg-empresa`, `reg-telefone`, `reg-confirm`; `getByLabelText('Nome Completo')` (~136, 212, 229, 238, 264) → `'Nome completo'`; delete the password-mismatch test (~209-233); the signUp payload test (~262-277) drops the checkbox and expects the new meta; rewrite the "whitespace-only company" / "trims the name and company" tests (~318-333) for the name only; fix ~347. The register form has exactly "Nome completo", "E-mail" and the password field "Senha"; no "Nome da Empresa", "Telefone", "Confirmar Senha", no checkbox. New tests:
  - `it('shows inline errors and does not call signUp on an invalid submit')`: submit empty → texts `Informe seu nome.`, `Informe um e-mail válido, como nome@empresa.com.`, `A senha precisa ter pelo menos 8 caracteres.` visible; `signUp` mock not called; the "Nome completo" input has `aria-invalid="true"` and `aria-describedby` pointing at its error; focus is on it; no `toast.error` call.
  - `it('signs up with empresa empty and no phone')`: valid values (email with surrounding spaces) → `signUp` called once with `('ana@agencia.com', '12345678', { nome: 'Ana', empresa: '' }, confirmRedirectPath)` (plus `ref_code` only when stored); meta has no `telefone` / `marketing_opt_in` keys.
  - `it('maps a server error to Portuguese copy')`: `signUp` resolves `{ error: { status: 429, message: 'email rate limit exceeded' } }` → `Muitas tentativas. Aguarde um minuto e tente de novo.` shown, raw message absent.
  - `it('submits once on a double click')`: two rapid clicks → one `signUp` call.
- [ ] **Step 3: Run, expect FAIL** `npx vitest run apps/crm/src/pages/login`
- [ ] **Step 4: Implement `signupValidation.ts`**, then in `LoginPage.tsx`: remove `regEmpresa`, `regTelefone`, `regConfirm`, `regMarketingOptIn` state and their fields; form `noValidate`; `const [regErrors, setRegErrors] = useState<Partial<Record<SignupField, string>>>({})` and `const [regAttempted, setRegAttempted] = useState(false)`; on submit validate, set errors, focus the first invalid input (refs or `document.getElementById('reg-…')`), return; after the first attempt re-validate on change. Each field: `aria-invalid`, `aria-describedby="reg-<field>-error"` when invalid, error `<p id="reg-<field>-error" className="…" style={{ color: 'var(--danger-text)', fontSize: '0.8rem' }}>`. Password keeps `PasswordInput` (show/hide), `autoComplete="new-password"`, help text under it when there is no error. Inputs keep ids `reg-nome`, `reg-email`, `reg-password`. `signUp(email.trim(), password, { nome, empresa: '', ...(refCode ? { ref_code: refCode } : {}) }, confirmRedirectPath)`. On `error`: `setRegFormError(t('register.errors.' + signupErrorKey(error)))` rendered above the button (`role="alert"`), never `error.message`. Keep the existing-account / identify / Meta / navigate / success branches as they are; reset only the remaining fields. Add the `nextStepNote` paragraph under the button. Replace the old "Preencha seu nome e o nome da empresa." toast and the `passwordMismatch` path.
- [ ] **Step 5: Run, expect PASS** (same command; `signupStarted.test.tsx` included)
- [ ] **Step 6: Commit** `git commit -m "feat(signup): cadastro com nome, e-mail e senha e erros no campo"`

## Task 6: Setup gate keeps `next`; `patchProfile`; setup helpers

**Files:**
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx` (~116-122)
- Modify: `apps/crm/src/lib/supabase.ts` (next to `getCurrentProfile` ~49)
- Modify: `apps/crm/src/lib/__mocks__/supabase.ts` (the automock `AuthContext.test.tsx` uses; add `patchCachedProfile` merging into its `currentProfile` ~169-174)
- Modify: `apps/crm/src/context/AuthContext.tsx` (context type ~193, provider value ~1140)
- Create: `apps/crm/src/pages/workspace-setup/setupHelpers.ts`
- Test: `apps/crm/src/components/layout/__tests__/ProtectedRoute.test.tsx`, `apps/crm/src/pages/workspace-setup/__tests__/setupHelpers.test.ts` (create), `apps/crm/src/context/__tests__/AuthContext.patchProfile.test.tsx` (create, or add to an existing AuthContext test file that already renders the provider)

**Interfaces:**
- Produces:
  - `export function patchCachedProfile(patch: Record<string, unknown>): void` in `lib/supabase.ts` — merges into the module-level `cachedProfile` when it is non-null; no-op otherwise.
  - `patchProfile: (patch: Partial<Profile>) => void` on the auth context — calls `patchCachedProfile(patch)` and `setProfile((prev) => (prev ? { ...prev, ...patch } : prev))`. No `loading` change, no network. `refetchProfile` is unchanged.
  - `export function slugifyWorkspaceName(name: string): string` — first replace `ß→ss`, `æ→ae`, `œ→oe`, `ø→o`, `ł→l`, `đ→d`, `þ→th` (lowercase input), then `.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')`, `''` → `'workspace'`.
  - `export function workspaceSlugSuffix(workspaceId: string): string` — `workspaceId.replace(/-/g, '').slice(0, 8)`.
  - `export function isPlaceholderSlug(slug: string | null | undefined, workspaceId: string): boolean` — `slug === 'workspace-' + workspaceSlugSuffix(workspaceId)`.
  - `export function isValidBrPhone(value: string): boolean` — digit count after stripping non-digits is 10 to 13.
  - `export function safeNextPath(next: string | null): string | null` — returns `next` only when it starts with `/`, not `//` or `/\`, and its pathname is not `/workspace-setup`; else `null`.
  - ProtectedRoute redirect target: `` `/workspace-setup?next=${encodeURIComponent(location.pathname + location.search)}` ``.

- [ ] **Step 1: Write `setupHelpers.test.ts`**: `slugifyWorkspaceName('Agência Ótima & Cia')` → `'agencia-otima-cia'`; `slugifyWorkspaceName('Straße Æon')` → `'strasse-aeon'`; `slugifyWorkspaceName('✨')` → `'workspace'`; `slugifyWorkspaceName('  Estúdio Lumen  ')` → `'estudio-lumen'`; `workspaceSlugSuffix('3f9a1c2b-0000-4000-8000-000000000000')` → `'3f9a1c2b'`; `isPlaceholderSlug('workspace-3f9a1c2b', '3f9a1c2b-…')` true, `isPlaceholderSlug('agencia-3f9a1c2b', …)` false, `isPlaceholderSlug(null, …)` false; `isValidBrPhone('(11) 99999-9999')` true, `isValidBrPhone('+55 11 99999-9999')` true, `isValidBrPhone('1234')` false, `isValidBrPhone('12345678901234')` false; `safeNextPath('/comecar?plan=pro&interval=year')` same string, `safeNextPath('//evil.com')` null, `safeNextPath('https://evil.com')` null, `safeNextPath('/workspace-setup?next=x')` null, `safeNextPath(null)` null.
- [ ] **Step 2: ProtectedRoute test** (~356; the harness at ~56-61 mounts `/comecar` outside `ProtectedRoute`): render at `/dashboard?plan=pro&interval=year` as an owner with `empresa: ''`; give the `/workspace-setup` route a location probe element (`useLocation()` → renders `location.search`) and assert it shows `?next=%2Fdashboard%3Fplan%3Dpro%26interval%3Dyear`; an owner with `empresa: 'Agência'` is not redirected; `/workspace-setup` itself renders children.
- [ ] **Step 3: patchProfile test**: with a loaded profile `{ empresa: '' }`, `patchProfile({ empresa: 'Agência', telefone: '11999999999' })` → the consumer sees `profile.empresa === 'Agência'` on the next render, `loading` never becomes `true` (record every value), the `getCurrentProfile` spy call count does not change, and (in a separate `lib/supabase` unit test against the real module, or by asserting `patchCachedProfile` was called with the patch) the module cache receives the patch.
- [ ] **Step 4: Run, expect FAIL** `npx vitest run apps/crm/src/pages/workspace-setup apps/crm/src/components/layout apps/crm/src/context`
- [ ] **Step 5: Implement** helpers, the redirect target, `patchCachedProfile` and `patchProfile`.
- [ ] **Step 6: Run, expect PASS**
- [ ] **Step 7: Commit** `git commit -m "feat(setup): next na URL do passo 2, patchProfile e helpers"`

## Task 7: Setup page (company, phone, opt-in, slug, look)

**Files:**
- Create: `apps/crm/src/pages/workspace-setup/saveWorkspaceSetup.ts`
- Modify: `apps/crm/src/pages/workspace-setup/WorkspaceSetupPage.tsx` (rewrite)
- Modify: `apps/crm/src/pages/workspace-setup/workspace-setup.css`
- Modify: `apps/crm/src/lib/analytics.ts` (`AnalyticsEvent` union)
- Test: `apps/crm/src/pages/workspace-setup/__tests__/saveWorkspaceSetup.test.ts`, `apps/crm/src/pages/workspace-setup/__tests__/WorkspaceSetupPage.test.tsx` (create both)

**Interfaces:**
- Consumes: Task 6 helpers (`slugifyWorkspaceName`, `workspaceSlugSuffix`, `isPlaceholderSlug`, `isValidBrPhone`, `safeNextPath`) and `patchProfile(patch)`.
- Produces:
  - `export async function saveWorkspaceSetup(input: { userId: string; workspaceId: string; nome: string; empresa: string; telefone: string; marketingOptIn: boolean }): Promise<void>` — throws on any required-write error. Order: (1) `select('slug')` from `workspaces` by id (error → throw); (2) `newSlug = isPlaceholderSlug(slug, workspaceId) ? slugifyWorkspaceName(empresa) + '-' + workspaceSlugSuffix(workspaceId) : undefined`; `workspaces.update({ name: empresa, ...(newSlug ? { slug: newSlug } : {}) })` (error → throw); (3) `contas.update({ nome: empresa, ...(newSlug ? { slug: newSlug } : {}) })`, result ignored (best-effort mirror); (4) one `profiles.update({ nome, telefone, marketing_opt_in: marketingOptIn, empresa })` by `userId` (error → throw). Inputs arrive trimmed.
  - `AnalyticsEvent` gains `'workspace_setup_completed'`.

- [ ] **Step 1: Write `saveWorkspaceSetup.test.ts`** with a chainable supabase mock (`vi.mock('../../../lib/supabase')`) recording calls in order:
  - placeholder slug `workspace-3f9a1c2b` + empresa "Agência Ótima" → workspaces update payload `{ name: 'Agência Ótima', slug: 'agencia-otima-3f9a1c2b' }`; contas update payload `{ nome: 'Agência Ótima', slug: 'agencia-otima-3f9a1c2b' }`; a contas update that returns `{ error }` does not reject; profiles update `{ nome: 'Ana', telefone: '(11) 99999-9999', marketing_opt_in: true, empresa: 'Agência Ótima' }`; profiles update is the last call.
  - existing slug `agencia-velha-3f9a1c2b` → workspaces payload has no `slug` key.
  - workspaces update returns `{ error }` → rejects, and profiles is never updated.
- [ ] **Step 2: Write `WorkspaceSetupPage.test.tsx`** (MemoryRouter at `/workspace-setup?next=%2Fcomecar%3Fplan%3Dpro`, mocked `useAuth` with `profile: { nome: 'Ana', empresa: '', active_workspace_id: 'ws-1', conta_id: 'ws-1' }`, `user: { id: 'u-1' }`, `patchProfile: vi.fn()`, `refetchProfile: vi.fn()`, mocked `saveWorkspaceSetup` and `captureEvent`):
  - renders "Passo 2 de 2", heading "Falta pouco", "Seu nome" prefilled "Ana", empty "Nome da empresa ou agência", "Telefone / WhatsApp" with the hint text, unchecked opt-in checkbox.
  - empty company + "1234" phone → `Informe o nome da empresa ou agência.` and `Informe um telefone com DDD, como (11) 99999-9999.`; `saveWorkspaceSetup` not called.
  - valid submit → `saveWorkspaceSetup` called once with trimmed values; then `patchProfile` called with `{ nome, empresa, telefone, marketing_opt_in }`; `refetchProfile` never called; `captureEvent('workspace_setup_completed')`; navigation to `/comecar?plan=pro` (assert via a route element at `/comecar` rendering a marker).
  - no `next` → navigates to `/comecar`.
  - `saveWorkspaceSetup` rejects → inline `role="alert"` text `Não foi possível salvar. Tente de novo.`, inputs keep their typed values, no navigation.
  - double click "Continuar" → `saveWorkspaceSetup` called once.
- [ ] **Step 3: Run, expect FAIL** `npx vitest run apps/crm/src/pages/workspace-setup`
- [ ] **Step 4: Implement `saveWorkspaceSetup.ts`**, add the analytics event, then rewrite the page:
  - Read `next` with `useSearchParams()`; target = `safeNextPath(next) ?? '/comecar'`.
  - Fields (ids `setup-nome`, `setup-empresa`, `setup-telefone`, `setup-optin`): Seu nome (prefilled `profile.nome`), Nome da empresa ou agência (empty), Telefone / WhatsApp (`type="tel"`, `inputMode="tel"`, `autoComplete="tel"`, placeholder `(11) 99999-9999`, hint `Usaremos para enviar informações da sua conta por SMS e WhatsApp.`), Checkbox `Aceito receber novidades e comunicações de marketing por SMS e WhatsApp. Você pode cancelar quando quiser.`
  - Validation on submit (then on change): nome non-blank (`Informe seu nome.`), empresa non-blank (`Informe o nome da empresa ou agência.`), phone `isValidBrPhone` (`Informe um telefone com DDD, como (11) 99999-9999.`); inline errors with `aria-invalid`/`aria-describedby`, focus first invalid; `noValidate`.
  - Submit: `saving` guard + disabled button with `Spinner`; `await saveWorkspaceSetup(...)`; `patchProfile({ nome, empresa, telefone, marketing_opt_in })` (no `refetchProfile`: it flips the global `loading` and its failure path returns the cached pre-setup profile); `captureEvent('workspace_setup_completed')`; `navigate(target, { replace: true })`. Catch: set the alert text, log with `console.error`, keep state. Remove the success screen, the progress bar and the 2.8s timer, the emoji and the green palette, and imports left unused (`toast`).
  - Markup/look: `<div className="auth-wrapper workspace-setup-shell"><div className="auth-card">` with the black logo (`/logo-black.svg`, height ≈26px, centered), a `setup-step` pill "Passo 2 de 2", `<h1>` "Falta pouco", sub "Conte um pouco sobre sua agência para configurarmos seu espaço.", form with `auth-form` spacing, `Button className="btn-primary auth-submit w-full"` "Continuar" + `ArrowRight`, footer `auth-footer` "Você pode alterar essas informações depois em Configurações.".
  - CSS (`workspace-setup.css`): keep the `100dvh` + safe-area padding on `.workspace-setup-shell` but drop its `background` so `.auth-wrapper`'s gradient shows; add `.setup-step` (12px, 600, `#4b5563` on `#f5f6f8`, pill) and heading/sub styles matching the mockup (24px/700 heading, 14px sub `#374151`). Do not edit `.auth-wrapper` itself.
- [ ] **Step 5: Run, expect PASS** (same command)
- [ ] **Step 6: Commit** `git commit -m "feat(setup): passo 2 com empresa, telefone e visual do login"`

## Task 8: Verification (orchestrator)

**Files:** none new. Fix whatever this turns up in the owning task's files.

- [ ] **Step 1: Static gates**
  Run each: `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p apps/mcp-widgets/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run lint`, `npm run format:check`.
  Expected: all exit 0.
- [ ] **Step 2: Full unit suite** `npm run test` (also `TZ=UTC npx vitest run apps/crm/src/pages/landing apps/crm/src/pages/login apps/crm/src/pages/workspace-setup`). Expected: PASS. `apps/crm/src/__tests__/cssSplitBoundary.test.ts` must stay green.
- [ ] **Step 3: Prerender smoke** `npx vite build` with placeholder `VITE_*` (as the CI job does), then `npm run prerender`; `grep -c 'data-ssr="landing"' dist/index.html` ≥ 1 and `grep -c 'lp2-hero' dist/index.html` ≥ 1; `grep -c 'promo-banner' dist/index.html` = 0.
- [ ] **Step 4: Browser (dev server, cleared storage, banner open, after the `lp2-rise` animation)**: for each size 360×660, 375×667, 384×730, 390×844, 1280×720, 1366×768, 1470×762, 1440×900 record the hero primary CTA `getBoundingClientRect().bottom` and the banner `top`; pass when CTA bottom < banner top and (laptop) CTA bottom ≤ viewport height − 24. Header fits one row at 360 on `/` and `/precos`. Features at 384: 4 cards, button expands to 6. Signup at 390: empty submit, bad email, short password show inline errors. Setup page layout at 390 and 1440 (seed login).
- [ ] **Step 5: Commit any fixes** with the owning task's message prefix.
- [ ] **Step 6: Deliver spec §7** in the final summary: Google Ads → Administrador → Configurações da conta → Rastreamento → Sufixo do URL final = `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}`.

---

## Execution notes

- Independent groups (disjoint files): **A** = Tasks 1 → 2 → 3 (landing files, sequential), **B** = Task 4, **C** = Tasks 5 → 6 → 7 (sequential, one implementer). A, B and C may run in parallel. Task 8 runs after all.
- Each implementer runs only its own test paths and `tsc -p apps/crm/tsconfig.json --noEmit` filtered to its files (another group may be mid-edit).
