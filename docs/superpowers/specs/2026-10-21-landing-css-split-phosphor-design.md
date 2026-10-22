# Landing: render-blocking CSS split + Phosphor out of the public pages

Follow-up to #714 (items 5 and 6 of the 2026-10-21 PageSpeed map). Mobile PSI on `/`: the CRM's
one stylesheet (`index-*.css`, 627 KB raw / 86 KB gz) blocks first paint and ~99% of it is unused
on the landing. The Phosphor icon loader (unpkg script → 6 jsdelivr stylesheets, all six weights)
loads on every page; measured locally at ~+3 score / −0.5 s LCP when absent.

## Facts this design rests on

- `index-*.css` = `apps/crm/style.css` (18.9k lines; ≈20 KB gz of Tailwind output from its
  `@tailwind` directives + ≈45 KB gz hand-written) + 12 Vidro sheets imported by `main.tsx`
  (`styles/vidro.css`, `styles/vidro-body/*.css`, ≈20 KB gz). `index.html` also links
  `/style.css`, which Vite resolves to the same bundle.
- Vidro rules are scoped to `html[data-look="vidro"]`, which only signed-in desktop users get
  (pre-paint script in `index.html`, `lib/vidroLook.ts`).
- Phosphor (`ph`, `ph-bold`, `ph-fill`; regular/bold/fill only — thin/light/duotone are unused) is
  only rendered by authenticated-area code: layout (Sidebar, TopBar, TabletTopBar, MobileNav),
  instagram/tiktok cards, CalendarioPage, CobrancaPage, store/integrations, a DOM helper in
  lib/supabase.ts. `style.css` defines `ph-spin`.
- Every authenticated route renders inside `ProtectedRoute` (lazy since #714; its chunk also holds
  `AppLayout`). Signed-in visitors warm that chunk at module scope in `App.tsx`.
- The Hub imports `../../crm/style.css` wholesale. Admin doesn't load it.

## Design

1. **Shell styles module.** New `apps/crm/src/styles/app-shell.ts`, imported (side effect) only by
   `components/layout/ProtectedRoute.tsx`:
   - imports the 12 Vidro sheets (moved out of `main.tsx`, same order);
   - imports `apps/crm/app.css` (step 3);
   - imports Phosphor's regular/bold/fill stylesheets from the npm package `@phosphor-icons/web`
     pinned at `2.1.2` (the version the CDN serves today; its `exports` map has `./regular`,
     `./bold`, `./fill`). Self-hosted: the icon CSS rides the awaited shell CSS (no icon pop-in),
     the fonts get hashed `/assets/` names under the immutable cache header, and the unpkg +
     jsdelivr origins and SRI upkeep go away. Fonts still load on first use, not blocking.
   Vite emits all of this CSS with the ProtectedRoute chunk and its preload helper waits for it
   before the module runs (vite 6.4 preload helper), so the shell never renders unstyled. A 404 on
   that CSS after a deploy goes through `vite:preloadError`, which `installDeployRecovery` handles.
   **Warm-up gate.** `App.tsx` warms the ProtectedRoute chunk at module scope when a stored session
   exists. That would pull the shell CSS and Phosphor into public pages for signed-in visitors, so
   the warm-up now also requires the document to be the app shell (`app.html`, the only page with
   `<meta name="robots" content="noindex">`); prerendered public pages never warm it. Icons then
   start loading at warm-up, earlier than today on app routes.
2. **index.html:** remove the unpkg `<script>`. `vercel.json`'s report-only CSP drops `unpkg.com`
   (and jsdelivr where it was only there for Phosphor).
3. **Split `style.css`** into
   - `apps/crm/style.css` (**core**, stays render-blocking everywhere): the `@tailwind`
     directives, both `@layer base` token blocks, the unlayered `:root`/`[data-theme]` tokens,
     global element/reset rules, `#lp-ssr`, and every rule any **public** code can render;
   - `apps/crm/app.css` (**app**): rules only authenticated-area code renders.
   A rule moves to `app.css` only if *every* selector in it contains at least one class that public
   code never uses. Element/attribute-only/universal selectors, `:root`, `@font-face`, `@keyframes`
   referenced by a core rule, and `@layer`/`@apply` blocks stay in core (`@apply` needs the Tailwind
   directives in the same file). Media/supports blocks are split rule by rule, keeping the at-rule
   wrapper in both files when needed. Source order is preserved inside each file.
   `.ph-spin` and `@keyframes ph-spin` stay in core (tiny; `iconFontContract.test.ts` pins them).
   **Public code** = derived from the build manifest: the entry's static closure plus the static
   closure of every route chunk not behind ProtectedRoute (same walk as `scripts/seo/routePreload.ts`),
   including `packages/*` modules, i.e.
   (landing, precos, blog, marketing, novidades, legal, login/criar conta, configurar-senha,
   conectar, afiliados ×3, 404), plus `index.html`, the prerender mirrors (`*.seo.ts`) and anything
   portalled from the entry (CookieConsent + preferences dialog, Toaster, dialogs/sheets primitives).
   Class tokens are collected conservatively from those files' string/template literals; a dynamic
   prefix (`` `status-${x}` ``) keeps every rule whose class starts with that prefix.
   **Cascade order.** Today core and app rules are interleaved; after the split every `app.css`
   rule follows every core rule (on authenticated pages and in the Hub). So a rule M may move only
   if no core rule R that came *after* M in the original file could tie with it: for every such R
   that sets a property M also sets, either no selector pair shares a class (and neither is a
   pure element/attribute selector that the other could also match), or their specificities
   differ. Anything ambiguous stays in core. `@keyframes` names must be unique across both files
   (duplicates are flagged and resolved by hand). The script prints the list of rules it kept in
   core for ordering reasons, for review.
   **One-shot migration.** The splitting script lives outside the repo (it's a migration, not a
   workflow): its output is committed and both files are hand-edited from then on, each with a
   header comment saying which side a new rule belongs on. A committed Vitest guard keeps the
   boundary: every class defined in `app.css` must not appear in the public source files (the same
   set of modules reached by a static import walk from `main.tsx` and the public lazy routes in
   `App.tsx`, plus `packages/*` they import; `:is()/:where()/:not()` arguments count), so a future public page that starts using an
   app-only class fails CI instead of rendering unstyled.
4. **Hub** imports `crm/style.css` then `crm/app.css`: the same rules, reordered exactly as on
   CRM authenticated pages (so the cascade audit above covers it; `apps/hub/index.html:380-386`
   already overrides some CRM rules and must be re-checked).
5. **Tests that read `style.css` directly** (badge, month-grid, mobileResponsiveFinalContracts,
   ClienteFinanceResponsive, ios-kit css-parity, iconFontContract, vidroContracts): a shared
   `readCrmCss()` test helper returns core + app concatenated; vidroContracts' import-order
   assertions move from `main.tsx` to `app-shell.ts`.
6. **Docs:** DESIGN_SYSTEM.md (CRM stylesheet section) and the icon-font test comment.

## Risks and how they're checked

- *A public page loses a rule* → screenshot diff of every public route (phone 375 + desktop
  1440; cookie banner and preferences dialog open; login/criar-conta tabs) on builds of main vs
  this branch: must be pixel-identical (or explained).
- *Cascade order change* between a rule that moved and one that stayed, on the same element →
  screenshot diff of key authenticated pages (dashboard, clientes, cliente detalhe, entregas board,
  post editor, calendário, configuração) at desktop + phone, plain and Vidro look, against main.
- *Shell CSS arrives late* → none expected (Vite awaits CSS before resolving the chunk); checked in
  the browser with a cold load of `/dashboard`.
- *Hub regressions* → Hub screenshot diff of home/postagens against main.
- *Self-hosted icons missing* (font asset paths) → verified by the authenticated screenshots (sidebar icons).

## Success

- `/` render-blocking CSS: 86 KB gz → core only (target < 30 KB gz).
- No Phosphor requests on public pages; signed-in pages show the same icons.
- Local Lighthouse (same method as #714) before/after.
