import { useState, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { completeEtapa, revertEtapa, updateWorkflowPositions } from '../../../store';
import type { BoardCard } from '../hooks/useEntregasData';
import type { Membro, WorkflowTemplate } from '../../../store';
import { WorkflowCard } from '../components/WorkflowCard';
import { RevertConfirmDialog } from '../components/WorkflowModals';

interface KanbanViewProps {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
  onPostsClick: (card: BoardCard) => void;
  onRefresh: () => void;
  onRecurring: (workflowId: number) => void;
  membros: Membro[];
  templates: WorkflowTemplate[];
}

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
    const stepNames = sorted.map(e => e.nome);
    const key = stepNames.join(' → ');
    if (!rowMap.has(key)) {
      const columns = new Map<string, BoardCard[]>();
      for (const name of stepNames) columns.set(name, []);
      
      const t = templates.find(t => t.id === card.workflow.template_id);
      const label = t ? t.nome.toUpperCase() : key.toUpperCase();

      rowMap.set(key, { key, label, stepNames, columns });
    }
    const row = rowMap.get(key)!;
    const col = row.columns.get(card.etapa.nome);
    if (col) col.push(card);
  }
  // Sort cards within each column by position ascending
  for (const row of rowMap.values()) {
    for (const col of row.columns.values()) {
      col.sort((a, b) => (a.workflow.position ?? 0) - (b.workflow.position ?? 0));
    }
  }
  return [...rowMap.values()].filter(r => [...r.columns.values()].some(col => col.length > 0));
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
function SortableCard({ card, onCardClick, onPostsClick, membros, onRefresh, onRevertClick, onForwardClick }: { card: BoardCard; onCardClick: (c: BoardCard) => void; onPostsClick: (c: BoardCard) => void; membros: Membro[]; onRefresh: () => void; onRevertClick: () => void; onForwardClick: () => void }) {
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
        onPostsClick={() => onPostsClick(card)}
        dragHandle={<GripVertical className="h-4 w-4" {...listeners} />}
        membros={membros}
        onRefresh={onRefresh}
        onRevertClick={onRevertClick}
        onForwardClick={onForwardClick}
      />
    </div>
  );
}

// Column droppable ID prefix — distinguishes column IDs from card IDs in handleDragEnd
const COL_PREFIX = 'col:';

export function KanbanView({ cards, onCardClick, onPostsClick, onRefresh, onRecurring, membros, templates }: KanbanViewProps) {
  const [localCards, setLocalCards] = useState<BoardCard[]>(cards);
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  const [revertTarget, setRevertTarget] = useState<{ workflowId: number; title: string } | null>(null);

  // Sync local state when prop cards change (after refresh — detects both workflow list and etapa changes)
  const cardsFingerprint = cards.map(c => `${c.workflow.id}:${c.etapa.id}`).join(',');
  const localFingerprint = localCards.map(c => `${c.workflow.id}:${c.etapa.id}`).join(',');
  if (cardsFingerprint !== localFingerprint) {
    setLocalCards(cards);
  }

  const boardRows = buildBoardRows(localCards, templates);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const findCard = (id: string) => localCards.find(c => String(c.workflow.id) === id);

  const findCardColumn = (cardId: string, rows: BoardRow[]): { row: BoardRow; colName: string } | null => {
    for (const row of rows) {
      for (const [colName, colCards] of row.columns) {
        if (colCards.some(c => String(c.workflow.id) === cardId)) return { row, colName };
      }
    }
    return null;
  };

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const card = findCard(String(event.active.id));
    setActiveCard(card || null);
  }, [localCards]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveCard(null);
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
      const row = rows.find(r => r.key === rowKey);
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
      const oldIdx = col.findIndex(c => String(c.workflow.id) === activeId);
      const newIdx = overId.startsWith(COL_PREFIX)
        ? col.length - 1
        : col.findIndex(c => String(c.workflow.id) === overId);
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

      const reordered = arrayMove(col, oldIdx, newIdx);
      const prevCards = [...localCards];

      // Optimistic update
      const updatedCards = localCards.map(c => {
        const idx = reordered.findIndex(r => r.workflow.id === c.workflow.id);
        if (idx !== -1) return { ...c, workflow: { ...c.workflow, position: idx } };
        return c;
      });
      setLocalCards(updatedCards);

      try {
        await updateWorkflowPositions(
          reordered.map((c, i) => ({ id: c.workflow.id!, position: i }))
        );
        onRefresh();
      } catch {
        setLocalCards(prevCards);
        toast.error('Erro ao salvar ordem dos cartões');
      }
    } else {
      // Between-column move — check adjacency by ordem
      const activeEtapaOrdem = draggedCard.etapa.ordem;

      // Find target etapa ordem from any card in that column (or from the dragged card's allEtapas)
      const targetColCards = targetRow.columns.get(targetColName) || [];
      const targetOrdem = targetColCards.length > 0
        ? targetColCards[0].allEtapas.find(e => e.nome === targetColName)?.ordem
        : draggedCard.allEtapas.find(e => e.nome === targetColName)?.ordem;

      if (targetOrdem === undefined) return;
      const diff = targetOrdem - activeEtapaOrdem;
      if (Math.abs(diff) !== 1) {
        toast.error('Só é possível mover para a etapa adjacente');
        return;
      }

      if (diff === 1) {
        // Forward — completeEtapa
        try {
          const result = await completeEtapa(draggedCard.workflow.id!, draggedCard.etapa.id!);
          if (result.workflow.status === 'concluido' && draggedCard.workflow.recorrente) {
            onRecurring(draggedCard.workflow.id!);
          } else {
            toast.success('Etapa concluída!');
          }
          onRefresh();
        } catch (err: unknown) {
          toast.error((err as Error).message || 'Erro ao avançar etapa');
        }
      } else {
        // Backward — show confirm dialog
        setRevertTarget({
          workflowId: draggedCard.workflow.id!,
          title: draggedCard.workflow.titulo,
        });
      }
    }
  }, [localCards, onRefresh, onRecurring, templates]);

  const handleRevertConfirm = async () => {
    if (!revertTarget) return;
    try {
      await revertEtapa(revertTarget.workflowId);
      toast.success('Etapa revertida!');
      onRefresh();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao reverter etapa');
    }
    setRevertTarget(null);
  };

  if (localCards.length === 0) {
    return (
      <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <p>Nenhuma entrega encontrada. Ajuste os filtros ou crie um novo fluxo.</p>
      </div>
    );
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="board-rows-wrapper animate-up">
          {boardRows.map((row) => (
            <div key={row.key}>
              {boardRows.length > 1 && <div className="board-row-label" style={{ marginBottom: '1rem' }}>{row.label}</div>}
              <div className="board-container">
                {[...row.columns.entries()].map(([stepName, stepCards]) => (
                  <div key={stepName} className="board-column">
                    <div className="board-column-header">
                      <span className="board-column-title">{stepName}</span>
                      <span className="board-column-count">{stepCards.length}</span>
                    </div>
                    <DroppableColumnBody id={`${COL_PREFIX}${row.key}::${stepName}`}>
                      <SortableContext
                        items={stepCards.map(c => String(c.workflow.id))}
                        strategy={verticalListSortingStrategy}
                      >
                        {stepCards.length === 0
                          ? <div className="board-empty">Nenhuma entrega</div>
                          : stepCards.map(card => (
                            <SortableCard
                              key={card.workflow.id}
                              card={card}
                              onCardClick={onCardClick}
                              onPostsClick={onPostsClick}
                              membros={membros}
                              onRefresh={onRefresh}
                              onRevertClick={() => setRevertTarget({ workflowId: card.workflow.id!, title: card.workflow.titulo })}
                              onForwardClick={async () => {
                                try {
                                  const result = await completeEtapa(card.workflow.id!, card.etapa.id!);
                                  if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
                                    onRecurring(card.workflow.id!);
                                  } else {
                                    toast.success('Etapa concluída!');
                                  }
                                  onRefresh();
                                } catch (err: unknown) {
                                  toast.error((err as Error).message || 'Erro ao avançar etapa');
                                }
                              }}
                            />
                          ))
                        }
                      </SortableContext>
                    </DroppableColumnBody>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <DragOverlay>
          {activeCard && <WorkflowCard card={activeCard} isDragOverlay />}
        </DragOverlay>
      </DndContext>
      <RevertConfirmDialog
        open={!!revertTarget}
        workflowTitle={revertTarget?.title || ''}
        onConfirm={handleRevertConfirm}
        onCancel={() => setRevertTarget(null)}
      />
    </>
  );
}
