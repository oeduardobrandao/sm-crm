# Advance Cards Past Client-Approval With Mixed Post Statuses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users advance a workflow card past a `aprovacao_cliente` etapa without changing any post's status, and surface the still-pending posts via a persistent card badge and a client-facing drawer summary.

**Architecture:** Frontend-only change in the CRM app. A new third button in `ClientApprovalChoiceDialog` triggers a shared `advanceEtapa` helper in `KanbanView` that calls the existing `completeEtapa` store function and leaves post statuses untouched. A new per-workflow `enviado_cliente` count is plumbed from the store through `useEntregasData` → `EntregasPage` → `KanbanView` → `WorkflowCard` to drive a badge. The existing drawer posts-header summary is rebased onto client-facing statuses. No edge-function, migration, or Hub changes.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest + React Testing Library, Supabase JS client. Build = `npm run build` (tsc + vite). Tests = `npm run test`.

## Global Constraints

- TypeScript strict — typecheck with `npm run build` (runs `tsc` then `vite build`). No `any` leaks beyond the existing `err: unknown` pattern.
- Toasts use `toast()` from `sonner` (already imported in `KanbanView.tsx`).
- Portuguese UI copy. Button label (verbatim): `Avançar etapa sem alterar posts`. Advance toast (verbatim): `Etapa avançada — status dos posts mantidos.`
- Post status values are the literal strings: `'enviado_cliente'`, `'aprovado_cliente'`, `'correcao_cliente'`, `'aprovado_interno'`, `'revisao_interna'`, `'rascunho'`, `'agendado'`, `'postado'`, `'falha_publicacao'`.
- "Approved by client" = status `'aprovado_cliente'` only. "Awaiting client" = status `'enviado_cliente'` only.
- Do not modify the two existing dialog actions (Aprovar internamente / Enviar ao portal) or the drag-adjacency gate.
- No publish-time guard (explicitly out of scope).
- Run `npm run test` and `npm run build` before the final commit.

---

### Task 1: Store count function `getWorkflowAwaitingClientePostsCounts`

**Files:**
- Modify: `apps/crm/src/store/posts.ts` (add after `getWorkflowApprovedPostsCounts`, which ends at line 328)
- Test: `apps/crm/src/store/__tests__/posts-counts.test.ts` (create — verify directory/pattern first; see Step 1 note)

**Interfaces:**
- Consumes: nothing (mirrors existing `getWorkflowApprovedPostsCounts`).
- Produces: `getWorkflowAwaitingClientePostsCounts(workflowIds: number[]): Promise<Map<number, number>>` — counts posts with `status === 'enviado_cliente'` grouped by `workflow_id`. Returns an empty `Map` when `workflowIds` is empty.

- [ ] **Step 1: Inspect existing test conventions and the Supabase mock**

Run: `ls apps/crm/src/store/__tests__/ 2>/dev/null; grep -rln "getWorkflowApprovedPostsCounts\|getWorkflowPostsCounts" apps/crm/src --include=*.test.ts --include=*.test.tsx`

Purpose: find whether store-count functions already have a test and how `supabase` is mocked in this repo. If an existing test file already covers these counts, ADD the new test there instead of creating `posts-counts.test.ts`, and adapt the mock style below to match. If no store test exists, create the file as written below.

- [ ] **Step 2: Write the failing test**

In `apps/crm/src/store/__tests__/posts-counts.test.ts` (adapt the mock to the convention found in Step 1):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable Supabase query mock: .from().select().in().eq() resolves to { data, error }.
const rows = vi.fn<() => { data: unknown; error: unknown }>();

vi.mock('@/lib/supabase', () => {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(rows());
  return { supabase: { from: vi.fn(() => builder) } };
});

import { getWorkflowAwaitingClientePostsCounts } from '@/store/posts';

describe('getWorkflowAwaitingClientePostsCounts', () => {
  beforeEach(() => rows.mockReset());

  it('returns an empty map when no workflow ids are given', async () => {
    const result = await getWorkflowAwaitingClientePostsCounts([]);
    expect(result.size).toBe(0);
  });

  it('counts enviado_cliente posts per workflow', async () => {
    rows.mockReturnValue({
      data: [{ workflow_id: 1 }, { workflow_id: 1 }, { workflow_id: 2 }],
      error: null,
    });
    const result = await getWorkflowAwaitingClientePostsCounts([1, 2]);
    expect(result.get(1)).toBe(2);
    expect(result.get(2)).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- posts-counts`
Expected: FAIL — `getWorkflowAwaitingClientePostsCounts` is not exported.

- [ ] **Step 4: Implement the function**

In `apps/crm/src/store/posts.ts`, immediately after `getWorkflowApprovedPostsCounts` (after line 328), add:

```ts
export async function getWorkflowAwaitingClientePostsCounts(
  workflowIds: number[],
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (workflowIds.length === 0) return counts;
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('workflow_id')
    .in('workflow_id', workflowIds)
    .eq('status', 'enviado_cliente');
  if (error) throw error;
  for (const row of (data ?? []) as { workflow_id: number }[]) {
    counts.set(row.workflow_id, (counts.get(row.workflow_id) ?? 0) + 1);
  }
  return counts;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- posts-counts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/store/posts.ts apps/crm/src/store/__tests__/posts-counts.test.ts
git commit -m "feat(entregas): add getWorkflowAwaitingClientePostsCounts store fn"
```

---

### Task 2: Plumb `awaitingClienteCounts` through `useEntregasData`

**Files:**
- Modify: `apps/crm/src/pages/entregas/hooks/useEntregasData.ts` (imports ~line 9-11; new query after line 250; `refresh()` lines 332-341; return object lines 345-359)

**Interfaces:**
- Consumes: `getWorkflowAwaitingClientePostsCounts` (Task 1).
- Produces: the hook's returned object gains `awaitingClienteCounts: Map<number, number>`.

- [ ] **Step 1: Add the import**

In `apps/crm/src/pages/entregas/hooks/useEntregasData.ts`, add to the existing import block (alongside `getWorkflowApprovedPostsCounts`, lines 9-11):

```ts
  getWorkflowAwaitingClientePostsCounts,
```

- [ ] **Step 2: Add the query**

Immediately after the `revisaoInternaCounts` block (after line 250), add:

```ts
  const { data: awaitingClienteCountsData } = useQuery({
    queryKey: ['workflow-awaiting-cliente-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowAwaitingClientePostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const awaitingClienteCounts: Map<number, number> = awaitingClienteCountsData ?? new Map();
```

- [ ] **Step 3: Invalidate the key in `refresh()`**

In `refresh()` (lines 332-341), add after the `workflow-revisao-interna-counts` invalidation (line 339):

```ts
    qc.invalidateQueries({ queryKey: ['workflow-awaiting-cliente-counts'] });
```

- [ ] **Step 4: Return it from the hook**

In the return object (lines 345-359), add after `revisaoInternaCounts,` (line 355):

```ts
    awaitingClienteCounts,
```

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: tsc passes (no errors). Vite build completes.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/hooks/useEntregasData.ts
git commit -m "feat(entregas): expose awaitingClienteCounts from useEntregasData + refresh"
```

---

### Task 3: Pass `awaitingClienteCounts` through `EntregasPage` → `KanbanView` → `WorkflowCard`

**Files:**
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (destructure ~line 65; `<KanbanView>` props ~line 267)
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx` (`KanbanViewProps` ~line 48; destructure ~line 172; inner card component props ~lines 114-127 and passthrough ~line 152; both `<WorkflowCard>` render sites ~lines 462 and 481)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCard.tsx` (`WorkflowCardProps` after line 66; destructure after line 82)

**Interfaces:**
- Consumes: `awaitingClienteCounts: Map<number, number>` (Task 2).
- Produces: `WorkflowCard` receives a new optional prop `awaitingClienteCount?: number` (consumed in Task 5). No behavioral change yet — this task is pure plumbing and must typecheck clean.

- [ ] **Step 1: `EntregasPage.tsx` — destructure and pass**

Add `awaitingClienteCounts` to the destructuring of `useEntregasData()` (near line 65, alongside `revisaoInternaCounts`):

```ts
    awaitingClienteCounts,
```

Add to the `<KanbanView ... />` props (near line 267, after `revisaoInternaCounts={revisaoInternaCounts}`):

```tsx
          awaitingClienteCounts={awaitingClienteCounts}
```

- [ ] **Step 2: `KanbanView.tsx` — props type + destructure**

In `KanbanViewProps` (near line 48, after `revisaoInternaCounts: Map<number, number>;`):

```ts
  awaitingClienteCounts: Map<number, number>;
```

In the component's destructured props (near line 172, after `revisaoInternaCounts,`):

```ts
  awaitingClienteCounts,
```

- [ ] **Step 3: `KanbanView.tsx` — inner card component**

The inner card-rendering component (props block ~lines 114-127) destructures `revisaoInternaCount` and declares its type. Add the new prop in BOTH places:

Add to the destructured params (after `revisaoInternaCount,`, ~line 115):

```ts
  awaitingClienteCount,
```

Add to that component's props type (after `revisaoInternaCount: number;`, ~line 127):

```ts
  awaitingClienteCount: number;
```

Pass it to the `<WorkflowCard>` it renders (after `revisaoInternaCount={revisaoInternaCount}`, ~line 152):

```tsx
        awaitingClienteCount={awaitingClienteCount}
```

- [ ] **Step 4: `KanbanView.tsx` — both `<WorkflowCard>` render call sites**

At the render site near line 462 (after `revisaoInternaCount={revisaoInternaCounts.get(card.workflow.id!) ?? 0}`):

```tsx
                              awaitingClienteCount={awaitingClienteCounts.get(card.workflow.id!) ?? 0}
```

At the render site near line 481 (after `revisaoInternaCount={revisaoInternaCounts.get(activeCard.workflow.id!) ?? 0}`):

```tsx
              awaitingClienteCount={awaitingClienteCounts.get(activeCard.workflow.id!) ?? 0}
```

> NOTE: if the inner card component (Step 3) is what's rendered at one of these sites rather than `WorkflowCard` directly, pass `awaitingClienteCount` to whichever component is actually at each call site. Match the prop to the component being rendered there.

- [ ] **Step 5: `WorkflowCard.tsx` — props type + destructure**

In `WorkflowCardProps` (after line 66, the `revisaoInternaCount?: number;` line):

```ts
  /** Number of posts still awaiting client approval (status enviado_cliente) */
  awaitingClienteCount?: number;
```

In the destructured function params (after `revisaoInternaCount,`, line 82):

```ts
  awaitingClienteCount,
```

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: tsc passes. (No runtime behavior change yet — `awaitingClienteCount` is received but unused; that is fine, it is an optional prop consumed in Task 5.)

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/views/KanbanView.tsx apps/crm/src/pages/entregas/components/WorkflowCard.tsx
git commit -m "feat(entregas): plumb awaitingClienteCount prop to WorkflowCard"
```

---

### Task 4: "Avançar etapa sem alterar posts" — dialog button + KanbanView handler

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` (`ClientApprovalChoiceDialogProps` lines 1559-1565; component params 1566-1572; footer buttons 1587-1597)
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx` (`executeForward` lines 325-351; add helper + handler; dialog render site lines 505-510)
- Test: `apps/crm/src/pages/entregas/components/__tests__/ClientApprovalChoiceDialog.test.tsx` (create — confirm naming against neighbors first)

**Interfaces:**
- Consumes: existing `completeEtapa`, `onRecurring`, `onRefresh`, `approvalChoiceCard` state in `KanbanView`.
- Produces:
  - `ClientApprovalChoiceDialog` gains required prop `onAdvanceWithoutChanges: () => void`.
  - `KanbanView` gains `advanceEtapa(card: BoardCard, successMessage: string): Promise<void>` and `handleAdvanceWithoutApproval(): void`.

- [ ] **Step 1: Inspect existing modal test conventions**

Run: `ls apps/crm/src/pages/entregas/components/__tests__/`

Purpose: match the existing RTL test file naming and import style (e.g. how other modal/component tests render and query). Adapt the test below to that style if needed.

- [ ] **Step 2: Write the failing test for the dialog button**

In `apps/crm/src/pages/entregas/components/__tests__/ClientApprovalChoiceDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientApprovalChoiceDialog } from '../WorkflowModals';

function setup() {
  const onApproveInternally = vi.fn();
  const onSendToPortal = vi.fn();
  const onAdvanceWithoutChanges = vi.fn();
  const onCancel = vi.fn();
  render(
    <ClientApprovalChoiceDialog
      open
      workflowTitle="Campanha X"
      onApproveInternally={onApproveInternally}
      onSendToPortal={onSendToPortal}
      onAdvanceWithoutChanges={onAdvanceWithoutChanges}
      onCancel={onCancel}
    />,
  );
  return { onApproveInternally, onSendToPortal, onAdvanceWithoutChanges, onCancel };
}

describe('ClientApprovalChoiceDialog', () => {
  it('renders the advance-without-changes button', () => {
    setup();
    expect(
      screen.getByRole('button', { name: 'Avançar etapa sem alterar posts' }),
    ).toBeInTheDocument();
  });

  it('fires only onAdvanceWithoutChanges when that button is clicked', async () => {
    const { onAdvanceWithoutChanges, onApproveInternally, onSendToPortal } = setup();
    await userEvent.click(
      screen.getByRole('button', { name: 'Avançar etapa sem alterar posts' }),
    );
    expect(onAdvanceWithoutChanges).toHaveBeenCalledTimes(1);
    expect(onApproveInternally).not.toHaveBeenCalled();
    expect(onSendToPortal).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- ClientApprovalChoiceDialog`
Expected: FAIL — prop `onAdvanceWithoutChanges` not in type / button not found.

- [ ] **Step 4: Add the prop and button in `WorkflowModals.tsx`**

Add to `ClientApprovalChoiceDialogProps` (after `onSendToPortal: () => void;`, line 1563):

```ts
  onAdvanceWithoutChanges: () => void;
```

Add to the destructured params (after `onSendToPortal,`, line 1570):

```ts
  onAdvanceWithoutChanges,
```

In the `<DialogFooter>`, insert a third button after the `Enviar ao portal do cliente` button (after line 1593) and before the `Cancelar` button:

```tsx
          <Button className="w-full" variant="secondary" onClick={onAdvanceWithoutChanges}>
            Avançar etapa sem alterar posts
          </Button>
```

- [ ] **Step 5: Run dialog test to verify it passes**

Run: `npm run test -- ClientApprovalChoiceDialog`
Expected: PASS (both tests).

- [ ] **Step 6: Refactor `executeForward` to use a shared `advanceEtapa` helper**

In `apps/crm/src/pages/entregas/views/KanbanView.tsx`, define the helper just above `executeForward` (line 325). It is the exact logic currently inside `executeForward`'s else-branch (lines 335-347), parameterized by the success message:

```ts
  const advanceEtapa = useCallback(
    async (card: BoardCard, successMessage: string) => {
      try {
        const result = await completeEtapa(card.workflow.id!, card.etapa.id!);
        if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
          onRecurring(card.workflow.id!);
        } else {
          toast.success(successMessage);
        }
        onRefresh();
      } catch (err: unknown) {
        toast.error((err as Error).message || 'Erro ao avançar etapa');
      }
    },
    [onRefresh, onRecurring],
  );
```

Then replace the else-branch body of `executeForward` (lines 334-348) so it calls the helper:

```ts
      } else {
        advanceEtapa(card, 'Etapa concluída!');
      }
```

Add `advanceEtapa` to `executeForward`'s dependency array (line 350): `[advanceEtapa, postsCounts, approvedPostsCounts]`.

- [ ] **Step 7: Add the `handleAdvanceWithoutApproval` handler**

In `KanbanView.tsx`, near the other dialog handlers (after `handleSendToPortal`, ~line 389), add:

```ts
  const handleAdvanceWithoutApproval = () => {
    if (!approvalChoiceCard) return;
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    advanceEtapa(card, 'Etapa avançada — status dos posts mantidos.');
  };
```

- [ ] **Step 8: Wire the handler into the dialog render**

In the `<ClientApprovalChoiceDialog ... />` render (lines 505-510), add after `onSendToPortal={handleSendToPortal}` (line 509):

```tsx
        onAdvanceWithoutChanges={handleAdvanceWithoutApproval}
```

- [ ] **Step 9: Typecheck + full dialog test**

Run: `npm run build && npm run test -- ClientApprovalChoiceDialog`
Expected: tsc passes; dialog tests PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowModals.tsx apps/crm/src/pages/entregas/views/KanbanView.tsx apps/crm/src/pages/entregas/components/__tests__/ClientApprovalChoiceDialog.test.tsx
git commit -m "feat(entregas): advance etapa without altering post statuses"
```

---

### Task 5: Persistent "aguardando cliente" card badge

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCard.tsx` (badge block, after the `revisaoInternaCount` badge that ends at line 524)
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowCard.badge.test.tsx` (create — confirm naming against neighbors; reuse any existing `WorkflowCard` test helpers/fixtures if present)

**Interfaces:**
- Consumes: `awaitingClienteCount` prop (Task 3); `card.allEtapas` (array of etapas, each with `tipo` and `ordem`) and `card.etapa.ordem` on `BoardCard`.
- Produces: renders text `N aguardando cliente` on the card when the card is in an etapa whose `ordem` is greater than the `aprovacao_cliente` etapa's `ordem` and `awaitingClienteCount > 0`.

- [ ] **Step 1: Check for an existing WorkflowCard test + fixture**

Run: `ls apps/crm/src/pages/entregas/components/__tests__/ | grep -i workflowcard; grep -rln "from '../WorkflowCard'\|BoardCard" apps/crm/src/pages/entregas --include=*.test.tsx`

Purpose: if a `WorkflowCard` test and a `BoardCard` fixture builder already exist, reuse them and add the two cases below rather than building a fresh fixture. If not, use the inline fixture in Step 2 (adjust required `BoardCard`/etapa fields to satisfy the type — check `BoardCard` and the etapa type in `apps/crm/src/store/workflows.ts` for required keys).

- [ ] **Step 2: Write the failing test**

In `apps/crm/src/pages/entregas/components/__tests__/WorkflowCard.badge.test.tsx` (fill any additional required `BoardCard`/etapa fields per Step 1):

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkflowCard } from '../WorkflowCard';

const etapas = [
  { id: 1, workflow_id: 1, ordem: 0, nome: 'Aprovação', status: 'concluido', tipo: 'aprovacao_cliente' },
  { id: 2, workflow_id: 1, ordem: 1, nome: 'Design', status: 'ativo', tipo: 'padrao' },
];

function makeCard(currentEtapaOrdem: number) {
  const etapa = etapas.find((e) => e.ordem === currentEtapaOrdem)!;
  return {
    workflow: { id: 1, cliente_id: 1, titulo: 'Campanha', status: 'ativo', etapa_atual: currentEtapaOrdem, recorrente: false },
    etapa,
    allEtapas: etapas,
    cliente: undefined,
    membro: undefined,
    deadline: undefined,
    totalEtapas: etapas.length,
    etapaIdx: currentEtapaOrdem,
  } as unknown as Parameters<typeof WorkflowCard>[0]['card'];
}

describe('WorkflowCard awaiting-client badge', () => {
  it('shows the awaiting-client badge in an etapa after the approval etapa', () => {
    render(<WorkflowCard card={makeCard(1)} awaitingClienteCount={2} postsCount={5} />);
    expect(screen.getByText(/2 aguardando cliente/i)).toBeInTheDocument();
  });

  it('hides the badge when awaitingClienteCount is 0', () => {
    render(<WorkflowCard card={makeCard(1)} awaitingClienteCount={0} postsCount={5} />);
    expect(screen.queryByText(/aguardando cliente/i)).not.toBeInTheDocument();
  });

  it('does not show the post-approval-etapa badge while still in the approval etapa', () => {
    // ordem 0 == approval etapa itself; the new badge must NOT render here
    // (the existing in-stage "Aguardando cliente" branch handles that case).
    render(<WorkflowCard card={makeCard(0)} awaitingClienteCount={2} postsCount={5} />);
    expect(screen.queryByText(/2 aguardando cliente/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- WorkflowCard.badge`
Expected: FAIL — the `N aguardando cliente` badge is not rendered.

- [ ] **Step 4: Implement the badge**

In `apps/crm/src/pages/entregas/components/WorkflowCard.tsx`, immediately after the `revisaoInternaCount` badge block (which closes at line 524), add a new badge block:

```tsx
      {(() => {
        const approvalOrdem = card.allEtapas.find((e) => e.tipo === 'aprovacao_cliente')?.ordem;
        const showAwaiting =
          approvalOrdem != null &&
          card.etapa.ordem > approvalOrdem &&
          (awaitingClienteCount ?? 0) > 0;
        if (!showAwaiting) return null;
        return (
          <div className="board-card-approval">
            <div
              className="board-card-approval-badge"
              style={{
                borderRadius: '999px',
                padding: '0.2rem 0.65rem',
                fontSize: '0.68rem',
                letterSpacing: '0.02em',
              }}
            >
              ⏳ {awaitingClienteCount} aguardando cliente
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- WorkflowCard.badge`
Expected: PASS (all three cases).

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: tsc passes.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowCard.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowCard.badge.test.tsx
git commit -m "feat(entregas): persistent 'aguardando cliente' badge on advanced cards"
```

---

### Task 6: Client-facing drawer posts-header summary

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (`approvedCount` at line 556; summary JSX at lines 617-621)

**Interfaces:**
- Consumes: `orderedPosts` (already in scope at line 556) and `posts` (in scope at line 617).
- Produces: the posts-header summary now reads `X de Y aprovados pelo cliente`, where `X` = `aprovado_cliente` count and `Y` = client-facing count (`enviado_cliente | aprovado_cliente | correcao_cliente`). Hidden when `Y === 0`.

- [ ] **Step 1: Add the client-facing count**

In `WorkflowDrawer.tsx`, immediately after `const approvedCount = orderedPosts.filter((p) => p.status === 'aprovado_cliente').length;` (line 556), add:

```ts
  const clientFacingCount = orderedPosts.filter((p) =>
    ['enviado_cliente', 'aprovado_cliente', 'correcao_cliente'].includes(p.status),
  ).length;
```

- [ ] **Step 2: Update the summary JSX**

Replace the summary block at lines 617-621:

```tsx
                  {posts.length > 0 && (
                    <span className="drawer-post-count">
                      {approvedCount}/{posts.length} aprovados
                    </span>
                  )}
```

with:

```tsx
                  {clientFacingCount > 0 && (
                    <span className="drawer-post-count">
                      {approvedCount} de {clientFacingCount} aprovados pelo cliente
                    </span>
                  )}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: tsc passes.

- [ ] **Step 4: Check for and update any existing drawer-summary test assertions**

Run: `grep -rn "aprovados" apps/crm/src apps/hub/src --include=*.test.tsx --include=*.test.ts`
If any test asserts the old `{n}/{n} aprovados` summary text, update it to `{x} de {y} aprovados pelo cliente`. If none, no change.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat(entregas): drawer summary counts client-facing approvals only"
```

---

### Task 7: Optional KanbanView handler test + full verification

**Files:**
- Test: `apps/crm/src/pages/entregas/views/__tests__/KanbanView.advance.test.tsx` (create ONLY if cheap — see Step 1)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: green full test suite + green build; optional KanbanView handler coverage.

- [ ] **Step 1: Decide on the KanbanView handler test**

Run: `ls apps/crm/src/pages/entregas/views/__tests__/ 2>/dev/null; grep -rln "KanbanView" apps/crm/src --include=*.test.tsx`

Decision rule (from the spec): add a `handleAdvanceWithoutApproval` → `completeEtapa` test ONLY if existing KanbanView test infrastructure (a render harness / store mock) already exists to make it cheap. KanbanView depends on `@dnd-kit` drag context and the `completeEtapa` store call; standing up that harness from scratch is NOT cheap. If no harness exists, SKIP this test — Tasks 1, 4, 5, 6 already cover the behavioral surface (store count, dialog button + callback, badge, drawer summary). Note the skip in the commit message of Step 4 below.

- [ ] **Step 2: (If cheap only) Write the handler test**

If and only if a reusable harness exists, add a test asserting that invoking the advance-without-changes path calls `completeEtapa(workflowId, etapaId)` exactly once and does NOT call `approvePostsInternally` or `sendPostsToCliente`. Mock `@/store/posts`/`@/store/workflows` per the existing harness's mocking style. (No code block prescribed because it must conform to the existing harness; if there is no harness, do not write this.)

- [ ] **Step 3: Run the full suite + build**

Run: `npm run test`
Expected: all suites PASS (baseline was 919 tests; expect 919 + the new tests from Tasks 1, 4, 5).

Run: `npm run build`
Expected: tsc + vite build succeed with no errors.

- [ ] **Step 4: Commit (only if Step 2 produced a file; otherwise nothing to commit)**

```bash
git add apps/crm/src/pages/entregas/views/__tests__/KanbanView.advance.test.tsx
git commit -m "test(entregas): cover advance-without-approval handler"
```

If Step 1 decided to skip, there is no file to commit — proceed; the suite is already green from prior tasks.

---

## Self-Review

**Spec coverage:**
- §Design 1 "Move anyway" → Task 4 (dialog button + `advanceEtapa` helper + recurring path preserved + handler). ✓
- §Design 2 persistent card badge (ordem-based) → Task 5. ✓
- §Design 3 drawer summary client-facing → Task 6. ✓
- §Design 4 counts plumbing (store → hook → refresh → page → KanbanView → WorkflowCard) → Tasks 1, 2, 3. ✓
- §Design 5 no downstream changes → reflected by absence of edge-function/migration tasks; constraint stated. ✓
- §Testing → Tasks 1, 4, 5, 6 tests; Task 7 optional handler + full verification + cross-suite grep in Tasks 6/7. ✓
- Open points resolved by user "proceed": button label `Avançar etapa sem alterar posts` (Task 4); drawer hidden when no client-facing posts (Task 6). ✓

**Placeholder scan:** No TBD/TODO. The two "inspect conventions" steps (1.1, 4.1, 5.1, 7.1) are deliberate discovery steps with concrete fallbacks, not placeholders — each names the exact command and the default to use if nothing is found.

**Type consistency:**
- `getWorkflowAwaitingClientePostsCounts(workflowIds: number[]): Promise<Map<number, number>>` — defined Task 1, imported Task 2, used identically.
- `awaitingClienteCounts: Map<number, number>` — produced Task 2, threaded Task 3, consumed via `awaitingClienteCount?: number` on WorkflowCard.
- `onAdvanceWithoutChanges: () => void` — added to props (Task 4 Step 4) and wired (Task 4 Step 8) under the same name.
- `advanceEtapa(card, successMessage)` / `handleAdvanceWithoutApproval()` — defined and called consistently within Task 4.
- Badge uses `card.allEtapas` + `card.etapa.ordem` + `awaitingClienteCount`, all available per Task 3 / BoardCard.
