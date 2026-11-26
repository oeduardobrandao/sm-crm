# English US site (`/en`): design

Part 2 of the US launch. Part 1 (USD billing, #879) is merged and deployed. Part 3 (English
gaps inside the signed-in app and in transactional emails) comes after this.

## Intent

Mesaas will run ads in the United States. Those ads need an English landing page whose legal
footing is US privacy practice, not Brazil's LGPD, and a signup that drops a US agency into a
USD workspace with the app in English. Today every public page is Portuguese, the legal pages
cite LGPD and Brazilian forum, the cookie banner is opt-in (which hides ~90% of landing traffic
from measurement), and a US signup lands in a Portuguese, BRL workspace whose setup step
rejects a US phone number.

## Goals

1. `/en`: an English twin of the landing (same sections and layout, USD pricing), server-
   rendered like `/`.
2. `/en/pricing`: English twin of `/precos`.
3. `/en/privacy` and `/en/terms`: English legal pages written to US practice (CCPA/CPRA as the
   reference standard, covering the other state laws by the same rights), not translations of
   the Portuguese pages.
4. US consent model on `/en` pages: opt-out by default, "Do Not Sell or Share" control,
   Global Privacy Control honored.
5. `/en` signup: every signup CTA on `/en` pages creates a workspace with `billing_currency =
   'usd'` and leaves the app in English, through signup, email confirmation, `/workspace-setup`
   and `/comecar`.
6. SEO: proper `lang`, `og:locale`, canonical and `hreflang` pairs between `/`↔`/en` and
   `/precos`↔`/en/pricing`; `/en` pages in the sitemap.

## Non-goals

- English versions of the marketing pages (`/sobre`, `/aprovacao-de-post`,
  `/portal-do-cliente`, `/agente-de-conteudo-ia`), blog, changelog, `llms.txt`.
- Translating the signed-in app beyond what the signup path touches (part 3).
- Lifecycle emails (welcome, trial reminder, nurture) in English (part 3).
- Geo-detection or automatic redirect between `/` and `/en`. Language follows the URL.
- A US legal entity. The contracting party stays EBS IT SOLUTIONS (Brazil).
- EU/GDPR consent. `/en` follows US rules; ads target the US.

## Anti-goals

- Any behavior change on the Portuguese landing, `/precos`, the Brazilian legal pages or the
  Brazilian consent model (opt-in stays). The trial-claims test must pass untouched.
- An `/en` page that promises something the product does not do for a USD workspace (Pagar.me
  12x, WhatsApp support, BRL prices, a Brazilian phone format).
- A US signup that silently ends up BRL or Portuguese.

## Constraints

- Prerender rules (CLAUDE.md, Deployment): landing render code must be hydration-stable; no
  browser reads during render; the SSR bundle runs every module's top level in Node.
- `vercel.json` has no catch-all: every new public path needs its rewrite, and the guard test
  `vercel-routing.test.ts` enforces `PUBLIC_ROUTES` ↔ rewrites.
- `/en/*` rewrites must come before the `app.html` rule.
- Live Stripe has no USD `currency_options` yet (part 1 runbook step 5). A USD checkout is
  refused until that step and the Admin `price_usd*` values are done. Ads must not start
  before both.
- No em-dashes in user-facing copy (house rule; applies to English too).
- Copy must not say Mesaas is "approved by Meta"; "official Meta API" is fine.
- Reverse-trial copy ("14 days of Pro free, no card") is only true while
  `platform_settings.reverse_trial_enabled` is on, same rule as the Portuguese copy.

## Approaches considered

- **A. One set of components, one content module per language (chosen).** The landing already
  takes all copy from `content/landing.content.ts`. Add `landing.content.en.ts` with the same
  exported type, so TypeScript fails on a missing English section. Components receive a
  `locale` and read the matching module. Same for pricing content and SEO mirrors. Legal pages
  get their own English components because their substance differs.
- **B. Move the landing to i18next keys.** One system everywhere, but it rewrites the live
  Portuguese landing, its SSR path and the trial-claims tests just to add English, and long
  legal prose does not belong in JSON keys.
- **C. Copy the landing components into an English folder.** Fastest to start, then every
  landing change is made twice and the copies drift.

The user picked A.

## Design

### 1. Locale plumbing

- `type SiteLocale = 'pt' | 'en'`. A small `content/locale.ts` exports it plus
  `siteLocaleForPath(path)` (`/en` or `/en/...` → `en`, else `pt`) and `localizedPath(locale,
  key)` for the paired routes (`home`, `pricing`, `privacy`, `terms`, `signup`).
- Landing components (`LandingPage`, `LandingChrome`, `PricingSection`, `FaqSection`,
  `PlanComparison`, `landing-visuals`) take `locale: SiteLocale` (default `'pt'`, so every
  existing call site keeps its output byte-identical). Hardcoded strings inside these
  components (mock dashboard labels in `LandingPage.tsx:225-227`, `lp2-more-note`, feature CTA,
  agent eyebrow, "Bem-vindo de volta!" signed-in block, `PLAN_MARKETING`, footer and nav
  labels) move into the content modules: `landing.content.ts` gains the fields with today's
  exact Portuguese, `landing.content.en.ts` supplies English. A snapshot or string test proves
  the Portuguese render did not change.
- `Testimonials` renders only for `pt` (all Brazilian; no US proof yet).
- Screenshots (`/landing/feat-*-dark.webp`, hero MacBook render): English variants captured
  from the app running in English with seed data, saved as `/landing/en/...` with the same
  sizes and `srcset` widths. Until a variant exists, the component falls back to the
  Portuguese image (a missing file must never break the page).

### 2. Routes

| Path | Renders | Prerender | File |
| --- | --- | --- | --- |
| `/en` | `LandingPage locale="en"` | real React SSR, like `/` | `en.html` |
| `/en/pricing` | `PrecosPage locale="en"` | `.seo.ts` mirror (English) | `en/pricing.html` |
| `/en/privacy` | `PrivacyPageEn` | `renderToStaticMarkup` | `en/privacy.html` |
| `/en/terms` | `TermsPageEn` | `renderToStaticMarkup` | `en/terms.html` |

- `App.tsx` gets the four routes. `/en/` (trailing slash) redirects to `/en` via `vercel.json`.
- `PUBLIC_ROUTES` gains four entries (English title 50-60 chars, description 120-160 chars).
  `RouteMeta` gains optional `locale` and `alternate` (paired path) fields.
- `vercel.json`: one rewrite per file, placed before the `app.html` rule; `vercel-routing.test.ts`
  keeps passing because each entry has `source === path`, `destination === /file`.
- `prerender.tsx` writes `dist/${route.file}` with no parent directory creation (only
  `dist/blog` is created, later). Every write creates its parent first
  (`mkdirSync(dirname(out), { recursive: true })`), generically, so `en/*.html` works.
- `routePreload.ts` gets the chunks for the new pages.
- An unknown `/en/...` path falls through to `404.html` (Portuguese). Acceptable for v1;
  noted as a follow-up.

### 3. SSR of `/en`

- `entry-server.tsx` `render(url)` accepts `'/'` or `'/en'`. The i18n singleton is
  initialized once (today's `!i18n.isInitialized` guard), so each render must set the language
  explicitly: `await i18n.changeLanguage(url === '/en' ? 'en' : 'pt')` before rendering, every
  time. Rendering `/` then `/en` in one process must yield Portuguese then English (test it in
  that order and in reverse).
- `prerender.tsx` calls `render('/en')` once more and writes `dist/en.html` with
  `<div id="root" data-ssr="landing">`, `<html lang="en">` and the English head.
- `main.tsx`: `isSsr` becomes `data-ssr === 'landing' && (pathname === '/' || pathname ===
  '/en')`, and `initialLanguage` is `'en'` when the pathname is `/en`. `SavedLanguageSync` must
  not override the language on `/en` pages (see 5).
- `entryServer.test.tsx` and the `landing-prerender-smoke` CI job gain `/en` assertions
  (`data-ssr="landing"`, `lp2-hero`, `lang="en"`).

### 4. SEO head

- `buildHeadTags` takes the route's locale: `og:locale` `en_US` vs `pt_BR`, and, when the route
  has an `alternate`, emits `<link rel="alternate" hreflang="pt-BR">`,
  `hreflang="en"` and `hreflang="x-default"` (x-default = the Portuguese page) on both sides of
  each pair. Legal pages carry no hreflang (different policies, not translations).
- `<html lang>` in the prerendered file is `en` for `/en` routes.
- JSON-LD on `/en`: Organization + SoftwareApplication in English, `offers` in USD; FAQ JSON-LD
  from the English FAQ.
- `sitemap.xml` includes the four `/en` URLs with `xhtml:link` alternates for the two pairs.
- `usePageMeta` mirrors all of the above on client navigation.

### 5. Language of the app after an `/en` visit

- Any `/en` page, on mount, calls `changeLanguage('en')` (persists `mesaas-language`). A visit
  to `/` does not touch the saved language (Brazilians who chose English in the app keep it).
- Cross-device confirmation (signup on desktop, confirmation link opened on a phone): the
  phone has no saved language. When a session loads and there is no saved language
  (`localStorage` has no valid `mesaas-language`), `user_metadata.market === 'us'` selects
  English and saves it. This runs where the session is first known (AuthContext), before
  `/workspace-setup` and `/comecar` render. A saved language always wins.
- Footer of `/en` pages: "Versão em português" → `/`. Footer of `/` pages: "English" → `/en`.
  The `/` link does not change the saved language either; the in-app language switch stays the
  only way back to Portuguese once inside the app. (Acceptable: a Brazilian who wanders onto
  `/en` and signs up from there wanted English.)

### 6. Signup from `/en`

- Every signup CTA on an `/en` page links to `/login?tab=register&market=us` (plus the existing
  plan intent query when present). Login CTAs link to `/login`.
- `LoginPage` reads `market`; only the exact value `us` is honored (anything else is ignored).
  It keeps the value across the tab switch and the intent redirect, and passes `market: 'us'`
  in the `signUp` metadata. `lib/supabase.ts` `signUp` meta type gains `market?: 'us'`.
- The DB trigger from part 1 (`on_auth_user_created_zz_billing_market`) sets the workspace to
  USD. Its failure is a WARNING only, so the setup step repairs it server-side. New RPC
  `billing_market_apply()` (migration; SECURITY DEFINER, `EXECUTE` for `authenticated` only,
  no arguments): reads the caller's own `auth.users.raw_user_meta_data ->> 'market'` (never a
  client value), and only when it is `us`, the caller owns the workspace, the workspace is
  not locked (`billing_currency_locked_at` null) and has no provider row in
  `workspace_subscriptions`, it sets `billing_currency = 'usd'` through the same rules as
  `billing_currency_set`. Returns the resulting currency. Idempotent; a no-op for everyone
  else. `/workspace-setup` calls it when `market === 'us'` and the workspace reads `brl`; if
  it still reads `brl` afterwards (or the call fails), the form shows an inline error with a
  "Try again" button instead of continuing, and PostHog gets `us_signup_currency_mismatch`.
  An entitlement-style SQL test covers: US owner fixed; non-US caller untouched; locked or
  provider-backed workspace untouched; invited member untouched.
- Email confirmation: Supabase's "Confirm signup" template becomes bilingual by branching on
  `{{ if eq .Data.market "us" }}` (English subject line cannot branch, so the subject becomes
  bilingual-neutral or English-first; decided in the template work, tested on staging with a
  real send). This is a dashboard change (auth templates are not in the repo), done in staging
  first, then prod, recorded in the runbook. Reason: per the auth-email incident, a bad
  placeholder silently stops all confirmation emails, so it needs a real send on staging
  before prod.

### 7. Post-signup screens for a USD workspace

- `/workspace-setup` today only has the profile from AuthContext. It gains a query for the
  active workspace's `billing_currency` (the same read Cobrança does). While it loads, the
  form shows its skeleton. If the read fails, the page falls back to `user_metadata.market`
  (`us` → US rules, else Brazilian rules). The repair call above runs before the form is
  usable.
- `/workspace-setup` labels, field errors and the phone field go through i18n (`auth` or a
  new `setup` namespace, both languages). Phone validation: Brazilian rule for BRL
  workspaces; for USD workspaces, a US or international number: strip formatting; a 10-digit
  number is US and gets `1` prepended; otherwise 8-15 digits including the country code
  (leading `+` allowed and dropped). Stored digits only, country code first, no `+`
  (`14155550132`), so it fits the existing digits-only readers. Readers elsewhere (Admin
  detail, Crisp sync) keep showing the raw value; `pagarme-checkout` never sees USD
  workspaces. The WhatsApp opt-in checkbox is hidden for USD workspaces.
- `/comecar`: the WhatsApp support card renders today on `isWhatsAppSupportEnabled()` alone;
  it gains an explicit `billingCurrency !== 'usd'` condition. Prices already follow the
  workspace currency (part 1). Any hardcoded Portuguese on this page that a USD user sees
  goes through i18n.
- Pagar.me 12x is already hidden for USD (part 1).

### 8. Pricing in English

- `PricingSection locale="en"` formats with `formatPlanPrice(cents, 'usd', 'en-US')` using
  `price_usd` / `price_usd_annual`. `listPublicPricingPlans` / `PublicPricingPlan` expose those
  columns. On `/en`, a paid plan shows only when BOTH `price_usd` and `price_usd_annual` are
  set (they are set together in the Admin); otherwise it is left out of the cards and the
  comparison table, so the annual toggle never meets a missing price. Free shows `$0`. If no
  paid plan qualifies, the section shows Free plus one line, "Paid plans in US dollars are
  coming soon." (a state that should never reach production, see Deploy order).
- English `PLAN_MARKETING`, plan comparison rows and FAQ. The FAQ drops Pagar.me/12x and
  states card payment via Stripe, billed in USD, cancel anytime.
- An English claims test (`trial-claims.en.test.ts`) pins the English reverse-trial strings
  the same way the Portuguese one does, and that any "30-day" claim says "with card".

### 9. Consent on `/en` (US opt-out)

- `lib/consent.ts` stored record gains an optional `basis: 'choice' | 'us_default'` (absent =
  `choice`; old records stay valid, no key bump).
- `main.tsx`, before `installConsentEffects()` and before React mounts: if the pathname is
  `/en` or starts with `/en/` and there is no stored record, write `{analytics: true,
  support: true, marketing: false-if-GPC-else-true, basis: 'us_default'}`. Doing it here, not
  in a page effect, means the consent effects boot with the US record already in place and
  the Brazilian banner never sees `null` on an `/en` page. It is not a render-time read, so
  SSR and hydration are unaffected.
- GPC is part of the consent read itself: `getConsent()` returns `marketing: false` whenever
  `navigator.globalPrivacyControl === true`, for every record and on every page (Brazilian
  pages and the signed-in app included). Every loader already goes through `getConsent()`, so
  no pixel can load under GPC, including before any React effect runs. Honoring GPC
  everywhere is stricter than CCPA requires and costs nothing for Brazilian visitors, who
  default to off anyway. The preferences dialog shows the advertising switch off and disabled
  with the line "Your browser sent Global Privacy Control, so advertising stays off."
- The opt-in banner does not show on `/en` pages (a synchronous pathname check in
  `CookieConsent`, plus the record already existing). Instead a small, dismissible US notice
  (English, bottom of the viewport): "We use cookies for analytics and advertising. [Do Not
  Sell or Share My Personal Information] [Cookie settings]". It renders only after mount
  (client-only flag set in an effect), so the prerendered HTML never contains it and
  hydration cannot mismatch. Dismiss stores nothing about consent; the notice stays dismissed
  for that browser (`localStorage`, try/catch).
- "Do Not Sell or Share My Personal Information" (notice and `/en` footer) sets `marketing:
  false` with `basis: 'choice'` and confirms with a toast. "Cookie settings" opens the existing
  preferences dialog (already translated).
- Only an explicit choice (`basis: 'choice'`) carries into `/login`, the app and the
  Portuguese pages. A `basis: 'us_default'` record applies only on `/en` and `/en/...`;
  everywhere else `getConsent()` reads it as undecided, so the opt-in banner (translated)
  shows and nothing non-essential loads until the visitor opts in. This is stricter than the
  original design (which carried the default everywhere): a Brazilian visitor who once
  opened `/en` must not end up opted in on LGPD pages, and a US signup pays one extra click.
  A client-side navigation out of `/en` notifies the consent subscribers
  (`consentPathChanged()` from `CookieConsent`), so PostHog and the ad tags are disabled and
  Crisp is reset at once; script tags already injected stay in the page until a reload.
- Saving the preferences dialog while the browser sends GPC stores `marketing: false` as the
  visitor's choice (the disabled switch is saved as shown).
- The dialog's "Details" link points to `/en/privacy#cookies` when the language is English and
  `/lgpd` otherwise.
- `consentEffects.ts` needs no change: loaders already re-read the stored record.
- Google Ads conversion currency: `lib/googleAdsLoader.ts` defaults to BRL; conversions from a
  USD workspace pass `usd` (part 1 already passes the workspace currency on purchase). The
  signup conversion carries no value today and keeps carrying none, so its currency does not
  matter; no change there.

### 10. English legal pages

Drafted by Claude, reviewed by a lawyer before ads run (the user was told this).

- **Privacy Policy (`/en/privacy`)**: who we are (EBS IT SOLUTIONS, Salvador, Brazil, contact
  privacidade@mesaas.com.br); data we collect (account, workspace and client content, usage,
  device, cookies, payment via Stripe, which we never store); purposes; processors and
  international transfers (Supabase, Cloudflare, Stripe, PostHog EU, Resend, Crisp, Google,
  Meta, OpenAI ads pixel, Vercel); retention (mirrors the Portuguese policy's periods,
  including email-metrics 90 days and Google data deletion promises); US state privacy rights
  (know, access, delete, correct, opt out of sale/sharing and targeted advertising, limit use
  of sensitive data, non-discrimination, authorized agents, appeal); how to exercise them;
  "sale/sharing" disclosure for ad pixels; GPC honored; `#cookies` section with the three
  categories; children under 13 not served; changes; contact.
- **Terms of Service (`/en/terms`)**: same structure as the Portuguese terms adapted for USD:
  subscription in USD via Stripe, automatic renewal disclosure (clear and conspicuous, cancel
  in-app any time, effective at period end), 14-day Pro trial without card and 30-day trial
  with card, refunds policy matching the Portuguese one, acceptable use, customer content and
  social account connections (Meta, TikTok, Google), AI features, liability cap, governing
  law Brazil and forum Salvador/BA (the actual contracting entity), contact.
- Both pages are pure JSX (prerendered with `renderToStaticMarkup`) and have no hreflang.
- The `/en` footer links Privacy, Terms, Cookie settings, Do Not Sell or Share. No LGPD link.

### 11. Analytics events

- PostHog event properties gain `site_locale` on `/en` pages; the signup event carries
  `market: 'us'` so the US funnel can be filtered.
- Meta/OpenAI/Google pixels behave as today, gated by the stored consent.

## Deploy order

Frontend, one migration (`billing_market_apply`) and one dashboard change. No edge function.

1. Migration on staging and prod (additive; nothing calls it until the frontend ships).
2. Staging: Admin `price_usd*` on the three paid plans; confirm-signup template change; deploy
   the branch preview and do a real signup from `/en` on staging (English email arrives,
   workspace USD, app English).
3. Prod: confirm-signup template change BEFORE the merge. The template branches on
   `.Data.market`, so Portuguese signups keep getting today's email; test with one real
   Portuguese signup right after the change.
4. Prod: Admin `price_usd*` on the three paid plans before the merge, so `/en` pricing never
   ships in the "coming soon" state. (Checkout in USD still fails until part 1 step 5, but
   only `/en` signups have USD workspaces.)
5. Merge (Vercel deploys).
6. Prod: one real `/en` signup on a throwaway email; confirm the workspace is USD and the app
   is English.
7. Before ads: part 1 runbook steps 5, 7 and 8 (Stripe USD `currency_options`, portal audit,
   real USD charge + refund), lawyer review of `/en/privacy` and `/en/terms`, and Part 3
   shipped (lifecycle emails and the signed-in app in English). Decided by the user: ads wait
   for Part 3, so this phase does not touch the lifecycle emails; an organic `/en` signup
   before Part 3 gets them in Portuguese.

## Left to the builder

- Exact English copy (written in the same plain, concrete voice as the Portuguese, US
  spelling, no em-dashes), page titles and descriptions within the SERP ranges.
- Component prop threading details and where shared helpers live.
- Screenshot capture method (Browser pane against the local dev server with the seed login).
- The bilingual subject line choice for the confirm-signup email.

## Follow-ups (not in this phase)

- English 404 for unknown `/en/...` paths.
- English marketing pages and blog.
- Part 3: signed-in app gaps and lifecycle/transactional emails in English.
