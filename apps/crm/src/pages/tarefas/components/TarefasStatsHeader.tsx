import { useTranslation } from 'react-i18next';
import {
  ListTodo,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { StatCard, type StatTone } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import type { TarefaKpi, TarefasHeaderStats } from '../tarefasLogic';

const CARDS: { id: TarefaKpi; icon: LucideIcon; tone: StatTone }[] = [
  { id: 'abertas', icon: ListTodo, tone: 'blue' },
  { id: 'vencemHoje', icon: CalendarClock, tone: 'amber' },
  { id: 'atrasadas', icon: AlertTriangle, tone: 'red' },
  { id: 'concluidasHoje', icon: CheckCircle2, tone: 'green' },
];

/** The four KPI cards. Each one is a toggle: clicking filters the views to its bucket. */
export function TarefasStatsHeader({
  stats,
  activeKpi,
  onKpiClick,
}: {
  stats: TarefasHeaderStats;
  activeKpi: TarefaKpi | null;
  onKpiClick: (kpi: TarefaKpi) => void;
}) {
  const { t } = useTranslation('tasks');
  return (
    <StatCardGrid maxCols={4}>
      {CARDS.map((card) => (
        <StatCard
          key={card.id}
          label={t(`statsHeader.${card.id}`)}
          value={stats[card.id]}
          icon={card.icon}
          tone={card.tone}
          onClick={() => onKpiClick(card.id)}
          active={activeKpi === card.id}
        />
      ))}
    </StatCardGrid>
  );
}
