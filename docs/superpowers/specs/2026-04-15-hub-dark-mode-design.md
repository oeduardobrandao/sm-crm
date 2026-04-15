# Hub Dark Mode — Design Spec

**Date:** 2026-04-15
**Status:** Approved

---

## Overview

Add a manual dark mode toggle to the client hub (`apps/hub`). The user's preference is persisted in `localStorage` and applied via a `data-theme="dark"` attribute on `.hub-root`. All dark styles are scoped under `.hub-root[data-theme="dark"]` in `index.html` — no Tailwind config changes, no edits to React component files except `HubNav`.

---

## Architecture

### `apps/hub/src/hooks/useTheme.ts` (new file)

- Reads initial theme from `localStorage` key `hub-theme` (`'light'` | `'dark'`), defaults to `'light'`
- On mount and on change, sets/removes `data-theme="dark"` on the `.hub-root` element (`document.querySelector('.hub-root')`)
- Writes updated value to `localStorage` on toggle
- Returns `{ theme: 'light' | 'dark', toggleTheme: () => void }`

### `apps/hub/src/shell/HubNav.tsx`

- Calls `useTheme()` directly (same `localStorage` key — no prop drilling needed)
- Adds a `Sun` / `Moon` (lucide-react) icon button to:
  - **Desktop header** — right end, after the client name
  - **Mobile top bar** — right end, replacing or alongside the client name
- Button style: `w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition-colors`

---

## Dark Token Overrides — `index.html` `<style>` block

All rules added inside a single `[data-theme="dark"]` block appended to the existing `<style>` tag.

### Root surface

```css
.hub-root[data-theme="dark"] {
  background-color: #111110;
  color: #E7E5E4;
}
```

### Noise/gradient overlay

```css
.hub-root[data-theme="dark"] .hub-noise {
  background-image:
    radial-gradient(1200px 600px at 10% -10%, rgba(255, 191, 48, 0.04), transparent 60%),
    radial-gradient(900px 500px at 110% 10%, rgba(0,0,0,0.15), transparent 60%);
}
```

### Cards

```css
.hub-root[data-theme="dark"] .hub-card {
  background-color: #1C1917;
  border-color: rgba(68, 64, 60, 0.8);
  box-shadow: none;
}
.hub-root[data-theme="dark"] .hub-card-hover:hover {
  border-color: rgba(87, 83, 78, 1);
  box-shadow: 0 6px 16px -8px rgba(0,0,0,0.4);
}
```

---

## Component-Level Dark Overrides — `index.html`

Scoped under `.hub-root[data-theme="dark"]`. These cover hardcoded Tailwind classes that tokens alone can't reach.

### Navigation

```css
/* Mobile bottom tab bar */
.hub-root[data-theme="dark"] nav.fixed {
  background-color: rgba(12, 10, 9, 0.95);
  border-top-color: rgba(68, 64, 60, 0.8);
}
```

### Spinners

```css
.hub-root[data-theme="dark"] .border-stone-300 {
  border-color: rgb(68 64 60);
}
```

### PostCard

```css
/* Expand body background */
.hub-root[data-theme="dark"] .bg-stone-50\/30 { background-color: rgba(28,25,23,0.5); }

/* Header row hover */
.hub-root[data-theme="dark"] .hover\:bg-stone-50\/80:hover { background-color: rgba(41,37,36,0.5); }

/* Chevron active bg */
.hub-root[data-theme="dark"] .bg-stone-100 { background-color: #292524; }

/* Property box */
.hub-root[data-theme="dark"] .rounded-2xl.border.bg-white { background-color: #111110; border-color: rgba(68,64,60,0.8); }

/* Comment bubbles */
.hub-root[data-theme="dark"] .bg-white.ring-1 { background-color: #1C1917; }

/* Input / textarea */
.hub-root[data-theme="dark"] input,
.hub-root[data-theme="dark"] textarea {
  background-color: #1C1917;
  color: #E7E5E4;
  border-color: rgba(68,64,60,0.8);
}
.hub-root[data-theme="dark"] input::placeholder,
.hub-root[data-theme="dark"] textarea::placeholder { color: #78716c; }

/* Correction request button */
.hub-root[data-theme="dark"] .border.bg-white.text-stone-800 {
  background-color: #1C1917;
  color: #E7E5E4;
  border-color: rgba(68,64,60,0.8);
}
```

### PostCalendar

```css
/* Side panel */
.hub-root[data-theme="dark"] .bg-stone-50\/70 { background-color: rgba(28,25,23,0.7); }
.hub-root[data-theme="dark"] .border-stone-200\/80 { border-color: rgba(68,64,60,0.8); }

/* Nav arrows container */
.hub-root[data-theme="dark"] .bg-stone-100.rounded-full { background-color: #292524; }
.hub-root[data-theme="dark"] .hover\:bg-white:hover { background-color: #3c3835; }

/* Day hover */
.hub-root[data-theme="dark"] .hover\:bg-stone-100\/80:hover { background-color: rgba(41,37,36,0.6); }

/* Side panel post items */
.hub-root[data-theme="dark"] .bg-white.p-3\.5 { background-color: #1C1917; }
```

### BriefingPage tabs

```css
.hub-root[data-theme="dark"] .border-b.border-stone-200\/80 { border-color: rgba(68,64,60,0.8); }
.hub-root[data-theme="dark"] .text-stone-500.hover\:text-stone-700:hover { color: #D6D3D1; }
```

### IdeiaModal

```css
.hub-root[data-theme="dark"] .fixed.inset-0.z-50 .bg-white {
  background-color: #1C1917;
  color: #E7E5E4;
}
.hub-root[data-theme="dark"] .fixed.inset-0.z-50 .border-stone-200 { border-color: rgba(68,64,60,0.8); }
.hub-root[data-theme="dark"] .fixed.inset-0.z-50 .hover\:bg-stone-100:hover { background-color: #292524; }
.hub-root[data-theme="dark"] .fixed.inset-0.z-50 .hover\:bg-stone-50:hover { background-color: #292524; }
```

### MarcaPage color swatches

```css
.hub-root[data-theme="dark"] .bg-white.flex.items-center.gap-4 {
  background-color: #1C1917;
  border-color: rgba(68,64,60,0.8);
}
```

---

## Files Changed

| File | Change |
|---|---|
| `apps/hub/index.html` | Add `[data-theme="dark"]` CSS block to `<style>` |
| `apps/hub/src/hooks/useTheme.ts` | New file — theme hook |
| `apps/hub/src/shell/HubNav.tsx` | Call `useTheme()`, add toggle button to desktop + mobile bars |

No other files touched.

---

## Out of Scope

- System preference (`prefers-color-scheme`) auto-detection — not requested
- CRM app dark mode — separate concern, separate style.css
