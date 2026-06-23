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
  Since both within-section question order and section (first-appearance) order are
  derived from `display_order`, reordering in the CRM moves both questions and
  section tabs on the client side. **No Hub or edge-function changes are required.**

## Data model & reorder math

The desired persisted flat order is:

```
[ unsectioned questions… , section A questions… , section B questions… , … ]
```

- **Unsectioned block is pinned at the top** and is not part of section
  reordering (it has no header to grab). Its questions are still reorderable among
  themselves.
- **Section reordering** permutes the named-section blocks within the flat list.
- **Question reordering** permutes questions within a single block (unsectioned or
  a named section).

**Do not assume the input is contiguous.** Existing mutation paths can leave a
briefing's `display_order` non-contiguous per section — `addHubBriefingQuestion`
always appends `max(display_order)+1` (`store/hub.ts:199`), and CSV import /
template apply can interleave repeated section labels. This is *not* user-visible:
both the CRM editor (`HubTab.tsx:712`) and the Hub (`BriefingPage.tsx:34`) group
by section **first-appearance**, not by contiguity, so a question added to a
middle section still renders at the bottom of its own section on both sides. We
therefore **do not change add/import/template**; instead the reorder helpers
tolerate non-contiguous input and normalize it.

A pure helper computes the new persisted order. It mirrors the render's grouping
(group by `section ?? ''` in first-appearance order, questions kept in input
order within each group), applies the move, flattens back to the canonical flat
order above, assigns `display_order = index`, and so **heals non-contiguity as a
side effect of any reorder**:

```ts
// apps/crm/src/lib/briefingReorder.ts
type Q = { id: string; section: string | null; display_order: number };

// Reorder questions within one section (sectionKey === '' for unsectioned).
// Groups `questions` by first-appearance; no-op (returns []) if from/to are in
// different sections or fromId === toId.
function reorderQuestionWithinSection(
  questions: Q[],        // all questions of the briefing, current array order
  sectionKey: string,    // '' for unsectioned
  fromId: string,
  toId: string,
): { id: string; display_order: number }[];

// Reorder whole section blocks (named sections only). `from`/`to` are raw section
// names; current section order is derived by first-appearance.
function reorderSections(
  questions: Q[],
  fromSection: string,
  toSection: string,
): { id: string; display_order: number }[];
```

Both rebuild the flat order, assign `display_order = index`, and return **only the
rows whose `display_order` changed** (minimal write set; matches the
`reorderWorkflowPosts` precedent which also persists a renumbered list).

## Persistence

New store function in `apps/crm/src/store/hub.ts`:

```ts
export async function reorderBriefingQuestions(
  updates: { id: string; display_order: number }[],
): Promise<void>
```

Implementation: `await Promise.all(updates.map(u =>
supabase.from('hub_briefing_questions').update({ display_order: u.display_order })
.eq('id', u.id).then(({ error }) => { if (error) throw error; })))`. Skip the call
entirely when `updates` is empty.

This intentionally mirrors the existing reorder precedent `reorderWorkflowPosts`
(`store/posts.ts:397`), which persists workflow-post order the same way — per-row
`Promise.all` updates with optimistic UI and invalidate-on-error — even though the
Workflow UI also orders by the persisted column.

**On atomicity (considered, declined):** a partial `Promise.all` failure (e.g.
mid-batch network drop) could transiently leave duplicate `display_order` values,
and since the Hub orders by `display_order` (`hub-briefing/handler.ts:44`) ties
break arbitrarily until the next successful reorder. A Postgres RPC/transaction
would make the write atomic, but it diverges from the established pattern and adds
a migration + RLS surface for a failure that is transient, non-corrupting (section
grouping is first-appearance based, so questions never leave their section), and
self-healing: `onError` invalidates and refetches the server truth, and any
subsequent reorder renumbers the whole affected set. We follow the precedent; an
RPC can be revisited if instability is observed in practice.

## UI / dnd structure

Extract two small sortable components into a new file
`apps/crm/src/pages/cliente-detalhe/BriefingReorder.tsx` to avoid growing
`HubTab.tsx` (~1150 lines):

- `SortableQuestion` — wraps a question card with `useSortable({ id: q.id })`
  (raw question uuid). Renders its children (existing card markup) plus a
  `GripVertical` drag handle.
- `SortableSection` — wraps a named-section block with
  `useSortable({ id: 'section:' + name })`, exposing a grip handle next to the
  collapse toggle so dragging the section never triggers collapse.

**Sortable IDs (must match between `items` and `useSortable`):**

- Section items are **prefixed**: the outer `SortableContext` is
  `items={namedSections.map(s => 'section:' + s.name)}` and each `SortableSection`
  uses `useSortable({ id: 'section:' + s.name })`. `onDragEnd` strips the
  `'section:'` prefix to recover the raw name before calling `reorderSections`.
- Question items are **raw uuids**: each inner `SortableContext` is
  `items={s.questions.map(q => q.id)}` and each `SortableQuestion` uses
  `useSortable({ id: q.id })`. uuids never collide with the `section:` namespace.

**Drag handle (keyboard-accessible):** the grip handle is a focusable
`<button type="button">` that receives **both** `{...attributes}` and
`{...listeners}` from `useSortable` (handle-scoped — not on the whole card/header),
so pointer drag and `KeyboardSensor` both work and the existing
Editar/Trash/collapse controls keep their own click behavior.

**Nested dnd contexts** to enforce "no cross-section":

- An **outer** `DndContext` + `SortableContext` (the prefixed section items above)
  for section reordering. `onDragEnd` → strip prefix → `reorderSections(...)`.
- An **inner** `DndContext` + `SortableContext` **per section** (and one for the
  unsectioned block) over that section's question ids, for question reordering.
  `onDragEnd` → `reorderQuestionWithinSection(...)`.

Because each question's sortable context is scoped to its own section, dragging a
question into another section is structurally impossible — matching the chosen
scope and keeping each piece independently reasoned about. Handle-scoped listeners
prevent pointer-sensor conflicts between the nested contexts.

Sensors: `PointerSensor` (with a small activation distance so taps still click)
and `KeyboardSensor` (`sortableKeyboardCoordinates`) for accessibility, mirroring
`WorkflowModals.tsx`.

## Optimistic update flow

On a successful drag:

1. Compute `updates` via the pure helper.
2. If empty, do nothing.
3. `await qc.cancelQueries({ queryKey: ['hub-briefing-questions', clienteId] })`
   so an in-flight refetch cannot overwrite the optimistic order while the
   mutation is pending.
4. Optimistically rewrite the React Query cache
   `['hub-briefing-questions', clienteId]` so the affected briefing's questions
   appear **in the new array order** (and their `display_order` fields match).
   **Reordering the array is required, not just patching `display_order`** — the
   editor renders in array order and never re-sorts by `display_order`
   (`briefingQuestions` is a `.filter()` of the cached list, `HubTab.tsx:606`).
   Questions of other briefings in the cache are left untouched.
5. `await reorderBriefingQuestions(updates)`.
6. On error: `toast.error(...)` and
   `qc.invalidateQueries({ queryKey: ['hub-briefing-questions', clienteId] })` to
   resync (v5 object form, matching `HubTab.tsx:599`).

This mirrors the optimistic-cache approach already used for the new-briefing
selection fix. A small **pure** cache helper
`applyReorderToCache(list, briefingId, orderedIds)` performs step 4 and is unit
tested (see below).

## Behavior notes

- **Sections reorder while collapsed** (drag the header handle). **Question
  reorder requires expanding** the section first (questions render only when
  expanded — `HubTab.tsx:1101`).
- Drag is **disabled for a question currently being edited** (`editingId === q.id`)
  so the inline input is not hijacked.
- Single-question sections / single-section briefings: nothing to reorder; handles
  still render but produce no-op drags.

## Testing

- **`apps/crm/src/lib/__tests__/briefingReorder.test.ts`** — reorder math (pure,
  no rendering):
  - reorder a question down/up within a section → correct minimal `updates`,
    output `display_order` contiguous.
  - reorder unsectioned questions among themselves.
  - reorder sections (move B above A) → whole block moves, `display_order`
    renumbered, only changed rows returned.
  - cross-section question move → returns `[]` (guarded no-op).
  - no-op move (`fromId === toId`) → returns `[]`.
  - **non-contiguous input** (e.g. section A at `display_order` 0,1,4 and B at 2,3)
    → reorder still groups by first-appearance and the output is normalized to a
    contiguous flat order (proves helpers tolerate + heal non-contiguity).
- **`apps/crm/src/lib/__tests__/briefingReorder.test.ts`** (same file) —
  `applyReorderToCache`: given the full client questions list, reorders the target
  briefing's questions into `orderedIds` order **and leaves questions of other
  briefings untouched** (covers the UI-critical array-reorder requirement that the
  pure reorder math alone won't catch).
- **Store test** for `reorderBriefingQuestions` (mock supabase) — calls update per
  changed row, throws on error, no call when empty. Follow existing store test
  setup under `apps/crm/src/__tests__/`.
- Typecheck (`npm run build`) and full `npm run test` must stay green.

## Files touched

- `apps/crm/src/lib/briefingReorder.ts` — new, pure reorder helpers
  (`reorderQuestionWithinSection`, `reorderSections`, `applyReorderToCache`).
- `apps/crm/src/lib/__tests__/briefingReorder.test.ts` — new tests.
- `apps/crm/src/store/hub.ts` — new `reorderBriefingQuestions`.
- `apps/crm/src/pages/cliente-detalhe/BriefingReorder.tsx` — new sortable
  components.
- `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` — wire dnd contexts, grip
  handles, optimistic persist; render questions/sections through the sortable
  wrappers.
- (no Hub / edge-function / migration changes)
