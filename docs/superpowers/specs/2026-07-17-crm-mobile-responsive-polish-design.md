# CRM mobile responsive polish

**Date:** 2026-07-17  
**Status:** Approved design, ready for implementation planning

## Problem

The CRM is usable on desktop, but several shared and client-detail surfaces degrade on
phones:

- The bottom navigation uses a canvas cutout and animated floating bubble. At real phone
  widths, its background can fail to cover the icons and labels, the active label can be
  displaced, and the transition adds motion without improving orientation.
- Contextual support links render as a wrapping row above every page, consuming vertical
  space and competing with the page heading.
- `ClienteDetalhePage` is one of the longest pages in the CRM. Its desktop section rail is
  hidden on mobile, so there is no fast way to move between sections.
- The client header inherits generic desktop flex and heading rules. Long names become
  narrow vertical stacks, badges compete with the title, the back button can deform, and
  the edit action falls into an awkward row.
- Repeated mobile cards, especially Instagram's “Últimas Publicações,” stack into a very
  tall page even though users usually inspect them one at a time.
- The Hub tab list has five fixed-width triggers inside an intrinsic-width container, so
  the final tabs can be clipped at narrow widths. Hub link actions also wrap without a
  deliberate mobile hierarchy.

## Goal

Create a coherent responsive treatment that:

1. Replaces the fragile animated bottom navigation with a stable, iOS-inspired glass bar.
2. Collapses contextual help into one related-articles control at every breakpoint.
3. Gives `ClienteDetalhePage` a compact mobile header and a sticky, scroll-aware section
   strip.
4. Uses horizontal snap rails for repeated, self-contained cards where they materially
   reduce page height.
5. Keeps every Hub tab and action reachable without clipping or undersized targets.
6. Preserves current desktop behavior, permissions, routing, data fetching, and business
   logic unless the specification explicitly changes a responsive presentation.

## Non-goals

- No changes to Supabase, edge functions, API contracts, or persisted data.
- No reordering or renaming of the CRM's primary destinations.
- No redesign of desktop cards outside the contextual-help consolidation.
- No generic conversion of all tables or all card groups into carousels.
- No dependency on experimental browser APIs or a JavaScript layout engine.
- No attempt to reproduce Apple system materials exactly; the target is an accessible,
  brand-compatible glass treatment with reliable fallbacks.

## Design principles

- **Stable before animated:** navigation state must remain legible while idle, during route
  changes, and with reduced motion.
- **Visible affordance:** horizontal rails expose part of the next item and use snap
  behavior so swiping is discoverable and controlled.
- **One source of navigation truth:** desktop and mobile section navigation consume the
  same `buildNavModel` output and scrollspy state.
- **Mobile-specific hierarchy, shared behavior:** markup may receive dedicated classes or
  wrappers, but actions, permissions, queries, and callbacks remain shared.
- **Touch and safe-area aware:** interactive targets are at least 44px and fixed chrome
  includes `env(safe-area-inset-*)` offsets.

## 1. Mobile bottom navigation

### Structure

Keep the current five entries and routes:

1. Dashboard
2. Clientes
3. Analytics
4. Entregas
5. Mais

`MobileNav.tsx` remains responsible for routing, active-route detection, the More sheet,
theme switching, search, chat, profile display, feature gating, and sign-out. It stops
rendering the canvas and floating bubble, and no longer calls `mobile-nav-canvas.ts` or
`use-bubble-animation.ts`.

The navigation is a semantic `<nav>` containing five real buttons in an evenly sized CSS
grid. Each button contains an icon and an always-visible label. The active entry has:

- a static, rounded icon capsule;
- the brand accent for the icon/capsule treatment;
- stronger label color and weight;
- `aria-current="page"` for primary route entries.

The More entry receives its active styling while its sheet is open and remains a button
with `aria-expanded` and `aria-controls`.

### Visual treatment

On phones the bar is inset from the left, right, and bottom edges and sits above the home
indicator:

- rounded rectangle with a large continuous radius;
- translucent `var(--surface-main)`-derived background;
- subtle light border and upward shadow;
- `backdrop-filter` and `-webkit-backdrop-filter` blur/saturation;
- an opaque `var(--surface-main)` fallback when backdrop filtering is unsupported;
- no cutout, detached circle, canvas, or route-change animation.

Dimensions are driven entirely by CSS. The container encloses icons, labels, and bottom
safe-area padding at every supported phone width. Page bottom padding is derived from the
new bar height plus safe-area inset so content never sits behind it.

Small press/color transitions are allowed, but `prefers-reduced-motion: reduce` disables
nonessential transitions. The existing More sheet continues to open above the bar and is
repositioned relative to the new bar inset/height.

### Cleanup

After no production code or tests import them, delete:

- `apps/crm/src/components/layout/mobile-nav-canvas.ts`
- `apps/crm/src/components/layout/use-bubble-animation.ts`
- their animation/canvas-specific tests

Tests for the behavior that remains move to `MobileNav.test.tsx`.

## 2. Contextual related articles

`ContextHelpLinks` still derives the base route, fetches links with the existing
`getContextLinksForRoute` query, and returns nothing when the route has no links.

When links exist, render one compact trigger labelled **Artigos relacionados** with a book
icon and optional count. The trigger replaces the individual inline links at every
breakpoint.

- On desktop/tablet, the trigger opens an anchored accessible popover.
- On phones, it opens a bottom sheet so links have comfortable touch targets and cannot
  overflow the viewport.

Both presentations render the same link list. Every entry includes the article label and
navigates to `/ajuda/:slug` using React Router. Empty or missing article slugs are excluded
instead of creating a link to `/ajuda/`. Opening state is local UI state; no query or
store behavior changes.

The trigger sits in a dedicated help-actions row with compact bottom spacing so it does
not visually merge with the next page header. It supports keyboard activation, Escape to
close, outside-click dismissal, focus return, and appropriate `aria-expanded`/
`aria-controls` relationships through the existing Radix primitives.

## 3. Client-detail mobile header

Replace the header's layout-critical inline styles with explicit client-detail classes.
Desktop keeps the current horizontal composition.

Below 768px, use this composition:

1. A top identity row with a fixed 44px circular back button, a fixed 48px avatar, and a
   flexible text column with `min-width: 0`.
2. The client name uses `font-size: clamp(1.6rem, 7vw, 2rem)`, normal word wrapping,
   balanced line height, and a two-line visual limit. It never shares its narrow column
   with the plan/status badges.
3. Plan and status badges appear on a separate row beneath the name and may wrap as whole
   badges.
4. The Editar action is a compact icon-and-label control aligned with the identity block.
   It must not stretch to full width or squeeze the name. At the narrowest supported
   width it moves beneath the identity row while retaining its intrinsic width.

The page root uses smaller phone gutters than the current nested combination of
`.main-content` padding plus `1.5rem` page padding. Effective content gutters are 16px
from 360–767px and 12px below 360px. Section cards remain full-width inside those
gutters.

Long names, long emails, URLs, and badges must use `min-width: 0`, wrapping, or truncation
at the specific content boundary; the page itself must never overflow horizontally.

## 4. Responsive section navigation

`ClienteDetalheNav` consumes the existing `sections` and `actions` arrays and owns the
shared `activeId`/IntersectionObserver behavior.

### Desktop (1101px and above)

Keep the approved floating vertical rail and action group unchanged.

### Tablet (768–1100px)

Keep the section navigator hidden because this range uses the off-canvas application
sidebar and a top bar; this work does not introduce another sticky layer there.

### Phone (below 768px)

Render a sticky horizontal section strip immediately after the client header. It contains
section entries only; primary actions remain in their existing page locations/header so
the strip does not become an overflow menu.

- Each entry is a short labelled chip with its existing section icon.
- The active chip uses the same brand-tinted treatment as the desktop rail and carries
  `aria-current="true"`.
- The strip scrolls horizontally with hidden scrollbar and no label compression.
- When scrollspy changes `activeId`, the active chip calls `scrollIntoView` with inline
  centering/nearest behavior so it remains visible without vertically scrolling the page.
- Tapping a chip scrolls the matching section to the top using the current reduced-motion
  behavior.
- Sticky positioning accounts for the global banner and phone safe-area top inset.
- A translucent surface, border, and small shadow preserve readability over page content.

All section targets keep or receive `scroll-margin-top` large enough to clear the sticky
strip and any active global banner. Conditional sections continue to appear only when
their corresponding content exists.

## 5. Horizontal snap rails

Create page-local responsive rail classes rather than a global carousel library. Rails use
native overflow, `scroll-snap-type: x mandatory`, momentum scrolling, hidden scrollbars,
and a visible next-card edge. They do not auto-play, loop, or trap focus. Desktop layouts
remain their current grid/list/table presentation.

### Últimas Publicações

The Instagram posts renderer receives dedicated class names for its section, content, list,
and cards. On desktop it remains a data table. On phones its rows become horizontal post
cards rather than inheriting the global stacked-table-card rule.

Each card has a compact information hierarchy:

- thumbnail, date, and media type at the top;
- a two-to-three-line caption preview;
- engagement metrics grouped together;
- reach/impressions grouped together;
- a clearly labelled external-link action.

Cards use `flex-basis: 84%` of the rail viewport with a 260px minimum and
`scroll-snap-align: start`. The first five posts remain
available initially, preserving the current collapsed behavior. “Ver mais” reveals the
remaining posts and pagination behavior remains unchanged.

### Entregas Ativas

When multiple Workflow cards are present on phones, their container becomes a snap rail
with one card plus a next-card peek. A single Workflow card stays full-width. Existing
card actions and drawer callbacks are unchanged.

### Datas Importantes and Endereços

Replace layout-critical inline grid/card styles with named classes. On phones, multiple
items use compact snap rails; a single item stays full-width. Edit and delete controls
remain visible and meet the 44px touch-target requirement even though their glyphs remain
visually small.

### Content that does not become a rail

- Financial KPI cards remain a compact grid.
- Contracts and transaction tables retain the established mobile card transformation.
- Report settings, files, forms, calendars, empty states, and Hub content remain vertical.
- Delivery history remains a scannable vertical list.

## 6. Hub tabs and actions

Add a Hub-specific class to the existing Tabs root/list so global `Tabs` behavior does not
change unintentionally.

On phones:

- the tab viewport spans the available card width;
- the list scrolls horizontally with momentum and a hidden scrollbar;
- triggers retain intrinsic width and never shrink;
- left/right internal padding lets the first and last tabs clear the card edge;
- selecting a tab scrolls its trigger into view;
- all five tabs—Acesso, Briefing, Marca, Páginas, Ideias—remain keyboard and touch
  reachable.

The Acesso content uses a deliberate mobile layout:

1. The URL occupies its own row and truncates visually without changing the copied value.
2. Copiar and Preview share a two-column action row at 360px and above, and stack below
   360px.
3. Desativar/Ativar, Estender, and Gerar novo link flow into a full-width or two-column
   action grid according to label length.
4. Every button has a minimum 44px height and labels remain visible.
5. Expiry status stays below the action grid and wraps normally.

No token activation, rotation, extension, copy, preview, permission, or expiry logic
changes.

## 7. Component and styling boundaries

### `MobileNav.tsx`

- Keeps navigation and More-sheet behavior.
- Removes canvas/animation refs, effects, drawing, and animation locks.
- Adds semantic active/expanded attributes.

### `ContextHelpLinks.tsx`

- Keeps the existing query.
- Filters invalid article targets.
- Owns the single trigger and responsive popover/sheet content.

### `ClienteDetalheNav.tsx`

- Keeps one IntersectionObserver subscription and one active section state.
- Renders separate desktop-rail and phone-strip presentations from the same section data.
- Stores chip refs only to keep the active phone entry visible.

### `ClienteDetalhePage.tsx`

- Adds named header, section-container, rail, and card classes.
- Does not introduce new queries or duplicate business logic.
- Preserves the existing conditional section model and callbacks.

### `HubTab.tsx`

- Adds tab/action layout classes and explicitly scrolls the selected trigger into view.
- Preserves all data and mutation code.

### `InstagramPostsTable.ts`

- Keeps security requirements: user-derived HTML remains escaped and external URLs remain
  sanitized.
- Adds semantic classes and card-friendly labels without exposing raw errors or unsafe
  URLs.

### `apps/crm/style.css`

- Owns responsive chrome and page presentation.
- Uses phone rules below 768px, existing tablet rules at 768–1100px, and current desktop
  behavior above 1100px.
- Provides light/dark and backdrop-filter fallback treatments.

## 8. Accessibility and interaction details

- All navigation and action targets are semantic buttons or links.
- Touch targets are at least 44×44px.
- Active route and section states use `aria-current`.
- Expandable triggers expose `aria-expanded` and controlled element relationships.
- Focus indicators remain visible on glass surfaces.
- Horizontal rails remain keyboard-scrollable and do not intercept vertical page scroll.
- Decorative icon motion is absent; reduced-motion users receive instant section jumps and
  no nonessential transitions.
- Color is never the only indication of active state; weight, capsule/background, and
  accessible state are also present.

## 9. Error handling and fallbacks

- Data/query errors continue through the existing component handling; this project does
  not change their messages.
- Related-article entries with missing slugs are omitted. If all returned entries are
  invalid, the trigger is not rendered.
- If `IntersectionObserver` is unavailable, section buttons still scroll correctly; the
  strip simply lacks automatic active updates until a button is used.
- If backdrop filtering is unsupported, navigation/help/section surfaces use an opaque
  themed background and the same border/shadow.
- If content has only one repeatable card, it renders full-width instead of showing an
  unnecessary rail affordance.

## 10. Testing strategy

Follow test-driven development for each behavior change.

### Unit/component tests

- `MobileNav.test.tsx`
  - renders all five destinations;
  - marks the active primary route with `aria-current` and classes;
  - navigates without an animation lock;
  - exposes More-sheet expanded state and preserves feature gating/profile/theme/sign-out.
- `ContextHelpLinks.test.tsx`
  - renders no trigger for no valid links;
  - renders one trigger instead of multiple permanent links;
  - opens the list and navigates to valid article routes;
  - excludes missing slugs.
- `ClienteDetalheNav.test.tsx`
  - renders both presentations without duplicating accessible navigation names;
  - scrolls sections on click;
  - marks observer-selected sections active;
  - keeps the active phone chip visible;
  - respects reduced motion.
- `HubTab.test.tsx`
  - exposes all five tab triggers;
  - preserves access actions and token mutation behavior;
  - applies Hub-specific responsive hooks/classes.
- Instagram renderer tests
  - validate dedicated post-list/card markup, escaped captions, sanitized links, collapsed
    rows, expansion, and pagination.

### Static verification

- `npm run build` for TypeScript and the CRM Vite build.
- `npm run test` for the full Vitest suite.

### Visual/browser matrix

Verify at minimum:

- narrow phone around 320px;
- common iPhone width around 390px with bottom safe area;
- wider phone around 430px;
- tablet at 768px and 1024px;
- desktop just above 1100px and a normal wide desktop.

For phones, verify light/dark themes, a long multi-word client name, long email/URL data,
all five Hub tabs, multiple posts/deliveries/dates/addresses, More and related-article
sheets, global banner present/absent, reduced motion, and content clearance above the
bottom navigation.

## 11. Acceptance criteria

1. The phone bottom-navigation background encloses every icon and label at 320–430px and
   respects the bottom safe area.
2. Route changes do not animate a detached bubble or temporarily hide the active icon.
3. Contextual help occupies one compact trigger on desktop, tablet, and phone.
4. A long client name reads naturally in no more than two visual lines without deforming
   the back button, avatar, badges, or Editar action.
5. Phone content gutters are materially smaller than the current screenshot and no section
   causes horizontal page overflow.
6. The phone section strip stays sticky, highlights the current section, keeps its active
   chip visible, and jumps to every rendered section.
7. Últimas Publicações, multiple active deliveries, multiple dates, and multiple addresses
   use discoverable horizontal snap rails on phones; single items remain full-width.
8. All Hub tabs, including Ideias, can be reached and selected at 320px without clipping.
9. Hub URL and action buttons remain readable and usable without changing token behavior.
10. Desktop client-detail navigation and content layouts remain functionally unchanged.
11. The CRM build and full Vitest suite pass.

## Risks and mitigations

- **Nested horizontal gestures:** rails use native overflow and no pointer-drag library, so
  vertical scrolling remains browser-controlled. Rails are limited to clearly repeated
  content.
- **Sticky strip/banner overlap:** compute sticky and scroll offsets from existing CSS
  variables and test with the global banner both present and absent.
- **Global table rule collision:** Instagram receives a section-specific selector with
  sufficient specificity; other mobile tables retain their current transformation.
- **Long labels at 320px:** navbar labels remain short and use grid slots; Hub and section
  labels scroll rather than shrink.
- **Backdrop-filter performance:** only fixed/sticky chrome uses blur, with conservative
  blur values and an opaque fallback.
- **Large existing page component:** refactor only layout-critical blocks touched by this
  design. Do not perform unrelated `ClienteDetalhePage` decomposition in this scope.
