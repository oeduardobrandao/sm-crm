# liquidGL Trial on the Admin Portal — Design

**Date:** 2026-06-30
**Branch:** `feat/liquidgl-admin-trial`
**Status:** Approved (design), pending implementation plan

## Goal

Apply the [liquidGL](https://github.com/naughtyduk/liquidGL) "Apple Liquid Glass" aesthetic to the **admin portal** (`apps/admin/`) as a contained, internal-only trial. The admin app is a safe, non-user-facing sandbox. The purpose is to let the owner evaluate the real effect in their own app and then decide whether to roll it out to the user-facing CRM and Hub apps. **This is a visual trial, not a production commitment.**

## Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fidelity | **Real liquidGL (WebGL)** | Faithful trial of the actual library, not a CSS approximation. Informs the real cost of an app-wide rollout. |
| Scope | **Chrome + Dashboard showcase** | Glass sidebar + new glass topbar app-wide; full glass treatment + animated backdrop on the Dashboard. Other pages get glass chrome but keep current content. Avoids glassifying dense data tables (looks cluttered). |
| Toggle | **Defaults ON, with a kill-switch** | A "Liquid Glass" switch in the sidebar footer (persisted to localStorage) so the owner can A/B instantly and disable if perf disappoints. When OFF, vendor scripts never load (zero cost). |
| Theme | **Tuned for dark mode** | Glass reads best over a dark, colorful field. Light mode still works but is not glass-optimized. |
| Backdrop | **Animated (throttled) with static fallback** | Slow CSS-drift mesh gradient registered as dynamic content, at reduced `resolution` for perf. Falls back to a static rich backdrop if janky; glass still shifts via hover-tilt + scroll. |

## About liquidGL (grounding facts)

- **WebGL library**, not a CSS theme. It snapshots the DOM with `html2canvas`, then renders true lens refraction (magnification + distortion) through fixed-position `.liquidGL` panes into one shared WebGL canvas.
- Vanilla JS attaching a global `liquidGL()` function. `html2canvas` is a **separate, non-bundled** dependency.
- **License:** README states "MIT © NaughtyDuk" and "free to use for both non-commercial and commercial purposes." (GitHub's API reports no standalone `LICENSE` file, but the README's explicit MIT grant covers vendoring + a future commercial rollout.)
- **Vendored files** (from repo `scripts/`, `main` branch):
  - `scripts/liquidGL.js` (67 KB) — https://raw.githubusercontent.com/naughtyduk/liquidGL/main/scripts/liquidGL.js
  - `scripts/html2canvas.min.js` (199 KB) — https://raw.githubusercontent.com/naughtyduk/liquidGL/main/scripts/html2canvas.min.js
  - (`scripts/jquery.ripples-min.js` is for an unrelated water demo — **not used**.)
- **Init API** (from README):
  ```js
  liquidGL({
    snapshot: 'body',     // element captured for refraction
    target: '.liquidGL',  // selector for glass panes
    resolution: 2.0,      // snapshot quality 0.1–3.0 (we tune DOWN for perf)
    refraction: 0.01,
    bevelDepth: 0.08,
    bevelWidth: 0.15,
    frost: 0,
    shadow: true,
    specular: true,
    reveal: 'fade',
    tilt: false,
    tiltFactor: 5,
    magnify: 1,
    on: { init(instance) {} },
  });
  ```
- `liquidGL.registerDynamic(selector)` — register animated content (our backdrop) for live re-sampling.
- **No React/SPA integration guidance exists** — we engineer it ourselves.

### Known caveats to design around
- Snapshot re-render on route change can cause a brief flicker (mitigate with `reveal: 'fade'`).
- GPU-intensive; keep `resolution` modest (~1.0–1.5).
- Safari is unstable when a glass pane exceeds ~50% of viewport. Our panes (220px sidebar, short topbar, small cards) are all well under half the viewport, so we are naturally safe.
- html2canvas cannot capture everything pixel-perfectly (cross-origin images, nested canvas). Our inline SVG logo + CSS backdrop are compatible.
- ~30 instances/page ceiling. We are far below it.

## Architecture

All new code is isolated under `apps/admin/src/liquidglass/` + two vendored files, so the trial is removable as one folder plus a few small diffs.

### New files

- `apps/admin/public/vendor/liquidGL.js` — vendored library.
- `apps/admin/public/vendor/html2canvas.min.js` — vendored dependency.
  - Loaded **on demand** by the provider only when the effect is enabled (injected `<script>` tags), so disabling the trial costs nothing.
- `apps/admin/src/liquidglass/LiquidGlassProvider.tsx` — React context. Holds `enabled` state (init from `localStorage['admin-liquid-glass']`, default ON), exposes `toggle()`, and lazy-loads the vendor scripts when enabled (resolves a ready promise once `window.liquidGL` + `window.html2canvas` exist).
- `apps/admin/src/liquidglass/useLiquidGlass.ts` — the single owner of imperative library calls. Responsibilities:
  - After mount + scripts ready, call `liquidGL({...})` once and keep the instance in a ref.
  - Subscribe to `useLocation()`; after each route paints, refresh the snapshot and re-collect `.liquidGL` targets (chrome panes persist; Dashboard tiles mount/unmount per route).
  - `registerDynamic` the backdrop.
  - Refresh on resize.
  - Clean teardown when disabled/unmounted.
  - Exact refresh/destroy method names to be confirmed by reading the vendored source during implementation.
- `apps/admin/src/liquidglass/LiquidBackdrop.tsx` — fixed, full-viewport animated mesh-gradient backdrop (dark base + slow-drifting brand-color blobs: yellow `#eab308`, logo blue `#3984FF`, teal `#6AC9D0`, pink). The primary thing the glass refracts. Rendered behind all content.
- `apps/admin/src/liquidglass/glass.css` — DOM-side styling for `.liquidGL` panes (radius, translucent base, z-index, positioning, bevel/specular helpers) + backdrop keyframes + a graceful **glass-off fallback** (panes look like today's normal solid cards when disabled).

### Modified files (small diffs)

- `apps/admin/src/main.tsx` — wrap the app tree in `<LiquidGlassProvider>`.
- `apps/admin/src/layouts/AdminLayout.tsx` — render `<LiquidBackdrop/>`; make the sidebar a translucent `.liquidGL` pane (today it is solid `#12151a`); add a new sticky glass topbar (page title + theme toggle); call `useLiquidGlass()`; add the "Liquid Glass" toggle switch in the sidebar footer.
- `apps/admin/src/pages/DashboardPage.tsx` — add `.liquidGL` + glass base classes to the KPI cards and panels.

### Data / control flow

```
LiquidGlassProvider (enabled? scripts loaded?)
        │  enabled = true
        ▼
AdminLayout renders LiquidBackdrop (fixed, z-0)
        │
        ├─ Sidebar  .liquidGL pane (persistent across routes)
        ├─ Topbar   .liquidGL pane (persistent across routes)
        └─ <Outlet> → DashboardPage tiles .liquidGL (route-scoped)
        │
        ▼
useLiquidGlass: init liquidGL({ snapshot: backdrop+content, target: '.liquidGL' })
        │  on route change → refresh snapshot + recollect targets
        │  registerDynamic(backdrop)
        ▼
Shared WebGL canvas renders refraction beneath the real DOM panes
```

## Isolation & removal

- Delete `apps/admin/src/liquidglass/` and `apps/admin/public/vendor/` and revert the 3 small diffs → trial is fully gone.
- When the toggle is OFF, the glass-off CSS fallback renders normal cards and the vendor scripts are never injected.

## Out of scope

- CRM (`apps/crm/`) and Hub (`apps/hub/`) apps — untouched.
- No glass treatment on dense data tables (Workspaces, Plans, Admins, Banners, KB).
- No changes to admin functionality, routing, auth, or data — purely visual.
- No automated tests for the visual effect (it is a throwaway trial); a smoke check that the admin app still builds (`npm run build` equivalent) and the toggle works is sufficient.

## Open implementation details (resolve during the plan/build)

1. Confirm exact liquidGL instance methods (`refresh` / `destroy` / how targets are re-collected) by reading the vendored source.
2. Decide whether `snapshot` targets `body` or a dedicated wrapper that includes the backdrop + content but excludes the shared WebGL canvas (avoid feedback loops).
3. Tune `resolution`, `refraction`, `bevelDepth`, `frost`, `specular`, `tiltFactor` for the dark backdrop.
4. Confirm the admin app's React version + Tailwind setup for the glass utility classes.
