# Calendar Rescheduling Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rearrange a client's whole month from one calendar — reschedule posts belonging to other workflows, drag a post by its whole body instead of a 10px grip, and see which days are already busy while picking a publish date.

**Architecture:** Three independent frontend slices over `apps/crm/src/pages/entregas/`. Slice 1 relaxes a client-side permission gate (`canDrag`) and adds a guard so the one still-forbidden action fails loudly instead of silently. Slice 2 relocates dnd-kit listeners from the grip to the pill root, with a click-suppression ref for the trailing click a drag emits. Slice 3 adds an optional, domain-ignorant `dayMarkers` prop to the shared `DateTimePicker`, fed by a pure helper. No backend work: `updateWorkflowPost` updates by post id under RLS scoped on `conta_id` and performs no workflow check.

**Tech Stack:** React 19, TypeScript, TanStack Query, `@dnd-kit/core`, `react-day-picker` v9, `date-fns`, `sonner`, Vitest + React Testing Library.

**Spec:** [docs/superpowers/specs/2026-07-23-calendar-rescheduling-ergonomics-design.md](../specs/2026-07-23-calendar-rescheduling-ergonomics-design.md)

## Global Constraints

- **Language:** all user-facing copy is Portuguese (pt-BR). Never introduce English strings into the UI.
- **Toasts:** use `toast()` from `sonner`. Never the legacy `showToast()` from `router.ts`.
- **Icons:** `lucide-react` only.
- **Locked statuses** are `agendado`, `postado`, `falha_publicacao` (`LOCKED_STATUSES` in `CalendarGrid.tsx`). These block every date edit regardless of which workflow owns the post — this plan never relaxes them.
- **Unschedule stays workflow-scoped.** Dragging to `Sem data` / `Remover data` remains available only for posts whose `workflow_id === currentWorkflowId`.
- **CRM tipo palette** (do NOT use the Hub's different values): `feed #eab308`, `reels #E1306C`, `stories #42c8f5`, `carrossel #3ecf8e`.
- **Fixed dot order** wherever tipo dots render: `feed`, `carrossel`, `reels`, `stories`.
- **Day keys** are local-time `yyyy-MM-dd` strings, built the same way `DroppableCell` builds its droppable id — never `toISOString().slice(0,10)`, which shifts across the UTC boundary.
- **CI gates:** `npm run lint`, `npm run format:check`, `npm run test`, `npm run build` all run in CI. Run them before pushing.
- **Commits:** conventional prefixes (`feat:`, `fix:`, `refactor:`, `test:`), one per task.

---

### Task 1: Consolidate the tipo palette and labels

Pure refactor, no behavior change. Slice 3 needs one canonical tipo palette; the codebase currently has three color copies and four label copies. Doing this first keeps later tasks small.

Findings that shape this task:
- `CalendarGrid.tsx:11` declares `TIPO_COLORS` and **never uses it** — it is dead code. Delete it, do not migrate it.
- `UnscheduledPostsSidebar.tsx:4` stores `{bg, text}` pairs where every `bg` is the same hex as `text` with a `25` alpha suffix. Derive it rather than keeping a second source.
- `postLabels.ts` already exports `TIPO_LABELS`. Four files shadow it anyway.

**Files:**
- Modify: `apps/crm/src/pages/entregas/postLabels.ts` (add exports after `TIPO_LABELS`, line 8)
- Modify: `apps/crm/src/pages/entregas/components/CalendarGrid.tsx:11-22` (delete both consts, import)
- Modify: `apps/crm/src/pages/entregas/components/UnscheduledPostsSidebar.tsx:4-16` (delete both consts, import)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx:23-28` (delete const, import)
- Modify: `apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx:27-32` (delete const, import)
- Modify: `apps/crm/src/pages/entregas/components/HistoryDrawer.tsx:24-29` (delete const, import)
- Test: `apps/crm/src/pages/entregas/__tests__/postLabels.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TIPO_COLORS: Record<WorkflowPost['tipo'], string>` — solid hex per tipo.
  - `TIPO_BADGE_COLORS: Record<WorkflowPost['tipo'], { bg: string; text: string }>` — `text` is the solid hex, `bg` is the same hex + `25` alpha suffix.
  - `TIPO_ORDER: readonly WorkflowPost['tipo'][]` — `['feed', 'carrossel', 'reels', 'stories']`, the fixed dot order used by Task 7.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/__tests__/postLabels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TIPO_COLORS, TIPO_BADGE_COLORS, TIPO_ORDER, TIPO_LABELS } from '../postLabels';

describe('tipo palette', () => {
  it('uses the CRM palette, not the Hub palette', () => {
    expect(TIPO_COLORS).toEqual({
      feed: '#eab308',
      reels: '#E1306C',
      stories: '#42c8f5',
      carrossel: '#3ecf8e',
    });
  });

  it('derives badge colors as text = solid hex, bg = hex + 25 alpha', () => {
    expect(TIPO_BADGE_COLORS.carrossel).toEqual({ bg: '#3ecf8e25', text: '#3ecf8e' });
    for (const tipo of TIPO_ORDER) {
      expect(TIPO_BADGE_COLORS[tipo].text).toBe(TIPO_COLORS[tipo]);
      expect(TIPO_BADGE_COLORS[tipo].bg).toBe(`${TIPO_COLORS[tipo]}25`);
    }
  });

  it('orders tipos feed, carrossel, reels, stories', () => {
    expect(TIPO_ORDER).toEqual(['feed', 'carrossel', 'reels', 'stories']);
  });

  it('covers every tipo that has a label', () => {
    expect(Object.keys(TIPO_COLORS).sort()).toEqual(Object.keys(TIPO_LABELS).sort());
    expect([...TIPO_ORDER].sort()).toEqual(Object.keys(TIPO_LABELS).sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- postLabels
```

Expected: FAIL — `TIPO_COLORS`, `TIPO_BADGE_COLORS`, `TIPO_ORDER` are not exported from `../postLabels`.

- [ ] **Step 3: Add the exports**

In `apps/crm/src/pages/entregas/postLabels.ts`, insert immediately after the `TIPO_LABELS` block (after line 8):

```ts
export const TIPO_COLORS: Record<WorkflowPost['tipo'], string> = {
  feed: '#eab308',
  reels: '#E1306C',
  stories: '#42c8f5',
  carrossel: '#3ecf8e',
};

/** Fixed render order for tipo dots/swatches, so a day looks identical across refetches. */
export const TIPO_ORDER = ['feed', 'carrossel', 'reels', 'stories'] as const satisfies readonly WorkflowPost['tipo'][];

/** Badge pair: solid text color over a 25-alpha tint of itself. */
export const TIPO_BADGE_COLORS: Record<WorkflowPost['tipo'], { bg: string; text: string }> =
  Object.fromEntries(
    (Object.keys(TIPO_COLORS) as WorkflowPost['tipo'][]).map((tipo) => [
      tipo,
      { bg: `${TIPO_COLORS[tipo]}25`, text: TIPO_COLORS[tipo] },
    ]),
  ) as Record<WorkflowPost['tipo'], { bg: string; text: string }>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- postLabels
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Delete the shadow in CalendarGrid**

In `apps/crm/src/pages/entregas/components/CalendarGrid.tsx`, delete lines 11-22 entirely (both `TIPO_COLORS` — which is unused dead code — and `TIPO_LABELS`), then add to the imports:

```ts
import { TIPO_LABELS } from '../postLabels';
```

- [ ] **Step 6: Delete the shadows in UnscheduledPostsSidebar**

In `apps/crm/src/pages/entregas/components/UnscheduledPostsSidebar.tsx`, delete lines 4-16 (`TIPO_COLORS` and `TIPO_LABELS`) and add:

```ts
import { TIPO_LABELS, TIPO_BADGE_COLORS } from '../postLabels';
```

Then update the two use sites. Line 32 becomes:

```ts
const colors = TIPO_BADGE_COLORS[post.tipo];
```

and line 49 drops its now-unreachable fallback (the record is exhaustive over the tipo union):

```tsx
{TIPO_LABELS[post.tipo]}
```

- [ ] **Step 7: Delete the remaining three shadows**

- `WorkflowCalendarView.tsx`: delete lines 23-28, add `TIPO_LABELS` to the existing `from '../postLabels'` import if present, otherwise add `import { TIPO_LABELS } from '../postLabels';`.
- `CalendarPostDetailPanel.tsx`: delete lines 27-32 (`TIPO_COLORS`); it already imports from `'../postLabels'` at line 20-25 — add `TIPO_COLORS` to that existing import list.
- `HistoryDrawer.tsx`: delete lines 24-29 (`TIPO_LABELS`) and import it from `'../postLabels'`.

- [ ] **Step 8: Verify nothing regressed**

```bash
npm run test -- entregas
```

Expected: PASS. Existing `CalendarGrid.test.tsx`, `CalendarPostDetailPanel.test.tsx`, `WorkflowCalendarView.test.tsx` all still pass — this task changed no rendered output.

```bash
npm run lint && npm run build
```

Expected: both clean. `npm run build` runs `tsc`, which is what proves the six files resolve the new imports.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/entregas/
git commit -m "refactor(entregas): consolidate tipo palette and labels into postLabels"
```

---

### Task 2: `resolveCalendarDrop` decision function

The drop handler decides between four outcomes. Extracting that decision as a pure function makes it exhaustively testable — the existing `WorkflowCalendarView.test.tsx` mocks `@dnd-kit/core` wholesale (`useDraggable` returns stubs), so drag outcomes cannot otherwise be exercised through the component.

**Files:**
- Create: `apps/crm/src/pages/entregas/calendarDrop.ts`
- Test: `apps/crm/src/pages/entregas/__tests__/calendarDrop.test.ts` (create)

**Interfaces:**
- Consumes: `ClientePost` from `@/store/posts`.
- Produces:

```ts
export type CalendarDropResult =
  | { kind: 'noop' }
  | { kind: 'unschedule' }
  | { kind: 'reject-foreign-unschedule' }
  | { kind: 'schedule'; date: Date; previousTime?: { hour: number; minute: number } };

export function resolveCalendarDrop(args: {
  post: ClientePost | undefined;
  overId: string | undefined;
  currentWorkflowId: number;
}): CalendarDropResult;

export function formatRescheduleToast(args: {
  post: Pick<ClientePost, 'workflow_id' | 'workflow_titulo'> | undefined;
  datetime: Date;
  verb: 'agendado' | 'reagendado';
  currentWorkflowId: number;
}): string;
```

Task 3 consumes both: `resolveCalendarDrop` maps each `kind` onto a side effect, and
`formatRescheduleToast` builds the success copy for **both** reschedule paths
(`handleTimeConfirm` and `handlePanelReschedule`) so the wording lives in exactly one place.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/__tests__/calendarDrop.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveCalendarDrop } from '../calendarDrop';
import type { ClientePost } from '@/store/posts';

function mkPost(over: Partial<ClientePost> = {}): ClientePost {
  return {
    id: 1,
    workflow_id: 10,
    titulo: 'Post',
    tipo: 'feed',
    status: 'rascunho',
    scheduled_at: null,
    ordem: 0,
    workflow_titulo: 'WF',
    ...over,
  };
}

describe('resolveCalendarDrop', () => {
  it('is a noop when there is no post or no drop target', () => {
    expect(resolveCalendarDrop({ post: undefined, overId: 'date-2026-07-24', currentWorkflowId: 10 }))
      .toEqual({ kind: 'noop' });
    expect(resolveCalendarDrop({ post: mkPost(), overId: undefined, currentWorkflowId: 10 }))
      .toEqual({ kind: 'noop' });
  });

  it('unschedules an own scheduled post dropped on the sidebar', () => {
    const post = mkPost({ scheduled_at: '2026-07-20T13:00:00.000Z' });
    expect(resolveCalendarDrop({ post, overId: 'unscheduled-zone', currentWorkflowId: 10 }))
      .toEqual({ kind: 'unschedule' });
  });

  it('is a noop when an already-unscheduled post is dropped on the sidebar', () => {
    expect(resolveCalendarDrop({ post: mkPost(), overId: 'unscheduled-zone', currentWorkflowId: 10 }))
      .toEqual({ kind: 'noop' });
  });

  it('rejects unscheduling a post owned by another workflow', () => {
    const post = mkPost({ workflow_id: 99, scheduled_at: '2026-07-20T13:00:00.000Z' });
    expect(resolveCalendarDrop({ post, overId: 'unscheduled-zone', currentWorkflowId: 10 }))
      .toEqual({ kind: 'reject-foreign-unschedule' });
  });

  it('schedules a post dropped on a date cell, with no previous time', () => {
    const result = resolveCalendarDrop({
      post: mkPost(),
      overId: 'date-2026-07-24',
      currentWorkflowId: 10,
    });
    expect(result).toEqual({ kind: 'schedule', date: new Date(2026, 6, 24) });
  });

  it('carries the previous time forward when rescheduling', () => {
    const post = mkPost({ scheduled_at: '2026-07-20T13:45:00.000Z' });
    const prev = new Date('2026-07-20T13:45:00.000Z');
    const result = resolveCalendarDrop({
      post,
      overId: 'date-2026-07-24',
      currentWorkflowId: 10,
    });
    expect(result).toEqual({
      kind: 'schedule',
      date: new Date(2026, 6, 24),
      previousTime: { hour: prev.getHours(), minute: prev.getMinutes() },
    });
  });

  it('allows rescheduling a post owned by another workflow', () => {
    const post = mkPost({ workflow_id: 99, scheduled_at: '2026-07-20T13:00:00.000Z' });
    const result = resolveCalendarDrop({ post, overId: 'date-2026-07-24', currentWorkflowId: 10 });
    expect(result.kind).toBe('schedule');
  });

  it('is a noop for an unrecognised drop target', () => {
    expect(resolveCalendarDrop({ post: mkPost(), overId: 'something-else', currentWorkflowId: 10 }))
      .toEqual({ kind: 'noop' });
  });
});

describe('formatRescheduleToast', () => {
  const datetime = new Date(2026, 6, 24, 20, 0);

  it('does not name the workflow for an own post', () => {
    expect(formatRescheduleToast({
      post: mkPost(), datetime, verb: 'reagendado', currentWorkflowId: 10,
    })).toBe('Post reagendado para 24/07/2026 às 20:00');
  });

  it('names the owning workflow for a foreign post', () => {
    expect(formatRescheduleToast({
      post: mkPost({ workflow_id: 99, workflow_titulo: 'Agosto — Carrosséis' }),
      datetime, verb: 'reagendado', currentWorkflowId: 10,
    })).toBe('Post de «Agosto — Carrosséis» reagendado para 24/07/2026 às 20:00');
  });

  it('uses the agendado verb for a first-time schedule', () => {
    expect(formatRescheduleToast({
      post: mkPost(), datetime, verb: 'agendado', currentWorkflowId: 10,
    })).toBe('Post agendado para 24/07/2026 às 20:00');
  });

  it('falls back to the plain form when the post is missing', () => {
    expect(formatRescheduleToast({
      post: undefined, datetime, verb: 'reagendado', currentWorkflowId: 10,
    })).toBe('Post reagendado para 24/07/2026 às 20:00');
  });

  it('zero-pads single-digit times', () => {
    expect(formatRescheduleToast({
      post: mkPost(), datetime: new Date(2026, 6, 5, 9, 5), verb: 'agendado', currentWorkflowId: 10,
    })).toContain('às 09:05');
  });
});
```

Add `formatRescheduleToast` to the import at the top of the test file.

Note the `previousTime` test derives its expectation from `getHours()`/`getMinutes()` on the parsed date rather than hardcoding `13:45`, so it passes in any machine timezone.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- calendarDrop
```

Expected: FAIL — cannot resolve `../calendarDrop`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/pages/entregas/calendarDrop.ts`:

```ts
import { parseISO } from 'date-fns';
import type { ClientePost } from '@/store/posts';

export type CalendarDropResult =
  | { kind: 'noop' }
  | { kind: 'unschedule' }
  | { kind: 'reject-foreign-unschedule' }
  | { kind: 'schedule'; date: Date; previousTime?: { hour: number; minute: number } };

/**
 * Decides what a calendar drag-end means. Pure: no toasts, no mutations.
 *
 * Rescheduling is allowed for any unlocked post, including posts owned by other
 * workflows. Unscheduling stays scoped to the current workflow, because the
 * sidebar only lists this workflow's backlog — an unscheduled foreign post would
 * drop out of every visible surface.
 */
export function resolveCalendarDrop({
  post,
  overId,
  currentWorkflowId,
}: {
  post: ClientePost | undefined;
  overId: string | undefined;
  currentWorkflowId: number;
}): CalendarDropResult {
  if (!post || !overId) return { kind: 'noop' };

  if (overId === 'unscheduled-zone') {
    if (!post.scheduled_at) return { kind: 'noop' };
    if (post.workflow_id !== currentWorkflowId) return { kind: 'reject-foreign-unschedule' };
    return { kind: 'unschedule' };
  }

  if (overId.startsWith('date-')) {
    const [y, m, d] = overId.replace('date-', '').split('-').map(Number);
    const date = new Date(y, m - 1, d);

    if (!post.scheduled_at) return { kind: 'schedule', date };

    const prev = parseISO(post.scheduled_at);
    return {
      kind: 'schedule',
      date,
      previousTime: { hour: prev.getHours(), minute: prev.getMinutes() },
    };
  }

  return { kind: 'noop' };
}

/**
 * Success copy for both reschedule paths (drag-drop confirm and the detail panel picker).
 * Names the owning workflow when the post isn't ours, so the user knows what they touched.
 * A missing post (deleted in another tab mid-flow) degrades to the plain form.
 */
export function formatRescheduleToast({
  post,
  datetime,
  verb,
  currentWorkflowId,
}: {
  post: Pick<ClientePost, 'workflow_id' | 'workflow_titulo'> | undefined;
  datetime: Date;
  verb: 'agendado' | 'reagendado';
  currentWorkflowId: number;
}): string {
  const hh = String(datetime.getHours()).padStart(2, '0');
  const mm = String(datetime.getMinutes()).padStart(2, '0');
  const when = `${datetime.toLocaleDateString('pt-BR')} às ${hh}:${mm}`;
  const owner =
    post && post.workflow_id !== currentWorkflowId ? `Post de «${post.workflow_titulo}»` : 'Post';
  return `${owner} ${verb} para ${when}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- calendarDrop
```

Expected: PASS, 13 tests (8 for resolveCalendarDrop, 5 for formatRescheduleToast).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/calendarDrop.ts apps/crm/src/pages/entregas/__tests__/calendarDrop.test.ts
git commit -m "feat(entregas): add calendar drop resolution and toast formatting"
```

---

### Task 3: Wire cross-workflow rescheduling into WorkflowCalendarView

Replaces the inline drag-end branching with `resolveCalendarDrop`, parameterises cache invalidation, names the foreign workflow in the success toast, and fixes two `useCallback` dependency arrays that would otherwise capture stale values.

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx:85-191`
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx` (extend)

**Interfaces:**
- Consumes: `resolveCalendarDrop`, `CalendarDropResult` from Task 2.
- Produces: `invalidateQueries(workflowId?: number)` — internal to this component; no external surface changes.

- [ ] **Step 1: Extend the dnd-kit mock to capture `onDragEnd`**

The existing mock at `WorkflowCalendarView.test.tsx:7-26` swallows `DndContext`'s props. Replace the `DndContext` line and add a capture handle. Also add `useDndContext`, which Task 4's sidebar change will call — without it the mock throws `useDndContext is not a function`.

```tsx
// Mock dnd-kit so it doesn't require pointer/touch events in jsdom
export const dndHandlers: { onDragEnd?: (e: unknown) => void } = {};
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd?: (e: unknown) => void;
  }) => {
    dndHandlers.onDragEnd = onDragEnd;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCenter: () => null,
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
  useDndContext: () => ({ active: null }),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    setActivatorNodeRef: () => {},
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));
```

`vi.mock` is hoisted, so `dndHandlers` must be declared with `const dndHandlers = ...` *inside* the factory scope or accessed via `vi.hoisted`. Use `vi.hoisted` to be safe:

```tsx
const dndHandlers = vi.hoisted(() => ({ onDragEnd: undefined as ((e: unknown) => void) | undefined }));
```

placed above the `vi.mock` call, with the factory assigning `dndHandlers.onDragEnd = onDragEnd`.

- [ ] **Step 2: Write the failing tests**

Append to `WorkflowCalendarView.test.tsx`. These assume the file's existing `mockGetClientePosts` / `mockUpdate` helpers and `renderWithQuery` / `baseProps` (`currentWorkflowId: 10`).

```tsx
import { toast } from 'sonner';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const foreignPost = {
  id: 77,
  workflow_id: 99,
  titulo: 'Post de outro fluxo',
  tipo: 'carrossel' as const,
  status: 'rascunho' as const,
  scheduled_at: '2026-07-20T13:00:00.000Z',
  ordem: 0,
  workflow_titulo: 'Agosto — Carrosséis',
};

describe('cross-workflow rescheduling', () => {
  it('refuses to unschedule a foreign post and explains why', async () => {
    mockGetClientePosts.mockResolvedValue([foreignPost]);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    await screen.findByTitle(/Agosto — Carrosséis/);

    dndHandlers.onDragEnd?.({
      active: { id: 'post-77', data: { current: { post: foreignPost } } },
      over: { id: 'unscheduled-zone' },
    });

    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('names the owning workflow when a foreign post is rescheduled', async () => {
    mockGetClientePosts.mockResolvedValue([foreignPost]);
    mockUpdate.mockResolvedValue({} as never);
    renderWithQuery(<WorkflowCalendarView {...baseProps} />);
    await screen.findByTitle(/Agosto — Carrosséis/);

    dndHandlers.onDragEnd?.({
      active: { id: 'post-77', data: { current: { post: foreignPost } } },
      over: { id: 'date-2026-07-24' },
    });

    // Time picker opens; confirm at the carried-over time.
    // TimePickerPopover.tsx:84 — the button's text is exactly "Confirmar".
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(77, expect.objectContaining({
      scheduled_at: expect.any(String),
    })));
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain('Agosto — Carrosséis');
  });
});
```

`sonner` must be mocked before the component imports it; keep the `vi.mock('sonner', …)` call at the top of the file with the other mocks, not inside the `describe`.

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm run test -- WorkflowCalendarView
```

Expected: FAIL — `toast.info` not called (the current code silently returns for foreign unschedules), and the success toast contains no workflow name.

- [ ] **Step 4: Parameterise `invalidateQueries`**

Replace `WorkflowCalendarView.tsx:85-89`:

```ts
const invalidateQueries = useCallback(
  (workflowId?: number) => {
    qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', currentWorkflowId] });
    if (workflowId != null && workflowId !== currentWorkflowId) {
      qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
    }
    qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
  },
  [qc, clienteId, currentWorkflowId],
);
```

- [ ] **Step 5: Rewrite `handleDragEnd` over `resolveCalendarDrop`**

Replace `WorkflowCalendarView.tsx:96-137`:

```ts
const handleDragEnd = useCallback(
  async (event: DragEndEvent) => {
    setActivePost(null);
    const post = event.active.data.current?.post as ClientePost | undefined;
    const result = resolveCalendarDrop({
      post,
      overId: event.over ? String(event.over.id) : undefined,
      currentWorkflowId,
    });

    switch (result.kind) {
      case 'noop':
        return;

      case 'reject-foreign-unschedule':
        toast.info('Só é possível remover a data de posts deste workflow.');
        return;

      case 'unschedule':
        try {
          await updateWorkflowPost(post!.id, { scheduled_at: null });
          invalidateQueries(post!.workflow_id);
          toast.success('Data removida do post');
        } catch {
          toast.error('Erro ao remover data do post');
        }
        return;

      case 'schedule':
        setPendingDrop({
          postId: post!.id,
          date: result.date,
          previousTime: result.previousTime,
        });
        return;
    }
  },
  [invalidateQueries, currentWorkflowId],
);
```

Add the import: `import { resolveCalendarDrop, formatRescheduleToast } from '../calendarDrop';`

- [ ] **Step 6: Resolve the moved post in `handleTimeConfirm`**

`pendingDrop` keeps its existing shape — no new fields. Replace `WorkflowCalendarView.tsx:139-158`:

```ts
const handleTimeConfirm = useCallback(
  async (datetime: Date) => {
    if (!pendingDrop) return;
    const moved = allPosts.find((p) => p.id === pendingDrop.postId);
    try {
      await updateWorkflowPost(pendingDrop.postId, { scheduled_at: datetime.toISOString() });
      invalidateQueries(moved?.workflow_id);
      toast.success(
        formatRescheduleToast({
          post: moved,
          datetime,
          verb: pendingDrop.previousTime != null ? 'reagendado' : 'agendado',
          currentWorkflowId,
        }),
      );
    } catch {
      toast.error('Erro ao agendar post');
    } finally {
      setPendingDrop(null);
    }
  },
  [pendingDrop, invalidateQueries, allPosts, currentWorkflowId],
);
```

`allPosts` is now a dependency. When `moved` is `undefined` (post deleted in another tab between drop and confirm) the copy falls back to the plain `Post ...` form rather than throwing.

- [ ] **Step 7: Fix the stale closure in `handlePanelReschedule`**

Replace `WorkflowCalendarView.tsx:164-178`. The current deps are `[selectedPostId, invalidateQueries]`; reading `selectedPost` without adding it would pin the callback to whichever post was selected on first render — silently, with no error.

```ts
const handlePanelReschedule = useCallback(
  async (datetime: Date) => {
    if (!selectedPost) return;
    try {
      await updateWorkflowPost(selectedPost.id, { scheduled_at: datetime.toISOString() });
      invalidateQueries(selectedPost.workflow_id);
      toast.success(
        formatRescheduleToast({
          post: selectedPost,
          datetime,
          verb: 'reagendado',
          currentWorkflowId,
        }),
      );
    } catch {
      toast.error('Erro ao reagendar post');
    }
  },
  [selectedPost, invalidateQueries, currentWorkflowId],
);
```

`selectedPostId` drops out of the deps: `selectedPost` is derived from it, so it already changes whenever the selection does.

- [ ] **Step 8: Pass the workflow id from `handlePanelRemoveDate`**

In `WorkflowCalendarView.tsx:180-191`, capture the workflow id before clearing selection and pass it through:

```ts
const handlePanelRemoveDate = useCallback(async () => {
  if (!selectedPost) return;
  const { id, workflow_id } = selectedPost;
  setSelectedPostId(null);
  try {
    await updateWorkflowPost(id, { scheduled_at: null });
    invalidateQueries(workflow_id);
    toast.success('Data removida do post');
  } catch {
    toast.error('Erro ao remover data do post');
  }
}, [selectedPost, invalidateQueries]);
```

- [ ] **Step 9: Add the stale-closure regression test**

Append to `WorkflowCalendarView.test.tsx`:

```tsx
it('reschedules the currently selected post, not the first one selected', async () => {
  const a = { ...foreignPost, id: 1, workflow_id: 10, titulo: 'Post A', workflow_titulo: 'Campanha Junho' };
  const b = { ...foreignPost, id: 2, workflow_id: 10, titulo: 'Post B', workflow_titulo: 'Campanha Junho' };
  mockGetClientePosts.mockResolvedValue([a, b]);
  mockUpdate.mockResolvedValue({} as never);
  mockPreview.mockResolvedValue({
    conteudo_plain: '', responsavel_id: null, ig_caption: null,
    published_at: null, instagram_permalink: null,
  });
  mockMedia.mockResolvedValue([]);

  renderWithQuery(<WorkflowCalendarView {...baseProps} />);

  fireEvent.click(await screen.findByRole('button', { name: /Post A/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Post B/ }));

  // Reschedule from the detail panel via the date picker.
  fireEvent.click(await screen.findByRole('button', { name: /selecionar data e hora|jul/i }));
  fireEvent.click(await screen.findByRole('button', { name: '28' }));

  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(mockUpdate.mock.calls[0][0]).toBe(2);
});
```

- [ ] **Step 10: Run the tests**

```bash
npm run test -- WorkflowCalendarView
```

Expected: PASS, including the three new tests and every pre-existing one.

- [ ] **Step 11: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx
git commit -m "feat(entregas): allow rescheduling posts from other workflows"
```

---

### Task 4: Relax the pill drag gate and suppress the foreign drop affordance

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/CalendarGrid.tsx:52`
- Modify: `apps/crm/src/pages/entregas/components/UnscheduledPostsSidebar.tsx:61-73`
- Test: `apps/crm/src/pages/entregas/components/__tests__/CalendarGrid.test.tsx` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: foreign unlocked pills now render the grip handle (`aria-label="Mover post (arraste, ou foque e use as setas)"`), which Task 6's tests rely on.

- [ ] **Step 1: Write the failing test**

Append to `CalendarGrid.test.tsx`:

```tsx
describe('cross-workflow drag gate', () => {
  it('exposes the drag handle on an unlocked post from another workflow', () => {
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 5, titulo: 'Foreign', workflow_id: 99 })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/Mover post/)).toBeInTheDocument();
  });

  it('still hides the drag handle on a locked post from another workflow', () => {
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 6, titulo: 'Locked', workflow_id: 99, status: 'agendado' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/Mover post/)).not.toBeInTheDocument();
  });

  it('still hides the drag handle on a locked post from this workflow', () => {
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 7, titulo: 'Own locked', status: 'postado' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={() => {}}
        onMonthChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/Mover post/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the first one fails**

```bash
npm run test -- CalendarGrid
```

Expected: the foreign-unlocked test FAILS (no handle rendered today); the two locked tests PASS already.

- [ ] **Step 3: Relax the gate**

`CalendarGrid.tsx:52`:

```ts
// Ownership is shown (green pill + workflow name in the detail panel) but is no longer
// a permission boundary for dates — only lock status is. Unscheduling stays own-workflow
// only, enforced in resolveCalendarDrop.
const canDrag = !isLocked;
```

`isCurrentWorkflow` is still used for the pill color and tooltip, so it stays.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- CalendarGrid
```

Expected: PASS, all three.

- [ ] **Step 5: Suppress the sidebar drop affordance for foreign posts**

In `UnscheduledPostsSidebar.tsx`, import `useDndContext` and gate the highlight. The droppable stays **enabled** on purpose: a disabled droppable yields `over === null`, so `handleDragEnd` could not tell the drop apart from a drop on empty space, and the user would get no explanation at all.

```tsx
import { useDroppable, useDraggable, useDndContext } from '@dnd-kit/core';
```

Inside `UnscheduledPostsSidebar`, replacing lines 61-73:

```tsx
const { setNodeRef, isOver } = useDroppable({ id: 'unscheduled-zone' });
const { active } = useDndContext();
const draggingPost = active?.data.current?.post as ClientePost | undefined;
// Don't invite a drop we're going to reject.
const willAccept = !draggingPost || draggingPost.workflow_id === currentWorkflowId;
const highlight = isOver && willAccept;

return (
  <div
    ref={setNodeRef}
    className="calendar-sidebar"
    style={{
      borderColor: highlight ? 'var(--primary-color)' : undefined,
      boxShadow: highlight ? '0 0 12px rgba(234, 179, 8, 0.2)' : undefined,
    }}
  >
```

`currentWorkflowId` is already a prop on this component and was previously used only for filtering, so no signature change is needed.

- [ ] **Step 6: Verify the suite**

```bash
npm run test -- entregas && npm run build
```

Expected: PASS and clean typecheck. The `WorkflowCalendarView.test.tsx` mock already gained `useDndContext` in Task 3 Step 1; if this run reports `useDndContext is not a function`, that mock entry is missing — add it rather than changing the component.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/components/CalendarGrid.tsx apps/crm/src/pages/entregas/components/UnscheduledPostsSidebar.tsx apps/crm/src/pages/entregas/components/__tests__/CalendarGrid.test.tsx
git commit -m "feat(entregas): make foreign-workflow pills draggable, guard the sidebar drop"
```

---

### Task 5: Split the detail panel's permissions

`canEdit = isCurrentWorkflow && !isLocked` currently gates both rescheduling and removal. Rescheduling must follow lock status only; removal stays own-workflow.

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx:80,159-169,195-202`
- Test: `apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx` (extend)

**Interfaces:**
- Consumes: nothing new. Props are unchanged — `isCurrentWorkflow` and `isLocked` are already passed.
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Append to `CalendarPostDetailPanel.test.tsx`, following the file's existing `renderPanel({ ... })` helper:

```tsx
describe('permissions', () => {
  it('lets a foreign unlocked post be rescheduled but not unscheduled or opened', () => {
    renderPanel({ isCurrentWorkflow: false, isLocked: false });
    expect(screen.getByText('Reagendar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remover data/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir post completo/ })).not.toBeInTheDocument();
  });

  it('offers nothing editable on a locked foreign post', () => {
    renderPanel({ isCurrentWorkflow: false, isLocked: true });
    expect(screen.queryByText('Reagendar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remover data/ })).not.toBeInTheDocument();
  });

  it('offers everything on an own unlocked post', () => {
    renderPanel({ isCurrentWorkflow: true, isLocked: false });
    expect(screen.getByText('Reagendar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remover data/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Abrir post completo/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the first one fails**

```bash
npm run test -- CalendarPostDetailPanel
```

Expected: the foreign-unlocked test FAILS — `Reagendar` is absent today.

- [ ] **Step 3: Split the flag**

`CalendarPostDetailPanel.tsx:80`:

```ts
// Rescheduling follows lock status only; removing a date stays own-workflow, because the
// calendar sidebar only lists this workflow's backlog.
const canReschedule = !isLocked;
const canRemoveDate = isCurrentWorkflow && !isLocked;
```

Line 159 becomes `{canReschedule && (`, line 195 becomes `{canRemoveDate && (`. Leave the `isCurrentWorkflow &&` gate on `Abrir post completo` (line 189) untouched — a locked own post still opens.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- CalendarPostDetailPanel
```

Expected: PASS, all three plus the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx
git commit -m "feat(entregas): allow rescheduling foreign posts from the detail panel"
```

---

### Task 6: Whole pill draggable

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/CalendarGrid.tsx:39-120`
- Test: `apps/crm/src/pages/entregas/components/__tests__/CalendarGrid.test.tsx` (extend)

**Interfaces:**
- Consumes: `canDrag` from Task 4.
- Produces: no external change.

- [ ] **Step 1: Write the failing test**

The pointer-drag itself can't be exercised (the suite mocks `@dnd-kit/core`), so test what is observable: the grip no longer swallows clicks, and keyboard select still wins over keyboard drag.

```tsx
describe('whole-pill drag', () => {
  it('selects when the grip itself is clicked', () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 8, titulo: 'Grip click' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={onSelect}
        onMonthChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Mover post/));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('selects on Enter rather than starting a keyboard drag', () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 9, titulo: 'Enter select' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={onSelect}
        onMonthChange={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: /Enter select/ }), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify the first one fails**

```bash
npm run test -- CalendarGrid
```

Expected: the grip-click test FAILS — today the grip calls `stopPropagation` and the pill never selects.

- [ ] **Step 3: Move the listeners to the pill root**

Rewrite the `PostPill` body in `CalendarGrid.tsx`. Two things carry the design:

1. `{...listeners}` goes on the root, and `onKeyDown={handleKeyDown}` is written **after** the spread so it overrides dnd-kit's keyboard listener — otherwise Enter/Space would start a keyboard drag instead of opening the panel.
2. `wasDraggingRef` swallows the synthetic click a completed drag emits, which would otherwise pop the detail panel open the instant you drop.

```tsx
function PostPill({ post, currentWorkflowId, isSelected, onSelect }: { /* unchanged */ }) {
  const isCurrentWorkflow = post.workflow_id === currentWorkflowId;
  const isLocked = LOCKED_STATUSES.has(post.status);
  const canDrag = !isLocked;

  // The whole pill is the drag surface. We still omit dnd's `attributes` (role/aria/tabIndex)
  // because the pill owns its own button semantics, and we re-declare `onKeyDown` after the
  // listener spread so Enter/Space selects instead of starting a keyboard drag. The grip
  // remains the keyboard-drag activator.
  const { listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `post-${post.id}`,
    data: { post },
    disabled: !canDrag,
  });

  const wasDraggingRef = useRef(false);
  useEffect(() => {
    if (isDragging) wasDraggingRef.current = true;
  }, [isDragging]);

  const handleClick = () => {
    // A finished drag emits a trailing click on the origin element; ignore exactly one.
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    onSelect(post);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(post);
    }
  };

  const time = post.scheduled_at ? format(parseISO(post.scheduled_at), 'HH:mm') : '';
  const color = isCurrentWorkflow ? '#eab308' : '#3ecf8e';
  const tooltip = isLocked
    ? LOCKED_TOOLTIPS[post.status] || ''
    : `${TIPO_LABELS[post.tipo]} · ${time} · ${post.workflow_titulo}${!isCurrentWorkflow ? ' (outro workflow)' : ''}`;

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${TIPO_LABELS[post.tipo]} — ${post.titulo || 'Post sem título'}${time ? ` — ${time}` : ''}`}
      className={`calendar-post-pill${isSelected ? ' selected' : ''}`}
      style={{
        background: color,
        opacity: isDragging ? 0.4 : isLocked ? 0.6 : isCurrentWorkflow ? 1 : 0.8,
        cursor: canDrag ? 'grab' : 'pointer',
      }}
      title={tooltip}
      {...(canDrag ? listeners : {})}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {isLocked && <Lock className="h-2.5 w-2.5" style={{ flexShrink: 0 }} />}
      {canDrag && (
        <span
          ref={setActivatorNodeRef}
          className="calendar-pill-handle"
          tabIndex={0}
          aria-label="Mover post (arraste, ou foque e use as setas)"
          style={{ display: 'inline-flex', cursor: 'grab' }}
          onKeyDown={(e) => {
            // Let dnd-kit's keyboard sensor activate a drag from the handle, then stop the
            // event so it doesn't bubble to the pill's select handler.
            (listeners as Record<string, ((ev: KeyboardEvent) => void) | undefined>)?.onKeyDown?.(e);
            e.stopPropagation();
          }}
        >
          <GripVertical className="h-2.5 w-2.5" style={{ flexShrink: 0, opacity: 0.7 }} />
        </span>
      )}
      <span className="pill-text">
        {TIPO_LABELS[post.tipo]} · {time}
      </span>
    </div>
  );
}
```

The grip's `onClick={(e) => e.stopPropagation()}` is **deleted** — with the whole pill clickable, a dead zone in its middle is the exact inconsistency this slice removes, and `wasDraggingRef` already covers the post-drag click regardless of where the drag started.

Update the imports at the top of the file:

```ts
import { useState, useRef, useEffect } from 'react';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- CalendarGrid
```

Expected: PASS, both new tests plus everything from Task 4.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/CalendarGrid.tsx apps/crm/src/pages/entregas/components/__tests__/CalendarGrid.test.tsx
git commit -m "feat(entregas): make the whole calendar pill draggable"
```

---

### Task 7: Hint banner copy

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx:64-66,193-196,204-215`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Update the copy and bump the storage key**

Users who dismissed the old banner have `calendarHintDismissed: 'true'` and would never see the new capability. Bumping the key re-shows it once. The old key is deliberately left in place — reading it would defeat the bump, and it is one stale boolean per browser.

`WorkflowCalendarView.tsx:64-66`:

```tsx
const [hintDismissed, setHintDismissed] = useState(
  () => localStorage.getItem('calendarHintDismissed.v2') === 'true',
);
```

`WorkflowCalendarView.tsx:193-196`:

```tsx
const dismissHint = () => {
  setHintDismissed(true);
  localStorage.setItem('calendarHintDismissed.v2', 'true');
};
```

Banner text at line 207-210. The trailing parenthetical is load-bearing: without it, "inclusive posts de outros workflows" reads as scoping the whole sentence, teaching exactly the one thing that is still forbidden.

```tsx
<span className="calendar-hint-text">
  💡 Arraste posts da lista lateral para agendar, ou entre datas para reagendar — inclusive
  posts de outros workflows. Arraste de volta para remover a data (apenas posts deste
  workflow).
</span>
```

- [ ] **Step 2: Verify**

```bash
npm run test -- WorkflowCalendarView
```

Expected: PASS. If a pre-existing test asserts on the old banner text or the old localStorage key, update that assertion to the new copy/key.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx
git commit -m "feat(entregas): scope the calendar hint copy to what unschedule actually allows"
```

---

### Task 8: `buildTipoDayMarkers` helper

**Files:**
- Modify: `apps/crm/src/pages/entregas/postLabels.ts` (append)
- Test: `apps/crm/src/pages/entregas/__tests__/postLabels.test.ts` (extend)

**Interfaces:**
- Consumes: `TIPO_COLORS`, `TIPO_ORDER`, `TIPO_LABELS` from Task 1.
- Produces:

```ts
export type DayMarker = { colors: string[]; label: string };
export function buildTipoDayMarkers(
  posts: Pick<ClientePost, 'id' | 'tipo' | 'scheduled_at'>[],
  opts?: { excludePostId?: number },
): Map<string, DayMarker>;
```

Tasks 9 and 10 consume `Map<string, DayMarker>` keyed by local `yyyy-MM-dd`.

- [ ] **Step 1: Write the failing test**

Append to `apps/crm/src/pages/entregas/__tests__/postLabels.test.ts`:

```ts
import { buildTipoDayMarkers } from '../postLabels';
import type { ClientePost } from '@/store/posts';

type P = Pick<ClientePost, 'id' | 'tipo' | 'scheduled_at'>;
// Local-noon timestamps keep the assertions timezone-independent.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0).toISOString();

describe('buildTipoDayMarkers', () => {
  it('returns an empty map for no posts', () => {
    expect(buildTipoDayMarkers([]).size).toBe(0);
  });

  it('skips posts with no scheduled_at', () => {
    const posts: P[] = [{ id: 1, tipo: 'feed', scheduled_at: null }];
    expect(buildTipoDayMarkers(posts).size).toBe(0);
  });

  it('emits one dot per distinct tipo, not per post', () => {
    const posts: P[] = [
      { id: 1, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
      { id: 2, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
      { id: 3, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
    ];
    const marker = buildTipoDayMarkers(posts).get('2026-07-24');
    expect(marker?.colors).toEqual(['#eab308']);
    expect(marker?.label).toBe('3 Feed');
  });

  it('orders dots feed, carrossel, reels, stories regardless of input order', () => {
    const posts: P[] = [
      { id: 1, tipo: 'stories', scheduled_at: at(2026, 7, 24) },
      { id: 2, tipo: 'reels', scheduled_at: at(2026, 7, 24) },
      { id: 3, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
      { id: 4, tipo: 'carrossel', scheduled_at: at(2026, 7, 24) },
    ];
    const marker = buildTipoDayMarkers(posts).get('2026-07-24');
    expect(marker?.colors).toEqual(['#eab308', '#3ecf8e', '#E1306C', '#42c8f5']);
    expect(marker?.label).toBe('1 Feed · 1 Carrossel · 1 Reels · 1 Stories');
  });

  it('groups by local date, not UTC date', () => {
    const posts: P[] = [{ id: 1, tipo: 'feed', scheduled_at: at(2026, 7, 24) }];
    const keys = [...buildTipoDayMarkers(posts).keys()];
    expect(keys).toEqual(['2026-07-24']);
  });

  it('separates distinct days', () => {
    const posts: P[] = [
      { id: 1, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
      { id: 2, tipo: 'reels', scheduled_at: at(2026, 7, 25) },
    ];
    const map = buildTipoDayMarkers(posts);
    expect(map.get('2026-07-24')?.colors).toEqual(['#eab308']);
    expect(map.get('2026-07-25')?.colors).toEqual(['#E1306C']);
  });

  it('excludes the post being edited so it does not warn about itself', () => {
    const posts: P[] = [
      { id: 1, tipo: 'feed', scheduled_at: at(2026, 7, 24) },
      { id: 2, tipo: 'reels', scheduled_at: at(2026, 7, 24) },
    ];
    const marker = buildTipoDayMarkers(posts, { excludePostId: 1 }).get('2026-07-24');
    expect(marker?.colors).toEqual(['#E1306C']);
    expect(marker?.label).toBe('1 Reels');
  });

  it('drops a day entirely when the excluded post was its only one', () => {
    const posts: P[] = [{ id: 1, tipo: 'feed', scheduled_at: at(2026, 7, 24) }];
    expect(buildTipoDayMarkers(posts, { excludePostId: 1 }).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- postLabels
```

Expected: FAIL — `buildTipoDayMarkers` is not exported.

- [ ] **Step 3: Implement**

Append to `apps/crm/src/pages/entregas/postLabels.ts`:

Extend the existing line-1 import to `import type { ClientePost, WorkflowPost } from '../../store';` — match the file's existing relative style rather than mixing in a `@/` alias.

```ts
export type DayMarker = { colors: string[]; label: string };

/** Local-time `yyyy-MM-dd`. Must match how CalendarGrid builds its droppable ids — a
 *  UTC-based key shifts posts to the wrong day either side of midnight. */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Groups scheduled posts into per-day dot markers: one dot per distinct tipo present that
 * day (never one per post), in TIPO_ORDER, plus a pre-formatted tooltip with the counts.
 */
export function buildTipoDayMarkers(
  posts: Pick<ClientePost, 'id' | 'tipo' | 'scheduled_at'>[],
  opts?: { excludePostId?: number },
): Map<string, DayMarker> {
  const counts = new Map<string, Map<WorkflowPost['tipo'], number>>();

  for (const post of posts) {
    if (!post.scheduled_at) continue;
    if (opts?.excludePostId != null && post.id === opts.excludePostId) continue;

    const key = localDayKey(new Date(post.scheduled_at));
    let byTipo = counts.get(key);
    if (!byTipo) {
      byTipo = new Map();
      counts.set(key, byTipo);
    }
    byTipo.set(post.tipo, (byTipo.get(post.tipo) ?? 0) + 1);
  }

  const markers = new Map<string, DayMarker>();
  for (const [key, byTipo] of counts) {
    const present = TIPO_ORDER.filter((tipo) => byTipo.has(tipo));
    markers.set(key, {
      colors: present.map((tipo) => TIPO_COLORS[tipo]),
      label: present.map((tipo) => `${byTipo.get(tipo)} ${TIPO_LABELS[tipo]}`).join(' · '),
    });
  }
  return markers;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- postLabels
```

Expected: PASS, 12 tests total in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/postLabels.ts apps/crm/src/pages/entregas/__tests__/postLabels.test.ts
git commit -m "feat(entregas): add buildTipoDayMarkers for date-picker day dots"
```

---

### Task 9: Render day dots in the shared `DateTimePicker`

**Files:**
- Modify: `apps/crm/src/components/ui/calendar.tsx:9-14,53-61` (merge caller `components`)
- Modify: `apps/crm/src/components/ui/date-time-picker.tsx:12-20,131-139`
- Test: `apps/crm/src/components/ui/__tests__/date-time-picker.test.tsx` (create)

**Interfaces:**
- Consumes: `DayMarker` from Task 8 — but only structurally. `DateTimePicker` must NOT import from `pages/entregas`; it takes `Map<string, { colors: string[]; label: string }>` and stays domain-ignorant.
- Produces: `DateTimePickerProps.dayMarkers?: Map<string, { colors: string[]; label: string }>` — consumed by Task 10.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/components/ui/__tests__/date-time-picker.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, beforeAll } from 'vitest';
import { DateTimePicker } from '../date-time-picker';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: /Selecionar data e hora/ }));
}

describe('DateTimePicker day markers', () => {
  it('renders no dots when dayMarkers is omitted', () => {
    render(<DateTimePicker value={new Date(2026, 6, 24, 10, 0)} />);
    fireEvent.click(screen.getByRole('button', { name: /24 jul 2026/i }));
    expect(document.querySelectorAll('[data-testid="day-dot"]').length).toBe(0);
  });

  it('renders one dot per marker color, with the tooltip label', () => {
    const markers = new Map([['2026-07-24', { colors: ['#eab308', '#E1306C'], label: '2 Feed · 1 Reels' }]]);
    render(<DateTimePicker value={new Date(2026, 6, 20, 10, 0)} dayMarkers={markers} />);
    fireEvent.click(screen.getByRole('button', { name: /20 jul 2026/i }));

    const day24 = screen.getByRole('button', { name: '24' });
    expect(day24).toHaveAttribute('title', '2 Feed · 1 Reels');
    expect(day24.querySelectorAll('[data-testid="day-dot"]').length).toBe(2);
  });

  // react-day-picker v9 ships English nav labels by default — the ptBR locale only
  // localizes date formatting, not these ARIA strings. Verified in
  // node_modules/react-day-picker/dist/esm/labels/labelPrevious.js.
  it('keeps the month navigation chevrons when a caller passes components', () => {
    const markers = new Map([['2026-07-24', { colors: ['#eab308'], label: '1 Feed' }]]);
    render(<DateTimePicker value={new Date(2026, 6, 20, 10, 0)} dayMarkers={markers} />);
    fireEvent.click(screen.getByRole('button', { name: /20 jul 2026/i }));
    expect(screen.getByRole('button', { name: 'Go to the Previous Month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to the Next Month' })).toBeInTheDocument();
  });

  it('still selects a day when dots are rendered', () => {
    const onChange = vi.fn();
    const markers = new Map([['2026-07-24', { colors: ['#eab308'], label: '1 Feed' }]]);
    render(<DateTimePicker value={new Date(2026, 6, 20, 10, 0)} dayMarkers={markers} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /20 jul 2026/i }));
    fireEvent.click(screen.getByRole('button', { name: '24' }));
    expect(onChange).toHaveBeenCalled();
  });
});
```

Add `import { vi } from 'vitest';` alongside the other vitest imports.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- date-time-picker
```

Expected: FAIL — `dayMarkers` is not a prop, no dots render.

- [ ] **Step 3: Fix `Calendar` so caller `components` merge instead of replacing**

`calendar.tsx` currently sets `components={{ Chevron }}` and then spreads `{...props}` after it, so any caller passing `components` silently drops both nav arrows. Destructure `components` out of the rest-spread and merge:

```tsx
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{ /* unchanged */ }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" {...chevronProps} />
          ) : (
            <ChevronRight className="h-4 w-4" {...chevronProps} />
          ),
        ...components,
      }}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Add the `dayMarkers` prop and the `DayButton`**

In `date-time-picker.tsx`, extend the props interface (after `futureOnly`, line 19):

```ts
  /**
   * Day key (`yyyy-MM-dd`, local time) → dots to render beneath the day number and that
   * day's tooltip. Deliberately domain-agnostic: this component knows nothing about posts.
   */
  dayMarkers?: Map<string, { colors: string[]; label: string }>;
```

Destructure it in the component signature. Then, above the `return`:

```tsx
const dayButton = React.useMemo(() => {
  if (!dayMarkers || dayMarkers.size === 0) return undefined;
  // Spread react-day-picker's own props onto the button: `Calendar` styles days entirely
  // through classNames.day_button, and selection/disabled state arrives the same way.
  // Rendering custom markup without forwarding silently loses all of it.
  return function DayButtonWithDots({
    day,
    modifiers: _modifiers,
    ...buttonProps
  }: React.ComponentProps<NonNullable<CalendarProps['components']>['DayButton']>) {
    const key = `${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, '0')}-${String(day.date.getDate()).padStart(2, '0')}`;
    const marker = dayMarkers.get(key);
    return (
      <button {...buttonProps} title={marker?.label}>
        {day.date.getDate()}
        {marker && (
          <span className="dtp-day-dots">
            {marker.colors.map((color, i) => (
              <span
                key={i}
                data-testid="day-dot"
                className="dtp-day-dot"
                style={{ background: color }}
              />
            ))}
          </span>
        )}
      </button>
    );
  };
}, [dayMarkers]);
```

Pass it to `Calendar` (line 132-139):

```tsx
<Calendar
  mode="single"
  locale={ptBR}
  selected={value}
  onSelect={handleDateSelect}
  disabled={calendarDisabled}
  initialFocus
  components={dayButton ? { DayButton: dayButton } : undefined}
/>
```

Import `CalendarProps` alongside `Calendar`: `import { Calendar, type CalendarProps } from '@/components/ui/calendar';`

- [ ] **Step 5: Style the dots**

The day button is `h-9 w-9` with centered content, so the dot row is absolutely positioned to avoid pushing the numeral off-center. Add to **`apps/crm/style.css`**, next to the existing `.calendar-post-pill` / `.calendar-pill-handle` rules:

```css
.dtp-day-dots {
  position: absolute;
  bottom: 3px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  pointer-events: none;
}

.dtp-day-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
}
```

The `day_button` class already comes from `buttonVariants({ variant: 'ghost' })`, which is `position: relative`-safe; if the dots render outside the cell, add `position: relative` to the button via the `className` passed through `buttonProps` rather than overriding `classNames.day_button` globally.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run test -- date-time-picker
```

Expected: PASS, 4 tests.

(Those English nav labels in a Portuguese UI are a real a11y gap, but a pre-existing one across every `DateTimePicker` in the app. Out of scope here — do not fix it in this task, and do not weaken the assertion to hide it.)

- [ ] **Step 7: Verify the picker's existing consumers still render**

```bash
npm run test -- entregas && npm run build
```

Expected: PASS and clean. `WorkflowDrawer` and `CalendarPostDetailPanel` pass no `dayMarkers` yet, so they must render exactly as before.

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/components/ui/calendar.tsx apps/crm/src/components/ui/date-time-picker.tsx apps/crm/src/components/ui/__tests__/date-time-picker.test.tsx
git commit -m "feat(ui): add optional day markers to DateTimePicker, merge caller components"
```

---

### Task 10: Feed day markers from both call sites

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx:1255-1262` (+ imports, + query)
- Modify: `apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx:34-45,162-167` (new prop)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx:236-250` (build + pass)
- Test: `apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx` (extend)

**Interfaces:**
- Consumes: `buildTipoDayMarkers` (Task 8), `dayMarkers` prop (Task 9).
- Produces: `CalendarPostDetailPanelProps.dayMarkers?: Map<string, DayMarker>`.

- [ ] **Step 1: Write the failing test**

Append to `CalendarPostDetailPanel.test.tsx`:

```tsx
it('forwards day markers to the reschedule picker', async () => {
  const markers = new Map([['2026-07-24', { colors: ['#eab308'], label: '1 Feed' }]]);
  renderPanel({ isCurrentWorkflow: true, isLocked: false, dayMarkers: markers });
  fireEvent.click(screen.getByRole('button', { name: /jul 2026|Selecionar data e hora/i }));
  expect(await screen.findByTitle('1 Feed')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- CalendarPostDetailPanel
```

Expected: FAIL — `dayMarkers` is not a prop of the panel.

- [ ] **Step 3: Thread the prop through the detail panel**

In `CalendarPostDetailPanel.tsx`, add to `CalendarPostDetailPanelProps`:

```ts
  dayMarkers?: Map<string, DayMarker>;
```

destructure it, import the type (`import { ..., type DayMarker } from '../postLabels';`), and pass it to the `DateTimePicker` in the `Reagendar` section:

```tsx
<DateTimePicker
  value={scheduled ?? undefined}
  onChange={(date) => date && onReschedule(date)}
  futureOnly
  className="w-full"
  dayMarkers={dayMarkers}
/>
```

- [ ] **Step 4: Build the markers in `WorkflowCalendarView`**

Add near the other derived values (after line 83):

```ts
const detailDayMarkers = useMemo(
  () => buildTipoDayMarkers(allPosts, { excludePostId: selectedPostId ?? undefined }),
  [allPosts, selectedPostId],
);
```

and pass `dayMarkers={detailDayMarkers}` to `<CalendarPostDetailPanel …>`. Import `useMemo` and `buildTipoDayMarkers`.

- [ ] **Step 5: Feed the drawer's date picker**

The date picker at line 1255 lives inside **`SortablePostItem`** (declared at line 907), not `WorkflowDrawer` (line 133). `SortablePostItem` already receives `clienteId`, but mounting the query there would instantiate one `useQuery` per post row. TanStack dedupes them to a single fetch on the shared key, so it is not a network problem — it is noise, and each row would rebuild the same map. Instead: the parent owns the query, rows receive the array and do their own per-row exclusion.

**5a.** In `WorkflowDrawer` (near line 221, where `clienteId` is already in scope) add the query. It reuses the **same** key the calendar uses, so it is a cache hit rather than a new round trip whenever the calendar has been opened:

```ts
const { data: clientePosts = [] } = useQuery({
  queryKey: ['clientePosts', clienteId],
  queryFn: () => getClientePosts(clienteId),
  enabled: !!clienteId,
});
```

Import `getClientePosts` from `@/store`.

**5b.** Add to `SortablePostItemProps` (the interface at line 865):

```ts
  clientePosts: ClientePost[];
```

and pass `clientePosts={clientePosts}` at the render site (near line 721, beside the existing `clienteId={clienteId}`).

**5c.** Inside `SortablePostItem`, derive that row's markers. `clientePosts` keeps a stable identity from the TanStack cache, so this memo holds across re-renders:

```ts
const dayMarkers = useMemo(
  () => buildTipoDayMarkers(clientePosts, { excludePostId: post.id ?? undefined }),
  [clientePosts, post.id],
);
```

**5d.** Pass it to the picker at line 1255:

```tsx
<DateTimePicker
  value={post.scheduled_at ? new Date(post.scheduled_at) : undefined}
  onChange={(date) => onFieldChange('scheduled_at', date?.toISOString() ?? null)}
  disabled={isScheduleLocked}
  futureOnly
  className="w-full"
  dayMarkers={dayMarkers}
/>
```

Import `buildTipoDayMarkers` and `type ClientePost`, plus `useMemo` if the file doesn't already import it.

- [ ] **Step 6: Run the tests**

```bash
npm run test -- entregas
```

Expected: PASS, including the new forwarding test.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/
git commit -m "feat(entregas): show scheduled-day dots in post date pickers"
```

---

### Task 11: Full verification and browser pass

Everything above is unit-tested except the one behavior jsdom cannot reproduce: the trailing click after a pointer drag. That needs a real browser.

**Files:** none modified unless a defect surfaces.

- [ ] **Step 1: Run every CI gate**

```bash
npm run test
```

Expected: PASS, no regressions across the suite.

```bash
npm run lint && npm run format:check && npm run build
```

Expected: all clean. If `format:check` fails, run `npm run format` and amend.

- [ ] **Step 2: Start the dev server**

Use the preview tooling (never a bare `npm run dev` through Bash):

```
preview_start { name: "crm" }
```

If `.claude/launch.json` has no `crm` entry, add one running `npm run dev` on port 5173.

- [ ] **Step 3: Verify slice 1 in the browser**

Open a client with posts in at least two workflows, open a workflow's `Calendário`:

1. Drag a **green** (foreign) pill to a different date → time popover opens → confirm → toast reads `Post de «<workflow>» reagendado para …`.
2. Drag a green pill onto the `Sem data` sidebar → sidebar does **not** highlight → toast reads `Só é possível remover a data de posts deste workflow.` and the post stays put.
3. Drag a yellow (own) pill onto the sidebar → it unschedules and appears in the list.
4. Confirm a locked pill (`agendado`/`postado`) shows the lock icon and no grip, in either color.

- [ ] **Step 4: Verify slice 2 in the browser**

1. Press and drag a pill **by its text**, not the grip → it drags.
2. Drop it on a new date → the time popover opens and the **detail panel does not** open behind it. This is the `wasDraggingRef` check; if the panel opens, the ref is not latching — inspect `isDragging` transitions before changing anything else.
3. Click a pill without moving → detail panel opens.
4. Tab to a pill, press Enter → detail panel opens (not a drag). Tab once more to the grip, press an arrow key → drag mode engages.

- [ ] **Step 5: Verify slice 3 in the browser**

1. Open a post in the workflow drawer, click `Data de postagem` → days with other posts show colored dots under the numeral; hover shows e.g. `2 Feed · 1 Reels`.
2. The post's own scheduled day shows **no** dot for itself.
3. Month chevrons still work (this is the `Calendar` merge fix).
4. With `futureOnly`, past days are still greyed and unclickable.
5. Open the calendar's detail panel `Reagendar` picker → same dots appear.

- [ ] **Step 6: Screenshot and commit any fixes**

Capture the calendar and the open date picker as evidence. If any step above required a code change, commit it separately:

```bash
git add -A
git commit -m "fix(entregas): <what the browser pass turned up>"
```

- [ ] **Step 7: Final gate before handoff**

```bash
npm run test && npm run lint && npm run format:check && npm run build
```

Expected: all clean. Do not claim completion without this output.

---

## Notes for the implementer

- **Do not touch `supabase/`.** This plan is entirely frontend. `updateWorkflowPost` needs no change.
- **Do not unify the Hub's tipo palette** with the CRM's. `apps/hub/src/components/PostCalendar.tsx` deliberately uses different colors; that divergence is out of scope.
- **`carrossel` green (`#3ecf8e`) equals the foreign-workflow pill green.** This collision is known and accepted — pills and dots never share a surface. Don't "fix" it.
- **Timezone discipline:** every day key is local-time. If a test passes on your machine and fails in CI, suspect a UTC-vs-local key before suspecting the logic.
