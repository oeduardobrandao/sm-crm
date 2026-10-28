import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { MonthGrid } from '@/components/ui/month-grid';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import type { TarefaWithRelations } from '../../../store';
import { buildDropId, parseDropId, sortTarefas, toDateOnlyString } from '../tarefasLogic';
import { useOptimisticTarefas } from '../hooks/useOptimisticTarefas';
import { useAuth } from '@/context/AuthContext';
import type { Membro } from '../../../store';
import { loadTarefasCalendarioModo, persistTarefasCalendarioModo } from '../tarefasPrefs';
import { BoardView } from './BoardView';
import { rescheduleTarefa } from '../tarefaCommands';
import { TarefasPhoneCalendar } from '../phone/TarefasPhoneCalendar';
import { DraggableTarefaChip, TarefaChip } from '../components/TarefaCalendarChip';

interface CalendarViewProps {
  tarefas: TarefaWithRelations[];
  membros: Membro[];
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
  onCreateTask: (date: string | null) => void;
}

const MAX_CHIPS_PER_DAY = 3;

/** What every chip of the month grid needs besides its task. */
interface ChipContext {
  membroOf: (t: TarefaWithRelations) => Membro | null;
  /** A chip is being dragged: every hover card stays closed. */
  dragging: boolean;
}

function DayCell({
  date,
  isCurrentMonth,
  isToday,
  tarefas,
  onTarefaClick,
  chip,
}: {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  tarefas: TarefaWithRelations[];
  onTarefaClick: (t: TarefaWithRelations) => void;
  chip: ChipContext;
}) {
  const { t: tr } = useTranslation('tasks');
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
        background: isOver
          ? 'var(--surface-hover)'
          : isCurrentMonth
            ? 'var(--card-bg)'
            : 'transparent',
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
        <DraggableTarefaChip
          key={t.id}
          tarefa={t}
          membro={chip.membroOf(t)}
          dragging={chip.dragging}
          onClick={() => onTarefaClick(t)}
        />
      ))}
      {hidden > 0 && (
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
          {tr('calendarView.more', { n: hidden })}
        </span>
      )}
    </div>
  );
}

function SemDataRail({
  tarefas,
  onTarefaClick,
  chip,
}: {
  tarefas: TarefaWithRelations[];
  onTarefaClick: (t: TarefaWithRelations) => void;
  chip: ChipContext;
}) {
  const { t: tr } = useTranslation('tasks');
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
        {tr('calendarView.semData', { n: tarefas.length })}
      </span>
      {tarefas.length === 0 && (
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          {tr('calendarView.semDataHint')}
        </span>
      )}
      {tarefas.map((t) => (
        <DraggableTarefaChip
          key={t.id}
          tarefa={t}
          membro={chip.membroOf(t)}
          dragging={chip.dragging}
          onClick={() => onTarefaClick(t)}
        />
      ))}
    </div>
  );
}

/** Month calendar of due dates. Drag a chip onto a day to set data_limite, or
 * onto the "Sem data" rail to clear it. */
export function CalendarView({
  tarefas,
  membros,
  onTarefaClick,
  onRefresh,
  onCreateTask,
}: CalendarViewProps) {
  const { t: tr } = useTranslation('tasks');
  const isDesktop = useIsDesktop(768);
  const { profile } = useAuth();
  const contaId = profile?.active_workspace_id ?? profile?.conta_id ?? 'unknown';
  const [modo, setModo] = useState<'mes' | 'board'>(() => loadTarefasCalendarioModo(contaId));
  const handleModoChange = (next: 'mes' | 'board') => {
    setModo(next);
    persistTarefasCalendarioModo(contaId, next);
  };
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

  const membroById = new Map(membros.filter((m) => m.id != null).map((m) => [m.id!, m]));
  const chip: ChipContext = {
    membroOf: (t) => (t.responsavel_id != null ? (membroById.get(t.responsavel_id) ?? null) : null),
    dragging: activeTarefa != null,
  };

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
    await rescheduleTarefa(tarefa, target.date, onRefresh, {
      apply: applyOverride,
      clear: clearOverride,
    });
  };

  const toggle = (
    <div
      style={{
        display: 'inline-flex',
        gap: '0.25rem',
        background: 'var(--surface-2)',
        padding: '0.2rem',
        borderRadius: '8px',
        width: 'fit-content',
      }}
    >
      {(['board', 'mes'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => handleModoChange(option)}
          style={{
            padding: '0.3rem 0.7rem',
            borderRadius: '6px',
            border: 'none',
            background: modo === option ? '#000' : 'transparent',
            color: modo === option ? '#fff' : 'var(--text-secondary)',
            fontSize: '0.75rem',
            fontWeight: modo === option ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          {tr(`calendarView.modo.${option}`)}
        </button>
      ))}
    </div>
  );

  // Phones: Board/Mês as a segmented control; the board is TarefaBoard's one-column
  // phone board, the month the CalendarViewPhone pattern. No drag (D30).
  if (!isDesktop) {
    return (
      <div className="phone-tar-calendario">
        <div className="phone-tar-cal-bar">
          <SegmentedControl
            aria-label={tr('calendarView.modoLabel')}
            value={modo}
            onChange={handleModoChange}
            options={[
              { value: 'board', label: tr('calendarView.modo.board') },
              { value: 'mes', label: tr('calendarView.modo.mes') },
            ]}
          />
        </div>
        {modo === 'board' ? (
          <BoardView
            tarefas={tarefas}
            membros={membros}
            onTarefaClick={onTarefaClick}
            onRefresh={onRefresh}
            onCreateTask={onCreateTask}
          />
        ) : (
          <TarefasPhoneCalendar
            tarefas={merged}
            membros={membros}
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            onTarefaClick={onTarefaClick}
            onRefresh={onRefresh}
            onCreateTask={onCreateTask}
          />
        )}
      </div>
    );
  }

  if (modo === 'board') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {toggle}
        <BoardView
          tarefas={tarefas}
          membros={membros}
          onTarefaClick={onTarefaClick}
          onRefresh={onRefresh}
          onCreateTask={onCreateTask}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {toggle}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTarefa(null)}
      >
        {/* One provider for the grid: hover cards open after ~400ms, then move
            instantly between neighbouring chips. */}
        <TooltipProvider delayDuration={400}>
          <div
            className="animate-up"
            style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}
          >
            <div
              className="card"
              style={{ flex: '1 1 560px', borderRadius: '12px', padding: '1rem' }}
            >
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
                    chip={chip}
                  />
                )}
              />
            </div>
            <div style={{ flex: '0 1 240px', minWidth: 200 }}>
              <SemDataRail tarefas={semData} onTarefaClick={onTarefaClick} chip={chip} />
            </div>
          </div>
        </TooltipProvider>
        {/* The overlay chip carries the new visuals but never a hover card. */}
        <DragOverlay>
          {activeTarefa && (
            <TarefaChip tarefa={activeTarefa} membro={chip.membroOf(activeTarefa)} overlay />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
