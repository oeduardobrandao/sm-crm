import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  addMonths,
  subMonths,
  format,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const WEEK_DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export interface MonthGridProps {
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
  renderCell: (date: Date, isCurrentMonth: boolean) => React.ReactNode;
  cellClassName?: string;
  headerClassName?: string;
  showNavigation?: boolean;
}

function getMonthDays(month: Date): { date: Date; isCurrentMonth: boolean }[] {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const days = eachDayOfInterval({ start, end });

  const startDow = (getDay(start) + 6) % 7;
  const leading: { date: Date; isCurrentMonth: boolean }[] = [];
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - (i + 1));
    leading.push({ date: d, isCurrentMonth: false });
  }

  const current = days.map((d) => ({ date: d, isCurrentMonth: true }));

  const totalSoFar = leading.length + current.length;
  const trailing: { date: Date; isCurrentMonth: boolean }[] = [];
  const remainder = totalSoFar % 7;
  if (remainder > 0) {
    const needed = 7 - remainder;
    for (let i = 1; i <= needed; i++) {
      const d = new Date(end);
      d.setDate(d.getDate() + i);
      trailing.push({ date: d, isCurrentMonth: false });
    }
  }

  return [...leading, ...current, ...trailing];
}

export function MonthGrid({
  currentMonth,
  onMonthChange,
  renderCell,
  cellClassName,
  headerClassName,
  showNavigation = true,
}: MonthGridProps) {
  const allDays = getMonthDays(currentMonth);
  const monthLabel = format(currentMonth, 'MMMM yyyy', { locale: ptBR });

  return (
    <div className={headerClassName}>
      {showNavigation && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <button
            onClick={() => onMonthChange(subMonths(currentMonth, 1))}
            aria-label="Mês anterior"
            className="month-grid-nav-btn"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span
            className="month-grid-title"
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 700,
              fontSize: '1rem',
              textTransform: 'capitalize',
            }}
          >
            {monthLabel}
          </span>
          <button
            onClick={() => onMonthChange(addMonths(currentMonth, 1))}
            aria-label="Próximo mês"
            className="month-grid-nav-btn"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}
      >
        {WEEK_DAYS.map((d) => (
          <div
            key={d}
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.65rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              padding: 4,
            }}
          >
            {d}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {allDays.map(({ date, isCurrentMonth }, i) => (
          <div key={i} className={cellClassName}>
            {renderCell(date, isCurrentMonth)}
          </div>
        ))}
      </div>
    </div>
  );
}

export { getMonthDays };
