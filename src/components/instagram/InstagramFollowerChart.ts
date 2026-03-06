// =============================================
// CRM Fluxo - Instagram Follower Chart Component
// =============================================
import { formatDate } from '../../store';

declare const Chart: any; // Assuming Chart.js is loaded via CDN in index.html

export function renderInstagramFollowerChart(container: HTMLElement, history: any[]) {
  if (!history || history.length === 0) {
    container.innerHTML = `
       <div class="card animate-up" style="height: 300px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); text-align: center; margin-bottom: 1.5rem;">
          <p>Dados de seguidores insuficientes para exibir o gráfico.</p>
       </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="card animate-up" style="margin-bottom: 1.5rem;">
       <h3 style="margin-bottom: 1rem;"><i class="ph ph-trend-up" style="color: var(--primary-color); margin-right: 0.5rem;"></i> Crescimento de Seguidores (Últimos 30 Dias)</h3>
       <div style="position: relative; height: 300px; width: 100%;">
          <canvas id="ig-follower-chart"></canvas>
       </div>
    </div>
  `;

  const canvas = container.querySelector('#ig-follower-chart') as HTMLCanvasElement;
  if (!canvas) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#94a3b8' : '#4a5468';
  const gridColor = isDark ? '#1e2430' : 'rgba(30,36,48,0.05)';
  const primaryColor = document.documentElement.style.getPropertyValue('--primary-color') || '#c8f542';

  const labels = history.map(h => formatDate(h.date).substring(0,5)); // Ex: 10/05
  const data = history.map(h => h.follower_count);

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Seguidores',
        data: data,
        borderColor: '#E1306C',
        backgroundColor: 'rgba(225, 48, 108, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointBackgroundColor: '#E1306C',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#E1306C',
      }]
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
            label: function(context: any) {
              return ` ${context.parsed.y.toLocaleString('pt-BR')} Seguidores`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false, color: gridColor },
          ticks: { color: textColor, font: { family: "'DM Mono', monospace", size: 10 } }
        },
        y: {
          grid: { color: gridColor, borderDash: [5, 5] },
          ticks: { color: textColor, font: { family: "'DM Mono', monospace", size: 10 } },
          beginAtZero: false // Let it zoom on the deltas
        }
      }
    }
  });
}
