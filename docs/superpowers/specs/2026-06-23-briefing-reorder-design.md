# Briefing Reorder — Design Spec

**Date:** 2026-06-23
**Status:** Approved, pending implementation
**Branch:** `feat/briefing-export` (briefing work continues here; could also be a fresh `feat/briefing-reorder` off `main`)

## Goal

Let users reorder the **questions** within a section and reorder the **sections**
themselves inside a briefing, via drag-and-drop, in the CRM briefing editor. The
new order persists and is reflected in the client-facing Hub portal.

Scope (chosen during brainstorming):

- **Drag-and-drop** interaction (no arrow buttons), using dnd-kit — already a
  project dependency and the established reorder pattern in the Workflow editor.
- **Questions** reorder **within their own section** only.
- **Sections** reorder as whole blocks (the section header + all its questions).
- **No cross-section moves** — a question never changes its section via drag.

Out of scope: reordering briefings (tabs), reordering across briefings, changing a
question's section by drag, arrow-button fallback.

## Context

The briefing editor lives in `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` in the
`BriefingEditor` component. Facts established during research:

- **Sections are not a real entity.** A "section" is just the `section` string
  column on `hub_briefing_questions`. The CRM derives section groups by iterating
  questions and grouping on `q.section ?? ''` in first-seen order
  (`HubTab.tsx` ~712). Section *order* is therefore an emergent property of
  question `display_order`.
- **Ordering source of truth is `display_order`** (int, scoped per briefing).
  - `getHubBriefingQuestions` orders by `briefing_id` then `display_order`
    (`store/hub.ts:178`).
  - `addHubBriefingQuestion` assigns `nextOrder = max(display_order)+1` within the
    briefing (`store/hub.ts:191`).
- **Render layout** (`HubTab.tsx` ~1066–1104):
  - **Unsectioned** questions (`section === '' | null`) render **first**, always,
    with no header — `renderQuestions(unsectioned?.questions ?? [], null)`.
  - **Named sections** render after, each **collapsible** (collapsed by default),
    with a header that is a `<button>` toggling collapse
    (chevron + name + count).
  - **Pending sections** (created via "Nova seção" but with no saved question yet)
    are local-only state, not persisted — excluded from reordering.
  - Each question card has Editar / Trash actions; an inline "Nova pergunta" input
    sits at the bottom of each section.
- **dnd-kit is already used** with the standard pattern in
  `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` and
  `WorkflowDrawer.tsx`: `DndContext` + `SortableContext` + `useSortable` +
  `arrayMove`, with `closestCenter` collision detection and pointer/keyboard
  sensors. We follow that pattern.
- **The Hub reflects `display_order` automatically.** The `hub-briefing` edge
  function selects questions ordered by `display_order`
  (`supabase/functions/hub-briefing/handler.ts:44`), and `BriefingPage.tsx`
  (`apps/hub/src/pages/BriefingPage.tsx:34`) groups by section in first-seen order.
  So as long as we keep each section's questions **contiguous** in `display_order`,
  reordering in the CRM moves both questions and section tabs on the client side.
  **No Hub or edge-function changes are required.**

## Data model & reorder math

We keep one invariant for a briefing's questions: they are globally ordered by
`display_order`, and questions of the same section are **contiguous**. The visual
flat order is:

```
[ unsectioned questions… , section A questions… , section B questions… , … ]
```

- **Unsectioned block is pinned at the top** and is not part of section
  reordering (it has no header to grab). Its questions are still reorderable among
  themselves.
- **Section reordering** permutes the named-section blocks within the flat list.
- **Question reordering** permutes questions within a single block (unsectioned or
  a named section).

A pure helper computes the new persisted order:

```ts
// apps/crm/src/lib/briefingReorder.ts
type Q = { id: string; section: string | null; display_order: number };

// Reorder questions within one section (sectionKey === '' for unsectioned).
function reorderQuestionWithinSection(
  questions: Q[],        // all questions of the briefing, current visual order
  sectionKey: string,    // '' for unsectioned
  fromId: string,
  toId: string,
): { id: string; display_order: number }[];

// Reorder whole section blocks (named sections only).
function reorderSections(
  questions: Q[],
  fromSection: string,
  toSection: string,
): { id: string; display_order: number }[];
```

Both rebuild the flat order, assign `display_order = index`, and return **only the
rows whose `display_order` changed** (minimal write set). Cross-section question
moves are a no-op (guarded): if `fromId` and `toId` are in different sections, the
within-section helper returns `[]`.

## Persistence

New store function in `apps/crm/src/store/hub.ts`:

```ts
export async function reorderBriefingQuestions(
  updates: { id: string; display_order: number }[],
): Promise<void>
```

Implementation: `await Promise.all(updates.map(u =>
supabase.from('hub_briefing_questions').update({ display_order: u.display_order })
.eq('id', u.id)))`, throwing on the first error. Briefings are small (tens of
questions), so per-row updates are acceptable and avoid the upsert/NOT-NULL
pitfalls of bulk upsert. Skip the call entirely when `updates` is empty.

## UI / dnd structure

Extract two small sortable components into a new file
`apps/crm/src/pages/cliente-detalhe/BriefingReorder.tsx` to avoid growing
`HubTab.tsx` (~1150 lines):

- `SortableQuestion` — wraps a question card with `useSortable({ id: q.id })`,
  exposing a `GripVertical` drag handle (handle-scoped `listeners`/`attributes`)
  so the existing Editar/Trash buttons keep working. Renders its children
  (the existing card markup is passed in / replicated).
- `SortableSection` — wraps a named-section block with
  `useSortable({ id: 'section:' + name })`, exposing a grip handle next to the
  collapse toggle so dragging the section never triggers collapse.

**Nested dnd contexts** to enforce "no cross-section":

- An **outer** `DndContext` + `SortableContext` (items = named section names) for
  section reordering. `onDragEnd` → `reorderSections(...)`.
- An **inner** `DndContext` + `SortableContext` **per section** (and one for the
  unsectioned block) (items = that section's question ids) for question
  reordering. `onDragEnd` → `reorderQuestionWithinSection(...)`.

Because each question's sortable context is scoped to its own section, dragging a
question into another section is structurally impossible — matching the chosen
scope and keeping each piece independently reasoned about. Handle-scoped listeners
prevent pointer-sensor conflicts between the nested contexts.

Sensors: `PointerSensor` (with a small activation distance so taps still click)
and `KeyboardSensor` for accessibility, mirroring `WorkflowModals.tsx`.

## Optimistic update flow

On a successful drag:

1. Compute `updates` via the pure helper.
2. If empty, do nothing.
3. Optimistically rewrite the React Query cache
   `['hub-briefing-questions', clienteId]` so the affected briefing's questions
   appear **in the new array order** (and their `display_order` fields match).
   **Reordering the array is required, not just patching `display_order`** — the
   editor renders in array order and never re-sorts by `display_order`
   (`briefingQuestions` is a `.filter()` of the cached list, `HubTab.tsx:606`).
   Questions of other briefings in the cache are left untouched.
4. `await reorderBriefingQuestions(updates)`.
5. On error: `toast.error(...)` and
   `qc.invalidateQueries(['hub-briefing-questions', clienteId])` to resync.

This mirrors the optimistic-cache approach already used for the new-briefing
selection fix. A small cache helper (e.g. `applyReorderToCache(list, briefingId,
orderedIds)`) keeps this logic testable.

## Behavior notes

- **Sections reorder while collapsed** (drag the header handle). **Question
  reorder requires expanding** the section first (questions render only when
  expanded — `HubTab.tsx:1101`).
- Drag is **disabled for a question currently being edited** (`editingId === q.id`)
  so the inline input is not hijacked.
- Single-question sections / single-section briefings: nothing to reorder; handles
  still render but produce no-op drags.

## Testing

- **`apps/crm/src/lib/__tests__/briefingReorder.test.ts`** (pure, no rendering):
  - reorder a question down/up within a section → correct minimal `updates`,
    `display_order` contiguous, sections stay contiguous.
  - reorder unsectioned questions among themselves.
  - reorder sections (move B above A) → whole block moves, `display_order`
    renumbered, only changed rows returned.
  - cross-section question move → returns `[]` (guarded no-op).
  - no-op move (`fromId === toId`) → returns `[]`.
- **Store test** for `reorderBriefingQuestions` (mock supabase) — calls update per
  changed row, throws on error, no call when empty. Follow existing store test
  setup under `apps/crm/src/__tests__/`.
- Typecheck (`npm run build`) and full `npm run test` must stay green.

## Files touched

- `apps/crm/src/lib/briefingReorder.ts` — new, pure reorder helpers.
- `apps/crm/src/lib/__tests__/briefingReorder.test.ts` — new tests.
- `apps/crm/src/store/hub.ts` — new `reorderBriefingQuestions`.
- `apps/crm/src/pages/cliente-detalhe/BriefingReorder.tsx` — new sortable
  components.
- `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` — wire dnd contexts, grip
  handles, optimistic persist; render questions/sections through the sortable
  wrappers.
- (no Hub / edge-function / migration changes)
