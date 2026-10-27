import { useTranslation } from 'react-i18next';
import { ListTodo, CalendarClock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import type { TarefasHeaderStats } from '../tarefasLogic';

export function TarefasStatsHeader({ stats }: { stats: TarefasHeaderStats }) {
  const { t } = useTranslation('tasks');
  return (
    <StatCardGrid maxCols={4}>
      <StatCard
        label={t('statsHeader.abertas')}
        value={stats.abertas}
        icon={ListTodo}
        tone="blue"
      />
      <StatCard
        label={t('statsHeader.vencemHoje')}
        value={stats.vencemHoje}
        icon={CalendarClock}
        tone="amber"
      />
      <StatCard
        label={t('statsHeader.atrasadas')}
        value={stats.atrasadas}
        icon={AlertTriangle}
        tone="red"
      />
      <StatCard
        label={t('statsHeader.concluidasHoje')}
        value={stats.concluidasHoje}
        icon={CheckCircle2}
        tone="green"
      />
    </StatCardGrid>
  );
}
