# Portal Loading Skeleton

**Date:** 2026-04-06
**Status:** Approved

## Problem

`PortalPage.tsx` renders a centered spinner + "Carregando…" while the `portal-data` edge function loads. When the function is slow (2–5s), clients see a blank screen with a spinner and no sense of what is coming. This feels broken.

## Solution

Replace the `if (loading) return <Spinner>` block with a `PortalSkeleton` component that renders a structural skeleton matching the page's visual hierarchy.

## Layout

The skeleton renders the full page shell in loading state:

1. **Shimmer header** — same `.portal-header` container with two shimmer blocks: logo area (left) and badge area (right). Header shimmers because workspace name/logo is not available until data loads.

2. **Shimmer hero card** — `.portal-hero.card` shape with:
   - Status badge block (pill shape)
   - Title block (~65% width)
   - Subtitle block (~40% width)
   - Progress bar (label row + bar track)

3. **Spinner + label below** — a small centered spinner with the label "Carregando etapas e conteúdos…" for the timeline and posts sections. These sections are not skeletonized individually.

No timeout messaging. No conditional behavior based on elapsed time. Purely visual.

## Components

### `PortalSkeleton` (inline in `PortalPage.tsx`)

A small functional component defined in the same file, not exported. Used only in the `if (loading)` branch. No props.

```tsx
function PortalSkeleton() {
  return (
    <div className="portal-page">
      <header className="portal-header">
        <div className="portal-header-inner">
          <div className="portal-skeleton-block" style={{ width: 120, height: 28 }} />
          <div className="portal-skeleton-block" style={{ width: 72, height: 22, borderRadius: 999 }} />
        </div>
      </header>
      <main className="portal-main">
        <section className="portal-hero card">
          <div className="portal-skeleton-block" style={{ width: 86, height: 20, borderRadius: 999 }} />
          <div className="portal-skeleton-block" style={{ width: '65%', height: 28, marginTop: 12 }} />
          <div className="portal-skeleton-block" style={{ width: '40%', height: 16, marginTop: 8 }} />
          <div className="portal-skeleton-progress">
            <div className="portal-skeleton-block" style={{ width: 60, height: 13 }} />
            <div className="portal-skeleton-block" style={{ width: 75, height: 13 }} />
          </div>
          <div className="portal-skeleton-block" style={{ width: '100%', height: 8, borderRadius: 4 }} />
        </section>
        <div className="portal-skeleton-spinner">
          <Spinner size="sm" />
          <span>Carregando etapas e conteúdos…</span>
        </div>
      </main>
    </div>
  );
}
```

## CSS

New classes added to `style.css` alongside existing `.portal-*` rules:

```css
@keyframes portal-shimmer {
  0%   { background-position: -600px 0; }
  100% { background-position:  600px 0; }
}

.portal-skeleton-block {
  border-radius: 6px;
  background: linear-gradient(90deg, var(--skeleton-base) 25%, var(--skeleton-highlight) 50%, var(--skeleton-base) 75%);
  background-size: 600px 100%;
  animation: portal-shimmer 1.4s infinite linear;
}

.portal-skeleton-progress {
  display: flex;
  justify-content: space-between;
  margin: 12px 0 6px;
}

.portal-skeleton-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}
```

CSS variables `--skeleton-base` and `--skeleton-highlight` should be defined in the existing `:root` block (and dark mode override if applicable):

```css
:root {
  --skeleton-base: #e8e8e8;
  --skeleton-highlight: #f5f5f5;
}
```

## Files Changed

| File | Change |
|------|--------|
| `src/pages/portal/PortalPage.tsx` | Add `PortalSkeleton` component; replace `if (loading)` spinner return with `<PortalSkeleton />` |
| `style.css` | Add `@keyframes portal-shimmer`, `.portal-skeleton-block`, `.portal-skeleton-progress`, `.portal-skeleton-spinner`, and CSS variables |

## Out of Scope

- Dark mode skeleton colors (can be added later via CSS variable override)
- Skeletonizing individual timeline or post items
- Any timeout or "slow connection" messaging
