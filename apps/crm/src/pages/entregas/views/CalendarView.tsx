import { useState } from 'react';
import type { BoardCard } from '../hooks/useEntregasData';
import { computeDeadlineDate, computeWorkflowDeadlineDate } from '../hooks/useEntregasData';
import { MonthGrid } from '@/components/ui/month-grid';
import { isSameDay } from 'date-fns';

interface CalendarViewProps {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
}

interface CalendarEvent {
  card: BoardCard;
  type: 'etapa' | 'workflow';
  date: Date;
}

const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function CalendarView({ cards, onCardClick }: CalendarViewProps) {
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Build events for this month
  const events: CalendarEvent[] = [];
  for (const card of cards) {
    if (card.etapa.iniciado_em) {
      const etapaDeadline = computeDeadlineDate(card.etapa.iniciado_em, card.etapa.prazo_dias, card.etapa.tipo_prazo);
      if (etapaDeadline.getFullYear() === year && etapaDeadline.getMonth() === month) {
        events.push({ card, type: 'etapa', date: etapaDeadline });
      }
      const wfDeadline = computeWorkflowDeadlineDate(card.allEtapas, card.etapa);
      if (wfDeadline && wfDeadline.getFullYear() === year && wfDeadline.getMonth() === month) {
        if (!isSameDay(wfDeadline, etapaDeadline)) {
          events.push({ card, type: 'workflow', date: wfDeadline });
        }
      }
    }
  }

  const selectedEvents = selectedDay
    ? events.filter(e => e.date.getDate() === selectedDay && e.date.getMonth() === month && e.date.getFullYear() === year)
    : [];

  if (cards.length === 0) {
    return (
      <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
      </div>
    );
  }

  return (
    <div className="animate-up">
      <div className="calendar-layout">
        <div className="calendar-main">
          <MonthGrid
            currentMonth={currentDate}
            onMonthChange={(d) => { setCurrentDate(d); setSelectedDay(null); }}
            renderCell={(date, isCurrentMonth) => {
              if (!isCurrentMonth) return <div className="calendar-day empty" />;
              const d = date.getDate();
              const dayEvents = events.filter(e => isSameDay(e.date, date));
              const hasEvents = dayEvents.length > 0;
              const etapaCount = dayEvents.filter(e => e.type === 'etapa').length;
              const wfCount = dayEvents.filter(e => e.type === 'workflow').length;
              const isToday = isSameDay(date, today);
              return (
                <div
                  className={`calendar-day ${isToday ? 'today' : ''} ${selectedDay === d ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}`}
                  onClick={() => setSelectedDay(d)}
                >
                  <span className="day-number">{d}</span>
                  <div className="day-events">
                    {etapaCount > 0 && (
                      <div className="event-pill deadline">
                        ⚑ {etapaCount} Etapa{etapaCount > 1 ? 's' : ''}
                      </div>
                    )}
                    {wfCount > 0 && (
                      <div className="event-pill" style={{ background: 'rgba(249, 115, 22, 0.12)', color: '#f97316', fontWeight: 600 }}>
                        ◎ {wfCount} Conclus.
                      </div>
                    )}
                  </div>
                </div>
              );
            }}
          />
        </div>

        <div className="scheduled-panel">
          <div className="scheduled-header">
            <h3>Entregas</h3>
            <p>{selectedDay ? `${selectedDay} de ${monthNames[month]}, ${year}` : `${monthNames[month]} ${year}`}</p>
          </div>
          <div className="scheduled-list">
            {selectedEvents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                <p>{selectedDay ? 'Nenhuma entrega neste dia.' : 'Selecione um dia.'}</p>
              </div>
            ) : (
              selectedEvents.map((ev, i) => (
                <div key={i} className="scheduled-item" style={{ cursor: 'pointer' }} onClick={() => onCardClick(ev.card)}>
                  <div className="item-top">
                    <div className="item-badge" style={{ background: ev.type === 'etapa' ? '#a855f7' : '#f97316' }} />
                    <span className="badge" style={{ fontSize: '0.65rem' }}>
                      {ev.type === 'etapa' ? '⚑ PRAZO DA ETAPA' : '◎ CONCLUSÃO PREVISTA'}
                    </span>
                  </div>
                  <div className="item-title">{ev.card.workflow.titulo}</div>
                  <div className="item-subtitle">{ev.card.cliente?.nome || '—'} · ETAPA: {ev.card.etapa.nome}</div>
                  <div className="item-divider" />
                  <div className="item-meta">{ev.date.toLocaleDateString('pt-BR')}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#a855f7', display: 'inline-block' }} /> Prazo da etapa</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} /> Conclusão prevista</span>
      </div>
    </div>
  );
}
