# Desktop "Vidro" (level 3): a glass shell for the CRM, behind a workspace feature flag

Date: 2026-10-12.

Status: the owner chose level 3 from the mockups. This version folds in a Fable review and a Codex review.

This spec replaces the level 1 spec (`2026-10-12-desktop-visual-novo-l1-design.md`) and its plan. Both
are marked superseded and will not be built.

Mockups: https://claude.ai/artifact/Bt1KGGC2PLjqyH2QmVKGUo.
- The reference is the board "Início · Nível 3: vidro" plus the section "Nível 3 (vidro) desenhado em
  todas as telas".
- That section holds the `V3-*` boards: Entregas, Clientes, Cliente, Calendário, Tarefas, Leads, Ideias,
  Financeiro, Contratos, Equipe, Instagram, Configurações, Mensagens and Arquivos, four of them in dark
  mode.
- The mockups use invented data. This spec builds their frame and shapes, not their content.

## Goal

The phone redesign gave the CRM an iOS idiom below 768px. The owner wants the desktop CRM to take the
bigger step to a macOS-style app frame while keeping the Mesaas identity: the yellow `#ffbf30` accent,
ink `#12151a` primary actions and SF Pro.

- **No black top bar.** The window is a soft coloured backdrop holding two floating surfaces.
- **A frosted-glass sidebar** that carries the brand, the workspace, search, navigation and the account.
- **A rounded content panel** whose first row is a **page toolbar**:
  - the page title and context line on the left;
  - on the right, in mockup order: the view switcher, the page's secondary actions, a shell capsule
    with notifications and support chat, and the primary action last.
- **Page content in the iOS idiom:** grey KPI tiles, white outlined groups, capsule segmented controls
  with an ink selection, and pill buttons.

Success:

1. With the flag off for a workspace, the CRM is pixel-identical to today at every width.
2. With it on, at 1101px and wider:
   - every desktop page renders inside the new frame, in light and dark;
   - every function reachable today is still reachable in at most the same number of clicks. The
     inventory below is the checklist.
3. Below 1101px nothing changes, flag on or off.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | A new workspace entitlement, **`feature_crm_vidro`**, gates the look. It is a `plans` column, false on every plan.<br>- Pilot: an Admin override on a chosen workspace.<br>- Launch: turn the column on in the plans.<br>- Kill switch: turn it off.<br>The CRM reads it only as `features?.feature_crm_vidro === true`, never through `hasFeature`, which treats a missing key as on (`useEntitlements.ts:16`). | The owner asked for a feature flag. This is the repo's established dark-launch pattern (`feature_hub_pauta`, `feature_agenda`). |
| D2 | Inside a flagged workspace each person can step back. The account menu gets **"Visual clássico"** (and, while classic, **"Visual novo"**).<br>The choice is stored per browser and per user as `localStorage['look-optout:<userId>'] = '1'`.<br>The effective look is `flag && !optOut`.<br>The item only renders when the flag is on and the desktop shell is showing; the drawer sidebar at 900-1100px does not offer it. | The pilot will surface rough edges, and nobody should be stuck in the new look. There is no server-side user preference store, and scoping the key to the user stops one account's choice leaking into another's on a shared browser. |
| D3 | **Pre-paint cache.** `localStorage['look-vidro'] = '1'` is written only after a *successful* `workspace-limits` response resolves the look on, and removed when one resolves it off.<br>The pre-paint script sets `<html data-look="vidro">` when the cache is `'1'`.<br>The cache is cleared:<br>- on sign-in success;<br>- in `signOut`;<br>- immediately before the workspace-switch reload.<br>A failed `workspace-limits` request keeps whatever state is current and touches neither cache nor attribute. | Entitlements arrive after React mounts. With the cache, every reload of the same account and workspace is correct before paint.<br>Clearing it at each identity change means another account or another workspace starts classic. The cost is a single classic-to-vidro flash on the first load after sign-in, after a switch, or after a flag change. |
| D4 | Vidro applies at **≥1101px only**, the static-sidebar desktop shell.<br>- 768-1100px (drawer) and phone keep today's shell and content styling even with the flag on.<br>- All CSS lives in `@media (min-width: 1101px)`. The one exception is the scoped print block (see Print).<br>- The shell branches on one value, `vidroShell = vidroActive && desktopShell`, computed only in `AppLayout`. There `desktopShell` is today's private `!isTablet && !isMobile` (AppLayout.tsx:172).<br>- `AppLayout` publishes `vidroShell` through the toolbar context and passes it to `Sidebar` as a prop. Nothing else computes the breakpoint.<br>- Hub and Admin are untouched. | One clean boundary from one source, so nothing can drift at 1101px. |
| D5 | The page title moves into a **shell-rendered toolbar** that pages fill through `usePageToolbar()`.<br>- A page that registers hides its in-page header while the toolbar shows it.<br>- A page that does not register keeps its in-page header under a toolbar that holds only the shell capsule. | CSS cannot move a title out of the scrolling `.main-content` into the shell. Pages migrate independently, and unmigrated pages stay correct. |
| D6 | **View switchers.** These move into the toolbar's `segmented` slot, as in the mockups:<br>- Entregas view tabs (Kanban, Visão geral, Calendário, Lista, Minha fila, Concluídas);<br>- the Tarefas scope switch (minhas/todas);<br>- Calendário (classic) `.calendar-tabs`;<br>- the Analytics de Fluxos period tabs.<br>These stay in the content, restyled as capsules: Entregas vistas, mode toggle, entity toggle and board tabs, the Tarefas view tabs, the Agenda toolbar, the Analytics da conta period tabs and custom days input, and the Cliente vertical section nav. | The four that move are self-contained JSX that calls a setter or holds local state. Those that stay carry saved state, belong to a grid component (`AgendaView.tsx:219`), would overflow the toolbar (Analytics da conta), or have too many items for a toolbar (Cliente has 11 sections).<br>Calendário (Agenda) and Cliente will therefore not match their mockup boards; that is accepted for this phase. |
| D7 | Content restyling lives in one ordinary stylesheet, `apps/crm/src/styles/vidro.css`. It is imported only from `apps/crm/src/main.tsx`, after `style.css`; the Hub imports `style.css` directly and must never see it.<br>Every selector is prefixed `html[data-look='vidro'] .app-container`. No `@layer`, no `!important`. | One sheet reaches `.card` (132 files), `.kpi-*` and the tab classes. Removing the attribute restores today's look. |
| D8 | These keep their current look: Dialog, Sheet, Popover, dropdowns, the cmdk search, toasts, the cookie banner and global popups. They portal outside `.app-container`.<br>The non-portalled `.user-menu-popover` (Sidebar.tsx:357) gets an opaque surface so it does not sit on glass. | Scope control. The z-index contract (`sheet.tsx` 9010/9011) is untouched. |

## The flag

- **Migration** `supabase/migrations/<next>_feature_crm_vidro.sql` runs
  `ALTER TABLE plans ADD COLUMN feature_crm_vidro boolean NOT NULL DEFAULT false;`. Its header comment
  covers the pilot and launch steps. The version prefix must be above main's tail at PR time.
- **Entitlements:**
  - Add `'feature_crm_vidro'` to `FEATURE_COLUMNS` in `supabase/functions/_shared/entitlements.ts`.
    `mergeEntitlements` already resolves a missing column to `false` (`:43`).
  - Deno test: false by default, true through an override.
  - psql suite `supabase/tests/entitlements/99_crm_vidro_flag.sql`, mirroring `99_hub_pauta_flag.sql`.
- **Admin:**
  - In `apps/admin/src/lib/api.ts`: the `Plan` type, `FEATURE_FLAG_KEYS`, and `FEATURE_FLAG_LABELS`
    with the label "Visual vidro (CRM desktop)".
  - Update `apps/admin/src/lib/__tests__/featureFlags.test.ts` and
    `apps/admin/src/pages/__tests__/plan-form.test.ts`.
- **CRM:** add an optional `feature_crm_vidro?: boolean` to `FeatureFlags` in `hooks/useWorkspaceLimits.ts`.
- **Merging before the migration is safe.** The key is absent, so the CRM reads it as off.
- **Deploy order (owner-run):**
  1. Migration on staging, then prod.
  2. Redeploy `workspace-limits` and `platform-admin`. Plan writes spread every column, so
     `platform-admin` must follow the migration. Also redeploy `paywall-report`, `mcp-admin` and
     `data-import` for consistency.
  3. Merge.
  4. Admin override on the pilot workspace.

## The look module and hook

`apps/crm/src/lib/vidroLook.ts` (storage in try/catch everywhere):

- `LOOK_CACHE_KEY = 'look-vidro'`; `optOutKey(userId) = 'look-optout:' + userId`.
- `readOptOut(userId): boolean` and `writeOptOut(userId, classic: boolean): void`.
- `applyVidro(on: boolean): void`:
  - sets or removes `data-look="vidro"` on `<html>`;
  - writes or removes the cache;
  - applies the attribute even when storage throws.
- `clearVidroCache(): void` removes the cache. It does not touch the attribute: the reload or redirect
  that follows takes care of that.

`apps/crm/src/hooks/useVidro.ts`, called **only in `AppLayout`**:

```ts
useVidro(): { enabled: boolean; active: boolean; optedOut: boolean; setOptedOut(v: boolean): void }
```

- **`enabled`:**
  - after a successful response: `features?.feature_crm_vidro === true`;
  - while `useWorkspaceLimits` is loading, or after it errors: the attribute currently on `<html>`, which
    the pre-paint script set from the cache.
- **`active`** = `enabled && !optedOut`.
- An effect calls `applyVidro(active)` only after a successful response or an opt-out change, never on
  error or while loading.
- **`setOptedOut`** writes the opt-out key, updates state and fires
  `captureEvent('vidro_look_toggled', { on: !v })`. Add the event name to the `AnalyticsEvent` union.

**Pre-paint**, in `apps/crm/index.html`, inside the existing theme function, wrapped in try/catch:
`if (localStorage.getItem('look-vidro') === '1') document.documentElement.setAttribute('data-look',
'vidro');`. The function's `#/` early return is dead under path routing, so this also runs on `/login`.
That is harmless: every vidro selector is under `.app-container`.

**Cache clearing** calls `clearVidroCache()` in three places:
- `AuthContext`'s sign-in success path;
- `signOut` (AuthContext.tsx:1017);
- `Sidebar.tsx`'s `handleSwitchWorkspace`, before `window.location.reload()` (Sidebar.tsx:163).

## The shell (flag on, ≥1101px)

### Frame

- **Backdrop.** `.app-container` background becomes the backdrop.
  - Light: base `#eceef3` with `radial-gradient(42rem 42rem at 6% 8%, rgba(255,191,48,.30), transparent 60%)`,
    `radial-gradient(40rem 40rem at 92% 12%, rgba(57,132,255,.18), transparent 60%)`,
    `radial-gradient(40rem 40rem at 80% 96%, rgba(245,66,200,.12), transparent 60%)` and
    `radial-gradient(36rem 36rem at 12% 92%, rgba(106,201,208,.22), transparent 62%)`.
  - Dark: base `#0a0c0f` with the same geometry and the tints `rgba(234,179,8,.32)`,
    `rgba(57,132,255,.3)`, `rgba(245,66,200,.24)` and `rgba(106,201,208,.24)`.
- **Gutter.** The window has a 10px gutter.
  - The sidebar box sits at `left: 10px; top: calc(var(--banner-height) + 10px); bottom: 10px`.
  - `--sidebar-width` keeps its values and meaning as the sidebar **box** width: 64px rail, 260px pinned.
  - The panel sits at `left: calc(10px + var(--sidebar-width) + 10px)`, with 10px top (plus banner),
    right and bottom.
- **Banners.** `GlobalBannerContainer` stays a full-width fixed stack at the top, and both surfaces are
  offset by `--banner-height`.

### Sidebar

The existing `Sidebar.tsx` and its behaviour stay. Vidro adds a header block and restyles the surface.

- **Surface.**
  - Light: `rgba(255,255,255,.55)`, `backdrop-filter: blur(26px) saturate(1.6)`, a 1px
    `rgba(255,255,255,.75)` border, radius 20px, and the `--vd-shadow` shadow.
  - Dark: `rgba(17,21,28,.5)` with a `rgba(255,255,255,.09)` border.
  - `backdrop-filter` makes the sidebar a containing block for fixed descendants. None exist today, so
    keep it that way.
- **Header (new, vidro only).**
  - Expanded: a router `<Link to="/dashboard">` with the logo (`/logo-black.svg` in light,
    `/logo-white.svg` in dark), then the active workspace name and plan name.
    - The plan name is `useWorkspaceLimits().planName`.
    - The workspace query already in `Sidebar.tsx` (:126-135) keeps every row instead of setting state
      only when there are more than one. The name comes from the row whose `workspace_id` matches the
      active workspace.
    - The switcher in the account menu keeps its `workspaces.length > 1` gate (Sidebar.tsx:360), so
      single-workspace rendering is unchanged.
  - Rail: only the Mesaas mark, centred.
  - The pin button row (Sidebar.tsx:297-310) stays where it is, directly under the header.
- **Search (moved from the top bar).**
  - `GlobalSearchTrigger` gets a `variant?: 'topbar' | 'sidebar'` prop (default `'topbar'`, so today's
    markup is unchanged).
  - The sidebar variant uses its own class, `.search-trigger--sidebar`, so the base
    `.search-trigger { min-width: 380px }` (style.css:754) does not apply. It is a 30px capsule with a
    `--vd-fill` background, "Buscar" and the ⌘K/Ctrl+K hint.
  - In rail mode it is a 36px icon button with its own rule. Rail labels fade by opacity, which would
    leave an empty capsule.
  - It is mounted whenever the vidro sidebar is, so the ⌘K listener always exists.
  - Exactly one `GlobalSearchTrigger` mounts at a time: `TopBar` does not render while `vidroShell` is
    on, and below 1101px the sidebar variant does not render.
- **Nav.**
  - Items keep their data, gating, locked and new-tab behaviour, badges and group collapse.
  - Rows are 30px tall with radius 10px.
  - The active item is an ink pill: `--vd-sel` with `--vd-sel-fg` text and a yellow `#ffbf30` icon.
  - Group labels are sentence case, 11px, weight 600.
- **Rail, pin and overlay.**
  - Behaviour is unchanged.
  - The glass applies to the rail, the hover overlay and the pinned sidebar.
  - Box widths stay at 64 and 260, so the rail-tuned rules keep working: badge `left: 30px`, avatar
    centring, and overlay `width: 260px` (style.css:10332, 10378-10388, 10439-10443).
- **Bottom.**
  - The account trigger and menu are unchanged, plus the look item (D2) directly under the theme toggle.
  - The menu still holds the workspace switcher, Novidades, Ajuda, Idioma, theme and Sair.
  - `.user-menu-popover` gets the opaque surface (D8).

### Panel and toolbar

When `vidroShell` is on, AppLayout renders the tree below and does not render `TopBar`:

```
<div class="vidro-panel">               // position: relative; overflow: hidden; radius 20; 1px border; shadow
  <NavigationProgress />                // moved from the top bar; absolute at the panel's top edge, clipped by the radius
  <PageToolbar />                       // not scrolling
  <main class="main-content" id="app">  // still the scroll container, same id and children
    <ContextHelpLinks /> <Suspense><Outlet/></Suspense>
  </main>
</div>
```

- `#app` is still the scroller, so the scroll reset (AppLayout.tsx:193-196), `useAlturaAteOFim` and
  `useConfigSubScreen` keep working.
- **No `filter`, `transform` or `backdrop-filter` on `.vidro-panel` or `.main-content`.** Any of them
  would trap the fixed `.context-help` and `.rb-layers-rail`.
- **Panel surface:**
  - `rgba(255,255,255,.94)` in light, `rgba(15,17,21,.86)` in dark;
  - `.main-content` itself is transparent, without its base margins, height calc or radius;
  - the sheet overrides `.main-content:has(> .page-full-bleed)` explicitly (its margin and radius, base
    style.css:974-978). Mensagens and Arquivos keep their own pane surfaces.

**`PageToolbar`** is a flex row with `min-height: 60px` and `flex-wrap: wrap`.

- **Left cluster** (`flex: 1 1 auto; min-width: 0`), in this order:
  1. `leading`
  2. the title, inside the toolbar's `<h1>` (22px, 700, SF Pro Display)
  3. `titleAccessory`
  4. `subtitle` (12px, `--vd-txt3`), which truncates with an ellipsis.
- **Right cluster** (`flex: 0 0 auto`), in this order:
  1. `segmented`
  2. `actions` (secondary)
  3. the **shell capsule**
  4. `primary`

  When the right cluster cannot fit beside the title, it wraps onto a second line and the toolbar grows.
  Nothing is hidden or moved into a menu, so every action stays one click away.
- **Toolbar buttons:**
  - zero the `mb-2` that `buttonVariants` carries (button.tsx:7);
  - the icon-only and full-only pairs (`.header-actions-icon-only` / `-full-only`) only switch at
    ≤900px, so at ≥1101px the full buttons show.
- **Shell capsule:** always present on every page. It renders `TopBarActions` with
  `variant: 'capsule'`.
  - It holds the notification bell (badge and popover) and the support chat button (unread dot).
  - The capsule variant uses its own classes, `.vidro-capsule` and `.vidro-capsule-btn` (34px buttons,
    so the bell's inline badge position at `top: 4px; right: 4px` stays right). Today's
    `.topbar-action-btn` colours are white-on-dark.
  - The unread dot's border matches the capsule.
  - This is an adaptation of the mockup's icon capsule, which shows page icons. The bell and chat need a
    home on every page.
- **Nothing registered:** the left cluster is empty and the page's own header renders in the content
  as today.

**Support chat state has one owner.**
- Today `TopBarActions` registers three `$crisp.on` listeners with no cleanup and keeps the unread flag
  in local state (TopBarActions.tsx:24-34). Vidro adds remount paths: a shell swap and crossing 1101px.
- The registration and the unread flag therefore move to `apps/crm/src/lib/supportChatUnread.ts`:
  - a module-level, once-guarded `ensureCrispListeners()`;
  - a tiny external store read with `useSyncExternalStore`;
  - the `window.$crisp` type declaration.
- AppLayout calls `ensureCrispListeners()` beside its existing `chat:hide` effect (AppLayout.tsx:198-200).
- `TopBarActions` (both variants) only reads the store and calls `openSupportChat()`.
- The flag-off markup is identical.

**`--topbar-height`** is redefined to `70px` (the gutter plus the toolbar) inside the vidro 1101px block,
on `P` (never on a bare `.app-container` selector; see `mobileResponsiveFinalContracts.test.ts:70-85`).
Its fixed-position consumer `.rb-layers-rail` (style.css:14664-14674) also gets a vidro rule:
`top: calc(var(--banner-height) + 10px + 60px + 16px)` and `right: 26px`, so it sits inside the panel.
The sidebar and panel geometry above does not rely on `--topbar-height`.

### Print

The only print rules today (style.css:15046-15081) are scoped to
`body:has(.analytics-fluxos-page)`. They hide the page's action row and toolbar row and zero the
`.main-content` margin. Under vidro the Analytics de Fluxos actions and period tabs live in the shell
toolbar, so `vidro.css` adds one block:

```
@media print { html[data-look='vidro'] body:has(.analytics-fluxos-page) … }
```

It hides `.sidebar`, the toolbar's segmented, actions and primary clusters, and the shell capsule. It
also resets `.vidro-panel` (no position offsets, radius, shadow or border; white background) and
removes the backdrop. The toolbar title stays and prints as the page heading.

No other page gains or loses print rules: they print the frame as they print today's chrome.

### Floating corner

`GuidePill` and `ContextHelpLinks` stay fixed bottom-right. Their right and bottom offsets grow by the
10px gutter so they sit inside the panel's corner, and their stacking is unchanged.

## `usePageToolbar`

`apps/crm/src/components/layout/PageToolbarContext.tsx`:

```ts
interface PageToolbarSpec {
  title: ReactNode;           // rendered inside the toolbar's <h1>
  subtitle?: ReactNode;
  leading?: ReactNode;        // back button, avatar
  titleAccessory?: ReactNode; // info tooltip, help/tour links next to the title
  segmented?: ReactNode;      // one view switcher (D6)
  actions?: ReactNode;        // secondary actions
  primary?: ReactNode;        // the primary action, rendered last
}
function usePageToolbar(spec: PageToolbarSpec | null): boolean; // true = the toolbar shows this page's header
```

**Store, not state.**
- The context value is a stable, memoised store:
  `{ vidroShell, register(id), unregister(id), set(id, spec), subscribe, getSnapshot }`.
- A page writes its spec with `set(id, spec)` in a **deps-less `useLayoutEffect`**, so the latest JSX
  lands every commit.
- Only `PageToolbar` subscribes, via `useSyncExternalStore`. AppLayout never re-renders because a page
  registered or updated, so there is no render loop.
- The hook registers in a mount `useLayoutEffect` and unregisters in its cleanup.

**Which registration shows.**
- Registrations live in a `Map` in insertion order, and the **last inserted live registration** is
  shown.
- `set` on an existing id keeps its position, so a re-rendering layout never steals the slot from a
  child that mounted after it.
- In development, two live registrations log a warning.

**Call rules.**
- The hook is called **above every early return**, passing `null` while the page has nothing to show.
  This matters for Entregas (EntregasPage.tsx:1311), Tarefas (TarefasPage.tsx:131), Cliente
  (ClienteDetalhePage.tsx:65/146/150) and Analytics da conta (AnalyticsContaPage.tsx:1534).
- A `null` spec keeps the registration and renders an empty left cluster.
- The return value is `vidroShell` (false whenever vidro is off or the width is below 1101px). Pages
  render their in-page header when it is false.

**Nested routes.** Children of a registering layout must not register.
- Every `/clientes/:id/*` child renders under the Cliente toolbar (client name, badges, Editar).
- The hub sub-pages (`hub/AcessoPage`, `BriefingPage`, `MarcaPage`, `PaginasPage`, `IdeiasPage`)
  render their title element as `h2` instead of `h1` when the hook's context reports `vidroShell`,
  keeping one `<h1>` per page.
- Configurações sub-tabs render under the Configurações toolbar. Their cards already use `h3`.

**Actions keep their identity.**
- Toolbar slots receive the same JSX elements the in-page header renders today. `FeatureGate`
  wrappers, `data-tour` anchors (`novo-fluxo-btn`, `nova-automacao`), dropdowns, permission checks and
  icon-only/full-only pairs come along.
- Only one copy is ever mounted, so a tour finds exactly one anchor.
- **Provider rule:** these elements render inside `PageToolbar`, under AppLayout. They may depend only
  on app-wide providers (QueryClient, Router, Auth, i18n, Guide), never on page-local context or
  `useOutletContext`. Page data reaches them through closures.
- Today's header JSX already meets this: tooltips are CSS `data-tooltip`, and `FeatureGate` uses
  app-wide hooks.

**Skeletons.** `PageSkeleton` keeps its `.header` silhouette in the content while a lazy page loads.
This is accepted: the toolbar shows only the capsule until the page registers.

## Page migrations

Every page with a page-level header registers. "Header" means its current header JSX, reused rather
than rewritten.

| Page | Toolbar content |
|---|---|
| Dashboard (Início) | New title "Início". Subtitle: today's date (`date-fns`, pt-BR, e.g. "Segunda-feira, 12 de outubro"). No actions. `ClientHealthMonitor`'s `<h1>` becomes `<h2>` (`.header-title h1, .header-title h2` share one rule, style.css:1005-1012, so flag-off is pixel-identical) |
| Clientes, Leads | Title. Subtitle: the UsageMeter. Accessory: info tooltip. Actions: CSV help and Import. Primary: Novo |
| Financeiro | Title. Accessory: info. Actions: CSV help, Import and Saída. Primary: Entrada |
| Contratos, Equipe, Ideias, Automações | Title. Accessory: info. Actions: CSV help/Import where present. Primary: the create button. Automações keeps its `FeatureGate` and `data-tour`; its hint `p` stays in content |
| MembroDetalhe | Leading: Voltar. Title: the member name (the content `h2` stays). Primary: Editar |
| Tarefas | Title and counts subtitle. Segmented: the minhas/todas scope switch. Primary: Nova tarefa. The view tabs stay in content |
| Calendário (classic) | Title and subtitle. Segmented: `.calendar-tabs` |
| Calendário (Agenda) | Title and subtitle. The `.agenda-toolbar` stays in content (D6) |
| Entregas | Title and live counts subtitle. Accessory: info, "Como funciona" and "Ver tour novamente" (same conditions as today). Segmented: view tabs. Actions: Templates. Primary: the Novo dropdown with `data-tour`. Vistas, mode and entity toggles and board tabs stay in content |
| Analytics | Title. Actions: sync status. Primary: Sincronizar |
| Analytics da conta | Leading: avatar. Title: client name. Subtitle: handle link and cache note (truncating). Actions: Voltar and sync. Primary: Gerar relatório. The period tabs and days input stay in content. The not-connected branch registers title "Analytics" and Voltar |
| Analytics de Fluxos | Title, plus a subtitle with its tooltip. Segmented: period tabs. Actions: Exportar CSV and Imprimir. The selects stay in content. Print block above |
| Cliente (detalhe) | Leading: back and avatar upload. Title: client name. Subtitle: plan and status badges. Primary: Editar. The vertical section nav stays in content (D6) |
| Configurações | Title "Configurações". The vertical config nav stays in content |
| Post Express, Importar | Title and subtitle. Importar's step list stays in content |
| Ajuda, Ajuda seção | Title. Seção keeps its back link in content |
| Mensagens | Title "Mensagens" and the info accessory. While the toolbar is active, the conversation pane does not render its own `h1` row; its search and sort stay |
| Arquivos | Title "Arquivos". While the toolbar is active, the folder aside does not render its `h1`. The pane toolbar (breadcrumbs, upload, new folder, filters, sort, grid/list) stays in the pane |

**Not migrated:** the report and template editors (a sticky header with an input title), Ajuda artigo
and vídeo. They keep their own headers in content under a capsule-only toolbar. NotFound renders
outside the shell.

**Inline-styled switchers.** Under `vidroShell`, the Entregas view tabs (EntregasPage.tsx:1619-1660)
and the Tarefas scope switch and view tabs (TarefasPage.tsx:274-330) render with classes
(`.vidro-seg` / `.vidro-seg-btn`, `aria-pressed` or `role="tab"` as today) instead of their inline
styles, because inline styles beat the sheet. With the flag off they render exactly as today.

## Content styling (`vidro.css`)

Prefix `P` = `html[data-look='vidro'] .app-container`; in dark,
`html[data-theme='dark'][data-look='vidro'] .app-container`. Tokens are declared on `P`:

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
| `--vd-txt3` | `#6b7280` | `#8b93a1` |
| `--vd-shadow` | `0 20px 50px -20px rgba(18,21,26,.25)` | `0 24px 60px -20px rgba(0,0,0,.7)` |
| `--vd-solid` (fallback) | `#f7f7f9` | `#12151a` |

Rules (shared selectors only):

1. **Cards.** `.card:not(.card-blue):not(.card-yellow):not(.card-teal):not(.card-dark)` gets:
   - background `--vd-group`, a 1px `--vd-sep` border, no shadow, radius 16px;
   - nested `.card .card`: background `--vd-fill`, no border.
2. **KPIs.**
   - `.kpi-grid`: gap 12px, transparent, no border or shadow, `overflow: visible`.
   - `.kpi-card`: background `--vd-tile`, no border, radius 16px.
   - Restated so they survive: the filler stays transparent, `[data-active='true']` keeps its inset
     ring, and `button.kpi-card--clickable:hover` keeps its hover.
3. **Segmented controls.**
   - `.page-tabs`, `.calendar-tabs`, `.board-tabs`, `.agenda-segmented`, `.vidro-seg` and
     `[data-slot='tabs-list']` become a capsule track: `--vd-fill`, radius 999px, padding 2px, no
     underline border.
   - Segments: radius 999px, 13px, sentence case, no letter-spacing.
   - The active segment (`.active`, `[aria-pressed='true']`, `[data-state='active']`) takes the ink
     selection, and the `::after` underlines are hidden.
   - `.board-tab-add` keeps its look.
4. **Buttons.** `[data-slot='button']`, `.btn-primary`, `.btn-secondary`, `.btn-danger`,
   `.btn-danger-outline`, `.btn-icon`, `.btn-icon--danger` and `.btn-upgrade` get radius 999px.
5. **Tables inside cards:** unchanged. The container is the group.
6. **`data-slot` hooks.** shadcn `Button`, `TabsList` and `TabsTrigger` get `data-slot` attributes.
   Today no CSS or test reads `data-slot` (zero hits in `style.css` and `src`), so flag-off is
   unchanged.
7. **Fallbacks.** Under `@media (prefers-reduced-transparency: reduce)` and
   `@supports not (backdrop-filter: blur(1px))`, the glass surfaces become `--vd-solid`. The existing
   reduced-motion sidebar rule stays.

## Functionality inventory (nothing may be lost)

| Today | Vidro home |
|---|---|
| Top bar logo (plain link to /dashboard) | Sidebar header logo (SPA link) |
| Search trigger and ⌘K/Ctrl+K | Sidebar search capsule (an icon in the rail); listener always mounted |
| Notification bell, badge and popover | Toolbar shell capsule |
| Support chat button, unread dot and Crisp listeners | Toolbar shell capsule; listeners in `supportChatUnread.ts` |
| NavigationProgress | Top edge of the panel |
| Sidebar nav, gating, locked items, badges, groups, pin/rail/overlay and the pin row | Same, restyled |
| Account menu: switcher, Novidades, Ajuda, Idioma, theme, Sair | Same, plus the look item |
| Banners: dunning, incident, global | Same fixed stack, surfaces offset |
| GuidePill and ContextHelpLinks | Same corner, inside the panel |
| Page titles, info tooltips, actions and tours | Toolbar (migrated pages) or in-page (others) |
| View switchers | Four in the toolbar, the rest in content, restyled (D6) |
| Analytics de Fluxos print | Scoped vidro print block |
| Workspace name and plan | **New:** sidebar header |

## Testing

**Unit (Vitest):**

- **`vidroLook`:**
  - opt-out read and write per user;
  - the attribute and cache are written together;
  - the attribute is applied even when storage throws;
  - `clearVidroCache`.
- **`useVidro`:**
  - flag absent means off; flag true means on;
  - opt-out means off;
  - while loading, the pre-painted attribute is used;
  - after an error, state is kept and the cache is not touched;
  - a success writes the cache.
- **AuthContext:** sign-in and `signOut` clear the cache.
- **Sidebar:** a workspace switch clears the cache before reloading.
- **`PageToolbarContext`:**
  - register, set and unregister;
  - the last insertion shows;
  - a re-rendering layout keeps its position;
  - a subtitle update re-renders only `PageToolbar` (render-count assertion on a mocked AppLayout
    child);
  - a dev warning when two registrations are live;
  - returns false without `vidroShell`.
- **`supportChatUnread`:**
  - listeners are registered once across mounts;
  - unread is set by `message:received` and cleared by `chat:opened`;
  - `chat:closed` hides the chat.
- **AppLayout:**
  - Flag on at ≥1101: no `topbar`; the panel, toolbar, capsule (bell and chat) and NavigationProgress
    are in the panel.
  - Flag on at tablet or phone: today's shell.
  - Flag off: today's shell, and the existing assertions pass unchanged.
- **Sidebar (vidro):**
  - the header shows the workspace and plan;
  - one search trigger, which opens the dialog;
  - ⌘K works;
  - the look item writes the opt-out, fires the event and is absent in drawer mode.
- **Each migrated page:**
  - **With `vidroShell`:** the title renders once, as the toolbar `<h1>`, with a single `<h1>` in the
    document; each action renders once; the `data-tour` anchors exist.
  - **Without it:** the existing tests pass unchanged.
  - Page tests mock `matchMedia` to answer true for 768, 901 and 1101 (`useIsDesktop` and AppLayout
    read different queries).
- **Contract test on `vidro.css`** (postcss, following `mobileResponsiveFinalContracts.test.ts`):
  - every rule is inside `min-width: 1101px`, except rules inside the one `@media print` block, whose
    selectors must carry `body:has(.analytics-fluxos-page)`;
  - no `@layer` and no `!important`;
  - every selector starts with `html` carrying `[data-look='vidro']`;
  - no `--topbar-height` or `--sidebar-width` on a bare `.app-container`.

**Deno and psql:** the entitlement test and `99_crm_vidro_flag.sql`.

**Browser checks.** Seed login on staging. The `workspace-limits` stub is installed with
`context.route` before the first navigation, so pre-paint and reconciliation are exercised across real
reloads.

- **Pre-paint matrix:**
  - flag on, cold load (classic, then vidro, and the cache is written);
  - reload (vidro before first paint, captured with a screenshot at `domcontentloaded`);
  - flag flipped off, then reload (one vidro paint, then classic, and the cache is cleared);
  - opt-out, then reload (classic, the cache cleared);
  - sign-out, then sign-in (classic first);
  - workspace switch (cache cleared before the reload).
- **Sweep** at 1440px and at 1101px (to see the toolbar wrap), light and dark:
  - every migrated page;
  - a Sheet, a Dialog, the search dialog, the notification popover and the account menu;
  - Analytics de Fluxos print preview.
- **Below 1101px:** at 1100px and 800px, today's shell.
- **Flag off:** Início, Entregas, Clientes and Tarefas, computed-style diffed against `main`, are
  unchanged. Screenshots go to the owner.

**Gates:** lint, format, the four `tsc` projects, `npm run test`, `npm run check:functions` and
`npm run test:functions`.

## Risks

- **Registration ordering** during a route change: the insertion-order rule and cleanup on unmount,
  with tests.
- **Specificity:** a page rule more specific than `P` keeps its old surface. The sweep finds these, and
  fixes go in `vidro.css` only.
- **Glass performance:** `backdrop-filter` is applied to three elements only (sidebar, shell capsule,
  sidebar search). The overlay sidebar animates `width` under blur, so the sweep checks for jank. Cards
  stay opaque.
- **Contrast on glass:** light sidebar text is `#12151a` on at least 55% white over a light backdrop.
  Dark text is `#e8eaf0`/`#a1a8b5`. The sweep measures group labels and the subtitle on both
  backdrops.
- **Two shells until launch:** launch flips the plans. A later PR folds the sheet into the base CSS and
  deletes the classic branches.

## Out of scope

- The tablet drawer and phone shells. This includes the suspected 768-900px top-bar quirk, which is
  reported separately.
- Overlays.
- The view switchers listed in D6 as staying in content.
- Restyling the report editors and Hub pages.
- The mockups' content reshapes:
  - Início's "Hoje" and "Minha fila" as list rows;
  - the Clientes table-plus-inspector;
  - the Configurações System Settings layout;
  - the Calendário and Cliente toolbars.

  These are page rewrites to follow once the frame ships.
