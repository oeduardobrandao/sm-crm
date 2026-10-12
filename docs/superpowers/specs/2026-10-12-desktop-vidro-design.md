# Desktop "Vidro" (level 3): a glass shell for the CRM, behind a workspace feature flag

Date: 2026-10-12. Status: owner chose level 3 from the mockups; this spec replaces the level 1 spec
(`2026-10-12-desktop-visual-novo-l1-design.md`) and its plan, which are superseded and will not be built.

Mockups: https://claude.ai/artifact/Bt1KGGC2PLjqyH2QmVKGUo. The reference is the board
"Início · Nível 3: vidro" plus the section "Nível 3 (vidro) desenhado em todas as telas" (`V3-*` boards:
Entregas, Clientes, Cliente, Calendário, Tarefas, Leads, Ideias, Financeiro, Contratos, Equipe, Instagram,
Configurações, Mensagens, Arquivos, four in dark mode). The mockups use invented data; the shapes and
the frame are what this spec builds.

## Goal

The phone redesign gave the CRM an iOS idiom below 768px. The owner wants the desktop CRM to take the
bigger step to a macOS-style app frame while keeping the Mesaas identity (yellow `#ffbf30` accent, ink
`#12151a` primary actions, SF Pro):

- no black top bar; the window is a soft coloured backdrop holding two floating surfaces;
- a frosted-glass **sidebar** that carries the brand, the workspace, search, navigation and the account;
- a rounded **content panel** whose first row is a **page toolbar**: the page title and context line on
  the left, the page's own actions on the right, followed by a shell capsule with notifications and
  support chat;
- page content in the iOS idiom: grey KPI tiles, white outlined groups, capsule segmented controls with
  an ink selection, pill buttons.

Success:

1. With the flag off for a workspace, the CRM is pixel-identical to today at every width.
2. With it on, at 1101px and wider, every desktop page renders inside the new frame in light and dark,
   and **every function reachable today is still reachable in at most the same number of clicks**
   (the inventory below is the checklist).
3. Below 1101px nothing changes, flag on or off.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | A new workspace entitlement **`feature_crm_vidro`** (a `plans` column, false on every plan) gates the look. Pilot = an Admin override on a chosen workspace; launch = turn the column on in the plans; kill switch = turn it off. The CRM reads it only as `features?.feature_crm_vidro === true`, never via `hasFeature` (which treats a missing key as on). | The owner asked for a feature flag. This is the repo's established dark-launch pattern (`feature_hub_pauta`, `feature_agenda`): central control, per-workspace pilots, no client release to roll back. |
| D2 | Inside a flagged workspace each person can step back: the account menu gets **"Visual clássico"** (and, when classic, **"Visual novo"**), stored per browser as `localStorage['look'] = 'classic'`. The effective look is `flag && look !== 'classic'`. | A shell rebuild will surface rough edges during the pilot; nobody should be stuck in it. Per browser matches the theme toggle and needs no schema (there is no server-side user preference store). |
| D3 | **No flash on reload.** The resolved look is cached as `localStorage['look-vidro'] = '1'` whenever the app resolves it on, removed when it resolves off. The pre-paint script in `index.html` sets `<html data-look="vidro">` when the cache is `'1'` and `look !== 'classic'`. After `workspace-limits` resolves, the app reconciles the attribute and the cache. The only flash is the first load after the flag changes. | Entitlements arrive after React mounts; the cache makes every later load correct before paint. |
| D4 | Applies at **≥1101px only**: the static-sidebar desktop shell. 768-1100px (drawer) and phone keep today's shell and content styling even with the flag on. All CSS lives in `@media (min-width: 1101px)`; all shell JSX branches on `vidro && desktop` where `desktop` is AppLayout's existing `collapsible` (≥1101). Hub and Admin are untouched. | One clean boundary; the tablet and phone shells were just redesigned and are out of scope. |
| D5 | The page title moves into a **shell-rendered toolbar** that pages fill through a context hook, `usePageToolbar()`. A page that registers hides its in-page header while the toolbar is active; a page that does not register keeps its in-page header and gets a toolbar with only the shell capsule. | CSS cannot move a title out of the scrolling `.main-content` into the shell. A context the page fills, modelled on the phone's `usePhoneChrome`, lets each page migrate independently and keeps unmigrated pages correct. |
| D6 | View switchers stay **in the content** where they are today, restyled as capsules, except four simple ones that move into the toolbar's segmented slot: Tarefas view tabs, Calendário (classic) tabs, Analytics da conta period, Analytics de Fluxos period. | Most switchers carry page state, saved views or tours (Entregas vistas, mode toggle, board tabs). Moving them is a page rewrite; the four above are self-contained JSX. |
| D7 | Content restyling lives in one ordinary stylesheet, `apps/crm/src/styles/vidro.css`, imported after `style.css`; every selector is prefixed `html[data-look='vidro'] .app-container` and sits in the 1101px block. No `@layer`, no `!important`. | Same reasoning as level 1: one sheet reaches `.card` (132 files), `.kpi-*` and the tab classes, and removing the attribute restores today's look. |
| D8 | Overlays (Dialog, Sheet, Popover, dropdowns, cmdk search, toasts, cookie banner, global popups) keep their current look. They portal outside `.app-container`, so the sheet cannot reach them by construction. | Scope control; their z-index contract (`sheet.tsx` 9010/9011) is untouched. |

## The flag

- **Migration** `supabase/migrations/<next>_feature_crm_vidro.sql`:
  `ALTER TABLE plans ADD COLUMN feature_crm_vidro boolean NOT NULL DEFAULT false;` with a header
  comment on the pilot and launch steps. The version prefix must be above main's tail at PR time.
- **Entitlements:** add `'feature_crm_vidro'` to `FEATURE_COLUMNS` in
  `supabase/functions/_shared/entitlements.ts`; Deno test that it resolves false by default and true
  through an override. psql suite `supabase/tests/entitlements/99_crm_vidro_flag.sql` mirroring
  `99_hub_pauta_flag.sql`.
- **Admin:** `apps/admin/src/lib/api.ts` (`Plan` type, `FEATURE_FLAG_KEYS`, `FEATURE_FLAG_LABELS`:
  "Visual vidro (CRM desktop)") and the two Admin test fixtures, so the override is a normal toggle on
  the workspace detail page and a plan checkbox.
- **CRM:** optional `feature_crm_vidro?: boolean` in `FeatureFlags` (`hooks/useWorkspaceLimits.ts`).
- **Merging before the migration is safe:** the key is absent, so the CRM reads it as off.
- **Deploy order (owner-run):** migration on staging, then prod; redeploy `workspace-limits` and
  `platform-admin` (plan writes spread every column, so `platform-admin` must follow the migration), and
  `paywall-report`, `mcp-admin`, `data-import` for consistency; merge; Admin override on the pilot.

## The look module

`apps/crm/src/lib/vidroLook.ts`:

- `LOOK_KEY = 'look'`, `LOOK_CACHE_KEY = 'look-vidro'`.
- `readLookOptOut(): boolean`: `localStorage['look'] === 'classic'` (try/catch, false on error).
- `setLookOptOut(classic: boolean): void`: writes `'classic'` or removes the key.
- `applyVidro(on: boolean): void`: sets or removes `data-look="vidro"` on `<html>` and writes or removes
  the cache (storage in try/catch; the attribute is applied even when storage throws).

`apps/crm/src/hooks/useVidro.ts`: `useVidro(): { enabled: boolean; active: boolean; optedOut: boolean;
setOptedOut(v: boolean): void }`.

- `enabled` = `features?.feature_crm_vidro === true` (from `useWorkspaceLimits`).
- While `features` is still loading, `enabled` falls back to the cache, so the shell does not swap
  mid-load.
- `active` = `enabled && !optedOut`. An effect calls `applyVidro(active)` whenever it changes.
- Consumers that also need the width use AppLayout's `collapsible`. The shell derives
  `vidroShell = active && collapsible` once and provides it through the toolbar context.

Pre-paint (`apps/crm/index.html`, inside the existing theme function after its `#/` early return):
`if (localStorage.getItem('look-vidro') === '1' && localStorage.getItem('look') !== 'classic')
document.documentElement.setAttribute('data-look', 'vidro');`

Analytics: `captureEvent('vidro_look_toggled', { on })` when someone uses the menu item; the event name
joins the `AnalyticsEvent` union.

## The shell (flag on, ≥1101px)

### Frame

- `.app-container` background becomes the backdrop: `#eceef3` plus four soft radial tints (yellow
  `rgba(255,191,48,.30)` top-left, blue `rgba(57,132,255,.18)` top-right, pink `rgba(245,66,200,.12)`
  bottom-right, teal `rgba(106,201,208,.22)` bottom-left). Dark: `#0a0c0f` with stronger tints
  (exact values from the `Inicio-L3` mockup helmet).
- The window has a 10px gutter: the sidebar sits at `left: 10px; top: calc(var(--banner-height) +
  10px); bottom: 10px`; the panel fills the rest with 10px on every side.
- Banners (`GlobalBannerContainer`) stay a full-width fixed stack at the top. Both surfaces are offset
  by `--banner-height`.

### Sidebar

The existing `Sidebar.tsx` and its behaviour stay; vidro adds a header block and restyles the surface.

- **Surface:** `rgba(255,255,255,.55)`, `backdrop-filter: blur(26px) saturate(1.6)`, 1px
  `rgba(255,255,255,.75)` border, radius 20px, soft shadow. Dark: `rgba(17,21,28,.5)`, border
  `rgba(255,255,255,.09)`.
- **Header (new, vidro only):**
  - the Mesaas mark plus the full logo when expanded, as a router `<Link to="/dashboard">` (today's top
    bar logo is a plain anchor that reloads);
  - the active workspace name and the plan name (`useWorkspaceLimits().planName`). The workspace query
    already in `Sidebar.tsx` keeps every row instead of only setting state when there are more than
    one, and the name comes from the row matching the active workspace. The workspace switcher stays
    in the account menu, unchanged.
- **Search (moved from the top bar):** `GlobalSearchTrigger` gets a `variant: 'topbar' | 'sidebar'`
  prop. The sidebar variant is a 30px capsule (`var(--fill)` background, "Buscar" and the ⌘K/Ctrl+K
  hint). It stays mounted in rail mode as an icon-only button, so the ⌘K listener always exists. The
  dialog is unchanged.
- **Nav:**
  - Items keep their data, gating, locked and new-tab behaviour, badges and group collapse.
  - Restyle: 30px rows, radius 10px. The active item is an ink pill (`#12151a`, white text, yellow
    `#ffbf30` icon); in dark it is `rgba(255,255,255,.14)`.
  - Group labels are sentence case, 11px, weight 600.
- **Rail, pin and overlay:**
  - Unchanged in behaviour.
  - The glass applies to the rail, the hover overlay and the pinned sidebar.
  - The rail is 64px including the gutter. Pinned is 260px including the gutter, so `--sidebar-width`
    keeps its values and meaning.
- **Bottom:** the account trigger and its menu are unchanged except for the new look item (D2), placed
  directly under the theme toggle. The menu still holds the workspace switcher, Novidades, Ajuda,
  Idioma, theme and Sair.

### Panel and toolbar

AppLayout renders, when `vidroShell`:

```
<div class="vidro-panel">               // rounded surface, radius 20, shadow, 1px border
  <NavigationProgress />                // moved here from the top bar, absolute at the panel's top
  <PageToolbar />                       // 60px row, not scrolling
  <main class="main-content" id="app">  // the existing scroll container, unchanged id and children
    <ContextHelpLinks /> <Suspense><Outlet/></Suspense>
  </main>
</div>
```

and does not render `TopBar`. Today's `#app` scroll reset, `useAlturaAteOFim` and every `#app`
consumer keep working because `#app` is still the scroller.

- **Panel surface:** `rgba(255,255,255,.94)` (dark `rgba(15,17,21,.86)`), so the backdrop barely shows
  through.
- **Full-bleed pages:** Mensagens and Arquivos keep their own pane surfaces inside the panel.

**`PageToolbar`:**

- **Left:** the registered `leading` (back button, avatar), then the title as the page's `<h1>` (22px,
  700, SF Pro Display), then `titleAccessory` (info tooltip, "Como funciona", tour link), then
  `subtitle` (12px, `--txt3`).
- **Right:** the registered `segmented`, then `actions`, then the **shell capsule**.
- **Shell capsule:** always present on every page.
  - `TopBarActions` with a `variant: 'capsule'`: notification bell with badge and popover, and the
    support chat button with its Crisp listeners and unread dot.
  - The component stays the single owner of the Crisp listeners and the `window.$crisp` type.
  - Restyled: icon buttons 30×28 inside a glass capsule (`rgba(255,255,255,.82)`, 1px
    `rgba(18,21,26,.08)` border, radius 999px). The unread dot's border matches the capsule.
- **Nothing registered:** the left side is empty and the page's own header renders in the content as
  today.

`--topbar-height` is redefined under the vidro block to `70px` (gutter plus toolbar). Its remaining
fixed-position consumer, `.rb-layers-rail` in the report editor, then lands below the toolbar
unchanged. The sidebar and `.main-content` offsets are restyled explicitly and do not rely on it.

Print: `@media print` with vidro shows the panel and toolbar title only. The sidebar, the shell
capsule and the backdrop are hidden, as the sidebar and top bar are today.

### Floating corner

`GuidePill` and `ContextHelpLinks` stay fixed bottom-right. Their right and bottom offsets grow by the
10px gutter so they sit inside the panel's corner; their stacking stays as it is.

## `usePageToolbar`

`apps/crm/src/components/layout/PageToolbarContext.tsx`:

```ts
interface PageToolbarSpec {
  title: ReactNode;          // rendered inside the toolbar's <h1>
  subtitle?: ReactNode;
  leading?: ReactNode;       // back button, avatar
  titleAccessory?: ReactNode;// info tooltip, help/tour links (next to the title)
  segmented?: ReactNode;     // one view switcher (D6)
  actions?: ReactNode;       // page actions, primary last
}
function usePageToolbar(spec: PageToolbarSpec | null): boolean; // true = the toolbar shows this page's header
```

- **Registration:** a `useId`-keyed map written in a layout effect and removed on unmount (the
  `usePhoneChrome` pattern). The most recently mounted registration wins, so a page's skeleton and its
  loaded branch, or a layout and its child route, never leave a stale toolbar.
- **Re-rendering:** the spec is re-read on every render of the registering component, so live subtitles
  (Entregas counts, Tarefas counts) stay current. The hook stores the latest spec in a ref and bumps a
  version when it changes. It does not compare ReactNodes deeply.
- **Return value:** `true` only when `vidroShell` is true. Pages render their in-page header when it is
  false. With the flag off the hook is inert and every page renders exactly as today.
- **Page actions keep their identities.** They are passed as the same JSX elements the header renders
  today, so `FeatureGate` wrappers, `data-tour` anchors (`novo-fluxo-btn`, `nova-automacao`),
  dropdowns, permissions and icon-only/full-only pairs come along. A tour targets whichever copy is
  mounted, and only one is.
- **One `<h1>` per page:** the in-page header is not rendered while the toolbar shows it.

## Page migrations

Every page that renders a page-level header registers with `usePageToolbar`. Columns: title, subtitle,
leading/accessory, actions, segmented. "Header" means its current header JSX, reused, not rewritten.

| Page | Toolbar content |
|---|---|
| Dashboard (Início) | New title "Início"; subtitle today's date ("Segunda-feira, 12 de outubro", `date-fns` pt-BR). No actions. "Saúde dos clientes" stays a content section. |
| Clientes, Leads | Title; UsageMeter as subtitle; info tooltip as accessory; CSV help + Import + primary as actions |
| Financeiro | Title; info accessory; CSV help + Import + Saída + Entrada |
| Contratos, Equipe, Ideias, Automações | Title; info accessory; header actions (Automações keeps its `FeatureGate` + `data-tour`; its hint `p` stays in content) |
| MembroDetalhe | leading Voltar; title = member name; actions Editar |
| Tarefas | Title + counts subtitle; actions Nova tarefa; segmented = view tabs (D6). The scope switch stays in content |
| Calendário (classic) | Title + subtitle; segmented = `.calendar-tabs` |
| Calendário (Agenda) | Title + subtitle; the `.agenda-toolbar` (prev/next, period, Mês/Semana/Dia/Lista) stays in content |
| Entregas | Title + live counts subtitle; accessory = info, "Como funciona", "Ver tour novamente" (same conditions); actions = Templates + Novo dropdown. Vistas, view tabs, mode/entity toggles and board tabs stay in content |
| Analytics | Title; actions = sync status + Sincronizar |
| Analytics da conta | leading = avatar; title = client name; subtitle = handle link + cache note; actions = Voltar, sync, Gerar relatório; segmented = period tabs plus the custom days input. The not-connected branch registers title "Analytics" + Voltar |
| Analytics de Fluxos | Title + subtitle with tooltip; actions Exportar CSV, Imprimir; segmented = period tabs (selects stay in content) |
| Cliente (detalhe) | leading = back + avatar upload; title = client name; subtitle = plan/status badges; actions Editar. The vertical tab nav stays in content |
| Configurações | Title "Configurações". The vertical config nav stays in content |
| Post Express, Importar | Title + subtitle. Importar's step list stays in content |
| Ajuda, Ajuda seção | Title (seção keeps its back link in content) |
| Mensagens | Title "Mensagens" + info accessory; the conversation pane's own `h1` row is not rendered while the toolbar is active, and its search stays |
| Arquivos | Title "Arquivos"; the folder aside's `h1` is not rendered while active; the pane toolbar (breadcrumbs, upload, new folder, filters, sort, grid/list) stays in the pane |

**Not migrated** (they keep their own headers in content under a capsule-only toolbar):
- the report and template editors (sticky header with an input title);
- Ajuda artigo and vídeo;
- the hub sub-pages inside Cliente;
- Configurações sub-tabs (cards with titles).

NotFound is outside the shell.

## Content styling (`vidro.css`)

Prefix `P` = `html[data-look='vidro'] .app-container`; dark `html[data-theme='dark'][data-look='vidro']
.app-container`. Tokens on `P`:

| Token | Light | Dark |
|---|---|---|
| `--vd-panel` | `rgba(255,255,255,.94)` | `rgba(15,17,21,.86)` |
| `--vd-glass` | `rgba(255,255,255,.55)` | `rgba(17,21,28,.5)` |
| `--vd-glass-bd` | `rgba(255,255,255,.75)` | `rgba(255,255,255,.09)` |
| `--vd-cap` | `rgba(255,255,255,.82)` | `rgba(30,36,48,.7)` |
| `--vd-cap-bd` | `rgba(18,21,26,.08)` | `rgba(255,255,255,.08)` |
| `--vd-tile` | `#f4f4f6` | `rgba(255,255,255,.05)` |
| `--vd-group` | `#ffffff` | `rgba(255,255,255,.03)` |
| `--vd-sep` | `rgba(60,60,67,.12)` | `rgba(235,235,245,.09)` |
| `--vd-fill` | `rgba(118,118,128,.12)` | `rgba(118,118,128,.24)` |
| `--vd-sel` / `--vd-sel-fg` | `#12151a` / `#fff` | `rgba(255,255,255,.14)` / `#fff` |
| `--vd-shadow` | `0 20px 50px -20px rgba(18,21,26,.25)` | `0 24px 60px -20px rgba(0,0,0,.7)` |

Rules (shared selectors only, as level 1 established):

1. **Panel canvas:** `.main-content` background transparent (the panel paints); full-bleed pages keep
   their surfaces.
2. **Cards:** `.card:not(.card-blue):not(.card-yellow):not(.card-teal):not(.card-dark)`: background
   `--vd-group`, 1px `--vd-sep` border, no shadow, radius 16px. Nested `.card .card`: background
   `--vd-fill`, no border.
3. **KPIs:** `.kpi-grid` gap 12px, transparent, no border or shadow, `overflow: visible`.
   `.kpi-card` background `--vd-tile`, no border, radius 16px. Restated so they survive: filler
   transparent, `[data-active='true']` inset ring, `button.kpi-card--clickable:hover`.
4. **Segmented controls:**
   - `.page-tabs`, `.calendar-tabs`, `.board-tabs`, `.agenda-segmented` and `[data-slot='tabs-list']`:
     a capsule track (`--vd-fill`, radius 999px, padding 2px, no underline border). Each segment is
     radius 999px, 13px, sentence case.
   - The active segment is the ink selection (`--vd-sel` / `--vd-sel-fg`). The `::after` underlines
     are hidden.
   - `.board-tab-add` keeps its look.
   - shadcn `TabsList`/`TabsTrigger` and `Button` get `data-slot` attributes (no base CSS reads them).
5. **Buttons:** `[data-slot='button']`, `.btn-primary`, `.btn-secondary`, `.btn-danger`,
   `.btn-danger-outline`, `.btn-icon`, `.btn-icon--danger`, `.btn-upgrade`: radius 999px.
6. **Tables inside cards:** no change to rows and cells; the container is the group.
7. **Accessibility fallbacks:**
   - `@media (prefers-reduced-transparency: reduce)` and `@supports not (backdrop-filter: blur(1px))`:
     the glass surfaces become opaque (`#f7f7f9` light, `#12151a` dark).
   - `@media (prefers-reduced-motion: reduce)` keeps the existing sidebar rule (no transitions).

## Functionality inventory (nothing may be lost)

| Today | Vidro home |
|---|---|
| Top bar logo (link to /dashboard) | Sidebar header logo (SPA link) |
| Search trigger + ⌘K/Ctrl+K | Sidebar search capsule (icon in rail), listener always mounted |
| Notification bell, badge, popover | Toolbar shell capsule |
| Support chat button, unread dot, Crisp listeners | Toolbar shell capsule |
| NavigationProgress | Top edge of the panel |
| Sidebar nav, gating, locked, badges, groups, pin/rail/overlay | Same, restyled |
| Account menu (switcher, Novidades, Ajuda, Idioma, theme, Sair) | Same, plus the look item |
| Banners (dunning, incident, global) | Same fixed stack, surfaces offset |
| GuidePill, ContextHelpLinks | Same corner, inside the panel |
| Page titles, info tooltips, actions, tours | Toolbar (migrated pages) or in-page (others) |
| View switchers | In content, restyled (four move into the toolbar, D6) |
| Workspace name and plan | **New** in the sidebar header (not shown on desktop today) |

## Testing

**Unit (Vitest):**
- `vidroLook`: opt-out read and write, the attribute and cache written together, and both still
  applied when storage throws.
- `useVidro`:
  - flag absent means off; flag true means on;
  - opt-out turns it off;
  - while features load, the cached value is used.
- `PageToolbarContext`:
  - registration and unregistration;
  - the latest mount wins;
  - re-renders update the subtitle;
  - inert (returns false) without `vidroShell`.
- **AppLayout:** extended tests.
  - Flag on at ≥1101: no `topbar`, the panel and toolbar render, the capsule has the bell and chat.
  - Flag on at tablet or phone: today's shell.
  - Flag off: today's shell.
- **Sidebar:**
  - the vidro header shows the workspace and plan;
  - the search capsule opens the dialog;
  - ⌘K works with the sidebar variant;
  - the look item writes the opt-out and fires the event.
- **Each migrated page:**
  - with the toolbar active, the title renders once, as an `<h1>` in the toolbar;
  - each action renders once, and the `data-tour` anchors exist;
  - with it inactive, the existing tests pass unchanged.
- **Contract test on `vidro.css`** (postcss, like `mobileResponsiveFinalContracts.test.ts`):
  - every rule is inside `min-width: 1101px`;
  - no `@layer` and no `!important`;
  - every selector starts with `html` carrying `[data-look='vidro']`.

**Deno and psql:** the entitlement test and `99_crm_vidro_flag.sql`.

**Browser sweep** (seed login, `workspace-limits` stubbed with `feature_crm_vidro: true`):
- At 1440px, light and dark: every migrated page.
- Overlays: one Sheet, one Dialog, the search dialog and the notification popover.
- At 1100px and 800px: today's shell.
- With the flag off: Início, Entregas and Clientes computed-style diffed against `main`, unchanged.
- Screenshots go to the owner.

**Gates:** lint, format, the four `tsc` projects, `npm run test`, `npm run check:functions`,
`npm run test:functions`.

## Risks

- **Toolbar registration races** (two registrations during a route change): the latest-mount rule and
  cleanup on unmount, covered by tests.
- **Specificity:** a page rule more specific than `P` keeps its old surface. The sweep finds these; fixes
  go in `vidro.css` only.
- **Glass performance:** `backdrop-filter` is applied to only three elements (sidebar, toolbar capsule,
  search capsule). Content cards stay opaque.
- **Contrast on glass:** sidebar text uses `--txt` on a ≥55% white surface over a light backdrop, which
  measures above 7:1. Dark text tokens are `#e8eaf0` and `#a1a8b5` on `#0a0c0f`-based glass. The sweep
  checks the group labels.
- **Two shells until launch:** launch flips the plans; a later PR folds the sheet into base CSS and
  deletes the classic branches.

## Out of scope

- The tablet drawer and phone shells.
- Overlays.
- Moving the remaining view switchers into the toolbar.
- Restyling the report editors and Hub pages.
- Mockup-only content reshapes (Início's "Hoje"/"Minha fila" as list rows, Clientes' inspector, the
  Configurações System Settings layout). Those are page rewrites that can follow once the frame ships.
