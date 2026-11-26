# English US site (`/en`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/en`, `/en/pricing`, `/en/privacy`, `/en/terms`, a US opt-out consent model and an `/en` signup that yields a USD workspace with the app in English.

**Architecture:** One set of landing components with a `locale` prop and one typed content module per language (`landing.content.ts` / `landing.content.en.ts`). `/en` is server-rendered by the existing prerender script like `/`; the other `/en` pages use the existing mirror and `renderToStaticMarkup` paths. A new `billing_market_apply()` RPC repairs a US signup that the part 1 trigger left in BRL. GPC is folded into `getConsent()` so no pixel can load under it.

**Tech Stack:** React 19, React Router v7 data router, react-i18next, Vite SSR prerender (`scripts/seo/prerender.tsx`), Vitest + Testing Library, Supabase Postgres (psql entitlement suites), Vercel rewrites.

**Spec:** `docs/superpowers/specs/2026-11-25-us-english-site-design.md` (read it before any task).

## Global Constraints

- No behavior or output change on the Portuguese landing, `/precos`, `/politica-de-privacidade`, `/termos-de-uso`, `/lgpd` or the Brazilian opt-in banner. `trial-claims.test.ts` passes untouched.
- No em-dashes in user-facing copy, English included. US spelling.
- Never "approved by Meta"; "official Meta API" is fine.
- Prerender rules: no browser reads (storage, `document`, `matchMedia`, `navigator`) during render; no module-level `window`/`document`/`localStorage` access anywhere (the SSR bundle runs every module's top level in Node).
- `type SiteLocale = 'pt' | 'en'`; English routes are exactly `/en`, `/en/pricing`, `/en/privacy`, `/en/terms`.
- Signup market value is exactly the lowercase string `us` in `user_metadata.market`.
- USD prices on `/en`: Free `$0`; a paid plan shows only when both `price_usd` and `price_usd_annual` are non-null; formatted with `formatPlanPrice(cents, 'usd', 'en-US')` from `apps/crm/src/lib/planPrice.ts`.
- Pinned English copy (verbatim):
  - Hero note: `14 days of Pro free, no card required. At the end, you decide whether to stay.`
  - Pricing promo: `Create your account and use Pro for 14 days, no card required.`
  - No USD plans: `Paid plans in US dollars are coming soon.`
  - US notice: `We use cookies for analytics and advertising.` with links `Do Not Sell or Share My Personal Information` and `Cookie settings`
  - Do Not Sell toast: `Done. We won't sell or share your personal information for advertising.`
  - GPC line in the dialog: `Your browser sent Global Privacy Control, so advertising stays off.`
  - Footer language links: `Versão em português` (on `/en` pages, to `/`), `English` (on `/` pages, to `/en`)
- Stored phone for USD workspaces: digits only, country code first, no `+` (`14155550132`).
- Migration version prefix must be unique and above main's tail (`20261205000002` today); use `20261207000001` and recheck before the PR.
- Before pushing: `npm run lint`, `npm run format:check`, the five `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions` (CLAUDE.md, "What CI actually runs").

## Review Focus

1. A visitor whose saved language is `pt` opens `/en`: the page must render and stay English after hydration (not flip to Portuguese when `SavedLanguageSync` runs). Test in Task 7.
2. `/en/` with a trailing slash and an unknown `/en/whatever`: the first redirects to `/en`, the second gets the 404 file, never the app shell. Test in Task 7.
3. `market` query variants (`US`, `us%20`, `br`, repeated `market=us&market=br`, absent): only an exact single `us` is sent as metadata. Test in Task 9.
4. Phone formats on a USD workspace: `+1 (415) 555-0132`, `415.555.0132`, `+44 20 7946 0958` accepted and stored as digits; `123` and `+1 555` rejected with the English error. Test in Task 10.
5. Consent edge cases: an old record with no `basis` plus GPC gives `marketing: false`; `localStorage` throwing on an `/en` first visit still yields the in-memory US default and no Brazilian banner. Test in Task 8.

---

### Task 1: `billing_market_apply()` RPC

**Files:**
- Create: `supabase/migrations/20261207000001_billing_market_apply.sql`
- Create: `supabase/tests/entitlements/99_billing_market_apply.sql`

**Interfaces:**
- Produces: `public.billing_market_apply() RETURNS text` (`'usd'` or `'brl'`, the caller's active workspace currency after the call). Callable via `supabase.rpc('billing_market_apply')`.

- [ ] **Step 1: Write the failing SQL test** following the style of `supabase/tests/entitlements/99_usd_billing_currency.sql` (helpers from `_helpers.sql`, `et_grant_hosted_parity()` before raw selects as `authenticated`). Cases:
  - owner with `raw_user_meta_data->>'market' = 'us'`, workspace `brl`, unlocked, no provider row → returns `'usd'`, row now `usd`;
  - same caller called twice → still `'usd'`, no error;
  - owner without market → returns `'brl'`, unchanged;
  - US owner whose workspace has `billing_currency_locked_at` set → `'brl'`, unchanged;
  - US owner whose workspace has a `workspace_subscriptions` row with `stripe_customer_id` → `'brl'`, unchanged;
  - invited member (`conta_id` in metadata, not owner) of a BRL workspace → `'brl'`, unchanged;
  - `anon` has no EXECUTE; `authenticated` has EXECUTE.
- [ ] **Step 2: Run it to verify it fails**: `bash scripts/test-entitlements.sh` (needs Docker/colima; if unavailable, run the file on a scratch DB as in the part 1 work). Expected: function does not exist.
- [ ] **Step 3: Write the migration.** `SECURITY DEFINER`, `SET search_path = public, pg_temp`, no arguments. Reads `auth.uid()`; reads market from `auth.users` for that id (never from an argument); resolves the caller's active workspace (`profiles.active_workspace_id`, fallback `profiles.conta_id`); requires the caller to be its owner (`workspace_members` role `owner`); applies only when market = `us`, `billing_currency_locked_at IS NULL` and no `workspace_subscriptions` row for that workspace with any of `stripe_customer_id`, `stripe_subscription_id`, `pagarme_customer_id`, `pagarme_subscription_id` (same rule as `billing_currency_set` in `20261205000001_usd_billing_schema.sql`). The update must pass the workspace billing guard trigger (it runs as definer, as `billing_currency_set` does; mirror how that function performs its update). `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE ... TO authenticated`.
- [ ] **Step 4: Run the test**: expected PASS for every case.
- [ ] **Step 5: Commit** `feat(billing): billing_market_apply corrige cadastro dos EUA que ficou em BRL`.

### Task 2: Locale helpers and content modules

**Files:**
- Create: `apps/crm/src/content/locale.ts`
- Create: `apps/crm/src/content/landing.content.en.ts`
- Create: `apps/crm/src/content/precos.content.en.ts`
- Modify: `apps/crm/src/content/landing.content.ts` (export the type; add fields for strings that are hardcoded in components today)
- Test: `apps/crm/src/content/__tests__/locale.test.ts`, `apps/crm/src/content/__tests__/landing-content-parity.test.ts`

**Interfaces:**
- Produces:
  - `export type SiteLocale = 'pt' | 'en'`
  - `export function siteLocaleForPath(pathname: string): SiteLocale` (`'/en'` and `'/en/...'` → `'en'`; `'/english'`, `'/'`, anything else → `'pt'`)
  - `export type SitePageKey = 'home' | 'pricing' | 'privacy' | 'terms'`
  - `export function localizedPath(locale: SiteLocale, key: SitePageKey): string` (pt: `/`, `/precos`, `/politica-de-privacidade`, `/termos-de-uso`; en: `/en`, `/en/pricing`, `/en/privacy`, `/en/terms`)
  - `export function signupHref(locale: SiteLocale, planIntent?: string): string` (pt: today's `/login?tab=register` plus the existing intent query; en: same plus `market=us`)
  - `export type LandingContent` (the type of `LANDING`), `export function landingContent(locale: SiteLocale): LandingContent`
  - `export const LANDING_EN: LandingContent`, `export const PRECOS_EN` with the same type as `PRECOS`, `export function precosContent(locale)`.

- [ ] **Step 1: Write failing tests.** `locale.test.ts`: the mappings above, including `siteLocaleForPath('/en/')` → `'en'`, `'/enx'` → `'pt'`, and `signupHref('en', 'pro')` contains `market=us` and the same intent param name `signupHref('pt', 'pro')` uses. `landing-content-parity.test.ts`: `LANDING_EN` has the same number of features, ticker items, how steps and FAQ items as `LANDING`; no English string contains `—`; `LANDING_EN.hero.note` equals the pinned hero note.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/content/__tests__/locale.test.ts apps/crm/src/content/__tests__/landing-content-parity.test.ts`. Expected FAIL (modules missing).
- [ ] **Step 3: Implement.** Move into `LandingContent` every user-visible string currently hardcoded in `pages/landing/*.tsx` (mock dashboard labels and values at `LandingPage.tsx:225-227`, `lp2-more-note`, features CTA title, agent eyebrow, how CTA line, signed-in "Bem-vindo de volta!" block, `PLAN_MARKETING` descriptions and CTAs from `PricingSection.tsx:21-39`, nav and footer labels from `LandingChrome.tsx`, plan comparison row labels, pricing promo note) with today's exact Portuguese in `LANDING`. Write `LANDING_EN` and `PRECOS_EN` in English (plain, concrete, US spelling; FAQ drops Pagar.me/12x and says card via Stripe, billed in USD, cancel anytime). Mock dashboard numbers use US formatting (`96,826`).
- [ ] **Step 4: Run** the two tests. Expected PASS.
- [ ] **Step 5: Commit** `feat(landing): conteúdo por idioma e helpers de locale`.

### Task 3: Landing components take `locale`

**Files:**
- Modify: `apps/crm/src/pages/landing/LandingPage.tsx`, `LandingChrome.tsx`, `FaqSection.tsx`, `PlanComparison.tsx`, `landing-visuals.tsx`, `Testimonials.tsx` (no prop; just not rendered for `en`)
- Test: `apps/crm/src/pages/landing/__tests__/landing-locale.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`SiteLocale`, `landingContent`, `localizedPath`, `signupHref`).
- Produces: `LandingPage({ locale = 'pt' }: { locale?: SiteLocale })`; `LandingChrome` props gain `locale?: SiteLocale`; the footer links per locale; `/en` renders no `Testimonials`.

- [ ] **Step 1: Before editing any component, write the baseline test.** Render `<LandingPage />` inside a `MemoryRouter` with `renderToStaticMarkup` (mock the pricing query as the existing landing tests do) and save the output as an inline snapshot (`toMatchInlineSnapshot` or a committed `__snapshots__` file). Commit this test first, green against the unchanged code.
- [ ] **Step 2: Add failing English assertions** in the same file: `<LandingPage locale="en" />` contains the pinned hero note, `Versão em português` linking to `/`, every signup link contains `market=us`, no text from `Testimonials`, no `CNPJ`, no `LGPD`, and every `/landing/` image `src` points at `/landing/en/` only when that file exists in `apps/crm/public/landing/en/` (fallback to the Portuguese path otherwise).
- [ ] **Step 3: Run** `npx vitest run apps/crm/src/pages/landing/__tests__/landing-locale.test.tsx`. Expected: baseline PASS, English FAIL.
- [ ] **Step 4: Implement.** Thread `locale` through; read all copy from `landingContent(locale)`; footer entity line for `en`: `© {year} Mesaas, operated by EBS IT SOLUTIONS (Salvador, Brazil)`; `en` footer links: Pricing, Privacy Policy, Terms of Service, Cookie settings, Do Not Sell or Share My Personal Information (Task 8 wires the last two; render them as buttons calling `openConsentPreferences()` and a no-op placeholder prop `onDoNotSell` that Task 8 fills), `Versão em português`. `pt` footer gains `English` → `/en`. The image fallback is resolved at build time from a static list (a const array of available English image names), never by a runtime file check.
- [ ] **Step 5: Run** the test file and `npx vitest run apps/crm/src/pages/landing`. Expected: PASS, baseline snapshot unchanged except the new `English` footer link (update the snapshot for that one link only and say so in the commit).
- [ ] **Step 6: Commit** `feat(landing): LandingPage com locale; /en sem depoimentos`.

### Task 4: USD pricing section and English pricing page

**Files:**
- Modify: `apps/crm/src/services/billing.ts` (`PublicPricingPlan` + `listPublicPricingPlans` select gain `price_usd, price_usd_annual`)
- Modify: `apps/crm/src/pages/landing/PricingSection.tsx`, `apps/crm/src/pages/precos/PrecosPage.tsx`, `apps/crm/src/content/precos.seo.ts`
- Create: `apps/crm/src/content/__tests__/trial-claims.en.test.ts`
- Test: `apps/crm/src/pages/landing/__tests__/pricing-usd.test.tsx`, extend `apps/crm/src/content/__tests__/precos.seo.test.ts`

**Interfaces:**
- Consumes: Task 2 (`precosContent`, `landingContent`, `signupHref`), `formatPlanPrice` from `lib/planPrice.ts`.
- Produces: `PricingSection({ locale = 'pt' })`, `PrecosPage({ locale = 'pt' })`, `renderPrecosHtml(locale: SiteLocale = 'pt')`.

- [ ] **Step 1: Failing tests.** `pricing-usd.test.tsx` with a mocked plan list:
  - `locale="en"`, plans Free (0/0), Start (2900/27900), Pro (4900/46900), Max (7900/75900) → shows `$0`, `$29`, `$49`, `$79`; annual toggle shows `$279`, `$469`, `$759`; no `R$`, no `12x`, no Pagar.me text.
  - Max with `price_usd_annual: null` → Max absent from cards and comparison.
  - all paid plans missing USD → only Free plus `Paid plans in US dollars are coming soon.`
  - `locale` default → output unchanged for the BRL fixture (existing assertions still hold).
  `trial-claims.en.test.ts`: `LANDING_EN.hero.note` and the English pricing promo equal the pinned strings; any English string mentioning `30 days` also contains `with card`. `precos.seo.test.ts`: `renderPrecosHtml('en')` is English and has no `R$`; `renderPrecosHtml()` output unchanged.
- [ ] **Step 2: Run** the three files. Expected FAIL.
- [ ] **Step 3: Implement.** For `en`, use USD fields and `formatPlanPrice(cents, 'usd', 'en-US')`; the annual-savings math uses USD values; plan CTA hrefs from `signupHref('en', planId)`. Keep the BRL code path byte-identical.
- [ ] **Step 4: Run** the three files plus `apps/crm/src/content/__tests__/trial-claims.test.ts`. Expected PASS, Portuguese claims test untouched.
- [ ] **Step 5: Commit** `feat(pricing): seção de preços em USD para /en`.

### Task 5: English legal pages

**Files:**
- Create: `apps/crm/src/pages/en/PrivacyPageEn.tsx`, `apps/crm/src/pages/en/TermsPageEn.tsx`
- Test: `apps/crm/src/pages/en/__tests__/legal-en.test.tsx`

**Interfaces:**
- Produces: default exports `PrivacyPageEn`, `TermsPageEn`; pure JSX, no hooks that read the browser, renderable with `renderToStaticMarkup`. Privacy has an element `id="cookies"`.

- [ ] **Step 1: Failing test:** both render with `renderToStaticMarkup` in Node without throwing; Privacy contains section headings for collection, use, sharing, "Sale and sharing", rights (know, delete, correct, opt out, limit sensitive data, non-discrimination, authorized agent, appeal), `id="cookies"`, Global Privacy Control, children under 13, `privacidade@mesaas.com.br`, `EBS IT SOLUTIONS`; Terms contains automatic renewal, cancel anytime, USD, Stripe, 14-day trial without card, governing law of Brazil, Salvador; neither contains `LGPD`, `CNPJ` or `—`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/en`. Expected FAIL.
- [ ] **Step 3: Write the pages** per spec §10. Mirror the Portuguese policy's retention periods and processor list (read `pages/politica-privacidade/PoliticaPage.tsx` and `pages/termos-de-uso/TermosPage.tsx`; refunds policy matches the Portuguese terms). Header line under the title: `Last updated: <date of merge>`. Reuse the Portuguese legal pages' layout classes so they look the same.
- [ ] **Step 4: Run.** Expected PASS.
- [ ] **Step 5: Commit** `feat(legal): Privacy Policy e Terms of Service em inglês`.

### Task 6: SEO metadata for `/en`

**Files:**
- Modify: `apps/crm/src/content/site-meta.ts`, `apps/crm/src/content/seo-head.ts`, `apps/crm/src/content/sitemap.ts`, `apps/crm/src/lib/usePageMeta.ts`, JSON-LD builder used by `jsonLdForPath` (find it from `prerender.tsx` imports)
- Test: extend `apps/crm/src/content/__tests__/seo-head.test.ts`, the sitemap test next to `sitemap.ts`, and the `usePageMeta` test

**Interfaces:**
- Produces: `RouteMeta` gains `locale?: SiteLocale` (absent = `'pt'`) and `alternate?: string` (paired path). Four new `PUBLIC_ROUTES` entries: `/en` (`file: 'en.html'`, `alternate: '/'`), `/en/pricing` (`file: 'en/pricing.html'`, `alternate: '/precos'`), `/en/privacy` (`file: 'en/privacy.html'`), `/en/terms` (`file: 'en/terms.html'`), each `locale: 'en'`; `/` gains `alternate: '/en'`, `/precos` gains `alternate: '/en/pricing'`. `buildHeadTags(meta, jsonLd)` signature unchanged.

- [ ] **Step 1: Failing tests.** `buildHeadTags` for `/en`: `og:locale` `en_US`; three `link rel="alternate"` with `hreflang="en"` → `/en`, `hreflang="pt-BR"` → `/`, `hreflang="x-default"` → `/`; same three on `/`; none on `/en/privacy`; `/lgpd` output unchanged. Titles 50-60 chars and descriptions 120-160 chars for the four new entries (the existing range test, if any, covers them; else add it). Sitemap contains the four URLs and `xhtml:link` alternates for both pairs. `usePageMeta('/en')` sets `og:locale` and the alternates in `document.head`, and removes them when navigating to `/lgpd`. JSON-LD for `/en`: English, `priceCurrency` `USD`.
- [ ] **Step 2: Run** those test files. Expected FAIL.
- [ ] **Step 3: Implement.** Titles and descriptions in English within the ranges.
- [ ] **Step 4: Run.** Expected PASS.
- [ ] **Step 5: Commit** `feat(seo): metadados, hreflang e sitemap das páginas /en`.

### Task 7: Routes, prerender, SSR and language

**Files:**
- Modify: `apps/crm/src/App.tsx` (routes; `SavedLanguageSync`), `apps/crm/src/main.tsx` (`isSsr`, `initialLanguage`), `apps/crm/src/entry-server.tsx`, `scripts/seo/prerender.tsx`, `scripts/seo/routePreload.ts`, `vercel.json`, `.github/workflows/ci.yml` (`landing-prerender-smoke`)
- Create: `apps/crm/src/pages/en/EnglishPage.tsx` (wrapper that calls `changeLanguage('en')` in an effect and renders its child)
- Test: `apps/crm/src/__tests__/entryServer.test.tsx`, `apps/crm/src/content/__tests__/vercel-routing.test.ts`, `scripts/seo/routePreload.test.ts`, new `apps/crm/src/__tests__/savedLanguageSync.test.tsx`

**Interfaces:**
- Consumes: Tasks 3-6.
- Produces: routes `/en` → `<EnglishPage><LandingPage locale="en" /></EnglishPage>`, `/en/pricing` → `PrecosPage locale="en"`, `/en/privacy`, `/en/terms`; `render(url: '/' | '/en')` in `entry-server.tsx`.

- [ ] **Step 1: Failing tests.**
  - `entryServer.test.tsx`: `render('/')` then `render('/en')` in one process → first has Portuguese hero, second the pinned English hero note; reverse order also correct.
  - `vercel-routing.test.ts`: existing contract passes for the new entries; `/en/` has a redirect to `/en`; every `/en` rewrite index is lower than the `app.html` rewrite index; no rewrite matches `/en/whatever` (so it gets `404.html`).
  - `savedLanguageSync.test.tsx`: with saved language `pt` and pathname `/en`, after mount `i18n.language` is `en` and `localStorage['mesaas-language']` is `en`; with pathname `/` and saved `en`, language stays `en`; with pathname `/` and nothing saved, `pt`.
  - `routePreload.test.ts`: chunks for the four routes exist.
- [ ] **Step 2: Run** them. Expected FAIL.
- [ ] **Step 3: Implement.**
  - `entry-server.tsx`: `await i18n.changeLanguage(url === '/en' ? 'en' : 'pt')` before every render; preload the landing for both.
  - `prerender.tsx`: `bodyFor('/en')` = `render('/en')` result; `/en/pricing` = `renderPrecosHtml('en')`; legal = `renderToStaticMarkup`; create the parent dir of every output (`mkdirSync(dirname(...), { recursive: true })`); for `locale: 'en'` routes write `<html lang="en">`; `/en` gets `data-ssr="landing"` and `body.landing-page` like `/`.
  - `main.tsx`: `isSsr` true for pathname `/` or `/en` with `data-ssr="landing"`; `initialLanguage` `'en'` on `/en`.
  - `SavedLanguageSync`: skip when `siteLocaleForPath(window.location.pathname) === 'en'` (read inside the effect).
  - `vercel.json`: rewrites `/en` → `/en.html`, `/en/pricing` → `/en/pricing.html`, `/en/privacy` → `/en/privacy.html`, `/en/terms` → `/en/terms.html` before the app shell rule; redirect `/en/` → `/en` (permanent).
  - `ci.yml` smoke: also assert `dist/en.html` has `data-ssr="landing"`, `lp2-hero` and `lang="en"`.
- [ ] **Step 4: Run** the tests, then `npm run build && npm run prerender` with placeholder `VITE_*` as the CI job does; check `dist/en.html`, `dist/en/pricing.html`, `dist/en/privacy.html`, `dist/en/terms.html` exist and `dist/index.html` is unchanged in content apart from the new `English` footer link and the hreflang tags.
- [ ] **Step 5: Verify in the browser** (`preview_start` the CRM dev server): `/en` renders English with no hydration warning in the console, `/` still Portuguese; switch saved language to `pt` and reload `/en`: stays English.
- [ ] **Step 6: Commit** `feat(en): rotas /en, prerender e idioma`.

### Task 8: US consent model

**Files:**
- Modify: `apps/crm/src/lib/consent.ts`, `apps/crm/src/main.tsx`, `apps/crm/src/components/consent/CookieConsent.tsx`, `apps/crm/src/components/consent/CookiePreferencesDialog.tsx`, `packages/i18n/locales/{pt,en}/common.json`, `apps/crm/src/pages/landing/LandingChrome.tsx` (wire footer controls)
- Create: `apps/crm/src/components/consent/UsCookieNotice.tsx`, `apps/crm/src/lib/usConsentDefault.ts`
- Test: `apps/crm/src/lib/__tests__/consent.test.ts`, `apps/crm/src/lib/__tests__/consentEffects.test.ts`, new `apps/crm/src/lib/__tests__/usConsentDefault.test.ts`, new `apps/crm/src/components/consent/__tests__/UsCookieNotice.test.tsx`

**Interfaces:**
- Produces:
  - `Consent` gains `basis: 'choice' | 'us_default'` (parsed absent → `'choice'`); `setConsent(choice: ConsentChoice, basis?: 'choice' | 'us_default')`.
  - `export function gpcEnabled(): boolean` (`typeof navigator !== 'undefined' && (navigator as any).globalPrivacyControl === true`).
  - `getConsent()` returns `marketing: false` whenever `gpcEnabled()`; the cached value must recompute when GPC differs from the cached state (tests flip it).
  - `export function applyUsConsentDefault(pathname: string): void` in `usConsentDefault.ts`: when `siteLocaleForPath(pathname) === 'en'` and `getConsent() === null`, `setConsent({ analytics: true, support: true, marketing: !gpcEnabled() }, 'us_default')`.
  - `export function doNotSellOrShare(): void` (sets marketing false with basis `choice`, keeps the other two, shows the pinned toast via `sonner`).
  - `UsCookieNotice` (no props).

- [ ] **Step 1: Failing tests.**
  - consent: GPC on + record `{marketing: true}` with no basis → `getConsent().marketing === false`, `basis === 'choice'`; GPC off → `true`; `setConsent(..., 'us_default')` round-trips basis.
  - usConsentDefault: `/en` + no record → US default saved with `marketing: true`; with GPC → `marketing: false`; `/` + no record → nothing saved; `/en` + existing record → unchanged; `localStorage.setItem` throwing → `getConsent()` returns the default from memory.
  - consentEffects: with GPC on and a stored `marketing: true` record, `installConsentEffects()` never calls `loadGoogleAds`, `loadMetaPixel`, `loadOpenAiAds` (mock them).
  - UsCookieNotice: not in `renderToStaticMarkup` output (client-only flag); after mount shows the pinned text and both links; "Do Not Sell..." calls `doNotSellOrShare`; dismiss hides it and persists dismissal in `localStorage` key `us_cookie_notice_dismissed`; storage throwing does not crash.
  - CookieConsent: on pathname `/en` with no record (before the default is applied) renders nothing; on `/` unchanged.
  - Dialog: with GPC on, advertising switch is off and disabled and shows the pinned GPC line; "Details" link is `/en/privacy#cookies` when language is `en`, `/lgpd` when `pt`.
- [ ] **Step 2: Run** the test files. Expected FAIL.
- [ ] **Step 3: Implement.** In `main.tsx`, call `applyUsConsentDefault(window.location.pathname)` before `installConsentEffects()`. Mount `UsCookieNotice` next to `CookieConsent` in `App.tsx`; it renders only on `/en` pages (via `useLocation` + `siteLocaleForPath`) and only after mount, and is hidden in the native iOS app like the banner. Add i18n keys under `cookies.us.*` and `cookies.dialog.gpc` in both locale files (Portuguese text for the pt file, though pt pages never show the notice). Wire the `/en` footer buttons from Task 3 to `openConsentPreferences()` and `doNotSellOrShare()`.
- [ ] **Step 4: Run** those tests plus `indexHtmlConsentGate.test.ts` and `useConsent.test.tsx`. Expected PASS.
- [ ] **Step 5: Verify in the browser:** fresh profile on `/en` → notice shows, PostHog loads, no Brazilian banner; click Do Not Sell → toast, marketing off in `consent_v1`; fresh profile on `/` → Brazilian banner as before.
- [ ] **Step 6: Commit** `feat(consent): modelo opt-out dos EUA em /en e GPC em todo o site`.

### Task 9: Signup from `/en` and language after login

**Files:**
- Modify: `apps/crm/src/lib/supabase.ts` (`signUp` meta type), `apps/crm/src/pages/login/LoginPage.tsx`, `apps/crm/src/context/AuthContext.tsx`, the PostHog signup event call (find with `grep -rn "signup" apps/crm/src/lib/analytics*`)
- Create: `apps/crm/src/lib/signupMarket.ts`
- Test: `apps/crm/src/lib/__tests__/signupMarket.test.ts`, `apps/crm/src/pages/login/__tests__/` (extend the register test), `apps/crm/src/context/__tests__/` (extend or add an AuthContext language test)

**Interfaces:**
- Produces:
  - `export function readSignupMarket(search: string): 'us' | undefined` (only one `market` param whose value is exactly `us`).
  - `signUp` meta type gains `market?: 'us'`.
  - `export function applyAccountLanguageFallback(user: { user_metadata?: Record<string, unknown> } | null): void` (in `signupMarket.ts`): when no valid saved language exists and `user_metadata.market === 'us'`, `changeLanguage('en')`.

- [ ] **Step 1: Failing tests.** `readSignupMarket`: `?market=us` → `'us'`; `?market=US`, `?market=us%20`, `?market=br`, `?market=us&market=br`, `''` → `undefined`. LoginPage register with `?tab=register&market=us` calls `signUp` with metadata including `market: 'us'` and `empresa: ''`; the value survives switching to the login tab and back; without the param, no `market` key. `applyAccountLanguageFallback`: nothing saved + market us → language `en` saved; saved `pt` + market us → stays `pt`; nothing saved + no market → stays `pt`. AuthContext calls it once when the session's user is first known, before children that depend on the profile render.
- [ ] **Step 2: Run.** Expected FAIL.
- [ ] **Step 3: Implement.** The PostHog signup event gains `market: 'us'` when present; events on `/en` pages carry `site_locale: 'en'` (register a super property while on `/en` pages via the existing analytics wrapper).
- [ ] **Step 4: Run** plus the full `apps/crm/src/pages/login` suite. Expected PASS.
- [ ] **Step 5: Commit** `feat(signup): cadastro do /en envia market us e o app abre em inglês`.

### Task 10: Workspace setup and `/comecar` for USD workspaces

**Files:**
- Modify: `apps/crm/src/pages/workspace-setup/WorkspaceSetupPage.tsx`, `setupHelpers.ts`, `saveWorkspaceSetup.ts`, `apps/crm/src/pages/comecar/ComecarPage.tsx`, `packages/i18n/locales/{pt,en}/auth.json` (or a new `setup` namespace registered in `I18N_LAZY`)
- Test: `apps/crm/src/pages/workspace-setup/__tests__/` (extend), `apps/crm/src/pages/comecar/__tests__/` (extend)

**Interfaces:**
- Consumes: Task 1 (`supabase.rpc('billing_market_apply')`), Task 9 (`user_metadata.market`).
- Produces: `export function normalizeInternationalPhone(input: string): string | null` in `setupHelpers.ts` (digits-only result with country code, or `null` when invalid); `isValidBrPhone` unchanged.

- [ ] **Step 1: Failing tests.**
  - `normalizeInternationalPhone`: `+1 (415) 555-0132` → `14155550132`; `415.555.0132` → `14155550132`; `+44 20 7946 0958` → `442079460958`; `123` → `null`; `+1 555` → `null`; 16 digits → `null`.
  - Setup page, USD workspace: English labels; US phone accepted and saved as digits; WhatsApp opt-in absent; Brazilian-format error never shown.
  - Setup page, BRL workspace: unchanged behavior (existing tests).
  - Setup page, `market: 'us'` user whose workspace reads `brl`: calls `billing_market_apply`; when it returns `usd`, form uses US rules; when it returns `brl` or errors, shows an inline error with a `Try again` button, does not continue, and captures `us_signup_currency_mismatch`.
  - Setup page, currency read fails: falls back to `user_metadata.market`.
  - `/comecar` with `billingCurrency === 'usd'`: no WhatsApp support block even when `isWhatsAppSupportEnabled()` is true; BRL unchanged.
- [ ] **Step 2: Run.** Expected FAIL.
- [ ] **Step 3: Implement.** Read `workspaces.billing_currency` for the active workspace with TanStack Query (same select Cobrança uses); show the existing skeleton while loading. Route all setup copy through i18n with today's Portuguese as the pt values.
- [ ] **Step 4: Run** both suites. Expected PASS.
- [ ] **Step 5: Verify in the browser** with the seed login (memory: seed login + inject localStorage): a USD seed workspace shows English setup and accepts a US phone.
- [ ] **Step 6: Commit** `feat(setup): configuração do workspace em USD aceita telefone dos EUA`.

### Task 11: English screenshots, runbook and docs

**Files:**
- Create: `apps/crm/public/landing/en/*.webp` (same names, widths and `srcset` variants as `apps/crm/public/landing/`)
- Modify: the static list of available English images from Task 3
- Create: `docs/us-english-site-runbook.md` (Portuguese, like the other runbooks)
- Modify: `CLAUDE.md` (Gotchas bullet)

- [ ] **Step 1: Capture** the hero and four feature screenshots from the CRM running locally in English with seed data (Browser pane, dark theme, same framing as the Portuguese ones); export with the same widths the `srcset` builder expects (`LandingPage.tsx:204-205`). Add their names to the Task 3 list. Run `npx vitest run apps/crm/src/pages/landing` (the image assertions now hit the English paths).
- [ ] **Step 2: Runbook** with the spec's Deploy order (migration staging/prod with the disposable-checkout method; Admin `price_usd*` on staging then prod; the Supabase "Confirm signup" template change with the exact Go-template branch on `.Data.market`, the English body, a staging real send, prod before merge, and a Portuguese real send right after; post-merge `/en` signup check; the "before ads" list including Part 3).
- [ ] **Step 3: CLAUDE.md** Gotchas bullet: `/en` site (spec path); content parity rule (`landing.content.en.ts` must keep the same shape); GPC is enforced inside `getConsent()`; `/en` routes need `PUBLIC_ROUTES` + `vercel.json` before the app shell; deploy order (migration, template, `price_usd*`, merge).
- [ ] **Step 4: Run the full gate list** from Global Constraints. Expected: all pass.
- [ ] **Step 5: Commit** `docs: runbook do site em inglês e screenshots em inglês`.
