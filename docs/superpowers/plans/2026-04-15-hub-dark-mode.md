# Hub Dark Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual dark mode toggle to the client hub, persisted in `localStorage`, applied via `data-theme="dark"` on `.hub-root`.

**Architecture:** A `useTheme` hook reads/writes `localStorage` and toggles `data-theme="dark"` on the `.hub-root` element. All dark styles are added as a single CSS block in `index.html` scoped under `.hub-root[data-theme="dark"]`. A Sun/Moon toggle button is added to both the desktop and mobile nav bars in `HubNav`.

**Tech Stack:** React, TypeScript, Tailwind CSS (existing), lucide-react (existing), localStorage

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/hub/src/hooks/useTheme.ts` | Create | Theme state: read/write localStorage, toggle `data-theme` attribute |
| `apps/hub/src/shell/HubNav.tsx` | Modify | Add toggle button to desktop + mobile top bars |
| `apps/hub/index.html` | Modify | Add `[data-theme="dark"]` CSS overrides block |

---

### Task 1: Create `useTheme` hook

**Files:**
- Create: `apps/hub/src/hooks/useTheme.ts`

- [ ] **Step 1: Create the hook file**

```typescript
// apps/hub/src/hooks/useTheme.ts
import { useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'hub-theme';

function applyTheme(theme: Theme) {
  const root = document.querySelector('.hub-root');
  if (!root) return;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch { /* storage unavailable */ }
  }, [theme]);

  function toggleTheme() {
    setTheme(t => t === 'light' ? 'dark' : 'light');
  }

  return { theme, toggleTheme };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub/src/hooks/useTheme.ts
git commit -m "feat(hub): add useTheme hook with localStorage persistence"
```

---

### Task 2: Add toggle button to `HubNav`

**Files:**
- Modify: `apps/hub/src/shell/HubNav.tsx`

- [ ] **Step 1: Add `Sun` and `Moon` imports and call `useTheme`**

At the top of [apps/hub/src/shell/HubNav.tsx](apps/hub/src/shell/HubNav.tsx), change the lucide-react import line from:

```typescript
import { Home, CheckSquare, Palette, FileText, BookOpen, LayoutList } from 'lucide-react';
```

to:

```typescript
import { Home, CheckSquare, Palette, FileText, BookOpen, LayoutList, Sun, Moon } from 'lucide-react';
```

Add the useTheme import after the existing imports:

```typescript
import { useTheme } from '../hooks/useTheme';
```

- [ ] **Step 2: Call `useTheme` inside `HubNav`**

Inside `HubNav()`, after the existing hooks, add:

```typescript
const { theme, toggleTheme } = useTheme();
```

- [ ] **Step 3: Add toggle button to the desktop header**

In the desktop `<header>`, the last element is:
```tsx
<span className="ml-auto text-[13px] text-stone-400">{bootstrap.cliente_nome}</span>
```

Replace it with:
```tsx
<span className="ml-auto flex items-center gap-3">
  <span className="text-[13px] text-stone-400">{bootstrap.cliente_nome}</span>
  <button
    onClick={toggleTheme}
    aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
    className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
  >
    {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
  </button>
</span>
```

- [ ] **Step 4: Add toggle button to the mobile top bar**

In the mobile `<header>`, the last element is:
```tsx
<span className="text-[11px] text-stone-400 truncate max-w-[40%]">{bootstrap.cliente_nome}</span>
```

Replace it with:
```tsx
<span className="flex items-center gap-2">
  <span className="text-[11px] text-stone-400 truncate max-w-[120px]">{bootstrap.cliente_nome}</span>
  <button
    onClick={toggleTheme}
    aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
    className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
  >
    {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
  </button>
</span>
```

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/shell/HubNav.tsx
git commit -m "feat(hub): add dark mode toggle button to desktop and mobile nav"
```

---

### Task 3: Add dark mode CSS overrides to `index.html`

**Files:**
- Modify: `apps/hub/index.html`

- [ ] **Step 1: Append the dark mode CSS block inside the `<style>` tag**

In [apps/hub/index.html](apps/hub/index.html), find the closing `</style>` tag and insert the following block immediately before it:

```css
      /* ── Dark mode ─────────────────────────────────────────── */
      .hub-root[data-theme="dark"] {
        background-color: #111110;
        color: #E7E5E4;
      }
      .hub-root[data-theme="dark"] .hub-noise {
        background-image:
          radial-gradient(1200px 600px at 10% -10%, rgba(255, 191, 48, 0.04), transparent 60%),
          radial-gradient(900px 500px at 110% 10%, rgba(0,0,0,0.15), transparent 60%);
      }
      /* Cards */
      .hub-root[data-theme="dark"] .hub-card {
        background-color: #1C1917;
        border-color: rgba(68, 64, 60, 0.8);
        box-shadow: none;
      }
      .hub-root[data-theme="dark"] .hub-card-hover:hover {
        border-color: rgba(87, 83, 78, 1);
        box-shadow: 0 6px 16px -8px rgba(0,0,0,0.4);
      }
      /* Mobile bottom tab bar */
      .hub-root[data-theme="dark"] nav.fixed {
        background-color: rgba(12, 10, 9, 0.95);
        border-top-color: rgba(68, 64, 60, 0.8);
      }
      /* Spinners */
      .hub-root[data-theme="dark"] .border-stone-300 { border-color: rgb(68 64 60); }
      /* Muted text */
      .hub-root[data-theme="dark"] .text-stone-900 { color: #E7E5E4; }
      .hub-root[data-theme="dark"] .text-stone-800 { color: #D6D3D1; }
      .hub-root[data-theme="dark"] .text-stone-600 { color: #A8A29E; }
      .hub-root[data-theme="dark"] .text-stone-500 { color: #78716C; }
      /* PostCard: expanded body */
      .hub-root[data-theme="dark"] .bg-stone-50\/30 { background-color: rgba(28,25,23,0.5); }
      .hub-root[data-theme="dark"] .hover\:bg-stone-50\/80:hover { background-color: rgba(41,37,36,0.5); }
      /* bg-stone-100 used for chevron btn, calendar nav arrows bg, reaction pills */
      .hub-root[data-theme="dark"] .bg-stone-100 { background-color: #292524; }
      .hub-root[data-theme="dark"] .hover\:bg-stone-100:hover { background-color: #292524; }
      .hub-root[data-theme="dark"] .hover\:bg-stone-100\/80:hover { background-color: rgba(41,37,36,0.6); }
      /* PostCard: property box (bg-white inside expanded area) */
      .hub-root[data-theme="dark"] .border-stone-200\/80 { border-color: rgba(68,64,60,0.8); }
      .hub-root[data-theme="dark"] .border-stone-200\/70 { border-color: rgba(68,64,60,0.7); }
      /* Inputs and textareas */
      .hub-root[data-theme="dark"] input:not([type="checkbox"]),
      .hub-root[data-theme="dark"] textarea {
        background-color: #1C1917;
        color: #E7E5E4;
        border-color: rgba(68,64,60,0.8);
      }
      .hub-root[data-theme="dark"] input::placeholder,
      .hub-root[data-theme="dark"] textarea::placeholder { color: #78716c; }
      /* bg-white surfaces used in PostCard, Calendar side panel items, MarcaPage, etc. */
      .hub-root[data-theme="dark"] .bg-white { background-color: #1C1917; }
      .hub-root[data-theme="dark"] .hover\:bg-white:hover { background-color: #292524; }
      /* PostCalendar: side panel */
      .hub-root[data-theme="dark"] .bg-stone-50\/70 { background-color: rgba(28,25,23,0.7); }
      /* Calendar day hover */
      .hub-root[data-theme="dark"] .hover\:bg-stone-100\/80:hover { background-color: rgba(41,37,36,0.6); }
      /* IdeiaModal backdrop — keep dark overlay, lighten modal card via bg-white rule above */
      .hub-root[data-theme="dark"] .hover\:bg-stone-50:hover { background-color: #292524; }
      .hub-root[data-theme="dark"] .hover\:bg-red-50:hover { background-color: rgba(127,29,29,0.15); }
      /* Briefing textarea focus bg */
      .hub-root[data-theme="dark"] .focus\:bg-white:focus { background-color: #1C1917; }
      /* BriefingPage tabs border */
      .hub-root[data-theme="dark"] .border-b { border-bottom-color: rgba(68,64,60,0.8); }
      /* Dividers */
      .hub-root[data-theme="dark"] .divide-stone-200\/80 > * + * { border-color: rgba(68,64,60,0.8); }
      .hub-root[data-theme="dark"] .border-stone-100 { border-color: rgba(68,64,60,0.5); }
      /* PostagensPage workflow group divider line */
      .hub-root[data-theme="dark"] .bg-stone-300 { background-color: #57534e; }
      /* Status pill overrides to remain readable in dark */
      .hub-root[data-theme="dark"] .bg-stone-100.text-stone-700 {
        background-color: #292524;
        color: #A8A29E;
      }
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub/index.html
git commit -m "feat(hub): add dark mode CSS overrides scoped to [data-theme=dark]"
```

---

### Task 4: Verify visually

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/eduardosouza/Projects/sm-crm/apps/hub
npm run dev
```

- [ ] **Step 2: Open the hub in a browser**

Navigate to a valid hub URL (e.g. `http://localhost:5173/<workspace>/hub/<token>`).

- [ ] **Step 3: Manually check each page in dark mode**

Toggle dark mode via the Sun/Moon button. Verify on each page:

| Page | Things to check |
|---|---|
| Home | Cards readable, hero text readable, calendar surfaces dark |
| Aprovações | PostCards dark, status pills readable, approval buttons visible |
| Postagens | Expanded PostCard body dark, inputs dark, comment bubbles dark |
| Marca | Color swatches readable, file rows dark |
| Briefing | Tabs dark, textareas dark, save status visible |
| Ideias | Cards dark, modal bg dark, inputs dark |

- [ ] **Step 4: Toggle back to light and verify no regressions**

Light mode should look identical to before.

- [ ] **Step 5: Refresh page and verify preference persists**

Reload — dark mode should still be active.
