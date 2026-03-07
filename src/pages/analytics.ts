// =============================================
// Pagina: Analytics - Portfolio Dashboard
// =============================================
import { escapeHTML } from '../router';
import { getPortfolioSummary, type PortfolioAccount } from '../services/analytics';

declare const Chart: any;

export async function renderAnalytics(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:40vh"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary-color)"></i></div>`;

  try {
    const portfolio = await getPortfolioSummary();
    const { accounts, summary } = portfolio;

    const silentAccounts = accounts.filter(a => {
      if (!a.last_post_at) return true;
      const daysSince = (Date.now() - new Date(a.last_post_at).getTime()) / 86400000;
      return daysSince > 7;
    });

    const totalFollowers = accounts.reduce((s, a) => s + a.follower_count, 0);
    const totalReach = accounts.reduce((s, a) => s + a.reach_28d, 0);
    const avgEngagement = accounts.length > 0
      ? accounts.reduce((s, a) => s + a.engagement_rate_avg, 0) / accounts.length
      : 0;

    // Group by specialty
    const specialtyMap: Record<string, PortfolioAccount[]> = {};
    for (const a of accounts) {
      const spec = a.client_especialidade || 'Sem especialidade';
      if (!specialtyMap[spec]) specialtyMap[spec] = [];
      specialtyMap[spec].push(a);
    }

    const specialtyStats = Object.entries(specialtyMap)
      .map(([spec, accs]) => ({
        specialty: spec,
        count: accs.length,
        avgEngagement: accs.reduce((s, a) => s + a.engagement_rate_avg, 0) / accs.length,
        avgFollowers: Math.round(accs.reduce((s, a) => s + a.follower_count, 0) / accs.length),
      }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);

    container.innerHTML = `
      <header class="header animate-up">
        <div class="header-title">
          <h1>Analytics Instagram</h1>
          <p>Visao geral de todas as contas conectadas.</p>
        </div>
      </header>

      ${silentAccounts.length > 0 ? `
      <div class="analytics-callout animate-up" style="margin-bottom:1.5rem">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
          <i class="ph ph-warning" style="color:var(--warning);font-size:1.2rem"></i>
          <strong style="color:var(--warning)">Contas Silenciosas</strong>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:0.75rem">
          ${silentAccounts.map(a => {
            const daysSince = a.last_post_at
              ? Math.floor((Date.now() - new Date(a.last_post_at).getTime()) / 86400000)
              : null;
            return `
            <a href="#/analytics-conta/${a.client_id}" class="silent-account-chip">
              <span class="avatar" style="width:24px;height:24px;font-size:0.6rem;background:${escapeHTML(a.client_cor)}">${escapeHTML(a.client_sigla)}</span>
              <span>${escapeHTML(a.client_name)}</span>
              <span class="badge badge-warning" style="font-size:0.65rem">${daysSince !== null ? daysSince + 'd sem postar' : 'Sem posts'}</span>
            </a>`;
          }).join('')}
        </div>
      </div>` : ''}

      <div class="kpi-grid animate-up">
        <div class="kpi-card card-dark">
          <span class="kpi-label" style="color:rgba(255,255,255,0.7)">CONTAS CONECTADAS</span>
          <span class="kpi-value" style="color:#ffffff">${summary.connected} <span style="font-size:0.9rem;color:rgba(255,255,255,0.5)">/ ${summary.total}</span></span>
          <span class="kpi-sub" style="color:var(--success)">${summary.growing} crescendo</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">SEGUIDORES TOTAIS</span>
          <span class="kpi-value">${totalFollowers.toLocaleString('pt-BR')}</span>
          <span class="kpi-sub" style="color:var(--text-muted)">${summary.declining} em declinio</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">ALCANCE TOTAL (28D)</span>
          <span class="kpi-value">${totalReach.toLocaleString('pt-BR')}</span>
          <span class="kpi-sub" style="color:var(--text-muted)">Soma de todas as contas</span>
        </div>
        <div class="kpi-card card-blue">
          <span class="kpi-label" style="color:rgba(0,0,0,0.6)">ENGAJAMENTO MEDIO</span>
          <span class="kpi-value" style="color:var(--dark)">${avgEngagement.toFixed(2)}%</span>
          <span class="kpi-sub" style="color:rgba(0,0,0,0.7)">Media de todas as contas</span>
        </div>
      </div>

      ${summary.bestByEngagement || summary.mostImproved ? `
      <div class="kpi-grid animate-up" style="grid-template-columns: repeat(2, 1fr); margin-top: 0;">
        ${summary.bestByEngagement ? `
        <div class="kpi-card" style="border-left:3px solid var(--success)">
          <span class="kpi-label">MELHOR ENGAJAMENTO</span>
          <span class="kpi-value" style="font-size:1.1rem">${escapeHTML(summary.bestByEngagement.client_name)}</span>
          <span class="kpi-sub" style="color:var(--success)">${summary.bestByEngagement.engagement_rate_avg.toFixed(2)}% taxa de engajamento</span>
        </div>` : ''}
        ${summary.mostImproved ? `
        <div class="kpi-card" style="border-left:3px solid var(--primary-color)">
          <span class="kpi-label">MAIOR CRESCIMENTO</span>
          <span class="kpi-value" style="font-size:1.1rem">${escapeHTML(summary.mostImproved.client_name)}</span>
          <span class="kpi-sub" style="color:var(--primary-color)">+${summary.mostImproved.follower_delta.toLocaleString('pt-BR')} seguidores</span>
        </div>` : ''}
      </div>` : ''}

      <div class="card animate-up" style="margin-top:1.5rem">
        <h3 style="margin-bottom:1rem">Todas as Contas</h3>
        ${accounts.length === 0
          ? '<p style="color:var(--text-muted)">Nenhuma conta Instagram conectada. Conecte contas na pagina de cada cliente.</p>'
          : `
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Seguidores</th>
                <th>Engajamento</th>
                <th>Alcance (28d)</th>
                <th>Posts (30d)</th>
                <th>Ultimo Post</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${accounts
                .sort((a, b) => b.engagement_rate_avg - a.engagement_rate_avg)
                .map(a => {
                  const daysSincePost = a.last_post_at
                    ? Math.floor((Date.now() - new Date(a.last_post_at).getTime()) / 86400000)
                    : null;
                  const isSilent = daysSincePost === null || daysSincePost > 7;
                  const deltaColor = a.follower_delta > 0 ? 'var(--success)' : a.follower_delta < 0 ? 'var(--danger)' : 'var(--text-muted)';
                  const deltaIcon = a.follower_delta > 0 ? '↑' : a.follower_delta < 0 ? '↓' : '→';
                  return `
                  <tr>
                    <td data-label="Cliente">
                      <div style="display:flex;align-items:center;gap:0.5rem">
                        ${a.profile_picture_url
                          ? `<img src="${escapeHTML(a.profile_picture_url)}" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover">`
                          : `<span class="avatar" style="width:32px;height:32px;font-size:0.65rem;background:${escapeHTML(a.client_cor)}">${escapeHTML(a.client_sigla)}</span>`}
                        <div>
                          <strong>${escapeHTML(a.client_name)}</strong>
                          <div style="font-size:0.75rem;color:var(--text-muted)">@${escapeHTML(a.username)}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Seguidores">
                      ${a.follower_count.toLocaleString('pt-BR')}
                      <span style="color:${deltaColor};font-size:0.75rem;margin-left:4px">${deltaIcon}${Math.abs(a.follower_delta).toLocaleString('pt-BR')}</span>
                    </td>
                    <td data-label="Engajamento">
                      <span class="badge ${a.engagement_rate_avg >= 3 ? 'badge-success' : a.engagement_rate_avg >= 1 ? 'badge-warning' : 'badge-neutral'}">${a.engagement_rate_avg.toFixed(2)}%</span>
                    </td>
                    <td data-label="Alcance">${a.reach_28d.toLocaleString('pt-BR')}</td>
                    <td data-label="Posts">${a.posts_last_30d}</td>
                    <td data-label="Ultimo Post">
                      ${daysSincePost !== null
                        ? `<span style="color:${isSilent ? 'var(--danger)' : 'var(--text-main)'}">${daysSincePost}d atras</span>`
                        : '<span style="color:var(--danger)">Sem posts</span>'}
                    </td>
                    <td>
                      <a href="#/analytics-conta/${a.client_id}" class="btn-primary" style="font-size:0.75rem;padding:0.35rem 0.75rem;white-space:nowrap">
                        Ver Analytics
                      </a>
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>

      ${accounts.length >= 2 ? `
      <div class="widgets-grid animate-up" style="margin-top:1.5rem">
        <div class="card">
          <h3>Benchmarking de Engajamento</h3>
          <div style="position:relative;height:${Math.max(200, accounts.length * 40)}px;margin-top:1rem">
            <canvas id="benchmark-chart"></canvas>
          </div>
        </div>

        ${specialtyStats.length >= 2 ? `
        <div class="card">
          <h3>Por Especialidade</h3>
          <div style="margin-top:1rem">
            ${specialtyStats.map(s => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border-color,rgba(0,0,0,0.06))">
                <div>
                  <strong>${escapeHTML(s.specialty)}</strong>
                  <span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.5rem">${s.count} conta${s.count > 1 ? 's' : ''}</span>
                </div>
                <div style="text-align:right">
                  <span class="badge ${s.avgEngagement >= 3 ? 'badge-success' : s.avgEngagement >= 1 ? 'badge-warning' : 'badge-neutral'}">${s.avgEngagement.toFixed(2)}%</span>
                  <div style="font-size:0.7rem;color:var(--text-muted)">${s.avgFollowers.toLocaleString('pt-BR')} seg. medio</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>` : ''}
      </div>` : ''}
    `;

    // Render benchmark chart
    if (accounts.length >= 2) {
      renderBenchmarkChart(accounts);
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">Erro ao carregar analytics: ${message}</p></div>`;
  }
}

function renderBenchmarkChart(accounts: PortfolioAccount[]) {
  const canvas = document.getElementById('benchmark-chart') as HTMLCanvasElement;
  if (!canvas) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#e0e0e0' : '#333';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const sorted = [...accounts].sort((a, b) => a.engagement_rate_avg - b.engagement_rate_avg);
  const avg = accounts.reduce((s, a) => s + a.engagement_rate_avg, 0) / accounts.length;

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sorted.map(a => a.client_name),
      datasets: [{
        data: sorted.map(a => a.engagement_rate_avg),
        backgroundColor: sorted.map(a =>
          a.engagement_rate_avg >= avg ? 'rgba(62, 207, 142, 0.7)' : 'rgba(245, 90, 66, 0.5)'
        ),
        borderRadius: 4,
        barThickness: 24,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: {
            avgLine: {
              type: 'line',
              xMin: avg,
              xMax: avg,
              borderColor: isDark ? '#c8f542' : '#666',
              borderWidth: 2,
              borderDash: [6, 3],
              label: {
                display: true,
                content: `Media: ${avg.toFixed(2)}%`,
                position: 'start',
                backgroundColor: isDark ? '#333' : '#fff',
                color: textColor,
                font: { size: 10 },
              },
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx: any) => `${ctx.parsed.x.toFixed(2)}%`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor, callback: (v: any) => v + '%' },
        },
        y: {
          grid: { display: false },
          ticks: { color: textColor, font: { size: 11 } },
        },
      },
    },
  });
}
