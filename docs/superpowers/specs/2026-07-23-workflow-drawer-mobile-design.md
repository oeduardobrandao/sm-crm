# WorkflowDrawer Mobile Design (Posts List + Calendar)

**Date:** 2026-07-23
**Status:** Approved design, validated in a static mock; ready for implementation
**Base:** `origin/main` @ `41eee3da` — see "Branch setup" below before touching code

## Objective

Make the Entregas WorkflowDrawer usable on phones (≤767px), in both of its modes:

1. **Posts list** — today the collapsed post rows overflow: the left group (drag handle, chevron, tipo badge, title) can't shrink below its badges, so it renders _underneath_ the right group (history clock, date, status chip, link, trash). The tipo badge visually overlaps the clock/date ("Carrossel8 ago · 20h"), and the post title is completely invisible.
2. **Calendar** — the fixed 200px "Sem data" sidebar sits beside the month grid, leaving ~135px for 7 columns (~19px each). The weekday header renders as "SEGTERQUAQUISEXSÁBDOM", day cells become unusable slivers, and post cards are reduced to clipped fragments.

All changes are **mobile-only** (inside `@media (max-width: 767px)` blocks, plus three tiny TSX edits that are no-ops on desktop). Desktop/tablet rendering must not change.

## Design decisions (validated in mock)

A pixel-accurate static mock was built from `origin/main`'s real `style.css` + component DOM and iterated at 375×812 and 360×780, light and dark themes. Validated results:

- **Posts row → two lines.** Line 1: drag handle, chevron, tipo badge, full-width truncating title (+media/comment badges). Line 2: date + status chip on the left, action icons (history, copy link, delete) pushed right. Achieved purely with `flex-wrap` + `order` — **no DOM changes**.
- **Fullscreen toggle hidden on mobile.** At ≤900px the drawer is already forced fullscreen, so the Maximize/Minimize button is a no-op — hide it (needs a distinguishing class, TSX edit 1).
- **Expanded post meta fields**: Título, Data de postagem, and the platform selector go full-width; Tipo/Status/Responsável flow two-per-row.
- **Calendar stacks vertically.** "Sem data" becomes a horizontal swipe rail on top (cards ~190px wide, legend hidden); the month grid gets the full viewport width below it. At full width the 3-letter weekday labels fit fine.
- **Calendar post cards → compact chips.** On mobile each card shows only its tipo-colored dash + time ("— 20h"), centered, ~18px tall; tipo/title/workflow-chip/grip are hidden. Foreign posts keep the dashed-border recessed surface; tap opens the detail panel which carries full info. `+N mais` overflow still works.
- **Detail panel → bottom sheet.** Instead of the ≤1024px right-side overlay (`width: min(360px, 90%)` ≈ everything at 375px), the panel docks to the bottom: full-width, `max-height: 72%`, rounded top corners, slide-up animation. `calendar-content` is `position: relative`, so `position: absolute` anchoring works without new containing-block risk (do NOT use `position: fixed` — see `.hub-fade-up` trap precedent).
- **Calendar gets edge-to-edge width** by zeroing `.drawer-body` padding only while the calendar is shown (needs a modifier class, TSX edit 2).
- **Touch drag-and-drop**: add a `TouchSensor` with long-press activation to the calendar's DnD context (TSX edit 3). The posts-list reorder needs no change — its drag handle already has `touch-action: none`, so the existing `PointerSensor` works there.

## Branch setup (important)

The pre-created worktree branch `claude/workflow-drawer-mobile-2a5560` was cut from a base **22 commits behind** current main, and `style.css`, `WorkflowDrawer.tsx`, `CalendarGrid.tsx`, `UnscheduledPostsSidebar.tsx` all changed heavily since (calendar pills were redesigned into `calendar-post-card`). Do not implement against that stale base.

```bash
git fetch origin main
# either merge main into the existing branch, or (preferred) start clean:
git checkout -b feat/workflow-drawer-mobile origin/main
```

All line numbers below refer to `origin/main` @ `41eee3da`.

## Task 1 — TSX: tag the fullscreen button

`apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (~line 668): the fullscreen toggle and the close button share `drawer-close-btn`, so CSS can't hide one without the other. Add a second class to the fullscreen toggle only:

```tsx
<button
  className="drawer-close-btn drawer-fullscreen-btn"
  onClick={toggleFullscreen}
  title={isFullscreen ? 'Recolher' : 'Expandir'}
>
```

## Task 2 — TSX: calendar modifier on drawer-body

Same file (~line 682). The calendar renders inside the padded `.drawer-body`; mobile needs that padding gone (full-width grid) without affecting the posts view or desktop:

```tsx
<div className={`drawer-body${showCalendar ? ' drawer-body--calendar' : ''}`}>
```

## Task 3 — TSX: touch sensor for calendar drag-and-drop

`apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx` (~line 68). Today only `PointerSensor` (distance 5) + `KeyboardSensor` are registered; on touch devices the browser's scroll wins and drag activation is unreliable. Add a long-press `TouchSensor`:

```tsx
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor, // add
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  useSensor(KeyboardSensor),
);
```

Long-press (250ms) starts a drag; a normal swipe scrolls. The companion CSS below adds `user-select: none` / `-webkit-touch-callout: none` to the draggable cards so iOS long-press doesn't trigger text selection.

Note: the top rail remains the `unscheduled-zone` droppable, so dragging a scheduled chip up to the rail still un-schedules it.

## Task 4 — CSS: drawer mobile block

`apps/crm/style.css`. First, update the existing mobile drawer rule (~line 6163) to use dynamic viewport units (mobile Safari URL-bar):

```css
@media (max-width: 900px) {
  .drawer-panel {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    height: 100dvh; /* add — keeps 100vh above as fallback */
    max-height: 100dvh; /* add */
    border-radius: 0;
    animation: none;
  }
}
```

Then append this block **immediately after** that `@media (max-width: 900px)` block (i.e. before the `.post-tipo-badge` section ~line 6173):

```css
/* ── Drawer mobile (audit: WorkflowDrawer posts list) ──────────────────────
   The collapsed row's two flex groups can't fit side-by-side on phones: the
   left group's badges are flex-shrink:0, so once the title hits width 0 the
   groups overlap. Wrap into two lines instead — line 1 = identity (handle,
   chevron, tipo, title), line 2 = state + actions (date, status chip, then
   icon buttons pushed right via margin-left:auto on the first button). */
@media (max-width: 767px) {
  .drawer-header {
    padding: 1rem 1rem 0.75rem;
    gap: 0.5rem;
  }

  /* No-op at this size: the drawer is already forced fullscreen at ≤900px. */
  .drawer-fullscreen-btn {
    display: none;
  }

  .drawer-body {
    padding: 0.75rem 0.75rem max(0.75rem, env(safe-area-inset-bottom));
  }

  /* Edge-to-edge month grid; the calendar owns its own internal padding. */
  .drawer-body--calendar {
    padding: 0;
  }

  .drawer-post-trigger {
    flex-wrap: wrap;
    row-gap: 0.4rem;
    padding: 0.6rem 0.65rem;
  }

  .drawer-post-trigger-left {
    flex: 1 1 100%;
  }

  .drawer-post-trigger-right {
    flex: 1 1 100%;
    gap: 0.4rem;
  }

  /* Reorder line 2 to date · chip · (auto gap) · history · link · delete.
     DOM order is history, date, chip, link, delete — flex `order` re-sorts
     without touching the DOM. */
  .drawer-post-trigger-right .drawer-post-date {
    order: -2;
  }
  .drawer-post-trigger-right .post-status-chip {
    order: -1;
  }
  .drawer-post-trigger-right .drawer-post-history-btn {
    margin-left: auto;
  }

  /* Bigger touch targets for the row's icon buttons (link + delete share
     .drawer-delete-btn). */
  .drawer-post-trigger .drawer-delete-btn {
    padding: 0.45rem;
  }

  /* Expanded post: Título / Data / platform selector full width, the other
     selects two-per-row. The :first/:last-child rules must out-rank the base
     rules at lines ~5985-6003 — same selectors, later in file wins. */
  .drawer-post-meta-row > .drawer-post-field {
    flex: 1 1 calc(50% - 0.25rem);
  }
  .drawer-post-meta-row > .drawer-post-field:first-child,
  .drawer-post-meta-row > .drawer-post-field:last-child,
  .drawer-post-meta-row > .drawer-post-field--platform {
    flex: 1 1 100%;
  }
}
```

## Task 5 — CSS: calendar mobile block

Append **after** the existing `@media (max-width: 1024px)` `.calendar-detail-panel` block (~line 8549) — the bottom-sheet rules must come later in the file to override it:

```css
/* ── Calendar mobile (audit: WorkflowDrawer calendar view) ─────────────────
   Stack the layout: "Sem data" becomes a horizontal swipe rail on top, the
   month grid takes the full width below. Post cards compress to dash+time
   chips (full info lives in the detail sheet), and the detail panel docks as
   a bottom sheet instead of a right-side overlay. */
@media (max-width: 767px) {
  .calendar-content {
    flex-direction: column;
  }

  .calendar-hint-banner {
    padding: 8px 12px;
  }

  .calendar-sidebar {
    width: 100%;
    flex-shrink: 0;
    flex-direction: column;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
    padding: 10px 12px 8px;
    overflow: visible;
  }

  .sidebar-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 8px;
  }

  .sidebar-posts-list {
    flex-direction: row;
    overflow-x: auto;
    gap: 8px;
    padding-bottom: 4px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .sidebar-posts-list::-webkit-scrollbar {
    display: none;
  }

  .sidebar-post-card {
    flex: 0 0 190px;
  }

  .sidebar-empty {
    padding: 0.5rem 0;
  }

  /* Tipo colors are readable on the cards/chips themselves; reclaim the space. */
  .sidebar-legend {
    display: none;
  }

  /* iOS: long-press must start a drag, not text selection. */
  .sidebar-post-card,
  .calendar-post-card {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .calendar-grid-container {
    padding: 12px;
  }

  .calendar-cell {
    min-height: 60px;
    padding: 4px;
    border-radius: 6px;
  }

  .cell-posts {
    gap: 2px;
    margin-top: 2px;
  }

  /* Card → chip: tipo dash + time only. Foreign keeps its dashed recessed
     surface from the base rules; tap still opens the detail panel. */
  .calendar-post-card {
    padding: 2px 3px;
    gap: 0;
    min-height: 18px;
    justify-content: center;
  }
  .calendar-post-card .post-card-tipo,
  .calendar-post-card .post-card-title,
  .calendar-post-card .post-card-workflow,
  .calendar-post-card .calendar-pill-handle {
    display: none;
  }
  .post-card-meta {
    justify-content: center;
    gap: 3px;
  }
  .post-card-dash {
    width: 14px;
    height: 4px;
  }
  .post-card-time {
    margin-left: 0;
    font-size: 0.5rem;
  }
  .post-card-lock {
    width: 8px;
    height: 8px;
  }

  .cell-overflow {
    font-size: 0.6rem;
    padding: 4px 0;
  }

  /* Bottom sheet. Overrides the ≤1024px right-overlay block above (same
     media condition also matches here; this block is later in the file).
     `top: auto` is required to undo that block's `top: 0`. Absolute against
     .calendar-content (position: relative) — NOT fixed, which the drawer's
     ancestor animations could reparent. */
  .calendar-detail-panel {
    position: absolute;
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: 100%;
    max-height: 72%;
    border-left: none;
    border-top: 1px solid var(--border-color);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -16px 40px -12px rgba(0, 0, 0, 0.35);
    z-index: 6;
    animation: calendarDetailSheetUp 0.22s ease;
  }

  .calendar-detail-foot {
    padding-bottom: max(13px, env(safe-area-inset-bottom));
  }
}

@keyframes calendarDetailSheetUp {
  from {
    transform: translateY(24px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
```

(Keyframes must sit outside the media query; `prefers-reduced-motion` is already handled globally at ~line 3296 — verify the existing reduce block covers animations generally; if it only lists specific selectors, add `.calendar-detail-panel` to it.)

## Explicitly out of scope

- Compact "Enviar (N)" send-button label on mobile (drawer header). Nice-to-have; the header fits without it since the fullscreen button is hidden.
- `maxVisible` bump in `DroppableCell` (stays 2 + "+N mais").
- Post editor toolbar overflow inside the expanded post.
- Hub app — untouched (`apps/crm/style.css` is CRM-only).

## Verification

1. `npm run build` (tsc + vite), `npm run test`, `npm run lint`, `npm run format:check` — all green. jsdom cannot exercise media queries, so responsive behavior must be checked in a real browser (known repo gotcha).
2. Check the existing suites that touch edited files for structural assertions: `__tests__/WorkflowDrawer.test.tsx`, `WorkflowDrawerAutoComplete.test.tsx`, `WorkflowCalendarView.test.tsx` (this one may stub `useSensors`/dnd-kit — adding `TouchSensor` must not break its mocks), `CalendarGrid.test.tsx`, `UnscheduledPostsSidebar.test.tsx`.
3. Browser at 375×812 and 360×780 (`npm run dev`, DevTools device mode or the preview pane):
   - Posts list: two-line rows, title readable and truncating, line 2 shows `date · status chip … 🕐 🔗 🗑` with no overflow (`el.scrollWidth <= el.clientWidth` on `.drawer-post-trigger-right`).
   - No fullscreen button; header title gets the reclaimed space.
   - Expanded post: Título full row; Tipo/Status two-up; Responsável/(Plataforma) sensible; Data full row.
   - Calendar: rail on top scrolls horizontally; weekday labels not overlapping; chips show dash+time; foreign chips dashed; today ring visible; "+N mais" opens the day popover; tapping a chip opens the bottom sheet; sheet closes; "Abrir post" navigates back to the posts view with the post expanded.
   - Dark mode (`[data-theme='dark']`) for both views.
4. Desktop (≥768px) untouched: drawer rows single-line, calendar sidebar on the left, detail panel as right column/overlay exactly as before.
5. Real device (or simulator) touch pass: long-press a rail card → drag to a day → time picker appears; long-press a scheduled chip → drag to another day and to the rail (unschedule); normal swipes still scroll the rail and the grid. If drags still lose to scrolling on iOS, fall back to `touch-action: none` on `.calendar-post-card` only (cards are small; scroll can start from empty cell space).

## Mock reference (session artifact, not committed)

The validated mock lives at the authoring session's scratchpad:
`…/scratchpad/mock/index.html` served with `python3 -m http.server 5180` — buttons toggle Posts/Calendário and Antes/Depois. Its `<style>` block contains exactly the rules above scoped under `body.mode-after` instead of the media query, plus mock-only scaffolding clearly marked. `style.css` beside it is a byte-identical copy of `origin/main:apps/crm/style.css` (sha `3c332af8`).
