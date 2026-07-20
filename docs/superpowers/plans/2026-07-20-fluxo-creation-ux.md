# Fluxo Creation UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-form fluxo creation modal with a 5-step wizard (preset gallery → basics → etapas → prazos → review/save-as-template), make multiple client-approval etapas work via an automated post-status re-arm, and add an example board + driver.js tour to the empty Entregas page.

**Architecture:** Two independently shippable PRs. PR A (Tasks 1–12): store-level approval re-arm, shared dialog close-guard fix, `SortableEtapaList` extraction, code-defined presets, template-first creation sequencing, and the wizard replacing `NewWorkflowModal`. PR B (Tasks 13–15): `data-tour` anchors, static `ExampleBoard`, driver.js tour with runtime step filtering and replay. Spec: `docs/superpowers/specs/2026-07-20-fluxo-creation-ux-design.md`.

**Tech Stack:** React 19, TypeScript, Vite, TanStack Query (not needed for new code), @dnd-kit (existing), shadcn/ui + Radix, Vitest + React Testing Library, PostHog (`captureEvent`), driver.js (new, PR B only).

## Global Constraints

- UI copy is **Portuguese (pt-BR)** — copy strings in this plan are exact.
- No DB migrations, no edge-function changes, no Hub changes. Frontend (`apps/crm`) only.
- Path alias `@/` = `apps/crm/src/`. Store imports from pages use relative `../../../store`.
- Toasts via `toast` from `sonner` (never legacy `showToast`).
- Icons: `lucide-react` only.
- Before each commit: run the tests for the touched area. Before finishing each PR: `npm run lint && npm run format:check && npm run test && npm run build` (run `npm run format` first to auto-fix).
- All frontend test files follow the existing pattern: `vi.mock('../../lib/supabase')` for store tests (see `apps/crm/src/store/__tests__/designs.test.ts`), module-level `vi.mock` of `../../../store` + UI primitives for component tests (see `apps/crm/src/pages/entregas/components/__tests__/WorkflowModals.test.tsx`).
- Commit messages: conventional prefix + short scope, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Working branch: `claude/fluxo-creation-ux-8a5de4` (already checked out in this worktree).

---

# PR A — Approval re-arm + creation wizard

### Task 1: Approval re-arm store functions

**Files:**
- Modify: `apps/crm/src/store/posts.ts` (append near `approvePostsInternally`, ~line 598)
- Modify: `apps/crm/src/store/workflows.ts` (append after `completeEtapa`, ~line 340)
- Test: `apps/crm/src/store/__tests__/rearm.test.ts` (create)

**Interfaces:**
- Consumes: existing `completeEtapa(workflowId, etapaId)`, `getWorkflowEtapas(workflowId)`, `WorkflowEtapa` from `store/workflows.ts`; `supabase` from `store/core.ts`.
- Produces:
  - `resetApprovedPostsForNextCycle(workflowId: number): Promise<void>` (posts.ts)
  - `hasLaterApprovalEtapa(etapas: WorkflowEtapa[], etapaId: number): boolean` (workflows.ts, pure)
  - `completeEtapaWithRearm(workflowId: number, etapaId: number): Promise<{ workflow: Workflow; etapas: WorkflowEtapa[]; rearmed: boolean; rearmFailed: boolean }>` (workflows.ts) — **the etapa advance is never rolled back**: if the post reset fails after a successful advance, the promise RESOLVES with `rearmed: false, rearmFailed: true` so callers can refresh and show the manual-remediation toast (spec §Error handling).
  - All re-exported automatically via `store/index.ts` (`export * from './workflows'` / `'./posts'`).

- [ ] **Step 1: Write the failing test for the pure helper**

Create `apps/crm/src/store/__tests__/rearm.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import { hasLaterApprovalEtapa, type WorkflowEtapa } from '../workflows';

function etapa(partial: Partial<WorkflowEtapa> & { id: number; ordem: number }): WorkflowEtapa {
  return {
    workflow_id: 1,
    nome: `Etapa ${partial.ordem}`,
    prazo_dias: 3,
    tipo_prazo: 'corridos',
    status: 'pendente',
    tipo: 'padrao',
    ...partial,
  };
}

describe('hasLaterApprovalEtapa', () => {
  const dupla = [
    etapa({ id: 10, ordem: 0, nome: 'Redação' }),
    etapa({ id: 11, ordem: 1, nome: 'Aprovação do texto', tipo: 'aprovacao_cliente' }),
    etapa({ id: 12, ordem: 2, nome: 'Design' }),
    etapa({ id: 13, ordem: 3, nome: 'Aprovação da arte', tipo: 'aprovacao_cliente' }),
    etapa({ id: 14, ordem: 4, nome: 'Agendamento' }),
  ];

  it('true when a later aprovacao_cliente etapa exists', () => {
    expect(hasLaterApprovalEtapa(dupla, 11)).toBe(true);
  });

  it('false for the last approval etapa', () => {
    expect(hasLaterApprovalEtapa(dupla, 13)).toBe(false);
  });

  it('false for a non-approval etapa followed only by padrao etapas', () => {
    expect(hasLaterApprovalEtapa(dupla, 14)).toBe(false);
  });

  it('false for an unknown etapa id', () => {
    expect(hasLaterApprovalEtapa(dupla, 999)).toBe(false);
  });
});
```

Then add a second describe exercising the real query semantics through the supabase mock
(`apps/crm/src/lib/__mocks__/supabase.ts` exposes `__queueSupabaseResult(table, op, result)` and
`__getSupabaseCalls()`; `__resetSupabaseMock()` in `beforeEach`):

```ts
import {
  __queueSupabaseResult, __getSupabaseCalls, __resetSupabaseMock,
} from '../../lib/__mocks__/supabase';
import { completeEtapaWithRearm } from '../workflows';

describe('completeEtapaWithRearm', () => {
  beforeEach(() => __resetSupabaseMock());

  const queueEtapas = (rows: WorkflowEtapa[]) => {
    // 1st select: the pre-check inside completeEtapaWithRearm;
    // 2nd + 3rd: getWorkflowEtapas calls inside completeEtapa.
    __queueSupabaseResult('workflow_etapas', 'select', { data: rows });
    __queueSupabaseResult('workflow_etapas', 'select', { data: rows });
    __queueSupabaseResult('workflow_etapas', 'select', { data: rows });
    __queueSupabaseResult('workflow_etapas', 'update', { data: rows[1] });
    __queueSupabaseResult('workflow_etapas', 'update', { data: rows[2] });
    __queueSupabaseResult('workflows', 'update', { data: { id: 1, status: 'ativo' } });
  };

  it('resets ONLY aprovado_cliente posts when a later approval exists', async () => {
    queueEtapas([
      etapa({ id: 10, ordem: 0 }),
      etapa({ id: 11, ordem: 1, tipo: 'aprovacao_cliente', status: 'ativo' }),
      etapa({ id: 12, ordem: 2 }),
      etapa({ id: 13, ordem: 3, tipo: 'aprovacao_cliente' }),
    ]);
    const result = await completeEtapaWithRearm(1, 11);
    expect(result.rearmed).toBe(true);
    expect(result.rearmFailed).toBe(false);
    const reset = __getSupabaseCalls().find(
      (c) => c.table === 'workflow_posts' && c.operation === 'update',
    )!;
    expect(reset.payload).toEqual({ status: 'rascunho' });
    expect(reset.modifiers).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['workflow_id', 1] },
        { method: 'eq', args: ['status', 'aprovado_cliente'] },
      ]),
    );
  });

  it('does not touch posts when no later approval etapa exists', async () => {
    queueEtapas([
      etapa({ id: 10, ordem: 0 }),
      etapa({ id: 11, ordem: 1, tipo: 'aprovacao_cliente', status: 'ativo' }),
      etapa({ id: 12, ordem: 2 }),
    ]);
    const result = await completeEtapaWithRearm(1, 11);
    expect(result.rearmed).toBe(false);
    expect(
      __getSupabaseCalls().some((c) => c.table === 'workflow_posts' && c.operation === 'update'),
    ).toBe(false);
  });

  it('resolves with rearmFailed when the reset errors after a successful advance', async () => {
    queueEtapas([
      etapa({ id: 11, ordem: 0, tipo: 'aprovacao_cliente', status: 'ativo' }),
      etapa({ id: 12, ordem: 1 }),
      etapa({ id: 13, ordem: 2, tipo: 'aprovacao_cliente' }),
    ]);
    __queueSupabaseResult('workflow_posts', 'update', { error: new Error('rls boom') });
    const result = await completeEtapaWithRearm(1, 11);
    expect(result.rearmed).toBe(false);
    expect(result.rearmFailed).toBe(true);
  });
});
```

(If the queued select/update counts drift from `completeEtapa`'s actual call sequence, read
`completeEtapa` in `workflows.ts` and match the queue order — the mock replays responses FIFO per
`table:operation` key.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/crm/src/store/__tests__/rearm.test.ts`
Expected: FAIL — `hasLaterApprovalEtapa` is not exported.

- [ ] **Step 3: Implement the store functions**

In `apps/crm/src/store/posts.ts`, directly after `approvePostsInternally`:

```ts
/**
 * Re-arm the next client-approval cycle (multi-approval fluxos): posts the client already
 * approved go back to rascunho so a later aprovacao_cliente etapa can send them to the
 * portal again. Scheduled/posted/failed posts are never touched. Mirrors the manual
 * workaround agencies use for double-approval flows; post_approvals history is preserved.
 */
export async function resetApprovedPostsForNextCycle(workflowId: number): Promise<void> {
  const { error } = await supabase
    .from('workflow_posts')
    .update({ status: 'rascunho' })
    .eq('workflow_id', workflowId)
    .eq('status', 'aprovado_cliente');
  if (error) throw error;
}
```

In `apps/crm/src/store/workflows.ts`, add the import at the top (verify `posts.ts` does not import from `workflows.ts` — it doesn't today — to avoid a cycle):

```ts
import { resetApprovedPostsForNextCycle } from './posts';
```

and after `completeEtapa`:

```ts
/** True when another client-approval etapa exists after the given etapa. */
export function hasLaterApprovalEtapa(etapas: WorkflowEtapa[], etapaId: number): boolean {
  const current = etapas.find((e) => e.id === etapaId);
  if (!current) return false;
  return etapas.some((e) => e.tipo === 'aprovacao_cliente' && e.ordem > current.ordem);
}

/**
 * completeEtapa + approval-cycle re-arm: when the completed etapa is an aprovacao_cliente
 * and another approval etapa lies ahead, approved posts are reset to rascunho so the next
 * approval cycle can run. Callers that must NOT touch posts ("Avançar etapa sem alterar
 * posts") keep calling plain completeEtapa.
 */
export async function completeEtapaWithRearm(
  workflowId: number,
  etapaId: number,
): Promise<{ workflow: Workflow; etapas: WorkflowEtapa[]; rearmed: boolean; rearmFailed: boolean }> {
  const before = await getWorkflowEtapas(workflowId);
  const current = before.find((e) => e.id === etapaId);
  const rearm = current?.tipo === 'aprovacao_cliente' && hasLaterApprovalEtapa(before, etapaId);
  const result = await completeEtapa(workflowId, etapaId);
  if (!rearm) return { ...result, rearmed: false, rearmFailed: false };
  // The advance already happened — a reset failure must not surface as an advance failure.
  try {
    await resetApprovedPostsForNextCycle(workflowId);
    return { ...result, rearmed: true, rearmFailed: false };
  } catch {
    return { ...result, rearmed: false, rearmFailed: true };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/crm/src/store/__tests__/rearm.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/posts.ts apps/crm/src/store/workflows.ts apps/crm/src/store/__tests__/rearm.test.ts
git commit -m "feat(entregas): approval re-arm store functions for multi-approval fluxos

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire re-arm into KanbanView, WorkflowDrawer, and the approval dialog

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx` (imports; `advanceEtapa`, `executeForward`, `handleApproveInternally`, `handleAdvanceWithoutChanges` area ~lines 339–420; dialog render site)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` (`ClientApprovalChoiceDialog`, ~line 1558)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (`checkAutoComplete`, ~line 453 — dead code, reworked)
- Create: `apps/crm/src/pages/entregas/components/autoComplete.ts`
- Test: `apps/crm/src/pages/entregas/components/__tests__/autoComplete.test.ts` (create)
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowCard.badges.test.tsx` (create)
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowModals.test.tsx` (extend)
- Test: `apps/crm/src/pages/entregas/views/__tests__/KanbanRearm.test.tsx` (create)

**Interfaces:**
- Consumes: `completeEtapaWithRearm`, `hasLaterApprovalEtapa` (Task 1), existing `completeEtapa`, `approvePostsInternally`, `sendPostsToCliente` from `../../../store`.
- Produces: `ClientApprovalChoiceDialog` gains prop `willRearm?: boolean`. `advanceEtapa(card, successMessage, opts?: { rearm?: boolean })` inside KanbanView (internal).

- [ ] **Step 1: Write failing test for the dialog note**

Append to `WorkflowModals.test.tsx` (it already renders `ClientApprovalChoiceDialog` elsewhere; if not, this is a new describe using the file's existing mock setup):

```tsx
import { ClientApprovalChoiceDialog } from '../WorkflowModals';

describe('ClientApprovalChoiceDialog re-arm note', () => {
  const noop = () => {};
  it('shows the next-cycle note when willRearm', () => {
    render(
      <ClientApprovalChoiceDialog
        open
        workflowTitle="Posts Agosto"
        willRearm
        onApproveInternally={noop}
        onSendToPortal={noop}
        onAdvanceWithoutChanges={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByText(/voltarão para rascunho/i)).toBeTruthy();
  });

  it('hides the note when willRearm is false/absent', () => {
    render(
      <ClientApprovalChoiceDialog
        open
        workflowTitle="Posts Agosto"
        onApproveInternally={noop}
        onSendToPortal={noop}
        onAdvanceWithoutChanges={noop}
        onCancel={noop}
      />,
    );
    expect(screen.queryByText(/voltarão para rascunho/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run apps/crm/src/pages/entregas/components/__tests__/WorkflowModals.test.tsx`) — unknown prop renders nothing.

- [ ] **Step 3: Implement dialog note + Kanban/Drawer wiring**

`ClientApprovalChoiceDialog` in `WorkflowModals.tsx` — add to props interface `willRearm?: boolean;` and render under the existing paragraph:

```tsx
{willRearm && (
  <p className="text-sm" style={{ color: 'var(--warning)' }}>
    Há outra etapa de aprovação adiante — ao concluir esta, os posts aprovados voltarão para
    rascunho para o próximo ciclo de aprovação.
  </p>
)}
```

`KanbanView.tsx`:

1. Import `completeEtapaWithRearm` and `hasLaterApprovalEtapa` from `../../../store` (keep `completeEtapa` import).
2. Change `advanceEtapa` to accept options and toast on re-arm:

```tsx
const advanceEtapa = useCallback(
  async (card: BoardCard, successMessage: string, opts?: { rearm?: boolean }) => {
    try {
      const useRearm = opts?.rearm !== false;
      const result = useRearm
        ? await completeEtapaWithRearm(card.workflow.id!, card.etapa.id!)
        : { ...(await completeEtapa(card.workflow.id!, card.etapa.id!)), rearmed: false, rearmFailed: false };
      if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
        onRecurring(card.workflow.id!);
      } else {
        toast.success(successMessage);
      }
      if (result.rearmed) {
        toast.info('Posts voltaram para rascunho para o próximo ciclo de aprovação.');
      }
      if (result.rearmFailed) {
        toast.error(
          'A etapa avançou, mas não foi possível preparar os posts para o próximo ciclo de aprovação. Reinicie os status dos posts manualmente.',
        );
      }
      onRefresh();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao avançar etapa');
    }
  },
  [onRefresh, onRecurring],
);
```

3. `handleApproveInternally` — replace its inline `completeEtapa` block with a call to `advanceEtapa(card, 'Posts aprovados internamente — etapa concluída!')` **after** `approvePostsInternally(card.workflow.id!)` (keeps re-arm on). The recurring/toast branches inside it are removed since `advanceEtapa` handles them.
4. `handleAdvanceWithoutChanges` (the dialog's third option) — call `advanceEtapa(card, 'Etapa concluída!', { rearm: false })` (its literal contract: no post changes).
5. The silent all-cleared path in `executeForward` already goes through `advanceEtapa` → re-arm now applies (this is the path that breaks double approval today).
6. Pass `willRearm` where the dialog renders: `willRearm={approvalChoiceCard ? hasLaterApprovalEtapa(approvalChoiceCard.allEtapas, approvalChoiceCard.etapa.id!) : false}`.

`WorkflowDrawer.tsx` — **`checkAutoComplete` (~line 453) is dead code today**: nothing calls it, and
its predicate is impossible (it filters posts with status `enviado_cliente`/`correcao_cliente`, then
requires those same posts to be `aprovado_cliente`). Rework it into a real, transition-guarded
auto-complete:

1. Create `apps/crm/src/pages/entregas/components/autoComplete.ts` (pure, TDD in this task):

```ts
import type { WorkflowPost } from '../../../store';

const SENT = new Set(['enviado_cliente', 'correcao_cliente']);

/**
 * True when, DURING this drawer session, the last post awaiting the client transitioned to
 * aprovado_cliente: prev had ≥1 post awaiting, next has none awaiting and ≥1 aprovado_cliente.
 * The prev-state requirement stops it from firing on drawer open for already-approved cycles.
 */
export function shouldAutoCompleteApproval(
  prevPosts: WorkflowPost[] | null,
  nextPosts: WorkflowPost[],
): boolean {
  if (!prevPosts) return false;
  const prevAwaiting = prevPosts.some((p) => SENT.has(p.status));
  const nextAwaiting = nextPosts.some((p) => SENT.has(p.status));
  const nextApproved = nextPosts.some((p) => p.status === 'aprovado_cliente');
  return prevAwaiting && !nextAwaiting && nextApproved;
}
```

Tests (`apps/crm/src/pages/entregas/components/__tests__/autoComplete.test.ts`): fires on the
awaiting→approved transition; does NOT fire on first load (`prevPosts null`); does NOT fire when
posts were already all approved in both snapshots; does NOT fire while any post is still awaiting.

2. In `WorkflowDrawer.tsx`, delete the old `checkAutoComplete` and wire the trigger to the posts
query (the `useQuery` at ~line 172):

```tsx
const prevPostsRef = useRef<WorkflowPost[] | null>(null);
useEffect(() => {
  if (isLoading) return;
  const prev = prevPostsRef.current;
  prevPostsRef.current = posts;
  if (!shouldAutoCompleteApproval(prev, posts)) return;
  const approvalEtapa = card.allEtapas.find(
    (e) => e.tipo === 'aprovacao_cliente' && e.status === 'ativo',
  );
  if (!approvalEtapa) return;
  (async () => {
    try {
      const { rearmed, rearmFailed } = await completeEtapaWithRearm(workflowId, approvalEtapa.id!);
      toast.success('Todos os posts aprovados — etapa concluída!');
      if (rearmed) toast.info('Posts voltaram para rascunho para o próximo ciclo de aprovação.');
      if (rearmFailed)
        toast.error(
          'A etapa avançou, mas não foi possível preparar os posts para o próximo ciclo de aprovação. Reinicie os status dos posts manualmente.',
        );
      onRefresh();
    } catch {
      /* silent, etapa completion is a bonus */
    }
  })();
}, [posts, isLoading]); // card.allEtapas/workflowId are stable for an open drawer
```

(import `completeEtapaWithRearm` and `shouldAutoCompleteApproval`; the approval → completion →
re-arm chain itself is covered by the store-level `completeEtapaWithRearm` tests in Task 1 — the
pure transition tests here cover the trigger.)

- [ ] **Step 4: Write the KanbanView advance-path test**

Create `apps/crm/src/pages/entregas/views/__tests__/KanbanRearm.test.tsx`. Mock the store and `WorkflowCard` to keep it tractable:

```tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn().mockResolvedValue({ workflow: { status: 'ativo' }, etapas: [] }),
  completeEtapaWithRearm: vi
    .fn()
    .mockResolvedValue({ workflow: { status: 'ativo' }, etapas: [], rearmed: true }),
  hasLaterApprovalEtapa: vi.fn().mockReturnValue(true),
  approvePostsInternally: vi.fn().mockResolvedValue(undefined),
  sendPostsToCliente: vi.fn().mockResolvedValue(undefined),
  revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(),
}));
vi.mock('../../../../store', () => store);
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../components/WorkflowCard', () => ({
  WorkflowCard: ({ onForwardClick }: { onForwardClick?: () => void }) => (
    <button onClick={onForwardClick}>forward</button>
  ),
}));

import { KanbanView } from '../KanbanView';

const approvalEtapa = {
  id: 11, workflow_id: 1, ordem: 1, nome: 'Aprovação do texto', prazo_dias: 2,
  tipo_prazo: 'corridos' as const, tipo: 'aprovacao_cliente' as const, status: 'ativo' as const,
};
const card = {
  workflow: { id: 1, cliente_id: 1, titulo: 'Posts Agosto', status: 'ativo', etapa_atual: 1, recorrente: false },
  etapa: approvalEtapa,
  cliente: undefined,
  membro: undefined,
  deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
  totalEtapas: 4,
  etapaIdx: 1,
  allEtapas: [approvalEtapa],
} as never;

function renderBoard(cleared: number) {
  return render(
    <KanbanView
      cards={[card]}
      onCardClick={() => {}}
      onEditClick={() => {}}
      onPostsClick={() => {}}
      onRefresh={() => {}}
      onRecurring={() => {}}
      membros={[]}
      templates={[]}
      postsCounts={new Map([[1, 2]])}
      approvedPostsCounts={new Map()}
      clearedClienteCounts={new Map([[1, cleared]])}
      revisaoInternaCounts={new Map()}
      awaitingClienteCounts={new Map()}
    />,
  );
}

describe('KanbanView approval advance with re-arm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('silent all-cleared advance uses completeEtapaWithRearm', async () => {
    renderBoard(2); // cleared === total → no dialog
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar')); // ForwardConfirmDialog
    await waitFor(() => expect(store.completeEtapaWithRearm).toHaveBeenCalledWith(1, 11));
    expect(store.completeEtapa).not.toHaveBeenCalled();
  });

  it('"Avançar etapa sem alterar posts" uses plain completeEtapa', async () => {
    renderBoard(0); // not cleared → approval dialog
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar')); // ForwardConfirmDialog first
    fireEvent.click(await screen.findByText('Avançar etapa sem alterar posts'));
    await waitFor(() => expect(store.completeEtapa).toHaveBeenCalledWith(1, 11));
    expect(store.completeEtapaWithRearm).not.toHaveBeenCalled();
  });

  it('"Aprovar internamente" approves then advances with re-arm', async () => {
    renderBoard(0);
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar'));
    fireEvent.click(await screen.findByText('Aprovar internamente'));
    await waitFor(() => expect(store.approvePostsInternally).toHaveBeenCalledWith(1));
    expect(store.completeEtapaWithRearm).toHaveBeenCalledWith(1, 11);
  });

  it('rearmFailed surfaces the manual-remediation toast and still refreshes', async () => {
    store.completeEtapaWithRearm.mockResolvedValue({
      workflow: { status: 'ativo' }, etapas: [], rearmed: false, rearmFailed: true,
    });
    const onRefresh = vi.fn();
    renderBoard(2, { onRefresh }); // extend renderBoard to accept an onRefresh override
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar'));
    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/reinicie os status/i)),
    );
    expect(onRefresh).toHaveBeenCalled();
  });
});
```

And the second-cycle badge regression test, `WorkflowCard.badges.test.tsx` — render the real
`WorkflowCard` (mock nothing but props) with a card whose `allEtapas` contain the FIRST approval at
`ordem: 1`, current `etapa.ordem: 3` (i.e. during the second cycle) and `awaitingClienteCount: 2`,
and assert `screen.getByText(/2 posts com o cliente/i)` renders — pinning that the
find-first-approval display logic stays correct under re-arm. Include a negative case:
`card.etapa.ordem: 0` (before the first approval) renders no badge.

Note: `BoardCard` in this view requires `allEtapas` (check the local interface at the top of `KanbanView.tsx` / `useEntregasData.ts` — include every field the type demands; the `as never` cast keeps the fixture honest only if the runtime fields used by the handlers are present, which they are above).

- [ ] **Step 5: Run both test files — expect PASS**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/WorkflowModals.test.tsx apps/crm/src/pages/entregas/views/__tests__/KanbanRearm.test.tsx`
Expected: PASS. If the ForwardConfirmDialog/approval dialog copy differs, match the exact strings from `WorkflowModals.tsx` (`Avançar`, `Aprovar internamente`, `Avançar etapa sem alterar posts`).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas
git commit -m "feat(entregas): re-arm approval cycle on advance paths + dialog note

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Dialog X-button close guard

**Files:**
- Modify: `apps/crm/src/components/ui/dialog.tsx` (~line 112, the `DialogPrimitive.Close` element)
- Test: `apps/crm/src/components/ui/__tests__/dialog-confirm-close.test.tsx` (create)

**Interfaces:**
- Consumes: existing `handleConfirmTrigger` callback already defined in `DialogContent`.
- Produces: no API change — the X button now respects `confirmClose`/`onConfirmClose` like Escape and outside-click already do.

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../dialog';

function renderDirty(onConfirmClose: () => void) {
  return render(
    <Dialog open onOpenChange={() => {}}>
      <DialogContent confirmClose onConfirmClose={onConfirmClose}>
        <DialogHeader>
          <DialogTitle>Título</DialogTitle>
        </DialogHeader>
        <p>corpo</p>
      </DialogContent>
    </Dialog>,
  );
}

describe('DialogContent close confirmation', () => {
  it('X button opens the confirm dialog instead of closing', () => {
    const onConfirmClose = vi.fn();
    renderDirty(onConfirmClose);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.getByText('Fechar sem salvar?')).toBeTruthy();
    expect(onConfirmClose).not.toHaveBeenCalled();
  });

  it('confirming from the X path calls onConfirmClose', () => {
    const onConfirmClose = vi.fn();
    renderDirty(onConfirmClose);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    fireEvent.click(screen.getByText('Fechar mesmo assim'));
    expect(onConfirmClose).toHaveBeenCalledTimes(1);
  });

  it('Escape opens the confirm dialog (regression guard)', () => {
    const onConfirmClose = vi.fn();
    renderDirty(onConfirmClose);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByText('Fechar sem salvar?')).toBeTruthy();
  });

  it('overlay pointerdown opens the confirm dialog (outside-interaction guard)', () => {
    const onConfirmClose = vi.fn();
    const { baseElement } = renderDirty(onConfirmClose);
    // Radix DismissableLayer listens for pointerdown outside the content layer;
    // the overlay element is outside it. jsdom needs the full down→up→click sequence.
    const overlay = baseElement.querySelector('[data-radix-dialog-overlay], .fixed.inset-0')!;
    fireEvent.pointerDown(overlay);
    fireEvent.pointerUp(overlay);
    fireEvent.click(overlay);
    expect(screen.getByText('Fechar sem salvar?')).toBeTruthy();
    expect(onConfirmClose).not.toHaveBeenCalled();
  });
});
```

(If jsdom doesn't deliver Radix's outside-pointerdown detection, drive the same path by calling
`fireEvent.pointerDown(document.body)` — the assertion stays identical; do NOT delete the test.)

- [ ] **Step 2: Run — expect the first two to FAIL** (X closes without confirm today).

Run: `npx vitest run apps/crm/src/components/ui/__tests__/dialog-confirm-close.test.tsx`

- [ ] **Step 3: Implement**

In `dialog.tsx`, add `onClick={handleConfirmTrigger}` to the built-in close button. Radix composes user handlers before its internal `onOpenChange(false)` and skips the internal handler when `event.defaultPrevented`:

```tsx
<DialogPrimitive.Close
  onClick={handleConfirmTrigger}
  className="absolute right-4 top-4 rounded-sm opacity-70 ..."
>
```

(`handleConfirmTrigger` already no-ops when not dirty, so clean dialogs keep closing instantly.)

- [ ] **Step 4: Run — expect PASS** (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/ui/dialog.tsx apps/crm/src/components/ui/__tests__/dialog-confirm-close.test.tsx
git commit -m "fix(ui): dialog X button respects the unsaved-changes close guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Extract SortableEtapaList with approval pill + suggestionId

**Files:**
- Create: `apps/crm/src/pages/entregas/components/SortableEtapaList.tsx`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` (delete local `EtapaFormData`, `defaultEtapa`, `_etapaIdCounter`, `SortableEtapaRow`, `SortableEtapaList` — lines ~90–326 — and import them from the new module)
- Test: `apps/crm/src/pages/entregas/components/__tests__/SortableEtapaList.test.tsx` (create)

**Interfaces:**
- Produces (exact exports later tasks depend on):

```ts
export interface EtapaFormData {
  _id: string;
  suggestionId?: string;          // stable chip identity; absent for custom/template-only rows
  nome: string;
  prazo: number;
  tipoPrazo: 'corridos' | 'uteis';
  responsavelId: number | null;
  tipo: 'padrao' | 'aprovacao_cliente';
  dataLimite: string;
}
export function defaultEtapa(overrides?: Partial<EtapaFormData>): EtapaFormData;
export function SortableEtapaList(props: {
  etapas: EtapaFormData[];
  setEtapas: (e: EtapaFormData[]) => void;
  modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega';
  membros: Membro[];
  rowErrors?: Map<string, string>;   // _id -> message (wizard step-3 inline validation)
}): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

```tsx
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  SortableEtapaList,
  defaultEtapa,
  type EtapaFormData,
} from '../SortableEtapaList';

function Harness({ initial }: { initial: EtapaFormData[] }) {
  const [etapas, setEtapas] = useState(initial);
  return (
    <SortableEtapaList etapas={etapas} setEtapas={setEtapas} modoPrazo="padrao" membros={[]} />
  );
}

describe('SortableEtapaList', () => {
  it('toggles aprovação externa via the pill and shows the portal note', () => {
    render(<Harness initial={[defaultEtapa({ nome: 'Design' })]} />);
    const pill = screen.getByRole('button', { name: /aprovação externa/i });
    expect(pill.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pill);
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/portal do cliente/i)).toBeTruthy();
  });

  it('allows multiple approval rows', () => {
    render(
      <Harness
        initial={[
          defaultEtapa({ nome: 'Aprovação do texto', tipo: 'aprovacao_cliente' }),
          defaultEtapa({ nome: 'Aprovação da arte', tipo: 'aprovacao_cliente' }),
        ]}
      />,
    );
    const pills = screen.getAllByRole('button', { name: /aprovação externa/i });
    expect(pills.filter((p) => p.getAttribute('aria-pressed') === 'true')).toHaveLength(2);
  });

  it('renders a row error when provided', () => {
    const row = defaultEtapa({ nome: 'Criação' });
    render(
      <SortableEtapaList
        etapas={[row]}
        setEtapas={() => {}}
        modoPrazo="padrao"
        membros={[]}
        rowErrors={new Map([[row._id, 'Responsável não existe mais — selecione outro']])}
      />,
    );
    expect(screen.getByText(/não existe mais/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module doesn't exist).

- [ ] **Step 3: Implement the extraction**

Move `SortableEtapaRow`, `SortableEtapaList`, `EtapaFormData`, `defaultEtapa`, `_etapaIdCounter` from `WorkflowModals.tsx` into the new file **verbatim**, then apply these changes:

1. `defaultEtapa` signature becomes `defaultEtapa(overrides?: Partial<EtapaFormData>)` returning `{ _id: \`etapa-${++_etapaIdCounter}\`, nome: '', prazo: 3, tipoPrazo: 'corridos', responsavelId: null, tipo: 'padrao', dataLimite: '', ...overrides }`.
2. Replace the checkbox block at the end of `SortableEtapaRow` with the pill toggle + conditional note:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
  <button
    type="button"
    aria-pressed={tipo === 'aprovacao_cliente'}
    onClick={() => onChange('tipo', tipo === 'aprovacao_cliente' ? 'padrao' : 'aprovacao_cliente')}
    style={{
      alignSelf: 'flex-start',
      fontSize: '0.72rem',
      fontWeight: tipo === 'aprovacao_cliente' ? 600 : 400,
      borderRadius: 999,
      padding: '2px 10px',
      cursor: 'pointer',
      border: tipo === 'aprovacao_cliente' ? '1px solid #1d4ed8' : '1px solid var(--border-color)',
      background: tipo === 'aprovacao_cliente' ? '#1d4ed8' : 'transparent',
      color: tipo === 'aprovacao_cliente' ? '#fff' : 'var(--text-muted)',
    }}
  >
    {tipo === 'aprovacao_cliente' ? '✓ Aprovação externa' : 'Aprovação externa'}
  </button>
  {tipo === 'aprovacao_cliente' && (
    <p style={{ fontSize: '0.7rem', color: '#1d4ed8', margin: 0 }}>
      Etapa especial: envia os posts para aprovação no portal do cliente (Hub).
    </p>
  )}
</div>
```

3. The row container gets a conditional approval tint — in the outer row `<div style={{...}}>` replace the static border with:

```tsx
border: tipo === 'aprovacao_cliente' ? '1px solid #bfdbfe' : '1px solid var(--border-color)',
background: tipo === 'aprovacao_cliente' ? 'rgba(59,130,246,0.06)' : undefined,
```

4. Add `rowErrors` prop to `SortableEtapaList`; pass each row's message into `SortableEtapaRow` as `error?: string` and render below the responsável select:

```tsx
{error && (
  <p role="alert" style={{ fontSize: '0.72rem', color: 'var(--danger)', margin: 0 }}>
    {error}
  </p>
)}
```

5. In `WorkflowModals.tsx`: delete the moved code, add
   `import { SortableEtapaList, defaultEtapa, type EtapaFormData } from './SortableEtapaList';`
   and remove now-unused imports (`Checkbox` stays — used elsewhere; `GripVertical`, dnd-kit imports move to the new file). `NewWorkflowModal`/`TemplatesModal` keep compiling unchanged otherwise.

- [ ] **Step 4: Run new + existing modal tests**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/`
Expected: new file PASS. If `WorkflowModals.test.tsx` queried the old checkbox (`Aprovação externa` as checkbox role), update those queries to the pill button. Everything else must stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components
git commit -m "refactor(entregas): extract SortableEtapaList with approval pill + row errors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Analytics event union

**Files:**
- Modify: `apps/crm/src/lib/analytics.ts` (~line 9, the `AnalyticsEvent` union)
- Test: `apps/crm/src/lib/__tests__/analytics.test.ts` (extend)

**Interfaces:**
- Produces the five event names later tasks call: `'workflow_wizard_source' | 'workflow_saved_as_template' | 'entregas_tour_started' | 'entregas_tour_completed' | 'entregas_tour_dismissed'`.

- [ ] **Step 1: Extend the union**

```ts
export type AnalyticsEvent =
  | 'signup_completed'
  | 'workspace_setup_completed'
  | 'client_created'
  | 'instagram_connected'
  | 'workflow_created'
  | 'workflow_wizard_source'
  | 'workflow_saved_as_template'
  | 'entregas_tour_started'
  | 'entregas_tour_completed'
  | 'entregas_tour_dismissed'
  | 'hub_link_copied'
  | 'report_generated'
  | 'invite_sent';
```

- [ ] **Step 2: Extend the test** — open `apps/crm/src/lib/__tests__/analytics.test.ts`, follow its existing pattern (it mocks `posthog-js`); add one case asserting `captureEvent('workflow_wizard_source', { source: 'posts-mensais' })` forwards to `posthog.capture` when enabled. If the file only type-checks the union, add the new names to that list.

- [ ] **Step 3: Run** `npx vitest run apps/crm/src/lib/__tests__/analytics.test.ts` — expect PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/lib
git commit -m "feat(analytics): wizard + entregas tour event names

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Standard presets

**Files:**
- Create: `apps/crm/src/pages/entregas/wizard/presets.ts`
- Test: `apps/crm/src/pages/entregas/wizard/__tests__/presets.test.ts`

**Interfaces:**
- Produces:

```ts
export interface WorkflowPresetEtapa {
  nome: string; prazo_dias: number; tipo_prazo: 'uteis' | 'corridos';
  tipo: 'padrao' | 'aprovacao_cliente';
}
export interface WorkflowPreset {
  id: string; nome: string; descricao: string; icon: LucideIcon;
  recorrente: boolean; modo_prazo: 'padrao' | 'data_fixa' | 'data_entrega';
  etapas: WorkflowPresetEtapa[];
}
export const STANDARD_PRESETS: WorkflowPreset[];
export function presetDurationDays(p: WorkflowPreset): number; // sum of prazo_dias
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { STANDARD_PRESETS, presetDurationDays } from '../presets';

describe('STANDARD_PRESETS', () => {
  it('has 6 presets with unique ids', () => {
    expect(STANDARD_PRESETS).toHaveLength(6);
    expect(new Set(STANDARD_PRESETS.map((p) => p.id)).size).toBe(6);
  });

  it('every preset has at least one named etapa and no responsavel', () => {
    for (const p of STANDARD_PRESETS) {
      expect(p.etapas.length).toBeGreaterThan(0);
      for (const e of p.etapas) expect(e.nome.trim().length).toBeGreaterThan(0);
    }
  });

  it('every data_entrega preset contains an aprovacao_cliente anchor', () => {
    for (const p of STANDARD_PRESETS.filter((p) => p.modo_prazo === 'data_entrega')) {
      expect(p.etapas.some((e) => e.tipo === 'aprovacao_cliente')).toBe(true);
    }
  });

  it('aprovacao-dupla has exactly two approval etapas', () => {
    const dupla = STANDARD_PRESETS.find((p) => p.id === 'aprovacao-dupla')!;
    expect(dupla.etapas.filter((e) => e.tipo === 'aprovacao_cliente')).toHaveLength(2);
  });

  it('sums duration', () => {
    const avulso = STANDARD_PRESETS.find((p) => p.id === 'post-avulso')!;
    expect(presetDurationDays(avulso)).toBe(4);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run apps/crm/src/pages/entregas/wizard/__tests__/presets.test.ts`

- [ ] **Step 3: Implement `presets.ts`** (exact data from the spec table):

```ts
import { CalendarDays, Clapperboard, Palette, PenLine, Rocket, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface WorkflowPresetEtapa {
  nome: string;
  prazo_dias: number;
  tipo_prazo: 'uteis' | 'corridos';
  tipo: 'padrao' | 'aprovacao_cliente';
}

export interface WorkflowPreset {
  id: string;
  nome: string;
  descricao: string;
  icon: LucideIcon;
  recorrente: boolean;
  modo_prazo: 'padrao' | 'data_fixa' | 'data_entrega';
  etapas: WorkflowPresetEtapa[];
}

const p = (nome: string, prazo_dias: number, tipo_prazo: 'uteis' | 'corridos' = 'uteis'): WorkflowPresetEtapa => ({ nome, prazo_dias, tipo_prazo, tipo: 'padrao' });
const ap = (nome: string, prazo_dias: number): WorkflowPresetEtapa => ({ nome, prazo_dias, tipo_prazo: 'corridos', tipo: 'aprovacao_cliente' });

export const STANDARD_PRESETS: WorkflowPreset[] = [
  {
    id: 'posts-mensais',
    nome: 'Posts mensais',
    descricao: 'O ciclo mensal clássico: criação, revisão e aprovação do cliente.',
    icon: CalendarDays,
    recorrente: true,
    modo_prazo: 'data_entrega',
    etapas: [p('Criação', 4), p('Revisão interna', 1), ap('Aprovação do cliente', 3), p('Ajustes', 2), p('Agendamento', 1)],
  },
  {
    id: 'aprovacao-dupla',
    nome: 'Aprovação dupla (texto + arte)',
    descricao: 'O cliente aprova o texto antes do design e a arte antes dos ajustes finais.',
    icon: PenLine,
    recorrente: true,
    modo_prazo: 'padrao',
    etapas: [p('Redação', 3), ap('Aprovação do texto', 2), p('Design', 3), ap('Aprovação da arte', 2), p('Ajustes finais', 1), p('Agendamento', 1)],
  },
  {
    id: 'reels-video',
    nome: 'Reels / vídeo',
    descricao: 'Do roteiro à publicação, com aprovação do cliente antes de publicar.',
    icon: Clapperboard,
    recorrente: false,
    modo_prazo: 'padrao',
    etapas: [p('Roteiro', 2), p('Gravação', 2), p('Edição', 3), ap('Aprovação do cliente', 2), p('Publicação', 1)],
  },
  {
    id: 'campanha-lancamento',
    nome: 'Campanha / lançamento',
    descricao: 'Planejamento, criativos, veiculação e relatório final.',
    icon: Rocket,
    recorrente: false,
    modo_prazo: 'padrao',
    etapas: [p('Planejamento', 3), p('Criativos', 4), p('Revisão', 1), ap('Aprovação do cliente', 2), p('Veiculação', 3), p('Relatório', 2)],
  },
  {
    id: 'post-avulso',
    nome: 'Post avulso rápido',
    descricao: 'Três etapas, sem aprovação externa — para demandas pontuais.',
    icon: Zap,
    recorrente: false,
    modo_prazo: 'padrao',
    etapas: [p('Criação', 2), p('Revisão', 1), p('Publicação', 1)],
  },
  {
    id: 'identidade-branding',
    nome: 'Identidade / branding',
    descricao: 'Pesquisa, proposta, aprovação e entrega final.',
    icon: Palette,
    recorrente: false,
    modo_prazo: 'padrao',
    etapas: [p('Pesquisa', 5), p('Proposta', 5), ap('Aprovação do cliente', 3), p('Refinamento', 4), p('Entrega final', 2)],
  },
];

export function presetDurationDays(preset: WorkflowPreset): number {
  return preset.etapas.reduce((sum, e) => sum + e.prazo_dias, 0);
}
```

- [ ] **Step 4: Run — expect PASS** (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/wizard
git commit -m "feat(entregas): six standard workflow presets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Wizard helpers — suggestions, validation, name

**Files:**
- Create: `apps/crm/src/pages/entregas/wizard/wizardLogic.ts`
- Test: `apps/crm/src/pages/entregas/wizard/__tests__/wizardLogic.test.ts`

**Interfaces:**
- Consumes: `EtapaFormData`, `defaultEtapa` (Task 4); `WorkflowPreset` (Task 6); `Cliente`, `Membro`, `WorkflowTemplate` from `../../../store`.
- Produces:

```ts
export const SUGGESTED_ETAPAS: { suggestionId: string; nome: string; tipo: 'padrao' | 'aprovacao_cliente'; prazo: number; tipoPrazo: 'uteis' | 'corridos' }[];
export function etapasFromPreset(preset: WorkflowPreset): EtapaFormData[];
export function etapasFromTemplate(tpl: WorkflowTemplate): EtapaFormData[];
export function suggestName(sourceNome: string, today?: Date): string;
export function validateEtapas(etapas: EtapaFormData[], membros: Membro[]): { rowErrors: Map<string, string>; globalError: string | null };
export function validatePrazos(etapas: EtapaFormData[], modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega'): string | null;
export function dataEntregaAvailability(etapas: EtapaFormData[], cliente: Cliente | undefined): { enabled: boolean; reason: string | null };
export function countApprovals(etapas: EtapaFormData[]): number;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../../lib/supabase');

import {
  SUGGESTED_ETAPAS, etapasFromPreset, etapasFromTemplate, suggestName,
  validateEtapas, dataEntregaAvailability, countApprovals,
} from '../wizardLogic';
import { STANDARD_PRESETS } from '../presets';
import { defaultEtapa } from '../../components/SortableEtapaList';

const membros = [{ id: 7, nome: 'Maria' }] as never[];

describe('wizardLogic', () => {
  it('maps preset etapas to form rows, binding suggestionIds by name', () => {
    const rows = etapasFromPreset(STANDARD_PRESETS.find((p) => p.id === 'posts-mensais')!);
    expect(rows).toHaveLength(5);
    expect(rows[0].nome).toBe('Criação');
    expect(rows[0].suggestionId).toBe('criacao');
    expect(rows[2].tipo).toBe('aprovacao_cliente');
    expect(rows.every((r) => r.responsavelId === null)).toBe(true);
  });

  it('template rows without a matching suggestion carry no suggestionId', () => {
    const rows = etapasFromTemplate({
      nome: 'T', etapas: [{ nome: 'Copywriting exótico', prazo_dias: 2, tipo_prazo: 'uteis' }],
    } as never);
    expect(rows[0].suggestionId).toBeUndefined();
  });

  it('suggests "<source> — <Mês de AAAA>" for next month', () => {
    expect(suggestName('Posts mensais', new Date(2026, 6, 20))).toBe('Posts mensais — Agosto de 2026');
  });

  it('flags rows whose responsável is missing or not in membros', () => {
    const ok = defaultEtapa({ nome: 'A', responsavelId: 7 });
    const missing = defaultEtapa({ nome: 'B', responsavelId: null });
    const stale = defaultEtapa({ nome: 'C', responsavelId: 999 });
    const { rowErrors, globalError } = validateEtapas([ok, missing, stale], membros);
    expect(globalError).toBeNull();
    expect(rowErrors.get(missing._id)).toMatch(/responsável/i);
    expect(rowErrors.get(stale._id)).toMatch(/não existe mais/i);
  });

  it('requires at least one named etapa', () => {
    expect(validateEtapas([defaultEtapa()], membros).globalError).toMatch(/pelo menos uma etapa/i);
  });

  it('data_entrega availability matrix', () => {
    const aprov = defaultEtapa({ nome: 'Aprovação', tipo: 'aprovacao_cliente' });
    const semAprov = defaultEtapa({ nome: 'Criação' });
    const cliente = { id: 1, dia_entrega: 5 } as never;
    const clienteSem = { id: 2 } as never;
    expect(dataEntregaAvailability([aprov], cliente).enabled).toBe(true);
    expect(dataEntregaAvailability([semAprov], cliente).reason).toMatch(/aprovação/i);
    expect(dataEntregaAvailability([aprov], clienteSem).reason).toMatch(/dia de entrega/i);
    expect(dataEntregaAvailability([aprov], undefined).enabled).toBe(false);
  });

  it('counts approvals', () => {
    expect(countApprovals([defaultEtapa({ tipo: 'aprovacao_cliente' }), defaultEtapa()])).toBe(1);
  });

  it('validatePrazos requires a data limite on every named etapa in data_fixa mode', () => {
    const comData = defaultEtapa({ nome: 'A', dataLimite: '2026-08-05' });
    const semData = defaultEtapa({ nome: 'B' });
    expect(validatePrazos([comData, semData], 'data_fixa')).toMatch(/data limite/i);
    expect(validatePrazos([comData], 'data_fixa')).toBeNull();
    expect(validatePrazos([semData], 'padrao')).toBeNull();
    expect(validatePrazos([semData], 'data_entrega')).toBeNull();
  });

  it('suggested etapas include one aprovacao_cliente entry', () => {
    expect(SUGGESTED_ETAPAS.filter((s) => s.tipo === 'aprovacao_cliente')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `wizardLogic.ts`**

```ts
import type { Cliente, Membro, WorkflowTemplate } from '../../../store';
import { defaultEtapa, type EtapaFormData } from '../components/SortableEtapaList';
import type { WorkflowPreset } from './presets';

export const SUGGESTED_ETAPAS = [
  { suggestionId: 'briefing', nome: 'Briefing', tipo: 'padrao', prazo: 2, tipoPrazo: 'uteis' },
  { suggestionId: 'roteiro', nome: 'Roteiro', tipo: 'padrao', prazo: 2, tipoPrazo: 'uteis' },
  { suggestionId: 'redacao', nome: 'Redação', tipo: 'padrao', prazo: 3, tipoPrazo: 'uteis' },
  { suggestionId: 'criacao', nome: 'Criação', tipo: 'padrao', prazo: 4, tipoPrazo: 'uteis' },
  { suggestionId: 'design', nome: 'Design', tipo: 'padrao', prazo: 3, tipoPrazo: 'uteis' },
  { suggestionId: 'revisao-interna', nome: 'Revisão interna', tipo: 'padrao', prazo: 1, tipoPrazo: 'uteis' },
  { suggestionId: 'aprovacao-cliente', nome: 'Aprovação do cliente', tipo: 'aprovacao_cliente', prazo: 3, tipoPrazo: 'corridos' },
  { suggestionId: 'ajustes', nome: 'Ajustes', tipo: 'padrao', prazo: 2, tipoPrazo: 'uteis' },
  { suggestionId: 'agendamento', nome: 'Agendamento', tipo: 'padrao', prazo: 1, tipoPrazo: 'uteis' },
  { suggestionId: 'publicacao', nome: 'Publicação', tipo: 'padrao', prazo: 1, tipoPrazo: 'uteis' },
  { suggestionId: 'relatorio', nome: 'Relatório', tipo: 'padrao', prazo: 2, tipoPrazo: 'uteis' },
] as const satisfies readonly {
  suggestionId: string; nome: string; tipo: 'padrao' | 'aprovacao_cliente';
  prazo: number; tipoPrazo: 'uteis' | 'corridos';
}[];

/** Normalize for name → suggestionId matching (load-time only). */
const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const suggestionByName = new Map(SUGGESTED_ETAPAS.map((s) => [norm(s.nome), s.suggestionId]));

function bindSuggestion(nome: string): string | undefined {
  return suggestionByName.get(norm(nome));
}

export function etapasFromPreset(preset: WorkflowPreset): EtapaFormData[] {
  return preset.etapas.map((e) =>
    defaultEtapa({
      nome: e.nome, prazo: e.prazo_dias, tipoPrazo: e.tipo_prazo, tipo: e.tipo,
      responsavelId: null, suggestionId: bindSuggestion(e.nome),
    }),
  );
}

export function etapasFromTemplate(tpl: WorkflowTemplate): EtapaFormData[] {
  return tpl.etapas.map((e) =>
    defaultEtapa({
      nome: e.nome, prazo: e.prazo_dias, tipoPrazo: e.tipo_prazo,
      tipo: e.tipo || 'padrao', responsavelId: e.responsavel_id || null,
      suggestionId: bindSuggestion(e.nome),
    }),
  );
}

export function suggestName(sourceNome: string, today = new Date()): string {
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const label = next.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return `${sourceNome} — ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function validateEtapas(
  etapas: EtapaFormData[], membros: Membro[],
): { rowErrors: Map<string, string>; globalError: string | null } {
  const named = etapas.filter((e) => e.nome.trim());
  if (named.length === 0) {
    return { rowErrors: new Map(), globalError: 'Adicione pelo menos uma etapa.' };
  }
  const memberIds = new Set(membros.map((m) => m.id));
  const rowErrors = new Map<string, string>();
  for (const e of named) {
    if (e.responsavelId == null) {
      rowErrors.set(e._id, 'Selecione um responsável para esta etapa.');
    } else if (!memberIds.has(e.responsavelId)) {
      rowErrors.set(e._id, 'Responsável não existe mais — selecione outro.');
    }
  }
  return { rowErrors, globalError: null };
}

export function dataEntregaAvailability(
  etapas: EtapaFormData[], cliente: Cliente | undefined,
): { enabled: boolean; reason: string | null } {
  if (!etapas.some((e) => e.nome.trim() && e.tipo === 'aprovacao_cliente')) {
    return { enabled: false, reason: 'Requer uma etapa de Aprovação do cliente como âncora.' };
  }
  if (!cliente?.dia_entrega) {
    return { enabled: false, reason: 'O cliente não tem um dia de entrega configurado.' };
  }
  return { enabled: true, reason: null };
}

export function countApprovals(etapas: EtapaFormData[]): number {
  return etapas.filter((e) => e.nome.trim() && e.tipo === 'aprovacao_cliente').length;
}

export function validatePrazos(
  etapas: EtapaFormData[],
  modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega',
): string | null {
  if (modoPrazo !== 'data_fixa') return null;
  const missing = etapas.filter((e) => e.nome.trim() && !e.dataLimite);
  return missing.length > 0
    ? 'Defina uma data limite para todas as etapas no modo Datas fixas.'
    : null;
}
```

- [ ] **Step 4: Run — expect PASS** (8 tests). Note: `Cliente.dia_entrega` — confirm the field exists on the `Cliente` type (it's used by `NewWorkflowModal` today).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/wizard
git commit -m "feat(entregas): wizard suggestion/validation/name helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Template-first creation sequencing

**Files:**
- Create: `apps/crm/src/pages/entregas/wizard/createWorkflow.ts`
- Test: `apps/crm/src/pages/entregas/wizard/__tests__/createWorkflow.test.ts`

**Interfaces:**
- Consumes: `addWorkflow`, `addWorkflowEtapa`, `addWorkflowTemplate`, `removeWorkflow` from `../../../store`; `computeDeliveryDeadlines`, `getNextDeliveryDate` from `../hooks/useEntregasData`; `EtapaFormData` (Task 4).
- Produces:

```ts
export type WizardSource =
  | { kind: 'preset'; presetId: string; presetNome: string }
  | { kind: 'template'; templateId: number; templateNome: string }
  | { kind: 'zero' };
export interface WizardCreateInput {
  clienteId: number; titulo: string; recorrente: boolean;
  modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega';
  mesEntrega: string;                 // 'YYYY-MM' or '' = próximo disponível
  etapas: EtapaFormData[];            // pre-validated by wizardLogic
  source: WizardSource;
  saveAsTemplate: boolean; templateName: string;
  cliente: Cliente | undefined;       // selected client row (dia_entrega)
  membros: Membro[];
}
export async function createWorkflowFromWizard(input: WizardCreateInput):
  Promise<{ workflow: Workflow; template?: WorkflowTemplate; warning?: string }>;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(),
  addWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(),
}));
vi.mock('../../../../store', () => store);

import { createWorkflowFromWizard, type WizardCreateInput } from '../createWorkflow';
import { defaultEtapa } from '../../components/SortableEtapaList';

const baseInput = (over: Partial<WizardCreateInput> = {}): WizardCreateInput => ({
  clienteId: 1,
  titulo: 'Posts — Agosto de 2026',
  recorrente: true,
  modoPrazo: 'padrao',
  mesEntrega: '',
  etapas: [defaultEtapa({ nome: 'Criação', responsavelId: 7 })],
  source: { kind: 'preset', presetId: 'posts-mensais', presetNome: 'Posts mensais' },
  saveAsTemplate: false,
  templateName: '',
  cliente: { id: 1, dia_entrega: 5 } as never,
  membros: [{ id: 7, nome: 'Maria' }] as never,
  ...over,
});

describe('createWorkflowFromWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.addWorkflow.mockResolvedValue({ id: 42 });
    store.addWorkflowEtapa.mockResolvedValue({ id: 1 });
    store.addWorkflowTemplate.mockResolvedValue({ id: 9, nome: 'Meu template' });
  });

  it('creates template FIRST and links it via template_id', async () => {
    const result = await createWorkflowFromWizard(
      baseInput({ saveAsTemplate: true, templateName: 'Meu template' }),
    );
    expect(store.addWorkflowTemplate.mock.invocationCallOrder[0]).toBeLessThan(
      store.addWorkflow.mock.invocationCallOrder[0],
    );
    expect(store.addWorkflow).toHaveBeenCalledWith(expect.objectContaining({ template_id: 9 }));
    expect(result.template).toEqual({ id: 9, nome: 'Meu template' });
    expect(result.warning).toBeUndefined();
  });

  it('template failure warns but still creates the workflow with template_id null', async () => {
    store.addWorkflowTemplate.mockRejectedValue(new Error('boom'));
    const result = await createWorkflowFromWizard(
      baseInput({ saveAsTemplate: true, templateName: 'Meu template' }),
    );
    expect(result.workflow).toEqual({ id: 42 });
    expect(result.warning).toMatch(/template/i);
    expect(store.addWorkflow).toHaveBeenCalledWith(expect.objectContaining({ template_id: null }));
  });

  it('account-template source links the source template id', async () => {
    await createWorkflowFromWizard(
      baseInput({ source: { kind: 'template', templateId: 5, templateNome: 'T' } }),
    );
    expect(store.addWorkflow).toHaveBeenCalledWith(expect.objectContaining({ template_id: 5 }));
  });

  it('etapa failure removes the orphaned workflow but keeps the template', async () => {
    store.addWorkflowEtapa.mockRejectedValue(new Error('etapa boom'));
    await expect(
      createWorkflowFromWizard(baseInput({ saveAsTemplate: true, templateName: 'X' })),
    ).rejects.toThrow('etapa boom');
    expect(store.removeWorkflow).toHaveBeenCalledWith(42);
  });

  it('first etapa starts ativo with iniciado_em, rest pendente', async () => {
    await createWorkflowFromWizard(
      baseInput({
        etapas: [
          defaultEtapa({ nome: 'A', responsavelId: 7 }),
          defaultEtapa({ nome: 'B', responsavelId: 7 }),
        ],
      }),
    );
    const calls = store.addWorkflowEtapa.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ ordem: 0, status: 'ativo' });
    expect(calls[0].iniciado_em).toBeTruthy();
    expect(calls[1]).toMatchObject({ ordem: 1, status: 'pendente', iniciado_em: null });
  });

  it('stale responsavel is sanitized to null at insert (defense in depth)', async () => {
    await createWorkflowFromWizard(
      baseInput({ etapas: [defaultEtapa({ nome: 'A', responsavelId: 999 })] }),
    );
    expect(store.addWorkflowEtapa).toHaveBeenCalledWith(
      expect.objectContaining({ responsavel_id: null }),
    );
  });

  const dataEntregaEtapas = [
    defaultEtapa({ nome: 'Criação', responsavelId: 7 }),
    defaultEtapa({ nome: 'Aprovação', responsavelId: 7, tipo: 'aprovacao_cliente' }),
  ];

  it('data_entrega with empty mesEntrega computes real deadlines via getNextDeliveryDate', async () => {
    await createWorkflowFromWizard(
      baseInput({ modoPrazo: 'data_entrega', mesEntrega: '', etapas: dataEntregaEtapas }),
    );
    const calls = store.addWorkflowEtapa.mock.calls.map((c) => c[0]);
    // computeDeliveryDeadlines is real: the aprovacao anchor guarantees non-null ISO dates
    expect(calls.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.data_limite))).toBe(true);
  });

  it("the Select sentinel '__auto__' is normalized and never parsed as YYYY-MM", async () => {
    await createWorkflowFromWizard(
      baseInput({ modoPrazo: 'data_entrega', mesEntrega: '__auto__', etapas: dataEntregaEtapas }),
    );
    const calls = store.addWorkflowEtapa.mock.calls.map((c) => c[0]);
    expect(calls.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.data_limite))).toBe(true); // no Invalid Date
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `createWorkflow.ts`** (deadline computation logic ported from today's `NewWorkflowModal.handleSave`, WorkflowModals.tsx ~lines 395–436):

```ts
import type { Cliente, Membro, Workflow, WorkflowTemplate } from '../../../store';
import { addWorkflow, addWorkflowEtapa, addWorkflowTemplate, removeWorkflow } from '../../../store';
import { computeDeliveryDeadlines, getNextDeliveryDate } from '../hooks/useEntregasData';
import type { EtapaFormData } from '../components/SortableEtapaList';

export type WizardSource =
  | { kind: 'preset'; presetId: string; presetNome: string }
  | { kind: 'template'; templateId: number; templateNome: string }
  | { kind: 'zero' };

export interface WizardCreateInput {
  clienteId: number;
  titulo: string;
  recorrente: boolean;
  modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega';
  mesEntrega: string;
  etapas: EtapaFormData[];
  source: WizardSource;
  saveAsTemplate: boolean;
  templateName: string;
  cliente: Cliente | undefined;
  membros: Membro[];
}

function deliveryDeadlines(input: WizardCreateInput, valid: EtapaFormData[]) {
  if (input.modoPrazo !== 'data_entrega' || !input.cliente?.dia_entrega) return null;
  // State stores '' for "próximo mês disponível"; '__auto__' is the Select's sentinel and must
  // never leak here — normalize defensively so it can't parse as an invalid YYYY-MM.
  const mes = input.mesEntrega === '__auto__' ? '' : input.mesEntrega;
  let deliveryDate: Date;
  if (mes) {
    const [yr, mo] = mes.split('-').map(Number);
    const lastDay = new Date(yr, mo, 0).getDate();
    deliveryDate = new Date(yr, mo - 1, Math.min(input.cliente.dia_entrega, lastDay));
  } else {
    deliveryDate = getNextDeliveryDate(input.cliente.dia_entrega);
  }
  const mock = valid.map((e, i) => ({
    id: i, workflow_id: 0, ordem: i, nome: e.nome, prazo_dias: e.prazo,
    tipo_prazo: e.tipoPrazo, responsavel_id: e.responsavelId, tipo: e.tipo,
    status: 'pendente' as const, iniciado_em: null, concluido_em: null,
  }));
  return computeDeliveryDeadlines(mock, deliveryDate);
}

export async function createWorkflowFromWizard(
  input: WizardCreateInput,
): Promise<{ workflow: Workflow; template?: WorkflowTemplate; warning?: string }> {
  const valid = input.etapas.filter((e) => e.nome.trim());

  // 1. Template first — a failure here must never block fluxo creation.
  let template: WorkflowTemplate | undefined;
  let warning: string | undefined;
  if (input.saveAsTemplate && input.templateName.trim()) {
    try {
      template = await addWorkflowTemplate({
        nome: input.templateName.trim(),
        modo_prazo: input.modoPrazo,
        etapas: valid.map((e) => ({
          nome: e.nome, prazo_dias: e.prazo, tipo_prazo: e.tipoPrazo,
          responsavel_id: e.responsavelId, tipo: e.tipo,
        })),
      });
    } catch {
      warning = 'O fluxo será criado, mas não foi possível salvar o template.';
    }
  }

  const templateId =
    template?.id ?? (input.source.kind === 'template' ? input.source.templateId : null);

  // 2. Workflow + etapas (same semantics as the legacy modal, incl. orphan cleanup).
  const deadlines = deliveryDeadlines(input, valid);
  const memberIds = new Set(input.membros.map((m) => m.id));
  const workflow = await addWorkflow({
    cliente_id: input.clienteId,
    titulo: input.titulo,
    template_id: templateId,
    status: 'ativo',
    etapa_atual: 0,
    recorrente: input.recorrente,
    modo_prazo: input.modoPrazo,
  });
  try {
    const now = new Date().toISOString();
    for (let i = 0; i < valid.length; i++) {
      const e = valid[i];
      let dataLimite: string | null = null;
      if (input.modoPrazo === 'data_fixa') dataLimite = e.dataLimite || null;
      else if (deadlines) dataLimite = deadlines.get(i) || null;
      await addWorkflowEtapa({
        workflow_id: workflow.id!,
        ordem: i,
        nome: e.nome,
        prazo_dias: e.prazo,
        tipo_prazo: e.tipoPrazo,
        tipo: e.tipo,
        responsavel_id:
          e.responsavelId && memberIds.has(e.responsavelId) ? e.responsavelId : null,
        status: i === 0 ? 'ativo' : 'pendente',
        iniciado_em: i === 0 ? now : null,
        concluido_em: null,
        data_limite: dataLimite,
      });
    }
  } catch (err) {
    try {
      await removeWorkflow(workflow.id!); // template intentionally kept
    } catch {
      /* best effort */
    }
    throw err;
  }

  return { workflow, template, warning };
}
```

- [ ] **Step 4: Run — expect PASS** (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/wizard
git commit -m "feat(entregas): template-first wizard creation sequencing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Wizard shell + Steps 1–2 (gallery + basics)

> Task 9 must compile and pass standalone: it creates ONLY `StepTemplate` and `StepBasics`, and the
> shell must NOT import step modules that don't exist yet (steps 3–5 render `null` inline, no
> imports). Tasks 10–11 add the remaining step files and their imports.

**Files:**
- Create: `apps/crm/src/pages/entregas/wizard/NewWorkflowWizard.tsx`
- Create: `apps/crm/src/pages/entregas/wizard/steps/StepTemplate.tsx`
- Create: `apps/crm/src/pages/entregas/wizard/steps/StepBasics.tsx`
- Test: `apps/crm/src/pages/entregas/wizard/__tests__/NewWorkflowWizard.test.tsx` (create — grows across Tasks 9–11)

**Interfaces:**
- Consumes: everything from Tasks 4, 6, 7, 8; `Dialog` primitives; `captureEvent`.
- Produces (consumed by `EntregasPage` in Task 12):

```tsx
export function NewWorkflowWizard(props: {
  open: boolean;
  onClose: () => void;
  clientes: Cliente[];
  membros: Membro[];
  templates: WorkflowTemplate[];
  onCreated: () => void;
}): JSX.Element;
```

Internal `WizardState` (single `useState` object; steps receive slices + `patch`):

```ts
interface WizardState {
  step: 1 | 2 | 3 | 4 | 5;
  source: WizardSource | null;
  clienteId: string;            // Select uses strings, parse on create
  nome: string;
  nomeEdited: boolean;          // user typed → survives source switch
  recorrente: boolean;
  etapas: EtapaFormData[];
  modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega';
  modoEdited: boolean;          // user picked a mode manually
  mesEntrega: string;
  saveAsTemplate: boolean;
  templateName: string;
}
```

- [ ] **Step 1: Write failing tests (shell + step 1 + close paths)**

Mock pattern copied from `WorkflowModals.test.tsx` (sonner + `../../../../store` + shadcn primitives are mocked the same way; `Select` mock renders a native `<select>`). Key cases:

```tsx
describe('NewWorkflowWizard — step 1', () => {
  it('renders the six presets, saved templates and começar do zero', () => {
    renderWizard(); // helper: renders with clientes/membros/templates fixtures
    expect(screen.getByText('Posts mensais')).toBeTruthy();
    expect(screen.getByText('Aprovação dupla (texto + arte)')).toBeTruthy();
    expect(screen.getByText('Começar do zero')).toBeTruthy();
    expect(screen.getByText('Fluxo Padrão de Post')).toBeTruthy(); // template fixture
  });

  it('selecting a preset advances to step 2 with prefilled name/recorrente', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Posts mensais'));
    expect(screen.getByText('O básico')).toBeTruthy();
    const nome = screen.getByLabelText(/nome do fluxo/i) as HTMLInputElement;
    expect(nome.value).toMatch(/^Posts mensais — /);
  });

  it('account-template selection does NOT set recorrente', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Fluxo Padrão de Post'));
    const toggle = screen.getByRole('switch', { name: /recorrente/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('switching source resets etapas but preserves a user-edited nome', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Posts mensais'));
    fireEvent.change(screen.getByLabelText(/nome do fluxo/i), { target: { value: 'Meu nome' } });
    fireEvent.click(screen.getByText('← Voltar'));
    fireEvent.click(screen.getByText('Post avulso rápido'));
    expect((screen.getByLabelText(/nome do fluxo/i) as HTMLInputElement).value).toBe('Meu nome');
  });

  it('Cancelar with progress asks for confirmation; onClose fires only after confirm', () => {
    const onClose = vi.fn();
    renderWizard({ onClose });
    fireEvent.click(screen.getByText('Posts mensais')); // dirty now
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Fechar mesmo assim'));
    expect(onClose).toHaveBeenCalled();
  });

  it('clean wizard closes without confirmation', () => {
    const onClose = vi.fn();
    renderWizard({ onClose });
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('step 2 blocks Continuar until cliente and nome are set', () => {
    renderWizard();
    fireEvent.click(screen.getByText('Começar do zero'));
    expect((screen.getByText('Continuar →') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/nome do fluxo/i), { target: { value: 'Meu fluxo' } });
    expect((screen.getByText('Continuar →') as HTMLButtonElement).disabled).toBe(false);
  });
});
```

Use the **real** `Dialog` from `@/components/ui/dialog` in these tests (do not mock it) so the close-path tests exercise Task 3's guard.

- [ ] **Step 2: Run — expect FAIL** (module missing).

- [ ] **Step 3: Implement**

`NewWorkflowWizard.tsx` — shell responsibilities:

```tsx
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Cliente, Membro, WorkflowTemplate } from '../../../store';
import { captureEvent } from '@/lib/analytics';
import type { EtapaFormData } from '../components/SortableEtapaList';
import { STANDARD_PRESETS, type WorkflowPreset } from './presets';
import { etapasFromPreset, etapasFromTemplate, suggestName, validateEtapas } from './wizardLogic';
import { type WizardSource } from './createWorkflow';
import { StepTemplate } from './steps/StepTemplate';
import { StepBasics } from './steps/StepBasics';
// Steps 3–5 imports arrive with their files in Tasks 10–11 — never import a missing module.
```

Core mechanics (write exactly):

- `const [s, setS] = useState<WizardState>(INITIAL)`; `patch = (p: Partial<WizardState>) => setS(prev => ({ ...prev, ...p }))`; `INITIAL = { step: 1, source: null, clienteId: '', nome: '', nomeEdited: false, recorrente: false, etapas: [], modoPrazo: 'padrao', modoEdited: false, mesEntrega: '', saveAsTemplate: false, templateName: '' }`.
- `isDirty = s.source !== null || s.clienteId !== '' || s.nome !== ''`.
- `requestClose()` = reset state to `INITIAL` + `onClose()`. Wire: `<Dialog open={open} onOpenChange={(o) => { if (!o && !isDirty) requestClose(); }}>` and `<DialogContent confirmClose={isDirty} onConfirmClose={requestClose} style={{ maxWidth: 760, width: 'calc(100vw - 2rem)' }}>`. The Cancelar button calls `requestClose()` directly when clean, or triggers the same confirm flow when dirty — implement by rendering Cancelar as `onClick={() => { if (isDirty) setCancelConfirm(true); else requestClose(); }}` reusing an `AlertDialog` identical in copy to dialog.tsx's ("Fechar sem salvar?" / "Fechar mesmo assim") so the test strings match.
- Source selection handler:

```tsx
const selectSource = (source: WizardSource, preset?: WorkflowPreset, tpl?: WorkflowTemplate) => {
  const etapas = preset ? etapasFromPreset(preset) : tpl ? etapasFromTemplate(tpl) : [];
  const sourceNome = preset?.nome ?? tpl?.nome ?? '';
  patch({
    source,
    etapas,
    modoPrazo: preset?.modo_prazo ?? (tpl?.modo_prazo as WizardState['modoPrazo']) ?? 'padrao',
    modoEdited: false,
    recorrente: preset ? preset.recorrente : s.recorrente,
    nome: s.nomeEdited ? s.nome : sourceNome ? suggestName(sourceNome) : '',
    step: 2,
  });
};
```

- Header: `<DialogTitle>Novo Fluxo{s.source && s.source.kind !== 'zero' ? ` · ${'presetNome' in s.source ? s.source.presetNome : s.source.templateNome}` : ''}</DialogTitle>` plus 5 progress dots (span elements, `background: i < s.step ? '#eab308' : 'var(--border-color)'`).
- Step body: `{s.step === 1 && <StepTemplate ... />}`, `{s.step === 2 && <StepBasics state={s} patch={patch} clientes={clientes} />}`; steps 3–5 render `null` inline (no imports) **until Tasks 10–11 replace them in the same PR**. Footer (steps 2–5): `← Voltar` (`patch({ step: (s.step - 1) as WizardState['step'] })`) and `Continuar →` (`✓ Criar Fluxo` on step 5). Step-2 gating: `Continuar` disabled while `!s.clienteId || !s.nome.trim()`.
- `StepBasics.tsx` (created HERE, in Task 9): Cliente `Select` (active clients, pt-BR sort — copy the `activeClientes` filter/sort from the legacy modal), Nome `Input` labelled `Nome do fluxo` with `onChange={(e) => patch({ nome: e.target.value, nomeEdited: true })}` and hint `Sugerido a partir do modelo e do próximo mês. Pode editar.`, recorrente as a `role="switch"` button (`aria-checked={state.recorrente}`, toggles `patch({ recorrente: !state.recorrente })`) with helper text `Ao concluir todas as etapas, o Mesaas oferece criar o próximo ciclo automaticamente.`

`StepTemplate.tsx`:

```tsx
import type { Cliente, Membro, WorkflowTemplate } from '../../../../store';
import { STANDARD_PRESETS, presetDurationDays, type WorkflowPreset } from '../presets';

export function StepTemplate({ templates, onSelectPreset, onSelectTemplate, onSelectZero }: {
  templates: WorkflowTemplate[];
  onSelectPreset: (p: WorkflowPreset) => void;
  onSelectTemplate: (t: WorkflowTemplate) => void;
  onSelectZero: () => void;
}) {
  return (
    <div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--surface-2, #f8fafc)', borderRadius: 8, padding: '0.5rem 0.75rem', marginBottom: '1rem' }}>
        💡 Um <b>fluxo</b> é um ciclo de trabalho para um cliente (ex.: posts de agosto). Um{' '}
        <b>template</b> é a receita reutilizável de etapas.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
        {STANDARD_PRESETS.map((p) => {
          const approvals = p.etapas.filter((e) => e.tipo === 'aprovacao_cliente').length;
          const Icon = p.icon;
          return (
            <button key={p.id} type="button" onClick={() => onSelectPreset(p)}
              style={{ textAlign: 'left', border: '1px solid var(--border-color)', borderRadius: 12, padding: '0.9rem', background: 'transparent', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Icon className="h-5 w-5" />
                {p.recorrente && <span className="badge-warning" style={{ fontSize: '0.6rem' }}>Recorrente</span>}
              </div>
              <h4 style={{ margin: '0.4rem 0 0.2rem' }}>{p.nome}</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, margin: '0.4rem 0' }}>
                {p.etapas.map((e) => (
                  <span key={e.nome} style={{ fontSize: '0.62rem', borderRadius: 4, padding: '1px 6px',
                    background: e.tipo === 'aprovacao_cliente' ? '#eff6ff' : 'var(--surface-2, #f1f5f9)',
                    color: e.tipo === 'aprovacao_cliente' ? '#1d4ed8' : 'var(--text-muted)',
                    fontWeight: e.tipo === 'aprovacao_cliente' ? 600 : 400 }}>
                    {e.nome}
                  </span>
                ))}
              </div>
              <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: 0 }}>
                {p.etapas.length} etapas · ~{presetDurationDays(p)} dias
                {approvals > 0 && (
                  <span style={{ marginLeft: 6, color: '#1d4ed8', fontWeight: 600 }}>
                    {approvals > 1 ? `${approvals} aprovações externas` : 'Aprovação externa'}
                  </span>
                )}
              </p>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: '1rem' }}>
        <h5 style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Seus templates</h5>
        {templates.map((t) => (
          <button key={t.id} type="button" onClick={() => onSelectTemplate(t)}
            style={{ display: 'flex', width: '100%', justifyContent: 'space-between', border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.5rem 0.75rem', marginBottom: 6, background: 'transparent', cursor: 'pointer' }}>
            <span>📋 {t.nome}</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t.etapas.length} etapas</span>
          </button>
        ))}
        <button type="button" onClick={onSelectZero}
          style={{ width: '100%', border: '1px dashed var(--border-color)', borderRadius: 12, padding: '0.9rem', textAlign: 'center', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer' }}>
          ＋ Começar do zero
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — step-1 + close-path tests PASS** (steps 3–5 tests come later).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/wizard
git commit -m "feat(entregas): wizard shell + template gallery step

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Step 3 (etapas: chips + bulk assign + inline validation)

**Files:**
- Create: `apps/crm/src/pages/entregas/wizard/steps/StepEtapas.tsx`
- Modify: `apps/crm/src/pages/entregas/wizard/NewWorkflowWizard.tsx` (import StepEtapas, render + gate step 3)
- Test: extend `NewWorkflowWizard.test.tsx`

**Interfaces:**
- Consumes: `SUGGESTED_ETAPAS`, `validateEtapas` (Task 7); `SortableEtapaList`, `defaultEtapa` (Task 4); `PrerequisiteAlert` (`@/components/help/PrerequisiteAlert`).
- Produces: `StepBasics({ state, patch, clientes })`, `StepEtapas({ state, patch, membros })` — both receive `state: WizardState` and `patch: (p: Partial<WizardState>) => void`.

- [ ] **Step 1: Write failing tests**

```tsx
describe('NewWorkflowWizard — step 3', () => {
  it('chips add and remove etapas by suggestionId even after rename', () => {
    renderWizardAtStep3(); // helper: preset posts-mensais + cliente/nome filled + 2x Continuar
    // 'Criação' came from the preset bound to suggestionId 'criacao' → chip pressed
    const chip = screen.getByRole('button', { name: /^✓ Criação$/ });
    // rename the row, then toggle the chip off — the renamed row disappears
    const nameInputs = screen.getAllByPlaceholderText('Nome da etapa');
    fireEvent.change(nameInputs[0], { target: { value: 'Criação renomeada' } });
    fireEvent.click(chip);
    expect(screen.queryByDisplayValue('Criação renomeada')).toBeNull();
  });

  it('bulk assign sets responsável on every etapa', () => {
    renderWizardAtStep3();
    fireEvent.change(screen.getByLabelText(/atribuir todas a/i), { target: { value: '7' } });
    const rowSelects = screen.getAllByDisplayValue('Maria');
    expect(rowSelects.length).toBeGreaterThanOrEqual(5);
  });

  it('stale template responsável blocks with inline row error', () => {
    renderWizardAtStep3ViaTemplate(); // template fixture has responsavel_id 999
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByText(/não existe mais/i)).toBeTruthy();
    expect(screen.queryByText('Prazos')).toBeNull(); // did not advance
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

`StepEtapas.tsx`:

```tsx
import { PrerequisiteAlert } from '@/components/help/PrerequisiteAlert';
import type { Membro } from '../../../../store';
import { SortableEtapaList, defaultEtapa } from '../../components/SortableEtapaList';
import { SUGGESTED_ETAPAS, validateEtapas } from '../wizardLogic';

export function StepEtapas({ state, patch, membros, rowErrors }: { /* WizardState slice */ }) {
  const active = new Set(state.etapas.map((e) => e.suggestionId).filter(Boolean));
  const toggleChip = (sug: (typeof SUGGESTED_ETAPAS)[number]) => {
    if (active.has(sug.suggestionId)) {
      patch({ etapas: state.etapas.filter((e) => e.suggestionId !== sug.suggestionId) });
    } else {
      patch({
        etapas: [...state.etapas, defaultEtapa({
          nome: sug.nome, prazo: sug.prazo, tipoPrazo: sug.tipoPrazo,
          tipo: sug.tipo, suggestionId: sug.suggestionId,
        })],
      });
    }
  };
  const bulkAssign = (id: number | null) =>
    patch({ etapas: state.etapas.map((e) => ({ ...e, responsavelId: id })) });
  // render: chips row (aria-pressed, approval chip in blue), PrerequisiteAlert when membros.length === 0,
  // "Atribuir todas a…" labelled Select, then <SortableEtapaList rowErrors={rowErrors} …/>,
  // and a "＋ Personalizada" button → patch({ etapas: [...state.etapas, defaultEtapa()] })
}
```

Chips render as pill buttons: pressed = `✓ ${nome}` with yellow bg (`#eab308`, dark text), the approval chip pressed style uses `#1d4ed8`/white; unpressed = outline. Wizard step-3 gating in `NewWorkflowWizard`: on `Continuar`, run `validateEtapas(s.etapas, membros)`; if `globalError` or `rowErrors.size > 0`, store `rowErrors` in local state (passed down) and do not advance; else advance and clear.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/wizard
git commit -m "feat(entregas): wizard etapas step (chips, bulk assign, inline validation)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Steps 4 & 5 (prazos, review + save-as-template + creation)

**Files:**
- Create: `apps/crm/src/pages/entregas/wizard/steps/StepPrazos.tsx`
- Create: `apps/crm/src/pages/entregas/wizard/steps/StepReview.tsx`
- Modify: `apps/crm/src/pages/entregas/wizard/NewWorkflowWizard.tsx` (render + gate steps 4–5, creation handler, analytics)
- Test: extend `NewWorkflowWizard.test.tsx`

**Interfaces:**
- Consumes: `dataEntregaAvailability`, `countApprovals` (Task 7); `createWorkflowFromWizard` (Task 8); `getNextDeliveryDate` (`../hooks/useEntregasData`); `captureEvent` (Task 5).
- Produces: on success calls `captureEvent('workflow_wizard_source', { source })`, `captureEvent('workflow_saved_as_template')` when applicable, then `onCreated()` + `requestClose()`.

- [ ] **Step 1: Write failing tests**

```tsx
describe('NewWorkflowWizard — steps 4 & 5', () => {
  it('disables data_entrega and auto-falls back when client lacks dia_entrega', () => {
    renderWizardAtStep4({ clienteSemDiaEntrega: true }); // preset posts-mensais prefers data_entrega
    expect(screen.getByText(/modo ajustado para duração por etapa/i)).toBeTruthy();
    const radio = screen.getByRole('radio', { name: /data de entrega do cliente/i });
    expect((radio as HTMLInputElement).disabled).toBe(true);
  });

  it('warns about the first-approval anchor with 2+ approvals', () => {
    renderWizardAtStep4ViaDupla({ clienteComDiaEntrega: true });
    fireEvent.click(screen.getByRole('radio', { name: /data de entrega do cliente/i }));
    expect(screen.getByText(/a primeira .* âncora/i)).toBeTruthy();
  });

  it('data_fixa without all datas limite blocks Continuar with the inline error', () => {
    renderWizardAtStep4(); // preset source, no dataLimite values set
    fireEvent.click(screen.getByRole('radio', { name: /datas fixas/i }));
    fireEvent.click(screen.getByText('Continuar →'));
    expect(screen.getByText(/data limite para todas as etapas/i)).toBeTruthy();
    expect(screen.queryByText(/revisar/i)).toBeNull(); // did not advance
  });

  it('month select offers próximo disponível + current month + 5 more', () => {
    renderWizardAtStep4({ clienteComDiaEntrega: true });
    fireEvent.click(screen.getByRole('radio', { name: /data de entrega do cliente/i }));
    const select = screen.getByLabelText(/mês de entrega/i) as HTMLSelectElement;
    expect(select.options).toHaveLength(7); // '__auto__' sentinel + 6 months
    expect(select.options[0].textContent).toMatch(/próximo mês disponível/i);
    const now = new Date();
    const currentLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    expect(select.options[1].textContent!.toLowerCase()).toBe(currentLabel.toLowerCase());
  });

  it('client switch re-applies the source mode preference when not manually overridden', () => {
    // posts-mensais prefers data_entrega; first client lacks dia_entrega → auto-fallback padrao
    renderWizardAtStep4({ clienteSemDiaEntrega: true });
    expect(screen.getByText(/modo ajustado para duração por etapa/i)).toBeTruthy();
    fireEvent.click(screen.getByText('← Voltar')); // step 3
    fireEvent.click(screen.getByText('← Voltar')); // step 2
    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: '2' } }); // has dia_entrega
    fireEvent.click(screen.getByText('Continuar →'));
    fireEvent.click(screen.getByText('Continuar →')); // back to step 4
    const radio = screen.getByRole('radio', { name: /data de entrega do cliente/i });
    expect((radio as HTMLInputElement).checked).toBe(true);
  });

  it('review summary + create calls sequencing and analytics, then closes', async () => {
    const onCreated = vi.fn();
    renderWizardThroughReview({ onCreated }); // fills everything, checks save-as-template
    fireEvent.click(screen.getByText('✓ Criar Fluxo'));
    await waitFor(() => expect(createWorkflowFromWizardMock).toHaveBeenCalled());
    expect(captureEventMock).toHaveBeenCalledWith('workflow_wizard_source', { source: 'posts-mensais' });
    expect(captureEventMock).toHaveBeenCalledWith('workflow_saved_as_template');
    expect(onCreated).toHaveBeenCalled();
  });

  it('surfaces the template warning as a separate toast', async () => {
    createWorkflowFromWizardMock.mockResolvedValue({
      workflow: { id: 1 }, warning: 'O fluxo será criado, mas não foi possível salvar o template.',
    });
    renderWizardThroughReview({});
    fireEvent.click(screen.getByText('✓ Criar Fluxo'));
    await waitFor(() =>
      expect(toastWarningMock ?? toastErrorMock).toHaveBeenCalledWith(
        expect.stringMatching(/não foi possível salvar o template/i),
      ),
    );
  });
});
```

(`createWorkflowFromWizard` is mocked at module level in this test file: `vi.mock('../createWorkflow', ...)`.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

`StepPrazos.tsx` — three radio cards (native `<input type="radio">` + styled label): copy for each exactly:
- `Duração por etapa` / `Cada etapa tem um prazo em dias, contado a partir do momento em que ela começa.`
- `Datas fixas` / `Você define uma data limite manual para cada etapa.` — when selected, `SortableEtapaList` in step 3 already handles per-etapa dates via `modoPrazo`; here render the etapa date inputs inline by re-rendering `SortableEtapaList` with `modoPrazo="data_fixa"` (pass state through).
- `Data de entrega do cliente` / `Prazos calculados de trás pra frente a partir do dia de entrega do cliente (dia {cliente.dia_entrega}), usando a etapa de aprovação como âncora.`

Behavior:

```tsx
const availability = dataEntregaAvailability(state.etapas, cliente);
const approvals = countApprovals(state.etapas);
// Recomendado badge on data_entrega when availability.enabled && approvals >= 1
// disabled radio + inline reason (+ <Link to={`/clientes/${cliente?.id}`}>Configurar dia de entrega</Link>
//   when the reason is the missing dia_entrega) when !availability.enabled
// auto-fallback: in NewWorkflowWizard, when entering step 4 (or when cliente changes):
//   if (!state.modoEdited && state.modoPrazo === 'data_entrega' && !availability.enabled)
//     patch({ modoPrazo: 'padrao' }) and render the notice
//     "Modo ajustado para Duração por etapa — o cliente não tem dia de entrega configurado."
// manual selection sets modoEdited: true; if a manual data_entrega selection becomes invalid after a
//   client switch, keep it selected-but-disabled and block Continuar with the availability.reason.
{approvals >= 2 && state.modoPrazo === 'data_entrega' && (
  <p style={{ color: 'var(--warning)', fontSize: '0.75rem' }}>
    ⚠ Este fluxo tem {approvals} etapas de aprovação — a primeira será a âncora da data de entrega.
  </p>
)}
```

Mês de Entrega (only for `data_entrega`): copy the exact option-building block from the legacy modal (`__auto__` = `Próximo mês disponível`, then 6 entries starting at the **current** month, `pt-BR` long labels capitalized). The sentinel mapping is explicit — wizard state stores `''` for auto, never `'__auto__'`:

```tsx
<Select
  value={state.mesEntrega || '__auto__'}
  onValueChange={(val) => patch({ mesEntrega: val === '__auto__' ? '' : val })}
>
```

Step-4 gating in `NewWorkflowWizard`: `Continuar` runs `validatePrazos(s.etapas, s.modoPrazo)` (Task 7) and, when `s.modoPrazo === 'data_entrega'`, `dataEntregaAvailability(s.etapas, cliente)`; a non-null message renders inline (`role="alert"`) and blocks advancing. `data_fixa` selection re-renders the etapa list with per-etapa date inputs (`SortableEtapaList` with `modoPrazo="data_fixa"` — same mechanism the legacy modal used).

`StepReview.tsx` — summary rows (Cliente, Nome, `Etapas: N (M aprovações do cliente)` when M>0, Prazos: mode label + resolved delivery date when data_entrega, Recorrente: Sim/Não), then the save block:

```tsx
<label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 10, padding: '0.7rem 0.9rem' }}>
  <input type="checkbox" checked={state.saveAsTemplate}
    onChange={(e) => patch({ saveAsTemplate: e.target.checked, templateName: state.templateName || defaultTemplateName })} />
  <span>
    <b>Salvar estas etapas como template</b>
    <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
      A receita fica disponível no passo 1 para os próximos fluxos.
    </span>
  </span>
</label>
{state.saveAsTemplate && (
  <Input value={state.templateName} onChange={(e) => patch({ templateName: e.target.value })} />
)}
```

`defaultTemplateName` = source preset → `${presetNome} — ${cliente?.nome ?? ''}`.trim(); template source → template nome; zero → `state.nome`.

Creation handler in `NewWorkflowWizard`:

```tsx
const handleCreate = async () => {
  setSaving(true);
  try {
    const result = await createWorkflowFromWizard({
      clienteId: Number(s.clienteId), titulo: s.nome, recorrente: s.recorrente,
      modoPrazo: s.modoPrazo, mesEntrega: s.mesEntrega, etapas: s.etapas,
      source: s.source ?? { kind: 'zero' },
      saveAsTemplate: s.saveAsTemplate, templateName: s.templateName,
      cliente: clientes.find((c) => c.id === Number(s.clienteId)), membros,
    });
    toast.success('Fluxo criado com sucesso!');
    if (result.warning) toast.warning(result.warning);
    captureEvent('workflow_wizard_source', {
      source: s.source?.kind === 'preset' ? s.source.presetId : (s.source?.kind ?? 'zero'),
    });
    if (result.template) captureEvent('workflow_saved_as_template');
    onCreated();
    requestClose();
  } catch (err: unknown) {
    toast.error((err as Error).message || 'Erro ao criar fluxo');
  } finally {
    setSaving(false);
  }
};
```

(`workflow_wizard_source` value: preset id for presets, the literal string `template` or `zero` otherwise — matches the spec.)

- [ ] **Step 4: Run the whole wizard test file — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/wizard
git commit -m "feat(entregas): wizard prazos + review steps with save-as-template

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Swap wizard into EntregasPage, delete NewWorkflowModal, PR A verification

**Files:**
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (~lines 9–14 imports, ~line 296 render)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` (delete `NewWorkflowModal` and its now-unused imports)
- Modify: `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx` (~line 136: replace the `NewWorkflowModal` mock)
- Modify: `apps/crm/src/pages/entregas/components/__tests__/WorkflowModals.test.tsx` (delete `NewWorkflowModal` describe blocks; keep TemplatesModal/dialog coverage)

**Interfaces:**
- Consumes: `NewWorkflowWizard` (Task 9).
- Produces: `NewWorkflowModal` no longer exists anywhere in the codebase.

- [ ] **Step 1: Swap the component**

In `EntregasPage.tsx`: remove `NewWorkflowModal` from the `./components/WorkflowModals` import, add `import { NewWorkflowWizard } from './wizard/NewWorkflowWizard';`, and replace the `{newWorkflowOpen && <NewWorkflowModal .../>}` block with:

```tsx
{newWorkflowOpen && (
  <NewWorkflowWizard
    open={newWorkflowOpen}
    onClose={() => setNewWorkflowOpen(false)}
    clientes={clientes}
    membros={membros}
    templates={templates}
    onCreated={() => {
      captureEvent('workflow_created');
      refresh();
    }}
  />
)}
```

- [ ] **Step 2: Delete `NewWorkflowModal`** from `WorkflowModals.tsx` (the whole component, ~lines 329–660 in the pre-Task-4 numbering) and prune imports that only it used (`getNextDeliveryDate`, `computeDeliveryDeadlines`, `addWorkflow`, `addWorkflowEtapa`, `EmptyStateGuide`/`PrerequisiteAlert` if now unused, etc.). `grep -rn "NewWorkflowModal" apps/` must return only test files you're about to fix.

- [ ] **Step 3: Update tests**

- `EntregasPage.test.tsx`: the module mock of `./components/WorkflowModals` drops its `NewWorkflowModal` entry; add `vi.mock('../wizard/NewWorkflowWizard', () => ({ NewWorkflowWizard: (p) => (p.open ? <div>WizardMock</div> : null) }))` and update the assertion in the "opens the main modals" test to look for `WizardMock`.
- `WorkflowModals.test.tsx`: delete `NewWorkflowModal` describes (its behaviors now live in the wizard test file).

- [ ] **Step 4: Full PR A verification**

```bash
npm run format && npm run lint && npm run test && npm run build
```

Expected: all green. Fix anything that isn't before committing.

- [ ] **Step 5: Commit**

```bash
git add -A apps/crm
git commit -m "feat(entregas): replace NewWorkflowModal with the creation wizard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

PR A is now shippable: open it with `gh pr create` (base `main`), body summarizing spec §Slice A + re-arm, linking the spec file.

---

# PR B — Example board + guided tour

### Task 13: data-tour anchors + ExampleBoard

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCard.tsx` (root div ~line 126; deadline pill element; posts badge element ~line 730)
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx` (column header ~line 468; empty state ~line 438; new props)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` ("Novo Fluxo" button ~line 203; pass new KanbanView props)
- Create: `apps/crm/src/pages/entregas/components/ExampleBoard.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/ExampleBoard.test.tsx`

**Interfaces:**
- Produces:
  - `data-tour` attributes: `wf-card` (card root), `wf-deadline` (deadline pill), `wf-posts` (posts badge), `wf-col-aprovacao` (approval column header), `novo-fluxo-btn` (header button) — on real components AND ExampleBoard.
  - `ExampleBoard({ onDismiss }: { onDismiss: () => void })`.
  - `KanbanView` new optional props: `showExample?: boolean; onDismissExample?: () => void;`

- [ ] **Step 1: Write failing test**

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExampleBoard } from '../ExampleBoard';

describe('ExampleBoard', () => {
  it('renders the example card, approval column and tour anchors', () => {
    const { container } = render(<ExampleBoard onDismiss={() => {}} />);
    expect(screen.getByText('Posts de Agosto')).toBeTruthy();
    expect(screen.getByText('Exemplo')).toBeTruthy();
    expect(container.querySelector('[data-tour="wf-card"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="wf-deadline"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="wf-posts"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="wf-col-aprovacao"]')).toBeTruthy();
  });

  it('dismiss control fires onDismiss', () => {
    const onDismiss = vi.fn();
    render(<ExampleBoard onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Ocultar exemplo'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

`ExampleBoard.tsx` — static markup reusing board CSS classes; columns `Criação` (holds the card), `Revisão interna`, `Aprovação do cliente` (header gets `data-tour="wf-col-aprovacao"`), `Ajustes`; card:

```tsx
export function ExampleBoard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="animate-up" style={{ position: 'relative' }}>
      <div className="board-container">
        {['Criação', 'Revisão interna', 'Aprovação do cliente', 'Ajustes'].map((col) => (
          <div key={col} className="board-column">
            <div
              className="board-column-header"
              {...(col === 'Aprovação do cliente' ? { 'data-tour': 'wf-col-aprovacao' } : {})}
            >
              <span className="board-column-title">{col}</span>
              <span className="board-column-count">{col === 'Criação' ? 1 : 0}</span>
            </div>
            <div className="board-column-body" style={{ minHeight: 60 }}>
              {col === 'Criação' ? (
                <div className="board-card deadline-ok" data-tour="wf-card"
                  style={{ position: 'relative', padding: '0.9rem', borderLeft: '3px solid #3ecf8e', borderRadius: 10 }}>
                  <span style={{ position: 'absolute', top: -8, right: 8, background: '#eab308', color: '#12151a', fontSize: '0.58rem', fontWeight: 800, borderRadius: 4, padding: '1px 7px', textTransform: 'uppercase' }}>
                    Exemplo
                  </span>
                  <div className="board-card-title" style={{ fontWeight: 600 }}>Posts de Agosto</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 6 }}>Cliente Exemplo</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <span data-tour="wf-deadline" className="badge-success" style={{ fontSize: '0.62rem' }}>3d restantes</span>
                    <span data-tour="wf-posts" className="badge-neutral" style={{ fontSize: '0.62rem' }}>📄 4 posts</span>
                    <span className="badge-neutral" style={{ fontSize: '0.62rem' }}>👤 Maria</span>
                  </div>
                </div>
              ) : (
                <div className="board-empty">Nenhuma entrega</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={onDismiss}
        style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
        Ocultar exemplo
      </button>
    </div>
  );
}
```

Real-component anchors:
- `WorkflowCard.tsx` root div: add `data-tour="wf-card"`. The deadline pill (the element rendering `deadlineText`) gets `data-tour="wf-deadline"`; the posts count container (around the `FileText` icon, ~line 730) gets `data-tour="wf-posts"`.
- `KanbanView.tsx` column header: compute once above the return —
  `const approvalStepNames = useMemo(() => new Set(cards.flatMap((c) => c.allEtapas.filter((e) => e.tipo === 'aprovacao_cliente').map((e) => e.nome))), [cards]);`
  and on the header div: `{...(approvalStepNames.has(stepName) ? { 'data-tour': 'wf-col-aprovacao' } : {})}`.
- Empty state: add props `showExample?: boolean; onDismissExample?: () => void;` — when the board would render the "Nenhuma entrega encontrada" block AND `showExample`, render `<ExampleBoard onDismiss={onDismissExample!} />` instead.
- `EntregasPage.tsx`: `data-tour="novo-fluxo-btn"` on the "Novo Fluxo" `Button`.

- [ ] **Step 4: Run — expect PASS.** Also run `npx vitest run apps/crm/src/pages/entregas` to catch prop regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas
git commit -m "feat(entregas): ExampleBoard + data-tour anchors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: driver.js tour module

**Files:**
- Modify: `package.json` (add dependency)
- Create: `apps/crm/src/pages/entregas/tour/entregasTour.ts`
- Create: `apps/crm/src/pages/entregas/tour/tour.css`
- Test: `apps/crm/src/pages/entregas/tour/__tests__/entregasTour.test.ts`

**Interfaces:**
- Produces:

```ts
export const TOUR_STEP_DEFS: { selector: string; title: string; description: string }[]; // 6 entries
export function buildTourSteps(root?: ParentNode): DriveStep[];  // filters by selector presence
export function startEntregasTour(opts: {
  onComplete: () => void;
  onDismiss: (stepIndex: number) => void;
}): void;
export const tourStorageKey = (contaId: string) => `entregas_tour_done_${contaId}`;
```

- [ ] **Step 1: Install driver.js (exact pinned version)**

Pin **1.7.0** (published 2026-07-13 — ≥24h old so Deno CI min-dep-age doesn't trip, and ≥1.6.0
which introduced the `onDoneClick` hook we need to distinguish completion from dismissal; 1.8.0 is
only days old — skip it):

```bash
npm install --save-exact driver.js@1.7.0
```

Verify `package.json` shows `"driver.js": "1.7.0"` (no caret).

- [ ] **Step 2: Write failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { TOUR_STEP_DEFS, buildTourSteps, tourStorageKey } from '../entregasTour';

describe('entregas tour', () => {
  it('defines 6 steps with the expected selectors', () => {
    expect(TOUR_STEP_DEFS).toHaveLength(6);
    expect(TOUR_STEP_DEFS.map((s) => s.selector)).toEqual([
      '[data-tour="wf-card"]',
      '[data-tour="wf-deadline"]',
      '[data-tour="wf-posts"]',
      '[data-tour="wf-card"]',
      '[data-tour="wf-col-aprovacao"]',
      '[data-tour="novo-fluxo-btn"]',
    ]);
  });

  it('omits steps whose selector is absent from the DOM', () => {
    document.body.innerHTML = `
      <div data-tour="wf-card"></div>
      <button data-tour="novo-fluxo-btn"></button>
    `;
    const steps = buildTourSteps(document);
    // wf-card appears twice in defs → both survive; deadline/posts/aprovacao dropped
    expect(steps).toHaveLength(3);
  });

  it('storage key is per conta', () => {
    expect(tourStorageKey('abc')).toBe('entregas_tour_done_abc');
  });
});
```

Plus completion/dismissal separation with a mocked driver (module mock ABOVE the imports):

```ts
const driverInstance = vi.hoisted(() => ({
  drive: vi.fn(),
  destroy: vi.fn(),
  getActiveIndex: vi.fn(() => 2),
}));
const capturedConfig = vi.hoisted(() => ({ current: null as any }));
vi.mock('driver.js', () => ({
  driver: vi.fn((cfg) => {
    capturedConfig.current = cfg;
    return driverInstance;
  }),
}));

import { startEntregasTour } from '../entregasTour';

describe('startEntregasTour completion vs dismissal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div data-tour="wf-card"></div>';
  });

  it('done button → onComplete', () => {
    const onComplete = vi.fn(); const onDismiss = vi.fn();
    startEntregasTour({ onComplete, onDismiss });
    capturedConfig.current.onDoneClick();
    capturedConfig.current.onDestroyStarted();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('early exit → onDismiss with the active step index', () => {
    const onComplete = vi.fn(); const onDismiss = vi.fn();
    startEntregasTour({ onComplete, onDismiss });
    capturedConfig.current.onDestroyStarted();
    expect(onDismiss).toHaveBeenCalledWith(2);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('closing on the FINAL step without the done button is still a dismissal', () => {
    driverInstance.getActiveIndex.mockReturnValue(5);
    const onComplete = vi.fn(); const onDismiss = vi.fn();
    startEntregasTour({ onComplete, onDismiss });
    capturedConfig.current.onDestroyStarted();
    expect(onDismiss).toHaveBeenCalledWith(5);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**, then implement `entregasTour.ts`:

```ts
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour.css';

export const TOUR_STEP_DEFS = [
  { selector: '[data-tour="wf-card"]', title: 'Card de fluxo',
    description: 'Isto é um card de fluxo: um ciclo de trabalho de um cliente. Ele avança pelas colunas (etapas) até a entrega.' },
  { selector: '[data-tour="wf-deadline"]', title: 'Prazo e etapa',
    description: 'Aqui você acompanha o prazo da etapa atual — verde em dia, amarelo urgente, vermelho atrasado.' },
  { selector: '[data-tour="wf-posts"]', title: 'Posts vivem no card',
    description: 'Os posts ficam dentro do card. Clique no card para abrir o painel e criar posts.' },
  { selector: '[data-tour="wf-card"]', title: 'Arraste para avançar',
    description: 'Arraste o card para a próxima coluna para avançar a etapa.' },
  { selector: '[data-tour="wf-col-aprovacao"]', title: 'Aprovação do cliente',
    description: 'Quando o card chega nesta coluna, os posts podem ser enviados ao portal do cliente para aprovação — sem login.' },
  { selector: '[data-tour="novo-fluxo-btn"]', title: 'Crie seu primeiro fluxo',
    description: 'Clique em Novo Fluxo para começar — há modelos prontos para escolher.' },
];

export const tourStorageKey = (contaId: string) => `entregas_tour_done_${contaId}`;

export function buildTourSteps(root: ParentNode = document): DriveStep[] {
  return TOUR_STEP_DEFS.filter((s) => root.querySelector(s.selector)).map((s) => ({
    element: s.selector,
    popover: { title: s.title, description: s.description },
  }));
}

export function startEntregasTour(opts: {
  onComplete: () => void;
  onDismiss: (stepIndex: number) => void;
}): void {
  const steps = buildTourSteps();
  if (steps.length === 0) return;
  // Completion = the user clicked "Concluir" on the last step. Any other exit (X, overlay,
  // Escape) is a dismissal — even on the last step. hasNextStep() alone cannot tell these
  // apart, hence the explicit flag set by onDoneClick (driver.js ≥1.6).
  let completed = false;
  const d = driver({
    steps,
    showProgress: true,
    progressText: '{{current}} de {{total}}',
    nextBtnText: 'Próximo →',
    prevBtnText: '← Voltar',
    doneBtnText: 'Concluir',
    onDoneClick: () => {
      completed = true;
      d.destroy();
    },
    onDestroyStarted: () => {
      if (completed) opts.onComplete();
      else opts.onDismiss(d.getActiveIndex() ?? 0);
      d.destroy();
    },
  });
  d.drive();
}
```

`tour.css` — theme driver.js with the design system (dark popover, yellow accents):

```css
.driver-popover {
  background: #12151a;
  color: #e8eaf0;
  border-radius: 10px;
}
.driver-popover-title { color: #fff; font-family: var(--font-main); }
.driver-popover-description { color: #cbd5e1; font-size: 0.82rem; }
.driver-popover-progress-text { color: #eab308; font-size: 0.7rem; font-weight: 700; }
.driver-popover-next-btn, .driver-popover-done-btn {
  background: #eab308 !important;
  color: #12151a !important;
  border: none !important;
  font-weight: 700;
}
.driver-popover-arrow { border-color: #12151a; }
```

- [ ] **Step 4: Run — expect PASS** (6 tests).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json apps/crm/src/pages/entregas/tour
git commit -m "feat(entregas): driver.js tour module with runtime step filtering

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Wire the tour into EntregasPage + PR B verification

**Files:**
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (tour state, Info-icon replay, KanbanView props, analytics)
- Test: `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `startEntregasTour`, `tourStorageKey` (Task 14); `ExampleBoard` via `KanbanView` props (Task 13); `useAuth` (`@/context/AuthContext`) for `profile.conta_id`; `captureEvent` (Task 5).

- [ ] **Step 1: Update the test harness, then write the failing tests**

`EntregasPage.test.tsx` cannot exercise this feature as-is — three harness updates come first:

1. **The `KanbanView` mock (~line 49) swallows `showExample`.** Extend it to honor the new props so
   page-level assertions have something to find:

```tsx
vi.mock('../views/KanbanView', () => ({
  KanbanView: ({ cards, showExample, onDismissExample /* …existing props… */ }: any) => (
    <div>
      {showExample ? (
        <div>
          <div>Posts de Agosto</div>
          <button onClick={onDismissExample}>Ocultar exemplo</button>
        </div>
      ) : cards.length === 0 ? (
        <div>Nenhuma entrega encontrada. Ajuste os filtros ou crie um novo fluxo.</div>
      ) : (
        <div>Kanban view: {cards.map((c: any) => c.workflow.titulo).join(', ')}</div>
      )}
      {/* keep the existing interaction buttons */}
    </div>
  ),
}));
```

2. **`useAuth` has no provider in this suite** — EntregasPage now calls it for `conta_id`, which
   throws outside `AuthProvider`. Add a module mock:

```tsx
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { conta_id: 'conta-1', role: 'owner' } }),
}));
```

3. **Tour side effects**: mock the tour module and make `requestAnimationFrame` synchronous so
   `launchTour` runs inside the test tick:

```tsx
const tourMock = vi.hoisted(() => ({ startEntregasTour: vi.fn() }));
vi.mock('../tour/entregasTour', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startEntregasTour: tourMock.startEntregasTour,
}));
// in beforeEach:
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
```

(`tourStorageKey` stays real — the localStorage assertions below depend on it. Analytics is already
no-op in tests via the unconfigured PostHog key; if the suite asserts events, mock
`@/lib/analytics`'s `captureEvent` the same hoisted way.)

Then the failing tests:

```tsx
it('shows the ExampleBoard when there are no active workflows and the tour key is unset', () => {
  localStorage.clear();
  renderEntregasPage({ activeWorkflows: [], cards: [] });
  expect(screen.getByText('Posts de Agosto')).toBeTruthy(); // example card
});

it('keeps the plain empty message when filters empty the board but workflows exist', () => {
  renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });
  expect(screen.queryByText('Posts de Agosto')).toBeNull();
  expect(screen.getByText(/nenhuma entrega encontrada/i)).toBeTruthy();
});

it('does not show the ExampleBoard once dismissed', () => {
  localStorage.setItem('entregas_tour_done_conta-1', 'true');
  renderEntregasPage({ activeWorkflows: [], cards: [] });
  expect(screen.queryByText('Posts de Agosto')).toBeNull();
});

it('replay temporarily renders the ExampleBoard without clearing the key', async () => {
  localStorage.setItem('entregas_tour_done_conta-1', 'true');
  renderEntregasPage({ activeWorkflows: [], cards: [] });
  fireEvent.click(screen.getByText(/ver tour novamente/i));
  expect(screen.getByText('Posts de Agosto')).toBeTruthy();
  expect(localStorage.getItem('entregas_tour_done_conta-1')).toBe('true');
});
```

(`startEntregasTour` is module-mocked in this file: `vi.mock('../tour/entregasTour', ...)` — jsdom can't position driver.js; assert it was called with callbacks instead.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement in `EntregasPage.tsx`**

```tsx
const { profile } = useAuth();
const contaId = profile?.conta_id ?? 'unknown';
const [tourDone, setTourDone] = useState(() => localStorage.getItem(tourStorageKey(contaId)) === 'true');
const [replayActive, setReplayActive] = useState(false);

const showExample = activeWorkflows.length === 0 && (!tourDone || replayActive);

const markTourDone = useCallback(() => {
  localStorage.setItem(tourStorageKey(contaId), 'true');
  setTourDone(true);
  setReplayActive(false);
}, [contaId]);

const launchTour = useCallback(() => {
  captureEvent('entregas_tour_started');
  // rAF: anchors must exist in the DOM before driver queries them
  requestAnimationFrame(() =>
    startEntregasTour({
      onComplete: () => {
        captureEvent('entregas_tour_completed');
        markTourDone();
      },
      onDismiss: (step) => {
        captureEvent('entregas_tour_dismissed', { step });
        markTourDone();
      },
    }),
  );
}, [markTourDone]);

// auto-start on first visit with the example board showing
const autoStarted = useRef(false);
useEffect(() => {
  if (isLoading || autoStarted.current || tourDone || !showExample) return;
  autoStarted.current = true;
  launchTour();
}, [isLoading, tourDone, showExample, launchTour]);

const handleReplay = () => {
  setReplayActive(true);          // forces ExampleBoard if board is empty
  launchTour();                   // replay does NOT clear localStorage; completing again is a no-op re-set
};
```

- Replace the header Info tooltip block with a small dropdown or simply add next to it a text button:
  `<button type="button" onClick={handleReplay} style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Ver tour novamente</button>`
- Pass to `KanbanView`: `showExample={showExample} onDismissExample={() => { captureEvent('entregas_tour_dismissed', { step: -1 }); markTourDone(); }}`.
- Replay ends: `startEntregasTour`'s onComplete/onDismiss already call `markTourDone` which sets `replayActive` false.

- [ ] **Step 4: Run the page tests + full PR B verification**

```bash
npx vitest run apps/crm/src/pages/entregas
npm run format && npm run lint && npm run test && npm run build
```

Expected: all green.

- [ ] **Step 5: Manual browser verification (required — jsdom can't validate driver.js)**

Start the CRM dev server against staging, open `/entregas` with a test conta that has zero workflows, and verify: example board renders, tour auto-starts and steps through all 6 anchors, `Pular`/overlay dismiss persists, "Ver tour novamente" replays, dark mode popover styling. Capture a screenshot for the PR.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas apps/crm/src
git commit -m "feat(entregas): first-visit tour with replay + example board wiring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

PR B is now shippable (base `main`, after PR A merges — rebase first).

---

## Plan Self-Review (r2 — after external plan review)

- **Spec coverage:** re-arm incl. partial-failure semantics + store-level query tests (Tasks 1–2), drawer auto-complete reworked from dead code with a transition guard (2), second-cycle badge regression test (2), dialog guard incl. X + overlay paths (3), extraction + pill + suggestionId (4), analytics union (5), presets (6), helpers/validation incl. stale-assignee, `validatePrazos` data_fixa gating + data_entrega matrix (7), template-first sequencing + `__auto__` normalization + auto-month deadline tests (8), wizard steps 1–2 compile-clean with no forward imports (9), step 3 (10), steps 4–5 incl. data_fixa gating, month-option contract, client-switch reevaluation (11), modal deletion + test migration (12), anchors + ExampleBoard + filtered-empty rule (13), tour module pinned to driver.js 1.7.0 with `onDoneClick` completion flag + mocked-driver complete/early-dismiss/final-step-dismiss tests (14), harness updates (KanbanView mock honoring `showExample`, `useAuth` mock, sync rAF) + auto-start/replay/analytics + manual browser check (15). MCP: no tasks needed (spec §MCP — verified no changes required).
- **Type consistency:** `EtapaFormData` (Task 4) consumed in 7/8/10; `WizardSource`/`WizardCreateInput` (8) consumed in 11; `completeEtapaWithRearm` returns `{ workflow, etapas, rearmed, rearmFailed }` everywhere (Tasks 1, 2 — both Kanban and Drawer callers); `shouldAutoCompleteApproval` (2) consumed only in 2; `validatePrazos` (7) consumed in 11; `tourStorageKey`/`buildTourSteps`/`startEntregasTour` (14) consumed in 15.
- **Placeholder scan:** Task 9's interim `null` renders for steps 3–5 are import-free and explicitly bounded ("must be replaced within the same PR" — Tasks 10–11 do); the overlay-click dialog test documents its jsdom fallback inline rather than deferring it.
