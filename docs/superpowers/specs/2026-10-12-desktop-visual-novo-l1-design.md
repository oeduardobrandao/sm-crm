# Desktop "Visual novo" (level 1): iOS look in page content, behind a per-browser toggle

Date: 2026-10-12. Status: approved in chat; revised after a Fable review and a Codex review.

Mockups: https://claude.ai/artifact/Bt1KGGC2PLjqyH2QmVKGUo (board "Início · Nível 1: toque leve"; the
"Atual" board is today's look).

## Goal

The phone redesign (iOS F0-F5, merged #670-#690) gave the CRM an iOS idiom below 768px. The owner wants
the desktop CRM to borrow that look without losing the Mesaas identity. Of the three intensities
mocked up, they chose **level 1**: keep the desktop shell (ink topbar, sidebar) exactly as is and bring
the iOS idiom into the page content only.

Success means: with the toggle on, desktop pages read as the same product as the phone app (grey
canvas, borderless white groups, large titles, segmented controls, pill buttons), in light and dark;
with the toggle off, the app is pixel-identical to today.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Ship behind a toggle, off by default. The owner and pilot users turn it on, compare on real data, then we flip the default and fold the rules in. | Chosen by the owner over a straight launch or a page-by-page rollout. |
| D2 | The toggle is per browser: `localStorage['look'] = 'ios'` mirrored to `<html data-look="ios">`, exactly like the theme toggle (`localStorage['theme']` + `data-theme`). | The repo's real feature flags are plan columns (`_shared/entitlements.ts`): a migration plus three function redeploys for a purely visual switch. The theme pattern needs no backend, so merge = deploy. |
| D3 | All new styling lives in one **ordinary stylesheet** (not a CSS `@layer`: an unlayered base rule would beat any layered override), `apps/crm/src/styles/visual-novo.css`, imported after `style.css`. Every selector carries `[data-look='ios']` on `html`, then `.app-container`, and every rule sits inside `@media (min-width: 1101px)`. It restyles shared selectors; pages are not restyled one by one. | ~15 pages share `.header-title`, ~132 files share `.card`, 15 use `StatCardGrid`. One sheet reaches them all, and removing the attribute restores today's look exactly. |
| D4 | Applies from **1101px** up only: the width where the sidebar is static and the shell is the one the mockup shows. 768-1100px (drawer sidebar, and below 900px no sidebar at all, so no toggle) keeps today's look even with the toggle on, and the drawer menu does not offer the toggle (turning it off needs a 1101px+ window too). Phone (<768px), Hub and Admin are untouched. | Below 1101px the shell is the tablet/drawer layout (`AppLayout.tsx`, `style.css` tablet block) and the user menu holding the toggle is unreachable under 900px. One clean boundary avoids a half-applied look and overlap with the ≤900px/≤768px overrides. |
| D5 | Out of scope: sidebar, topbar, Radix overlays (Dialog/Sheet/Popover, which also portal outside `.app-container`, so any `.card` inside them keeps the old look by construction), table internals (rows, headers, cells), page-specific layouts. Table **containers** that are `.card` wrappers (Equipe, Leads, Automações...) are in scope: the wrapper becomes a white group on the grey canvas, the table inside is unchanged. | Level 1 is "content surfaces only". |
| D6 | Only the shared `.card`/`.kpi-*` surfaces change. Surfaces built another way keep today's treatment on the grey canvas: the shadcn `Card` primitive (used only by Importar), and ad-hoc Tailwind `bg-card` / `bg-[var(--card-bg)]` blocks (Ajuda, Ideias and others). The success criterion above applies to pages whose surfaces are `.card`. | Pulling those in means per-page TSX edits; the sweep records which pages stay mixed so the launch PR can decide. |
| D7 | Início gets no large page title at this level. Its only `.header-title` is the mid-page "Saúde dos clientes" section (`dashboard/components/ClientHealthMonitor.tsx`), which must stay a section heading. The follow-up Início rework (mockup's "Hoje"/"Minha fila" as list rows plus a real page title) is a separate TSX change after the owner has lived with this. | Adding a title would change the toggle-off look or need a hidden element; not worth it for level 1. |

## The toggle

- **Pre-paint:** the inline script in `apps/crm/index.html` that applies `data-theme` before React
  hydrates also sets `data-look="ios"` when `localStorage.getItem('look') === 'ios'`, inside the same
  function (after its `#/`/`#/login` early return). No flash of the old look on reload.
- **Stored values:** `localStorage['look']` is `'ios'` (on) or `'classic'` (explicitly off); absent
  means "never chose". Turning it off writes `'classic'`, never removes the key, so at launch the
  default can flip to on for "never chose" while every explicit opt-out stays off. Rolling back the
  launch flips the default back; stored values need no migration.
- **Module:** `apps/crm/src/lib/visualLook.ts` exports `isVisualNovoOn(): boolean`, which reads the
  `data-look` attribute on `<html>` (the same way `Sidebar.tsx` derives `isDark` from the DOM, so the
  menu can never disagree with what is applied), and `setVisualNovo(on: boolean): void`, which sets or
  removes the attribute and writes `'ios'` or `'classic'` (storage in try/catch; the attribute is
  applied even when storage throws). The default for "never chose" is one exported constant used by
  both this module and the pre-paint script's comment, `false` for now.
- **Control:** a new item in the sidebar user dropdown (`components/layout/Sidebar.tsx`, the
  `user-dropdown-item` list, directly under the theme toggle): icon `ph-bold ph-sparkle`, label
  `t('sidebar.visualNovo')`, with the existing `user-dropdown-item-check` icon when on. Like the theme
  toggle, the Sidebar keeps a `useState(isVisualNovoOn)` and the click handler calls `setVisualNovo`
  and updates that state, so the check flips immediately. No cross-tab sync: the theme toggle has none
  either, and another open tab picks the look up on its next reload. The phone "Mais"/Ajustes
  surfaces get no control (D4).
- **i18n:** `sidebar.visualNovo` in `packages/i18n/locales/pt/common.json` ("Visual novo (beta)") and
  `packages/i18n/locales/en/common.json` ("New look (beta)").
- **Analytics:** `captureEvent('visual_novo_toggled', { on })` from `lib/analytics.ts` (consent-aware;
  the event name is added to its `AnalyticsEvent` union). No other tracking.

## The override sheet

`visual-novo.css` is imported in `apps/crm/src/main.tsx` directly after `import '../style.css'` (today
the last import). It contains no `@layer`. Selectors use the prefix `P` =
`html[data-look='ios'] .app-container` (dark: `html[data-theme='dark'][data-look='ios'] .app-container`),
which outranks every base rule it targets (verified: no `!important` or higher-specificity rules on
these selectors at ≥1101px; `[data-theme='dark'] .page-tab.active` is 0,3,0 against 0,4,1). Tokens are
declared on `P`, mirroring the phone kit where the values carry over:

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--vn-canvas` | `#f2f2f7` | `#0a0c0f` | `--phone-bg`; dark equals today's `--bg-color` |
| `--vn-group` | `#ffffff` | `#12151a` | dark equals today's `--card-bg`, so the 130+ nested `var(--card-bg)` surfaces keep their hierarchy |
| `--vn-fill` | `rgba(118,118,128,.12)` | `rgba(118,118,128,.24)` | `--phone-fill` |
| `--vn-thumb` | `#ffffff` | `#3a404d` | `--phone-segment-thumb` |
| `--vn-radius-group` | `16px` | same | `--phone-radius-group` |
| `--vn-title` | `34px` | same | `--phone-text-large-title` |

What it restyles, and nothing else:

1. **Canvas.** `P .main-content:not(:has(> .page-full-bleed))` background becomes `--vn-canvas`.
   Full-bleed pages (Mensagens, Arquivos, ...) keep their own surfaces.
2. **Page title.** Applies to `P .header:not(.header--section) .header-title`, excluding
   `.header-title:has(.conta-identity)` (the Analytics account header keeps its identity layout and
   its `.conta-identity__handle`):
   - `h1, h2`: font-size `--vn-title`, weight 700, `letter-spacing: -0.02em`.
   - Only `.header-title:has(> p)` (a title with a direct-child subtitle) becomes `display: flex;
     flex-direction: column; align-items: flex-start`; that `p` gets `order: -1` (moves above the
     title, also when the h1 is wrapped in a div as in Entregas) and the eyebrow style: 13px, weight
     600, `--text-light`, `font-family: var(--font-main)`, no letter-spacing, `margin: 0 0 2px`. Nested
     `p`s are untouched. Headers that lay out the title as a row with an inline style (Leads,
     Financeiro, Ideias, Contratos, Automações, Equipe, Clientes: `h1` plus an info-tooltip icon, no
     direct-child `p`) keep that row and only get the larger title.
   - `ClientHealthMonitor.tsx`'s `<header className="header ...">` gets the extra class
     `header--section` (no base CSS uses it, so toggle-off is unchanged), keeping "Saúde dos clientes"
     at today's size (D7).
3. **Cards.** `P .card:not(.card-blue):not(.card-yellow):not(.card-teal):not(.card-dark)`: background
   `--vn-group`, `border-color: transparent`, `box-shadow: none`, `border-radius: --vn-radius-group`.
   The colour variants (no TSX usages today) are left exactly as they are.
4. **KPIs.** `P .kpi-grid`: background transparent, no border, no shadow, `gap: 12px`, `overflow:
   visible`. `P .kpi-card`: background `--vn-group`, no border, no shadow, radius 16px. Restated so the
   new specificity does not drop them:
   - `P .kpi-card--filler`: background transparent (the padding cells `StatCardGrid` adds to short
     rows must stay invisible).
   - `P .kpi-card[data-active='true']`: today's inset ring (`style.css` `.kpi-card[data-active='true']`).
   - `P button.kpi-card--clickable:hover`: today's hover background, over `--vn-group`.
5. **Segmented controls.** The active tab is "the thumb": background `--vn-thumb`, `box-shadow: 0 1px
   3px rgba(0,0,0,.12)`, no border.
   - `.page-tabs` (already segmented): track `--vn-fill`, radius 9px, padding 2px; `.page-tab`
     radius 7px, font-size 13px; `.page-tab.active` gets the thumb.
   - `.calendar-tabs` and `.board-tabs` (underline strips today) become the same control: track
     `--vn-fill`, radius 9px, padding 2px, gap 0, `border-bottom: none`, `width: fit-content`,
     `max-width: 100%`; `.board-tabs` keeps `overflow-x: auto`. `.calendar-tab` and `.board-tab`:
     padding `6px 14px`, radius 7px, 13px, `text-transform: none`, `letter-spacing: 0`,
     `font-family: var(--font-main)`. The active class is `.active` on both
     (`CalendarioPage.tsx`, `KanbanView.tsx`): it gets the thumb, `.calendar-tab.active` loses its tinted
     background, and `.calendar-tab.active::after` / `.board-tab.active::after` (the underlines) get
     `display: none`. The "+" add button (`.board-tab.board-tab-add`) is excluded from the segment
     styles and stays a plain icon button at the end of the track.
   - shadcn `TabsList`/`TabsTrigger` (`components/ui/tabs.tsx`) get `data-slot="tabs-list"` /
     `data-slot="tabs-trigger"` (no base CSS reads them); the sheet applies the track to the list and
     the thumb to `[data-slot='tabs-trigger'][data-state='active']`.
6. **Buttons.** shadcn `Button` gets `data-slot="button"` on the rendered `Comp`
   (`components/ui/button.tsx`), so `asChild` sites pass it through; no base CSS reads it. The sheet
   sets `border-radius: 999px` on `[data-slot='button']` and on exactly these generic classes from
   `style.css`: `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-danger-outline`, `.btn-icon`,
   `.btn-icon--danger`, `.btn-upgrade`, so a `.header-actions` row never mixes pills and 10px corners.
   Square icon buttons become circles. The page-specific classes keep their shapes: `.btn-confirmar`,
   `.btn-complete-etapa`, `.btn-revert-etapa`, `.btn-edit-workflow`, `.btn-remove-member`,
   `.btn-instagram-action` (and `--danger`), `.btn-integration`.

## Risks

- **Specificity.** A page rule more specific than the prefixed selector wins and that page keeps its
  old surface. The browser sweep lists such pages; fixes go in the override sheet, never in the base
  CSS.
- **White on white.** A `.card` nested in a `.card` loses its border and becomes invisible against its
  parent. The sweep looks for this; where it happens the sheet gives nested cards (`P .card .card`) a
  `--vn-fill` background instead.
- **Contrast.** `--text-light` (`#4b5563`) on `#f2f2f7` is 6.9:1, so the eyebrow and captions on the
  canvas pass AA. Body text stays on white groups.
- **Two looks until launch.** Launch = flip the default in `visualLook.ts` and the pre-paint script; a
  later PR folds the sheet into the base rules and deletes the guard.

## Testing

- **Unit (Vitest):**
  - `lib/visualLook.ts`: reads the attribute, writes and clears storage and the attribute, still sets
    the attribute when `localStorage` throws.
  - Sidebar: the new item toggles the attribute and shows the check when on.
  - Contract test on `visual-novo.css`, parsed with `postcss` (already a dependency) following the
    `mediaApplies` walker in `src/__tests__/mobileResponsiveFinalContracts.test.ts`: every rule is
    inside the `min-width: 1101px` block, no `@layer` exists, and the first compound selector of every
    selector is `html` carrying `[data-look='ios']` (with or without `[data-theme='dark']`).
- **Browser sweep** (Browser pane, seed login) at 1440px, toggle on, light and dark: Início, Entregas
  (Kanban board tabs), Clientes, Calendário (calendar tabs), Financeiro, Tarefas, Equipe (table in a
  card), Analytics, Analytics da conta (identity header), Mensagens and Arquivos (full-bleed),
  Configurações, and one Sheet (e.g. a task detail) to confirm overlays are untouched. At 1000px with
  the toggle on: today's look. Toggle off on Início and Entregas compared with `main` by computed
  style: unchanged. Screenshots go to the owner.
- **Gates:** lint, format, the four `tsc` projects, `npm run test`.

No backend, no migration, no edge function. Merging deploys it dark (off for everyone).
