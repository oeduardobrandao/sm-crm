# Admin iOS redesign (phone + desktop)

Date: 2026-10-12. Branch: `claude/admin-app-ios-redesign-1585fd`.
Reviewed by Fable and Codex before implementation (findings folded in; see "Review log").

## Goal

Redesign the platform Admin (`apps/admin`) in the same iOS idiom the CRM's phone version shipped
in #670–#688, on **both** phones and desktop, with no change to data, routes or backend.

Approved mockups (one canvas, two pages): https://claude.ai/artifact/Vi2PaQpTmpMVit41HetJwh.
The board sources are vendored in the repo, and they are the visual reference implementers read:
`docs/superpowers/specs/2026-10-12-admin-ios-redesign-boards/<Board>.dc.html` (plain HTML with
inline styles; ignore the `support.js`/`dc-import` scaffolding).

- **iPhone (390×844), 29 boards:** Login, Main (Dashboard), DashboardListas, Mais,
  DashboardClaro, Metricas, MetricasMovimento, MetricasDepositos, Workspaces, WorkspacesFiltros,
  WorkspaceDetalhe, WorkspaceDetalhe2, WorkspaceFuncionalidades, WorkspaceLimites, Planos,
  PlanoForm, Afiliados, Comissoes, AfiliadoDetalhe, Admins, Integracoes, Banners, BannerForm,
  Popups, PopupEditor, Artigos, ArtigoEditor, Videos, VideoEditor.
- **Desktop (1440×900, fluid), 18 boards:** DkSidebar (component), DkLogin, DkMain,
  DkDashboardClaro, DkMetricas, DkWorkspaces, DkWorkspaceDetalhe, DkPlanos, DkPlanoForm,
  DkAfiliados, DkAfiliadoDetalhe, DkAdmins, DkIntegracoes, DkBanners, DkPopupEditor, DkArtigos,
  DkArtigoEditor, DkVideos.

The mockups use sample data; the implementation uses the real data each page already loads.
Where a board shows a number or field the page does not have today, **leave it out**. This is a
visual redesign, not a feature project (no new endpoints, columns or metrics).

## Non-goals

- No backend, migration, edge-function or `vercel.json` change. Routes stay exactly as in
  `apps/admin/src/router.tsx`.
- No change to the CRM's look or behaviour. The CRM is touched only by the pure move in Part A.
- Confirmation flows are not redesigned: the existing `window.confirm` calls stay (nine sites:
  IntegrationsPage, MetricasPage, KbArticleEditorPage, KbVideoEditorPage, PopupsPage,
  WorkspaceInvitesCard ×2, WorkspaceDetailPage, SeriesDialog). Phone swipe actions call the same
  handlers, so they hit the same confirm.
- No new unsaved-work tracking. The editors keep today's protection (silent-update DOM heuristic
  on edited controls and open dialogs, `trackUnsavedWork` around uploads). Adding
  `useUnsavedWork` to the KB editors is a follow-up.
- Desktop screens without a drawn mockup (Popups list, Banners form, Video editor, Comissões)
  follow the nearest drawn pattern. No split view, no iPad-specific layout.

## Breakpoint and modes

- **Phone: `< 768px`** (`(max-width: 767px)`, the kit's own threshold and the Admin's current
  `md`). Tab bar + Mais sheet, large titles, grouped lists, sheets.
- **Desktop: `≥ 768px`.** Fixed glass sidebar + fluid content. Wide tables keep
  `overflow-x: auto` inside their panel, so 768–1100px needs no tablet layout.
- `useIsPhone()` (new, `apps/admin/src/hooks/useIsPhone.ts`): `matchMedia('(max-width: 767px)')`
  with a change listener, safe when `matchMedia` is missing. The vitest stub returns
  `matches: false`, so **every existing test keeps rendering the desktop branch**; phone tests
  override `window.matchMedia` (helper `apps/admin/src/test-utils/phone.ts`, `mockPhone()`).
- Theme rules stay: `html[data-theme]` (`admin-theme` in localStorage, default dark);
  `data-liquid-glass` on by default; glass ON forces dark and hides the theme toggle.

## Part A: `@mesaas/ios-kit` (shared package, pure move)

The CRM's generic phone primitives move to `packages/ios-kit` so the Admin runs the same code.
It is a **zero-behaviour-change refactor in its own commit, with its own full gate run**, ahead of
any Admin work, so a CRM regression is bisectable to it and reviewable on its own commit.

### What moves (TSX)

From `apps/crm/src/components/mobile/` to `packages/ios-kit/src/`: `LargeTitleHeader`
(+`PhoneIconButton`), `GroupedList` (+`Cell`), `SegmentedControl`, `BottomSheet`, `ActionSheet`,
`ContextMenu`, `SwipeRow`, `BottomActionBar`, `ChipRow`, `CheckList`, `PickerSheet`, `FormRow`,
`InfoButton`, `BarList`, `PhoneConfirmSheet`, `PhoneFiltersSheet`, `BrandMark`, `sheetActions`,
`useSheetHistory`, `useLongPress`, `useReturnFocus`, `roving`. Plus
`apps/crm/src/hooks/useOverlayHistoryEntry.ts` and `apps/crm/src/lib/normalizeText.ts` (both
have non-kit CRM consumers; their CRM paths become shims too).

Stays in the CRM (depends on the CRM shell): `PhonePageHeader`, `PhoneNavBar`.

- The package carries its own `cn` (`clsx` + `tailwind-merge`, root deps) and imports its own
  files relatively. **No `@/` imports inside the package** (the root vitest config maps `@` to
  `apps/crm/src`).
- **Wiring mirrors `@mesaas/ui` (a directory alias), not `@mesaas/app-lifecycle` (a file
  alias)**, because shims use deep specifiers:
  - `packages/ios-kit/package.json` (`"name": "@mesaas/ios-kit"`, private, `"type": "module"`,
    `"main": "index.ts"`), `packages/ios-kit/index.ts` re-exporting everything.
  - tsconfig `paths` in `apps/crm/tsconfig.json` and `apps/admin/tsconfig.json`:
    `"@mesaas/ios-kit": ["../../packages/ios-kit/index.ts"]` **and**
    `"@mesaas/ios-kit/*": ["../../packages/ios-kit/*"]`.
  - Vite `resolve.alias` in `apps/crm/vite.config.ts` and `apps/admin/vite.config.ts`, and the
    root `vitest.config.ts`: `'@mesaas/ios-kit': path.resolve(…, 'packages/ios-kit')` (directory;
    bare import resolves through `package.json` `main`, deep imports to files). Verify both forms
    resolve in `vite build` and vitest before moving on.
  - `packages/ios-kit/**/*.{ts,tsx}` added to `coverage.include` so moving tested code out of
    `apps/crm/src` does not drop the `coverage-threshold` job. Run `npm run coverage:check`
    before and after. (Package `__tests__` are typechecked by no tsc project, the same as
    `app-lifecycle` today; eslint, prettier, vitest include and Tailwind `content` already
    cover `packages/`.)
- Every moved CRM file becomes a **one-line re-export shim at the same path**, e.g.
  `apps/crm/src/components/mobile/BottomSheet.tsx`: `export * from '@mesaas/ios-kit/src/BottomSheet';`.
  No moved file has a default export (verified). `components/mobile/index.ts` keeps its exact
  export list. Module identity holds (`SheetActionsContext`, the `liveSlots`/`poppingSlots`
  maps in `useOverlayHistoryEntry`), since every CRM importer goes through a shim to one module.
- Tests in `components/mobile/__tests__/` that only exercise moved files move to
  `packages/ios-kit/__tests__/` (import paths only). `PhoneConfirmAndFilters.test.tsx` imports a
  CRM page and `PhoneNavBar.test`/`PhonePageHeader.test` import `PhoneLayoutContext`: they stay
  in the CRM. `pointer.ts` is copied so both sides have it.

### CSS: copied, not moved, with a parity test

The kit CSS lives in `apps/crm/style.css` (the `PHONE KIT` header at ~L15704 up to `KPI tiles`
at ~L17311), and the Hub imports the whole CRM stylesheet. Moving rules out of the middle of
`style.css` changes the cascade, and the CRM phone app shipped days ago. So **the CRM stylesheet
is not edited** in this project:

- `packages/ios-kit/ios-kit.css` is a verbatim copy of these `/* ---- … ---- */` sections:
  the `.phone-kit` token block and its dark block, large title + icon buttons, nav bar, grouped
  list + cells (incl. switch), segmented control, bottom sheet, action sheet, context menu,
  swipe row, bottom action bar, chip row, sheet sized to content, sheet text buttons, filters
  sheet, checkmark list, form rows, info button, bar list; plus the `.phone-field` base rules
  `FormRow` builds on (CRM editor section, ~L17889).
- **Not copied:** the F0c "dialog primitives as sheets" section (keyed to markup only the CRM
  `ui/dialog.tsx` emits), the `@media (max-width: 767px) .app-container` block (CRM class),
  KPI tiles, Mais sheet, search, editor sections.
- `packages/ios-kit/__tests__/css-parity.test.ts` splits `ios-kit.css` at each section header
  line and asserts each section's text occurs verbatim in `apps/crm/style.css`. Editing kit CSS
  on one side only fails CI.
- Only the Admin imports `ios-kit.css`. Deduplicating the CRM side is a follow-up.

## Part B: Admin shell (serial, before any page work)

### Kit follow-up (own commit, after Part A)

`BottomSheet` gains an opt-in `repushIfStillOpen?: boolean` passed through `useSheetHistory` to
`useOverlayHistoryEntry` (which already supports it; the CRM dialog face uses it). Default off,
so the CRM is unchanged. Needed because a sheet whose close can be refused (dirty
limits/features panels refuse via `window.confirm`) otherwise loses its history entry on a
refused Back, and the next Back leaves the page. One kit test covers it.

### `index.html`, tokens and theming

- `apps/admin/index.html` viewport meta becomes
  `width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content`
  (CRM parity). Without `viewport-fit=cover` every `env(safe-area-inset-*)` is 0 on iPhone.
- `apps/admin/src/ios/admin-kit.css` (imported in `main.tsx` after `ios-kit.css`, after
  `globals.css` and `glass.css`) owns all Admin phone/desktop chrome CSS:
  - `:root` defines what the kit reads but the Admin lacks: `--font-main`, `--font-heading`
    (SF Pro Text / Display stacks, same as the CRM) and `--banner-height: 0px`.
  - `.phone-kit` overrides: `--phone-accent: #facc15`, `--phone-on-accent: #12151a`.
  - **Where tokens live on the page:** the phone shell root carries `.phone-kit` (so page
    content, not only portalled sheets, reads the tokens); kit roots carry it themselves.
  - **Glass ON** (`[data-liquid-glass='on'] .phone-kit`): `--phone-bg: transparent`,
    `--phone-cell: rgba(17,21,28,0.55)`, translucent sheet and menu backgrounds. Blur
    (`backdrop-filter: blur(22px) saturate(1.7)` + 1px `rgba(255,255,255,0.08)` border) only on
    **chrome**: tab bar, sheets, menus, sidebar, desktop panels. Phone lists use the translucent
    fill without blur (scroll jank on iPhone). The `LiquidBackdrop` mesh stays.
  - **Glass OFF light** (DashboardClaro / DkDashboardClaro) = the kit's light tokens (`#f2f2f7`
    page, `#fff` cells, `#12151a`/`#4b5563` labels); glass OFF dark = the kit's dark tokens.
  - The tab bar CSS (Admin's own, modelled on the CRM `.mobile-nav-glass`).
  - The global `select` rule in `globals.css` (L72–83, `padding-right … !important` + chevron)
    is scoped to `select:not(.phone-field__select)`.
- **Hex rule:** `__tests__/no-hex-literals.test.ts` forbids hex in listed TSX files. Part B
  converts its `FILES` list to the current list **plus globs** for the new naming convention
  (`components/shell/**/*.tsx`, `pages/**/*Phone.tsx`, `pages/**/*Desktop.tsx`,
  `pages/**/phone/**/*.tsx`), so page agents never edit the test. Colours live in CSS or in
  `lib/` data files (the `plan-colors.ts` precedent): the 11 nav tile colours go in
  `lib/nav-items.ts`, together with the nav groups, labels, icons and routes.

### Shared primitives restyled once

So every desktop page inherits the new look: `PageHeader`, `components/ui/card.tsx` (glass
panel, 18px radius, `.glass-surface`, solid fallback), `table.tsx` (11px uppercase 600 muted
headers, 1px separators, 18px edge padding), `badge.tsx` (6px radius, 11px bold caps),
`button.tsx` (pills: `default` gold, `secondary` fill, `destructive` red tint, 34px),
`tabs.tsx` (iOS segmented look at every width), `dialog.tsx` (glass centred sheet: 22px radius,
header row). **APIs do not change.** Part B updates `ui/__tests__/primitives.test.tsx` class
assertions (badge `text-warning`, `bg-warning/10`, `bg-destructive`) to the new classes while
keeping each variant asserted.

### Desktop shell (`AdminLayout`, ≥768px)

- **Scroll owner is the document.** The sidebar is `position: fixed` at 12px from the top,
  left and bottom (`height: calc(100dvh - 24px)`), 248px wide, 22px radius, with its own
  `overflow-y: auto`; content has `margin-left: 272px`. `LiquidBackdrop` stays viewport-fixed.
- Sidebar (DkSidebar): brand row (logo mark + "Mesaas" + `ADMIN`), groups from
  `lib/nav-items.ts`: no label (Dashboard, Métricas, Workspaces, Afiliados), `PLATAFORMA`
  (Planos, Admins, Integrações), `COMUNICAÇÃO` (Banners, Popups), `CENTRAL DE AJUDA` (Artigos,
  Vídeos). Item: 24px coloured icon tile + label, active row tinted with `aria-current="page"`
  (NavLink, `end` on Dashboard). Footer: email + "Admin da plataforma", Liquid Glass switch
  (`role="switch"`, label "Liquid Glass"), theme button (only when glass is off; keeps today's
  accessible names "Modo claro"/"Modo escuro"), Sair.
- The hamburger, mobile drawer and `pt-16` padding are removed. Content: `padding: 18px 28px
  28px`, inner `max-width: 1100px; margin: 0 auto` (editors 1180px).
- `AdminLayout.test.tsx` assertions on `bg-card` / the old structure are updated to the new
  markup while keeping each behaviour asserted (theme toggle, glass toggle, nav).

### Phone shell (`AdminLayout`, <768px)

- Root `min-height: 100dvh`, `.phone-kit`, 16px gutter, `padding-top: env(safe-area-inset-top)`.
- Bottom **tab bar** (`nav aria-label="Navegação principal"`, glass, safe-area padded):
  Dashboard, Métricas, Workspaces, Afiliados, Mais. A tab is active when its route or a child
  is current (`aria-current="page"`); Mais is active on every other route. Content gets bottom
  padding = bar height + `env(safe-area-inset-bottom)`. The CRM `MobileNav` `visualViewport`
  offset effect (MobileNav.tsx ~L97–120) is copied so Safari's toolbar never hides the bar.
- **Tab bar hidden** on the pushed editors, decided in `AdminLayout` from a route-pattern list:
  `/admin/kb-articles/new`, `/admin/kb-articles/:id/edit`, `/admin/kb-videos/new`,
  `/admin/kb-videos/:id/edit`. Visible everywhere else, detail screens included.
- **Mais** is a `BottomSheet` (not a route) with `GroupedList`s: PLATAFORMA, COMUNICAÇÃO,
  CENTRAL DE AJUDA (tile icons, chevrons), then the account group (email; Liquid Glass switch;
  "Tema escuro" switch only when glass is off), then "Sair" (destructive). Rows navigate and
  close via `useSheetActions().closeThen`.

### Headers

`PageHeader` keeps `title`, `description`, `actions` and gains `phoneActions?: ReactNode`
(round `PhoneIconButton`s), `back?: { to: string; label: string }` and `children` (segmented
control, chips).
- Desktop: 34px SF Pro Display bold title, 15px muted description, `actions` (pills) on the
  right; with `back`, a gold chevron link ("‹ Workspaces") above the title; `children` below.
- Phone root screen: kit `LargeTitleHeader`, `BrandMark` leading, `phoneActions` trailing,
  `description` as subtitle, `children` inside the header.
- Phone with `back`: `AdminNavBar` (`components/shell/AdminNavBar.tsx`: round back button,
  centred small title, trailing `phoneActions`, on the kit's `.phone-nav-bar` classes; back =
  `navigate(-1)` when `history.state.idx > 0`, else `navigate(back.to, { replace: true })`).
  A plain header, never a dialog. The page renders its own hero below it.

### Sheets and forms: `AdminFormSheet`

`components/shell/AdminFormSheet.tsx`, one component for both widths.

- Props: `open`, `onOpenChange(open)`, `title`, `formId`, `submitLabel` (default "Salvar"),
  `submitting`, `canClose?: () => boolean` (refusable close; e.g. the dirty-panel confirm),
  `width?: 'md' | 'lg' | 'xl'` (680 / 820 / 1000px on desktop), `children`.
- **Form ownership:** the page keeps its own single `<form id={formId} onSubmit={…}>` as the
  sheet's child, exactly the element it renders today (PlansPage ~L116, BannersPage ~L338,
  PopupsPage ~L443), minus its old Cancel/Save buttons. The sheet renders **no** `<form>`; its
  header submit is `<button type="submit" form={formId}>`. One submission path, no nesting.
- Header: Cancelar (left, gold text) · title · submit pill (gold). While `submitting`, the
  submit shows a spinner and is disabled, and every dismiss path (Cancelar, Esc, outside click,
  swipe-down, Back) is ignored. Otherwise every dismiss path calls `canClose?.()` first.
- Desktop branch: the Admin `Dialog` (restyled), centred, dimmed page behind (DkPlanoForm,
  DkPopupEditor). Phone branch: kit `BottomSheet`, large detent, `repushIfStillOpen` when
  `canClose` is given.
- Both branches unmount their content when closed, matching today's `{showForm && …}`
  lifecycle, so form reset and upload behaviour is unchanged. An open sheet is a dialog, which
  holds silent updates; never `useBlocker`.
- Moved into `AdminFormSheet`: the inline `showForm` panels of Plans, Banners and Popups, the
  WorkspaceDetail limits/features `Dialog`s (with `canClose` = today's dirty confirm), and
  `SeriesDialog`. Their state and validation code (`plan-form.ts`, `popup-form.ts`,
  `workspace-overrides.ts`, …) stays as is.
- **Phone filters** use the kit `PhoneFiltersSheet`, which applies on tap. Changes made from an
  open sheet call `set(patch, { replace: true })` (`useWorkspacesParams.set` already accepts it),
  so taps do not stack history above the sheet's entry.
- Inside sheets, dnd-kit handles (PopupEditor page thumbs) get `touch-action: none` so the
  sheet's scroll does not steal the drag.

### Page pattern

Each page keeps its default export (router `lazy` imports untouched) and its data hooks, then
branches: `return isPhone ? <XPhone {...data} /> : <XDesktop {...data} />`. Views go in
`pages/<area>/XPhone.tsx` / `XDesktop.tsx` (or a `pages/<area>/phone/` folder), which the hex
test's globs cover. Pure logic files (`*-view.ts`, `*-form.ts`, `*-params.ts`) are reused.
Agents do not edit shared files (`router.tsx`, `main.tsx`, `globals.css`, `admin-kit.css`,
`AdminLayout.tsx`, `PageHeader.tsx`, `components/ui/*`, `components/shell/*`, the hex test,
`packages/ios-kit`); they report needed changes to the orchestrator.

Desktop content patterns:
- **KPI tiles:** auto-fit grid (min 200–220px), glass tile 18px radius, 12px caps label,
  28–30px bold value, 13px muted line; a warning tile has a tinted border + coloured label.
- **Panels:** `Card` with a 17px semibold title row and an optional right control.
- **Segmented controls** replace tab strips and sub-navigation.
- **Detail pages:** back link, 64px avatar hero with badges and pill actions, KPI row, then two
  fluid columns (main ~1.5–2fr, side ~1fr).
- **Selection mode** (Artigos, Vídeos): row checkboxes + a floating glass action bar at the
  bottom centre of the content.

Phone content patterns: `GroupedList`/`Cell` rows with chevrons for drill-down; KPI tiles in a
2-column grid; tables become lists (primary text + subtitle + trailing value); `SegmentedControl`
under the large title; `ChipRow` for active filters; `SwipeRow` for remove (Admins); 
`BottomActionBar` for selection actions; `BarList` for small charts.

## Part C: per-page mapping

| Route | Page | Phone boards | Desktop boards |
|---|---|---|---|
| `/admin/login` | LoginPage | Login | DkLogin |
| `/admin` | DashboardPage (+RiskCard) | Main, DashboardListas, DashboardClaro | DkMain, DkDashboardClaro |
| `/admin/metricas` | MetricasPage + Revenue/Movement/Deposits sections | Metricas, MetricasMovimento, MetricasDepositos | DkMetricas |
| `/admin/workspaces` | WorkspacesPage (+Table, Toolbar, FilterChips, Pagination) | Workspaces, WorkspacesFiltros | DkWorkspaces |
| `/admin/workspaces/:id` | WorkspaceDetailPage (+Events, Invites cards) | WorkspaceDetalhe, WorkspaceDetalhe2, WorkspaceFuncionalidades, WorkspaceLimites | DkWorkspaceDetalhe |
| `/admin/plans` | PlansPage | Planos, PlanoForm | DkPlanos, DkPlanoForm |
| `/admin/afiliados` and `/admin/afiliados/:id` | AffiliatesPage (+CommissionRulesCard), AffiliateDetailPage | Afiliados, Comissoes, AfiliadoDetalhe | DkAfiliados, DkAfiliadoDetalhe |
| `/admin/admins` | AdminsPage | Admins | DkAdmins |
| `/admin/integrations` | IntegrationsPage | Integracoes | DkIntegracoes |
| `/admin/banners` | BannersPage | Banners, BannerForm | DkBanners |
| `/admin/popups` | PopupsPage | Popups, PopupEditor | DkPopupEditor |
| `/admin/kb-articles`, `/admin/kb-articles/new`, `/admin/kb-articles/:id/edit` | KbArticlesPage, KbArticleEditorPage | Artigos, ArtigoEditor | DkArtigos, DkArtigoEditor |
| `/admin/kb-videos`, `/admin/kb-videos/new`, `/admin/kb-videos/:id/edit` | KbVideosPage (+SeriesDialog), KbVideoEditorPage | Videos, VideoEditor | DkVideos |

Kept exactly: every query, mutation, filter, sort, pagination, CSV export, URL param
(`useWorkspacesParams`), dnd-kit ordering (Popups), TipTap editor and extensions, uploads and
confirms. Specific decisions:
- **Workspaces on phones:** the sort control is the list's header button ("Última atividade ↓"),
  opening an `ActionSheet` of the existing sort options; CSV export stays desktop-only.
- **Article editor on phones:** pushed screen (tab bar hidden), `AdminNavBar` with Salvar,
  segmented control Conteúdo · Detalhes · Contexto, formatting toolbar above the keyboard.

## Accessibility

- Real links/buttons for every row (`RowLink`/`RowButton`, kit `Cell` with `to`/`onClick`).
- Segmented controls are `role="tablist"`/`tab` with `aria-selected`; switches `role="switch"`.
- Sheets trap focus and return it on close (kit). Touch targets ≥ 44px on phones.
- Contrast: muted `#9ca3af` on dark glass, `#4b5563` on light cells (≥ 4.5:1); danger copy uses
  the text-safe red.

## Copy

Portuguese throughout. No em-dashes in user-facing copy (period, colon or "·"). Existing strings
stay unless a board changes them.

## Testing and verification

- Existing tests keep passing. When a desktop change alters markup a test queries, the test is
  updated to the new markup and still asserts the same behaviour; never deleted to go green.
  Known touch points: `AdminLayout.test.tsx`, `ui/__tests__/primitives.test.tsx`,
  `LoginPage.test.tsx` (expects two logos by alt), `admin-login-flow.test.tsx`, and each page's
  `pages/__tests__/*` file.
- New tests: `useIsPhone`; kit `repushIfStillOpen`; `css-parity`; shell (sidebar groups +
  active state, tab bar active rules + editor hiding, Mais rows navigate and close, glass/theme
  toggles); `PageHeader` both branches; `AdminFormSheet` both branches (submit via `form=`,
  dismiss blocked while submitting, `canClose` refusal); one phone-branch test per page
  (`mockPhone()`), covering its main list and primary action.
- Gates (CI parity): `npm run lint`, `npm run format:check`, the four `tsc` projects,
  `npm run test`, `npm run coverage:check`, `npm run check:functions`, `npm run test:functions`
  (run `npm ci` afterwards if Deno touched `node_modules`).
- Browser pane at 390px and 1440px (glass dark, solid dark, light) for every route, with the
  seed-login + stubbed-edge-function approach; Playwright WebKit for iOS-only behaviour.

## Rollout

One PR, frontend only, so merging deploys it; nothing to deploy first. Part A is its own commit
with its own gate run, called out in the PR description for separate review.

## Review log

- Fable: deep-import alias (fixed: `@mesaas/ui`-style directory alias + `/*` paths);
  `viewport-fit=cover`; drop F0c, define `--font-main`/`--font-heading`/`--banner-height`,
  carry `.phone-kit` on the phone root; `replace: true` for sheet filters; `repushIfStillOpen`
  for refusable closes; hex-test globs; route-list tab hiding; keep `window.confirm`; tab bar
  CSS owner + `visualViewport`; Workspaces phone sort/CSV; test touch points; `100dvh`;
  `select` rule scope; blur on chrome only; dnd `touch-action`. All accepted.
- Codex: alias (same fix); `AdminFormSheet` form ownership (accepted: page owns the single
  form, header submits via `form=`); boards under `/private/tmp` (accepted: vendored);
  `/admin/afiliados/:id` spelled out (accepted); scroll owner (accepted: document, fixed
  sidebar). `useUnsavedWork` baseline (resolved by removing the requirement: no new unsaved
  tracking in this project, the current protection is unchanged). **Rejected:** "merge Part A
  as a separate PR first". The user asked for one shot; Part A is an isolated commit with its
  own full gate run, bisectable and reviewable alone, and the CRM side is shims plus a file move.
