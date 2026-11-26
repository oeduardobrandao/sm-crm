import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart as ReactChart } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';

import { getChartTheme, useIsDark } from '@/lib/chartTheme';
import type { SemanaAgg } from '@/services/workflowAnalytics';
import { formatSemanaCurta, semanaDeLabel } from '../format';
import { SectionCard, SectionEmpty } from './SectionCard';

// BarController/LineController EXPLÍCITOS: o react-chartjs-2 só auto-registra
// o controller do componente tipado importado, e o tree-shaking do build de
// produção remove os registros dos componentes não usados. Sem o
// LineController aqui, o dataset type:'line' quebrava SÓ em produção
// (incidente de 2026-09-02: `"line" is not a registered controller`).
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  LineController,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

interface RitmoChartProps {
  semanas: SemanaAgg[];
  /** Weeks where flows were created but none finished. Without them the "Criados"
   *  line silently skips the weeks that grew the queue, which is the whole point. */
  criadosSemConclusao: { semana: string; criados: number }[];
}

interface Ponto {
  semana: string;
  concluidos: number;
  criados: number;
}

export function buildPontos(
  semanas: SemanaAgg[],
  criadosSemConclusao: { semana: string; criados: number }[],
): Ponto[] {
  const porSemana = new Map<string, Ponto>();
  for (const s of semanas) {
    porSemana.set(s.semana, { semana: s.semana, concluidos: s.concluidos, criados: s.criados });
  }
  for (const s of criadosSemConclusao) {
    const atual = porSemana.get(s.semana);
    if (atual) atual.criados = s.criados;
    else porSemana.set(s.semana, { semana: s.semana, concluidos: 0, criados: s.criados });
  }
  // 'YYYY-MM-DD' keys sort correctly as plain strings, which keeps this free of
  // Date parsing and the timezone shift that comes with it.
  return [...porSemana.values()].sort((a, b) => a.semana.localeCompare(b.semana));
}

export function RitmoChart({ semanas, criadosSemConclusao }: RitmoChartProps) {
  const { t, i18n } = useTranslation('analyticsFlows');
  const isDark = useIsDark();
  const theme = useMemo(() => getChartTheme(isDark), [isDark]);
  const pontos = useMemo(
    () => buildPontos(semanas, criadosSemConclusao),
    [semanas, criadosSemConclusao],
  );

  // Typed as the bar|line union: a combo chart's datasets do not all match
  // the component's `type` prop, and ChartData<'bar'> rejects the line one.
  const data = useMemo<ChartData<'bar' | 'line', number[], string>>(
    () => ({
      labels: pontos.map((p) => formatSemanaCurta(p.semana)),
      datasets: [
        {
          type: 'bar' as const,
          label: t('pace.completed'),
          data: pontos.map((p) => p.concluidos),
          backgroundColor: theme.semantic.success,
          borderWidth: 0,
          borderRadius: 4,
          maxBarThickness: 34,
          order: 2,
        },
        {
          type: 'line' as const,
          label: t('pace.created'),
          data: pontos.map((p) => p.criados),
          borderColor: theme.categorical[0],
          backgroundColor: theme.categorical[0],
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 3,
          order: 1,
        },
      ],
    }),
    // `i18n.language` re-labels the series (and the week axis) on a language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pontos, theme, i18n.language],
  );

  const options = useMemo<ChartOptions<'bar' | 'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: theme.text, font: theme.font }, grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: { color: theme.text, font: theme.font, precision: 0 },
          grid: { color: theme.grid },
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: theme.text, font: theme.font, boxWidth: 10, usePointStyle: true },
        },
        tooltip: {
          ...theme.tooltip,
          callbacks: {
            // The axis only has room for dd/MM; the year belongs somewhere, and
            // a "Tudo" window can easily span two of them.
            title: (items) => {
              const ponto = pontos[items[0]?.dataIndex ?? 0];
              return ponto ? semanaDeLabel(ponto.semana) : '';
            },
          },
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, pontos, i18n.language],
  );

  return (
    <SectionCard title={t('pace.title')} caption={t('pace.caption')}>
      {pontos.length === 0 ? (
        <SectionEmpty>{t('pace.empty')}</SectionEmpty>
      ) : (
        <div style={{ position: 'relative', height: 260 }}>
          <ReactChart
            type="bar"
            data={data}
            options={options}
            role="img"
            aria-label={t('pace.aria')}
          />
        </div>
      )}
    </SectionCard>
  );
}
