import { ListTodo, CalendarClock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import type { TarefasHeaderStats } from '../tarefasLogic';

export function TarefasStatsHeader({ stats }: { stats: TarefasHeaderStats }) {
  return (
    <StatCardGrid maxCols={4}>
      <StatCard label="Abertas" value={stats.abertas} icon={ListTodo} tone="blue" />
      <StatCard label="Vencem hoje" value={stats.vencemHoje} icon={CalendarClock} tone="amber" />
      <StatCard label="Atrasadas" value={stats.atrasadas} icon={AlertTriangle} tone="red" />
      <StatCard
        label="Concluídas hoje"
        value={stats.concluidasHoje}
        icon={CheckCircle2}
        tone="green"
      />
    </StatCardGrid>
  );
}
