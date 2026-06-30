# liquidGL Trial on the Admin Portal — Design

**Date:** 2026-06-30
**Branch:** `feat/liquidgl-admin-trial`
**Status:** Approved (design), revised after adversarial multi-agent review (verified against the real liquidGL source + actual admin code)

## Goal

Apply the [liquidGL](https://github.com/naughtyduk/liquidGL) "Apple Liquid Glass" aesthetic to the **admin portal** (`apps/admin/`) as a contained, internal-only trial. The admin app is a safe, non-user-facing sandbox. The purpose is to let the owner evaluate the *real* effect in their own app and then decide whether to roll it out to the user-facing CRM and Hub apps later. **This is a visual trial, not a production commitment** — but it must show the *genuine* refraction, or it cannot inform the rollout decision.

## Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fidelity | **Real liquidGL (WebGL)** | Faithful trial of the actual library, not a CSS approximation. Informs the real cost of an app-wide rollout. |
| Scope | **Chrome + Dashboard showcase** | Glass sidebar + new glass topbar app-wide; glass treatment + a backdrop on the Dashboard. Other pages get glass chrome but keep current content. No glass on dense data tables. |
| Toggle | **Defaults ON; OFF = full page reload** | A "Liquid Glass" switch in the sidebar footer (persisted to `localStorage['admin-liquid-glass']`). Before first activation, vendor scripts are never injected (genuinely zero cost). **After** activation the library owns a self-perpetuating rAF loop + WebGL context with no teardown API, so turning it OFF does `window.location.reload()` — acceptable for an internal trial. |
| Theme | **Dark mode only when glass is ON** | Glass reads best over a dark, colorful field. Light-mode-with-glass refracts muddy light-gray content over a dark backdrop next to the always-dark sidebar, which looks broken. When glass is ON we assume/force dark. |
| Backdrop | **Static rich backdrop by default; animation is an explicit opt-in** | CSS `@keyframes` is liquidGL/html2canvas's worst case (it sets `_heavyAnim` and re-rasters the whole snapshot up to ~30×/sec on the main thread). Default to a static brand-colored mesh gradient; motion comes from the cheap GPU-side hover-tilt + scroll. A slow animated drift can be toggled on as an experiment. |
| Topbar | **Page title only** | The new glass topbar carries just the current page title. It does **not** duplicate the existing sidebar-footer theme toggle (keeps the AdminLayout diff small). |

## Critical design constraints (discovered by review — must hold or the effect is fake)

These were verified against the real source (`scripts/liquidGL.js`, pinned commit below) and `apps/admin/src/layouts/AdminLayout.tsx`. They are the difference between the owner seeing real refraction vs. a broken/translucent placeholder.

### C1 — Refracted elements must NOT be `position: fixed`, and lens panes must not sit in their own stacking context
- liquidGL's html2canvas `ignoreElements` callback returns `true` for **any element with computed `position: fixed`**. So the thing being refracted (the backdrop) must be a **non-fixed** element (absolute / in-flow) inside the captured **snapshot wrapper**, or it is excluded from the texture and the glass refracts nothing.
- liquidGL appends its single refraction canvas to `document.body` at `z-index = maxLensZ - 1`. It cannot composite between the backdrop and a lens pane that is trapped in a separate stacking context. Today's sidebar `<aside>` is `fixed inset-y-0 left-0 z-50 ... md:translate-x-0` — `position:fixed`, a numeric `z-index`, **and** a `translate` transform each create a stacking context. Therefore the **glass lens surface for the sidebar must be a non-transformed, non-fixed inner child**, not the `<aside>` itself; for the glass variant we drop the translate-based off-canvas pattern (use a non-transform positioning approach on desktop, and render the solid fallback on mobile).
- **Acceptance check:** on a real render, confirm the sidebar/backdrop show actual lens **magnification/distortion**, not merely translucency.

### C2 — The library has no `destroy`/`refresh`/`removeLens`; design the lifecycle around what exists
Verified public surface of the 2104-line source: **`liquidGL()`, `liquidGL.registerDynamic()`, `liquidGL.syncWith()`** — nothing else. So:
- **"Refresh" on route change = call the renderer's `captureSnapshot()`** (re-rasters the page; it does **not** re-collect `.liquidGL` targets). `captureSnapshot()` early-returns if `_capturing` is already `true` (no queue), so rapid navigation can drop a refresh.
- **Target re-collection model:** calling `liquidGL()` again re-scans `.liquidGL` and `addLens()`es each with **no dedup** (`this.lenses` is push-only), which would double-bind the persistent chrome. Chosen approach: **per-route re-init guarded by a tag-and-skip** — before re-calling `liquidGL()`, strip the `.liquidGL` class from already-bound panes (mark them `dataset.lglBound`) so the re-scan only picks up the newly-mounted Dashboard tiles. This keeps the vendored source **untouched** and avoids duplicate chrome lenses. (Alternative considered: glass-chrome-only with a single init — simpler, but Dashboard tiles only get glass on first load.)
- **Toggle OFF / disable = `window.location.reload()`** — the only way to stop the rAF loop and reclaim the WebGL context. There is no "clean teardown," and "zero cost when OFF" is true **only before first activation**.

## About liquidGL (grounding facts)

- **WebGL library**, not a CSS theme. It snapshots the DOM with `html2canvas`, then renders true lens refraction through `.liquidGL` panes into one shared WebGL canvas.
- The shared canvas is **`pointer-events: none`** and appended to `body`, so clicks/hovers on nav links, theme, and sign-out pass straight through — **interaction is safe** and needs no special handling at the layout level. (The feedback-loop worry is unfounded: the library marks its own canvas `data-liquid-ignore` + `visibility:hidden` during capture, and excludes lens panes.)
- On each lens element the library **overwrites `backdrop-filter` and `background-image` to `none` and sets `pointer-events: none`**; the visible glass fill (frost/specular/bevel) comes from the WebGL render, **not** from CSS on the pane. Any interactive control *inside* a pane must re-enable `pointer-events`.
- `html2canvas` is a **separate, non-bundled** dependency, referenced as a **bare global identifier** — it must be defined on `window` **before** any `liquidGL()` call.
- **License:** README states "MIT © NaughtyDuk" / "free to use for both non-commercial and commercial purposes." Fine for this internal, non-distributed trial. For the eventual rollout the grant is thin (no standalone `LICENSE` file). **Vendor from a pinned commit** — `dbb6e54eec72994407d5fb7a6e0b7790af30cb92` (`main` as of 2026-06-30), not the moving `main` ref — and save the README's MIT text + html2canvas's own MIT notice alongside the vendored files.
- **Vendored files** (from repo `scripts/` at the pinned SHA):
  - `scripts/liquidGL.js` (67 KB)
  - `scripts/html2canvas.min.js` (199 KB)
  - (`scripts/jquery.ripples-min.js` is for an unrelated water demo — **not used**.)
- **Init API** (options): `snapshot`, `target`, `resolution` (tune **down**, ~1.0–1.5, for perf), `refraction`, `bevelDepth`, `bevelWidth`, `frost`, `shadow`, `specular`, `reveal: 'fade'` (masks route-change flicker), `tilt`, `tiltFactor`, `magnify`, `on: { init }`.

### Known caveats (designed around)
- GPU-intensive; keep `resolution` modest. Animated `@keyframes` backdrops hit the html2canvas raster cliff — hence the static default.
- Safari unstable when a pane exceeds ~50% viewport. Our panes (220px sidebar, short topbar, small cards) are well under half — naturally safe.
- ~30 instances/page ceiling — we are far below it.

## Architecture

All new code is isolated under `apps/admin/src/liquidglass/` + vendored files. Removal = delete that folder + the new `apps/admin/public/` tree + revert a handful of small diffs.

### New files
- `apps/admin/public/vendor/liquidGL.js` — vendored library (pinned SHA). *Served at `/admin/vendor/...` in prod, `/vendor/...` in dev.*
- `apps/admin/public/vendor/html2canvas.min.js` — vendored dependency.
- `apps/admin/public/vendor/LICENSE-liquidGL.txt` — saved MIT notice(s) for liquidGL + html2canvas.
  - Vite's **default `publicDir` is `<root>/public` = `apps/admin/public`** (the admin root). No `vite.config.ts` change needed; creating the dir is enough. Files are injected on demand via `<script>` whose `src` is built as **`import.meta.env.BASE_URL + 'vendor/liquidGL.js'`** so it resolves under the `/admin/` prod base (a leading-slash `/vendor/...` would 404 in prod).
- `apps/admin/src/liquidglass/liquidgl.d.ts` — ~6-line ambient declaration for `window.liquidGL` / `window.html2canvas` (without it, strict admin tsconfig fails `build:admin` with TS2339).
- `apps/admin/src/liquidglass/LiquidGlassProvider.tsx` — context. Holds `enabled` (init from localStorage, default ON), exposes `toggle()`. Owns a **module-level memoized `loadVendorScripts()`** that returns one shared promise for concurrent/repeat calls, de-dupes `<script>` injection by id, and resolves only once **both** `window.html2canvas` and `window.liquidGL` exist.
- `apps/admin/src/liquidglass/useLiquidGlass.ts` — the single owner of imperative library calls (see C2 for the contract). Init is **idempotent** (module-level `didInit` guard / `dataset.lglBound` tag-and-skip) to survive React StrictMode's dev double-invoke. Route refresh subscribes to `useLocation().pathname` in a **post-paint `useEffect` + double-`requestAnimationFrame`** before `captureSnapshot()`, coalesces rapid changes, and re-triggers on the next idle frame if `_capturing` was busy. Guards post-load init with an "is still enabled / still mounted" check.
- `apps/admin/src/liquidglass/LiquidBackdrop.tsx` — the brand-colored mesh-gradient backdrop, rendered as a **non-fixed** element inside the snapshot wrapper (per C1). Static by default; optional animated drift behind `@media (prefers-reduced-motion: no-preference)`.
- `apps/admin/src/liquidglass/glass.css` — styles **only** (a) the glass-**OFF** solid-card fallback and (b) pane **geometry** (size/radius/position/z-index). It must **not** rely on `background-image`/`backdrop-filter` for the ON state (the library overwrites them). Backdrop keyframes gated behind `prefers-reduced-motion`.

### Modified files
- `apps/admin/src/main.tsx` — wrap the tree in `<LiquidGlassProvider>`. (Note: `<React.StrictMode>` is on and React is 19.2.4 → init must be idempotent, or relax StrictMode for the admin entry during the trial.)
- `apps/admin/src/layouts/AdminLayout.tsx` — render the snapshot wrapper + `<LiquidBackdrop/>`; sidebar glass lens as a non-transformed inner child (C1); new sticky glass topbar (page title only); call `useLiquidGlass()`; add the "Liquid Glass" toggle in the sidebar footer.
- `apps/admin/src/pages/DashboardPage.tsx` — add `.liquidGL` + glass classes to the KPI cards (and the single "Recent Workspaces" panel — *not* a dense table, so it's in scope).
- `eslint.config.js` — add `apps/admin/public/vendor/` (or `**/public/vendor/`) to `ignores`; otherwise the vendored `liquidGL.js` produces ~137 `no-undef` errors and fails CI `lint`. (`format:check` globs only `.ts/.tsx`, so prettier is unaffected.)

### Data / control flow
```
LiquidGlassProvider (enabled? scripts loaded via memoized loadVendorScripts()?)
        │  enabled = true (else: solid-card fallback, no scripts injected)
        ▼
AdminLayout renders <SnapshotWrapper>:
        ├─ LiquidBackdrop        (NON-fixed, in-flow/absolute, z-0)  ← refracted source
        ├─ Sidebar               (fixed shell; glass lens = non-transformed inner .liquidGL child)
        ├─ Topbar                (.liquidGL pane, page title only)
        └─ <Outlet> → DashboardPage tiles (.liquidGL, route-scoped)
        ▼
useLiquidGlass: liquidGL({ snapshot: wrapper-excluding-canvas, target: '.liquidGL' }) once (idempotent)
        │  on route change → double-rAF → captureSnapshot(); re-init for new tiles via tag-and-skip dedup
        │  registerDynamic(backdrop) only if animation opted-in
        ▼
Shared WebGL canvas (pointer-events:none, body-appended, z = maxLensZ-1) renders refraction
```

## Isolation & removal
- Delete `apps/admin/src/liquidglass/`, delete the new `apps/admin/public/` tree, revert the diffs in `main.tsx`, `AdminLayout.tsx`, `DashboardPage.tsx`, and `eslint.config.js`. No tailwind/vite/index.html reverts are needed (Tailwind content globs already cover `apps/admin/src`; Vite publicDir is the default; scripts are injected at runtime, not in `index.html`). The vendored source is **unmodified** (the dedup is done in our wrapper), so "fully gone" is verifiable.

## Verification checklist (replaces "smoke check it builds")
1. `npm run build:admin` — typecheck (incl. the new `.d.ts`) + admin vite build.
2. `npm run lint` — must pass with the new eslint ignore.
3. `npm run format:check` — unaffected (ts/tsx only) but run it.
4. **Production-mode check:** `vite build` admin + `vite preview` (or load `dist/admin/`) and confirm the injected vendor `src` resolves under `/admin/` (not only `npm run dev:admin`, which uses base `/`).
5. **Manual acceptance:** real lens magnification/distortion is visible on the sidebar + backdrop (C1); nav/theme/sign-out clicks work (pointer-events pass-through); route navigation refreshes glass without duplicate chrome lenses (C2); toggle ON→OFF reloads to a clean non-glass state; OFF on first load injects no vendor scripts.

## Accessibility & rollout-cost notes (so the trial doesn't undercount a real rollout)
- **`prefers-reduced-motion`:** the library honors it nowhere. Gate the animated backdrop + tilt behind it. Harmless to skip for a single-user sandbox, but a user-facing CRM/Hub rollout **would** require this — noting it keeps the owner's cost estimate honest.
- **Light mode & mobile:** light-mode glass is expected to look mismatched (we constrain to dark when ON); the off-canvas mobile sidebar composite is unpolished — render the solid fallback under `md:` (or accept it's rough for the trial).
- **Bundle:** ~266 KB of vendored JS ships publicly under `/admin/` (auth-gated, intended). Confirm the OFF/first-load state injects nothing before merge.

## Out of scope
- CRM (`apps/crm/`) and Hub (`apps/hub/`) — untouched.
- No glass on dense data tables (Workspaces, Plans, Admins, Banners, KB list pages).
- No changes to admin functionality, routing, auth, or data — purely visual.
- No automated tests for the visual effect (throwaway trial); the verification checklist above is the gate.

## Open implementation details (resolve during the plan/build)
1. Final tuning of `resolution`, `refraction`, `bevelDepth`, `frost`, `specular`, `tiltFactor` for the dark backdrop.
2. Exact DOM restructuring of the sidebar shell vs. its inner glass lens (C1), and the precise `snapshot` wrapper selector that includes backdrop + content but excludes the WebGL canvas.
3. Exact tag-and-skip mechanism for per-route re-init dedup (C2) — confirm class-strip-before-reinit behaves against the source's `addLens` scan.
