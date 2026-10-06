import { useState, type RefObject } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import ptBrLocale from '@fullcalendar/core/locales/pt-br';
import type {
  DatesSetArg,
  DayHeaderContentArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventMountArg,
} from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { addDays, format, isSameMonth, isSameYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { AgendaOcorrencia } from '../../../store/agenda';

export type AgendaViewType = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek';

const VIEW_OPTIONS: { value: AgendaViewType; label: string }[] = [
  { value: 'dayGridMonth', label: 'Mês' },
  { value: 'timeGridWeek', label: 'Semana' },
  { value: 'timeGridDay', label: 'Dia' },
  { value: 'listWeek', label: 'Lista' },
];

const NAV_LABELS: Record<AgendaViewType, { prev: string; next: string }> = {
  dayGridMonth: { prev: 'Mês anterior', next: 'Próximo mês' },
  timeGridWeek: { prev: 'Semana anterior', next: 'Próxima semana' },
  timeGridDay: { prev: 'Dia anterior', next: 'Próximo dia' },
  listWeek: { prev: 'Semana anterior', next: 'Próxima semana' },
};

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Period title without FullCalendar's en-dash ranges: "5 a 11 de outubro de 2026",
 *  "Outubro de 2026", "Segunda, 5 de outubro de 2026". `fim` is exclusive. */
export function tituloDoPeriodo(view: string, inicio: Date, fim: Date): string {
  if (view === 'dayGridMonth') {
    return capitalizar(format(inicio, "MMMM 'de' yyyy", { locale: ptBR }));
  }
  if (view === 'timeGridDay') {
    const dia = format(inicio, 'EEEE', { locale: ptBR }).replace('-feira', '');
    return `${capitalizar(dia)}, ${format(inicio, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}`;
  }
  const ultimo = addDays(fim, -1);
  const fimTxt = format(ultimo, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
  if (isSameMonth(inicio, ultimo)) return `${format(inicio, 'd')} a ${fimTxt}`;
  if (isSameYear(inicio, ultimo)) {
    return `${format(inicio, "d 'de' MMMM", { locale: ptBR })} a ${fimTxt}`;
  }
  return `${format(inicio, "d 'de' MMMM 'de' yyyy", { locale: ptBR })} a ${fimTxt}`;
}

/** Height per view. A fixed height keeps the time grid's own scroller (so
 *  scrollTime lands on the current hour) and lets dayMaxEvents compute "+N mais"
 *  in the month grid; FullCalendar drops both under height "auto". */
function alturaDaVisao(view: AgendaViewType, isMobile: boolean): number | 'auto' {
  if (view === 'listWeek') return 'auto';
  if (view === 'dayGridMonth') return isMobile ? 560 : 780;
  return isMobile ? 600 : 760;
}

const hora = (d: Date) => format(d, 'HH:mm');

/** Drags may not cross between the all-day row and the time grid: FullCalendar
 *  then drops the end (allDayMaintainDuration is off) and dia_inteiro is a
 *  series-level field the drag payload never carries. */
export function permitirArraste(
  span: { allDay: boolean },
  ev: { allDay: boolean } | null,
): boolean {
  return !ev || span.allDay === ev.allDay;
}

function ConteudoDoEvento({ arg }: { arg: EventContentArg }) {
  const o = arg.event.extendedProps.ocorrencia as AgendaOcorrencia;
  const { start, end, allDay, title } = arg.event;
  const mes = arg.view.type === 'dayGridMonth';
  const horario =
    !allDay && start ? (end && !mes ? `${hora(start)} a ${hora(end)}` : hora(start)) : '';
  const detalhe = [horario, !mes && o.local ? o.local : ''].filter(Boolean).join(' · ');

  if (mes || allDay) {
    return (
      <div className="agenda-ev__linha">
        {!o.mascarado && (
          <span
            className="agenda-ev__dot"
            style={{ background: arg.borderColor }}
            aria-hidden="true"
          />
        )}
        {mes && horario && <span className="agenda-ev__hora">{horario}</span>}
        <span className="agenda-ev__titulo">{title}</span>
      </div>
    );
  }
  return (
    <div className="agenda-ev__bloco">
      <div className="agenda-ev__titulo">
        {!o.mascarado && (
          <span
            className="agenda-ev__dot"
            style={{ background: arg.borderColor }}
            aria-hidden="true"
          />
        )}
        {title}
      </div>
      {detalhe && <div className="agenda-ev__detalhe">{detalhe}</div>}
    </div>
  );
}

const SEMANA_CURTA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

function CabecalhoDoDia({ arg }: { arg: DayHeaderContentArg }) {
  // `dow`, not arg.date: month headers carry a 1970 UTC placeholder date.
  const semana = SEMANA_CURTA[arg.dow];
  if (arg.view.type === 'dayGridMonth') return <span className="agenda-dia__semana">{semana}</span>;
  return (
    <span className="agenda-dia">
      <span className="agenda-dia__semana">{semana}</span>
      <span className={`agenda-dia__numero${arg.isToday ? ' agenda-dia__numero--hoje' : ''}`}>
        {format(arg.date, 'd')}
      </span>
    </span>
  );
}

export interface AgendaViewProps {
  calRef: RefObject<FullCalendar | null>;
  isMobile: boolean;
  view: AgendaViewType;
  titulo: string;
  eventos: EventInput[];
  onDatesSet: (arg: DatesSetArg) => void;
  onSelect: (inicio: Date, fim: Date, diaInteiro: boolean) => void;
  onEventClick: (o: AgendaOcorrencia, el: HTMLElement) => void;
  onMover: (o: AgendaOcorrencia, novoInicio: Date, novoFim: Date, revert: () => void) => void;
}

export default function AgendaView({
  calRef,
  isMobile,
  view,
  titulo,
  eventos,
  onDatesSet,
  onSelect,
  onEventClick,
  onMover,
}: AgendaViewProps) {
  const api = () => calRef.current?.getApi();
  // Read once: FullCalendar re-applies scrollTime whenever the option changes.
  const [scrollTime] = useState(() => format(new Date(), 'HH:00:00'));
  const opcoes = isMobile ? VIEW_OPTIONS.filter((v) => v.value !== 'timeGridWeek') : VIEW_OPTIONS;
  const nav = NAV_LABELS[view];

  return (
    <section className="agenda-view" aria-label={titulo || 'Agenda'}>
      <div className="agenda-toolbar">
        <div className="agenda-toolbar__nav">
          <Button type="button" variant="outline" size="sm" onClick={() => api()?.today()}>
            Hoje
          </Button>
          <button
            type="button"
            className="agenda-icon-btn"
            aria-label={nav.prev}
            onClick={() => api()?.prev()}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="agenda-icon-btn"
            aria-label={nav.next}
            onClick={() => api()?.next()}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <h2 className="agenda-toolbar__titulo">{titulo}</h2>
        </div>
        <ToggleGroup
          type="single"
          className="agenda-segmented"
          aria-label="Visão"
          value={view}
          // Radix fires '' when the active item is clicked again: a segmented
          // control always keeps one value.
          onValueChange={(next) => next && api()?.changeView(next)}
        >
          {opcoes.map((o) => (
            <ToggleGroupItem
              key={o.value}
              value={o.value}
              aria-label={o.label}
              className="agenda-segmented__item"
            >
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="agenda-fc">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          locale={ptBrLocale}
          initialView={isMobile ? 'listWeek' : 'timeGridWeek'}
          headerToolbar={false}
          firstDay={1}
          nowIndicator
          selectable
          selectMirror
          dayMaxEvents
          slotMinTime="06:00:00"
          scrollTime={scrollTime}
          height={alturaDaVisao(view, isMobile)}
          allDayText="Dia inteiro"
          noEventsText="Nenhum evento neste período."
          moreLinkText={(n) => `+${n} mais`}
          defaultRangeSeparator=" a "
          titleRangeSeparator=" a "
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          // Month chips as tinted blocks like the week grid (default is a dot row).
          eventDisplay="block"
          events={eventos}
          datesSet={onDatesSet}
          select={(arg) => onSelect(arg.start, arg.end, arg.allDay)}
          eventClick={(arg: EventClickArg) => {
            arg.jsEvent.preventDefault();
            onEventClick(arg.event.extendedProps.ocorrencia as AgendaOcorrencia, arg.el);
          }}
          eventDrop={(arg: EventDropArg) =>
            onMover(
              arg.event.extendedProps.ocorrencia as AgendaOcorrencia,
              arg.event.start!,
              arg.event.end ?? arg.event.start!,
              arg.revert,
            )
          }
          eventResize={(arg: EventResizeDoneArg) =>
            onMover(
              arg.event.extendedProps.ocorrencia as AgendaOcorrencia,
              arg.event.start!,
              arg.event.end!,
              arg.revert,
            )
          }
          eventAllow={permitirArraste}
          eventDidMount={(arg: EventMountArg) => {
            arg.el.dataset.ocorrenciaId = arg.event.id;
          }}
          eventContent={(arg) =>
            arg.view.type.startsWith('list') ? true : <ConteudoDoEvento arg={arg} />
          }
          dayHeaderContent={(arg) =>
            arg.view.type.startsWith('list') ? true : <CabecalhoDoDia arg={arg} />
          }
        />
      </div>
    </section>
  );
}
