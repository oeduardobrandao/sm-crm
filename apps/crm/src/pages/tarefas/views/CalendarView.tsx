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
import { toast } from 'sonner';
import { MonthGrid } from '@/components/ui/month-grid';
import { updateTarefa, type TarefaWithRelations } from '../../../store';
import { buildDropId, parseDropId, sortTarefas, toDateOnlyString } from '../tarefasLogic';
import { useOptimisticTarefas } from '../hooks/useOptimisticTarefas';

interface CalendarViewProps {
  tarefas: TarefaWithRelations[];
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
}

const MAX_CHIPS_PER_DAY = 3;

function TarefaChip({
  tarefa,
  onClick,
  overlay,
}: {
  tarefa: TarefaWithRelations;
  onClick?: () => void;
  overlay?: boolean;
}) {
  const accent = tarefa.tags[0]?.cor ?? 'var(--primary-color)';
  const done = tarefa.status === 'concluida';
  return (
    <div
      onClick={onClick}
      title={tarefa.titulo}
      style={{
        fontSize: '0.62rem',
        fontWeight: 600,
        lineHeight: 1.3,
        padding: '0.15rem 0.35rem',
        borderRadius: '5px',
        borderLeft: `3px solid ${accent}`,
        background: 'var(--surface-2)',
        color: done ? 'var(--text-muted)' : 'var(--text-main)',
        textDecoration: done ? 'line-through' : undefined,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        cursor: overlay ? 'grabbing' : 'pointer',
      }}
    >
      {tarefa.titulo}
    </div>
  );
}

function DraggableChip({
  tarefa,
  onClick,
}: {
  tarefa: TarefaWithRelations;
  onClick: () => void;
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
      <TarefaChip tarefa={tarefa} onClick={onClick} />
    </div>
  );
}

function DayCell({
  date,
  isCurrentMonth,
  isToday,
  tarefas,
  onTarefaClick,
}: {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  tarefas: TarefaWithRelations[];
  onTarefaClick: (t: TarefaWithRelations) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: buildDropId({ kind: 'day', date: toDateOnlyString(date) }),
  });
  const visible = tarefas.slice(0, MAX_CHIPS_PER_DAY);
  const hidden = tarefas.length - visible.length;
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 88,
        borderRadius: '8px',
        border: isToday ? '1.5px solid var(--primary-color)' : '1px solid var(--border-color)',
        background: isOver ? 'var(--surface-hover)' : isCurrentMonth ? 'var(--card-bg)' : 'transparent',
        opacity: isCurrentMonth ? 1 : 0.45,
        padding: '0.3rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
      }}
    >
      <span
        style={{
          fontSize: '0.68rem',
          fontWeight: isToday ? 800 : 500,
          color: isToday ? 'var(--primary-hover)' : 'var(--text-muted)',
          alignSelf: 'flex-end',
        }}
      >
        {date.getDate()}
      </span>
      {visible.map((t) => (
        <DraggableChip key={t.id} tarefa={t} onClick={() => onTarefaClick(t)} />
      ))}
      {hidden > 0 && (
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>+{hidden} mais</span>
      )}
    </div>
  );
}

function SemDataRail({
  tarefas,
  onTarefaClick,
}: {
  tarefas: TarefaWithRelations[];
  onTarefaClick: (t: TarefaWithRelations) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: buildDropId({ kind: 'day', date: null }) });
  return (
    <div
      ref={setNodeRef}
      className="card"
      style={{
        borderRadius: '12px',
        padding: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        minHeight: 120,
        background: isOver ? 'var(--surface-hover)' : undefined,
      }}
    >
      <span
        style={{
          fontSize: '0.7rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-muted)',
          marginBottom: '0.25rem',
        }}
      >
        Sem data · {tarefas.length}
      </span>
      {tarefas.length === 0 && (
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          Arraste uma tarefa para cá para remover o prazo.
        </span>
      )}
      {tarefas.map((t) => (
        <DraggableChip key={t.id} tarefa={t} onClick={() => onTarefaClick(t)} />
      ))}
    </div>
  );
}

/** Month calendar of due dates. Drag a chip onto a day to set data_limite, or
 * onto the "Sem data" rail to clear it. */
export function CalendarView({ tarefas, onTarefaClick, onRefresh }: CalendarViewProps) {
  const { merged, applyOverride, clearOverride } = useOptimisticTarefas(tarefas);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [activeTarefa, setActiveTarefa] = useState<TarefaWithRelations | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const now = new Date();
  const todayStr = toDateOnlyString(now);

  const byDay = new Map<string, TarefaWithRelations[]>();
  const semData: TarefaWithRelations[] = [];
  for (const t of merged) {
    if (!t.data_limite) {
      if (t.status !== 'concluida') semData.push(t);
      continue;
    }
    const list = byDay.get(t.data_limite) ?? [];
    list.push(t);
    byDay.set(t.data_limite, list);
  }
  for (const list of byDay.values()) list.sort(sortTarefas);
  semData.sort(sortTarefas);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTarefa(merged.find((t) => String(t.id) === String(event.active.id)) ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTarefa(null);
    const { active, over } = event;
    if (!over) return;
    const tarefa = merged.find((t) => String(t.id) === String(active.id));
    if (!tarefa) return;
    const target = parseDropId(String(over.id));
    if (!target || target.kind !== 'day') return;
    if (tarefa.data_limite === target.date || (!tarefa.data_limite && target.date === null)) return;
    applyOverride(tarefa.id!, { data_limite: target.date });
    try {
      await updateTarefa(tarefa.id!, { data_limite: target.date });
      toast.success(target.date ? 'Prazo atualizado!' : 'Prazo removido!');
      onRefresh();
    } catch {
      clearOverride(tarefa.id!);
      toast.error('Erro ao atualizar prazo');
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        className="animate-up"
        style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}
      >
        <div className="card" style={{ flex: '1 1 560px', borderRadius: '12px', padding: '1rem' }}>
          <MonthGrid
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            renderCell={(date, isCurrentMonth) => (
              <DayCell
                date={date}
                isCurrentMonth={isCurrentMonth}
                isToday={toDateOnlyString(date) === todayStr}
                tarefas={byDay.get(toDateOnlyString(date)) ?? []}
                onTarefaClick={onTarefaClick}
              />
            )}
          />
        </div>
        <div style={{ flex: '0 1 240px', minWidth: 200 }}>
          <SemDataRail tarefas={semData} onTarefaClick={onTarefaClick} />
        </div>
      </div>
      <DragOverlay>{activeTarefa && <TarefaChip tarefa={activeTarefa} overlay />}</DragOverlay>
    </DndContext>
  );
}
