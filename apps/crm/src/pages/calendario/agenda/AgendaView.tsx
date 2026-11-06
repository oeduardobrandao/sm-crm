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
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getDateFnsLocale, i18n, useIntlLocale } from '@mesaas/i18n';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { AgendaOcorrencia } from '../../../store/agenda';
import { IconeDaCamada } from '../camadas/icones';
import type { CamadaItem } from '../camadas/tipos';

export type AgendaViewType = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek';

const VIEW_OPTIONS: AgendaViewType[] = ['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek'];

/** Short view-key segment used by the `view.*` and `nav.*` translation keys. */
const VIEW_KEY: Record<AgendaViewType, 'month' | 'week' | 'day' | 'list'> = {
  dayGridMonth: 'month',
  timeGridWeek: 'week',
  timeGridDay: 'day',
  listWeek: 'list',
};

/** Prev/next aria-labels per view, resolved through i18n on every read. */
export const NAV_LABELS: Record<AgendaViewType, { prev: string; next: string }> = (() => {
  const o = {} as Record<AgendaViewType, { prev: string; next: string }>;
  for (const v of VIEW_OPTIONS) {
    const k = VIEW_KEY[v];
    o[v] = {
      get prev() {
        return i18n.t(`agenda:nav.${k}.prev`);
      },
      get next() {
        return i18n.t(`agenda:nav.${k}.next`);
      },
    };
  }
  return o;
})();

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Period title without FullCalendar's en-dash ranges: "5 a 11 de outubro de 2026",
 *  "Outubro de 2026", "Segunda, 5 de outubro de 2026". `fim` is exclusive. */
export function tituloDoPeriodo(view: string, inicio: Date, fim: Date): string {
  const locale = getDateFnsLocale();
  const fmt = (d: Date, key: string) => format(d, i18n.t(key), { locale });
  if (view === 'dayGridMonth') {
    return capitalizar(fmt(inicio, 'common:dateFormat.monthYear'));
  }
  if (view === 'timeGridDay') {
    const dia = format(inicio, 'EEEE', { locale }).replace('-feira', '');
    return i18n.t('agenda:periodo.day', {
      weekday: capitalizar(dia),
      date: fmt(inicio, 'agenda:logic.fullDateFormat'),
    });
  }
  const ultimo = addDays(fim, -1);
  if (isSameMonth(inicio, ultimo)) {
    return i18n.t('agenda:periodo.range', {
      start: fmt(inicio, 'agenda:periodo.sameMonthStartFormat'),
      end: fmt(ultimo, 'agenda:periodo.sameMonthEndFormat'),
    });
  }
  const fimTxt = fmt(ultimo, 'agenda:logic.fullDateFormat');
  if (isSameYear(inicio, ultimo)) {
    return i18n.t('agenda:periodo.range', {
      start: fmt(inicio, 'agenda:logic.dayMonthFormat'),
      end: fimTxt,
    });
  }
  return i18n.t('agenda:periodo.range', {
    start: fmt(inicio, 'agenda:logic.fullDateFormat'),
    end: fimTxt,
  });
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

/** Layer items (posts, deadlines, payments, dates) are read-only on the grid. */
const ehCamada = (ev: { extendedProps?: Record<string, unknown> } | null | undefined) =>
  ev?.extendedProps?.camada !== undefined;

/** Drags may not cross between the all-day row and the time grid: FullCalendar
 *  then drops the end (allDayMaintainDuration is off) and dia_inteiro is a
 *  series-level field the drag payload never carries. Layer items never move. */
export function permitirArraste(
  span: { allDay: boolean },
  ev: { allDay: boolean; extendedProps?: Record<string, unknown> } | null,
): boolean {
  return !ev || (!ehCamada(ev) && span.allDay === ev.allDay);
}

/** Chip of a layer item: its icon in the layer ink, the time for posts, the title. */
function ConteudoDaCamada({ arg, item }: { arg: EventContentArg; item: CamadaItem }) {
  const { start, title } = arg.event;
  return (
    <div className="agenda-ev__linha agenda-camada__linha">
      <IconeDaCamada
        item={item}
        className="agenda-camada__icone"
        size={12}
        strokeWidth={2}
        style={{ color: arg.borderColor }}
        aria-hidden="true"
      />
      {item.camada === 'posts' && start && <span className="agenda-ev__hora">{hora(start)}</span>}
      <span className="agenda-ev__titulo">{title}</span>
    </div>
  );
}

export function ConteudoDoEvento({ arg }: { arg: EventContentArg }) {
  const { t } = useTranslation('agenda');
  const camada = arg.event.extendedProps.camada as CamadaItem | undefined;
  if (camada) return <ConteudoDaCamada arg={arg} item={camada} />;
  // Undefined for the selectMirror placeholder and the quick-create draft chip.
  const o = arg.event.extendedProps.ocorrencia as AgendaOcorrencia | undefined;
  const { start, end, allDay, title } = arg.event;
  const mes = arg.view.type === 'dayGridMonth';
  const horario =
    !allDay && start
      ? end && !mes
        ? t('view.timeRange', { start: hora(start), end: hora(end) })
        : hora(start)
      : '';
  const detalhe = [horario, !mes && o?.local ? o.local : ''].filter(Boolean).join(' · ');

  if (mes || allDay) {
    return (
      <div className="agenda-ev__linha">
        {o && !o.mascarado && (
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
        {o && !o.mascarado && (
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

function CabecalhoDoDia({ arg }: { arg: DayHeaderContentArg }) {
  const { t } = useTranslation('agenda');
  // `dow`, not arg.date: month headers carry a 1970 UTC placeholder date.
  const semana = t(`view.weekdayShort.${arg.dow}`);
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
  /** Absent for roles without calendario:editar: select-to-create is off. */
  onSelect?: (inicio: Date, fim: Date, diaInteiro: boolean) => void;
  onEventClick: (o: AgendaOcorrencia, el: HTMLElement) => void;
  /** Click on a layer item chip (extendedProps.camada). */
  onCamadaClick?: (item: CamadaItem, el: HTMLElement) => void;
  onMover: (o: AgendaOcorrencia, novoInicio: Date, novoFim: Date, revert: () => void) => void;
  /** The parent gives the card a fixed height: every view fills it and scrolls
   *  inside (the time grid scrolls its hours, the list its rows). */
  preencher?: boolean;
  /** Phones: no toolbar (AgendaTab's header has the period controls) and FullCalendar
   *  only for the Dia view. */
  semToolbar?: boolean;
  /** Honoured at mount only (FullCalendar): where a remount lands. */
  initialView?: AgendaViewType;
  initialDate?: Date;
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
  onCamadaClick,
  onMover,
  preencher = false,
  semToolbar = false,
  initialView,
  initialDate,
}: AgendaViewProps) {
  const { t } = useTranslation('agenda');
  const intlLocale = useIntlLocale();
  const api = () => calRef.current?.getApi();
  // Read once: FullCalendar re-applies scrollTime whenever the option changes.
  const [scrollTime] = useState(() => format(new Date(), 'HH:00:00'));
  // Mount-time only, like FullCalendar reads them: later changes must not re-render it.
  const [vistaInicial] = useState(() => initialView ?? (isMobile ? 'listWeek' : 'timeGridWeek'));
  const [dataInicial] = useState(initialDate);
  const opcoes = (isMobile ? VIEW_OPTIONS.filter((v) => v !== 'timeGridWeek') : VIEW_OPTIONS).map(
    (value) => ({ value, label: t(`view.${VIEW_KEY[value]}`) }),
  );
  const nav = NAV_LABELS[view];

  return (
    <section className="agenda-view" aria-label={titulo || t('view.sectionLabel')}>
      {!semToolbar && (
        <div className="agenda-toolbar">
          <div className="agenda-toolbar__nav">
            <Button type="button" variant="outline" size="sm" onClick={() => api()?.today()}>
              {t('view.today')}
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
            aria-label={t('view.viewLabel')}
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
      )}

      <div className="agenda-fc">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          // FullCalendar ships English as its built-in default locale.
          locale={intlLocale === 'en-US' ? 'en' : ptBrLocale}
          initialView={vistaInicial}
          initialDate={dataInicial}
          headerToolbar={false}
          firstDay={1}
          nowIndicator
          selectable={onSelect !== undefined}
          selectMirror
          dayMaxEvents
          slotMinTime="06:00:00"
          scrollTime={scrollTime}
          height={preencher ? '100%' : alturaDaVisao(view, isMobile)}
          allDayText={t('view.allDay')}
          noEventsText={t('view.noEvents')}
          moreLinkText={(n) => t('view.moreLink', { n })}
          defaultRangeSeparator={t('view.rangeSeparator')}
          titleRangeSeparator={t('view.rangeSeparator')}
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          // Month chips as tinted blocks like the week grid (default is a dot row).
          eventDisplay="block"
          // `ordem` first: Agenda events (and the draft, both 0), then posts,
          // deadlines, payments, client dates, commemorative dates. Then the
          // default order with the draft chip first, so dayMaxEvents never folds
          // it into "+N mais". No leading "-": FullCalendar sorts a defined field
          // before an undefined one, and "-" would flip that to last.
          eventOrder="ordem,rascunho,start,-duration,allDay,title"
          events={eventos}
          datesSet={onDatesSet}
          select={(arg) => onSelect?.(arg.start, arg.end, arg.allDay)}
          eventClick={(arg: EventClickArg) => {
            arg.jsEvent.preventDefault();
            const camada = arg.event.extendedProps.camada as CamadaItem | undefined;
            if (camada) {
              onCamadaClick?.(camada, arg.el);
              return;
            }
            // The quick-create draft chip carries no occurrence.
            const o = arg.event.extendedProps.ocorrencia as AgendaOcorrencia | undefined;
            if (!o) return;
            onEventClick(o, arg.el);
          }}
          eventDrop={(arg: EventDropArg) => {
            const o = arg.event.extendedProps.ocorrencia as AgendaOcorrencia | undefined;
            if (!o || ehCamada(arg.event)) return arg.revert();
            onMover(o, arg.event.start!, arg.event.end ?? arg.event.start!, arg.revert);
          }}
          eventResize={(arg: EventResizeDoneArg) => {
            const o = arg.event.extendedProps.ocorrencia as AgendaOcorrencia | undefined;
            if (!o || ehCamada(arg.event)) return arg.revert();
            onMover(o, arg.event.start!, arg.event.end!, arg.revert);
          }}
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
