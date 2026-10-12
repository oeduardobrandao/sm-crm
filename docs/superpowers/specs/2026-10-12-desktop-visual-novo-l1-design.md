# Desktop "Visual novo" (level 1): iOS look in page content, behind a per-browser toggle

Date: 2026-10-12. Status: approved in chat, spec under review.

Mockups: https://claude.ai/artifact/Bt1KGGC2PLjqyH2QmVKGUo (board "Início · Nível 1: toque leve"; the
"Atual" board is today's look).

## Goal

The phone redesign (iOS F0-F5, merged #670-#690) gave the CRM an iOS idiom below 768px. The owner wants
the desktop CRM to borrow that look without losing the Mesaas identity. Of the three intensities
mocked up, they chose **level 1**: keep the desktop shell (ink topbar, sidebar) exactly as is and bring
the iOS idiom into the page content only.

Success means: with the toggle on, every desktop page reads as the same product as the phone app
(grey canvas, borderless white groups, large titles, segmented controls, pill buttons), in light and
dark; with the toggle off, the app is pixel-identical to today.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Ship behind a toggle, off by default. The owner and pilot users turn it on, compare on real data, then we flip the default and delete the old rules. | Chosen by the owner over a straight launch or a page-by-page rollout. |
| D2 | The toggle is per browser: `localStorage['look'] = 'ios'` mirrored to `<html data-look="ios">`, exactly like the theme toggle (`localStorage['theme']` + `data-theme`). | The repo's real feature flags are plan columns (`_shared/entitlements.ts`): a migration plus three function redeploys for a purely visual switch. The theme pattern needs no backend, so merge = deploy. |
| D3 | All new styling is one scoped CSS layer, `apps/crm/src/styles/visual-novo.css`, every rule under `html[data-look='ios']` and inside `@media (min-width: 768px)`. It restyles shared selectors; pages are not edited. | ~15 pages share `.header-title`, ~135 files share `.card`, 12 share `.kpi-grid`/`.kpi-card`. One layer reaches them all, and removing the attribute restores today's look exactly. |
| D4 | Desktop only. The phone layout (<768px), Hub and Admin are untouched. | The phone already has the idiom. The Hub imports `apps/crm/style.css` but not the new file (imported from the CRM entry only), and every selector is scoped under `.app-container`. |
| D5 | Out of scope: sidebar, topbar, Radix overlays (Dialog/Sheet/Popover), tables, page-specific layouts. Início's "Hoje"/"Minha fila" as true list rows (as in the mockup) is a follow-up TSX change after the owner has lived with this. | Level 1 is "content only"; overlays and tables belong to a later level if wanted. |

## The toggle

- **Pre-paint:** the inline script in `apps/crm/index.html` that applies `data-theme` before React
  hydrates also sets `data-look="ios"` when `localStorage.getItem('look') === 'ios'`, inside the same
  function (after its `#/`/`#/login` early return). No flash of the old look on reload.
- **Control:** a new item in the sidebar user dropdown (`components/layout/Sidebar.tsx`, the
  `user-dropdown-item` list, directly under the theme toggle): icon `ph-bold ph-sparkle`, label
  `t('sidebar.visualNovo')`, with the existing `user-dropdown-item-check` icon when on. Clicking
  flips the state and updates storage and the attribute. Copy has no em dash.
- **Module:** `apps/crm/src/lib/visualLook.ts` exports `isVisualNovoOn(): boolean` and
  `setVisualNovo(on: boolean): void` (writes or removes `localStorage['look']`, sets or removes the
  attribute; storage access in try/catch, attribute still applied when storage throws). `Sidebar.tsx`
  and tests share it. The phone "Mais"/Ajustes surfaces get no control (D4).
- **i18n:** `sidebar.visualNovo` in `packages/i18n/locales/pt/common.json` ("Visual novo (beta)") and
  `.../en/common.json` ("New look (beta)").
- **Analytics:** `captureEvent('visual_novo_toggled', { on })` from `lib/analytics.ts` (consent-aware;
  the event name is added to its `AnalyticsEvent` union). No other tracking.

## The CSS layer

`visual-novo.css` is imported in `apps/crm/src/main.tsx` right after `import '../style.css'`. All rules
sit inside one `@media (min-width: 768px)` block, and every selector starts with
`html[data-look='ios'] .app-container`. That prefix outranks the base rules it overrides (one extra
attribute plus one class), so no `!important`. Tokens are defined on the same prefix, reusing the
phone kit values so the two idioms stay in sync:

| Token | Light | Dark (`html[data-theme='dark'][data-look='ios'] .app-container`) | Mirrors |
|---|---|---|---|
| `--vn-canvas` | `#f2f2f7` | `#0a0c0f` | `--phone-bg` |
| `--vn-group` | `#ffffff` | `#1a1e26` | `--phone-cell` |
| `--vn-fill` | `rgba(118,118,128,.12)` | `rgba(118,118,128,.24)` | `--phone-fill` |
| `--vn-thumb` | `#ffffff` | `#3a404d` | `--phone-segment-thumb` |
| `--vn-radius-group` | `16px` | same | `--phone-radius-group` |
| `--vn-title` | `34px` | same | `--phone-text-large-title` |

What it restyles, and nothing else:

1. **Canvas.** `.main-content` background becomes `--vn-canvas`. Full-bleed pages
   (`.main-content:has(> .page-full-bleed)`) are excluded: they keep their own surfaces.
2. **Page title.** `.header-title h1, .header-title h2`: font-size `--vn-title`, weight 700,
   `letter-spacing: -0.02em`. `.header-title` becomes a flex column and its subtitle `p` moves above
   the title (`order: -1`), styled as a 13px weight-600 line in `--text-light`, `font-family:
   var(--font-main)`, no letter-spacing, `margin: 0 0 2px` (the mockup's eyebrow).
3. **Cards.** `.card`: background `--vn-group`, `border-color: transparent`, `box-shadow: none`,
   `border-radius: --vn-radius-group`. The colour variants `.card-blue/-yellow/-teal/-dark` keep their
   backgrounds; they only take the radius and lose the shadow.
4. **KPIs.** `.kpi-grid`: background transparent, no border, no shadow, `gap: 12px`, `overflow:
   visible`. Each `.kpi-card` (inside a grid or standalone): background `--vn-group`, no border, no
   shadow, radius 16px.
5. **Segmented controls.**
   - `.page-tabs` (already segmented): track `--vn-fill`, radius 9px, padding 2px; `.page-tab` radius
     7px, font-size 13px; `.page-tab.active` background `--vn-thumb`, `box-shadow: 0 1px 3px
     rgba(0,0,0,.12)`, no border.
   - `.calendar-tabs` and `.board-tabs` (underline strips today) become the same control: track
     `--vn-fill`, radius 9px, padding 2px, gap 0, no bottom border, `width: fit-content`,
     `max-width: 100%`; `.board-tabs` keeps `overflow-x: auto`. Their tabs lose the underline, take
     radius 7px, 13px, normal case, no tracking; the active one gets the thumb style above. The plan
     confirms each strip's active-state class before writing the rule.
   - shadcn `TabsList`/`TabsTrigger` (`components/ui/tabs.tsx`) get `data-slot="tabs-list"` /
     `data-slot="tabs-trigger"` attributes (no visual change by themselves); the layer applies the
     track to the list and the thumb to `[data-slot='tabs-trigger'][data-state='active']`.
6. **Buttons.** shadcn `Button` (`components/ui/button.tsx`) gets `data-slot="button"` (no visual
   change by itself). The layer sets `border-radius: 999px` on `[data-slot='button']`, `.btn-primary`,
   `.btn-secondary`, `.btn-danger`. Square icon buttons become circles by the same rule.

## Risks

- **Specificity.** A page rule more specific than `html[data-look='ios'] .app-container .card` will
  win and that page keeps its old card. Accepted: the browser sweep lists any such page, and fixes go
  in the layer, never in the base CSS.
- **Contrast.** `--text-light` (`#4b5563`) on `#f2f2f7` is 6.9:1; the eyebrow and any caption on the
  canvas pass AA. Cards keep white behind body text.
- **Two looks until launch.** Launch = flip the default in `visualLook.ts` and the pre-paint script;
  a later PR folds the layer into the base rules and deletes the guard.

## Testing

- **Unit (Vitest):** `lib/visualLook.ts` reads and writes storage and the attribute and survives a
  throwing `localStorage`; the Sidebar item toggles the attribute and shows the check when on; a
  contract test reads `visual-novo.css` and asserts that every rule is inside the `min-width: 768px`
  block and every selector starts with `html[data-look='ios']`, so nothing leaks into the default look
  or the phone.
- **Browser sweep** (Browser pane, seed login): Início, Entregas, Clientes, Calendário, Financeiro,
  Tarefas, Analytics, Configurações at 1440px, toggle on, light and dark; toggle off on Início and
  Entregas compared with `main` by computed style (must be unchanged). Screenshots go to the owner.
- **Gates:** lint, format, the four `tsc` projects, `npm run test`.

No backend, no migration, no edge function. Merging deploys it dark (off for everyone).
