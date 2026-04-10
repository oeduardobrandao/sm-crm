import { useState } from 'react';
import type { BoardCard } from '../hooks/useEntregasData';
import { computeDeadlineDate, computeWorkflowDeadlineDate } from '../hooks/useEntregasData';

interface CalendarViewProps {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
}

interface CalendarEvent {
  card: BoardCard;
  type: 'etapa' | 'workflow';
  date: Date;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function CalendarView({ cards, onCardClick }: CalendarViewProps) {
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const isSameMonth = month === today.getMonth() && year === today.getFullYear();
  const isToday = (d: number) => today.getDate() === d && isSameMonth;

  const prevMonth = () => { setCurrentDate(new Date(year, month - 1, 1)); setSelectedDay(null); };
  const nextMonth = () => { setCurrentDate(new Date(year, month + 1, 1)); setSelectedDay(null); };

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

  // Build grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Selected day details
  const selectedEvents = selectedDay
    ? events.filter(e => e.date.getDate() === selectedDay)
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
          <div className="calendar-header">
            <div className="calendar-title-group">
              <h2>{monthNames[month]}</h2>
              <span>{year}</span>
            </div>
            <div className="calendar-nav">
              <button onClick={prevMonth}>‹</button>
              <button onClick={nextMonth}>›</button>
            </div>
          </div>
          <div className="calendar-weekdays">
            {weekDays.map(wd => <div key={wd}>{wd}</div>)}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: firstDay }, (_, i) => (
              <div key={`e${i}`} className="calendar-day empty" />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1;
              const dayEvents = events.filter(e => e.date.getDate() === d);
              const hasEvents = dayEvents.length > 0;
              const etapaCount = dayEvents.filter(e => e.type === 'etapa').length;
              const wfCount = dayEvents.filter(e => e.type === 'workflow').length;
              return (
                <div
                  key={d}
                  className={`calendar-day ${isToday(d) ? 'today' : ''} ${selectedDay === d ? 'selected' : ''} ${hasEvents ? 'has-events' : ''}`}
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
            })}
          </div>
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
                <div
                  key={i}
                  className="scheduled-item"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onCardClick(ev.card)}
                >
                  <div className="item-top">
                    <div className="item-badge" style={{ background: ev.type === 'etapa' ? '#a855f7' : '#f97316' }} />
                    <span className="badge" style={{ fontSize: '0.65rem' }}>
                      {ev.type === 'etapa' ? '⚑ PRAZO DA ETAPA' : '◎ CONCLUSÃO PREVISTA'}
                    </span>
                  </div>
                  <div className="item-title">{ev.card.workflow.titulo}</div>
                  <div className="item-subtitle">
                    {ev.card.cliente?.nome || '—'} · ETAPA: {ev.card.etapa.nome}
                  </div>
                  <div className="item-divider" />
                  <div className="item-meta">
                    {ev.date.toLocaleDateString('pt-BR')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#a855f7', display: 'inline-block' }} /> Prazo da etapa</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} /> Conclusão prevista</span>
      </div>
    </div>
  );
}
