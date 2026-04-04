# Tablet Sidebar Drawer

**Date:** 2026-04-03  
**Status:** Approved

## Problem

Between 768px and 1100px (iPad landscape, small laptops used with touch), the existing sidebar takes 64px of horizontal space via an icon rail. This leaves Kanban columns too narrow and the content area cramped. The icon rail hover-expand was also broken in practice because the CSS referenced outdated class names.

## Solution

At 768–1100px: hide the sidebar entirely and show a slim top bar with a hamburger button. Tapping the hamburger slides the **exact desktop sidebar** in as a left-side drawer overlay. Tapping a nav item navigates and closes the drawer. Full-width content.

## Breakpoint Strategy

| Range | Device | Nav pattern | Change? |
|---|---|---|---|
| < 768px | Phone | Floating bottom pill nav | No change |
| 768px – 1100px | iPad landscape / small laptop | Top bar + hamburger → slide-over drawer | **NEW** |
| > 1100px | Desktop / large laptop | Full 260px sidebar | No change |

## Architecture

### AppLayout (`src/components/layout/AppLayout.tsx`)

- Add `isTablet` state — true when `window.innerWidth` is 768–1100px, updated via `resize` listener (or a `useMediaQuery` hook)
- Add `drawerOpen` boolean state
- Render `<TabletTopBar>` (new component) only when `isTablet` — contains logo + hamburger button, passes `onHamburgerClick={() => setDrawerOpen(true)}`
- Pass `isDrawer={isTablet} isOpen={drawerOpen} onClose={() => setDrawerOpen(false)}` to `<Sidebar>`
- Render `<TabletDrawerBackdrop>` (inline div or tiny component) when `isTablet && drawerOpen` — click closes drawer
- `main.main-content` gets `margin-left: 0` and `padding-top` for top bar height when `isTablet`

### Sidebar (`src/components/layout/Sidebar.tsx`)

New props:
```ts
interface SidebarProps {
  isDrawer?: boolean;   // tablet mode — renders as overlay
  isOpen?: boolean;     // controls slide-in/out
  onClose?: () => void; // called after nav item tap
}
```

- When `isDrawer=false` (default): existing always-visible desktop behaviour, no change
- When `isDrawer=true`: sidebar gets CSS class `sidebar--drawer`; positioned fixed, full height, slides in from left via `transform: translateX(-100%)` → `translateX(0)` when open
- `handleNavClick` calls `onClose()` after `navigate()` when `isDrawer=true`
- Escape key listener added when drawer is open (`isDrawer && isOpen`)
- Resize to >1100px: `isTablet` becomes false in AppLayout → `drawerOpen` resets to false

### TabletTopBar (new — `src/components/layout/TabletTopBar.tsx`)

- Fixed, 48px tall, full width
- Logo (light/dark variant) on the left
- Hamburger icon button on the right (`ph-list` icon)
- Same background as sidebar (`var(--surface-main)` / dark: `var(--sidebar-bg)`)
- Border-bottom matching sidebar border style
- Only rendered when `isTablet`

### MobileNav (`src/components/layout/MobileNav.tsx`)

- No changes to the component itself
- Hidden at 768–1100px via CSS (`display: none`)

## CSS Changes (`style.css`)

### Remove
The existing `@media (min-width: 901px) and (max-width: 1100px)` icon-rail block that sets `--sidebar-width: 64px` and the broken `.sidebar:hover { width: 220px }` rule. This breakpoint is fully replaced.

### Add

```css
/* Tablet: hide sidebar and mobile nav, show top bar */
@media (min-width: 768px) and (max-width: 1100px) {
  .sidebar { display: none; }
  .mobile-nav { display: none; }
  .tablet-top-bar { display: flex; }

  .main-content {
    margin-left: 0;
    padding-top: calc(48px + 1.25rem); /* top bar height + breathing room */
  }
}

/* Tablet drawer (sidebar in overlay mode) */
.sidebar--drawer {
  position: fixed;
  top: 0;
  left: 0;
  height: 100dvh;
  z-index: 200;
  transform: translateX(-100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  width: var(--sidebar-width); /* 260px */
}

.sidebar--drawer.sidebar--open {
  transform: translateX(0);
}

/* Backdrop */
.tablet-drawer-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 199;
}

@media (min-width: 768px) and (max-width: 1100px) {
  .tablet-drawer-backdrop.visible {
    display: block;
  }
}

/* Top bar */
.tablet-top-bar {
  display: none; /* shown via media query above */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  z-index: 150;
  align-items: center;
  padding: 0 1rem;
  background: var(--surface-main);
  border-bottom: 1px solid var(--border-color);
  gap: 0.75rem;
}

[data-theme="dark"] .tablet-top-bar {
  background: var(--sidebar-bg);
}
```

## Behaviour Rules

| Action | Result |
|---|---|
| Tap hamburger | Drawer slides in from left |
| Tap nav group (e.g. Gestão) | Expands sub-items — drawer stays open |
| Tap sub-item (e.g. Entregas) | Navigate + drawer closes |
| Tap backdrop | Drawer closes, no navigation |
| Press Escape | Drawer closes, no navigation |
| Resize to >1100px | `isTablet` → false, drawer auto-closes, desktop sidebar visible |
| Resize to <768px | `isTablet` → false, bottom pill nav shown |

## Out of Scope

- Desktop sidebar (>1100px) — untouched
- Mobile bottom pill nav (<768px) — untouched
- Nav data, routes, role-based filtering — no changes
- Any page-level layout changes beyond `margin-left` and `padding-top`
