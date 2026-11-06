import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart, registerables } from 'chart.js';
import type { GbpDailyPoint } from '../../../services/gbpAnalytics';
import { formatDayMonth } from './gbpTabFormat';

Chart.register(...registerables);

/** Board 4 stack, bottom to top. */
const SERIES = [
  { key: 'calls', field: 'calls', color: '#2563eb' },
  { key: 'directions', field: 'directions', color: '#d97706' },
  { key: 'website', field: 'websiteClicks', color: '#16a34a' },
  { key: 'messages', field: 'messages', color: '#7c3aed' },
] as const satisfies readonly { key: string; field: keyof GbpDailyPoint; color: string }[];

/** "Ações por dia": calls, directions, website clicks and messages, stacked per day. */
export function GbpActionsChart({ daily, phone }: { daily: GbpDailyPoint[]; phone?: boolean }) {
  const { t, i18n } = useTranslation('analyticsGoogle');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const language = i18n.language;
  const empty = daily.every((d) => SERIES.every((s) => d[s.field] === 0));

  useEffect(() => {
    if (!canvasRef.current || empty) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e0e0e0' : '#333';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const chart = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: daily.map((d) => formatDayMonth(d.date, language)),
        datasets: SERIES.map((s) => ({
          label: t(`actions.${s.key}`),
          data: daily.map((d) => d[s.field]),
          backgroundColor: s.color,
          borderRadius: 2,
          maxBarThickness: 18,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            backgroundColor: isDark ? '#1a1e26' : '#fff',
            titleColor: isDark ? '#fff' : '#12151a',
            bodyColor: isDark ? '#94a3b8' : '#4a5468',
            borderColor: isDark ? '#1e2430' : 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) =>
                ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toLocaleString('pt-BR')}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: phone ? 4 : 6 },
          },
          y: {
            stacked: true,
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10 }, precision: 0 },
            beginAtZero: true,
          },
        },
      },
    });
    return () => chart.destroy();
  }, [daily, empty, language, phone, t]);

  if (empty) {
    return <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('actions.empty')}</p>;
  }

  return (
    <>
      <ul
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem 1rem',
          listStyle: 'none',
          padding: 0,
          margin: '0 0 0.75rem',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}
      >
        {SERIES.map((s) => (
          <li key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              aria-hidden="true"
              style={{ width: 10, height: 10, borderRadius: 3, background: s.color }}
            />
            {t(`actions.${s.key}`)}
          </li>
        ))}
      </ul>
      <div style={{ position: 'relative', height: phone ? 200 : 260 }}>
        <canvas ref={canvasRef} role="img" aria-label={t('actions.aria')} />
      </div>
    </>
  );
}
