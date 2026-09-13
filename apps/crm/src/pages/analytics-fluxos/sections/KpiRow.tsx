import { Activity, CheckCircle2, Clock, RotateCcw, Target } from 'lucide-react';

import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import type { WorkflowAnalyticsKpis } from '@/services/workflowAnalytics';
import { buildDelta, buildDeltaPp, formatDiasHoras, formatPct, SEM_DADOS } from '../format';

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
  // Pontualidade is already a percentage, so its delta is in POINTS, and it
  // only exists when both windows actually rated etapas.
  const deltaPontualidade = emptyFiltered
    ? null
    : buildDeltaPp(
        kpis.pontualidade_pct,
        kpis.pontualidade_prev,
        kpis.etapas_avaliadas,
        kpis.etapas_avaliadas_prev,
      );
  // Retrabalho is a percentage too, so its delta is in points as well. It needs
  // no sample counts: the RPC's NULLIF already nulls the percentage whenever
  // the window held no event, which is exactly the guard buildDeltaPp applies.
  const deltaRetrabalho = emptyFiltered
    ? null
    : buildDeltaPp(kpis.retrabalho_pct, kpis.retrabalho_prev);

  const semTempo = kpis.tempo_medio_dias === null;
  const semPontualidade = kpis.pontualidade_pct === null;
  const semRetrabalho = kpis.retrabalho_pct === null;

  return (
    <StatCardGrid maxCols={5} className="animate-up">
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
        // Points, not percent: both figures are server-rounded integers, so the
        // difference is a whole number and "8.0%" would be twice wrong.
        unit="pts"
        sub={emptyFiltered ? SEM_MATCH : semPontualidade ? 'nenhuma etapa avaliada' : SEM_BASE}
      />
      <StatCard
        label="Retrabalho"
        icon={RotateCcw}
        tone="pink"
        value={semRetrabalho ? SEM_DADOS : formatPct(kpis.retrabalho_pct)}
        compactValue={semRetrabalho}
        delta={deltaRetrabalho ?? undefined}
        // Less rework is the good direction, so the arrow's colour flips just
        // like it does for tempo médio.
        invertDelta
        unit="pts"
        sub={
          emptyFiltered
            ? SEM_MATCH
            : semRetrabalho
              ? 'nenhum evento de fluxo no período'
              : 'fluxos com etapa devolvida'
        }
      />
    </StatCardGrid>
  );
}
