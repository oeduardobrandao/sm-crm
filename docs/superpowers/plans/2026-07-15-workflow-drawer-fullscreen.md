# WorkflowDrawer Fullscreen Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an expand/collapse button to `WorkflowDrawer`'s header that toggles the drawer panel between its normal centered size and a fullscreen (100vw × 100vh) layout, remembering the last-used state in `localStorage`.

**Architecture:** Single `useState` (lazily seeded from `localStorage`) in `WorkflowDrawer` drives a conditional CSS class on the existing `.drawer-panel` element. No new components, no prop drilling — the toggle button and its handler live entirely inside `WorkflowDrawer`.

**Tech Stack:** React 19, `lucide-react` icons, plain CSS (`apps/crm/style.css`).

## Global Constraints

- Icons: `lucide-react` exclusively (per CLAUDE.md code style).
- No linter/formatter configured — typecheck with `npm run build` after the change.
- `localStorage` key: `workflow-drawer-fullscreen`, values `'1'` / `'0'` (per spec).
- No changes to `HistoryDrawer.tsx` or any other drawer.

---

### Task 1: Add fullscreen toggle to WorkflowDrawer

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx:1-18` (icon imports), `:141-163` (state block), `:604-615` (header actions JSX), `:582-583` (drawer-panel div)
- Modify: `apps/crm/style.css:5113-5129` (add new rule immediately after `.drawer-panel`)

**Interfaces:**
- Consumes: nothing new from elsewhere in the file.
- Produces: nothing consumed by other tasks — this is the only task.

- [ ] **Step 1: Add `Maximize2` and `Minimize2` to the lucide-react import**

In `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`, the import block at the top currently reads (lines 6-18):

```ts
import {
  X,
  Plus,
  Trash2,
  Send,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  GripVertical,
  ImageIcon,
  Calendar as CalendarIcon,
  Wand2,
} from 'lucide-react';
```

Change it to:

```ts
import {
  X,
  Plus,
  Trash2,
  Send,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  GripVertical,
  ImageIcon,
  Calendar as CalendarIcon,
  Wand2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
```

- [ ] **Step 2: Add `isFullscreen` state**

In the same file, find this block (around line 161, right after `const [showCalendar, setShowCalendar] = useState(false);`):

```ts
  const [showCalendar, setShowCalendar] = useState(false);
```

Add the new state directly after it:

```ts
  const [showCalendar, setShowCalendar] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(
    () => localStorage.getItem('workflow-drawer-fullscreen') === '1',
  );
```

- [ ] **Step 3: Add the toggle handler**

Still in `WorkflowDrawer`, find the `refresh` callback (around line 240):

```ts
  const refresh = useCallback(() => {
```

Add a new handler right before it:

```ts
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const next = !prev;
      localStorage.setItem('workflow-drawer-fullscreen', next ? '1' : '0');
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
```

- [ ] **Step 4: Apply the conditional class to the drawer panel**

Find this line (around line 583):

```tsx
      <div className="drawer-panel">
```

Change it to:

```tsx
      <div className={`drawer-panel${isFullscreen ? ' fullscreen' : ''}`}>
```

- [ ] **Step 5: Add the toggle button to the header actions**

Find the header actions block (around lines 604-615):

```tsx
            <button
              className={`drawer-calendar-btn${showCalendar ? ' active' : ''}`}
              onClick={() => setShowCalendar((v) => !v)}
              title={showCalendar ? 'Voltar aos posts' : 'Ver calendário do cliente'}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              {showCalendar ? 'Posts' : 'Calendário'}
            </button>
            <button className="drawer-close-btn" onClick={onClose} title="Fechar">
              <X className="h-5 w-5" />
            </button>
```

Insert a new button between the calendar button and the close button:

```tsx
            <button
              className={`drawer-calendar-btn${showCalendar ? ' active' : ''}`}
              onClick={() => setShowCalendar((v) => !v)}
              title={showCalendar ? 'Voltar aos posts' : 'Ver calendário do cliente'}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              {showCalendar ? 'Posts' : 'Calendário'}
            </button>
            <button
              className="drawer-close-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Recolher' : 'Expandir'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button className="drawer-close-btn" onClick={onClose} title="Fechar">
              <X className="h-5 w-5" />
            </button>
```

(Reusing the existing `drawer-close-btn` class for styling — it's a plain icon-button style already shared by other header actions, so no new CSS class is needed for the button itself.)

- [ ] **Step 6: Add the fullscreen CSS rule**

In `apps/crm/style.css`, find the existing `.drawer-panel` rule (lines 5113-5129):

```css
.drawer-panel {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(1280px, 94vw);
  height: fit-content;
  max-height: 92vh;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 16px;
  z-index: 9001;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 80px -12px rgba(0, 0, 0, 0.25);
  animation: drawerPopIn 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
```

Add the new rule immediately after it (before the `@keyframes drawerFadeIn` block):

```css
.drawer-panel.fullscreen {
  width: 100vw;
  height: 100vh;
  max-height: 100vh;
  border-radius: 0;
}
```

- [ ] **Step 7: Typecheck**

Run: `npm run build`
Expected: Completes with no TypeScript errors (this command runs `tsc` before `vite build`).

- [ ] **Step 8: Manual verification in the browser**

Start the CRM dev server (`npm run dev`), open a workflow card's drawer from the Entregas board, and verify:
1. The header shows a new icon button (expand icon) between the "Calendário" button and the close (X) button.
2. Clicking it makes the drawer fill the entire viewport (no rounded corners, no surrounding overlay margin) and the icon swaps to a collapse icon.
3. Clicking it again returns the drawer to its normal centered size with the expand icon restored.
4. Reload the page and reopen the drawer — the last-used state (expanded or not) is restored.
5. Toggling fullscreen while the calendar view (`showCalendar`) is open also works — the panel still fills the viewport.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx apps/crm/style.css
git commit -m "$(cat <<'EOF'
feat(entregas): add fullscreen toggle to WorkflowDrawer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** State/localStorage (Step 2-3), button UI + icon swap + titles (Step 5), conditional class (Step 4), CSS rule (Step 6) — all spec sections covered. Out-of-scope items (HistoryDrawer, keyboard shortcut, animation) intentionally untouched.
- **Placeholder scan:** No TBD/TODO; all steps show exact code and exact line anchors.
- **Type consistency:** `isFullscreen: boolean`, `toggleFullscreen: () => void` used consistently across Steps 2-5; no other task consumes these names.
