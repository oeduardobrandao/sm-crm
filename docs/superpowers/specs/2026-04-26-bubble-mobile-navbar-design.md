# Bubble Mobile Bottom Navbar — Design Spec

## Overview

Replace the current mobile bottom navigation bar with a bubble-style navbar. The active item's icon rises into a floating circular bubble above the bar, and the bar itself deforms (a circle is "punched out") to create a visible gap between the bubble and the bar surface. Switching items animates the bubble down/up and the bar cutout closing/opening.

## Visual Design

### Bar Shape
- Full-width rectangle, flush to left/right/bottom edges of the screen (no side margins)
- Top corners rounded (`border-radius: 20px 20px 0 0`)
- Background follows app theme: `var(--surface-main)` (white in light mode, `#1a1e26` in dark mode)

### Bubble
- 52px diameter dark circle (`#12151a` in both themes; `#1e2430` with subtle border in dark mode)
- Contains the active item's icon (22px, white stroke)
- Positioned above the bar, offset ~18px from the top of the nav-wrap (just slightly above the bar edge)

### Bar Cutout
- A perfect circle erased from the bar surface using Canvas 2D `destination-out` compositing
- Cutout radius: 32px (slightly larger than bubble's 26px radius, creating a ~6px visible gap)
- Cutout center aligned with the bubble center
- When no item is active in a position, the bar is a flat rectangle (no cutout)

### Labels
- All labels stay the same font size (`0.6rem`, weight 600)
- Inactive labels: muted color (`var(--text-light)` / `#b0b5be` light, `#4a4f5a` dark)
- Active label: bright color (`var(--text-main)` / `#12151a` light, `#e8eaf0` dark), weight 700
- No size change, no vertical movement — only color changes

### Icons
- Inactive: 22px, muted stroke color (same as labels)
- Active: icon hidden in the bar (opacity 0, visibility hidden), shown inside the bubble instead

## Nav Items

### Primary Bar (4 items + More button)
1. **Dashboard** (`/dashboard`) — `ph-chart-pie-slice`
2. **Clientes** (`/clientes`) — `ph-users`
3. **Analytics** (`/analytics`) — `ph-chart-line-up`
4. **Entregas** (`/entregas`) — `ph-kanban`
5. **Mais** — `ph-dots-three` (opens More sheet, no bubble effect)

### More Sheet — Complete Route List (grouped like Sidebar)
All routes from Sidebar.tsx, excluding the 4 primary bar items:

**Visão Geral:** Calendário
**CRM:** Leads, Ideias
**Gestão:** Arquivos, Financeiro, Contratos, Equipe
**Analytics:** Fluxos
**Configurações:** Configurações, Privacidade

Plus: Profile row (avatar + name + plan), theme toggle, sign out button.

Role-based filtering applies same rules as Sidebar (agents can't see Leads, Financeiro, Contratos).

### More Sheet Visual Design
- Rounded card (`border-radius: 24px`) positioned above the navbar
- Same fill color as navbar (`var(--surface-main)`)
- Grouped list layout with small uppercase group labels
- Items: icon in rounded square container + label, full-width tap targets
- Active page highlighted with brand color (`#eab308`)
- Slide-up animation with spring easing
- Dark overlay backdrop, dismisses on tap

## Animation

### Switching Active Item (two-phase)
1. **Phase 1 — Close (280ms, ease-out cubic):**
   - Current bubble drops down (opacity fades to 0)
   - Current bar cutout shrinks (circle radius animates from 32 → 0)
   - Bar surface fills in smoothly

2. **Phase 2 — Open (350ms, ease-in-out cubic):**
   - New bubble icon is set
   - New bubble rises up (opacity fades to 1, spring easing with 120ms delay)
   - New bar cutout grows (circle radius animates from 0 → 32)
   - Bar surface opens smoothly

### Easing Curves
- Bubble rise: `cubic-bezier(0.34, 1.56, 0.64, 1)` (spring overshoot)
- Bubble drop: `cubic-bezier(0.6, 0, 0.4, 1)` (smooth deceleration)
- Bar cutout: requestAnimationFrame with cubic easing functions

## Implementation Approach

### Canvas 2D for Bar Background
The bar is rendered using an HTML Canvas element (2x resolution for retina):
1. Draw a rounded-top rectangle filled with the theme color
2. Use `globalCompositeOperation = 'destination-out'` to erase a perfect circle at the active item's position
3. Redraw on every animation frame during transitions

This avoids all SVG distortion and curve artifacts.

### Key Parameters
```
BAR_Y = 42           // top of bar from top of nav-wrap (in canvas coords)
CORNER_R = 20        // top corner radius
CUTOUT_R = 32        // circle cutout radius
CUTOUT_CY = 44       // cutout center Y
BUBBLE_SIZE = 52     // bubble diameter
BUBBLE_TOP_UP = 18   // bubble top when floating
BUBBLE_TOP_DOWN = 38 // bubble top when sinking into bar
```

## Theming

| Element | Light Mode | Dark Mode |
|---------|-----------|-----------|
| Bar fill | `var(--surface-main)` → `#ffffff` | `var(--surface-main)` → `#1a1e26` |
| Bubble fill | `#12151a` | `#1e2430` |
| Active icon | `#ffffff` (white) | `#e8eaf0` |
| Inactive icons | `#b0b5be` | `#4a4f5a` |
| Active label | `#12151a` (font-weight 700) | `#e8eaf0` (font-weight 700) |
| Inactive labels | `#b0b5be` | `#4a4f5a` |

## Files to Change

1. **`apps/crm/src/components/layout/MobileNav.tsx`**
   - Rewrite primary bar: Canvas element + bubble div + nav items
   - Canvas drawing logic (bar + circle cutout + animation)
   - Update More sheet: grouped list layout, all Sidebar routes, visual refresh
   - Role-based filtering for More sheet items (reuse Sidebar's `getNavGroups` logic)

2. **`apps/crm/style.css`**
   - Replace `.mobile-nav` styles with new `.mobile-nav-bubble` styles
   - Update More sheet styles (grouped list, section headers, item layout)
   - Keep safe-area-inset handling for notched devices

3. **`apps/crm/src/components/layout/__tests__/MobileNav.test.tsx`**
   - Update selectors for new markup structure
   - Add tests for new routes (Ideias, Fluxos, Privacidade)
   - Test canvas rendering may need mocking

## Mockup Reference
Interactive mockup: `.superpowers/brainstorm/43523-1777206529/content/mockup-navbar-v10.html`
More sheet mockup: `.superpowers/brainstorm/43523-1777206529/content/mockup-more-sheet.html`
