# Advance workflow cards past client-approval etapas with mixed post statuses

**Date:** 2026-06-25
**Status:** Approved design — pending implementation plan
**Branch / worktree:** `worktree-feat+advance-etapa-mixed-approval` (isolated worktree, branched from `main`)

## Problem

On the Entregas Kanban, a **card** is a whole workflow (one client delivery) containing multiple **posts**. The workflow advances as a unit via a single `etapa_atual` pointer, so all posts move to the next etapa together.

When a card sits in an etapa whose `tipo === 'aprovacao_cliente'`, advancing it is gated: the move is blocked unless **every** post inside is `aprovado_cliente`. When blocked, `ClientApprovalChoiceDialog` offers two options, and **both mutate post statuses**:

- **Aprovar internamente** → sets all posts to `aprovado_cliente`, then advances.
- **Enviar ao portal do cliente** → sets all posts to `enviado_cliente` (does not advance).

This forces an all-or-nothing decision. In practice, agencies often have a card where the client has already approved *some* posts (`aprovado_cliente`) while others are still pending (`enviado_cliente`). They want to advance the card so the designer can start on the approved posts, **without** changing the status of any post — the still-pending posts must remain pending and still be approvable by the client in the portal.

## Goal

Let users advance a card past a `aprovacao_cliente` etapa while leaving every post's status exactly as it is, and make it visible (on the board and in the drawer) that a moved-on card still has posts awaiting client approval.

## Non-goals / accepted tradeoffs

- **No publish-time guard.** A post that was never client-approved can still reach scheduling/publishing. Accepted explicitly.
- **No splitting of cards.** The whole workflow advances together (single `etapa_atual`); we are not moving individual posts between etapas.
- **No change to the existing two dialog actions** (Aprovar internamente / Enviar ao portal). We add a third path alongside them.

## Current behavior (verified)

- **Gate:** `KanbanView.tsx` `executeForward` (lines ~325–351): `if (card.etapa.tipo === 'aprovacao_cliente' && !allApproved) setApprovalChoiceCard(card)` where `allApproved = total > 0 && approved === total` and `approved` counts posts with `status === 'aprovado_cliente'`. This is the **only** advance gate (the drag-adjacency check at lines ~300–305 is unrelated and stays).
- **Dialog:** `WorkflowModals.tsx` `ClientApprovalChoiceDialog` (lines 1566–1601) renders the two action buttons + Cancelar.
- **Portal decoupling (verified):** The Hub portal lists posts purely by `status === 'enviado_cliente'` (`hub-posts/handler.ts` query + `AprovacoesPage.tsx:31-33` filter) with **zero** dependency on `etapa_atual`, etapa `status`, or etapa `tipo`. So leftover `enviado_cliente` posts remain approvable after the card advances.
- **Auto-complete (verified):** `WorkflowDrawer.tsx` `checkAutoComplete` (lines ~427–447) only completes an approval etapa whose `status === 'ativo'`. After we advance, that etapa is `concluido`, so there is no double-advance.

## Design

### 1. "Move anyway" action

**`WorkflowModals.tsx` — `ClientApprovalChoiceDialog`:**
- Add a prop `onAdvanceWithoutChanges: () => void`.
- Add a third button **below** the two primary actions and **above** Cancelar:
  - Label: **`Avançar etapa sem alterar posts`**
  - Style: `variant="secondary"` — intentionally de-emphasized relative to the two main actions, but clearly visible and clickable (not a ghost/link). `secondary` is chosen over `outline` so it does not look identical to the existing `Enviar ao portal do cliente` (which is `outline`).

**`KanbanView.tsx`:**
- Extract the existing "just advance" logic from `executeForward`'s else-branch into a shared helper:

  ```ts
  const advanceEtapa = async (card: BoardCard, successMessage: string) => {
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
  };
  ```
  - `executeForward`'s else-branch calls `advanceEtapa(card, 'Etapa concluída!')` (preserves current behavior verbatim, including the recurring path).
- Add a handler wired to the dialog's new button:

  ```ts
  const handleAdvanceWithoutApproval = () => {
    if (!approvalChoiceCard) return;
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    advanceEtapa(card, 'Etapa avançada — status dos posts mantidos.');
  };
  ```
  - **Recurring behavior preserved:** if `completeEtapa` concludes a recurring workflow, `onRecurring` fires instead of the "status mantidos" toast.
- Pass `onAdvanceWithoutChanges={handleAdvanceWithoutApproval}` to `ClientApprovalChoiceDialog` (render site at lines ~505–510).
- **No preconditions:** the action advances regardless of how many posts are approved (even zero). It is the explicit user choice.

### 2. Persistent card badge

**`WorkflowCard.tsx`** currently shows `⏳ Aguardando cliente` only while the card is *in* the `aprovacao_cliente` etapa (line 475 branch). After advancing, that indicator disappears. Add a branch so a card in an etapa **after** the approval etapa that still has `enviado_cliente` posts shows `⏳ N aguardando cliente`, reusing the existing pill styling.

- **"After the approval etapa" by ordem (not by `tipo`):** do **not** use `card.etapa.tipo !== 'aprovacao_cliente'` as a proxy. Compute the approval etapa's ordem from `card.allEtapas` and compare:

  ```ts
  const approvalOrdem = card.allEtapas.find((e) => e.tipo === 'aprovacao_cliente')?.ordem;
  const showAwaiting =
    approvalOrdem != null &&
    card.etapa.ordem > approvalOrdem &&
    (awaitingClienteCount ?? 0) > 0;
  ```
  - If the workflow has no `aprovacao_cliente` etapa (`approvalOrdem == null`), the badge never shows.
  - The in-stage case is still handled by the existing line-475 branch; this new badge is strictly for `ordem > approvalOrdem`.
  - The new badge may co-exist (stack) with the existing `✏️ Aguardando aprovação interna` badge — they convey different things.
- Counts `enviado_cliente` only (genuinely awaiting the client). `correcao_cliente` is a different state, covered by the drawer summary below.
- Add prop `awaitingClienteCount?: number` to `WorkflowCardProps` (after `revisaoInternaCount`, line 66) and destructure it.

### 3. Drawer summary

**`WorkflowDrawer.tsx`** already shows a posts-header summary at lines 617–619: `{approvedCount}/{posts.length} aprovados`, where `approvedCount` (line 556) already counts `aprovado_cliente`. Update this existing summary to be client-facing:

- Add `const clientFacingCount = orderedPosts.filter((p) => ['enviado_cliente', 'aprovado_cliente', 'correcao_cliente'].includes(p.status)).length;`
- Change the rendered text to **`{approvedCount} de {clientFacingCount} aprovados pelo cliente`**, and gate visibility on `clientFacingCount > 0` (instead of `posts.length > 0`).
  - `X` = `approvedCount` (posts in `aprovado_cliente`).
  - `Y` = `clientFacingCount` (posts in `enviado_cliente | aprovado_cliente | correcao_cliente`).
  - **Behavior change to note:** a workflow whose posts have never entered the client-approval lifecycle (only `rascunho`/`revisao_interna`/`aprovado_interno`, or already `agendado`/`postado`) will now show **no** summary instead of `0/N`. This is intended — the summary is specifically about client approval.

### 4. Counts plumbing (`awaitingClienteCounts`)

Mirror the existing `approvedPostsCounts` chain end-to-end:

1. **`store/posts.ts`** — add `getWorkflowAwaitingClientePostsCounts(workflowIds)`, a copy of `getWorkflowApprovedPostsCounts` (lines 313–328) but filtering `.eq('status', 'enviado_cliente')`.
2. **`useEntregasData.ts`**:
   - import the new function (with the other count imports, lines 9–11).
   - add a `useQuery` (after the revisao-interna query, line ~250) with key `['workflow-awaiting-cliente-counts', activeWorkflowIds.join(',')]`, `enabled: activeWorkflowIds.length > 0`.
   - expose `const awaitingClienteCounts: Map<number, number> = ... ?? new Map();`
   - **add its key to `refresh()`** (lines 332–341): `qc.invalidateQueries({ queryKey: ['workflow-awaiting-cliente-counts'] });` so the badge updates after send/approve/advance flows.
   - return `awaitingClienteCounts` from the hook (return object, lines 345–359).
3. **`EntregasPage.tsx`** — destructure `awaitingClienteCounts` (line ~65) and pass `awaitingClienteCounts={awaitingClienteCounts}` to `<KanbanView>` (line ~267).
4. **`KanbanView.tsx`** — add `awaitingClienteCounts: Map<number, number>` to `KanbanViewProps` (line ~48), destructure it (line ~172), thread `awaitingClienteCount` through the inner card component (props at lines ~114–127, passthrough at line ~152), and pass `awaitingClienteCount={awaitingClienteCounts.get(card.workflow.id!) ?? 0}` at both render sites (lines ~462 and ~481).

### 5. No downstream / correctness changes

Per the verified portal decoupling and auto-complete behavior above, nothing else needs to change for correctness. No edge-function, migration, or Hub changes.

## Files to change

| File | Change |
|------|--------|
| `apps/crm/src/store/posts.ts` | Add `getWorkflowAwaitingClientePostsCounts` (filter `enviado_cliente`) |
| `apps/crm/src/pages/entregas/hooks/useEntregasData.ts` | New count query + add key to `refresh()` + return it |
| `apps/crm/src/pages/entregas/EntregasPage.tsx` | Destructure + pass `awaitingClienteCounts` to KanbanView |
| `apps/crm/src/pages/entregas/views/KanbanView.tsx` | Extract `advanceEtapa` helper; add `handleAdvanceWithoutApproval`; wire new dialog prop; thread `awaitingClienteCount` prop |
| `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` | Add third button + `onAdvanceWithoutChanges` prop to `ClientApprovalChoiceDialog` |
| `apps/crm/src/pages/entregas/components/WorkflowCard.tsx` | Add `awaitingClienteCount` prop + persistent "aguardando cliente" badge (ordem-based) |
| `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` | Update posts-header summary to client-facing `X de Y aprovados pelo cliente` |

## Testing

Per the contract-change memory note, grep both test suites (`apps/**/__tests__`, incl. Hub RTL, and `supabase/functions/__tests__`) for the `ClientApprovalChoiceDialog` prop shape and any drawer-summary text assertions; update what the new prop/text touches.

- **Store unit:** `getWorkflowAwaitingClientePostsCounts` returns correct per-workflow counts of `enviado_cliente` (mirror the existing approved-counts test if one exists).
- **Component (RTL) — `ClientApprovalChoiceDialog`:** renders the third button `Avançar etapa sem alterar posts`; clicking it fires `onAdvanceWithoutChanges` and not the other callbacks.
- **Component (RTL) — `WorkflowCard`:** in an etapa with `ordem > approvalOrdem`, shows `N aguardando cliente` when `awaitingClienteCount > 0` and hides it when `0`; does not show it when the card is in/at the approval etapa.
- **Component (RTL) — `WorkflowDrawer` summary:** renders `X de Y aprovados pelo cliente` with `Y` limited to client-facing statuses; hidden when no client-facing posts.
- **Kanban handler test (only if cheap):** add a `handleAdvanceWithoutApproval` → `completeEtapa` test only if existing KanbanView test infra supports it cheaply; otherwise the modal + store + WorkflowCard tests cover the behavioral surface.
- Run `npm run build` (tsc) and `npm run test` before finishing.

## Open points

- **Button label:** spec uses `Avançar etapa sem alterar posts`; the alternative `Avançar sem alterar status dos posts` is equivalent — final wording is the user's call.
- **Drawer summary visibility:** chosen to hide when `clientFacingCount === 0` (see §3 behavior-change note). Flag for confirmation during spec review.
