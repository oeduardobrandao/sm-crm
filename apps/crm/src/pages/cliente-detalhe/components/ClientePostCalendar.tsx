import { isSameDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { MonthGrid } from '@/components/ui/month-grid';
import type { WorkflowPost } from '@/store';

/** One scheduled post plotted on the client's delivery calendar. */
export interface PostCalendarEvent {
  postId: number;
  postTitle: string;
  workflowId: number;
  workflowTitle: string;
  date: Date;
  tipo: WorkflowPost['tipo'];
  status: WorkflowPost['status'];
}

/**
 * A single day cell on the client post calendar — ported verbatim (including
 * export, previously used directly by the pre-split ClienteDetalhePage's own
 * tests) from the pre-split ClienteDetalhePage (see git history at
 * d30adeea), moved here per the Entregas tab task.
 */
export function ClientCalendarDayButton({
  date,
  dateLocale,
  selected,
  today,
  hasEvents,
  onSelect,
  children,
}: {
  date: Date;
  dateLocale: string;
  selected: boolean;
  today: boolean;
  hasEvents: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`calendar-day ${today ? 'today' : ''} ${selected ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}`}
      type="button"
      aria-label={date.toLocaleDateString(dateLocale, { dateStyle: 'long' })}
      aria-pressed={selected}
      aria-current={today ? 'date' : undefined}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

/** Dedicated "open" action for a scheduled-post card, ported verbatim (see above). */
export function ScheduledPostOpenButton({
  postTitle,
  label,
  onOpen,
}: {
  postTitle: string;
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="scheduled-item__open"
      aria-label={`${label}: ${postTitle}`}
      onClick={onOpen}
    >
      {label}
    </button>
  );
}

interface ClientePostCalendarProps {
  /** Scheduled-post events for all active workflows. Owned by EntregasTab so a
   *  single refresh (advance/revert/status update) can update both the board
   *  and the calendar together — see EntregasTab's `refreshPostCalendar`. */
  events: PostCalendarEvent[];
  calendarMonth: Date;
  onMonthChange: (date: Date) => void;
  selectedPostDay: number | null;
  onSelectDay: (day: number) => void;
  /** Post id currently being mutated by a status-update button, if any. */
  postUpdating: number | null;
  onPostStatusUpdate: (postId: number, newStatus: 'agendado' | 'postado') => void;
  /** Opens the WorkflowDrawer for the workflow owning a scheduled post. */
  onOpenCard: (workflowId: number) => void;
}

/**
 * Client-scoped post delivery calendar — ported verbatim from the pre-split
 * ClienteDetalhePage's "Post Calendar" block (see git history at d30adeea),
 * extracted into its own component per the Entregas tab task. Renders nothing
 * when there are no scheduled-post events, matching the historical
 * `postCalendarEvents.length > 0 && (...)` gate exactly.
 */
export function ClientePostCalendar({
  events,
  calendarMonth,
  onMonthChange,
  selectedPostDay,
  onSelectDay,
  postUpdating,
  onPostStatusUpdate,
  onOpenCard,
}: ClientePostCalendarProps) {
  const { t, i18n } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const dateLocale = i18n.language === 'en' ? 'en-US' : 'pt-BR';

  if (events.length === 0) return null;

  const calYear = calendarMonth.getFullYear();
  const calMonth = calendarMonth.getMonth();
  const monthNamesLocal = Array.from({ length: 12 }, (_, i) => tc(`months.${i}`));

  const tipoColors: Record<string, string> = {
    feed: '#3b82f6',
    reels: '#8b5cf6',
    stories: '#f59e0b',
    carrossel: '#10b981',
  };
  const tipoLabels: Record<string, string> = {
    feed: t('detail.postType.feed'),
    reels: t('detail.postType.reels'),
    stories: t('detail.postType.stories'),
    carrossel: t('detail.postType.carrossel'),
  };

  const selectedEvents = selectedPostDay
    ? events.filter(
        (e) =>
          e.date.getFullYear() === calYear &&
          e.date.getMonth() === calMonth &&
          e.date.getDate() === selectedPostDay,
      )
    : [];

  return (
    <div
      style={{
        marginTop: '1rem',
        borderTop: '1px solid var(--border-color)',
        paddingTop: '1rem',
      }}
    >
      <div className="calendar-layout cliente-post-calendar">
        <div className="calendar-main">
          <MonthGrid
            currentMonth={calendarMonth}
            onMonthChange={(d) => {
              onMonthChange(d);
            }}
            renderCell={(date, isCurrentMonth) => {
              if (!isCurrentMonth) return <div className="calendar-day empty" />;
              const d = date.getDate();
              const dayEvents = events.filter((e) => isSameDay(e.date, date));
              const hasEvents = dayEvents.length > 0;
              const isDayToday = isSameDay(date, new Date());
              const byTipo: Record<string, number> = {};
              for (const ev of dayEvents) {
                byTipo[ev.tipo] = (byTipo[ev.tipo] || 0) + 1;
              }
              return (
                <ClientCalendarDayButton
                  date={date}
                  dateLocale={dateLocale}
                  selected={selectedPostDay === d}
                  today={isDayToday}
                  hasEvents={hasEvents}
                  onSelect={() => onSelectDay(d)}
                >
                  <span className="day-number">{d}</span>
                  <div className="day-events">
                    {Object.entries(byTipo).map(([tipo, count]) => (
                      <div
                        key={tipo}
                        className="event-pill"
                        style={{
                          background: `${tipoColors[tipo]}18`,
                          color: tipoColors[tipo],
                          fontWeight: 600,
                        }}
                      >
                        {count} {tipoLabels[tipo] || tipo}
                      </div>
                    ))}
                  </div>
                </ClientCalendarDayButton>
              );
            }}
          />
        </div>

        <div className="scheduled-panel">
          <div className="scheduled-header">
            <h3>{t('detail.posts')}</h3>
            <p>
              {selectedPostDay
                ? t('detail.dayOf', {
                    day: selectedPostDay,
                    month: `${monthNamesLocal[calMonth]}, ${calYear}`,
                  })
                : `${monthNamesLocal[calMonth]} ${calYear}`}
            </p>
          </div>
          <div className="scheduled-list">
            {selectedEvents.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '2rem 0',
                  color: 'var(--text-muted)',
                }}
              >
                <p>{selectedPostDay ? t('detail.noPostsThisDay') : t('detail.selectDay')}</p>
              </div>
            ) : (
              selectedEvents.map((ev, i) => (
                <article key={i} className="scheduled-item">
                  <div className="item-top">
                    <div
                      className="item-badge"
                      style={{ background: tipoColors[ev.tipo] || '#6b7280' }}
                    />
                    <span
                      className="badge"
                      style={{
                        fontSize: '0.65rem',
                        background: `${tipoColors[ev.tipo]}18`,
                        color: tipoColors[ev.tipo],
                      }}
                    >
                      {(tipoLabels[ev.tipo] || ev.tipo).toUpperCase()}
                    </span>
                  </div>
                  <div className="item-title">{ev.postTitle}</div>
                  <div className="item-subtitle">{ev.workflowTitle}</div>
                  <div className="item-divider" />
                  <div className="item-meta">{ev.date.toLocaleDateString(dateLocale)}</div>
                  <ScheduledPostOpenButton
                    postTitle={ev.postTitle}
                    label={t('instagram.openPost')}
                    onOpen={() => onOpenCard(ev.workflowId)}
                  />
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      marginTop: '0.6rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    {/* Chip 1: Aprovado (read-only) */}
                    {ev.status === 'aprovado_interno' ||
                    ev.status === 'aprovado_cliente' ||
                    ev.status === 'agendado' ||
                    ev.status === 'postado' ? (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          background: '#dbeafe',
                          color: '#1e40af',
                          border: '1px solid #93c5fd44',
                          padding: '2px 8px',
                          borderRadius: '4px',
                        }}
                      >
                        ✓ {t('detail.approved')}
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          background: 'var(--surface-2)',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-color)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                        }}
                      >
                        {t(`detail.postStatus.${ev.status}`, {
                          defaultValue: ev.status,
                        })}
                      </span>
                    )}

                    {/* Separator */}
                    {(ev.status === 'aprovado_interno' ||
                      ev.status === 'aprovado_cliente' ||
                      ev.status === 'agendado' ||
                      ev.status === 'postado') && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>→</span>
                    )}

                    {/* Chip 2: Agendar */}
                    {(ev.status === 'aprovado_interno' || ev.status === 'aprovado_cliente') && (
                      <button
                        type="button"
                        onClick={() => {
                          onPostStatusUpdate(ev.postId, 'agendado');
                        }}
                        disabled={postUpdating !== null}
                        style={{
                          fontSize: '0.68rem',
                          background: '#eff6ff',
                          color: '#2563eb',
                          border: '1px solid #3b82f6',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        {postUpdating === ev.postId ? '...' : `○ ${t('detail.schedule')}`}
                      </button>
                    )}
                    {(ev.status === 'agendado' || ev.status === 'postado') && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          background: '#ccfbf1',
                          color: '#0f766e',
                          border: '1px solid #5eead444',
                          padding: '2px 8px',
                          borderRadius: '4px',
                        }}
                      >
                        ✓ {t('detail.scheduled')}
                      </span>
                    )}

                    {/* Separator */}
                    {(ev.status === 'agendado' || ev.status === 'postado') && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>→</span>
                    )}

                    {/* Chip 3: Postado */}
                    {ev.status === 'agendado' && (
                      <button
                        type="button"
                        onClick={() => {
                          onPostStatusUpdate(ev.postId, 'postado');
                        }}
                        disabled={postUpdating !== null}
                        style={{
                          fontSize: '0.68rem',
                          background: '#f0fdf4',
                          color: '#15803d',
                          border: '1px solid #22c55e',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        {postUpdating === ev.postId ? '...' : `○ ${t('detail.markPosted')}`}
                      </button>
                    )}
                    {ev.status === 'postado' && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          background: '#dcfce7',
                          color: '#15803d',
                          border: '1px solid #22c55e',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontWeight: 700,
                        }}
                      >
                        ✓ {t('detail.posted')}
                      </span>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="cliente-post-calendar__legend">
        {Object.entries(tipoColors).map(([tipo, color]) => (
          <span key={tipo} className="cliente-post-calendar__legend-item">
            <span className="cliente-post-calendar__legend-marker" style={{ background: color }} />
            {tipoLabels[tipo] || tipo}
          </span>
        ))}
      </div>
    </div>
  );
}
