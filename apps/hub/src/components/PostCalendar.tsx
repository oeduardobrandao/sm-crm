import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CONTENT_FORMAT_LABELS, type ContentFormat } from '@mesaas/platforms';
import { clientStatusOf } from '../lib/postView';
import type { HubAgendaItem, HubPost } from '../types';
import { StatusPill } from './StatusPill';
import { useHubLook } from '../hooks/useHubLook';
import { localeDe, selo } from '../pages/agenda/AgendaCardView';
import { compararInicio, diaLocal, formatarHora, somarDias } from '../pages/agenda/formatar';

// Portuguese source text kept as the `months`/`weekdaysShort` common-namespace
// keys' default values -- these are reused from `packages/i18n/locales/*/common.json`,
// not redefined in hubHome.json.
const MONTHS_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];
const WEEKDAYS_SHORT_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const TIPO_COLOR: Record<string, string> = {
  feed: '#3b82f6',
  reels: '#8b5cf6',
  stories: '#f59e0b',
  carrossel: '#10b981',
};

const STATUS_LABEL_PT: Record<string, string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Revisão interna',
  aprovado_interno: 'Aprovado interno',
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção',
  agendado: 'Agendado',
  publicado: 'Publicado',
  em_producao: 'Em produção',
};

interface Props {
  posts: HubPost[];
  /** Called with the shown month on mount and on every navigation. */
  onMonthChange?: (year: number, month: number) => void;
  /** The shown month's older posts are still loading. */
  loading?: boolean;
  /** Rendered under the header (e.g. a failed-month notice with a retry). */
  notice?: ReactNode;
  /** Shared Agenda events of the shown month. Undefined: the portal has no Agenda. */
  eventos?: HubAgendaItem[];
  /** The month's events failed to load (the posts still show). */
  eventosErro?: boolean;
  onRetryEventos?: () => void;
  onEventoClick?: (item: HubAgendaItem) => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The local days (YYYY-MM-DD, in the event's own tz) an event shows on: every day of an
 * all-day event up to its exclusive end, or the start day of a timed one.
 */
function diasDoEvento(item: HubAgendaItem): string[] {
  if (!item.dia_inteiro) return [diaLocal(item)];
  const dias = [item.data_inicio_local];
  // Bounded: a period query spans at most 45 days, so no event needs more cells than that.
  for (let d = somarDias(item.data_inicio_local, 1); d < item.data_fim_local; d = somarDias(d, 1)) {
    if (dias.length >= 62) break;
    dias.push(d);
  }
  return dias;
}

function formatTimeUTC(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function PostCalendar({
  posts,
  onMonthChange,
  loading,
  notice,
  eventos,
  eventosErro = false,
  onRetryEventos,
  onEventoClick,
}: Props) {
  const { t, i18n } = useTranslation('hubHome');
  const { t: tAgenda } = useTranslation('hubAgenda');
  const locale = localeDe(i18n.language);
  const navigate = useNavigate();

  function monthLabel(i: number) {
    return t(`months.${i}`, MONTHS_PT[i]);
  }
  function weekdayShortLabel(i: number) {
    return t(`weekdaysShort.${i}`, WEEKDAYS_SHORT_PT[i]);
  }
  function tipoLabel(tipo: string) {
    return t(`calendar.tipoLabel.${tipo}`, CONTENT_FORMAT_LABELS[tipo as ContentFormat] ?? tipo);
  }
  function statusLabel(status: string) {
    return t(`calendar.statusLabel.${status}`, STATUS_LABEL_PT[status] ?? status);
  }

  const today = new Date();
  // Posts are grouped by their scheduled_at LOCAL calendar day (see postsForDay below), and
  // the range fetch (`localMonthRange` in postView.ts) depends on that same local-day
  // bucketing to pick the month it asks the server for. "Today" is the local day too: near
  // midnight in UTC-3 the UTC date is already tomorrow.
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const pauta = useHubLook() === 'pauta';

  useEffect(() => {
    onMonthChange?.(year, month);
  }, [year, month, onMonthChange]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isSameCalMonth = month === today.getMonth() && year === today.getFullYear();

  // Leading/trailing days from the neighbouring months, rendered muted and
  // non-interactive so the grid always reads as full rectangular weeks
  // instead of trailing off into blank cells.
  const prevMonthDays = new Date(year, month, 0).getDate();
  const leadingDays = Array.from({ length: firstDay }, (_, i) => prevMonthDays - firstDay + 1 + i);
  const trailingCount = (7 - ((firstDay + daysInMonth) % 7)) % 7;
  const trailingDays = Array.from({ length: trailingCount }, (_, i) => i + 1);

  function prevMonth() {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else setMonth((m) => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else setMonth((m) => m + 1);
    setSelectedDay(null);
  }

  function postsForDay(day: number) {
    return posts.filter((p) => {
      if (!p.scheduled_at) return false;
      const d = new Date(p.scheduled_at);
      // Bucket by local calendar day so the cell a post lands in matches the local
      // date shown on its card (and the CRM calendar). Using UTC parts here would
      // place an evening post one day ahead of where its own label reads.
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
  }

  const eventosPorDia = useMemo(() => {
    const porDia = new Map<string, HubAgendaItem[]>();
    for (const item of [...(eventos ?? [])].sort(compararInicio)) {
      for (const dia of diasDoEvento(item)) {
        const lista = porDia.get(dia);
        if (lista) lista.push(item);
        else porDia.set(dia, [item]);
      }
    }
    return porDia;
  }, [eventos]);

  function eventosForDay(day: number): HubAgendaItem[] {
    return eventosPorDia.get(`${year}-${pad2(month + 1)}-${pad2(day)}`) ?? [];
  }

  const selectedPosts = selectedDay ? postsForDay(selectedDay) : [];
  const selectedEventos = selectedDay ? eventosForDay(selectedDay) : [];
  const agora = Date.now();

  return (
    <div>
      {/* On mobile this sits directly inside the page's own "Calendário" card, so it
          drops its own card chrome — nesting two bordered cards double-padded the
          grid and squeezed the day cells. `hub-card` is hand-written CSS (no `md:`
          variant support), hence the explicit arbitrary-value form. */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] overflow-hidden md:rounded-xl md:border md:border-[var(--hub-bd)] md:bg-[var(--hub-card)]">
        {/* Left: calendar grid */}
        <div className="p-0 md:p-6">
          {/* Header — mobile: month centered between two standalone nav buttons */}
          <div className="flex items-center justify-between mb-5 md:hidden">
            <button
              onClick={prevMonth}
              aria-label={t('calendar.prevMonth', 'Mês anterior')}
              className="w-10 h-10 flex items-center justify-center rounded-2xl border hub-border hub-txt active:scale-95 transition-transform"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="text-center">
              <h2 className="font-display text-[19px] font-semibold tracking-tight hub-txt leading-none capitalize">
                {monthLabel(month)}
              </h2>
              <p className="text-[12.5px] hub-tx3 mt-0.5">{year}</p>
            </div>
            <button
              onClick={nextMonth}
              aria-label={t('calendar.nextMonth', 'Próximo mês')}
              className="w-10 h-10 flex items-center justify-center rounded-2xl border hub-border hub-txt active:scale-95 transition-transform"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Header — desktop */}
          <div className="hidden md:flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-[20px] font-semibold tracking-tight hub-txt leading-none">
                {t('calendar.title', 'Postagens')}
              </h2>
              <p className="text-[12.5px] hub-tx2 mt-1">
                <span className="capitalize">{monthLabel(month)}</span> {year}
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-full hub-bg-soft">
              <button
                onClick={prevMonth}
                aria-label={t('calendar.prevMonth', 'Mês anterior')}
                className="w-7 h-7 flex items-center justify-center rounded-full hub-tx2 hover:bg-[var(--hub-card)] hover:text-[var(--hub-txt)] hover:shadow-sm transition-all"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={nextMonth}
                aria-label={t('calendar.nextMonth', 'Próximo mês')}
                className="w-7 h-7 flex items-center justify-center rounded-full hub-tx2 hover:bg-[var(--hub-card)] hover:text-[var(--hub-txt)] hover:shadow-sm transition-all"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          {notice}

          {/* Weekday labels — mixed case + light tracking on mobile, matching the reference */}
          <div className="grid grid-cols-7 mb-1 md:mb-2">
            {WEEKDAYS_SHORT_PT.map((d, i) => (
              <div
                key={d}
                className="text-center text-[12px] md:text-[12px] font-medium md:font-semibold tracking-normal md:uppercase md:tracking-[0.12em] hub-tx3 py-1"
              >
                {weekdayShortLabel(i)}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div
            data-testid="post-calendar-grid"
            aria-busy={loading ? 'true' : undefined}
            className={`grid grid-cols-7 gap-x-0 gap-y-0.5 md:gap-1.5${loading ? ' opacity-60 transition-opacity' : ''}`}
          >
            {leadingDays.map((d) => (
              <div
                key={`lead-${d}`}
                aria-hidden="true"
                className="min-h-[54px] md:min-h-[88px] p-1 md:p-2 flex flex-col items-center md:items-start"
              >
                <div className="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center text-[14px] md:text-[12px] font-semibold hub-tx3 opacity-50">
                  {d}
                </div>
              </div>
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayPosts = postsForDay(day);
              const dayEventos = eventosForDay(day);
              const isToday = day === today.getDate() && isSameCalMonth;
              const isSelected = selectedDay === day;

              const byTipo: Record<string, number> = {};
              for (const p of dayPosts) {
                byTipo[p.tipo] = (byTipo[p.tipo] || 0) + 1;
              }

              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={isSelected}
                  className={`min-h-[54px] md:min-h-[88px] p-1 md:p-2 rounded-[var(--hub-r-ctl)] flex flex-col items-center md:items-start md:text-left transition-colors ${
                    isSelected
                      ? 'md:bg-[color-mix(in_srgb,var(--hub-acc)_10%,transparent)]'
                      : 'hover:bg-[var(--hub-soft)]'
                  }`}
                >
                  {/* The selected/today affordance lives on the number chip itself —
                      highlighting the whole cell stretches into a tall pill once the
                      cell grows to fit its posts. */}
                  {/* rounded-[13px] (not the --hub-r-ctl token): the radius preset
                      deliberately skips this site to keep the neutral default
                      byte-identical to pre-customization. */}
                  <div
                    className={`w-9 h-9 md:w-7 md:h-7 mb-0.5 md:mb-1.5 flex items-center justify-center rounded-[13px] md:rounded-full text-[14px] md:text-[12px] font-semibold transition-colors ${
                      isSelected || isToday ? '' : 'text-[var(--hub-txt)] md:text-[var(--hub-tx2)]'
                    }`}
                    style={
                      pauta
                        ? isSelected
                          ? { background: 'var(--hub-primary)', color: 'var(--hub-primary-fg)' }
                          : isToday
                            ? {
                                boxShadow: 'inset 0 0 0 1.5px var(--hub-primary)',
                                color: 'var(--hub-txt)',
                              }
                            : undefined
                        : isSelected
                          ? { background: 'var(--hub-acc)', color: 'var(--hub-acc-fg)' }
                          : isToday
                            ? {
                                boxShadow: 'inset 0 0 0 1.5px var(--hub-acc)',
                                color: 'var(--hub-acc)',
                              }
                            : undefined
                    }
                  >
                    {day}
                  </div>

                  {/* Mobile: one dot per post (capped), colored by type — the cells are
                      far too narrow for the desktop text pills, which truncated to a
                      bare digit. */}
                  <div
                    data-testid="post-calendar-dots"
                    className="flex items-center justify-center gap-[3px] h-[5px] md:hidden"
                  >
                    {/* The day's events share one dot, always first; three dots at most. */}
                    {[
                      ...(dayEventos.length > 0
                        ? [{ key: 'eventos', kind: 'evento', color: 'var(--hub-acc)' }]
                        : []),
                      ...dayPosts.map((p) => ({
                        key: `post-${p.id}`,
                        kind: 'post',
                        color: TIPO_COLOR[p.tipo] ?? '#78716c',
                      })),
                    ]
                      .slice(0, 3)
                      .map((dot) => (
                        <span
                          key={dot.key}
                          data-kind={dot.kind}
                          className="w-[5px] h-[5px] rounded-full"
                          style={{ background: dot.color }}
                        />
                      ))}
                  </div>

                  {/* Desktop: full type + count pill, room to spare */}
                  <div
                    data-testid="post-calendar-pills"
                    className="hidden md:flex md:flex-col gap-1 w-full"
                  >
                    {dayEventos.length > 0 && (
                      <div
                        className="text-[12px] px-1.5 py-[2px] rounded-md font-semibold leading-none truncate border"
                        style={{
                          background: 'color-mix(in srgb, var(--hub-acc) 10%, transparent)',
                          borderColor: 'color-mix(in srgb, var(--hub-acc) 45%, transparent)',
                          color: 'var(--hub-acc)',
                        }}
                      >
                        {t('calendar.eventosCount', '{{count}} eventos', {
                          count: dayEventos.length,
                        })}
                      </div>
                    )}
                    {Object.entries(byTipo).map(([tipo, count]) => (
                      // rounded-md (not the --hub-r-ctl token): the radius preset
                      // deliberately skips this site to keep the neutral default
                      // byte-identical to pre-customization.
                      <div
                        key={tipo}
                        className="text-[12px] px-1.5 py-[3px] rounded-md font-semibold leading-none truncate"
                        style={{
                          background: `${TIPO_COLOR[tipo] ?? '#78716c'}1c`,
                          color: TIPO_COLOR[tipo] ?? '#78716c',
                        }}
                      >
                        {count} {tipoLabel(tipo)}
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
            {trailingDays.map((d) => (
              <div
                key={`trail-${d}`}
                aria-hidden="true"
                className="min-h-[54px] md:min-h-[88px] p-1 md:p-2 flex flex-col items-center md:items-start"
              >
                <div className="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center text-[14px] md:text-[12px] font-semibold hub-tx3 opacity-50">
                  {d}
                </div>
              </div>
            ))}
          </div>

          {/* Decorative divider handle, mobile only — mirrors the reference's bottom-sheet grabber */}
          <div className="flex justify-center pt-4 md:hidden">
            <span className="w-9 h-1 rounded-full" style={{ background: 'var(--hub-bd2)' }} />
          </div>
        </div>

        {/* Right: side panel. `hub-bg-soft` is a hand-written class, so a `md:`
            variant would silently no-op — use the arbitrary-value form instead. */}
        <div className="md:border-l hub-border p-0 pt-1 md:p-6 md:bg-[var(--hub-soft)]">
          <div className="mb-4 hidden md:block">
            <h3 className="font-display text-[15px] font-semibold tracking-tight hub-txt">
              {t('calendar.title', 'Postagens')}
            </h3>
            <p className="text-[12px] hub-tx2 mt-0.5">
              {selectedDay
                ? t('calendar.selectedDateLabel', '{{day}} de {{month}}, {{year}}', {
                    day: selectedDay,
                    month: monthLabel(month),
                    year,
                  })
                : t('calendar.monthYearLabel', '{{month}} {{year}}', {
                    month: monthLabel(month),
                    year,
                  })}
            </p>
          </div>

          {eventosErro && (
            <p
              role="status"
              className="mb-3 flex flex-wrap items-center gap-x-2 text-[12.5px] hub-tx2"
            >
              {t('calendar.eventosErro', 'Não foi possível carregar os eventos.')}
              <button
                type="button"
                onClick={onRetryEventos}
                className="font-semibold underline hub-txt"
              >
                {t('calendar.eventosRetry', 'Tentar novamente')}
              </button>
            </p>
          )}

          {selectedEventos.length > 0 && (
            <section className="mb-4">
              <h4 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] hub-tx3">
                {t('calendar.eventos', 'Eventos')}
              </h4>
              <div className="flex flex-col gap-2">
                {selectedEventos.map((ev) => {
                  const s = selo(ev, Date.parse(ev.fim) <= agora, tAgenda);
                  return (
                    <button
                      key={ev.ocorrencia_id}
                      type="button"
                      onClick={() => onEventoClick?.(ev)}
                      className="text-left rounded-2xl md:rounded-xl border hub-border bg-[var(--hub-card)] p-3.5 flex flex-col gap-1.5 hover:border-[var(--hub-bd2)] hover:shadow-sm transition-all"
                      style={{ borderLeft: '3px solid var(--hub-acc)' }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold hub-tx2">
                          {ev.dia_inteiro
                            ? t('calendar.diaInteiro', 'Dia inteiro')
                            : formatarHora(ev.inicio, ev.tz, locale)}
                        </span>
                        <StatusPill tone={s.tone} semantic={s.semantic}>
                          {s.texto}
                        </StatusPill>
                      </span>
                      <span className="text-[13.5px] font-semibold leading-snug hub-txt break-words">
                        {ev.titulo}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {selectedEventos.length > 0 && (
            <h4 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] hub-tx3">
              {t('calendar.posts', 'Posts')}
            </h4>
          )}

          {selectedPosts.length === 0 ? (
            <div
              className={`${selectedEventos.length > 0 ? 'py-3' : 'py-10'} text-center hub-tx3 text-[13px]`}
            >
              {selectedDay
                ? t('calendar.noPostsThisDay', 'Nenhuma postagem neste dia.')
                : t('calendar.selectADay', 'Selecione um dia.')}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5 md:gap-3">
              {selectedPosts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate(`postagens/${p.id}`)}
                  className="text-left rounded-2xl md:rounded-xl md:border hub-border bg-[var(--hub-soft)] md:bg-[var(--hub-card)] p-3.5 space-y-1 md:space-y-2 hover:border-[var(--hub-bd2)] hover:shadow-sm transition-all"
                >
                  {/* Mobile: colored dot + time, no status/type text */}
                  <div className="flex items-center gap-2 md:hidden">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: TIPO_COLOR[p.tipo] ?? '#78716c' }}
                    />
                    <span className="text-[12px] font-semibold hub-tx2">
                      {p.scheduled_at ? formatTimeUTC(p.scheduled_at) : '—'}
                    </span>
                  </div>

                  {/* Desktop: type + status pills */}
                  <div className="hidden md:flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-[12px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: `${TIPO_COLOR[p.tipo] ?? '#78716c'}1c`,
                        color: TIPO_COLOR[p.tipo] ?? '#78716c',
                      }}
                    >
                      {tipoLabel(p.tipo)}
                    </span>
                    <span className="text-[12px] hub-tx2 px-2 py-0.5 rounded-full hub-bg-soft">
                      {statusLabel(clientStatusOf(p))}
                    </span>
                  </div>

                  <p className="text-[13.5px] font-semibold leading-snug hub-txt">{p.titulo}</p>

                  {p.conteudo_plain && (
                    <p className="text-[12px] hub-tx2 truncate md:hidden">{p.conteudo_plain}</p>
                  )}

                  {p.scheduled_at && (
                    <p className="hidden md:block text-[12px] hub-tx2">
                      {new Date(p.scheduled_at).toLocaleDateString(
                        i18n.language === 'en' ? 'en-US' : 'pt-BR',
                        {
                          day: '2-digit',
                          month: 'long',
                          year: 'numeric',
                        },
                      )}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
