import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HubPost } from '../types';

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
const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const TIPO_COLOR: Record<string, string> = {
  feed: '#3b82f6',
  reels: '#8b5cf6',
  stories: '#f59e0b',
  carrossel: '#10b981',
};

const TIPO_LABEL: Record<string, string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};

const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Revisão interna',
  aprovado_interno: 'Aprovado interno',
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção',
  agendado: 'Agendado',
  publicado: 'Publicado',
};

interface Props {
  posts: HubPost[];
}

function formatTimeUTC(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function PostCalendar({ posts }: Props) {
  const navigate = useNavigate();
  const today = new Date();
  // Posts are grouped by their scheduled_at date in UTC (see postsForDay
  // below), so "today" must use the same UTC calendar day — otherwise, for
  // viewers whose local timezone differs from UTC, the highlighted "today"
  // cell and the initially selected day drift by one day from where posts
  // actually land on the grid.
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getUTCDate());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isSameCalMonth = month === today.getUTCMonth() && year === today.getUTCFullYear();

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
      return d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day;
    });
  }

  const selectedPosts = selectedDay ? postsForDay(selectedDay) : [];

  return (
    <div>
      <div className="hub-card grid grid-cols-1 md:grid-cols-[1fr_300px] overflow-hidden">
        {/* Left: calendar grid */}
        <div className="p-5 sm:p-6">
          {/* Header — mobile: month centered between two standalone nav buttons */}
          <div className="flex items-center justify-between mb-5 md:hidden">
            <button
              onClick={prevMonth}
              aria-label="Mês anterior"
              className="w-10 h-10 flex items-center justify-center rounded-2xl hub-bg-soft hub-tx2 active:scale-95 transition-transform"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="text-center">
              <h2 className="font-display text-[19px] font-semibold tracking-tight hub-txt leading-none capitalize">
                {MONTHS_PT[month]}
              </h2>
              <p className="text-[12.5px] hub-tx2 mt-1">{year}</p>
            </div>
            <button
              onClick={nextMonth}
              aria-label="Próximo mês"
              className="w-10 h-10 flex items-center justify-center rounded-2xl hub-bg-soft hub-tx2 active:scale-95 transition-transform"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Header — desktop */}
          <div className="hidden md:flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-[20px] font-semibold tracking-tight hub-txt leading-none">
                Postagens
              </h2>
              <p className="text-[12.5px] hub-tx2 mt-1">
                <span className="capitalize">{MONTHS_PT[month]}</span> {year}
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-full hub-bg-soft">
              <button
                onClick={prevMonth}
                aria-label="Mês anterior"
                className="w-7 h-7 flex items-center justify-center rounded-full hub-tx2 hover:bg-[var(--hub-card)] hover:text-[var(--hub-txt)] hover:shadow-sm transition-all"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={nextMonth}
                aria-label="Próximo mês"
                className="w-7 h-7 flex items-center justify-center rounded-full hub-tx2 hover:bg-[var(--hub-card)] hover:text-[var(--hub-txt)] hover:shadow-sm transition-all"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 mb-2">
            {DAYS_PT.map((d) => (
              <div
                key={d}
                className="text-center text-[10px] uppercase tracking-[0.12em] font-semibold hub-tx3 py-1"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[88px]" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayPosts = postsForDay(day);
              const isToday = day === today.getUTCDate() && isSameCalMonth;
              const isSelected = selectedDay === day;

              const byTipo: Record<string, number> = {};
              for (const p of dayPosts) {
                byTipo[p.tipo] = (byTipo[p.tipo] || 0) + 1;
              }

              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`min-h-[88px] p-2 rounded-xl text-left transition-all ${
                    isSelected ? '' : 'hover:bg-[var(--hub-soft)]'
                  }`}
                  style={
                    isSelected
                      ? {
                          background: 'color-mix(in srgb, var(--hub-acc) 12%, transparent)',
                          boxShadow:
                            'inset 0 0 0 1px color-mix(in srgb, var(--hub-acc) 50%, transparent)',
                        }
                      : undefined
                  }
                >
                  <div
                    className={`text-[12px] mb-1.5 w-7 h-7 flex items-center justify-center rounded-full font-semibold ${
                      isToday ? 'hub-btn-primary' : isSelected ? 'hub-txt' : 'hub-tx2'
                    }`}
                  >
                    {day}
                  </div>
                  {/* Mobile: a colored dot per post type, no text (cells are too narrow for labels) */}
                  <div className="flex items-center justify-center gap-1 md:hidden">
                    {Object.keys(byTipo).map((tipo) => (
                      <span
                        key={tipo}
                        className="w-[5px] h-[5px] rounded-full"
                        style={{ background: TIPO_COLOR[tipo] ?? '#78716c' }}
                      />
                    ))}
                  </div>

                  {/* Desktop: full type + count pill, room to spare */}
                  <div className="hidden md:flex md:flex-col gap-1">
                    {Object.entries(byTipo).map(([tipo, count]) => (
                      <div
                        key={tipo}
                        className="text-[10px] px-1.5 py-[3px] rounded-md font-semibold leading-none truncate"
                        style={{
                          background: `${TIPO_COLOR[tipo] ?? '#78716c'}1c`,
                          color: TIPO_COLOR[tipo] ?? '#78716c',
                        }}
                      >
                        {count} {TIPO_LABEL[tipo] ?? tipo}
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Decorative divider handle, mobile only — mirrors the reference's bottom-sheet grabber */}
          <div className="flex justify-center pt-4 md:hidden">
            <span className="w-9 h-1 rounded-full" style={{ background: 'var(--hub-bd2)' }} />
          </div>
        </div>

        {/* Right: side panel */}
        <div className="md:border-l hub-border p-5 sm:p-6 hub-bg-soft">
          <div className="mb-4 hidden md:block">
            <h3 className="font-display text-[15px] font-semibold tracking-tight hub-txt">
              Postagens
            </h3>
            <p className="text-[12px] hub-tx2 mt-0.5">
              {selectedDay
                ? `${selectedDay} de ${MONTHS_PT[month]}, ${year}`
                : `${MONTHS_PT[month]} ${year}`}
            </p>
          </div>

          {selectedPosts.length === 0 ? (
            <div className="py-10 text-center hub-tx3 text-[13px]">
              {selectedDay ? 'Nenhuma postagem neste dia.' : 'Selecione um dia.'}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {selectedPosts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate(`postagens?post=${p.id}`)}
                  className="text-left rounded-xl md:border hub-border hub-bg-card p-3.5 space-y-1.5 md:space-y-2 hover:border-[var(--hub-bd2)] hover:shadow-sm transition-all"
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
                      className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                      style={{
                        background: `${TIPO_COLOR[p.tipo] ?? '#78716c'}1c`,
                        color: TIPO_COLOR[p.tipo] ?? '#78716c',
                      }}
                    >
                      {TIPO_LABEL[p.tipo] ?? p.tipo}
                    </span>
                    <span className="text-[10px] hub-tx2 px-2 py-0.5 rounded-full hub-bg-soft">
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>

                  <p className="text-[13.5px] font-semibold leading-snug hub-txt">{p.titulo}</p>

                  {p.conteudo_plain && (
                    <p className="text-[12px] hub-tx2 truncate md:hidden">{p.conteudo_plain}</p>
                  )}

                  {p.scheduled_at && (
                    <p className="hidden md:block text-[11px] hub-tx2">
                      {new Date(p.scheduled_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
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
