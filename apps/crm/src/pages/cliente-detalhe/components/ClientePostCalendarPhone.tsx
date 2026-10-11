import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameDay,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { CONTENT_FORMAT_LABELS } from '@mesaas/platforms';
import { cn } from '@/lib/utils';
import { GroupedList } from '@/components/mobile/GroupedList';
import type { ClientePostCalendarProps } from './ClientePostCalendar';
import '@/pages/entregas/phone/viewsPhone.css';
import '../phone/clienteDetalhePhone.css';

const WEEK_DAYS = [
  { short: 'S', long: 'segunda' },
  { short: 'T', long: 'terça' },
  { short: 'Q', long: 'quarta' },
  { short: 'Q', long: 'quinta' },
  { short: 'S', long: 'sexta' },
  { short: 'S', long: 'sábado' },
  { short: 'D', long: 'domingo' },
];

/** Same colours as the desktop calendar's pills, one per content format. */
const TIPO_COLORS: Record<string, string> = {
  feed: '#3b82f6',
  reels: '#8b5cf6',
  stories: '#f59e0b',
  carrossel: '#10b981',
};

function monthCells(month: Date): (Date | null)[] {
  const start = startOfMonth(month);
  const lead = (getDay(start) + 6) % 7; // Monday first, like the desktop MonthGrid
  const days = eachDayOfInterval({ start, end: endOfMonth(month) });
  return [...Array.from({ length: lead }, () => null), ...days];
}

const APPROVED = new Set(['aprovado_interno', 'aprovado_cliente', 'agendado', 'postado']);

/**
 * The client's post calendar below 768px: the Entregas phone calendar's compact month
 * (one dot per post, coloured by format) over the selected day's posts. Same contract as
 * `ClientePostCalendar` — renders nothing without events, opens a post through
 * `onOpenPost`, and keeps the Agendar / Marcar postado steps of the desktop panel.
 */
export function ClientePostCalendarPhone({
  events,
  calendarMonth,
  onMonthChange,
  selectedPostDay,
  onSelectDay,
  postUpdating,
  onPostStatusUpdate,
  onOpenPost,
}: ClientePostCalendarProps) {
  const { t } = useTranslation('clients');

  if (events.length === 0) return null;

  const tipoLabels: Record<string, string> = {
    feed: t('detail.contentFormat.feed', CONTENT_FORMAT_LABELS.feed),
    reels: t('detail.contentFormat.reels', CONTENT_FORMAT_LABELS.reels),
    stories: t('detail.contentFormat.stories', CONTENT_FORMAT_LABELS.stories),
    carrossel: t('detail.contentFormat.carrossel', CONTENT_FORMAT_LABELS.carrossel),
  };

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const monthName = format(calendarMonth, 'MMMM', { locale: ptBR });
  const today = new Date();
  const selectedDate = selectedPostDay != null ? new Date(year, month, selectedPostDay) : null;
  const selectedEvents = selectedDate ? events.filter((e) => isSameDay(e.date, selectedDate)) : [];

  return (
    <section className="phone-ent-v phone-cli-cal" aria-label={t('detail.posts')}>
      <div className="phone-ent-v-cal">
        <div className="phone-ent-v-cal__head">
          <h2 className="phone-ent-v-cal__month">
            {format(calendarMonth, 'MMMM yyyy', { locale: ptBR })}
          </h2>
          <span className="phone-ent-v-cal__nav">
            <button
              type="button"
              className="phone-ent-v-round-btn"
              aria-label="Mês anterior"
              onClick={() => onMonthChange(subMonths(calendarMonth, 1))}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              className="phone-ent-v-round-btn"
              aria-label="Próximo mês"
              onClick={() => onMonthChange(addMonths(calendarMonth, 1))}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="phone-ent-v-cal__weekdays" aria-hidden="true">
          {WEEK_DAYS.map((d) => (
            <span key={d.long}>{d.short}</span>
          ))}
        </div>
        <div className="phone-ent-v-cal__grid">
          {monthCells(calendarMonth).map((date, i) => {
            if (!date) return <span key={`blank-${i}`} />;
            const d = date.getDate();
            const dayEvents = events.filter((e) => isSameDay(e.date, date));
            const selected = selectedPostDay === d;
            const label =
              dayEvents.length > 0
                ? `, ${dayEvents.length} ${dayEvents.length === 1 ? 'post' : 'posts'}`
                : '';
            return (
              <button
                key={d}
                type="button"
                className={cn(
                  'phone-ent-v-cal__day',
                  isSameDay(date, today) && 'phone-ent-v-cal__day--today',
                  selected && 'phone-ent-v-cal__day--selected',
                )}
                aria-pressed={selected}
                aria-label={`${d} de ${monthName}${label}`}
                onClick={() => onSelectDay(d)}
              >
                {d}
                <span className="phone-ent-v-cal__dots" aria-hidden="true">
                  {dayEvents.slice(0, 3).map((ev, j) => (
                    <i
                      key={j}
                      className="phone-ent-v-dot"
                      style={{ background: TIPO_COLORS[ev.tipo] ?? 'var(--phone-label-secondary)' }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedEvents.length === 0 ? (
        <p className="phone-ent-v-empty">
          {selectedDate ? t('detail.noPostsThisDay') : t('detail.selectDay')}
        </p>
      ) : (
        <GroupedList
          header={selectedDate ? format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR }) : null}
          className="phone-ent-v-group"
        >
          {selectedEvents.map((ev) => {
            const tipoLabel = tipoLabels[ev.tipo] || ev.tipo;
            const busy = postUpdating === ev.postId;
            return (
              <li key={ev.postId} className="phone-cell phone-ent-v-cal-item">
                <button
                  type="button"
                  className="phone-ent-v-cal-item__main"
                  aria-label={`${t('instagram.openPost')}: ${ev.postTitle}`}
                  onClick={() => onOpenPost(ev.postId, ev.workflowId)}
                >
                  <i
                    className="phone-ent-v-dot phone-ent-v-dot--lg"
                    style={{ background: TIPO_COLORS[ev.tipo] ?? 'var(--phone-label-secondary)' }}
                    aria-hidden="true"
                  />
                  <span className="phone-ent-v-cal-item__text">
                    <span className="phone-ent-v-cal-item__client">
                      <span className="phone-ent-v-cal-item__client-name">
                        {ev.workflowTitle ?? t('detail.standalonePost')}
                      </span>
                      <span className="phone-ent-v-cal-item__tipo">{tipoLabel}</span>
                    </span>
                    <span className="phone-ent-v-cal-item__title">{ev.postTitle}</span>
                  </span>
                </button>
                <div className="phone-ent-v-cal-item__actions phone-cli-cal__actions">
                  {APPROVED.has(ev.status) ? (
                    <span className="phone-cli-chip" data-tone="success">
                      <Check aria-hidden="true" className="phone-cli-chip__icon" />
                      {t('detail.approved')}
                    </span>
                  ) : (
                    <span className="phone-cli-chip">
                      {t(`detail.postStatus.${ev.status}`, { defaultValue: ev.status })}
                    </span>
                  )}
                  {(ev.status === 'aprovado_interno' || ev.status === 'aprovado_cliente') && (
                    <button
                      type="button"
                      className="phone-cli-cal__step"
                      disabled={postUpdating !== null}
                      onClick={() => onPostStatusUpdate(ev.postId, 'agendado')}
                    >
                      {busy ? '...' : t('detail.schedule')}
                    </button>
                  )}
                  {ev.status === 'agendado' && (
                    <>
                      <span className="phone-cli-chip" data-tone="success">
                        {t('detail.scheduled')}
                      </span>
                      <button
                        type="button"
                        className="phone-cli-cal__step"
                        disabled={postUpdating !== null}
                        onClick={() => onPostStatusUpdate(ev.postId, 'postado')}
                      >
                        {busy ? '...' : t('detail.markPosted')}
                      </button>
                    </>
                  )}
                  {ev.status === 'postado' && (
                    <span className="phone-cli-chip" data-tone="success">
                      {t('detail.posted')}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </GroupedList>
      )}

      <p className="phone-ent-v-legend" aria-hidden="true">
        {Object.entries(TIPO_COLORS).map(([tipo, color]) => (
          <span key={tipo} className="phone-ent-v-legend__item">
            <i className="phone-ent-v-dot" style={{ background: color }} /> {tipoLabels[tipo]}
          </span>
        ))}
      </p>
    </section>
  );
}
