# Workflow Drawer Calendar View

**Date:** 2026-05-13
**Status:** Draft

## Problem

Users editing posts inside the WorkflowDrawer have no visibility into the client's full content calendar. They must leave the drawer, check dates manually, and return to schedule posts — a friction-heavy workflow that leads to scheduling conflicts and uneven content distribution.

## Solution

Add an interactive calendar view inside the WorkflowDrawer that shows all scheduled posts across all of the client's workflows. Users can drag-and-drop posts to schedule, reschedule, or unschedule them directly from the calendar.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Calendar scope | All client posts (all workflows) | Prevents scheduling conflicts across workflows |
| Layout | Full drawer takeover | Maximizes space for calendar grid and drag-drop |
| Unscheduled posts | Left sidebar list | Natural vertical drag-to-right onto calendar dates |
| Drag-drop library | @dnd-kit (existing) | Already used in drawer for post reordering; no new dependency |
| Time assignment | Popover after drop | Explicit time selection avoids silent defaults |
| Calendar rendering | Custom grid component | Full styling control with existing design system |

## Data Layer

### New type

`ClientePost` in `store/posts.ts`:
```typescript
export interface ClientePost extends WorkflowPost {
  workflow_titulo: string;
}
```

### New store function

`getClientePosts(clienteId: number): Promise<ClientePost[]>` in `store/posts.ts`:
- Single Supabase query: `workflow_posts` selecting `*, workflows!inner(titulo)` where `workflows.cliente_id = clienteId` and `workflows.status = 'ativo'`
- Maps result to flatten `workflow_titulo` from the join
- Returns all posts (both scheduled and unscheduled) — filtering happens in the component

### Query integration

TanStack Query hook in `WorkflowCalendarView`:
- Key: `['clientePosts', clienteId]`
- Fetched when calendar view opens (lazy — not preloaded in posts list view)
- Invalidated after any drag-drop mutation (schedule, reschedule, unschedule)

### Mutation

Reuses existing `updateWorkflowPost(id, { scheduled_at })` from `store/posts.ts`. No new mutation function needed.

## Component Architecture

All new components in `apps/crm/src/pages/entregas/components/`:

### WorkflowCalendarView.tsx

Main container component. Replaces the drawer body when calendar mode is active.

**Props:**
```typescript
interface WorkflowCalendarViewProps {
  clienteId: number;
  clienteNome: string;
  currentWorkflowId: number;
  currentWorkflowTitulo: string;
  onBack: () => void;
}
```

**Responsibilities:**
- Wraps `DndContext` from `@dnd-kit/core` around sidebar + calendar
- Manages `currentMonth` state (Date) for month navigation
- Fetches all client posts via `useQuery(['clientePosts', clienteId])`
- Splits posts into `scheduledPosts` (have `scheduled_at`) and `unscheduledPosts` (null `scheduled_at`)
- Handles `onDragEnd`: determines source/target, opens `TimePickerPopover` or calls unschedule
- Renders `DragOverlay` with ghost card showing post title + type badge

### CalendarGrid.tsx

Month grid rendering with droppable date cells.

**Props:**
```typescript
interface CalendarGridProps {
  currentMonth: Date;
  scheduledPosts: ClientePost[];
  currentWorkflowId: number;
  onMonthChange: (date: Date) => void;
}
```

**Responsibilities:**
- Renders 7-column grid (Seg–Dom) with `date-fns` for month calculations
- Each date cell is a `useDroppable` zone with `id` = ISO date string (e.g., `"2026-06-03"`)
- Renders post pills inside cells: draggable (current workflow, unlocked) or static (other workflows / locked)
- Post pills show: type badge, truncated title, time (HH:mm)
- Drop target highlight: dashed `#eab308` border + glow + "Soltar aqui" text when `isOver` is true
- Previous/next month days shown with muted styling
- Weekend columns subtly differentiated with darker background

### UnscheduledPostsSidebar.tsx

Left sidebar listing posts without `scheduled_at`.

**Props:**
```typescript
interface UnscheduledPostsSidebarProps {
  posts: ClientePost[];
  currentWorkflowId: number;
}
```

**Responsibilities:**
- Renders scrollable list of draggable post cards
- Each card is a `useDraggable` item with `id` = `"unscheduled-{postId}"`
- Card shows: title, type badge (color-coded), workflow name (DM Mono)
- Left border color: `#eab308` for current workflow, `#3ecf8e` for others
- Also acts as a `useDroppable` zone (id: `"unscheduled-zone"`) for drag-back-to-unschedule
- Empty state: "Todos os posts estão agendados ✓"
- Legend section at the bottom: color key for current vs other workflows

### TimePickerPopover.tsx

Popover for selecting time after a date drop.

**Props:**
```typescript
interface TimePickerPopoverProps {
  date: Date;
  onConfirm: (datetime: Date) => void;
  onCancel: () => void;
  anchorPosition: { x: number; y: number };
}
```

**Responsibilities:**
- Positioned near the drop target cell using `anchorPosition`
- Shows selected date (formatted: "3 de junho, 2026")
- Hour selector: 0–23 (24h format)
- Minute selector: 0–55 in 5-minute increments
- Default time: 10:00
- Confirm button saves; Cancel reverts the drop
- Closes on outside click (treated as cancel)

## Drag-and-Drop Interactions

### Scenario 1: Sidebar → Calendar (schedule)

1. User grabs unscheduled post from sidebar
2. Drag overlay shows ghost card with post title + type
3. Calendar cells highlight on hover (dashed border + "Soltar aqui")
4. On drop: `TimePickerPopover` opens near target cell
5. User picks time → Confirm → `updateWorkflowPost(postId, { scheduled_at: isoString })`
6. Query invalidated → post moves from sidebar to calendar cell
7. Toast: "Post agendado para {date} às {time}"

### Scenario 2: Calendar → Calendar (reschedule)

1. User grabs scheduled post pill from a date cell
2. Other cells highlight as valid targets
3. On drop: `TimePickerPopover` opens with previous time as default
4. User confirms → `updateWorkflowPost` called with new `scheduled_at`
5. Toast: "Post reagendado para {date} às {time}"

### Scenario 3: Calendar → Sidebar (unschedule)

1. User drags post pill back to sidebar area
2. Sidebar highlights as drop zone (border glow)
3. On drop: `updateWorkflowPost(postId, { scheduled_at: null })` — no time picker needed
4. Post reappears in unscheduled list
5. Toast: "Data removida do post"

### Drag constraints

- **Not draggable:** posts with status `agendado` or `postado` (lock icon, tooltip: "Post já agendado no Instagram" / "Post já publicado")
- **Not draggable:** posts from other workflows (visible for context only, no grip handle)
- **Draggable:** all other posts from the current workflow regardless of status

## Visual Helpers & Tooltips

### Hint banner
Yellow-tinted bar below the header on first visit:
> 💡 Arraste posts da lista lateral para agendar, ou entre datas para reagendar. Arraste de volta para remover a data.

Dismissible via X button. Preference stored in localStorage key `calendarHintDismissed`.

### Drop target feedback
- Active hover: `border: 2px dashed rgba(234, 179, 8, 0.4)`, `box-shadow: 0 0 12px rgba(234, 179, 8, 0.12)`
- "Soltar aqui" text appears centered in the cell
- Sidebar drop zone: similar glow effect when dragging back

### Post pill tooltips
- Current workflow draggable pills: "{Type} · {HH:mm} · {Workflow title}"
- Other workflow pills: "{Type} · {HH:mm} · {Workflow title} (outro workflow)"
- Locked pills: "Post já agendado no Instagram — cancele o agendamento para mover"

### Drag overlay
Semi-transparent ghost card (opacity 0.85) following cursor:
- Shows post title (truncated), type badge, time if scheduled
- Subtle shadow for depth

## Visual Design

### Color coding
| Element | Color | Hex |
|---------|-------|-----|
| Current workflow posts & pills | Brand yellow | `#eab308` |
| Other workflow posts & pills | Success green | `#3ecf8e` |
| Drop target highlight | Yellow glow | `rgba(234, 179, 8, 0.4)` |
| Locked post overlay | Reduced opacity | `opacity: 0.6` |
| Weekend cells | Darker background | `#0d1015` |
| Out-of-month dates | Muted text | `#4b5563` |

### Typography
| Element | Font | Size | Weight |
|---------|------|------|--------|
| Date numbers | DM Mono | 11px | 400 |
| Post pill text | DM Sans | 7px | 700 |
| Sidebar post titles | DM Sans | 11px | 600 |
| Sidebar workflow label | DM Mono | 8px | 400 |
| Month header | Playfair Display | 16px | 700 |
| Day column headers | DM Sans | 10px | 600 |

### Layout
- Sidebar width: 200px, fixed
- Calendar cells: min-height 64px
- Cell border-radius: 8px
- Cell background: `#1a1e26` (current month), `#0d1015` (out-of-month/weekends)
- Grid gap: 4px

## Integration with WorkflowDrawer

### Changes to WorkflowDrawer.tsx

1. Add state: `const [showCalendar, setShowCalendar] = useState(false)`
2. Add calendar toggle button in `drawer-header-actions` (before close button):
   ```
   📅 Calendário
   ```
   Styled as a small button matching existing drawer header buttons.
3. When `showCalendar` is true, render `WorkflowCalendarView` instead of the posts list in `drawer-body`
4. The "Voltar aos posts" button in `WorkflowCalendarView` calls `onBack` which sets `showCalendar` to false

### No changes needed to:
- `EntregasPage.tsx` (drawer opening/closing unchanged)
- `store/workflows.ts` (existing `getWorkflowsByCliente` not used — direct join query instead)
- Post editing flow (stays the same in posts list view)

## Edge Cases

- **No posts at all:** calendar shows empty grid, sidebar shows "Nenhum post sem data"
- **All posts scheduled:** sidebar shows "Todos os posts estão agendados ✓", legend remains
- **Multiple posts same day:** pills stack vertically within the cell; if more than 3, show "+N mais" overflow indicator
- **Month with no posts:** empty calendar grid, still navigable
- **Post updated while calendar open:** TanStack Query refetch on window focus handles stale data
- **Drawer closed and reopened:** `showCalendar` resets to false (posts list view is default)

## Out of Scope

- Week or day calendar views (month only for v1)
- Creating new posts from the calendar view (use the posts list)
- Editing post content from the calendar (click goes back to posts list in future iteration)
- Recurring/repeating post scheduling
- Multi-post drag (one at a time)
