# Landing `/`: render the real page at build time and hydrate it

Item 7 of the 2026-10-21 mobile PageSpeed map, after #714 (entry trimming, preloads) and #718
(CSS split, Phosphor). Local Lighthouse (mobile, Slow 4G, Lighthouse 13.5) is at 76: FCP 3.6 s,
LCP 4.4 s, TBT ~10 ms, CLS 0. The remaining cost is structural: `/` ships an empty `#root`
(plus a hidden text-only `#lp-ssr` mirror for crawlers), so nothing paints until the ~275 KB gz
entry JS and the landing chunk have downloaded, parsed and rendered. Painting from HTML is the
only lever left that can take this profile to 90+.

## Intent

Visitors on a phone see the real landing (hero, CTA, devices) as soon as the HTML and its CSS
arrive, before any JavaScript runs, and the page becomes interactive when JS hydrates it, with no
visible change for an anonymous first-time visitor.

## Goals

- `dist/index.html` (route `/`) contains the server-rendered markup of the real `LandingPage`
  inside the app's real provider/route tree, and the client **hydrates** it (`hydrateRoot`)
  instead of replacing it.
- Anonymous first visit (no stored session, no consent stored, promo not dismissed, default
  theme, `pt`): **zero hydration mismatches** and a post-hydration render pixel-identical to
  today's page.
- Local Lighthouse mobile ≥ 90 (stretch; ≥ 85 is the floor for shipping), FCP/LCP well under 3 s,
  TBT and CLS still green.
- The HTML works without JS: readable, links navigate (buttons that need JS just don't act).

## Non-goals

- Other routes (`/precos`, blog, marketing, legal). They keep today's mirrors; the mechanism
  should make adding them later straightforward, but they are not converted here.
- Streaming SSR or a runtime server. This is build-time prerender only (Vercel serves static
  files).
- Changing the landing's design or copy.
- Server-side data for pricing (see "Pricing" below).

## Anti-goals (would make this a failure even if it "works")

- A visible flash or layout shift at hydration for the common visitor (e.g. CTA or banner
  appearing/disappearing, hero re-mounting, images reloading).
- Breaking the app for signed-in users, other routes, the Hub, or the CRM build (`app.html` and
  every non-`/` page must behave exactly as today).
- Console hydration errors on the common path, or a hydration crash that leaves the page dead.
- Crawler-visible copy getting worse than today's `#lp-ssr` mirror (the real page must contain
  at least the same copy).

## Constraints / facts

- Build: `npm run build` (tsc + `vite build` for CRM → `dist/`), then `npm run prerender`
  (`scripts/seo/prerender.tsx`, run with `tsx`, writes `dist/index.html` from the built shell,
  injects head tags, JSON-LD, the `#lp-ssr` mirror, and since #714 the landing's modulepreloads,
  CSS links and hero image preload via `scripts/seo/routePreload.ts`). `vercel.json` runs
  `npm run build && npm run prerender && npm run build:hub && npm run build:admin`.
- Client boot: `apps/crm/src/main.tsx` → `createBrowserRouter([{ path: '*', element: <App/> }])`
  (a data router; must stay one — `installSilentUpdate` registers a blocker on it) and, on `/`,
  awaits `preloadLanding()` (≤ 2 s) before `createRoot(...).render(...)`.
- `App.tsx` tree around the landing: `Sentry.ErrorBoundary` → `QueryClientProvider` →
  `AuthProvider` → `<Suspense fallback={PageFallback}>` → `<Routes>` (landing is `lazy()` with a
  preloaded fast path) + `CookieConsent`, `Toaster`, `Analytics`, `BuildPrefetch`, etc.
- The landing is always the dark palette (`.lp-v2`), images are the `-dark` set.
- Render-time browser reads that break or diverge on the server:
  - `LandingChrome.tsx:46` `useState(document.documentElement.getAttribute('data-theme')…)`
  - `LandingPage.tsx:121` promo banner `useState(() => localStorage.getItem('mesaas_promo_dismissed') === '1')`
  - `Testimonials.tsx` `prefersReducedMotion()` (check whether it's called during render)
  - `useAuth()` `loading`/`user` gate the hero and header CTAs (`{!loading && (user ? … : …)}`)
  - `CookieConsent` renders the banner from stored consent (`useConsent`, localStorage)
  - i18n language from localStorage (`getSavedLanguage`)
  - effects (IntersectionObserver, scroll listeners, hash scroll) are fine on the server.
- `PricingSection` loads plans with `useQuery(listPublicPricingPlans)` from Supabase.

## Design (decided)

1. **Server entry built by Vite.** Add `apps/crm/src/entry-server.tsx` exporting
   `render(url): { html, … }`. Build it with Vite in SSR mode (`vite build --ssr`) into a scratch
   output (not `dist/`, never deployed), so `import.meta.env`, aliases, JSON, `lazy()` and CSS
   imports (dropped in SSR) behave like the client build. `prerender.tsx` imports that bundle and
   renders `/`. The client and server must render the *same* tree: the server uses React Router's
   static data-router APIs (`createStaticHandler` / `createStaticRouter` /
   `<StaticRouterProvider>`) over the same `[{ path: '*', element: <App/> }]` route list, so the
   client's `createBrowserRouter` + `RouterProvider` hydrate it.
   The lazy `LandingPage` must be resolved before rendering on the server (await the same
   `preloadLanding()` fast path, or an SSR-aware equivalent) so the server emits the page, not
   the Suspense fallback.
2. **Server-safe render.** Every render-time browser read listed above becomes SSR-safe and
   hydration-stable: the first client render must produce what the server produced, then effects
   adjust. Pattern: render the "anonymous first visit" state during SSR and the first client
   render (e.g. `useSyncExternalStore` with a `getServerSnapshot`, or a `useHydrated()` flag),
   and apply stored state after hydration. Module-scope browser access reachable from the server
   entry must be guarded (`typeof window`), not just render-time code.
3. **CTAs are anonymous-first.** The hero/header CTAs render the logged-out version while auth is
   loading (today they render nothing), and switch to "Acessar painel" when a user is known. On
   the server and the first client render that's the logged-out CTA, so the common case shows the
   CTA in the HTML with no shift. Signed-in visitors on `/` see the label change after auth
   resolves (rare on the landing; acceptable).
4. **Stored-state flashes are handled before paint where it's cheap.** The cookie banner is in
   the HTML (first visitors need it). For visitors who already consented, the pre-paint inline
   script in `index.html` (which already reads localStorage for theme/look) sets an attribute
   that hides `.cookie-banner` via CSS until React removes it, so there is no banner flash. Same
   idea for the dismissed promo banner if the builder finds it's visible above the fold. The
   builder decides per case between this and simply accepting a post-hydration update, by
   checking for layout shift.
5. **Pricing stays client-fetched.** The server and the first client render show the section's
   existing loading state; plans arrive after hydration exactly as today (it's below the fold).
   No build-time price snapshot (prices are edited in the Admin; a stale snapshot is worse than a
   brief skeleton far below the fold).
6. **Client boot.** `main.tsx` uses `hydrateRoot(root, <RouterProvider router={router} />)` when
   the document is the prerendered landing (e.g. `#root` has server markup and the path is `/`;
   pick a marker the prerender writes), otherwise `createRoot` as today. `onRecoverableError`
   reports mismatches to Sentry (once, not per element) so production regressions are visible.
   The `preloadLanding()` wait stays (selective hydration would also cope, but awaiting it keeps
   the first client render identical).
7. **Retire the `#lp-ssr` mirror on `/`**: the real markup replaces it (crawlers get the real
   page). The `index.html` 8 s fallback timer and the `#lp-ssr` `<noscript>` rule must not hurt
   `/` anymore (remove for `/` or make them no-ops when real markup is present); other routes'
   mirrors are unchanged.
8. **Head and preloads unchanged in spirit**: route head tags, JSON-LD, the #714 modulepreload /
   CSS / hero-image preload stay. Landing CSS is already linked render-blocking from `<head>`,
   which is now exactly what we want (it styles the server HTML).

## Left to the builder

- Exact SSR build wiring (a second Vite config vs. `--ssr` flag with the existing config, where
  the bundle goes, how `prerender.tsx` loads it), as long as `dist/` gets nothing extra and the
  `vercel.json` build stays one command chain.
- How to provide a server-safe Supabase/auth/query/i18n/consent context (stubs vs. making the
  real providers SSR-safe). Prefer making real code SSR-safe where it's small; avoid a parallel
  fake tree that can drift from the client one.
- The hydration marker and the exact pre-paint attributes.

## Verification (required before shipping)

- Zero hydration warnings/errors in the console on the anonymous first visit (prod build,
  Chrome), and the `onRecoverableError` hook not firing.
- Screenshot diff, after hydration, vs. main: `/` at phone and desktop, plus the cookie
  preferences dialog open — pixel-identical (same harness as #718).
- Screenshot with JS disabled: the landing renders (hero, sections, footer) and looks like the
  hydrated page above the fold.
- Variants don't crash and don't leave a broken page: stored session (signed-in), stored
  consent, promo dismissed, `data-theme=dark` stored, language `en` stored, slow/failed landing
  chunk. Note which ones produce a recoverable mismatch and that it recovers.
- Other routes unchanged: `app.html`, `/precos`, `/blog`, a marketing page, `/login` — same
  screenshots as main; `npm run prerender` output for non-`/` routes byte-identical except where
  explained.
- Local Lighthouse mobile (same method as #714/#718) before/after, several alternated runs.
- All CI gates (4× tsc, lint, format, vitest, functions untouched), and e2e landing specs.

## Review fixes (Codex, 2026-10-21) — requirements, not suggestions

- **i18n.** `packages/i18n` `getSavedLanguage()` reads `localStorage` unconditionally
  (`packages/i18n/index.ts:23`). The server entry initializes i18n deterministically in `pt`
  without touching storage, and the hydrating client's first render is also `pt`; a stored
  `en` is applied (`changeLanguage`) after hydration. `createRoot` paths (every other page) keep
  today's behaviour.
- **`body.landing-page`.** `useLandingChrome()` adds it in an effect (`LandingChrome.tsx:12`),
  but `style.css:214`, `:2000` and the dark cookie banner (`:2283`, `body.landing-page:has(.lp-v2)`)
  and `landing-v2.css:304` depend on it. The prerendered `/` HTML ships `<body class="landing-page">`
  so the server markup is styled correctly before JS; the effect stays (it owns removal on
  navigation away).
- **Failed or slow landing chunk.** Contract: the SSR DOM must never be replaced by the error
  boundary or a spinner because a chunk failed. If `preloadLanding()` rejects or times out, the
  client does not hydrate yet: it keeps the server HTML, reports once to Sentry, retries the
  import once, and hydrates when it arrives; if the retry also fails, the page stays as the
  static server HTML (links still work), which is no worse than a no-JS visit. (A deploy-skew 404
  still goes through `installDeployRecovery`.)
- **Build-stable values.** Anything time- or environment-dependent rendered on `/` must be the
  same on both renders: the footer year (`LandingChrome.tsx:204`, `new Date().getFullYear()`)
  comes from a build-time constant (e.g. `import.meta.env` define set at build), not the clock.
  The builder greps the landing tree for other such values (`Date`, `Math.random`, `Intl` with
  the runtime locale/timezone).
- **No-JS / mirror rules.** Removing `#lp-ssr` from `/` also retires, *for `/` only*, the
  `<noscript>` re-enable rule and the 8 s fallback timer's effect; first confirm no `#lp-ssr`/
  `#root` rule hides or constrains the new real markup (e.g. `body.landing-page #root`,
  `style.css:2000`). Every other prerendered route keeps the mirror, the `<noscript>` rule and the
  8 s fallback exactly as today.

## Review fixes (Fable, 2026-10-21) — requirements

Verified: React/react-dom 19.2.4, react-router 7.18.1, Vite 6.4.2.

- **Reveal animations hide content before JS.** `landing.css:76` `.lp-root .reveal { opacity: 0;
  transform: … }` until the IntersectionObserver (`LandingPage.tsx:69-88`) adds `.in`: every
  section below the hero would be invisible in the server HTML and without JS. Gate the hidden
  state on a JS marker (the pre-paint script sets e.g. `html[data-js]`, and the hidden rule
  becomes `html[data-js] .lp-root .reveal:not(.in)`), so raw HTML shows everything and JS
  visitors keep the reveal.
- **`Testimonials.tsx:48-53,70`** calls `window.matchMedia` during render
  (`useState(prefersReducedMotion)`): server-safe + hydration-stable (`false` on both renders,
  real value after mount).
- **Router.** Server uses `createStaticHandler` / `createStaticRouter` /
  `<StaticRouterProvider router context hydrate={false}>` (default `hydrate=true` emits
  `window.__staticRouterHydrationData`); the client's `createBrowserRouter` tolerates its absence
  (no loaders).
- **Renderer.** Use React 19 `prerender` from `react-dom/static` (awaits `lazy()` and keeps
  Suspense boundary markers) or `renderToString` after resolving the lazy page —
  never `renderToStaticMarkup` (no hydration markers; `App.tsx` wraps `<Routes>` in `<Suspense>`).
- **SSR build output.** The CRM Vite config writes `outDir: ../../dist` and
  `manifest: build-manifest.json`; the SSR build must use its own outDir outside `dist/` and
  `manifest: false`, so it never overwrites the client manifest that `prerender.tsx` and
  `prefetchBuildAssets` read.
- **Env at prerender.** `lib/supabase.ts:10` throws at module load without `VITE_SUPABASE_*`;
  the SSR render imports it. Prerender works in Vercel (env set); locally/worktrees use
  `scripts/with-env.mjs`. CI currently never runs prerender: add a CI step (in the existing
  `typecheck-and-test` job or a new small job) that runs `build` + `prerender` with placeholder
  public `VITE_*` values and asserts `/` contains the hydration marker and the hero markup, so a
  server-render break fails CI instead of the Vercel deploy.
- **Promo banner** (`LandingPage.tsx:120-124`) is the first element on the page: a dismissed
  visitor must get the pre-paint attribute + CSS hide (not a post-hydration unmount, which shifts
  the whole document). Its `useState` returns the server value on the first client render.
- **Footer year**: build-time constant on both renders (see Codex fixes).
- **Mismatch scope.** `CookieConsent`/`Analytics` sit inside the root (outside the route
  Suspense), so a mismatch there makes React 19 client-render the whole root (no patching).
  That's the reason the anonymous path must be mismatch-free; `onRecoverableError` reports once.
- **TBT.** Today TBT≈10 ms because the entry evaluates before FCP. With HTML painting first,
  entry evaluation (~275 KB gz) and hydration land after FCP on the 4×-throttled CPU. Measure
  TBT before/after; if it becomes the limiter, the follow-up lever is deferring entry-time work
  (Sentry init, Supabase client, i18n resources) — out of scope here unless trivially safe.
- **Fonts / CLS.** The landing stack is `-apple-system, 'SF Pro Display', 'Plus Jakarta Sans',
  system-ui` (`landing-v2.css:322`); on non-Apple devices the `media=print` Plus Jakarta swap
  now happens after text paints. Measure CLS on an emulated Android profile (Lighthouse already
  emulates Moto G, but the host is a Mac with SF Pro installed — check with SF Pro excluded,
  e.g. a run on Playwright Chromium with a font override, or reason from the Lighthouse trace).
  **My call (not the owner's):** keep Plus Jakarta Sans; if the measured CLS from the swap is
  ≥ 0.05, switch it to `font-display: optional` for the landing and say so in the PR.
- **Tests.** There are no e2e landing specs to lean on (`e2e/screenshots/landing-*.spec.ts` are
  opt-in marketing captures). Unit tests mock `loading: false` (`LandingPage.test.tsx:20`,
  `LandingChrome.links.test.tsx:6`): add tests for the CTA while auth is loading, the SSR-safe
  hooks (server snapshot vs client), and a server-render test of `entry-server` that renders `/`
  without browser globals and contains the hero.
- **Prerender idempotency** stays as today (re-run requires a fresh `vite build`); keep its
  fail-loud markers.

## Shipping bar (my call)

Ship when the anonymous path is mismatch-free, all variants recover cleanly, other routes are
unchanged, and local Lighthouse mobile is ≥ 85 with CLS < 0.1. If TBT keeps it under 90, the PR
reports the numbers and names entry-eval deferral as the next step.
