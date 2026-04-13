import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HubPost } from '../types';

const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

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
  em_producao: 'Em produção',
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção',
  agendado: 'Agendado',
  publicado: 'Publicado',
};

interface Props {
  posts: HubPost[];
}

export function PostCalendar({ posts }: Props) {
  const navigate = useNavigate();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isSameCalMonth = month === today.getMonth() && year === today.getFullYear();

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  }

  function postsForDay(day: number) {
    return posts.filter(p => {
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
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-[20px] font-semibold tracking-tight text-stone-900 leading-none">Postagens</h2>
              <p className="text-[12.5px] text-stone-500 mt-1">
                <span className="capitalize">{MONTHS_PT[month]}</span> {year}
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-full bg-stone-100">
              <button onClick={prevMonth} aria-label="Mês anterior"
                className="w-7 h-7 flex items-center justify-center rounded-full text-stone-600 hover:bg-white hover:text-stone-900 hover:shadow-sm transition-all">
                <ChevronLeft size={15} />
              </button>
              <button onClick={nextMonth} aria-label="Próximo mês"
                className="w-7 h-7 flex items-center justify-center rounded-full text-stone-600 hover:bg-white hover:text-stone-900 hover:shadow-sm transition-all">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 mb-2">
            {DAYS_PT.map(d => (
              <div key={d} className="text-center text-[10px] uppercase tracking-[0.12em] font-semibold text-stone-400 py-1">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[62px]" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayPosts = postsForDay(day);
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
                  className={`min-h-[62px] p-1.5 rounded-xl text-left transition-all ${
                    isSelected
                      ? 'bg-[#FFBF30]/12 ring-1 ring-[#FFBF30]/50'
                      : 'hover:bg-stone-100/80'
                  }`}
                >
                  <div className={`text-[11px] mb-1 w-6 h-6 flex items-center justify-center rounded-full font-semibold ${
                    isToday
                      ? 'bg-stone-900 text-white'
                      : isSelected
                      ? 'text-stone-900'
                      : 'text-stone-500'
                  }`}>
                    {day}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {Object.entries(byTipo).map(([tipo, count]) => (
                      <div
                        key={tipo}
                        className="text-[9px] px-1.5 py-[3px] rounded-md font-semibold leading-none truncate"
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
        </div>

        {/* Right: side panel */}
        <div className="border-t md:border-t-0 md:border-l border-stone-200/80 p-5 sm:p-6 bg-stone-50/70">
          <div className="mb-4">
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-stone-900">Postagens</h3>
            <p className="text-[12px] text-stone-500 mt-0.5">
              {selectedDay
                ? `${selectedDay} de ${MONTHS_PT[month]}, ${year}`
                : `${MONTHS_PT[month]} ${year}`}
            </p>
          </div>

          {selectedPosts.length === 0 ? (
            <div className="py-10 text-center text-stone-400 text-[13px]">
              {selectedDay ? 'Nenhuma postagem neste dia.' : 'Selecione um dia.'}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {selectedPosts.map(p => (
                <button key={p.id}
                  onClick={() => navigate(`postagens?post=${p.id}`)}
                  className="text-left rounded-2xl border border-stone-200/80 bg-white p-3.5 space-y-2 hover:border-stone-300 hover:shadow-sm transition-all">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                      style={{
                        background: `${TIPO_COLOR[p.tipo] ?? '#78716c'}1c`,
                        color: TIPO_COLOR[p.tipo] ?? '#78716c',
                      }}
                    >
                      {(TIPO_LABEL[p.tipo] ?? p.tipo)}
                    </span>
                    <span className="text-[10px] text-stone-500 px-2 py-0.5 rounded-full bg-stone-100">
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  <p className="text-[13.5px] font-semibold leading-snug text-stone-900">{p.titulo}</p>
                  {p.scheduled_at && (
                    <p className="text-[11px] text-stone-500">
                      {new Date(p.scheduled_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })}
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
