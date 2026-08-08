import { Fragment, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  hasLaterApprovalEtapa,
  revertEtapa,
  updateWorkflowPositions,
  approvePostsInternally,
  sendPostsToCliente,
} from '../../../store';
import { completeEtapaForAdvance, notifyRearmOutcome } from '../advanceEtapa';
import type { BoardCard } from '../hooks/useEntregasData';
import type { Membro, WorkflowEtapa, WorkflowTemplate } from '../../../store';
import { WorkflowCard } from '../components/WorkflowCard';
import { ExampleBoard } from '../components/ExampleBoard';
import {
  RevertConfirmDialog,
  ForwardConfirmDialog,
  ClientApprovalChoiceDialog,
} from '../components/WorkflowModals';

interface KanbanViewBaseProps {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
  onEditClick: (card: BoardCard) => void;
  onPostsClick: (card: BoardCard) => void;
  onRefresh: () => void;
  onRecurring: (workflowId: number) => void;
  /** Quick-add: opens the new-workflow wizard preloaded with the row's template. */
  onAddWorkflow?: (templateId: number | null) => void;
  membros: Membro[];
  templates: WorkflowTemplate[];
  postsCounts: Map<number, number>;
  approvedPostsCounts: Map<number, number>;
  clearedClienteCounts: Map<number, number>;
  revisaoInternaCounts: Map<number, number>;
  awaitingClienteCounts: Map<number, number>;
}

// Discriminated union: a caller either passes neither prop, or passes both together.
// The populated branch takes `showExample: boolean` (not the literal `true`) so callers
// can hand it a computed boolean expression while still being forced to supply
// `onDismissExample` — the example board can never render without a working dismiss.
type KanbanViewProps = KanbanViewBaseProps &
  (
    | { showExample?: false; onDismissExample?: () => void }
    | { showExample: boolean; onDismissExample: () => void }
  );

interface BoardRow {
  key: string;
  label: string;
  stepNames: string[];
  columns: Map<string, BoardCard[]>;
}

function buildBoardRows(cards: BoardCard[], templates: WorkflowTemplate[]): BoardRow[] {
  const rowMap = new Map<string, BoardRow>();
  for (const card of cards) {
    const sorted = [...card.allEtapas].sort((a, b) => a.ordem - b.ordem);
    const stepNames = sorted.map((e) => e.nome);
    const key =
      card.workflow.template_id != null
        ? `template:${card.workflow.template_id}`
        : stepNames.join(' → ');
    if (!rowMap.has(key)) {
      const columns = new Map<string, BoardCard[]>();
      for (const name of stepNames) columns.set(name, []);

      const t = templates.find((t) => t.id === card.workflow.template_id);
      const label = t ? t.nome.toUpperCase() : key.toUpperCase();

      rowMap.set(key, { key, label, stepNames, columns });
    }
    const row = rowMap.get(key)!;
    // Ensure all this card's step columns exist (templates may have evolved)
    for (const name of stepNames) {
      if (!row.columns.has(name)) row.columns.set(name, []);
    }
    const col = row.columns.get(card.etapa.nome);
    if (col) col.push(card);
  }
  // Sort cards within each column by position ascending
  for (const row of rowMap.values()) {
    for (const col of row.columns.values()) {
      col.sort((a, b) => (a.workflow.position ?? 0) - (b.workflow.position ?? 0));
    }
  }
  return [...rowMap.values()].filter((r) => [...r.columns.values()].some((col) => col.length > 0));
}

function rowCardCount(row: BoardRow): number {
  return [...row.columns.values()].reduce((sum, col) => sum + col.length, 0);
}

// Droppable column body — registers the column as a drop target so empty columns can receive drops
function DroppableColumnBody({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className="board-column-body" style={{ minHeight: 60 }}>
      {children}
    </div>
  );
}

// Draggable card wrapper
function SortableCard({
  card,
  onCardClick,
  onPostsClick,
  onEditClick,
  membros,
  onRefresh,
  onRevertClick,
  onForwardClick,
  postsCount,
  approvedPostsCount,
  clearedClienteCount,
  revisaoInternaCount,
  awaitingClienteCount,
}: {
  card: BoardCard;
  onCardClick: (c: BoardCard) => void;
  onPostsClick: (c: BoardCard) => void;
  onEditClick: (c: BoardCard) => void;
  membros: Membro[];
  onRefresh: () => void;
  onRevertClick: () => void;
  onForwardClick: () => void;
  postsCount: number;
  approvedPostsCount: number;
  clearedClienteCount: number;
  revisaoInternaCount: number;
  awaitingClienteCount: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(card.workflow.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    position: 'relative' as const,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <WorkflowCard
        card={card}
        onClick={() => onCardClick(card)}
        onEditClick={() => onEditClick(card)}
        onPostsClick={() => onPostsClick(card)}
        dragHandle={<GripVertical className="h-4 w-4" {...listeners} />}
        membros={membros}
        onRefresh={onRefresh}
        onRevertClick={onRevertClick}
        onForwardClick={onForwardClick}
        postsCount={postsCount}
        approvedPostsCount={approvedPostsCount}
        clearedClienteCount={clearedClienteCount}
        revisaoInternaCount={revisaoInternaCount}
        awaitingClienteCount={awaitingClienteCount}
      />
    </div>
  );
}

// Column droppable ID prefix — distinguishes column IDs from card IDs in handleDragEnd
const COL_PREFIX = 'col:';

// Above this many template rows the board switches from stacked rows to tabs,
// so the rows don't pile up on top of each other.
const TABS_THRESHOLD = 1;

export function KanbanView({
  cards,
  onCardClick,
  onEditClick,
  onPostsClick,
  onRefresh,
  onRecurring,
  onAddWorkflow,
  membros,
  templates,
  postsCounts,
  approvedPostsCounts,
  clearedClienteCounts,
  revisaoInternaCounts,
  awaitingClienteCounts,
  showExample,
  onDismissExample,
}: KanbanViewProps) {
  // Server data is canonical: the board always re-derives from the cards prop,
  // so any edit (título, responsável, prazo…) shows as soon as the refetch
  // lands — no reload needed. Optimistic changes (dnd moves and reorders) live
  // in overlay maps applied on top, and self-clean once the server reflects
  // them, so drags feel instant while persistence runs in the background.
  const [pendingEtapas, setPendingEtapas] = useState<Map<number, WorkflowEtapa>>(new Map());
  const [pendingPositions, setPendingPositions] = useState<Map<number, number>>(new Map());
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  // Valid adjacent column currently hovered during a drag ("rowKey::colName"),
  // plus the dragged card's height so the slot opens exactly its size.
  const [dropSlot, setDropSlot] = useState<{ colKey: string; index: number } | null>(null);
  const [dragHeight, setDragHeight] = useState(120);
  // Cross-column drop position, captured at drag end and applied after the
  // (possibly dialog-gated) advance/revert persists. Keyed by workflow id so a
  // cancelled drag can never leak its position into a button-initiated move.
  const pendingInsertRef = useRef<{
    wfId: number;
    ids: number[];
    index: number;
    optimisticPos: number;
  } | null>(null);
  const [revertTarget, setRevertTarget] = useState<{ workflowId: number; title: string } | null>(
    null,
  );
  const [approvalChoiceCard, setApprovalChoiceCard] = useState<BoardCard | null>(null);
  const [forwardTarget, setForwardTarget] = useState<BoardCard | null>(null);
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);

  // Drop overlay entries the server already reflects. A cross-column insert
  // stores a FRACTIONAL position (e.g. 0.5) that the persisted integer will
  // never equal, so those are released together with the workflow's etapa
  // overlay: the refetch that reflects the move also carries the renumbered
  // positions.
  useEffect(() => {
    if (pendingEtapas.size === 0 && pendingPositions.size === 0) return;
    const movedCaughtUp = new Set<number>();
    for (const c of cards) {
      const pe = pendingEtapas.get(c.workflow.id!);
      if (pe && pe.id === c.etapa.id) movedCaughtUp.add(c.workflow.id!);
    }
    setPendingEtapas((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const id of movedCaughtUp) next.delete(id);
      return next.size === prev.size ? prev : next;
    });
    setPendingPositions((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const c of cards) {
        const pp = next.get(c.workflow.id!);
        if (pp !== undefined && (c.workflow.position === pp || movedCaughtUp.has(c.workflow.id!)))
          next.delete(c.workflow.id!);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [cards, pendingEtapas, pendingPositions]);

  const localCards = useMemo(() => {
    if (pendingEtapas.size === 0 && pendingPositions.size === 0) return cards;
    return cards.map((c) => {
      let out = c;
      const pe = pendingEtapas.get(c.workflow.id!);
      if (pe && pe.id !== c.etapa.id) out = { ...out, etapa: pe, etapaIdx: pe.ordem };
      const pp = pendingPositions.get(c.workflow.id!);
      if (pp !== undefined && pp !== c.workflow.position)
        out = { ...out, workflow: { ...out.workflow, position: pp } };
      return out;
    });
  }, [cards, pendingEtapas, pendingPositions]);

  const boardRows = buildBoardRows(localCards, templates);

  const approvalStepNames = useMemo(
    () =>
      new Set(
        cards.flatMap((c) =>
          c.allEtapas.filter((e) => e.tipo === 'aprovacao_cliente').map((e) => e.nome),
        ),
      ),
    [cards],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const findCard = (id: string) => localCards.find((c) => String(c.workflow.id) === id);

  const findCardColumn = (
    cardId: string,
    rows: BoardRow[],
  ): { row: BoardRow; colName: string } | null => {
    for (const row of rows) {
      for (const [colName, colCards] of row.columns) {
        if (colCards.some((c) => String(c.workflow.id) === cardId)) return { row, colName };
      }
    }
    return null;
  };

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const card = findCard(String(event.active.id));
      setActiveCard(card || null);
      setDragHeight(event.active.rect.current?.initial?.height ?? 120);
    },
    [localCards],
  );

  // Opens a slot in the hovered column when the drop would be accepted there:
  // same template row, adjacent etapa (forward or backward).
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      const draggedCard = findCard(String(active.id));
      if (!over || !draggedCard) {
        setDropSlot(null);
        return;
      }
      const overId = String(over.id);
      const rows = buildBoardRows(localCards, templates);
      const activeLocation = findCardColumn(String(active.id), rows);

      let targetRow: BoardRow | undefined;
      let targetColName: string | undefined;
      if (overId.startsWith(COL_PREFIX)) {
        const colId = overId.slice(COL_PREFIX.length);
        const [rowKey, ...colNameParts] = colId.split('::');
        targetRow = rows.find((r) => r.key === rowKey);
        targetColName = colNameParts.join('::');
      } else {
        const overLocation = findCardColumn(overId, rows);
        targetRow = overLocation?.row;
        targetColName = overLocation?.colName;
      }

      if (
        !targetRow ||
        !targetColName ||
        !activeLocation ||
        targetRow.key !== activeLocation.row.key ||
        targetColName === activeLocation.colName
      ) {
        setDropSlot(null);
        return;
      }
      const targetOrdem = draggedCard.allEtapas.find((e) => e.nome === targetColName)?.ordem;
      const valid =
        targetOrdem !== undefined && Math.abs(targetOrdem - draggedCard.etapa.ordem) === 1;
      if (!valid) {
        setDropSlot(null);
        return;
      }

      // Slot index: over a card, before or after it by vertical midpoint;
      // over the column body, at the end.
      const targetCards = targetRow.columns.get(targetColName) || [];
      let index = targetCards.length;
      if (!overId.startsWith(COL_PREFIX)) {
        const overIdx = targetCards.findIndex((c) => String(c.workflow.id) === overId);
        if (overIdx !== -1) {
          const activeRect = active.rect.current?.translated;
          const after = activeRect && activeRect.top > over.rect.top + over.rect.height / 2;
          index = after ? overIdx + 1 : overIdx;
        }
      }
      const colKey = `${targetRow.key}::${targetColName}`;
      setDropSlot((prev) =>
        prev && prev.colKey === colKey && prev.index === index ? prev : { colKey, index },
      );
    },
    [localCards, templates],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveCard(null);
      setDropSlot(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);
      const draggedCard = findCard(activeId);
      if (!draggedCard) return;

      const rows = buildBoardRows(localCards, templates);
      const activeLocation = findCardColumn(activeId, rows);
      if (!activeLocation) return;

      // Resolve target column name: either from a card hover or a column droppable
      let targetColName: string;
      let targetRow: BoardRow;
      if (overId.startsWith(COL_PREFIX)) {
        // Dropped onto a column droppable (e.g. empty column)
        const colId = overId.slice(COL_PREFIX.length); // "rowKey::colName"
        const [rowKey, ...colNameParts] = colId.split('::');
        const colName = colNameParts.join('::');
        const row = rows.find((r) => r.key === rowKey);
        if (!row) return;
        targetRow = row;
        targetColName = colName;
      } else {
        // Dropped onto a card
        const overLocation = findCardColumn(overId, rows);
        if (!overLocation) return;
        targetRow = overLocation.row;
        targetColName = overLocation.colName;
      }

      if (targetColName === activeLocation.colName && targetRow.key === activeLocation.row.key) {
        // Within-column reorder
        const col = activeLocation.row.columns.get(activeLocation.colName) || [];
        const oldIdx = col.findIndex((c) => String(c.workflow.id) === activeId);
        const newIdx = overId.startsWith(COL_PREFIX)
          ? col.length - 1
          : col.findIndex((c) => String(c.workflow.id) === overId);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

        const reordered = arrayMove(col, oldIdx, newIdx);

        // Optimistic reorder overlay; rolled back if persistence fails.
        setPendingPositions((prev) => {
          const next = new Map(prev);
          reordered.forEach((c, i) => next.set(c.workflow.id!, i));
          return next;
        });

        try {
          await updateWorkflowPositions(
            reordered.map((c, i) => ({ id: c.workflow.id!, position: i })),
          );
          onRefresh();
        } catch {
          setPendingPositions((prev) => {
            const next = new Map(prev);
            reordered.forEach((c) => next.delete(c.workflow.id!));
            return next;
          });
          toast.error('Erro ao salvar ordem dos cartões');
        }
      } else {
        // Between-column move — check adjacency by ordem
        const activeEtapaOrdem = draggedCard.etapa.ordem;

        // Find target etapa ordem from any card in that column (or from the dragged card's allEtapas)
        const targetColCards = targetRow.columns.get(targetColName) || [];
        const targetOrdem =
          targetColCards.length > 0
            ? targetColCards[0].allEtapas.find((e) => e.nome === targetColName)?.ordem
            : draggedCard.allEtapas.find((e) => e.nome === targetColName)?.ordem;

        if (targetOrdem === undefined) return;
        const diff = targetOrdem - activeEtapaOrdem;
        if (Math.abs(diff) !== 1) {
          toast.error('Só é possível mover para a etapa adjacente');
          return;
        }

        // Capture where in the target column the card was dropped, so the
        // advance/revert (possibly behind a confirm dialog) can land it there
        // instead of at the bottom.
        const colKey = `${targetRow.key}::${targetColName}`;
        const slotIndex =
          dropSlot && dropSlot.colKey === colKey
            ? Math.min(dropSlot.index, targetColCards.length)
            : targetColCards.length;
        const beforePos = targetColCards[slotIndex - 1]?.workflow.position;
        const afterPos = targetColCards[slotIndex]?.workflow.position;
        const optimisticPos =
          beforePos != null && afterPos != null
            ? (beforePos + afterPos) / 2
            : afterPos != null
              ? afterPos - 1
              : beforePos != null
                ? beforePos + 1
                : 0;
        pendingInsertRef.current = {
          wfId: draggedCard.workflow.id!,
          ids: targetColCards.map((c) => c.workflow.id!),
          index: slotIndex,
          optimisticPos,
        };

        if (diff === 1) {
          handleForwardCard(draggedCard);
        } else {
          // Backward — show confirm dialog
          setRevertTarget({
            workflowId: draggedCard.workflow.id!,
            title: draggedCard.workflow.titulo,
          });
        }
      }
    },
    [localCards, dropSlot, onRefresh, onRecurring, templates],
  );

  const handleForwardCard = useCallback((card: BoardCard) => {
    setForwardTarget(card);
  }, []);

  // opts.rearm === false keeps the plain completeEtapa (post statuses untouched) — used by
  // "Avançar etapa sem alterar posts", whose literal contract is to leave posts alone.
  const advanceEtapa = useCallback(
    async (card: BoardCard, successMessage: string, opts?: { rearm?: boolean }) => {
      const wfId = card.workflow.id!;
      // Slide the card into the next column immediately; the backend persists
      // in the background. On the last etapa there is no next column — the
      // card leaves the board when the refetch lands.
      const nextEtapa = card.allEtapas.find((e) => e.ordem === card.etapa.ordem + 1);
      if (nextEtapa) setPendingEtapas((prev) => new Map(prev).set(wfId, nextEtapa));
      const insert = pendingInsertRef.current?.wfId === wfId ? pendingInsertRef.current : null;
      if (insert && nextEtapa)
        setPendingPositions((prev) => new Map(prev).set(wfId, insert.optimisticPos));
      try {
        const result = await completeEtapaForAdvance(card.workflow.id!, card.etapa.id!, opts);
        if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
          onRecurring(card.workflow.id!);
        } else {
          toast.success(successMessage);
        }
        notifyRearmOutcome(result);
        if (insert) {
          pendingInsertRef.current = null;
          const order = [...insert.ids];
          order.splice(insert.index, 0, wfId);
          try {
            await updateWorkflowPositions(order.map((id, i) => ({ id, position: i })));
          } catch {
            // Position is best-effort: the etapa advance itself already stuck.
          }
        }
        onRefresh();
      } catch (err: unknown) {
        pendingInsertRef.current = null;
        if (nextEtapa)
          setPendingEtapas((prev) => {
            const next = new Map(prev);
            next.delete(wfId);
            return next;
          });
        toast.error((err as Error).message || 'Erro ao avançar etapa');
      }
    },
    [onRefresh, onRecurring],
  );

  const executeForward = useCallback(
    (card: BoardCard) => {
      const wfId = card.workflow.id!;
      const total = postsCounts.get(wfId) ?? 0;
      // "Cleared" (approved / scheduled / posted / publish-failed), not just
      // aprovado_cliente — otherwise a workflow whose approved posts are already
      // scheduled would wrongly prompt the approval dialog on advance.
      const cleared = clearedClienteCounts.get(wfId) ?? 0;
      const allCleared = total > 0 && cleared === total;

      if (card.etapa.tipo === 'aprovacao_cliente' && !allCleared) {
        setApprovalChoiceCard(card);
      } else {
        advanceEtapa(card, 'Etapa concluída!');
      }
    },
    [advanceEtapa, postsCounts, clearedClienteCounts],
  );

  const handleForwardConfirm = () => {
    if (!forwardTarget) return;
    const card = forwardTarget;
    setForwardTarget(null);
    executeForward(card);
  };

  const handleApproveInternally = async () => {
    if (!approvalChoiceCard) return;
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    try {
      await approvePostsInternally(card.workflow.id!);
    } catch (err: unknown) {
      // The advance never runs, so the drag's captured drop position must not
      // survive to reorder a later, unrelated advance of this workflow.
      pendingInsertRef.current = null;
      toast.error((err as Error).message || 'Erro ao aprovar internamente');
      return;
    }
    await advanceEtapa(card, 'Posts aprovados internamente — etapa concluída!');
  };

  const handleSendToPortal = async () => {
    if (!approvalChoiceCard) return;
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    // Send-only: the workflow does not move, so the drag's captured drop
    // position is dead the moment this choice is made.
    pendingInsertRef.current = null;
    try {
      await sendPostsToCliente(card.workflow.id!);
      toast.success('Posts enviados ao portal do cliente!');
      onRefresh();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao enviar ao portal');
    }
  };

  const handleAdvanceWithoutApproval = () => {
    if (!approvalChoiceCard) return;
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    advanceEtapa(card, 'Etapa avançada — status dos posts mantidos.', { rearm: false });
  };

  const handleRevertConfirm = async () => {
    if (!revertTarget) return;
    const card = localCards.find((c) => c.workflow.id === revertTarget.workflowId);
    const prevEtapa = card?.allEtapas.find((e) => e.ordem === card.etapa.ordem - 1);
    if (card && prevEtapa)
      setPendingEtapas((prev) => new Map(prev).set(revertTarget.workflowId, prevEtapa));
    const insert =
      pendingInsertRef.current?.wfId === revertTarget.workflowId ? pendingInsertRef.current : null;
    if (insert && card && prevEtapa)
      setPendingPositions((prev) =>
        new Map(prev).set(revertTarget.workflowId, insert.optimisticPos),
      );
    try {
      await revertEtapa(revertTarget.workflowId);
      toast.success('Etapa revertida!');
      if (insert) {
        pendingInsertRef.current = null;
        const order = [...insert.ids];
        order.splice(insert.index, 0, revertTarget.workflowId);
        try {
          await updateWorkflowPositions(order.map((id, i) => ({ id, position: i })));
        } catch {
          // Position is best-effort: the revert itself already stuck.
        }
      }
      onRefresh();
    } catch (err: unknown) {
      pendingInsertRef.current = null;
      setPendingEtapas((prev) => {
        const next = new Map(prev);
        next.delete(revertTarget.workflowId);
        return next;
      });
      toast.error((err as Error).message || 'Erro ao reverter etapa');
    }
    setRevertTarget(null);
  };

  if (localCards.length === 0) {
    if (showExample && onDismissExample) {
      return <ExampleBoard onDismiss={onDismissExample} />;
    }
    return (
      <div
        className="card animate-up"
        style={{
          textAlign: 'center',
          padding: '4rem 3rem',
          color: 'var(--text-muted)',
          borderRadius: '12px',
        }}
      >
        <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem', opacity: 0.3 }}>▣</div>
        <p style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
          Nenhuma entrega encontrada. Ajuste os filtros ou crie um novo fluxo.
        </p>
      </div>
    );
  }

  const renderRowBoard = (row: BoardRow) => (
    <div className="board-container">
      {[...row.columns.entries()].map(([stepName, stepCards], colIdx) => (
        <div key={stepName} className="board-column">
          <div
            className="board-column-header"
            {...(approvalStepNames.has(stepName) ? { 'data-tour': 'wf-col-aprovacao' } : {})}
          >
            <span className="board-column-title">{stepName}</span>
            <span className="board-column-count">{stepCards.length}</span>
          </div>
          <DroppableColumnBody id={`${COL_PREFIX}${row.key}::${stepName}`}>
            {colIdx === 0 && onAddWorkflow && (
              <button
                type="button"
                className="board-add-card"
                onClick={() =>
                  onAddWorkflow(
                    row.key.startsWith('template:')
                      ? Number(row.key.slice('template:'.length))
                      : null,
                  )
                }
              >
                <Plus className="h-3.5 w-3.5" /> Novo fluxo
              </button>
            )}
            <SortableContext
              items={stepCards.map((c) => String(c.workflow.id))}
              strategy={verticalListSortingStrategy}
            >
              {stepCards.length === 0 && `${row.key}::${stepName}` !== dropSlot?.colKey ? (
                <div className="board-empty">Nenhuma entrega</div>
              ) : (
                stepCards.map((card, cardIdx) => (
                  <Fragment key={card.workflow.id}>
                    {`${row.key}::${stepName}` === dropSlot?.colKey &&
                      dropSlot.index === cardIdx && (
                        <div
                          className="board-drop-slot"
                          style={{ height: dragHeight }}
                          aria-hidden="true"
                        />
                      )}
                    <SortableCard
                      card={card}
                      onCardClick={onCardClick}
                      onEditClick={onEditClick}
                      onPostsClick={onPostsClick}
                      membros={membros}
                      onRefresh={onRefresh}
                      onRevertClick={() =>
                        setRevertTarget({
                          workflowId: card.workflow.id!,
                          title: card.workflow.titulo,
                        })
                      }
                      onForwardClick={() => handleForwardCard(card)}
                      postsCount={postsCounts.get(card.workflow.id!) ?? 0}
                      approvedPostsCount={approvedPostsCounts.get(card.workflow.id!) ?? 0}
                      clearedClienteCount={clearedClienteCounts.get(card.workflow.id!) ?? 0}
                      revisaoInternaCount={revisaoInternaCounts.get(card.workflow.id!) ?? 0}
                      awaitingClienteCount={awaitingClienteCounts.get(card.workflow.id!) ?? 0}
                    />
                  </Fragment>
                ))
              )}
              {`${row.key}::${stepName}` === dropSlot?.colKey &&
                dropSlot.index >= stepCards.length && (
                  <div
                    className="board-drop-slot"
                    style={{ height: dragHeight }}
                    aria-hidden="true"
                  />
                )}
            </SortableContext>
          </DroppableColumnBody>
        </div>
      ))}
    </div>
  );

  // With 2+ templates the stacked rows pile up, so switch to tabs and show one at a time.
  const useTabs = boardRows.length > TABS_THRESHOLD;
  const activeRow = boardRows.find((r) => r.key === activeRowKey) ?? boardRows[0];

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={() => {
          setActiveCard(null);
          setDropSlot(null);
          pendingInsertRef.current = null;
        }}
        onDragEnd={handleDragEnd}
      >
        <div className="board-rows-wrapper animate-up">
          {useTabs && activeRow ? (
            <div>
              <div className="board-tabs no-scrollbar" role="tablist">
                {boardRows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    role="tab"
                    aria-selected={row.key === activeRow.key}
                    className={`board-tab${row.key === activeRow.key ? ' active' : ''}`}
                    onClick={() => setActiveRowKey(row.key)}
                  >
                    {row.label}
                    <span className="board-tab-count">{rowCardCount(row)}</span>
                  </button>
                ))}
              </div>
              {renderRowBoard(activeRow)}
            </div>
          ) : (
            // Single template — no tab bar needed, just the board.
            boardRows.map((row) => <div key={row.key}>{renderRowBoard(row)}</div>)
          )}
        </div>
        <DragOverlay>
          {activeCard && (
            <WorkflowCard
              card={activeCard}
              isDragOverlay
              postsCount={postsCounts.get(activeCard.workflow.id!) ?? 0}
              approvedPostsCount={approvedPostsCounts.get(activeCard.workflow.id!) ?? 0}
              clearedClienteCount={clearedClienteCounts.get(activeCard.workflow.id!) ?? 0}
              revisaoInternaCount={revisaoInternaCounts.get(activeCard.workflow.id!) ?? 0}
              awaitingClienteCount={awaitingClienteCounts.get(activeCard.workflow.id!) ?? 0}
            />
          )}
        </DragOverlay>
      </DndContext>
      <ForwardConfirmDialog
        open={!!forwardTarget}
        workflowTitle={forwardTarget?.workflow.titulo || ''}
        nextEtapaName={
          forwardTarget
            ? ([...forwardTarget.allEtapas]
                .sort((a, b) => a.ordem - b.ordem)
                .find((e) => e.ordem > forwardTarget.etapa.ordem)?.nome ?? '')
            : ''
        }
        onConfirm={handleForwardConfirm}
        onCancel={() => {
          pendingInsertRef.current = null;
          setForwardTarget(null);
        }}
      />
      <RevertConfirmDialog
        open={!!revertTarget}
        workflowTitle={revertTarget?.title || ''}
        onConfirm={handleRevertConfirm}
        onCancel={() => {
          pendingInsertRef.current = null;
          setRevertTarget(null);
        }}
      />
      <ClientApprovalChoiceDialog
        open={!!approvalChoiceCard}
        workflowTitle={approvalChoiceCard?.workflow.titulo || ''}
        willRearm={
          approvalChoiceCard
            ? hasLaterApprovalEtapa(approvalChoiceCard.allEtapas, approvalChoiceCard.etapa.id!)
            : false
        }
        onApproveInternally={handleApproveInternally}
        onSendToPortal={handleSendToPortal}
        onAdvanceWithoutChanges={handleAdvanceWithoutApproval}
        onCancel={() => {
          pendingInsertRef.current = null;
          setApprovalChoiceCard(null);
        }}
      />
    </>
  );
}
