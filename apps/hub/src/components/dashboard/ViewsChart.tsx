import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { useTranslation } from 'react-i18next';
import { useHub } from '../../HubContext';
import { formatCompact } from '../../lib/dashboardFormat';
import { chartInk, chartFont, useFontsReady } from './chartInk';
import type { DashboardViewsEntry } from '../../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export function ViewsChart({ viewsHistory }: { viewsHistory: DashboardViewsEntry[] }) {
  const { t, i18n } = useTranslation('hubHome');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const { theme } = useHub();
  const ink = chartInk(theme);
  // See ReachChart: repaints the canvas once the web fonts settle.
  useFontsReady();

  if (viewsHistory.length === 0) {
    return (
      <div className="hub-card p-5 flex items-center justify-center min-h-[260px]">
        <p className="text-sm text-stone-400">
          {t('topVideos.noVideos', 'Nenhum vídeo no período selecionado.')}
        </p>
      </div>
    );
  }

  const total = viewsHistory.reduce((sum, e) => sum + e.views, 0);
  const max = Math.max(...viewsHistory.map((e) => e.views), 1);
  const labels = viewsHistory.map((e) => {
    const [, m, d] = e.date.split('-');
    return `${d}/${m}`;
  });

  const data = {
    labels,
    datasets: [
      {
        data: viewsHistory.map((e) => e.views),
        backgroundColor: viewsHistory.map((e) => `rgba(${ink}, ${0.25 + 0.6 * (e.views / max)})`),
        borderRadius: { topLeft: 3, topRight: 3, bottomLeft: 0, bottomRight: 0 },
        borderSkipped: 'bottom' as const,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx: any) =>
            t('viewsChart.tooltip', '{{value}} visualizações', {
              value: formatCompact(ctx.parsed.y, locale),
            }),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { family: chartFont(), size: 10 }, color: '#9ca3af', maxTicksLimit: 8 },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
          font: { family: chartFont(), size: 10 },
          color: '#9ca3af',
          callback: (value: number | string) => formatCompact(Number(value), locale),
        },
      },
    },
  };

  return (
    <div className="hub-card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-[13px] font-semibold hub-tx2">
          {t('viewsChart.title', 'Visualizações por dia de postagem')}
        </h3>
        <span className="text-lg font-bold text-stone-900 dark:text-stone-100">
          {formatCompact(total, locale)}
        </span>
      </div>
      <div className="h-[180px]">
        <Bar data={data} options={options as any} />
      </div>
      <p className="mt-3 text-[12px] hub-tx3">
        {t('viewsChart.caption', 'Soma das visualizações dos vídeos publicados em cada dia.')}
      </p>
    </div>
  );
}
