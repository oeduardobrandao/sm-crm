# Top Bar Design Spec

**Date:** 2026-04-29
**Branch:** ebs/notification-center

## Overview

Add a full-width dark top bar to the CRM app, inspired by Shopify's admin. The bar spans the entire viewport width above both the sidebar and content area. It holds the app logo, a global search trigger, notification and Crisp chat buttons, and an embedded loading progress bar. The content area below gets a curved top-left corner.

## Goals

- Provide a persistent home for global actions (search, notifications, chat) without crowding the sidebar
- Unify the app chrome with a polished, Shopify-style top bar
- Replace the existing `TabletTopBar` with the new bar across breakpoints
- Embed a loading indicator that surfaces both route transitions and data fetching

## Non-Goals

- Notification center panel (the bell is a placeholder — panel designed separately)
- Global search results/logic (the trigger opens the existing `cmdk` CommandDialog)
- Changes to the Hub app

## Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│  LOGO          [🔍 Buscar...            ⌘K]    🔔 💬   │ ← TopBar (52px, fixed)
│  ─────────────────── loading bar (2px) ───────────────  │
├────────────┬────────────────────────────────────────────┤
│  Dashboard │ ╭──────────────────────────────────────    │
│  Clientes  │ │                                         │
│  Financeiro│ │  Page content                           │
│  Contratos │ │  (border-radius: 16px 0 0 0)            │
│  Equipe    │ │                                         │
│            │ │                                         │
│  ────────  │ │                                         │
│  👤 User   │ │                                         │
└────────────┴────────────────────────────────────────────┘
```

### Dimensions

- **Top bar height**: 52px, stored in CSS variable `--topbar-height`
- **Background**: `#12151a` (same as `--sidebar-bg`), with `border-bottom: 1px solid rgba(255,255,255,0.06)`
- **z-index**: Above sidebar (sidebar is `z-index: 100`, top bar uses `z-index: 110`)
- **Sidebar**: Adjusts to `top: var(--topbar-height)` and `height: calc(100dvh - var(--topbar-height))`
- **Content area**: `border-radius: 16px 0 0 0` on top-left, background `--bg-color`

### Three zones

| Zone | Alignment | Width | Contents |
|------|-----------|-------|----------|
| Left | flex-start | `var(--sidebar-width)` | App logo (light/white variant) |
| Center | center | flex: 1 | `GlobalSearchTrigger` |
| Right | flex-end | auto | `TopBarActions` (notification + Crisp) |

The left zone matches the sidebar width so the logo sits visually above the sidebar.

## New Components

### `TopBar.tsx`

**Path:** `apps/crm/src/components/layout/TopBar.tsx`

Pure layout shell. Renders a `<header>` with three zones. No state management. The `NavigationProgress` component renders inside it at the bottom edge.

```tsx
<header className="topbar">
  <div className="topbar-left">
    <img src="/logo-white.svg" alt="Mesaas" />
  </div>
  <div className="topbar-center">
    <GlobalSearchTrigger />
  </div>
  <div className="topbar-right">
    <TopBarActions />
  </div>
  <NavigationProgress />
</header>
```

### `GlobalSearchTrigger.tsx`

**Path:** `apps/crm/src/components/layout/GlobalSearchTrigger.tsx`

A styled button that looks like a search input. Shows a search icon, placeholder text ("Buscar..."), and a `⌘K` keyboard shortcut badge.

**Behavior:**
- On click → opens `CommandDialog` (from existing `cmdk` setup)
- Registers a global `⌘K` / `Ctrl+K` keyboard shortcut to open the dialog
- The dialog itself handles search logic (existing code, not part of this spec)

**Visual:**
- Background: `rgba(255,255,255,0.08)`
- Border: `1px solid rgba(255,255,255,0.1)`
- Border-radius: `8px`
- Min-width: `380px` (desktop), shrinks on smaller screens
- Text color: `rgba(255,255,255,0.35)`
- Hover: background brightens to `rgba(255,255,255,0.12)`

### `TopBarActions.tsx`

**Path:** `apps/crm/src/components/layout/TopBarActions.tsx`

Renders two icon buttons side by side:

**Notification bell:**
- Lucide `Bell` icon
- Shows a small red dot (`--danger` color, 8px diameter) when there are unread notifications
- On click: no-op for now (placeholder for future notification center panel)

**Crisp chat:**
- Lucide `MessageCircle` icon
- Shows a small dot (`--primary-color`, 8px diameter) when there are unread Crisp messages
- On click: calls `window.$crisp.push(["do", "chat:open"])`

**Button style:**
- Size: `34×34px`
- Background: `transparent`, hover: `rgba(255,255,255,0.08)`
- Border-radius: `8px`
- Icon color: `rgba(255,255,255,0.6)`, hover: `rgba(255,255,255,0.9)`
- Gap between buttons: `6px`

### `NavigationProgress.tsx`

**Path:** `apps/crm/src/components/layout/NavigationProgress.tsx`

A 2px loading bar at the bottom edge of the top bar.

**Data sources:**
1. `useLocation()` from React Router — triggers loading on path change. Since pages are lazy-loaded via `React.lazy`, a route change triggers Suspense. The component starts the animation on location change and ends it after a short delay (the Suspense boundary resolves the lazy import). Note: `useNavigation()` is NOT available because the CRM uses `BrowserRouter`, not a data router.
2. `useIsFetching()` from TanStack Query — active when `count > 0`

**States:**
- **Idle**: `opacity: 0`, no animation
- **Loading**: `opacity: 1`, shimmer animation (gradient slides left-to-right via CSS `translateX` keyframes). Triggered by location change OR `isFetching > 0`
- **Completing**: bar fills to `width: 100%` then fades out over 300ms. Triggered when location has settled (after a short debounce) AND `isFetching === 0`

**Visual:**
- Height: `2px`
- Position: `absolute`, `bottom: 0`, `left: 0`, `right: 0`
- Color: `--primary-color` (`#FFBF30`) with gradient shimmer
- Pure CSS animation, no external dependencies

## Changes to Existing Files

### `AppLayout.tsx`

- Add `<TopBar />` as the first child of `.app-container`, before the sidebar
- Remove the `<div className="app-logo-bar">` block from `<main>` (logo moves to top bar)
- Remove the `TabletTopBar` import and rendering (replaced by `TopBar`)
- The top bar renders on both desktop and tablet (≥768px)
- On mobile (<768px), the top bar is hidden

### `Sidebar.tsx`

- Remove the logo/header section at the top of the sidebar (logo now lives in top bar)
- Sidebar content starts directly with nav items

### `style.css`

- Add `--topbar-height: 52px` to `:root`
- Add `.topbar` styles (fixed positioning, flex layout, z-index)
- Adjust `.sidebar`: `top: var(--topbar-height)`, `height: calc(100dvh - var(--topbar-height))`
- Add `border-radius: 16px 0 0 0` to `.main-content` (curved top-left)
- Adjust `.main-content`: `margin-top: var(--topbar-height)` (or restructure so the flex container handles it)
- Add `.topbar-*` zone styles
- Add `@keyframes topbar-shimmer` for the loading bar animation
- Mobile breakpoint (<768px): hide `.topbar`, reset sidebar/content positioning

### `MobileNav.tsx`

- Add search trigger, notification, and Crisp buttons to the mobile bottom nav (since top bar is hidden on mobile)

### Crisp Integration

**Hide default widget:** In `AppLayout.tsx` `useEffect`, call:
```ts
window.$crisp?.push(["do", "chat:hide"])
```

**Unread listener:** In `TopBarActions.tsx`, set up a Crisp event listener:
```ts
window.$crisp?.push(["on", "message:received", () => setHasUnread(true)])
```
Clear the unread state when the chat is opened:
```ts
window.$crisp?.push(["on", "chat:opened", () => setHasUnread(false)])
```

## Responsive Behavior

| Breakpoint | Top bar | Sidebar | Content corner | Search/Actions |
|-----------|---------|---------|---------------|----------------|
| ≥1100px (desktop) | Full top bar | Fixed left, starts below top bar | Curved top-left | In top bar |
| 768–1100px (tablet) | Full top bar + hamburger on left | Drawer, starts below top bar | Curved top-left | In top bar |
| <768px (mobile) | Hidden | Hidden (bottom nav instead) | No curve | In MobileNav |

On tablet, the left zone of the top bar shows a hamburger icon alongside the logo to toggle the sidebar drawer.

## Dependencies

No new dependencies. Uses:
- `cmdk` (already installed)
- `lucide-react` (already installed, for `Bell`, `MessageCircle`, `Search`, `Menu` icons)
- React Router `useLocation()`
- TanStack Query `useIsFetching()`
- Crisp JS API (already loaded via `index.html`)
