import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import type { HubPost } from '../types';

const STATUS_COLOR: Record<string, string> = {
  enviado_cliente: '#f59e0b',
  aprovado_cliente: '#10b981',
  correcao_cliente: '#ef4444',
  agendado: '#3b82f6',
  publicado: '#6b7280',
  rascunho: '#d1d5db',
  em_producao: '#8b5cf6',
};

const STATUS_LABEL: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção',
  agendado: 'Agendado',
  publicado: 'Publicado',
  rascunho: 'Rascunho',
  em_producao: 'Em produção',
};

const TIPO_LABEL: Record<string, string> = {
  feed: 'Feed', reels: 'Reels', stories: 'Stories', carrossel: 'Carrossel',
};

const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

function getPostsForDay(posts: HubPost[], year: number, month: number, day: number) {
  return posts.filter(p => {
    if (!p.scheduled_at) return false;
    const d = new Date(p.scheduled_at);
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
  });
}

export function CalendarioPage() {
  const { token } = useHub();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<HubPost | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const posts = data?.posts ?? [];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Calendário</h2>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-accent"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium w-32 text-center">{MONTHS_PT[month]} {year}</span>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-accent"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAYS_PT.map(d => <div key={d} className="text-center text-xs text-muted-foreground py-1">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-background min-h-[60px]" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayPosts = getPostsForDay(posts, year, month, day);
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
          return (
            <div key={day} className="bg-background min-h-[60px] p-1">
              <div className={`text-xs mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground font-bold' : 'text-muted-foreground'}`}>
                {day}
              </div>
              <div className="flex flex-wrap gap-0.5">
                {dayPosts.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p)}
                    title={p.titulo}
                    style={{ backgroundColor: STATUS_COLOR[p.status] ?? '#d1d5db' }}
                    className="w-2.5 h-2.5 rounded-full hover:ring-2 hover:ring-offset-1 hover:ring-foreground"
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex gap-2 mb-1">
                  <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{TIPO_LABEL[selected.tipo] ?? selected.tipo}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: `${STATUS_COLOR[selected.status]}20`, color: STATUS_COLOR[selected.status] }}>
                    {STATUS_LABEL[selected.status] ?? selected.status}
                  </span>
                </div>
                <h3 className="font-semibold">{selected.titulo}</h3>
                <p className="text-xs text-muted-foreground">
                  {selected.scheduled_at ? new Date(selected.scheduled_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{selected.conteudo_plain}</p>
          </div>
        </div>
      )}
    </div>
  );
}
