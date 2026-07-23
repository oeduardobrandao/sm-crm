# Calendar rescheduling ergonomics — design

**Date:** 2026-07-23
**Branch:** `claude/cross-workflow-post-reschedule-766dcd`
**Status:** approved, ready for implementation plan

## Problem

Three friction points reported by users of the workflow calendar (`Entregas → workflow → Calendário`):

1. **Posts from other workflows can't be rescheduled.** The calendar deliberately shows the
   client's whole schedule (green pills = other workflows) so you can see conflicts, but those
   pills are read-only. To move one you have to leave, find its workflow, open its calendar, and
   drag it there. Users want to rearrange the client's month in one place.
2. **Only the grip handle starts a drag.** The pill's ⋮⋮ handle is the sole drag surface; grabbing
   the pill body does nothing. Users expect the whole card to be draggable.
3. **The post date picker gives no sense of what's already scheduled.** When setting
   `Data de postagem` in the post drawer you see a bare month with no indication of which days
   already carry posts, so spacing content out means flipping back to the calendar.

## Scope

Frontend only. `updateWorkflowPost` ([apps/crm/src/store/posts.ts:486](../../../apps/crm/src/store/posts.ts))
updates by post id with RLS scoping on `conta_id` and performs **no workflow-level check**, so
cross-workflow rescheduling needs no migration, no edge function change, and no RLS work. Every
restriction being lifted here is a client-side gate.

Out of scope: unscheduling foreign posts, opening foreign posts, and any change to what the
calendar loads.

---

## Slice 1 — Cross-workflow rescheduling

### Rule change

In [CalendarGrid.tsx](../../../apps/crm/src/pages/entregas/components/CalendarGrid.tsx), `PostPill`:

```diff
-const canDrag = isCurrentWorkflow && !isLocked;
+const canDrag = !isLocked;
```

Foreign posts keep their green fill, their reduced opacity, and the
`Pertence ao workflow «X»` note in the detail panel. Ownership stays legible; it just stops being
a permission boundary for dates.

### Permission matrix

| Action | This workflow | Other workflow | Locked (either) |
|---|---|---|---|
| Drag between date cells | yes | **yes (new)** | no |
| `Reagendar` picker in detail panel | yes | **yes (new)** | no |
| Drag to `Sem data` / `Remover data` | yes | no | no |
| `Abrir post completo` | yes | no | own only — lock is irrelevant |

`LOCKED_STATUSES` (`agendado`, `postado`, `falha_publicacao`) continue to block all date edits
regardless of which workflow owns the post. `LOCKED_TOOLTIPS` copy is unchanged.

In [CalendarPostDetailPanel.tsx](../../../apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx)
the single `canEdit` flag splits in two:

- `canReschedule = !isLocked` — gates the `Reagendar` section.
- `canRemoveDate = isCurrentWorkflow && !isLocked` — gates the `Remover data` button.

`Abrir post completo` remains behind `isCurrentWorkflow`.

### The unschedule guard

The sidebar lists only the current workflow's backlog
([UnscheduledPostsSidebar.tsx](../../../apps/crm/src/pages/entregas/components/UnscheduledPostsSidebar.tsx)
filters on `workflow_id === currentWorkflowId`). Unscheduling a foreign post would therefore drop
it out of every visible surface. Two-part handling:

1. **Suppress the drop affordance.** The sidebar reads the in-flight post via `useDndContext()`
   and skips its `isOver` border/glow when that post belongs to another workflow. No invitation to
   drop.
2. **Reject with feedback, not silence.** `handleDragEnd` checks ownership before the
   `unscheduled-zone` branch acts:

   ```
   if (post.workflow_id !== currentWorkflowId) {
     toast.info('Só é possível remover a data de posts deste workflow.');
     return;
   }
   ```

   Leaving the droppable enabled (rather than passing `disabled`) is deliberate — a disabled
   droppable yields `over === null` and the drag ends with no explanation at all.

### Cache invalidation

`invalidateQueries` in
[WorkflowCalendarView.tsx](../../../apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx)
hardcodes `['workflow-posts-with-props', currentWorkflowId]`. Moving a foreign post leaves that
workflow's own board stale. It becomes parameterised:

```
const invalidateQueries = useCallback((workflowId?: number) => {
  qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
  qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', currentWorkflowId] });
  if (workflowId != null && workflowId !== currentWorkflowId) {
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
  }
  qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
}, [qc, clienteId, currentWorkflowId]);
```

Every call site passes the moved post's `workflow_id`.

**Resolving the moved post.** Both the invalidation key and the toast copy need the post's workflow
— id *and* title. `pendingDrop` gains **no** new fields; instead `handleTimeConfirm` looks the post
up in `allPosts`:

```
const moved = allPosts.find((p) => p.id === pendingDrop.postId);
```

which yields `workflow_id` and `workflow_titulo` in one step. Carrying a denormalised
`workflowTitulo` on `pendingDrop` would be a second copy of data already in the query cache, and it
would go stale if the post is refetched between drop and confirm.

`handleTimeConfirm`'s dependency array therefore gains `allPosts`. A `null` `moved` (post deleted
in another tab between drop and confirm) falls back to the current non-workflow-qualified toast
rather than throwing.

**Stale-closure trap in `handlePanelReschedule`.** Its deps are currently
`[selectedPostId, invalidateQueries]` ([WorkflowCalendarView.tsx:177](../../../apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx)).
Reading `selectedPost` inside it without adding it to the deps captures the first render's value —
the callback would keep invalidating and naming whichever post was selected when the component
mounted, silently and without an error. `selectedPost` is derived from `scheduledPosts`, so the
honest dep set is `[selectedPost, invalidateQueries]` (`selectedPostId` becomes redundant, since
`selectedPost` already changes with it). This is the same class of bug for both callbacks and is
the reason `allPosts` is spelled out as a dep above rather than left implicit.

### Toast copy

When the moved post is foreign, the success toast names its workflow so the user knows what they
touched:

- Own post: `Post reagendado para 24/07/2026 às 20:00` (unchanged)
- Foreign post: `Post de «Agosto — Carrosséis» reagendado para 24/07/2026 às 20:00`

### Hint banner

The banner text is extended to mention other workflows, and its localStorage key moves from
`calendarHintDismissed` to `calendarHintDismissed.v2` so users who already dismissed the old copy
see the new capability once. The old key is left in place (not migrated, not deleted) — it is a
single stale boolean per browser and reading it would defeat the point of the bump.

New copy:

> 💡 Arraste posts da lista lateral para agendar, ou entre datas para reagendar — inclusive posts
> de outros workflows. Arraste de volta para remover a data (apenas posts deste workflow).

The trailing parenthetical is load-bearing: without it, "inclusive posts de outros workflows"
reads as scoping the whole sentence, teaching exactly the one thing slice 1 forbids. The rejection
toast would then be correcting a claim the banner just made.

---

## Slice 2 — Whole pill draggable

### Listener placement

`{...listeners}` moves from the grip span to the pill root. The grip keeps `setActivatorNodeRef`
and its existing forwarding `onKeyDown`, so keyboard drag survives — it stops being the *only* way
to start one.

**The grip's `onClick={(e) => e.stopPropagation()}` is deleted.** It existed to stop a click on the
handle from bubbling to the pill's select handler; now that the entire pill is one uniform drag-and
-select surface, keeping it would leave a small dead zone in the middle of the pill where clicking
does nothing — precisely the inconsistency this slice exists to remove. Removing it is safe because
`wasDraggingRef` (below) already suppresses the click that follows a real drag, whether that drag
started on the grip or anywhere else. After this, the grip's only retained handlers are the
forwarding `onKeyDown` and `setActivatorNodeRef`.

Ordering matters on the root element: the spread comes first, then `onKeyDown={handleKeyDown}`
overrides dnd-kit's keyboard listener. Otherwise Enter/Space on the pill would start a keyboard
drag instead of opening the detail panel, and the pill's select affordance would be lost.

```
<div
  ref={setNodeRef}
  role="button"
  tabIndex={0}
  {...(canDrag ? listeners : {})}
  onClick={handleClick}
  onKeyDown={handleKeyDown}   // must come after the spread
  style={{ cursor: canDrag ? 'grab' : 'pointer', ... }}
>
```

The comment block at `CalendarGrid.tsx:54-56` explaining the old handle-only arrangement is
rewritten to describe the new one.

### Trailing-click suppression

With `PointerSensor`'s `distance: 5` activation, a completed drag can still emit a `click` on the
pill, which would pop the detail panel open the instant you drop. Today the grip's
`stopPropagation` hides this; moving listeners to the root exposes it.

Guard with a ref that latches on drag start and is consumed by the next click:

```
const wasDraggingRef = useRef(false);
useEffect(() => { if (isDragging) wasDraggingRef.current = true; }, [isDragging]);

const handleClick = () => {
  if (wasDraggingRef.current) { wasDraggingRef.current = false; return; }
  onSelect(post);
};
```

The flag is consumed rather than cleared on a timer, so a drag that ends without a synthetic click
leaves at most one stale `true` — harmless, since the next real click clears it and selection is
idempotent.

### Unchanged

Sidebar cards in `UnscheduledPostsSidebar` already spread listeners on the whole card. No change
there. The grip stays visually identical (approved: "keep grip visible").

---

## Slice 3 — Tipo dots in the date picker

### Component contract

[date-time-picker.tsx](../../../apps/crm/src/components/ui/date-time-picker.tsx) gains one
optional prop:

```ts
/** Day key (`yyyy-MM-dd`) → dots to render beneath the day number, plus that day's tooltip. */
dayMarkers?: Map<string, { colors: string[]; label: string }>;
```

The component stays domain-ignorant: it knows about keys and colors, not posts or tipos. When the
prop is absent it renders exactly what it renders today, so both existing call sites and any
future one are unaffected until they opt in.

Rendering uses a custom react-day-picker v9 `DayButton` that draws the default day content plus a
dot row (max 4 dots, 4px, 2px gap) below it, and sets a native `title` with the per-tipo counts —
`2 Feed · 1 Reels`. The tooltip carries the counts so the popover needs no legend row; it is
already tall with the time selects and the `Mínimo 15 min no futuro` note.

**The custom `DayButton` must spread the props react-day-picker hands it** onto the underlying
`<button>` — `className`, `onClick`, `disabled`, `aria-selected`, and the rest. `Calendar` styles
days entirely through `classNames.day_button` (`buttonVariants({ variant: 'ghost' })`, `h-9 w-9`),
so a `DayButton` that renders its own markup without forwarding silently loses day sizing,
selection highlight, the `futureOnly` disabled state, and click-to-select — with no error. Shape:

```
DayButton: ({ day, modifiers, ...buttonProps }) => (
  <button {...buttonProps} title={marker?.label}>
    {day.date.getDate()}
    {marker && <span className="dtp-day-dots">…</span>}
  </button>
)
```

### Marker construction

New shared helper alongside the other post display logic in
[postLabels.ts](../../../apps/crm/src/pages/entregas/postLabels.ts):

```ts
export function buildTipoDayMarkers(
  posts: Pick<ClientePost, 'id' | 'tipo' | 'scheduled_at'>[],
  opts?: { excludePostId?: number },
): Map<string, { colors: string[]; label: string }>
```

Rules:

- Skips posts with `scheduled_at == null` and the post in `excludePostId`.
- Groups by local-date key `yyyy-MM-dd` (matching `DroppableCell`'s existing key construction, so
  the picker and the calendar agree on which day a post falls on).
- **One dot per distinct tipo present that day**, not per post. A day with three Feed posts shows
  one yellow dot; the tooltip says `3 Feed`.
- Dot order is fixed (`feed`, `carrossel`, `reels`, `stories`) so the same day renders identically
  across re-fetches.
- `label` is the pre-formatted tooltip for that day (`2 Feed · 1 Reels`), built from the same pass
  so the picker never has to re-derive counts.

`excludePostId` means an already-scheduled post doesn't render a dot warning you about itself.

### Call sites

- **`WorkflowDrawer`** — adds `useQuery({ queryKey: ['clientePosts', clienteId], queryFn: () =>
  getClientePosts(clienteId) })`. Same key the calendar already uses, so this is a cache hit rather
  than a new round trip in the common flow. `clienteId` is already in scope
  (`WorkflowDrawer.tsx:221`). Markers exclude the post being edited.
- **`CalendarPostDetailPanel`** — receives `dayMarkers` as a prop. `WorkflowCalendarView` already
  holds `allPosts` and builds the map there, excluding `selectedPostId`.

Scope is **client-wide across all active workflows**, matching what the calendar behind the picker
shows — the question being answered is "is this client's feed already busy that day", which does
not stop at a workflow boundary.

### Two touch-ups this requires

1. **`Calendar` drops caller-supplied `components`.**
   [calendar.tsx](../../../apps/crm/src/components/ui/calendar.tsx) sets
   `components={{ Chevron }}` and then spreads `{...props}` after it, so any caller passing
   `components` silently replaces the chevron override and loses both nav arrows. Fix by merging:

   ```
   components={{ Chevron: ..., ...props.components }}
   ```

   with `components` destructured out of the rest-spread. This is a latent bug in a shared
   component that slice 3 would be the first to trigger.

2. **`TIPO_COLORS` is duplicated three ways — and `TIPO_LABELS` four.** `CalendarGrid` (string
   values), `UnscheduledPostsSidebar` (`{bg, text}` pairs), and `CalendarPostDetailPanel` (string
   values) each declare their own colors. Worse, `postLabels.ts` *already exports* `TIPO_LABELS`
   and four files shadow it with a local copy anyway: `CalendarGrid`, `UnscheduledPostsSidebar`,
   `WorkflowCalendarView`, and `HistoryDrawer`. Three of those four are files these slices already
   edit. The canonical palette moves to `postLabels.ts` next to `TIPO_LABELS`:

   ```ts
   export const TIPO_COLORS: Record<WorkflowPost['tipo'], string> = {
     feed: '#eab308', reels: '#E1306C', stories: '#42c8f5', carrossel: '#3ecf8e',
   };
   ```

   The sidebar's `{bg, text}` shape is derived from it (`bg` is the same hex with a `25` alpha
   suffix, which is exactly what it hardcodes today) rather than kept as a second source. Each of
   the local `TIPO_LABELS` shadows is deleted in favour of the existing `postLabels.ts` export.

   **`HistoryDrawer` is the one file pulled in purely for this cleanup** — no slice otherwise
   touches it. Its shadow is already typed `Record<WorkflowPost['tipo'], string>` with identical
   values, so removing it is a pure import swap with no behavior change. Say so if you'd rather
   leave it and keep the diff strictly to files the slices already edit; the tradeoff is one
   surviving shadow that reads like an oversight.

   The Hub's `PostCalendar` uses a **different** tipo palette (`feed #3b82f6`, `reels #8b5cf6`,
   `stories #f59e0b`, `carrossel #10b981`). That divergence is left alone — this is a CRM screen
   and must match the CRM calendar it sits in front of. Unifying the two apps' palettes is a
   separate decision.

### Accepted color collision

`carrossel` is `#3ecf8e` — the same green the calendar uses for "belongs to another workflow". With
slice 3 putting tipo-colored dots on a screen that also shows green foreign pills, one green means
two different things depending on where it appears.

Accepted rather than fixed. The two never share a surface: pills live in the month grid and carry
text (`Carrossel · 20:00`), dots live inside the date-picker popover where workflow ownership isn't
represented at all. Recoloring either would ripple through the legend, the sidebar swatches, and
the detail panel's thumbnail fallback for a collision that has no rendering context in common.
Worth revisiting only if ownership ever gets surfaced inside the picker.

---

## Testing

Existing suites that touch this code: `WorkflowCalendarView.test.tsx`,
`CalendarPostDetailPanel.test.tsx`, `CalendarGrid` coverage under `entregas/components/__tests__`.
Per repo convention, grep both `apps/**/__tests__` and `supabase/functions/__tests__` for the old
shapes before changing contracts — though this change is frontend-only, `postLabels.ts` exports are
imported broadly.

| Unit | What gets tested |
|---|---|
| `buildTipoDayMarkers` | pure function: null `scheduled_at` skipped, `excludePostId` honoured, one dot per distinct tipo, stable dot order, tooltip text, local-date grouping |
| `PostPill` | foreign non-locked pill exposes drag affordance; locked pill (either workflow) does not; grip retains `aria-label`; Enter/Space selects rather than starting a drag |
| `CalendarPostDetailPanel` | foreign post renders `Reagendar` but **not** `Remover data` or `Abrir post completo`; locked post renders neither; own unlocked post renders all three |
| `WorkflowCalendarView` | foreign post dropped on `unscheduled-zone` calls `toast.info` and does **not** call `updateWorkflowPost`; foreign reschedule invalidates the foreign workflow's key; foreign success toast includes the workflow name; toast falls back to the plain copy when the post is missing from `allPosts` |
| `WorkflowCalendarView` deps | select post A, then select post B, then reschedule from the panel → `updateWorkflowPost` is called with **B**'s id. Fails if `handlePanelReschedule` keeps a stale `selectedPost` closure |
| `DateTimePicker` | absent `dayMarkers` renders unchanged; present markers render dots and `title`; nav chevrons survive a caller-supplied `components` prop |

Trailing-click suppression is not reliably reproducible in jsdom (dnd-kit's pointer sequence and
the synthetic click both depend on real pointer capture). It is verified in the browser against the
dev server rather than asserted in a unit test, and the `wasDraggingRef` logic is kept small enough
to read.

Verification before merge: `npm run test`, `npm run lint`, `npm run format:check`, `npm run build`,
plus a browser pass on the calendar (drag a green pill to a new date; drag one at the sidebar and
confirm the toast; drag a pill by its body; open the drawer date picker and confirm dots).

## Risks

- **Accidental reschedules of someone else's post.** Mitigated by unchanged green colouring, the
  workflow name in the detail panel, and the workflow name in the success toast. There is no undo;
  the recovery path is dragging it back.
- **Trailing click after drag.** Addressed by `wasDraggingRef`; would present as the detail panel
  opening on drop. Browser-verified.
- **`Calendar` chevron regression.** The merge fix is the reason to touch that file at all; the
  test above pins it.
