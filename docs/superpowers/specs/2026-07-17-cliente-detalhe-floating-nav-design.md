# Floating section nav — ClienteDetalhePage

**Date:** 2026-07-17
**Branch:** `claude/cliente-detalhe-floating-nav-b97521`
**Status:** Approved design, ready for implementation planning

## Problem

`apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` is a long, single-column
stack of cards (~2500 lines rendered). To reach a section — Financeiro, Endereços,
Instagram — the user scrolls a lot, with no overview of what the page contains and no
quick way to jump. There is also no in-page shortcut to the client's primary actions
(edit, open Hub, analytics, connect Instagram).

## Goal

Add a floating navigation rail pinned to the left of the content area that:

1. Lists the page's sections and lets the user jump to any of them (scroll + scrollspy
   highlight).
2. Groups a small set of primary client actions at the bottom.

Desktop only. The rail always mirrors the sections that are actually rendered (many are
role/data-conditional).

## Non-goals

- No change to the existing cards, their content, or their behavior beyond adding an
  `id` + `scroll-margin-top` anchor to each navigable section.
- Not a reusable/global component — it is specific to this page's sections and actions,
  so it lives in the `cliente-detalhe/` folder.
- No mobile treatment. At ≤900px the app already switches to a bottom nav; the rail is
  hidden there.
- Does not replace the header's back arrow or Editar button (those stay).

## Solution overview

A new local component `ClienteDetalheNav.tsx` in
`apps/crm/src/pages/cliente-detalhe/`. `ClienteDetalhePage` computes two arrays that
reflect current render conditions and passes them in; the nav renders the rail and owns
the scrollspy behavior. All visual styling, hover-expand, and responsive rules live in
`apps/crm/style.css` under a dedicated block (project convention: layout/CSS-driven
chrome lives in `style.css`, not inline).

### Form factor (Option A — expand on hover)

- Slim vertical icon rail at rest (~48px wide), one row per item.
- On hover of the rail, it widens (~180px) to reveal the PT text label beside each icon.
  Transition is a width/opacity animation; expanded state floats above the cards with a
  shadow (transient, so overlapping card content on hover is acceptable).
- The active section row is highlighted in the brand yellow (`--primary-color`,
  `#eab308`) with a subtle tinted background (`#eab30822`).
- A thin divider separates the section links (top) from the action buttons (bottom).

### Section links

Each navigable card in `ClienteDetalhePage` gets a stable DOM `id` and
`scroll-margin-top` (so the smooth-scrolled target is not hidden under any sticky top
bar). The nav is passed only the sections that are currently present.

| Order | Label (PT) | `id` | Icon (lucide) | Rendered when |
|------|------------|------|---------------|----------------|
| 1 | Informação | `sec-info` | `Info` | always |
| 2 | Entregas | `sec-entregas` | `LayoutList` | `boardCards.length > 0` |
| 3 | Histórico | `sec-historico` | `History` | `concludedSummaries.length > 0` |
| 4 | Instagram | `ig-container` | `Instagram` | always (reuse existing `id="ig-container"` on `InstagramSection`) |
| 5 | Relatório | `sec-relatorio` | `FileText` | `!isAgent` |
| 6 | Hub | `sec-hub` | `LayoutDashboard` | always (owner card **or** agent notice both get the id) |
| 7 | Arquivos | `sec-arquivos` | `FolderOpen` | always (`ClienteArquivosSection` wrapper) |
| 8 | Datas | `sec-datas` | `CalendarDays` | always |
| 9 | Endereços | `sec-enderecos` | `MapPin` | always |
| 10 | Financeiro | `sec-financeiro` | `Wallet` | `!isAgent` (id on the KPI grid, the first Financeiro card) |

Labels come from the `clients` i18n namespace where an existing key matches (e.g.
`detail.information`, `detail.activeDeliveries`, `detail.deliveryHistory`,
`detail.importantDates`, `detail.addresses`, `detail.files`). Short rail labels that have
no existing key get new keys under `detail.nav.*` (e.g. `detail.nav.instagram`,
`detail.nav.report`, `detail.nav.hub`, `detail.nav.finance`), added to every locale file
in the `clients` namespace. Existing longer titles stay on the cards; the rail uses the
short forms.

### Actions (bottom group, in this order)

| Label (PT) | Icon | Shown when | Behavior |
|-----------|------|-----------|----------|
| Conectar Instagram | `Plug` | `!igSummary` (not connected) | `await getInstagramAuthUrl(clienteId)` then `window.location.href = url`; on error, `toast.error`. Mirrors `renderInstagramConnectButton`. |
| Ir para Analytics | `BarChart3` | `!!igSummary?.account` (connected) | `navigate('/analytics/' + clienteId)` |
| Abrir Hub | `ExternalLink` | `hubToken && workspaceSlug` | open `${origin}/${workspaceSlug}/hub/${hubToken}` in a new tab (`window.open(url, '_blank', 'noopener')`) |
| Editar cliente | `Edit2` | always | call the page's existing `handleEdit()` |

"Conectar Instagram" and "Ir para Analytics" are mutually exclusive by connection state:
disconnected shows Conectar; connected shows Analytics. The page already exposes all the
needed values (`igSummary`, `hubToken`, `workspaceSlug`, `handleEdit`, `navigate`).

### Positioning & layout

- Rail: `position: fixed`, `left: calc(var(--sidebar-width) + 0.5rem)`,
  `top: 50%`, `transform: translateY(-50%)`, above cards (`z-index` above content, below
  modals/drawers). `max-height: calc(100vh - 2rem)` with `overflow-y: auto` so a tall
  list (10 sections + up to 3 actions) never clips on short viewports.
- Gutter: on desktop (≥901px) reserve a small left gutter on the page root so the
  collapsed rail does not overlap the cards. Implemented as a CSS class on the page's
  outer `<div>` (e.g. `.cliente-detalhe-page`) that adds `padding-left` only in the
  desktop media query. On hover the expanded rail overlaps cards intentionally (floats
  with shadow).
- The rail reads `--sidebar-width` from the same CSS variable the layout uses (260px
  desktop) so it stays aligned if that value changes.

### Scrollspy

- An `IntersectionObserver` observes each present section element by `id`.
- The section whose top is nearest the top of the viewport (within a top-biased
  `rootMargin`) is marked active; its rail row gets the highlight + `aria-current="true"`.
- Re-subscribe when the list of present sections changes (data loading in, role).
- Clicking a section row: `document.getElementById(id)?.scrollIntoView({ behavior:
  'smooth', block: 'start' })`.

### Accessibility

- Wrapper is `<nav aria-label>` (localized, e.g. "Navegação da página").
- Section rows and action buttons are real `<button>`s with an `aria-label` (the label
  text), so they are usable while the rail is collapsed (icon-only).
- Active section row carries `aria-current="true"`.
- Respect `prefers-reduced-motion` for the smooth scroll (fall back to instant jump).

## Component contract

`ClienteDetalheNav.tsx` exports a default component:

```ts
interface NavSection {
  id: string;        // DOM id of the target card
  label: string;     // localized short label
  icon: LucideIcon;  // lucide-react component
}

interface NavAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

interface ClienteDetalheNavProps {
  sections: NavSection[]; // already filtered to present sections, in display order
  actions: NavAction[];   // already filtered, in display order
}
```

- What it does: renders the fixed rail, tracks the active section via
  `IntersectionObserver`, scrolls on click, expands on hover.
- How you use it: `ClienteDetalhePage` builds `sections` and `actions` with `useMemo`
  from its existing state (`boardCards`, `concludedSummaries`, `isAgent`, `igSummary`,
  `hubToken`, `workspaceSlug`) and renders `<ClienteDetalheNav sections={...}
  actions={...} />` once inside the page root.
- What it depends on: `react`, `react-i18next` (for the nav aria-label only; labels are
  passed in already-localized), `lucide-react` types, and the section `id`s existing in
  the DOM. No data fetching, no store access.

## Files touched

- **New:** `apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx`
- **Edit:** `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` — add `id` +
  `scroll-margin-top` to each navigable section; add the page-root class; build
  `sections`/`actions` arrays; render the nav.
- **Edit:** `apps/crm/style.css` — `.cliente-detalhe-page` desktop gutter + rail
  classes (rest/hover widths, active state, divider, `≤900px { display: none }`).
- **Edit:** `clients` i18n locale files — add `detail.nav.*` short labels and the nav
  aria-label key for each supported locale.

## Testing

- Unit (Vitest, RTL): render `ClienteDetalheNav` with a sample `sections`/`actions`
  set; assert one row per item, that clicking a section calls `scrollIntoView` on the
  matching element (mock `document.getElementById`), and that clicking an action fires
  its `onClick`. Assert `aria-current` reflects the active id.
- Manual/browser: on desktop the rail is centered on the left, collapsed to icons;
  hover expands to labels; scrolling highlights the right section; each action does the
  right thing (Editar opens the modal, Analytics navigates, Hub opens a tab, Conectar
  redirects when disconnected); at ≤900px the rail is gone. Verify for both an owner and
  an agent (agent sees no Relatório/Financeiro rows; Hub row points at the notice card).
- `npm run build` (tsc + vite) and `npm run test` must pass.

## Risks / edge cases

- **Section list churn:** deliveries/history sections appear only after their queries
  resolve, so the rail grows as data loads. The observer re-subscribes on list change —
  verify no stale active highlight.
- **Anchor under a sticky bar:** if the app has a sticky top bar in this layout,
  `scroll-margin-top` must offset it; confirm the scrolled target is fully visible.
- **Short viewport:** with all 10 sections + actions, the vertically-centered rail could
  exceed viewport height — `max-height` + internal scroll handles it.
- **Overlap on mid-width desktop:** the reserved gutter keeps the collapsed rail clear
  of cards; confirm at ~901px (just above the breakpoint) the gutter is enough and the
  expanded-on-hover overlap still reads well.
