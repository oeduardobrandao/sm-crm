import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Membro, TarefaWithRelations } from '../../../store';
import { TarefaCard } from '../components/TarefaCard';

export interface BoardColumn {
  /** Namespaced droppable id from buildDropId. */
  dropId: string;
  title: string;
  tarefas: TarefaWithRelations[];
  hideAssignee?: boolean;
}

interface TarefaBoardProps {
  columns: BoardColumn[];
  membros: Membro[];
  now: Date;
  onCardClick: (tarefa: TarefaWithRelations) => void;
  /** Fired with the dragged task and the RESOLVED column dropId (card-over-card
   * drops resolve to the hovered card's column). */
  onDropCard: (tarefa: TarefaWithRelations, dropId: string) => void;
}

function DraggableTarefaCard({
  tarefa,
  membro,
  now,
  onClick,
  hideAssignee,
}: {
  tarefa: TarefaWithRelations;
  membro: Membro | null;
  now: Date;
  onClick: () => void;
  hideAssignee?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(tarefa.id),
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
      }}
    >
      <TarefaCard
        tarefa={tarefa}
        membro={membro}
        now={now}
        onClick={onClick}
        hideAssignee={hideAssignee}
      />
    </div>
  );
}

// Registers the column body as a drop target so empty columns can receive drops.
function DroppableColumnBody({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className="board-column-body"
      style={{ minHeight: 60, ...(isOver ? { background: 'var(--surface-hover)' } : {}) }}
    >
      {children}
    </div>
  );
}

/** Generic tarefa board: fixed columns, cards draggable across them. No manual
 * ordering (columns are pre-sorted by due date), so no SortableContext. */
export function TarefaBoard({ columns, membros, now, onCardClick, onDropCard }: TarefaBoardProps) {
  const [activeTarefa, setActiveTarefa] = useState<TarefaWithRelations | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const allTarefas = columns.flatMap((c) => c.tarefas);
  const findTarefa = (id: string) => allTarefas.find((t) => String(t.id) === id);
  const columnOfTarefa = (id: string) =>
    columns.find((c) => c.tarefas.some((t) => String(t.id) === id));

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTarefa(findTarefa(String(event.active.id)) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTarefa(null);
    const { active, over } = event;
    if (!over) return;
    const tarefa = findTarefa(String(active.id));
    if (!tarefa) return;

    const overId = String(over.id);
    // Dropped on a column body, or on a card (resolve to that card's column).
    const targetColumn = columns.find((c) => c.dropId === overId) ?? columnOfTarefa(overId);
    if (!targetColumn) return;
    onDropCard(tarefa, targetColumn.dropId);
  };

  const membroById = new Map(membros.filter((m) => m.id != null).map((m) => [m.id!, m]));

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="board-rows-wrapper animate-up">
        <div className="board-container">
          {columns.map((col) => (
            <div key={col.dropId} className="board-column">
              <div className="board-column-header">
                <span className="board-column-title">{col.title}</span>
                <span className="board-column-count">{col.tarefas.length}</span>
              </div>
              <DroppableColumnBody id={col.dropId}>
                {col.tarefas.length === 0 ? (
                  <div className="board-empty">Nenhuma tarefa</div>
                ) : (
                  col.tarefas.map((t) => (
                    <DraggableTarefaCard
                      key={t.id}
                      tarefa={t}
                      membro={t.responsavel_id != null ? (membroById.get(t.responsavel_id) ?? null) : null}
                      now={now}
                      onClick={() => onCardClick(t)}
                      hideAssignee={col.hideAssignee}
                    />
                  ))
                )}
              </DroppableColumnBody>
            </div>
          ))}
        </div>
      </div>
      <DragOverlay>
        {activeTarefa && (
          <TarefaCard
            tarefa={activeTarefa}
            membro={
              activeTarefa.responsavel_id != null
                ? (membroById.get(activeTarefa.responsavel_id) ?? null)
                : null
            }
            now={now}
            onClick={() => {}}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
