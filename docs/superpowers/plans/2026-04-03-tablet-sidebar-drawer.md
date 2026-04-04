# Tablet Sidebar Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On 768–1100px screens (iPad landscape, small laptops), hide the always-visible sidebar and replace it with a hamburger-triggered slide-over drawer that renders the exact same desktop sidebar content.

**Architecture:** `AppLayout` gains `isTablet` + `drawerOpen` state and renders a new `TabletTopBar` component at that breakpoint. `Sidebar` gains `isDrawer / isOpen / onClose` props — when `isDrawer=true` it behaves as a left-side overlay instead of a fixed panel. CSS removes the broken 901–1100px icon-rail breakpoint and adds the new 768–1100px drawer rules.

**Tech Stack:** React (with hooks), React Router v6, TypeScript, plain CSS custom properties, Phosphor Icons (`@phosphor-icons/web`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/components/layout/TabletTopBar.tsx` | **Create** | Fixed 48px bar with logo + hamburger, shown only on tablet |
| `src/components/layout/AppLayout.tsx` | **Modify** | Add `isTablet`, `drawerOpen` state; render `TabletTopBar` + backdrop |
| `src/components/layout/Sidebar.tsx` | **Modify** | Accept `isDrawer`, `isOpen`, `onClose` props; slide-in behaviour + Escape key |
| `style.css` | **Modify** | Remove broken icon-rail breakpoint; add drawer, backdrop, top-bar CSS |

---

### Task 1: Remove the broken icon-rail breakpoint from CSS

The `901–1100px` media query that set `--sidebar-width: 64px` and the `.sidebar:hover { width: 220px }` rule reference class names (`.nav-link`, `.logo-container`) that no longer exist in the React sidebar. Removing it is safe and cleans up dead CSS.

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Delete the icon-rail media block**

In `style.css`, find and remove the entire block starting at `/* Small desktop — compress sidebar to 64px rail */` (around line 2137). It looks like:

```css
/* Small desktop — compress sidebar to 64px rail */
@media (min-width: 901px) and (max-width: 1100px) {
  :root {
    --sidebar-width: 64px;
  }

  .sidebar {
    padding: 1.5rem 0.35rem;
  }

  .sidebar:hover {
    width: 220px;
  }

  .nav-link {
    height: 44px;
    border-radius: 14px;
  }

  .nav-link i {
    font-size: 1.2rem;
  }

  .nav-links {
    gap: 0.4rem;
  }

  .logo-container {
    margin-bottom: 1.5rem;
  }

  .sidebar-user {
    width: 44px;
    height: 44px;
    border-radius: 14px;
  }

  .main-content {
    margin-left: calc(var(--sidebar-width) + 0.75rem);
    padding: 1.5rem 1.25rem;
  }

  .header {
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .header-title h1 {
    font-size: 1.5rem;
  }

  .data-table th {
    padding: 0.6rem 0.5rem;
    font-size: 0.6rem;
  }

  .data-table td {
    padding: 0.75rem 0.5rem;
    font-size: 0.78rem;
  }

  .header-actions {
    gap: 0.5rem;
  }

  .header-actions .btn-primary,
  .header-actions .btn-secondary {
    font-size: 0.75rem;
    padding: 0.45rem 0.75rem;
  }

  .search-bar {
    width: 200px;
  }
}
```

Also remove the second `901–1100px` block immediately after (the grid adjustments one):

```css
/* Tablet/small-desktop grid adjustments */
@media (min-width: 901px) and (max-width: 1100px) {
  .widgets-grid {
    grid-template-columns: 1fr;
  }

  .integrations-grid {
    grid-template-columns: 1fr;
  }

  .kpi-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .dashboard-hub {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

Also remove the `.sidebar-label` block and its associated `@media (min-width: 901px)` hover rule (around line 1447–1459):

```css
.sidebar-label {
  font-size: 0;
  transition: font-size 0.25s ease, color 0.25s ease;
  white-space: nowrap;
  overflow: hidden;
  color: #94a3b8;
}

@media (min-width: 901px) {
  .sidebar:hover .sidebar-label {
    font-size: 0.85rem;
  }
}
```

- [ ] **Step 2: Verify desktop still looks correct**

Open the app at >1100px width. Sidebar should show at full 260px with labels visible. No visual regression.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "refactor: remove broken 901-1100px icon-rail sidebar breakpoint"
```

---

### Task 2: Add tablet drawer CSS

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Add the tablet breakpoint block**

Append the following to the end of `style.css` (before any final closing comments if any):

```css
/* ===== Tablet Sidebar Drawer (768–1100px) ===== */

/* Top bar — hidden by default, shown on tablet */
.tablet-top-bar {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  z-index: 150;
  align-items: center;
  padding: 0 1rem;
  gap: 0.75rem;
  background: var(--surface-main);
  border-bottom: 1px solid var(--border-color);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

[data-theme="dark"] .tablet-top-bar {
  background: var(--sidebar-bg);
}

.tablet-top-bar-logo {
  height: 16px;
  width: auto;
  object-fit: contain;
  opacity: 0.85;
}

.tablet-top-bar-logo.logo-light { display: inline; }
.tablet-top-bar-logo.logo-dark  { display: none; }
[data-theme="dark"] .tablet-top-bar-logo.logo-light { display: none; }
[data-theme="dark"] .tablet-top-bar-logo.logo-dark  { display: inline; }

.tablet-hamburger {
  margin-left: auto;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--text-main);
  transition: background var(--transition);
}

.tablet-hamburger:hover {
  background: var(--surface-hover);
}

/* Drawer backdrop */
.tablet-drawer-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 199;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.tablet-drawer-backdrop.visible {
  opacity: 1;
}

/* Sidebar in drawer mode */
.sidebar--drawer {
  transform: translateX(-100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 200;
}

.sidebar--drawer.sidebar--open {
  transform: translateX(0);
}

@media (min-width: 768px) and (max-width: 1100px) {
  /* Hide desktop sidebar and mobile bottom nav */
  .sidebar {
    display: flex !important; /* override the <900px display:none */
  }

  .mobile-nav {
    display: none !important;
  }

  /* Show tablet top bar */
  .tablet-top-bar {
    display: flex;
  }

  /* Show backdrop when open */
  .tablet-drawer-backdrop {
    display: block;
  }

  /* Full-width content, offset for top bar */
  .main-content {
    margin-left: 0 !important;
    padding-top: calc(48px + 1.25rem) !important;
  }
}
```

- [ ] **Step 2: Verify no syntax errors**

```bash
npx vite build --mode development 2>&1 | grep -i error | head -20
```

Expected: no CSS parse errors. (Build may still emit other warnings — that's fine.)

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: add tablet sidebar drawer CSS (768-1100px)"
```

---

### Task 3: Create TabletTopBar component

**Files:**
- Create: `src/components/layout/TabletTopBar.tsx`

- [ ] **Step 1: Create the component**

```tsx
interface TabletTopBarProps {
  onHamburgerClick: () => void;
}

export default function TabletTopBar({ onHamburgerClick }: TabletTopBarProps) {
  return (
    <div className="tablet-top-bar">
      <img src="/logo-black.svg" className="tablet-top-bar-logo logo-light" alt="Logo" />
      <img src="/logo-white.svg" className="tablet-top-bar-logo logo-dark" alt="Logo" />
      <button
        className="tablet-hamburger"
        onClick={onHamburgerClick}
        aria-label="Abrir menu"
        aria-expanded={false}
      >
        <i className="ph ph-list" style={{ fontSize: '1.4rem' }} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no type errors in `TabletTopBar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/TabletTopBar.tsx
git commit -m "feat: add TabletTopBar component with hamburger button"
```

---

### Task 4: Update Sidebar to support drawer mode

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add props interface and wire them up**

At the top of `Sidebar.tsx`, add the props interface and update the function signature:

```tsx
interface SidebarProps {
  isDrawer?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isDrawer = false, isOpen = false, onClose }: SidebarProps) {
```

- [ ] **Step 2: Add Escape key listener**

Inside the component, after the existing `useEffect` hooks, add:

```tsx
useEffect(() => {
  if (!isDrawer || !isOpen) return;
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose?.();
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [isDrawer, isOpen, onClose]);
```

- [ ] **Step 3: Update handleNavClick to close drawer after navigation**

Find the existing `handleNavClick`:

```tsx
const handleNavClick = (route: string) => {
  navigate(route);
};
```

Replace with:

```tsx
const handleNavClick = (route: string) => {
  navigate(route);
  if (isDrawer) onClose?.();
};
```

- [ ] **Step 4: Apply drawer CSS classes to the nav element**

Find the `<nav>` element at the bottom of the component:

```tsx
<nav className="sidebar" id="sidebar">
```

Replace with:

```tsx
<nav
  className={`sidebar${isDrawer ? ' sidebar--drawer' : ''}${isDrawer && isOpen ? ' sidebar--open' : ''}`}
  id="sidebar"
>
```

- [ ] **Step 5: Verify it compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat: add isDrawer/isOpen/onClose props to Sidebar"
```

---

### Task 5: Wire everything together in AppLayout

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Replace the full file content**

```tsx
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import TabletTopBar from './TabletTopBar';

function useIsTablet() {
  const [isTablet, setIsTablet] = useState(() => {
    const w = window.innerWidth;
    return w >= 768 && w <= 1100;
  });

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px) and (max-width: 1100px)');
    const handler = (e: MediaQueryListEvent) => setIsTablet(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isTablet;
}

export default function AppLayout() {
  const location = useLocation();
  const isTablet = useIsTablet();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer when leaving tablet range
  useEffect(() => {
    if (!isTablet) setDrawerOpen(false);
  }, [isTablet]);

  // Scroll to top on route change
  useEffect(() => {
    const main = document.getElementById('app');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="app-container">
      {isTablet && (
        <TabletTopBar onHamburgerClick={() => setDrawerOpen(true)} />
      )}

      <Sidebar
        isDrawer={isTablet}
        isOpen={drawerOpen}
        onClose={closeDrawer}
      />

      {isTablet && drawerOpen && (
        <div
          className={`tablet-drawer-backdrop visible`}
          onClick={closeDrawer}
        />
      )}

      <main className="main-content" id="app">
        <div className="app-logo-bar">
          <img src="/logo-black.svg" className="app-logo logo-light" alt="Logo" />
          <img src="/logo-white.svg" className="app-logo logo-dark" alt="Logo" />
        </div>
        <Outlet />
      </main>

      <MobileNav />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no type errors.

- [ ] **Step 3: Start dev server and test on tablet width**

```bash
npm run dev
```

Open browser, set DevTools to iPad landscape (1024×768). Verify:
- Top bar with logo and hamburger visible
- No sidebar visible by default
- Content fills full width with 4 Kanban columns visible

- [ ] **Step 4: Test drawer open/close**

- Tap/click hamburger → sidebar slides in from left with full labels and groups
- Tap a nav item (e.g. Clientes sub-item) → navigates + drawer closes
- Tap hamburger again → sidebar opens
- Tap backdrop → drawer closes without navigating
- Press Escape → drawer closes

- [ ] **Step 5: Test desktop (>1100px)**

Resize to 1200px+ — sidebar should be always visible at 260px, no top bar, no drawer behavior.

- [ ] **Step 6: Test mobile (<768px)**

Resize to 375px — top bar hidden, floating bottom pill nav visible, sidebar hidden.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/AppLayout.tsx
git commit -m "feat: wire tablet drawer in AppLayout with useIsTablet hook"
```

---

### Task 6: Fix TabletTopBar aria-expanded

The `aria-expanded` on the hamburger button should reflect the actual drawer state, but `TabletTopBar` currently doesn't know if the drawer is open. Update it to accept and reflect this.

**Files:**
- Modify: `src/components/layout/TabletTopBar.tsx`

- [ ] **Step 1: Update the component**

```tsx
interface TabletTopBarProps {
  onHamburgerClick: () => void;
  drawerOpen: boolean;
}

export default function TabletTopBar({ onHamburgerClick, drawerOpen }: TabletTopBarProps) {
  return (
    <div className="tablet-top-bar">
      <img src="/logo-black.svg" className="tablet-top-bar-logo logo-light" alt="Logo" />
      <img src="/logo-white.svg" className="tablet-top-bar-logo logo-dark" alt="Logo" />
      <button
        className="tablet-hamburger"
        onClick={onHamburgerClick}
        aria-label={drawerOpen ? 'Fechar menu' : 'Abrir menu'}
        aria-expanded={drawerOpen}
        aria-controls="sidebar"
      >
        <i className={`ph ${drawerOpen ? 'ph-x' : 'ph-list'}`} style={{ fontSize: '1.4rem' }} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Update AppLayout to pass drawerOpen**

In `AppLayout.tsx`, find:

```tsx
{isTablet && (
  <TabletTopBar onHamburgerClick={() => setDrawerOpen(true)} />
)}
```

Replace with:

```tsx
{isTablet && (
  <TabletTopBar
    onHamburgerClick={() => setDrawerOpen(v => !v)}
    drawerOpen={drawerOpen}
  />
)}
```

Note: changed to toggle (`v => !v`) so the hamburger also closes the drawer if tapped again.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no type errors.

- [ ] **Step 4: Test toggle behaviour**

At 1024px width: tap hamburger → drawer opens (icon changes to ✕). Tap hamburger again → drawer closes.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/TabletTopBar.tsx src/components/layout/AppLayout.tsx
git commit -m "fix: hamburger toggles drawer and reflects open state via aria-expanded"
```

---

## Self-Review

**Spec coverage:**
- ✅ Breakpoint 768–1100px — Task 2 CSS
- ✅ Sidebar hidden at tablet — Task 2 CSS
- ✅ Mobile nav hidden at tablet — Task 2 CSS
- ✅ Top bar with hamburger — Tasks 3 + 5
- ✅ Drawer = exact desktop sidebar — Tasks 4 + 5 (same component, `isDrawer` prop)
- ✅ Tap nav item → navigate + close — Task 4 Step 3
- ✅ Tap backdrop → close — Task 5 Step 1
- ✅ Escape → close — Task 4 Step 2
- ✅ Resize to >1100px → auto-close — Task 5 Step 1 (`useEffect` on `isTablet`)
- ✅ Resize to <768px → bottom pill takes over — Task 2 CSS
- ✅ Remove broken 901–1100px icon-rail — Task 1

**Placeholder scan:** All steps have explicit code blocks and exact commands. No TBDs.

**Type consistency:**
- `SidebarProps`: `isDrawer`, `isOpen`, `onClose` — used consistently in Tasks 4 and 5
- `TabletTopBarProps`: `onHamburgerClick`, `drawerOpen` — defined in Task 3, updated in Task 6, consumed in Task 5
- CSS classes: `sidebar--drawer`, `sidebar--open`, `tablet-top-bar`, `tablet-drawer-backdrop`, `tablet-hamburger` — defined in Task 2, applied in Tasks 3, 4, 5
