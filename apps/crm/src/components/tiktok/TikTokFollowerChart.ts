// =============================================
// Mesaas - TikTok Follower Chart Component
// =============================================
import { formatDate } from '../../store';
import { Chart, registerables } from 'chart.js';
import { i18n } from '@mesaas/i18n';
import type { TikTokFollowerHistoryEntry } from '../../services/tiktok';

function t(key: string, opts?: Record<string, unknown>) {
  return i18n.t(key, { ns: 'clients', ...opts });
}

Chart.register(...registerables);

export function renderTikTokFollowerChart(
  container: HTMLElement,
  history: TikTokFollowerHistoryEntry[],
) {
  if (!history || history.length === 0) {
    container.innerHTML = `
       <div class="card animate-up" style="height: 300px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); text-align: center; margin-bottom: 1.5rem;">
          <p>${t('tiktok.followerChartEmpty')}</p>
       </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="card animate-up" style="margin-bottom: 1.5rem;">
       <h3 class="text-xl font-bold tracking-tight mb-4 text-foreground"><i class="ph ph-trend-up" style="color: var(--primary-color); margin-right: 0.5rem;"></i> ${t('tiktok.followerChartTitle')}</h3>
       <div style="position: relative; height: 300px; width: 100%;">
          <canvas id="tt-follower-chart"></canvas>
       </div>
    </div>
  `;

  const canvas = container.querySelector('#tt-follower-chart') as HTMLCanvasElement;
  if (!canvas) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#94a3b8' : '#4a5468';
  const gridColor = isDark ? '#1e2430' : 'rgba(30,36,48,0.05)';

  // follower_history.date is a proper `date` column (YYYY-MM-DD) — no split needed.
  const labels = history.map((h) => formatDate(h.date).substring(0, 5)); // Ex: 10/05
  const data = history.map((h) => h.follower_count);

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: t('tiktok.followers'),
          data: data,
          borderColor: '#FE2C55',
          backgroundColor: 'rgba(254, 44, 85, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointBackgroundColor: '#FE2C55',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#FE2C55',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? '#1a1e26' : '#fff',
          titleColor: isDark ? '#fff' : '#12151a',
          bodyColor: isDark ? '#94a3b8' : '#4a5468',
          borderColor: isDark ? '#1e2430' : 'rgba(0,0,0,0.1)',
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: function (context: any) {
              const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
              return t('tiktok.followerTooltip', {
                count: context.parsed.y.toLocaleString(locale),
              });
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false, color: gridColor },
          ticks: { color: textColor, font: { family: "'SF Pro Text', sans-serif", size: 10 } },
        },
        y: {
          // @ts-expect-error chart.js scales type mismatch
          grid: { color: gridColor, borderDash: [5, 5] },
          ticks: {
            color: textColor,
            font: { family: "'SF Pro Text', sans-serif", size: 10 },
            precision: 0,
          },
          beginAtZero: false, // Let it zoom on the deltas
        },
      },
    },
  });
}
