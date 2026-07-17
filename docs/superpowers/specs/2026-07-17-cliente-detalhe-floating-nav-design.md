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

Wide-desktop only (≥1101px, where the sidebar is statically present). The rail always
mirrors the sections that are actually rendered (many are role/data-conditional).

## Non-goals

- No change to the existing cards, their content, or their behavior beyond adding an
  `id` + `scroll-margin-top` anchor to each navigable section.
- Not a reusable/global component — it is specific to this page's sections and actions,
  so it lives in the `cliente-detalhe/` folder.
- No mobile or tablet treatment. Below 1101px the app changes layout (off-canvas drawer
  sidebar at 768–1100px with `.main-content { margin-left: 0 }`, bottom nav below 768px),
  so a sidebar-anchored rail has no stable gutter. The rail is hidden below 1101px.
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
| 6 | Hub | `sec-hub` | `LayoutDashboard` | `isAgent \|\| (!!cliente?.conta_id && !!workspaceSlug)` — the id goes on whichever renders (owner card **or** agent notice); the Hub card is absent for a non-agent until `workspaceSlug`/`conta_id` are available, so the row must follow the real condition, not "always" |
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
| Ir para Analytics | `BarChart3` | `!!igSummary?.account?.last_synced_at` (connected **and** first sync done) | `navigate('/analytics/' + clienteId)` |
| Abrir Hub | `ExternalLink` | `hubTokenData?.is_active && new Date(hubTokenData.expires_at).getTime() > Date.now() && workspaceSlug` | open `${origin}/${workspaceSlug}/hub/${hubTokenData.token}` in a new tab (`window.open(url, '_blank', 'noopener')`) |
| Editar cliente | `Edit2` | always | call the page's existing `handleEdit()` |

"Conectar Instagram" and "Ir para Analytics" key off connection state and are effectively
mutually exclusive: disconnected (`!igSummary`) shows Conectar; connected-and-synced
(`igSummary.account.last_synced_at`) shows Analytics. The in-between "connected but still
syncing" state (account exists, no `last_synced_at`) shows neither — matching the page,
which renders a syncing spinner and hides the analytics button until first sync completes.

**Abrir Hub must not open a stale link.** The page currently computes
`hubToken = hubTokenData?.is_active ? hubTokenData.token : undefined`, which ignores
expiry. The server enforces `expires_at > now()` and `HubTab` treats
`expires_at <= Date.now()` as expired. So the action is built from the raw
`hubTokenData` row and shown only when the token is active **and** not expired; when it is
expired or absent, the action is hidden (the user reaches the Hub section to rotate/rescue
the link). `ClienteDetalhePage` already fetches `hubTokenData` (query key
`['hub-token', clienteId]`), so no new fetch is needed — the existing derived `hubToken`
stays as-is for `boardCards`; the nav action uses `hubTokenData` directly.

The page already exposes all the needed values (`igSummary`, `hubTokenData`,
`workspaceSlug`, `handleEdit`, `navigate`).

### Positioning & layout

- Rail: `position: fixed`, `left: calc(var(--sidebar-width) + 0.5rem)`,
  `top: 50%`, `transform: translateY(-50%)`, above cards (`z-index` above content, below
  modals/drawers). `max-height: calc(100vh - 2rem)` with `overflow-y: auto` so a tall
  list (10 sections + up to 3 actions) never clips on short viewports. This
  `--sidebar-width` offset is only correct while the sidebar is statically present — i.e.
  at ≥1101px. The whole `.cliente-detalhe-nav` block (and the gutter) is wrapped in
  `@media (min-width: 1101px)`; the rail is `display: none` otherwise. It must **not** use
  the `≤900px`/`≥901px` breakpoints, because at 768–1100px the sidebar is an off-canvas
  drawer and `.main-content` has `margin-left: 0 !important`, which would strand the rail
  mid-content.
- Gutter: at ≥1101px reserve a small left gutter on the page root so the collapsed rail
  does not overlap the cards. **The page root currently has an inline
  `style={{ padding: '1.5rem' }}`, which would override a plain CSS class.** So this
  change moves the root padding out of the inline style: replace the inline `padding` with
  `className="cliente-detalhe-page"` and define `.cliente-detalhe-page { padding: 1.5rem }`
  in `style.css`, plus `@media (min-width: 1101px) { .cliente-detalhe-page { padding-left:
  calc(1.5rem + <rail collapsed width> + gutter) } }`. (Keep any other inline styles the
  root needs; only the `padding` moves.) On hover the expanded rail overlaps cards
  intentionally (floats with shadow).
- The rail reads `--sidebar-width` from the same CSS variable the layout uses (260px at
  ≥1101px) so it stays aligned if that value changes.

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
  `hubTokenData`, `workspaceSlug`) and renders `<ClienteDetalheNav sections={...}
  actions={...} />` once inside the page root. Section/action inclusion follows the exact
  render conditions of the cards (see the two tables), including the Hub section's
  `isAgent || (conta_id && workspaceSlug)` guard.
- What it depends on: `react`, `react-i18next` (for the nav aria-label only; labels are
  passed in already-localized), `lucide-react` types, and the section `id`s existing in
  the DOM. No data fetching, no store access.

## Files touched

- **New:** `apps/crm/src/pages/cliente-detalhe/ClienteDetalheNav.tsx`
- **Edit:** `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` — add `id` +
  `scroll-margin-top` to each navigable section; replace the root `<div>`'s inline
  `style={{ padding: '1.5rem' }}` with `className="cliente-detalhe-page"` (move padding to
  CSS so the gutter can apply); build `sections`/`actions` arrays; render the nav.
- **Edit:** `apps/crm/style.css` — `.cliente-detalhe-page` base padding + `@media
  (min-width: 1101px)` left gutter; `.cliente-detalhe-nav` rail classes (rest/hover
  widths, active state, divider) all inside `@media (min-width: 1101px)`, with the rail
  `display: none` below 1101px.
- **Edit:** `clients` i18n locale files — add `detail.nav.*` short labels and the nav
  aria-label key for each supported locale.

## Testing

- Unit (Vitest, RTL): render `ClienteDetalheNav` with a sample `sections`/`actions`
  set; assert one row per item, that clicking a section calls `scrollIntoView` on the
  matching element (mock `document.getElementById`), and that clicking an action fires
  its `onClick`. Assert `aria-current` reflects the active id.
- Manual/browser, at ≥1101px: the rail is centered on the left, collapsed to icons;
  hover expands to labels; scrolling highlights the right section; each action does the
  right thing (Editar opens the modal, Analytics navigates, Hub opens a tab, Conectar
  redirects when disconnected). Verify for both an owner and an agent (agent sees no
  Relatório/Financeiro rows; Hub row points at the notice card).
- Breakpoint regression: at 901–1100px (tablet drawer layout, `.main-content` margin-left
  0) and below 768px the rail must be absent — confirm it is not stranded mid-content.
- Hub expiry: with an active-but-expired token, "Abrir Hub" is hidden (not opening a stale
  link); with an active non-expired token it opens the portal tab.
- Instagram states: disconnected → "Conectar Instagram" shown, no Analytics; connected but
  no `last_synced_at` (syncing) → neither action; connected and synced → "Ir para
  Analytics" shown, no Conectar.
- `npm run build` (tsc + vite) and `npm run test` must pass.

## Risks / edge cases

- **Section list churn:** deliveries/history sections appear only after their queries
  resolve, so the rail grows as data loads. The observer re-subscribes on list change —
  verify no stale active highlight.
- **Anchor under a sticky bar:** if the app has a sticky top bar in this layout,
  `scroll-margin-top` must offset it; confirm the scrolled target is fully visible.
- **Short viewport:** with all 10 sections + actions, the vertically-centered rail could
  exceed viewport height — `max-height` + internal scroll handles it.
- **Overlap just above the breakpoint:** the reserved gutter keeps the collapsed rail
  clear of cards; confirm at ~1101px (just above the breakpoint) the gutter is enough and
  the expanded-on-hover overlap still reads well.
- **Layout-mode coupling:** the rail's `--sidebar-width` offset and the page gutter are
  valid only while the sidebar is static (≥1101px). If the layout's tablet/drawer
  breakpoints ever change, both the rail media query and the gutter media query must move
  with them — they are intentionally pinned to `min-width: 1101px`, matching
  `AppLayout`'s `useIsTablet` upper bound and the `.main-content` drawer override.
