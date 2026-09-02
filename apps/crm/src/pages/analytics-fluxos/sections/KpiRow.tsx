import { Activity, CheckCircle2, Clock, Target } from 'lucide-react';

import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import type { WorkflowAnalyticsKpis } from '@/services/workflowAnalytics';
import { buildDelta, formatDiasHoras, formatPct, SEM_DADOS } from '../format';

interface KpiRowProps {
  kpis: WorkflowAnalyticsKpis;
  /** True when filters are applied and they matched nothing: the zeros are the
   *  filter's doing, not the workspace's, and the captions must say so. */
  emptyFiltered: boolean;
}

const SEM_BASE = 'sem base de comparação';
const SEM_MATCH = 'nenhum fluxo no filtro';

export function KpiRow({ kpis, emptyFiltered }: KpiRowProps) {
  // A delta against an empty previous window is not a comparison, it is a
  // division by zero dressed up as insight. buildDelta returns null there and
  // StatCard falls back to the `sub` line.
  const deltaConcluidos = emptyFiltered ? null : buildDelta(kpis.concluidos, kpis.concluidos_prev);
  const deltaTempo = emptyFiltered
    ? null
    : buildDelta(kpis.tempo_medio_dias, kpis.tempo_medio_prev);
  const deltaPontualidade = emptyFiltered
    ? null
    : buildDelta(kpis.pontualidade_pct, kpis.pontualidade_prev);

  const semTempo = kpis.tempo_medio_dias === null;
  const semPontualidade = kpis.pontualidade_pct === null;

  return (
    <StatCardGrid maxCols={4} className="animate-up">
      <StatCard
        label="Concluídos"
        icon={CheckCircle2}
        tone="green"
        value={kpis.concluidos}
        delta={deltaConcluidos ?? undefined}
        sub={emptyFiltered ? SEM_MATCH : SEM_BASE}
      />
      <StatCard
        label="Ativos agora"
        icon={Activity}
        tone="blue"
        value={kpis.ativos}
        // Deliberately period-blind: "ativos" is a snapshot of right now, so it
        // never gets a delta and the caption says which of the two it is.
        sub="retrato atual"
      />
      <StatCard
        label="Tempo médio"
        icon={Clock}
        tone="violet"
        value={semTempo ? SEM_DADOS : formatDiasHoras(kpis.tempo_medio_dias as number)}
        compactValue={semTempo}
        delta={deltaTempo ?? undefined}
        // Falling time is the good direction here, so the arrow's colour flips.
        invertDelta
        sub={emptyFiltered ? SEM_MATCH : semTempo ? 'nenhum fluxo concluído no período' : SEM_BASE}
      />
      <StatCard
        label="Pontualidade"
        icon={Target}
        tone="amber"
        value={semPontualidade ? SEM_DADOS : formatPct(kpis.pontualidade_pct)}
        compactValue={semPontualidade}
        delta={deltaPontualidade ?? undefined}
        sub={emptyFiltered ? SEM_MATCH : semPontualidade ? 'nenhuma etapa avaliada' : SEM_BASE}
      />
    </StatCardGrid>
  );
}
