# Landing SSR + Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` ships the real server-rendered landing in `dist/index.html` and the client hydrates it, so phones paint the page from HTML before JS.

**Architecture:** A Vite-built SSR entry renders the same `[{ path: '*', element: <App/> }]` tree with React Router's static data router and `react-dom/static` `prerender`; `scripts/seo/prerender.tsx` builds and imports it and writes the markup into `#root` for `/`. Every render-time browser read on `/` becomes hydration-stable (server value on the first client render, stored value after). The client boots with `hydrateRoot` when `#root[data-ssr="landing"]` is present, otherwise `createRoot` as today.

**Tech Stack:** React 19.2.4, react-router 7.18.1, Vite 6.4.2, Vitest (jsdom + `@vitest-environment node` per file), tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-10-21-landing-ssr-hydration-design.md` (read it whole, including both "Review fixes" sections and "Shipping bar").

## Global Constraints

- Only `/` changes. `app.html`, `404.html`, every other prerendered route and `dist/blog/*` are all derived from `dist/index.html`, so they pick up Task 2's pre-paint script delta and new asset hashes. Compare them with a **normalized** diff: strip hashed asset names (`-[A-Za-z0-9_-]{8}\.(js|css)`) and the known inline-script delta, then `#root` innerHTML and head tags must be identical to main.
- `main.tsx` keeps `createBrowserRouter([{ path: '*', element: <App /> }])` (a data router; `installSilentUpdate` needs it).
- Server render: `createStaticHandler` / `createStaticRouter` / `<StaticRouterProvider … hydrate={false}>`; React `prerender` from `react-dom/static` (never `renderToStaticMarkup`).
- SSR build: its own outDir `node_modules/.cache/landing-ssr` (never `dist/`), `build.manifest: false`, `ssr: true`.
- First render on the hydration path = the "anonymous first visit" state: no user, auth `loading: true` treated as anonymous, consent `null`, promo not dismissed, theme attribute ignored, language `pt`, reduced motion `false`, year `__BUILD_YEAR__`.
- Hydration marker: `<div id="root" data-ssr="landing">`; removed by `LandingPage`'s own mount effect (Task 1), **not** from the root: React 19 hydrates a dehydrated Suspense boundary at OffscreenLane after the root commits, so a root-level removal would un-hide the promo before the landing boundary hydrates.
- Pre-paint attributes on `<html>` (Task 2): `data-js` (always, set by the inline script), `data-consent-stored` (localStorage `consent_v1` non-null), `data-promo-dismissed` (`mesaas_promo_dismissed === '1'`). CSS that hides stored-state UI is scoped to `#root[data-ssr]` so it stops applying after hydration.
- Prerendered `/` has `<body class="landing-page">`.
- No new runtime dependencies. User-facing copy unchanged; no em-dashes in any new user-facing copy.
- Parallel agents scope prettier/eslint to their own files; nobody commits except the controller. **Never edit a file another task owns**: report the need to the controller instead.
- Already done by the controller (commit `0007192ce`): `test/vitest.setup.ts` is node-safe (`// @vitest-environment node` files work); `getSavedLanguage()` is exported from `@mesaas/i18n` and returns `'pt'` without/throwing storage; `apps/crm/src/boot/i18nResources.ts` exports `I18N_RESOURCES` and `I18N_LAZY`, which `main.tsx` uses and `entry-server.tsx` must use (no duplicated resource lists).
- Hydration-stable reads use `useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)`, never `useState` + a passive effect: a server/client snapshot mismatch re-renders synchronously in the same flush (no painted frame), and on the `createRoot` path (SPA nav to `/`) the client snapshot is used on the first render (no regression vs today).

## Review Focus

1. Visitor with stored consent → no cookie-banner flash before hydration, and the banner can still reappear if they revoke consent later in the session (CSS hide must stop after hydration). Test in Task 2 (CSS scoping) + Task 4 (marker removal).
2. Visitor with `en` saved → page hydrates in `pt` with no mismatch, then switches to `en`. Test in Task 2 (`initialLanguage`) + Task 4 (post-hydration `changeLanguage`).
3. Landing chunk fails to load → server HTML stays, no error boundary, Sentry once, one retry. Test in Task 4.
4. JS disabled → all sections visible (reveal not hidden). Test in Task 1 (CSS selector contract).
5. Signed-in visitor on `/` → CTA shows the anonymous label in HTML, flips to "Acessar painel" after auth, no recoverable error even when `AuthProvider` already knows the user during hydration. Test in Task 1 (hydrateRoot test with a user).
6. Whole landing hydrates with zero recoverable errors in the stored-state variants. Test in Task 1 (`renderToString` → `hydrateRoot` with an `onRecoverableError` spy).

---

### Task 1: Landing tree renders the same on server and first client render

**Files:**
- Create: `apps/crm/src/lib/useIsHydrated.ts`, `apps/crm/src/lib/__tests__/useIsHydrated.test.tsx`
- Modify: `apps/crm/src/pages/landing/LandingPage.tsx` (Hero CTAs, `PromoBanner`), `LandingChrome.tsx` (header CTAs, `isDark` init, footer year, `useLandingChrome` idempotent add), `Testimonials.tsx` (`prefersReducedMotion` in render), `landing.css` (reveal gating, promo pre-paint hide), any other landing file the grep below finds
- Modify: `apps/crm/vite.config.ts` and `vitest.config.ts` (`define: { __BUILD_YEAR__ }`), `apps/crm/src/vite-env.d.ts` (`declare const __BUILD_YEAR__: string;`)
- Test: `apps/crm/src/pages/landing/__tests__/LandingSsr.test.tsx` (new), existing landing tests

**Interfaces:**
- Produces: `useIsHydrated(): boolean` — `false` during SSR and the hydrating render, `true` after (implement with `useSyncExternalStore(subscribeNoop, () => true, () => false)`). Global `__BUILD_YEAR__: string` (`JSON.stringify(String(new Date().getFullYear()))` in both configs; check `npm run lint` accepts it). `LandingPage` mount effect: `document.getElementById('root')?.removeAttribute('data-ssr')` (runs after the landing boundary hydrated, so the promo/consent pre-paint hides hand over to React state with no frame in between).

- [ ] **Step 1: Write failing tests** in `LandingSsr.test.tsx` (`// @vitest-environment node`, mock `@/context/AuthContext` with `{ user: null, loading: true }` and with a user):
  - `renderToString(<MemoryRouter><LandingPage/></MemoryRouter>)` does not throw with no `window`/`document`/`localStorage`.
  - HTML contains `Começar teste grátis` (hero + header) while `loading: true`; with `{ user: {id:'u'}, loading: false }` it contains `Acessar painel`.
  - HTML contains `promo-banner` and `© ${__BUILD_YEAR__} Mesaas`.
  - `Testimonials` renders without `window.matchMedia`.
  - `useIsHydrated.test.tsx`: `renderToString` of a probe returns `false`; client `render` (jsdom) shows `true` after mount.
  - `LandingHydration.test.tsx` (jsdom, the core proof): `renderToString(<MemoryRouter><LandingPage/></MemoryRouter>)` with auth `{user:null, loading:true}` → set `container.innerHTML` (plus `data-ssr="landing"` on the container) → set `localStorage` `mesaas_promo_dismissed='1'`, `consent_v1` stored, `data-theme="dark"` on `<html>`, `matchMedia` reduced-motion `true` → `hydrateRoot(container, …, { onRecoverableError: spy })` inside `act` → `spy` not called; promo banner gone; `data-ssr` removed. Second case: hydrate with auth `{user:{id:'u'}, loading:false}` → `spy` not called, then after `act` the CTA reads `Acessar painel`.
  - CSS contract (read `landing.css` as text): the hidden reveal rule's selector starts with `html[data-js]` and contains `.reveal:not(.in)`; there is no unscoped `.lp-root .reveal {… opacity: 0`; promo hide rule is `html[data-promo-dismissed] #root[data-ssr] .promo-banner { display: none }`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/landing apps/crm/src/lib/__tests__/useIsHydrated.test.tsx` → FAIL. (Note: `LandingHydration` also needs the cookie banner hidden by Task 2's CSS only in a browser; in jsdom it only checks React state, so it does not depend on Task 2.)
- [ ] **Step 3: Implement.** CTAs: render the signed-in link only when `useIsHydrated() && user && !loading`, else the logged-out one (no more `!loading &&` gate). `PromoBanner`: `dismissed` = `useSyncExternalStore(subscribe, () => readStorage() || dismissedThisSession, () => false)` (close button keeps writing storage and notifies). `isDark` and `Testimonials` reduced motion: `useSyncExternalStore` with server snapshot `false` (subscribe to the `data-theme` MutationObserver / `matchMedia` change if the current code reacts to changes, otherwise noop). Footer: `__BUILD_YEAR__`. `useLandingChrome`: `classList.add` is already idempotent; keep removal on unmount. Grep the landing tree (`apps/crm/src/pages/landing/**`, `components/consent/**`, `content/landing*`) for other render-time `Date`, `Math.random`, `Intl`/`toLocale*`, `window`, `document`, `localStorage`, `navigator` and fix the same way.
- [ ] **Step 4: Run** the same command + `npx tsc -p apps/crm/tsconfig.json --noEmit` → PASS.

### Task 2: Boot-time state is server-safe and pre-paint hides stored-state UI

**Files:**
- Modify: `packages/i18n/index.ts` (`initialLanguage` only; `getSavedLanguage` is done), `packages/i18n/__tests__/index.test.ts`
- Modify: `apps/crm/index.html` (inline pre-paint script only; the `#lp-ssr` 8 s timer and `<noscript>` rule target `#lp-ssr` by id and are already no-ops on `/` once Task 3 stops writing it, so leave them)
- Modify: `apps/crm/style.css` (core): cookie-banner pre-paint hide
- Test: `apps/crm/src/__tests__/prePaintScript.test.ts` (new)

**Interfaces:**
- Already exists: `getSavedLanguage(): Language`. Produces: `initI18n(resources, { lazy?, instance?, initialLanguage?: Language })` — `initialLanguage` overrides the saved language for init only (does not write storage). Consumed by Task 3 (`'pt'` on the server) and Task 4 (hydration path).
- Produces: CSS `html[data-consent-stored] #root[data-ssr] .cookie-banner { display: none; }` in core `style.css`.

- [ ] **Step 1: Failing tests.** i18n: with `localStorage` stubbed to throw/undefined (`vi.stubGlobal`), `getSavedLanguage()` → `'pt'` and `initI18n` doesn't throw; with `mesaas-language='en'` stored and `initialLanguage: 'pt'`, `instance.language === 'pt'` and storage still `'en'`. Pre-paint: extract the inline `<script>` blocks from `apps/crm/index.html`, run them in jsdom with given localStorage, assert `data-js` always set, `data-consent-stored` iff `consent_v1` set, `data-promo-dismissed` iff the promo key is `'1'`, and that a throwing `localStorage` leaves `data-js` set without errors.
- [ ] **Step 2: Run** `npx vitest run packages/i18n apps/crm/src/__tests__/prePaintScript.test.ts` → FAIL.
- [ ] **Step 3: Implement** (attribute names exactly as Global Constraints; script stays ES5, try/catch around storage).
- [ ] **Step 4: Run** the tests + `cssSplitBoundary.test.ts` + 4× tsc → PASS.

### Task 3: SSR entry, SSR build and prerender of `/`

**Files:**
- Create: `apps/crm/src/entry-server.tsx`, `apps/crm/vite.ssr.config.ts`, `apps/crm/src/__tests__/entryServer.test.tsx`
- Modify: `scripts/seo/prerender.tsx` (build + import SSR bundle, write `/`), `scripts/seo/routePreload.ts` only if needed, `.gitignore` if the cache path isn't ignored, `.github/workflows/ci.yml` (new job `landing-prerender-smoke`, same setup steps as `typecheck-and-test`: `npx vite build --config apps/crm/vite.config.ts && npm run prerender` with placeholder `VITE_SUPABASE_URL=https://placeholder.supabase.co`/`VITE_SUPABASE_ANON_KEY=placeholder`, then `grep -q 'data-ssr="landing"' dist/index.html && grep -q 'lp2-hero' dist/index.html`), CLAUDE.md + README "Build & Deploy" (prerender now runs a Vite SSR build into `node_modules/.cache/landing-ssr`; landing render code must be hydration-stable; CI job count 8 → 9), `package.json` only if a script is needed
- Test: `entryServer.test.tsx` (`// @vitest-environment node`)

**Interfaces:**
- Consumes: Task 1 (`useIsHydrated`, `__BUILD_YEAR__`), Task 2 (`initI18n(…, { initialLanguage: 'pt' })`), `I18N_RESOURCES`/`I18N_LAZY` from `apps/crm/src/boot/i18nResources.ts`. Init i18n only if `!i18n.isInitialized` (the test setup already initialised the singleton in `pt`).
- Produces: `export async function render(url: string): Promise<{ html: string }>` — `html` is the inner HTML of `#root`. Prerender writes `<div id="root" data-ssr="landing">${html}</div>` and `<body class="landing-page">` for `/` only; the `#lp-ssr` mirror is no longer written for `/`; prerender throws if `html` lacks `lp2-hero` or contains `__staticRouterHydrationData`.

- [ ] **Step 1: Failing test** `entryServer.test.tsx`: `await render('/')` (no DOM globals) → contains `class="lp2-hero"`, `Começar teste grátis`, `cookie-banner`, Suspense markers (`<!--$-->`), no `lp-ssr`, no `__staticRouterHydrationData`; `render` twice is deterministic (same string).
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/__tests__/entryServer.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `entry-server.tsx` (init i18n `pt` once; static handler over `[{ path: '*', element: <App/> }]` queried with `new Request('http://localhost' + url)` (absolute URL required); `prerender(<StaticRouterProvider router context hydrate={false} />)` and read with `await new Response(prelude).text()`), `vite.ssr.config.ts` (`apps/crm/vite.config.ts` exports a `defineConfig(() => …)` callback and `mergeConfig` throws on callbacks: call it with `{ command: 'build', mode: 'production' }` first, then `mergeConfig` it with `build: { ssr: 'src/entry-server.tsx', outDir: <repo>/node_modules/.cache/landing-ssr, manifest: false, emptyOutDir: true }`, `ssr.noExternal` as needed for CSS-importing packages), and prerender integration (programmatic `build()` from `vite`, then dynamic `import()` of the output; `process.exit(0)` after all files are written, since the Supabase client/timers can keep Node alive). Module-scope browser access is already guarded (`landing-styles.ts`, `App.tsx` warm-up try/catch); if the server import still hits one, **report it to the controller** with the file and line, don't edit other tasks' files.
- [ ] **Step 4: Run** the test, then `node scripts/with-env.mjs npx vite build --config apps/crm/vite.config.ts && node scripts/with-env.mjs npm run prerender` → `dist/index.html` has `data-ssr="landing"`, `class="landing-page"`, the hero, preload tags from #714; normalized diff (Global Constraints) of every other `dist/*.html` and `dist/blog/**` against a build of `origin/main` is empty. `npx tsc -p tsconfig.scripts.json` passes.

### Task 4: Client hydrates `/` safely

**Files:**
- Create: `apps/crm/src/boot/mountApp.ts`, `apps/crm/src/boot/__tests__/mountApp.test.ts`
- Modify: `apps/crm/src/main.tsx` (use `mountApp`; i18n `initialLanguage: 'pt'` on the hydration path), `apps/crm/src/App.tsx` (`SavedLanguageSync` component rendered in the root tree, renders `null`: effect calls `i18n.changeLanguage(getSavedLanguage())` when it isn't the current language; nothing under `pages/landing/` uses `useTranslation`, so only the consent UI re-renders; marker removal is Task 1's, not here; `preloadLanding` unchanged)

**Interfaces:**
- Consumes: Task 2 `getSavedLanguage`, `initI18n` option; marker from Task 3.
- Produces: `mountApp(opts: { container: HTMLElement; element: ReactNode; isSsr: boolean; preload: () => Promise<void>; report: (err: unknown) => void; hydrate?: typeof hydrateRoot; create?: typeof createRoot; timeoutMs?: number; ssrTimeoutMs?: number }): Promise<'hydrated' | 'rendered' | 'static'>`. A late-arriving chunk after `'static'` is not hydrated (the page stays the server HTML; links still work).
  - `isSsr` false → `preload` raced against `timeoutMs` (2000) as today, then `create` + render → `'rendered'`.
  - `isSsr` true → await `preload` raced against `ssrTimeoutMs` (10000; a stalled `import()` never rejects); a timeout counts as a failure. On success `hydrate(container, element, { onRecoverableError })` → `'hydrated'`, where `onRecoverableError` calls `report` at most once per page load; on failure `report` once, retry `preload` once, hydrate on success, else leave the DOM untouched → `'static'`.

- [ ] **Step 1: Failing tests** with injected fake `hydrate`/`create`: each branch above returns the right value, `report` call counts (once on first failure, never twice even if hydration also reports), `hydrate` never called after two failures, a never-settling `preload` with fake timers ends `'static'` after two timeouts with `report` called once, `create` never called when `isSsr`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/boot` → FAIL.
- [ ] **Step 3: Implement** `mountApp`; wire `main.tsx` (`isSsr = container.dataset.ssr === 'landing' && location.pathname === '/'`, `report` = `Sentry.captureException` tagged `ssr-hydration`); add `SavedLanguageSync`. `main.tsx` passes `initialLanguage: 'pt'` only when `isSsr`.
- [ ] **Step 4: Run** `npx vitest run apps/crm/src/boot apps/crm/src/__tests__/App*.test.tsx` + 4× tsc → PASS.

### Task 5: Integrated verification (controller + verification agents)

- [ ] Full gates: 4× tsc, `npm run lint` (0 errors), `npm run format:check`, `npx vitest run`, `npm run coverage:check`.
- [ ] Browser (prod build served locally): anonymous `/` → zero console hydration warnings/errors; `report` never called; screenshots after hydration vs main pixel-identical (phone/desktop + cookie prefs open) with the #718 harness; JS-disabled screenshot shows every section.
- [ ] Variants recover with no dead page: stored session, stored consent (no banner flash: screenshot before JS runs via `page.route` blocking the entry script), promo dismissed (no shift), `data-theme=dark` stored, `en` saved, landing chunk blocked (stays static, Sentry stub called once).
- [ ] Other routes and `app.html`: screenshot diff vs main identical; authenticated smoke (dashboard renders after login).
- [ ] Lighthouse mobile alternated vs main (≥ 3 runs each): report score, FCP, LCP, TBT, CLS; check CLS from the Plus Jakarta swap per spec (switch to `font-display: optional` on the landing if ≥ 0.05).
- [ ] DESIGN_SYSTEM.md (CRM stylesheet / prerender mentions): note the landing is server-rendered and hydrated, and the `#root[data-ssr]` pre-paint hides.
- [ ] Commit, PR with numbers.

## Parallelism

Tasks 1, 2 and 4 touch disjoint files and run in parallel. Task 3 runs in parallel too, but its Step 4 (real render) needs Tasks 1 and 2 landed; its agent builds the infra first and runs the end-to-end render last. Task 5 after all four.
