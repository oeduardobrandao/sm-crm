# iPad and touch tablets get the phone layout

Status: draft for approval (2026-11-18). Mockups: https://claude.ai/artifact/9PrFWNohQ76TYWFciqbgGm

## Intent

The iOS app now ships on iPhone and iPad (`apps/mobile/APP_STORE.md`: "Devices: iPhone and iPad").
Today an iPad gets the desktop shell: the Vidro icon rail (768-1100px) or the full sidebar
(over 1100px), hover-driven menus, dense tables. iPads are touch devices, and the phone layout
(bottom tab bar, pushed screens, sheets, 44pt targets) was built for touch. So every touch
tablet should get the phone layout, adapted to the wider screen, in both orientations.

## Goals

- Every touch-primary device gets the phone shell and the phone version of every page: the
  iPad app, iPad Safari and Android tablets, portrait and landscape.
- Phones in portrait are unchanged. Phones in landscape (844-956pt wide), which get the
  tablet/desktop layout today, get the phone shell too (owner decision, 2026-11-18).
- Desktops and laptops with a mouse or trackpad are unchanged, including narrow windows
  (768-1100px keeps the Vidro rail or the classic drawer).
- The phone screens read well at 744-1376pt: a centered column by default, full width on the
  three screens that gain from it (see "Width").

## Non-goals

- No new iPad-only features (split view, multi-column master/detail, pointer hover effects).
- No change to the Hub (`apps/hub`) or Admin layouts. The Hub imports the CRM's CSS, so this
  work must not let phone rules leak into it (see Constraints).
- Public pages (landing, preços, blog, login, criar conta, etc.) keep their current responsive
  behavior. The scope is every route inside `AppLayout`, as with D25 of `apps/mobile/DECISIONS.md`.
- No user toggle between phone and desktop layouts on a tablet.

## Anti-goals (would count as failure even if it "works")

- Phone markup under desktop CSS, or desktop markup under phone CSS, on any device. The JS gate
  and the CSS gate must always agree.
- Vidro glass styling on a touch tablet.
- A desktop or laptop with a mouse ever seeing the phone shell above 767px.
- Something an iPad can do today that it can no longer do: a route, or a feature the phone
  view cuts (see "Feature parity on tablets").

## Approaches considered

1. **Shared media-query rule (chosen).** Phone = `(max-width: 767px), (hover: none) and
   (pointer: coarse)`. JS reads it through one constant and hook. CSS uses the same query in
   every phone block, with the exact opposite query on the desktop side. Pure CSS, no
   pre-paint script, no flash, mechanical to review.
2. **Pre-paint attribute.** An inline script in `index.html` sets `<html data-shell="phone">`.
   CSS moves from media queries to attribute selectors. One source of truth, and it could later
   allow "app only" or a user toggle, but the CSS rewrite is much bigger and the attribute has
   to keep up with input changes. Rejected for cost.
3. **Raise the width breakpoint to about 1100px.** Misses every iPad in landscape except the
   mini (1180-1376pt wide) and catches narrow desktop windows. Rejected.

Owner picked approach 1 on 2026-11-18.

## Decided

### The trigger

- `PHONE_SHELL_QUERY = '(max-width: 767px), (hover: none) and (pointer: coarse)'`.
- Its exact logical inverse, for desktop-only CSS. `NOT (hover: none AND pointer: coarse)` is
  `hover: hover OR pointer: fine OR pointer: none`, so:
  `DESKTOP_SHELL_QUERY = '(min-width: 768px) and (hover: hover), (min-width: 768px) and (pointer: fine), (min-width: 768px) and (pointer: none)'`.
  Leaving out the `pointer: none` branch would let a wide device with no pointer match neither
  query. Where a rule is `screen and (min-width: 768px)` (all of Vidro, plus four blocks in
  `app.css`: sidebar collapse and the guide pill), `screen` stays on each
  branch. A unit test enumerates every combination of width (767/768), `hover` (none/hover) and
  `pointer` (none/coarse/fine), evaluates both query strings with a small matcher, and asserts
  exactly one matches each time.
- Width ranges that today mean "tablet desktop" (`(min-width: 768px) and (max-width: 1100px)`,
  `useIsTablet` in `AppLayout`) also need the "has a pointer" condition, so they only match
  desktops.
- The query is live: if a device's primary input changes (a Bluetooth mouse or trackpad on a
  tablet), the layout switches. That matches the CSS behavior and needs no special handling.

### Width (option 3 of the mockups)

- **Default, every screen:** inside the phone shell, at widths of 768px and up, the content area
  is a centered column, `max-width: 680px`. Pushed screens (`PhoneNavBar` screens, the full-screen
  post editor, the fluxo screen) follow the same column.
- **Tab bar:** at 768px and up, the floating tab bar is centered and capped at 420px wide.
- **Full width:** these route roots opt out of the column, and nothing else does:
  `/entregas`, `/calendario` (every tab, Agenda included), `/analytics`, `/analytics/tiktok`,
  `/analytics/youtube`, `/analytics/google`, `/analytics/:id/:tab?` and `/analytics-fluxos`.
  The client detail's Entregas tab (`/clientes/:id/entregas`) stays in the column, like the rest
  of the client detail. In that mode their collections use the width:
  - Entregas Kanban and Status boards: the phone columns sit side by side, each at least 260px,
    scrolling sideways when they don't all fit (mockup: 3 visible in portrait, 4 in landscape).
    The other Entregas views (lista, calendário, gráfico, concluídos) stay in the column unless
    the builder finds one that clearly gains from the width; note any such call in the PR.
  - Agenda: on a tablet (see "Feature parity on tablets"), the week view is the desktop
    FullCalendar week time grid with drag-to-reschedule, filling the width. The month and list
    views are the phone ones, stretched to the width.
  - Calendário (financeiro, comemorativas): the phone month grid fills the width.
  - Analytics (my call, the mockups don't draw it): the phone sections lay out in two columns
    from 1000px wide, one column below. The builder may keep a section full width where two
    columns don't help (a long chart).

### Feature parity on tablets (owner decision, 2026-11-18)

- **Tablet** here means phone shell AND `(min-width: 768px) and (min-height: 600px)`. The height
  condition keeps an iPhone in landscape (390-440pt tall) out: it gets the plain phone views.
  Exposed as `useIsTabletShell()` from the same module.
- On a tablet, the screens whose phone view blocks work the desktop allows render their
  **desktop component, full width, inside the phone shell** (tab bar and phone header stay):
  - Report editor (`relatorio-editor/phone/ReportPhoneView.tsx` is read-only, "Edite o layout no
    computador").
  - Linha editorial create and edit (`LinhaPhoneView.tsx`, "Crie a linha… no computador",
    "Edite a linha no computador").
  - Agenda week view: FullCalendar `timeGridWeek`, with `editable` on (today
    `editable: !isPhone && ev.editable`).
  The desktop components must still work by touch (no hover-only controls). The builder lists
  any hover-only control found and fixes it.
- Smaller cuts get **ported to the phone views**, so iPhone gains them too: bulk post selection
  in `WorkflowDrawer`, the workflow history in the client's `EntregasTab`, the Google disconnect
  button. The Entregas tour and explainer may stay desktop-only.
- The builder audits every `isPhone`/`!useIsDesktop(768)` branch for other cuts and sorts each
  into one of the two buckets above, listing them in the PR. Copy saying "no computador" must
  never show on a tablet.

### Wiring

- One module, for example `apps/crm/src/lib/phoneShell.ts`, exports `PHONE_SHELL_QUERY`,
  `DESKTOP_SHELL_QUERY` and `useIsPhoneShell()`. `AppLayout`'s `useIsMobile`/`useIsTablet`,
  `MobileNav`, `ContextHelpLinks`, `useIsLinhaPhone`, `AgendaTab`'s `useMediaQuery`,
  `useIsPhoneEditor` and `PostMediaLightbox` (today `max-width: 768px`, one pixel off the rest)
  read from it. `PhoneLayoutContext.isPhone` then follows automatically. Toasts (`sonner.tsx`)
  have no query of their own: they read `--phone-toast-offset`, set in a `style.css` phone
  block, so they move with the CSS sweep.
- **Test polarity:** `useIsPhoneShell()` is implemented as "not `DESKTOP_SHELL_QUERY`". The
  vitest `matchMedia` stub returns `false` for every query, so the hook is `true` in jsdom,
  which keeps the ~116 `!useIsDesktop(768)` sites on the phone branch in tests, as today. The
  few sites that today ask the positive question (`useIsLinhaPhone`, `AgendaTab`,
  `ContextHelpLinks`, `MobileNav`, `AppLayout`'s `useIsMobile`) currently render desktop in
  tests and flip to phone. Their tests get updated or mock the hook explicitly.
- **Outside `AppLayout`:** a component that can render outside the shell (for example
  `PagarmeCheckoutDialog` and `HelpTooltip` on `/comecar`, a `ProtectedRoute` outside
  `AppLayout`) keeps a width-only check or reads `PhoneLayoutContext`, which is `false` outside
  the shell. Only code inside `AppLayout` uses `useIsPhoneShell()` directly.
- The ~116 `useIsDesktop(768)` calls are swept one by one. Each either means "phone shell" (moves
  to `useIsPhoneShell()`) or "there is room for two columns" (stays width-based, for example a
  form that lays out side by side at 768px). Default to "phone shell" when unsure; jsdom's
  matchMedia stub returns false, so tests that render the mobile branch today keep doing so.
  Tests that mock `useIsDesktop` need the same review.
- CSS, phone side: every `max-width: 767px` block in `style.css`, `app.css` and the page `.css`
  files is reviewed. Blocks styling the signed-in shell or its pages take the full phone query.
  Blocks styling public pages (`.auth-card` and the rest of what `cssSplitBoundary.test.ts`
  treats as public) keep `max-width: 767px`.
- CSS, desktop side: every `min-width: 768px`, `(min-width: 768px) and (max-width: 1100px)`,
  `min-width: 901px` and `min-width: 1101px` rule that styles the signed-in shell is audited
  too, not only Vidro. Shell rules take `DESKTOP_SHELL_QUERY` (or add its condition to the
  range). Known cases: `app.css` hides `.mobile-more-sheet`/`.mobile-more-overlay` at
  `min-width: 768px`, which would hide the Mais sheet on an iPad and strand every route only
  Mais reaches; `.guide-pill` and the sidebar/drawer rules are shown at `min-width: 768px` and
  must not appear in the phone shell.
- CSS, wider phone-side ranges: rules at `max-width: 900px` and `max-width: 1100px` (and
  `768-1100px` ranges) have always applied to phone markup too, and stop applying on an
  820-1376px tablet. Each one that phone markup relies on gains the touch branch, for example
  `(max-width: 900px), (hover: none) and (pointer: coarse)`. Known cases:
  `body:has(.mobile-nav-glass) .cookie-banner` at `max-width: 900px` (lifts the banner above the
  tab bar) and the `.mobile-nav-glass` rules inside `(min-width: 768px) and (max-width: 1100px)`
  in `style.css`. The guard test covers these ranges, not only 767/768.
- Wider page branches (`useIsDesktop(901)` in EntregasPage, Leads, Financeiro, Automações,
  ContactsTab, AutomationContactsSection, Arquivos, and any CSS at 900/901/1100) stay
  width-based for desktops but must also check the shell: a landscape iPad is 1180px wide, so a
  bare `useIsDesktop(901)` would render the desktop variant (for example the Entregas
  Responsáveis aside) inside the phone shell. Each becomes `!isPhoneShell && useIsDesktop(901)`
  or the equivalent, and the audit lists each one in the PR.
- A guard test fails when a phone media query in CRM CSS or a JS `matchMedia` call uses a bare
  767/768 width where the shared query was expected. The test needs an explicit allowlist for
  the public-page blocks.

## Constraints

- **Three gates move together:** JS hooks, CSS phone blocks, and the Vidro gate (`vidro.css`,
  `vidro-body/*.css`, all `screen and (min-width: 768px)`, pinned by `vidroContracts.test.ts`).
  The Vidro intro (`isIntroDue`) and `useVidro` must also treat a touch tablet as "no Vidro shell".
- **The Hub imports `crm/style.css` and `crm/app.css`.** Any phone rule that now matches on a
  touch tablet and targets a selector the Hub uses (`body`, `#root`, `.avatar`, tooltips,
  dialogs) changes the Hub on iPad. Check the Hub on an iPad-size touch viewport before merging.
- **Hydration:** the landing is server-rendered. Nothing here may read `matchMedia` during render
  on public pages. `useIsPhoneShell()` is only used inside `AppLayout` (see "Outside
  `AppLayout`").
- **`cssSplitBoundary.test.ts`:** moving rules between `style.css` and `app.css` follows the
  existing rules in `DESIGN_SYSTEM.md`.
- **Docs to update:** `DESIGN_SYSTEM.md` (Layout table), `apps/mobile/DECISIONS.md` (a new
  decision that supersedes D17's width-only gate and D24's landscape rule), and CLAUDE.md where it
  describes the breakpoints.
- **App Store:** the iPad screenshots in `APP_STORE.md` (Kanban, week Agenda in the desktop
  shell) won't match after this ships. Retake them before the next iPad submission.

## Verification

- The Browser pane emulates a mouse, so `(hover: none) and (pointer: coarse)` never matches there.
  Verify the tablet path in the iOS Simulator on an iPad (iPad Air 11" and iPad Pro 13", both
  orientations), in Safari and in the app build. Use the Browser pane for the regression
  checks: desktop at 1280, narrow desktop at 800 (Vidro rail must stay) and phone at 390.
- On a real iPad, with and without a Magic Keyboard trackpad: record which layout it gets. If the
  trackpad flips it to desktop, that is accepted behavior (see "The trigger"), but write it down
  in the PR.
- Screens to walk on iPad: Início, Entregas (each view, plus the post editor and fluxo screen),
  Agenda, Calendário, Clientes and a client detail, Mensagens, Analytics, Configurações, the Mais
  sheet, a few dialogs and sheets. On iPad also: the report editor, Linha editorial create/edit
  and the Agenda week grid with drag, all by touch.
- iPhone in landscape (Simulator, iPhone 16 Pro): header plus floating tab bar in about 400pt of
  height, a bottom sheet, the post editor and its bottom bar, rotating with the editor open.
- The full CI list from CLAUDE.md (five `tsc`, lint, format, vitest, functions).

## Left to the builder

- The exact split of the `useIsDesktop(768)` calls, as long as the rule above holds.
- Bottom sheets, action sheets and dialogs that render as phone sheets: centered and capped at
  680px wide on screens of 768px and up, or full width. Builder's call per primitive; keep it
  consistent.
- How each full-width screen implements its wide mode (CSS class on the page root, a prop, or a
  context flag), as long as the column rule is one place and the opt-out is explicit.
- iPad mini portrait (744pt, already under 768px) gets the phone layout today and keeps it; the
  768px+ column and tab bar cap don't apply to it.
