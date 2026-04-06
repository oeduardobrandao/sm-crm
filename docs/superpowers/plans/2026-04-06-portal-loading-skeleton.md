# Portal Loading Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain spinner on `PortalPage` with a structural skeleton (shimmer header + hero card + spinner below) so clients see meaningful page structure while the edge function loads.

**Architecture:** Add a `PortalSkeleton` functional component inline in `PortalPage.tsx` that mirrors the real page shell. CSS shimmer animation and skeleton utility classes go into `style.css` next to the existing `.portal-*` rules. No new files.

**Tech Stack:** React (TSX), vanilla CSS (no CSS-in-JS, no Tailwind for portal styles — the portal uses hand-written `.portal-*` classes in `style.css`)

---

## File Map

| File | Change |
|------|--------|
| `style.css` | Add `--skeleton-base`/`--skeleton-highlight` CSS vars to `:root`; add `@keyframes portal-shimmer`, `.portal-skeleton-block`, `.portal-skeleton-progress`, `.portal-skeleton-spinner` |
| `src/pages/portal/PortalPage.tsx` | Add `PortalSkeleton` component above `PortalPage`; replace `if (loading)` spinner JSX with `<PortalSkeleton />` |

---

### Task 1: Add skeleton CSS to `style.css`

**Files:**
- Modify: `style.css` (after the `.portal-loading` block, around line 3679)

- [ ] **Step 1: Locate insertion point**

Open `style.css`. Find the `.portal-loading` block (currently around line 3668). The new CSS goes right after the closing `}` of `.portal-error-card p { ... }` block (around line 3695), before the `/* Header */` comment.

- [ ] **Step 2: Add CSS variables to `:root`**

Find the `:root` block at line 66 of `style.css`. Add these two lines inside it, after the existing `--border-color` line:

```css
  --skeleton-base: #e8e8e8;
  --skeleton-highlight: #f5f5f5;
```

- [ ] **Step 3: Add shimmer keyframe and skeleton classes**

Insert the following block in `style.css` after the `.portal-error-card p` rule and before the `/* Header */` comment:

```css
/* Skeleton */
@keyframes portal-shimmer {
  0%   { background-position: -600px 0; }
  100% { background-position:  600px 0; }
}

.portal-skeleton-block {
  display: block;
  border-radius: 6px;
  background: linear-gradient(
    90deg,
    var(--skeleton-base) 25%,
    var(--skeleton-highlight) 50%,
    var(--skeleton-base) 75%
  );
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

- [ ] **Step 4: Verify visually**

Open the browser and navigate to any portal URL (e.g. with a fake token — it will error, but the page will load). Temporarily change `const [loading, setLoading] = useState(true)` to stay `true` to inspect the skeleton. Confirm shimmer animation is visible. Revert that change before committing.

- [ ] **Step 5: Commit**

```bash
git add style.css
git commit -m "feat: add portal skeleton CSS (shimmer keyframe + utility classes)"
```

---

### Task 2: Add `PortalSkeleton` component and wire it up

**Files:**
- Modify: `src/pages/portal/PortalPage.tsx`

- [ ] **Step 1: Add `PortalSkeleton` above `PortalPage`**

In `src/pages/portal/PortalPage.tsx`, insert the following function before the `export default function PortalPage()` declaration (around line 97):

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
          <div className="portal-skeleton-block" style={{ width: '40%', height: 16, marginTop: 8, marginBottom: 0 }} />
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

- [ ] **Step 2: Replace the loading return**

Find the existing loading guard in `PortalPage` (lines 236–243):

```tsx
  if (loading) {
    return (
      <div className="portal-loading">
        <Spinner size="lg" />
        <p>Carregando...</p>
      </div>
    );
  }
```

Replace it with:

```tsx
  if (loading) {
    return <PortalSkeleton />;
  }
```

- [ ] **Step 3: Verify**

Run the dev server (`npm run dev` or `pnpm dev`). Open a portal URL. While it loads you should see the shimmer header + hero card skeleton + spinner with label. After load, the real portal renders normally. Confirm no TypeScript errors in the console.

- [ ] **Step 4: Commit**

```bash
git add src/pages/portal/PortalPage.tsx
git commit -m "feat: replace portal spinner with structural skeleton on load"
```
