import { useState } from 'react';
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
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
  }

  const selectedPosts = selectedDay ? postsForDay(selectedDay) : [];

  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4 border rounded-xl overflow-hidden bg-card">

        {/* Left: calendar grid */}
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-base">Postagens</h2>
              <p className="text-sm text-muted-foreground">{MONTHS_PT[month]} {year}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={prevMonth} className="p-1.5 rounded hover:bg-accent transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={nextMonth} className="p-1.5 rounded hover:bg-accent transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS_PT.map(d => (
              <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-px">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[56px]" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayPosts = postsForDay(day);
              const hasEvents = dayPosts.length > 0;
              const isToday = day === today.getDate() && isSameCalMonth;
              const isSelected = selectedDay === day;

              const byTipo: Record<string, number> = {};
              for (const p of dayPosts) {
                byTipo[p.tipo] = (byTipo[p.tipo] || 0) + 1;
              }

              return (
                <div
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`min-h-[56px] p-1 rounded cursor-pointer transition-colors ${
                    isSelected ? 'bg-accent ring-1 ring-primary/30' : 'hover:bg-accent/50'
                  } ${hasEvents ? '' : ''}`}
                >
                  <div className={`text-xs mb-1 w-5 h-5 flex items-center justify-center rounded-full font-medium ${
                    isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}>
                    {day}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {Object.entries(byTipo).map(([tipo, count]) => (
                      <div
                        key={tipo}
                        className="text-[9px] px-1 py-0.5 rounded font-semibold leading-none truncate"
                        style={{
                          background: `${TIPO_COLOR[tipo] ?? '#6b7280'}18`,
                          color: TIPO_COLOR[tipo] ?? '#6b7280',
                        }}
                      >
                        {count} {TIPO_LABEL[tipo] ?? tipo}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: side panel */}
        <div className="border-t md:border-t-0 md:border-l p-4 bg-muted/30">
          <div className="mb-3">
            <h3 className="font-medium text-sm">Postagens</h3>
            <p className="text-xs text-muted-foreground">
              {selectedDay
                ? `${selectedDay} de ${MONTHS_PT[month]}, ${year}`
                : `${MONTHS_PT[month]} ${year}`}
            </p>
          </div>

          {selectedPosts.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              {selectedDay ? 'Nenhuma postagem neste dia.' : 'Selecione um dia.'}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {selectedPosts.map(p => (
                <div key={p.id} className="rounded-lg border bg-card p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        background: `${TIPO_COLOR[p.tipo] ?? '#6b7280'}18`,
                        color: TIPO_COLOR[p.tipo] ?? '#6b7280',
                      }}
                    >
                      {(TIPO_LABEL[p.tipo] ?? p.tipo).toUpperCase()}
                    </span>
                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-snug">{p.titulo}</p>
                  {p.scheduled_at && (
                    <p className="text-xs text-muted-foreground">
                      {new Date(p.scheduled_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
