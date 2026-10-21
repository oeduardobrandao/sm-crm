import { useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameDay,
  isSameMonth,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { useSheetActions } from '@/components/mobile/sheetActions';
import { cn } from '@/lib/utils';
import type { Membro, TarefaWithRelations } from '../../../store';
import { parseDateOnly, sortTarefas, toDateOnlyString } from '../tarefasLogic';
import { membroOf, TarefasPhoneContext, useTarefasPhoneActions } from './parts';
import { TarefaPhoneRow } from './TarefasPhoneList';
import './tarefasPhone.css';

const WEEK_DAYS = [
  { short: 'S', long: 'segunda' },
  { short: 'T', long: 'terça' },
  { short: 'Q', long: 'quarta' },
  { short: 'Q', long: 'quinta' },
  { short: 'S', long: 'sexta' },
  { short: 'S', long: 'sábado' },
  { short: 'D', long: 'domingo' },
];

function monthCells(month: Date): (Date | null)[] {
  const start = startOfMonth(month);
  const lead = (getDay(start) + 6) % 7; // Monday first, like the desktop MonthGrid
  const days = eachDayOfInterval({ start, end: endOfMonth(month) });
  return [...Array.from({ length: lead }, () => null), ...days];
}

export interface TarefasPhoneCalendarProps {
  /** Tasks after the page's filters, with the view's optimistic overrides applied. */
  tarefas: TarefaWithRelations[];
  membros: Membro[];
  currentMonth: Date;
  onMonthChange: (month: Date) => void;
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
  onCreateTask: (date: string | null) => void;
}

/** Rows inside the "Sem data" sheet: opening a task (or editing it from the menu)
 *  closes the sheet first, so the detail screen isn't stacked under it. */
function SemDataList({
  tarefas,
  membros,
  now,
  onTarefaClick,
  onRefresh,
}: {
  tarefas: TarefaWithRelations[];
  membros: Membro[];
  now: Date;
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
}) {
  const { closeThen } = useSheetActions();
  const ctx = useTarefasPhoneActions();
  const scoped = useMemo(
    () =>
      ctx
        ? {
            ...ctx,
            openDetail: (t: TarefaWithRelations) => closeThen(() => ctx.openDetail(t)),
            edit: (t: TarefaWithRelations) => closeThen(() => ctx.edit(t)),
          }
        : null,
    [ctx, closeThen],
  );
  return (
    <div className="phone-tar-sheet-body">
      <TarefasPhoneContext.Provider value={scoped}>
        <ul className="phone-tar-list">
          {tarefas.map((t) => (
            <TarefaPhoneRow
              key={t.id}
              tarefa={t}
              membro={membroOf(membros, t)}
              now={now}
              onOpen={() => closeThen(() => onTarefaClick(t))}
              onRefresh={onRefresh}
            />
          ))}
        </ul>
        <p className="phone-tar-footnote">
          Use Definir prazo no menu de uma tarefa (segure a linha) para colocá-la no calendário.
        </p>
      </TarefasPhoneContext.Provider>
    </div>
  );
}

/**
 * Calendário "Mês" below 768px (the CalendarViewPhone pattern): a compact month with
 * dots, the selected day's tasks under it, a "Sem data" chip for undated open tasks,
 * and "Nova tarefa" for the selected day. Rescheduling is the row menu's "Mudar prazo"
 * instead of the desktop drag (D30).
 */
export function TarefasPhoneCalendar({
  tarefas,
  membros,
  currentMonth,
  onMonthChange,
  onTarefaClick,
  onRefresh,
  onCreateTask,
}: TarefasPhoneCalendarProps) {
  const now = new Date();
  const [selected, setSelected] = useState<Date | null>(() =>
    isSameMonth(currentMonth, now) ? now : startOfMonth(currentMonth),
  );
  const [semDataOpen, setSemDataOpen] = useState(false);
  const monthName = format(currentMonth, 'MMMM', { locale: ptBR });
  const cells = monthCells(currentMonth);
  const todayStr = toDateOnlyString(now);

  const byDay = new Map<string, TarefaWithRelations[]>();
  const semData: TarefaWithRelations[] = [];
  for (const t of tarefas) {
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

  const changeMonth = (next: Date) => {
    onMonthChange(next);
    setSelected(isSameMonth(next, now) ? now : startOfMonth(next));
  };

  const shownSelected = selected && isSameMonth(selected, currentMonth) ? selected : null;
  const selectedStr = shownSelected ? toDateOnlyString(shownSelected) : null;
  const dayTarefas = selectedStr ? (byDay.get(selectedStr) ?? []) : [];
  const dayHeader = shownSelected
    ? format(shownSelected, "EEEE, d 'de' MMMM", { locale: ptBR })
    : null;

  const toneOf = (t: TarefaWithRelations): string | undefined => {
    if (t.status === 'concluida') return 'done';
    if (t.data_limite && parseDateOnly(t.data_limite) < parseDateOnly(todayStr)) return 'overdue';
    return undefined;
  };

  return (
    <div className="phone-tar-calendar">
      {semData.length > 0 && (
        <ChipRow aria-label="Tarefas sem data" className="phone-tar-chips">
          <Chip label="Sem data" count={semData.length} onClick={() => setSemDataOpen(true)} />
        </ChipRow>
      )}

      <div className="phone-tar-cal">
        <div className="phone-tar-cal__head">
          <h2 className="phone-tar-cal__month">
            {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
          </h2>
          <span className="phone-tar-cal__nav">
            <button
              type="button"
              className="phone-tar-round-btn"
              aria-label="Mês anterior"
              onClick={() => changeMonth(subMonths(currentMonth, 1))}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              className="phone-tar-round-btn"
              aria-label="Próximo mês"
              onClick={() => changeMonth(addMonths(currentMonth, 1))}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="phone-tar-cal__weekdays" aria-hidden="true">
          {WEEK_DAYS.map((d) => (
            <span key={d.long}>{d.short}</span>
          ))}
        </div>
        <div className="phone-tar-cal__grid">
          {cells.map((date, i) => {
            if (!date) return <span key={`blank-${i}`} />;
            const key = toDateOnlyString(date);
            const list = byDay.get(key) ?? [];
            const isSelected = shownSelected != null && isSameDay(date, shownSelected);
            const d = date.getDate();
            return (
              <button
                key={key}
                type="button"
                className={cn(
                  'phone-tar-cal__day',
                  key === todayStr && 'phone-tar-cal__day--today',
                  isSelected && 'phone-tar-cal__day--selected',
                )}
                aria-pressed={isSelected}
                aria-label={`${d} de ${monthName}${
                  list.length > 0
                    ? `, ${list.length} ${list.length === 1 ? 'tarefa' : 'tarefas'}`
                    : ''
                }`}
                onClick={() => setSelected(date)}
              >
                {d}
                <span className="phone-tar-cal__dots" aria-hidden="true">
                  {list.slice(0, 3).map((t) => (
                    <i key={t.id} className="phone-tar-dot" data-tone={toneOf(t)} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {shownSelected && selectedStr && (
        <section className="phone-tar-section" aria-label={dayHeader ?? undefined}>
          <h2 className="phone-tar-section__head">{dayHeader}</h2>
          {dayTarefas.length === 0 ? (
            <p className="phone-tar-empty">Nenhuma tarefa neste dia.</p>
          ) : (
            <ul className="phone-tar-list">
              {dayTarefas.map((t) => (
                <TarefaPhoneRow
                  key={t.id}
                  tarefa={t}
                  membro={membroOf(membros, t)}
                  now={now}
                  onOpen={() => onTarefaClick(t)}
                  onRefresh={onRefresh}
                />
              ))}
            </ul>
          )}
          <button
            type="button"
            className="phone-tar-board__add phone-tar-cal__new"
            onClick={() => onCreateTask(selectedStr)}
          >
            <Plus aria-hidden="true" /> Nova tarefa em {format(shownSelected, 'dd/MM')}
          </button>
        </section>
      )}

      <BottomSheet
        open={semDataOpen}
        onOpenChange={setSemDataOpen}
        title={`Sem data · ${semData.length}`}
        detents={['medium', 'large']}
      >
        <SemDataList
          tarefas={semData}
          membros={membros}
          now={now}
          onTarefaClick={onTarefaClick}
          onRefresh={onRefresh}
        />
      </BottomSheet>
    </div>
  );
}
