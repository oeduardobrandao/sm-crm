# Touch Tablets Get the Phone Layout: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every touch-primary device (iPad app, iPad Safari, Android tablets, iPhones in landscape) gets the CRM phone shell, with a centered column, a full-width mode on Entregas/Calendário/Analytics, and the desktop editors that the phone views block shown inside the shell on tablets.

**Architecture:** One module, `apps/crm/src/lib/phoneShell.ts`, owns the media queries and hooks. `useIsDesktop(n)` becomes shell-aware (desktop shell AND at least n px), so its ~130 call sites and ~120 test mocks keep working unchanged. CSS phone blocks gain the touch branch, desktop-only shell blocks (Vidro included) gain the exact inverse, and a guard test pins both.

**Tech Stack:** React 19, Vite, Vitest + jsdom, plain CSS (`style.css`, `app.css`, page `.css`, `styles/vidro*.css`), FullCalendar, dnd-kit.

**Spec:** `docs/superpowers/specs/2026-11-18-ipad-phone-layout-design.md` (read it before any task).

## Global Constraints

- `PHONE_SHELL_QUERY = '(max-width: 767px), (hover: none) and (pointer: coarse)'`
- `DESKTOP_SHELL_QUERY = '(min-width: 768px) and (hover: hover), (min-width: 768px) and (pointer: fine), (min-width: 768px) and (pointer: none)'`
- Vidro and the other `screen and (min-width: 768px)` blocks keep `screen` on every branch of the desktop query.
- Tablet = phone shell AND `(min-width: 768px) and (min-height: 600px)`: `TABLET_SHELL_QUERY = '(hover: none) and (pointer: coarse) and (min-width: 768px) and (min-height: 600px)'`.
- Wide phone shell (column and tab-bar cap apply) = `PHONE_WIDE_QUERY = '(hover: none) and (pointer: coarse) and (min-width: 768px)'`.
- Column `max-width: 680px`, centered. Tab bar capped at `420px`, centered. Bottom/action sheets capped at `680px`, centered (decided here; spec left it to the builder).
- Full-width route roots, exactly: `/entregas`, `/calendario`, `/analytics`, `/analytics/tiktok`, `/analytics/youtube`, `/analytics/google`, `/analytics/:id/:tab?`, `/analytics-fluxos`. `/clientes/:id/entregas` stays in the column.
- Entregas board columns side by side, each `minmax(260px, 1fr)`, sideways scroll when they don't fit.
- Analytics phone sections in two columns from `1000px` wide.
- Public pages (landing, preços, blog, login, criar conta, configurar-senha, conectar, afiliados, `/comecar`) keep their current behavior. Nothing reads `matchMedia` during render on public pages.
- UI copy is pt-BR, no em dashes. "no computador" copy never shows on a tablet.
- Never use `useBlocker`. Icons: lucide-react.
- Run the CI list from CLAUDE.md before claiming done: `npm run lint`, `npm run format:check`, the five `tsc` commands, `npm run test`.

## Review Focus

1. **A mouse or trackpad attached while a phone overlay is open** (the query flips live): the Mais sheet and phone overlays close cleanly, no stuck scroll lock, no half-desktop shell. Test in Task 2.
2. **A touch laptop with a mouse** (`hover: hover`, `pointer: coarse`): stays on desktop. Test in Task 1 (matcher case).
3. **The Hub on an iPad:** CRM phone blocks now match on touch tablets and the Hub imports CRM CSS. Nothing Hub-visible should change. Test in Task 3 (guard: no `hub-` selector inside a phone-shell block) plus Task 12 walk.
4. **Cookie banner and toasts on a tablet** sit above the floating tab bar, as on phones. Test in Task 3 (guard pins the touch branch on the cookie-banner and `--phone-toast-offset` blocks).
5. **Rotating an iPad or iPhone with an editor or sheet open**: the page does not remount and no draft is lost when `data-phone-wide` or the tablet state changes. Test in Task 5 (AppLayout keeps the same page element across a wide-attribute change).

---

### Task 1: The phone-shell module and a shell-aware `useIsDesktop`

**Files:**
- Create: `apps/crm/src/lib/phoneShell.ts`
- Create: `apps/crm/src/test/mediaQueryMatcher.ts` (test helper)
- Modify: `apps/crm/src/hooks/useIsDesktop.ts`
- Test: `apps/crm/src/lib/__tests__/phoneShell.test.ts`

**Interfaces:**
- Produces:
  - `PHONE_SHELL_QUERY`, `DESKTOP_SHELL_QUERY`, `TABLET_SHELL_QUERY`, `PHONE_WIDE_QUERY`: `string` (values in Global Constraints)
  - `desktopShellQuery(minWidth: number, opts?: { maxWidth?: number; screen?: boolean }): string` — the three-branch desktop query at `minWidth` (and optional `max-width`, optional `screen and` prefix on each branch). `desktopShellQuery(768)` equals `DESKTOP_SHELL_QUERY`.
  - `useMediaQueryMatch(query: string): boolean` — live `matchMedia`, `false` when `matchMedia` is missing, SSR-safe (no `window` at module scope).
  - `useIsPhoneShell(): boolean` = `!useMediaQueryMatch(DESKTOP_SHELL_QUERY)` (true in jsdom).
  - `useIsPhoneShellMatch(): boolean` = `useMediaQueryMatch(PHONE_SHELL_QUERY)` (false in jsdom). Same runtime answer as `useIsPhoneShell()` (the two queries are exclusive and exhaustive); only the jsdom default differs. Used by the sites that today ask the positive question, so their tests keep rendering desktop by default.
  - `useIsTabletShell(): boolean` = `useMediaQueryMatch(TABLET_SHELL_QUERY)` (false in jsdom).
  - `useIsWidePhoneShell(): boolean` = `useMediaQueryMatch(PHONE_WIDE_QUERY)`.
  - `useMinWidth(px: number): boolean` — raw `(min-width: Npx)`, for code that can render outside `AppLayout`.
  - `useIsDesktop(minWidth = 768)` keeps its signature; it now returns `useMediaQueryMatch(desktopShellQuery(minWidth))`.
  - Test helper `matchesQuery(query: string, env: { width: number; height: number; hover: 'none' | 'hover'; pointer: 'none' | 'coarse' | 'fine'; media?: 'screen' | 'print' }, opts?: { unknownFeatures?: 'throw' | 'true' }): boolean` — evaluates comma lists of `and`-joined `screen`, `print`, `min/max-width`, `min/max-height`, `hover`, `pointer` features. Unknown features (`prefers-reduced-motion`, `prefers-reduced-transparency`, ...) throw by default and evaluate to true with `unknownFeatures: 'true'` (the CSS guard uses that).
  - Test helper `mockMatchMediaEnv(env)` in the same file: installs a `window.matchMedia` that answers every query with `matchesQuery(query, env, { unknownFeatures: 'true' })` and lets a test fire `change` on registered listeners after changing `env`. Tasks 2, 5 and later use it instead of ad-hoc `includes('max-width: 767px')` stubs.
  - Note: the global vitest `matchMedia` stub lives at repo-root `test/vitest.setup.ts` (returns `matches: false`).

- [ ] **Step 1: Write the failing tests** in `phoneShell.test.ts`:
  - `phone and desktop shell queries are exclusive and exhaustive`: for every width in `[390, 767, 768, 820, 1180, 1440]`, hover in `['none','hover']`, pointer in `['none','coarse','fine']`: `expect(matchesQuery(PHONE_SHELL_QUERY, env) !== matchesQuery(DESKTOP_SHELL_QUERY, env)).toBe(true)`.
  - `iPad portrait and landscape are phone shell`: `{width:820,height:1180,hover:'none',pointer:'coarse'}` and `{width:1180,height:820,...}` match `PHONE_SHELL_QUERY` and `TABLET_SHELL_QUERY`.
  - `iPhone landscape is phone shell and wide, not tablet`: `{width:844,height:390,hover:'none',pointer:'coarse'}` matches `PHONE_SHELL_QUERY` and `PHONE_WIDE_QUERY`, not `TABLET_SHELL_QUERY`.
  - `touch laptop with a mouse stays desktop`: `{width:1280,height:800,hover:'hover',pointer:'coarse'}` matches `DESKTOP_SHELL_QUERY`.
  - `narrow desktop window stays desktop`: `{width:800,height:900,hover:'hover',pointer:'fine'}` matches `DESKTOP_SHELL_QUERY`, not `PHONE_SHELL_QUERY`.
  - `desktopShellQuery builds ranges and screen prefixes`: `desktopShellQuery(768)` `toBe(DESKTOP_SHELL_QUERY)`; `desktopShellQuery(901)` matches `{width:1180,hover:'hover',pointer:'fine'}` and not `{width:1180,hover:'none',pointer:'coarse'}`; `desktopShellQuery(768,{maxWidth:1100})` does not match width 1180; `desktopShellQuery(768,{screen:true})` does not match `media:'print'`.
  - `useIsDesktop and useIsPhoneShell polarity in jsdom`: render hooks with the default vitest stub (`matches: false`): `useIsDesktop(768)` is `false`, `useIsPhoneShell()` is `true`, `useIsTabletShell()` is `false`.

- [ ] **Step 2: Run** `npx vitest run apps/crm/src/lib/__tests__/phoneShell.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `phoneShell.ts`, `mediaQueryMatcher.ts` and the new `useIsDesktop` body. Update `useIsDesktop`'s doc comment: "True at or above `minWidth` px on a desktop shell (mouse or trackpad). Touch-primary devices are never desktop; see lib/phoneShell.ts."

- [ ] **Step 4: Run** the same file. Expected: PASS. Then `npx vitest run apps/crm/src/hooks` and expect PASS.

- [ ] **Step 5: Commit** `feat(crm): phone-shell media queries and shell-aware useIsDesktop`.

---

### Task 2: Shell wiring (AppLayout, MobileNav, the stray queries, code outside the shell)

**Files:**
- Modify: `apps/crm/src/components/layout/AppLayout.tsx:115-141` (`useIsTablet`, `useIsMobile`)
- Modify: `apps/crm/src/components/layout/MobileNav.tsx:104` (`phoneMedia`)
- Modify: `apps/crm/src/components/help/ContextHelpLinks.tsx:12-20` (`usePhoneViewport`)
- Modify: `apps/crm/src/pages/entregas/linha/useIsLinhaPhone.ts`
- Modify: `apps/crm/src/pages/entregas/components/PostMediaLightbox.tsx:91`
- Modify: `apps/crm/src/components/billing/PagarmeCheckoutDialog.tsx` (the only `useIsDesktop` caller reachable outside `AppLayout`, via `/comecar`). `HelpTooltip` and `StatCardGrid` never render outside the shell: leave them.
- Modify (JS width checks the shell must override): `apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx:53` (1100px), `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx:1049` (900px), `TourOverlay` (reads `innerWidth`), `apps/crm/src/pages/calendario/agenda/AgendaTab.tsx:68-70,170` (its `useMediaQuery('(max-width: 1100px)')` is the sidebar-in-sheet query, not a phone gate: on a touch tablet it must report "in sheet" too, i.e. `useMediaQuery('(max-width: 1100px)') || isPhone`)
- Test: `apps/crm/src/components/layout/__tests__/AppLayout.test.tsx`, `MobileNav.test.tsx` (literal `'(max-width: 767px)'` at ~line 292), `apps/crm/src/components/help/__tests__/ContextHelpLinks.test.tsx`, `PagarmeCheckoutDialog.test.tsx`, `CobrancaPage.test.tsx`, `ComecarPage.test.tsx`

**Interfaces:**
- Consumes: Task 1's `useIsPhoneShellMatch`, `useMediaQueryMatch`, `desktopShellQuery`, `PHONE_SHELL_QUERY`, `useMinWidth`, `mockMatchMediaEnv`.
- Produces: `PhoneLayoutContext.isPhone` true on touch tablets inside `AppLayout`; `useIsPhoneUi(): boolean` in `phoneShell.ts` = `usePhoneLayout().isPhone || !useMinWidth(768)` for components that can render both inside and outside the shell.

- [ ] **Step 1: Rebuild the AppLayout test helpers.** `AppLayout.test.tsx`'s `mockMatchMedia` (routes on `includes('max-width: 767px')`) and `setViewport` (sets `innerWidth`) become thin wrappers over `mockMatchMediaEnv(env)` with named envs: `PHONE = {390,844,none,coarse}`, `TABLET_TOUCH = {1180,820,none,coarse}`, `NARROW_DESKTOP = {800,900,hover,fine}`, `DESKTOP = {1440,900,hover,fine}`. Re-point every existing test to the env it meant; they must still pass against the old code before Step 3 (they test today's behavior).
- [ ] **Step 2: Write the failing tests.** `AppLayout` renders `<Sidebar>` and `<MobileNav>` unconditionally (CSS hides them) and the test file mocks both, so assert on what does switch:
  - `touch tablet gets the phone shell`: under `TABLET_TOUCH`, `PhoneShellHeader` renders and `TopBar` does not; no `.vidro-panel`; the Sidebar mock receives the phone-shell props (`collapsible` false, as in the existing phone test); the Vidro intro is not shown (`isIntroDue` gets `vidroShell: false`).
  - `narrow desktop keeps the Vidro rail`: under `NARROW_DESKTOP`, `TopBar`/`.vidro-panel` render and the Sidebar mock receives `railOnly`.
  - `MobileNav closes the Mais sheet when the phone shell query stops matching` (Review Focus 1): under `TABLET_TOUCH` open Mais, switch env to `DESKTOP` and fire `change`, assert the sheet is gone and `document.body` has no scroll-lock style.
- [ ] **Step 3: Run** those tests. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Sites that today ask the positive question use `useIsPhoneShellMatch()` / `PHONE_SHELL_QUERY` (jsdom default stays desktop, as today): `AppLayout.useIsMobile`, `MobileNav`'s `phoneMedia`, `ContextHelpLinks.usePhoneViewport`, `useIsLinhaPhone`, `PostMediaLightbox`.
  - `AppLayout.useIsTablet` → `useMediaQueryMatch(desktopShellQuery(768, { maxWidth: 1100 }))`.
  - `PagarmeCheckoutDialog` → `useIsPhoneUi()`; add the matching mocks to its three test files.
  - The four JS width checks listed under Files gain `|| isPhone` (or the desktop-shell form) so a touch tablet takes their phone branch.
  - Leave every other `useIsDesktop(...)` call as is (Task 1 made it shell-aware).
- [ ] **Step 5: Run** `npm run test`. Expected: PASS. Fix only tests that hard-code the old literal queries; never change a behavior assertion.
- [ ] **Step 6: Commit** `feat(crm): touch tablets render the phone shell`.

---

### Task 3: The CSS guard, and the sweep of `style.css` and `app.css`

**Files:**
- Modify: `apps/crm/style.css`, `apps/crm/app.css`
- Create: `apps/crm/src/__tests__/phoneShellCss.test.ts`
- Modify: CSS-literal tests that break (known: `InstagramPostCarousel.test.tsx:49`; find the rest with `npm run test`)

**Interfaces:**
- Consumes: Task 1's query constants, `desktopShellQuery`, `matchesQuery` (with `unknownFeatures: 'true'`); `readCrmCss()` from `apps/crm/src/test/readCrmCss.ts`; the public class set `cssSplitBoundary.test.ts` computes (extract its collector into a shared helper `apps/crm/src/test/publicCssClasses.ts` if it is not exported).
- Produces: `CSS_GUARD_FILES` (this task: `style.css`, `app.css`; Task 4 widens it), `REVIEWED_WIDTH_BLOCKS` (prelude + first selector → reason), reused by Task 4.

The guard is semantic, not string-equality. Envs: `P = {390,844,none,coarse}`, `T = {1180,820,none,coarse}`, `Tp = {820,1180,none,coarse}`, `D = {1440,900,hover,fine}`, `N = {800,900,hover,fine}`, all `media: 'screen'`. For each `@media` block in `CSS_GUARD_FILES` whose prelude has a width or height feature, evaluate the prelude under each env and split the block's selectors into public (every class in the public set, or element/`:root` selectors on public pages) and shell.

- [ ] **Step 1: Write the failing guard tests** in `phoneShellCss.test.ts`:
  - `no desktop range reaches a touch tablet`: for shell selectors, `(T || Tp) && (D || N) && !P` never holds (catches bare `min-width: 768px`, the 1101-1440 `.main-content` repad at `style.css:1920`, 769/901/1280 blocks).
  - `phone rules reach touch tablets`: for shell selectors, `P && !(T && Tp)` holds only if the block is in `REVIEWED_WIDTH_BLOCKS` with a reason (a narrow-desktop rule that phone markup does not rely on). Bare `max-width: 767px` shell blocks fail here.
  - `public blocks keep their widths`: a block whose selectors are all public is exempt; a block mixing public and shell selectors fails until split.
  - `the Mais sheet is not hidden on a touch tablet`: the block hiding `.mobile-more-sheet` does not match `T`.
  - `banner and toasts clear the tab bar on tablets` (Review Focus 4): the blocks holding `body:has(.mobile-nav-glass) .cookie-banner` and `--phone-toast-offset` match `T` and `Tp`.
  - `Hub classes in newly matching phone blocks are reviewed` (Review Focus 3): collect class tokens from string literals under `apps/hub/src` and `apps/hub/index.html`; any shell selector in a block matching `P && T` that names one of them must be in `HUB_REVIEWED_SELECTORS` with a reason. Seed that list from what the sweep finds.
  - `no bare phone/desktop width in JS`: no file under `apps/crm/src` except `lib/phoneShell.ts` and tests contains a `matchMedia(` call whose literal includes `767`, `768px` or `767.98`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/__tests__/phoneShellCss.test.ts`. Expected: FAIL listing every unconverted block.
- [ ] **Step 3: Convert `style.css` and `app.css`** until the guard passes:
  - Shell `max-width: 767px` blocks → `PHONE_SHELL_QUERY`. Split mixed blocks (e.g. `style.css:1408` is public `.auth-wrapper`; 1821 `.mobile-nav-glass` and 2192 `.card` are shell).
  - Shell `min-width: 768px`, `screen and (min-width: 768px)`, 768-1100, 769, 901, 1101+, 1280 blocks → `desktopShellQuery(...)` with the matching `minWidth`/`maxWidth`/`screen`, keeping extra features (`prefers-reduced-motion`) on every branch. Known: `.mobile-more-sheet` hide (~17382), `.guide-pill` (~15057), sidebar collapse (~10029, ~13057-13070), `style.css` 2262-2276, `style.css:1920`.
  - `max-width: 900px` / `1100px` blocks (11 and 4 in `app.css`): each either gains `, (hover: none) and (pointer: coarse)` (phone markup relies on it: the cookie-banner lift, the `.mobile-nav-glass` rules in the 768-1100 range) or goes in `REVIEWED_WIDTH_BLOCKS` with a reason.
  - Don't move rules between the two files (`cssSplitBoundary.test.ts`).
- [ ] **Step 4: Run** `npm run test`. Expected: PASS (guard scoped to `style.css` and `app.css`; fix CSS-literal tests that pinned old preludes).
- [ ] **Step 5: Commit** `feat(crm): CRM stylesheets follow the phone-shell queries`.

---

### Task 4: Vidro, page and component CSS

**Files:**
- Modify: `apps/crm/src/styles/vidro.css`, `apps/crm/src/styles/vidro-body/*.css` (11 files), `apps/crm/src/pages/**/*.css` and `apps/crm/src/components/**/*.css` flagged by the guard (known: `entregas/phone/entregasPhone.css`, `arquivos/phone/arquivosPhone.css`)
- Modify: `apps/crm/src/__tests__/vidroContracts.test.ts` (~line 64), `apps/crm/src/__tests__/vidroBody.*.test.ts(x)` where they pin `@media screen and (min-width: 768px)`
- Modify: `apps/crm/src/__tests__/phoneShellCss.test.ts` (`CSS_GUARD_FILES` widens to `src/styles/**/*.css`, `src/pages/**/*.css`, `src/components/**/*.css`)

**Interfaces:**
- Consumes: `desktopShellQuery(768, { screen: true })` (import it in the Vidro tests instead of the literal); Task 3's guard.

- [ ] **Step 1:** Widen `CSS_GUARD_FILES` and update the Vidro contract tests to expect `desktopShellQuery(768, { screen: true })` (with `prefers-reduced-transparency` appended to every branch where present). Run them; expected FAIL.
- [ ] **Step 2:** Convert the Vidro preludes and the page/component blocks the guard flags.
- [ ] **Step 3: Run** `npm run test`. Expected: PASS.
- [ ] **Step 4: Commit** `feat(crm): Vidro and page styles stay off touch tablets`.

---

### Task 5: Column, tab bar cap, sheet cap and full-width routes

**Files:**
- Create: `apps/crm/src/components/layout/phoneWideRoutes.ts`
- Modify: `apps/crm/src/components/layout/AppLayout.tsx` (set `data-phone-wide` on `.app-container`)
- Modify: `apps/crm/app.css` (column, tab bar, sheets; one block under `PHONE_WIDE_QUERY`)
- Test: `apps/crm/src/components/layout/__tests__/phoneWideRoutes.test.ts`, AppLayout test

**Interfaces:**
- Produces:
  - `PHONE_WIDE_ROUTE_PATTERNS: readonly string[]` (the eight patterns from Global Constraints) and `isPhoneWideRoute(pathname: string): boolean` (React Router `matchPath`, `end: true`, so `/analytics/:id/:tab?` matches `/analytics/42` and `/analytics/42/posts`).
  - `TABLET_WIDE_ROUTE_PATTERNS = ['/relatorios/:id', '/relatorios/modelos/:id', '/relatorios/modelos/padrao']` and `isTabletWideRoute(pathname: string): boolean`: wide only on a tablet, where Task 9 renders the desktop report editor (on an iPhone in landscape the phone report view stays in the column).
  - `.app-container[data-phone-wide]` is present when `isMobile && (isPhoneWideRoute(p) || (isTablet && isTabletWideRoute(p)))`, with `isTablet = useIsTabletShell()`.
  - `PhoneLayoutContext` gains `wideRoute: boolean` (same condition, default `false` outside the shell); `usePhoneLayout().wideRoute` is how Task 6 knows it is on a full-width route.

- [ ] **Step 1: Write failing tests:** `isPhoneWideRoute` is true for `/entregas`, `/calendario`, `/analytics`, `/analytics/tiktok`, `/analytics/youtube`, `/analytics/google`, `/analytics/42`, `/analytics/42/posts`, `/analytics-fluxos`; false for `/clientes/7/entregas`, `/dashboard`, `/clientes`, `/entregas-x`, `/relatorios/9`. `isTabletWideRoute` is true for `/relatorios/9`, `/relatorios/modelos/3`, `/relatorios/modelos/padrao`. AppLayout (using `mockMatchMediaEnv` envs from Task 2): at `/entregas` under `TABLET_TOUCH` `.app-container` has `data-phone-wide` and `wideRoute` is true; at `/dashboard` neither; at `/relatorios/9` under `TABLET_TOUCH` wide, under `{844,390,none,coarse}` not; navigating `/dashboard` → `/entregas` keeps the same `.main-content` DOM node (Review Focus 5).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the module, the attribute, and one `@media (hover: none) and (pointer: coarse) and (min-width: 768px)` block in `app.css`: the page content wrapper inside `.main-content` gets `max-width: 680px; margin-inline: auto` unless `.app-container[data-phone-wide]`; `.mobile-nav-glass` gets `max-width: 420px; margin-inline: auto` (centered against its fixed insets); the phone bottom/action sheet primitives (`components/mobile/BottomSheet.tsx`, `ActionSheet.tsx`, `components/ui/phone-overlay.tsx`) get `max-width: 680px` centered. Full-screen pushed screens (`PhoneNavBar` screens, the phone post editor, the fluxo screen) get the 680px column too, keeping their full-bleed background. Pick the exact wrapper selectors by reading `AppLayout` and those primitives; one rule each.
- [ ] **Step 4: Run** the tests and `npm run test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): centered column and full-width routes on wide phone shells`.

---

### Task 6: Entregas boards side by side

**Files:**
- Modify: `apps/crm/src/pages/entregas/phone/PhoneKanbanBoard.tsx`, `PhoneStatusBoard.tsx`, `entregasPhone.css`
- Test: `apps/crm/src/pages/entregas/views/__tests__/` (where the phone Kanban and Status board tests live)

**Interfaces:**
- Consumes: `useIsWidePhoneShell()` (Task 1) and `usePhoneLayout().wideRoute` (Task 5).
- Produces: both boards take no new props. Wide mode = `useIsWidePhoneShell() && usePhoneLayout().wideRoute`, so the same boards inside the client detail (`cliente-detalhe/tabs/EntregasTab.tsx`, in the 680px column) keep the single-column chips. In wide mode every column renders as its own `section.phone-ent-board__column` (with `aria-label` "nome, contagem" as today), inside a `div.phone-ent-board__columns` grid (`grid-auto-flow: column; grid-auto-columns: minmax(260px, 1fr); gap: 16px; overflow-x: auto; align-items: start`). The chip row is not rendered. Per-column actions are unchanged. The Status board keeps its drop grid while dragging.

- [ ] **Step 1: Write failing tests:** with `useIsWidePhoneShell` mocked `true` and a `PhoneLayoutContext` provider with `wideRoute: true`, the Kanban board renders one `section` per column and no `tablist`; with `wideRoute: false` (client detail) or the hook `false`, today's single panel and chip `tablist` render (existing tests stay green). Same set for the Status board.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the wide branch, reusing the existing column body (extract it to a local component if needed).
- [ ] **Step 4: Run** `npx vitest run apps/crm/src/pages/entregas`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): Entregas boards show every column on wide touch screens`.

---

### Task 7: Agenda week grid on tablets; Calendário month grid full width

**Files:**
- Modify: `apps/crm/src/pages/calendario/agenda/AgendaTab.tsx:168-192,282`, `apps/crm/src/pages/calendario/agenda/phone/AgendaTopoPhone.tsx:13-20`, `apps/crm/src/pages/calendario/agenda/AgendaView.tsx:247-249`
- Modify (if not already fluid): `apps/crm/src/pages/calendario/phone/MesGridPhone.tsx`, `calendarioPhone.css`
- Test: `apps/crm/src/pages/calendario/agenda/__tests__/`

**Interfaces:**
- Consumes: `useIsTabletShell()` (Task 1).
- Produces: `VistaPhone` widens to `AgendaViewType` on tablets only; the tablet default view is `'timeGridWeek'`.

- [ ] **Step 1: Write failing tests:** with `useIsTabletShell` mocked `true`: the phone view switcher offers Semana; Semana renders FullCalendar `timeGridWeek`; events built in `AgendaTab` have `editable` equal to `ev.editable` (today forced `false` on phone). With it `false`: switcher has no Semana and events are not editable (current behavior).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement:** `usaFullCalendar` includes `isTablet && vistaPhone === 'timeGridWeek'`; `periodoPhone` (~line 185) returns `null` for the tablet week too; `editable: (!isPhone || isTablet) && ev.editable`; `AgendaView`'s option filter keeps `timeGridWeek` on tablets. Check the FullCalendar desktop CSS the week grid needs is not behind a desktop-only query (now `desktopShellQuery`) that no longer matches on a tablet; scope any such rule to the component unconditionally. Check the week grid's controls work by touch (FullCalendar `longPressDelay` defaults are fine; no hover-only buttons). Month and list fill the width through Task 5's full-width route.
- [ ] **Step 4: Run** `npx vitest run apps/crm/src/pages/calendario`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): Agenda week grid with drag on tablets`.

---

### Task 8: Analytics sections in two columns

**Files:**
- Modify: `apps/crm/src/pages/analytics/phone/analyticsPhone.css` (`.phone-an` is the shared root of every analytics phone view)
- Test: `apps/crm/src/pages/analytics/phone/__tests__/analyticsPhoneCss.test.ts` (create the `__tests__` folder)

- [ ] **Step 1: Write the failing test:** `analyticsPhone.css` has a block with prelude `(hover: none) and (pointer: coarse) and (min-width: 1000px)` that sets `.phone-an` to `display: grid` with `grid-template-columns: repeat(2, minmax(0, 1fr))`, and the page header child spans `grid-column: 1 / -1`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Read each `.phone-an` view (`AnalyticsPhone`, `ContaPhone`, `TikTokOverviewPhone`, `YouTubeOverviewPhone`, `GoogleOverviewPhone`, `FluxosPhone`, the three `*AnalyticsTabPhone`) and make long charts or tables span both columns with a modifier class where two columns hurt.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): analytics sections in two columns on wide touch screens`.

---

### Task 9: Desktop editors inside the shell on tablets

**Files:**
- Modify: `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx`, `ModeloEditorPage.tsx`, `ModeloPadraoPage.tsx` (where they pick `ReportPhoneView`)
- Modify: `apps/crm/src/pages/entregas/linha/LinhaEditorialView.tsx` (where it picks `LinhaPhoneView`)
- Modify: CSS of those desktop components if any of their rules sit behind a desktop-only query that no longer matches on a tablet
- Test: their `__tests__` folders

**Interfaces:**
- Consumes: `useIsTabletShell()`.

- [ ] **Step 1: Write failing tests:** with `useIsPhoneShell` true and `useIsTabletShell` true, `RelatorioEditorPage` renders the desktop editor and no text "Edite o layout no computador"; `LinhaEditorialView` renders the desktop editor and none of "no computador". With tablet false, today's phone views render.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement:** the phone view is chosen by `isPhone && !isTablet`. The desktop component renders full width inside the phone shell (its own page header may stay; the phone tab bar stays). Check its CSS for rules gated by desktop widths (now `desktopShellQuery`) that it needs; known: `.rb-editor-header` (`app.css:~14458`, 769px, sticky on `--topbar-height`, which the phone shell replaces with `--phone-header-height`) and `.rb-layers-rail` (`app.css:~14482`, 1280px, `position: fixed`). Give them a tablet-shell rule (`TABLET_SHELL_QUERY`) instead of ungating them, so phones are unaffected. The page routes are wide on tablets via Task 5's `TABLET_WIDE_ROUTE_PATTERNS`; Linha editorial lives in `/entregas`, already wide. List any hover-only control and make it reachable by tap.
- [ ] **Step 4: Run** the folders' tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): report editor and Linha editorial editing on tablets`.

---

### Task 10: Audit the remaining phone cuts

**Files:**
- Modify: only files where a cut is confirmed and cheap to port
- Create: `docs/superpowers/plans/2026-11-18-ipad-phone-layout-cuts.md` (the audit table; goes in the PR body)

- [ ] **Step 1:** List every `isPhone` / `!useIsDesktop(768)` / `isPhoneEditor` branch that hides a capability (not just a layout change). Start from the three the spec names: bulk post selection in `WorkflowDrawer.tsx` (a phone select mode exists at ~line 1574: confirm it covers the desktop bulk actions), workflow history in `cliente-detalhe/tabs/EntregasTab.tsx` (a phone history face exists at ~line 461: confirm), Google disconnect in `GoogleAccountCard.tsx` (rendered for phone at ~line 157: confirm).
- [ ] **Step 1b: Tailwind width variants.** About 35 `md:`/`lg:` utilities in shell code stay width-only (the Tailwind config is shared with public pages, so don't change `screens`). List those that render inside the phone shell and would now apply on a tablet (for example `md:grid-cols-2` inside a phone view). Fix each that breaks the phone layout by replacing it with a phone-shell-aware class or a plain CSS rule under `PHONE_SHELL_QUERY`; leave the rest, noted in the table.
- [ ] **Step 2:** For each confirmed cut, decide: port to the phone view (small) or render desktop on tablet (editor-sized, like Task 9). Write the table: file, capability, decision.
- [ ] **Step 3:** Port the small ones with a test each (phone render shows the control and it calls the same handler as desktop).
- [ ] **Step 4: Run** `npm run test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): phone views gain the capabilities tablets used to have`.

---

### Task 11: Docs

**Files:**
- Modify: `DESIGN_SYSTEM.md` (Layout: the three-shell table gets the touch rule; the "Anything position: fixed..." paragraph names `desktopShellQuery`)
- Modify: `apps/mobile/DECISIONS.md` (new D26: touch tablets and phones in landscape get the phone shell; supersedes D17's width-only gate and D24's landscape rule; link the spec)
- Modify: `apps/mobile/APP_STORE.md` (iPad screenshots must be retaken: list the four screens again in the phone shell)
- Modify: `CLAUDE.md` only if it states the shell breakpoints

- [ ] **Step 1:** Edit the docs.
- [ ] **Step 2: Run** `npm run format:check`. Expected: PASS.
- [ ] **Step 3: Commit** `docs: touch tablets use the phone shell`.

---

### Task 12: Verification

- [ ] **Step 1: CI list:** `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p apps/mcp-widgets/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`. Expected: all pass.
- [ ] **Step 2: Browser pane regressions** (mouse, so desktop rules apply): CRM at 1280 (sidebar), 800 (Vidro rail), 390 (phone shell). Screenshot each.
- [ ] **Step 3: iOS Simulator, iPad Air 11" and iPad Pro 13", both orientations, Safari against the dev server:** Início (column), Entregas Kanban and Status (columns side by side), Agenda week grid with a drag, Calendário month, Analytics (two columns in landscape), Clientes and a client detail (column), Mensagens, Configurações, the Mais sheet, a bottom sheet (capped), the report editor and Linha editorial editing, a toast and the cookie banner above the tab bar. Screenshot each.
- [ ] **Step 4: iOS Simulator, iPhone 16 Pro landscape:** header plus tab bar in the short height, a bottom sheet, the post editor and its bottom bar, rotate with the editor open (no lost draft).
- [ ] **Step 5: Hub on the iPad Simulator** (`npm run dev:hub` on :5175): Início, Aprovações, a post dialog look as before.
- [ ] **Step 6:** Note in the PR: the real-iPad trackpad result is pending (needs a device), and which 900/1100 blocks and phone cuts were converted.
