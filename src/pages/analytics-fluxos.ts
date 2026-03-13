// =============================================
// Pagina: Analytics de Fluxos
// =============================================
import { escapeHTML } from '../router';
import {
  getWorkflows,
  getClientes,
  getWorkflowTemplates,
  getMembros,
  getAllEtapasWithWorkflow,
  type Workflow,
  type WorkflowEtapa,
  type Membro,
  type WorkflowTemplate,
} from '../store';

declare const Chart: any;

// --------------- Types ---------------

interface Filters {
  clienteId: number | null;
  templateId: number | null;
  days: number | null; // null = all time
}

type EtapaRow = WorkflowEtapa & {
  workflow_titulo?: string;
  workflow_status?: string;
  workflow_created_at?: string;
  template_id?: number | null;
  cliente_id?: number;
  cliente_nome?: string;
};

interface Metrics {
  completedWorkflows: number;
  activeWorkflows: number;
  avgCompletionDays: number | null;
  onTimeRate: number | null;
  stepAvgDays: { nome: string; avg: number; count: number }[];
  completionsOverTime: { label: string; count: number }[];
  onTimeCount: number;
  overdueCount: number;
  memberPerformance: {
    membro: Membro;
    completed: number;
    avgDays: number;
    onTimeRate: number;
    overdueCount: number;
  }[];
  bottlenecks: { nome: string; avgDays: number; overdueRate: number; count: number }[];
}

// --------------- Chart management ---------------

let chartInstances: any[] = [];

function destroyCharts() {
  for (const c of chartInstances) { try { c.destroy(); } catch (_e) { /* ignore */ } }
  chartInstances = [];
}

// --------------- Helpers ---------------

function computeDaysTaken(etapa: WorkflowEtapa): number | null {
  if (!etapa.iniciado_em || !etapa.concluido_em) return null;
  const start = new Date(etapa.iniciado_em);
  const end = new Date(etapa.concluido_em);
  if (etapa.tipo_prazo === 'uteis') {
    let days = 0;
    const cursor = new Date(start);
    while (cursor < end) {
      cursor.setDate(cursor.getDate() + 1);
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) days++;
    }
    return days;
  }
  return (end.getTime() - start.getTime()) / 86400000;
}

function isOnTime(etapa: WorkflowEtapa): boolean | null {
  const days = computeDaysTaken(etapa);
  if (days === null) return null;
  return days <= etapa.prazo_dias;
}

function formatDuration(days: number): string {
  if (days === 0) return '0d';
  const totalMinutes = Math.round(days * 24 * 60);
  const d = Math.floor(totalMinutes / (24 * 60));
  const h = Math.floor((totalMinutes % (24 * 60)) / 60);
  const m = totalMinutes % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(d + 'd');
  if (h > 0) parts.push(h + 'h');
  if (m > 0 || parts.length === 0) parts.push(m + 'm');
  return parts.join(' ');
}

function getWeekLabel(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // start of week (Sunday)
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

// --------------- Metrics computation ---------------

function computeMetrics(
  allEtapas: EtapaRow[],
  allWorkflows: Workflow[],
  membros: Membro[],
  filters: Filters,
): Metrics {
  const now = new Date();
  const cutoff = filters.days ? new Date(now.getTime() - filters.days * 86400000) : null;

  // Filter workflows
  const filteredWorkflows = allWorkflows.filter(w => {
    if (cutoff && w.created_at && new Date(w.created_at) < cutoff) return false;
    if (filters.clienteId && w.cliente_id !== filters.clienteId) return false;
    if (filters.templateId && w.template_id !== filters.templateId) return false;
    return true;
  });
  const wfIds = new Set(filteredWorkflows.map(w => w.id));

  // Filter etapas
  const etapas = allEtapas.filter(e => wfIds.has(e.workflow_id));
  const completedEtapas = etapas.filter(e => e.status === 'concluido');

  // KPIs
  const completedWorkflows = filteredWorkflows.filter(w => w.status === 'concluido').length;
  const activeWorkflows = filteredWorkflows.filter(w => w.status === 'ativo').length;

  // Avg completion time per workflow
  const wfCompletionDays: number[] = [];
  for (const wf of filteredWorkflows.filter(w => w.status === 'concluido')) {
    const wfEtapas = etapas.filter(e => e.workflow_id === wf.id);
    const starts = wfEtapas.map(e => e.iniciado_em).filter(Boolean).map(d => new Date(d!).getTime());
    const ends = wfEtapas.map(e => e.concluido_em).filter(Boolean).map(d => new Date(d!).getTime());
    if (starts.length && ends.length) {
      const totalDays = Math.round((Math.max(...ends) - Math.min(...starts)) / 86400000);
      wfCompletionDays.push(totalDays);
    }
  }
  const avgCompletionDays = wfCompletionDays.length
    ? wfCompletionDays.reduce((a, b) => a + b, 0) / wfCompletionDays.length
    : null;

  // On-time rate
  let onTimeCount = 0;
  let overdueCount = 0;
  for (const e of completedEtapas) {
    const ot = isOnTime(e);
    if (ot === null) continue;
    if (ot) onTimeCount++; else overdueCount++;
  }
  const totalRated = onTimeCount + overdueCount;
  const onTimeRate = totalRated > 0 ? Math.round((onTimeCount / totalRated) * 100) : null;

  // Avg time per step name
  const stepMap = new Map<string, number[]>();
  for (const e of completedEtapas) {
    const d = computeDaysTaken(e);
    if (d === null) continue;
    if (!stepMap.has(e.nome)) stepMap.set(e.nome, []);
    stepMap.get(e.nome)!.push(d);
  }
  const stepAvgDays = Array.from(stepMap.entries()).map(([nome, days]) => ({
    nome,
    avg: days.reduce((a, b) => a + b, 0) / days.length,
    count: days.length,
  })).sort((a, b) => b.avg - a.avg);

  // Completions over time (weekly)
  const weekMap = new Map<string, number>();
  for (const wf of filteredWorkflows.filter(w => w.status === 'concluido')) {
    const wfEtapas = etapas.filter(e => e.workflow_id === wf.id);
    const ends = wfEtapas.map(e => e.concluido_em).filter(Boolean).map(d => new Date(d!));
    if (ends.length) {
      const maxEnd = new Date(Math.max(...ends.map(d => d.getTime())));
      const label = getWeekLabel(maxEnd);
      weekMap.set(label, (weekMap.get(label) || 0) + 1);
    }
  }
  const completionsOverTime = Array.from(weekMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      const [da, ma] = a.label.split('/').map(Number);
      const [db, mb] = b.label.split('/').map(Number);
      return ma !== mb ? ma - mb : da - db;
    });

  // Member performance
  const memberMap = new Map<number, { completed: number; totalDays: number; onTime: number; overdue: number; count: number }>();
  for (const e of completedEtapas) {
    if (!e.responsavel_id) continue;
    if (!memberMap.has(e.responsavel_id)) memberMap.set(e.responsavel_id, { completed: 0, totalDays: 0, onTime: 0, overdue: 0, count: 0 });
    const m = memberMap.get(e.responsavel_id)!;
    m.completed++;
    const d = computeDaysTaken(e);
    if (d !== null) { m.totalDays += d; m.count++; }
    const ot = isOnTime(e);
    if (ot === true) m.onTime++;
    else if (ot === false) m.overdue++;
  }
  const memberPerformance = Array.from(memberMap.entries())
    .map(([id, stats]) => {
      const membro = membros.find(m => m.id === id);
      if (!membro) return null;
      const totalRated = stats.onTime + stats.overdue;
      return {
        membro,
        completed: stats.completed,
        avgDays: stats.count ? stats.totalDays / stats.count : 0,
        onTimeRate: totalRated ? Math.round((stats.onTime / totalRated) * 100) : 100,
        overdueCount: stats.overdue,
      };
    })
    .filter(Boolean) as Metrics['memberPerformance'];
  memberPerformance.sort((a, b) => b.onTimeRate - a.onTimeRate || b.completed - a.completed);

  // Bottleneck steps
  const bottleneckMap = new Map<string, { totalDays: number; count: number; overdue: number; total: number }>();
  for (const e of completedEtapas) {
    if (!bottleneckMap.has(e.nome)) bottleneckMap.set(e.nome, { totalDays: 0, count: 0, overdue: 0, total: 0 });
    const b = bottleneckMap.get(e.nome)!;
    b.total++;
    const d = computeDaysTaken(e);
    if (d !== null) { b.totalDays += d; b.count++; }
    const ot = isOnTime(e);
    if (ot === false) b.overdue++;
  }
  const bottlenecks = Array.from(bottleneckMap.entries())
    .map(([nome, stats]) => ({
      nome,
      avgDays: stats.count ? stats.totalDays / stats.count : 0,
      overdueRate: stats.total ? Math.round((stats.overdue / stats.total) * 100) : 0,
      count: stats.total,
    }))
    .sort((a, b) => b.avgDays - a.avgDays);

  return {
    completedWorkflows, activeWorkflows, avgCompletionDays, onTimeRate,
    stepAvgDays, completionsOverTime, onTimeCount, overdueCount,
    memberPerformance, bottlenecks,
  };
}

// --------------- Styles ---------------

const PAGE_STYLES = `
.af-charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
.af-section-title { font-family: var(--font-main); font-size: 1rem; font-weight: 600; margin-bottom: 1rem; color: var(--text-main); }
.af-doughnut-row { display: flex; justify-content: center; }
.af-doughnut-card { max-width: 400px; width: 100%; }
.af-doughnut-legend { display: flex; justify-content: center; gap: 1.5rem; margin-top: 1rem; }
.af-doughnut-legend-item { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--text-muted); }
.af-doughnut-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.af-doughnut-legend-value { font-weight: 600; color: var(--text-main); }
.af-tables-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
.card af-table-card { overflow-x: auto; }
.af-empty { text-align: center; padding: 3rem 1rem; color: var(--text-muted); }
.af-empty i { font-size: 2.5rem; margin-bottom: 0.75rem; display: block; }
.af-member-avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; margin-right: 0.5rem; vertical-align: middle; }
.af-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; }
.af-badge--success { background: rgba(52,199,89,0.15); color: var(--success); }
.af-badge--danger { background: rgba(255,69,58,0.15); color: var(--danger); }
.af-badge--warning { background: rgba(255,159,10,0.15); color: var(--warning); }
@media (max-width: 768px) {
  .af-charts-row, .af-tables-row { grid-template-columns: 1fr; }
}
`;

// --------------- DOM helpers ---------------

function buildFilterBar(
  clientes: { id?: number; nome: string }[],
  templates: WorkflowTemplate[],
  filters: Filters,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'filter-bar animate-up';

  const selCliente = document.createElement('select');
  selCliente.id = 'af-filter-cliente';
  selCliente.className = 'filter-btn';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'Todos os clientes';
  selCliente.appendChild(optAll);
  for (const c of clientes) {
    const opt = document.createElement('option');
    opt.value = String(c.id ?? '');
    opt.textContent = c.nome;
    if (filters.clienteId === c.id) opt.selected = true;
    selCliente.appendChild(opt);
  }
  wrapper.appendChild(selCliente);

  const selTemplate = document.createElement('select');
  selTemplate.id = 'af-filter-template';
  selTemplate.className = 'filter-btn';
  const optAllT = document.createElement('option');
  optAllT.value = '';
  optAllT.textContent = 'Todos os templates';
  selTemplate.appendChild(optAllT);
  for (const t of templates) {
    const opt = document.createElement('option');
    opt.value = String(t.id ?? '');
    opt.textContent = t.nome;
    if (filters.templateId === t.id) opt.selected = true;
    selTemplate.appendChild(opt);
  }
  wrapper.appendChild(selTemplate);

  for (const p of [{ label: '7d', value: 7 }, { label: '30d', value: 30 }, { label: '90d', value: 90 }, { label: 'Todos', value: 0 }]) {
    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.textContent = p.label;
    btn.dataset.days = String(p.value);
    if ((p.value === 0 && filters.days === null) || filters.days === p.value) btn.classList.add('active');
    wrapper.appendChild(btn);
  }

  return wrapper;
}

function buildKpiGrid(metrics: Metrics): string {
  return `
    <div class="kpi-grid animate-up">
      <div class="kpi-card">
        <span class="kpi-label">CONCLUÍDOS</span>
        <span class="kpi-value">${metrics.completedWorkflows}</span>
        <span class="kpi-sub">fluxos finalizados</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">ATIVOS</span>
        <span class="kpi-value">${metrics.activeWorkflows}</span>
        <span class="kpi-sub">fluxos em andamento</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">TEMPO MÉDIO</span>
        <span class="kpi-value">${metrics.avgCompletionDays !== null ? formatDuration(metrics.avgCompletionDays) : '—'}</span>
        <span class="kpi-sub">dias para conclusão</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">PONTUALIDADE</span>
        <span class="kpi-value">${metrics.onTimeRate !== null ? metrics.onTimeRate + '%' : '—'}</span>
        <span class="kpi-sub">etapas no prazo</span>
      </div>
    </div>
  `;
}

function buildMemberTable(memberPerformance: Metrics['memberPerformance']): string {
  if (!memberPerformance.length) return '<p style="color:var(--text-muted)">Nenhuma etapa com responsável atribuído.</p>';
  let html = '<table class="data-table"><thead><tr><th>Membro</th><th>Concluídas</th><th>Tempo médio</th><th>Pontualidade</th><th>Atrasos</th></tr></thead><tbody>';
  for (const mp of memberPerformance) {
    const badgeClass = mp.onTimeRate >= 80 ? 'af-badge--success' : mp.onTimeRate >= 50 ? 'af-badge--warning' : 'af-badge--danger';
    const avatarHtml = mp.membro.avatar_url
      ? '<img src="' + escapeHTML(mp.membro.avatar_url) + '" class="af-member-avatar" alt="">'
      : '';
    html += '<tr>'
      + '<td>' + avatarHtml + escapeHTML(mp.membro.nome) + '</td>'
      + '<td>' + mp.completed + '</td>'
      + '<td>' + formatDuration(mp.avgDays) + '</td>'
      + '<td><span class="af-badge ' + badgeClass + '">' + mp.onTimeRate + '%</span></td>'
      + '<td>' + (mp.overdueCount > 0 ? '<span class="af-badge af-badge--danger">' + mp.overdueCount + '</span>' : '0') + '</td>'
      + '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function buildBottleneckTable(bottlenecks: Metrics['bottlenecks']): string {
  if (!bottlenecks.length) return '<p style="color:var(--text-muted)">Nenhuma etapa concluída ainda.</p>';
  let html = '<table class="data-table"><thead><tr><th>Etapa</th><th>Tempo médio</th><th>Taxa de atraso</th><th>Amostras</th></tr></thead><tbody>';
  for (const b of bottlenecks) {
    const badgeClass = b.overdueRate <= 20 ? 'af-badge--success' : b.overdueRate <= 50 ? 'af-badge--warning' : 'af-badge--danger';
    html += '<tr>'
      + '<td>' + escapeHTML(b.nome) + '</td>'
      + '<td>' + formatDuration(b.avgDays) + '</td>'
      + '<td><span class="af-badge ' + badgeClass + '">' + b.overdueRate + '%</span></td>'
      + '<td>' + b.count + '</td>'
      + '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// --------------- Render ---------------

export async function renderAnalyticsFluxos(container: HTMLElement): Promise<void> {
  destroyCharts();

  // Inject page styles
  let styleEl = document.getElementById('af-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'af-styles';
    styleEl.textContent = PAGE_STYLES;
    document.head.appendChild(styleEl);
  }

  // Loading state
  container.textContent = '';
  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = 'display:flex;flex-direction:column;gap:1.5rem';
  const header = document.createElement('header');
  header.className = 'header animate-up';
  const headerTitle = document.createElement('div');
  headerTitle.className = 'header-title';
  const h1 = document.createElement('h1');
  h1.textContent = 'Analytics de Fluxos';
  const pLoading = document.createElement('p');
  pLoading.style.color = 'var(--text-muted)';
  pLoading.textContent = 'Carregando dados...';
  headerTitle.appendChild(h1);
  headerTitle.appendChild(pLoading);
  header.appendChild(headerTitle);
  loadingDiv.appendChild(header);
  container.appendChild(loadingDiv);

  try {
    const [allEtapas, allWorkflows, clientes, templates, membros] = await Promise.all([
      getAllEtapasWithWorkflow(),
      getWorkflows(),
      getClientes(),
      getWorkflowTemplates(),
      getMembros(),
    ]);

    const filters: Filters = { clienteId: null, templateId: null, days: 30 };

    function render() {
      destroyCharts();
      const metrics = computeMetrics(allEtapas, allWorkflows, membros, filters);
      const hasData = allEtapas.length > 0;

      container.textContent = '';
      const root = document.createElement('div');
      root.style.cssText = 'display:flex;flex-direction:column;gap:1.5rem';

      // Header
      const hdr = document.createElement('header');
      hdr.className = 'header animate-up';
      const hdrTitle = document.createElement('div');
      hdrTitle.className = 'header-title';
      const title = document.createElement('h1');
      title.textContent = 'Analytics de Fluxos';
      const subtitle = document.createElement('p');
      subtitle.style.color = 'var(--text-muted)';
      subtitle.textContent = allWorkflows.length + ' fluxos no total';
      hdrTitle.appendChild(title);
      hdrTitle.appendChild(subtitle);
      hdr.appendChild(hdrTitle);
      root.appendChild(hdr);

      // Filters
      const filterBar = buildFilterBar(clientes, templates, filters);
      root.appendChild(filterBar);

      filterBar.querySelector('#af-filter-cliente')?.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value;
        filters.clienteId = val ? parseInt(val, 10) : null;
        render();
      });
      filterBar.querySelector('#af-filter-template')?.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value;
        filters.templateId = val ? parseInt(val, 10) : null;
        render();
      });
      filterBar.querySelectorAll('.filter-btn[data-days]').forEach(btn => {
        btn.addEventListener('click', () => {
          const days = parseInt((btn as HTMLElement).dataset.days || '0', 10);
          filters.days = days === 0 ? null : days;
          render();
        });
      });

      if (!hasData) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'af-empty animate-up';
        const icon = document.createElement('i');
        icon.className = 'ph ph-chart-line-up';
        const msg = document.createElement('p');
        msg.textContent = 'Nenhum dado de fluxo encontrado. Crie fluxos de trabalho para começar a ver analytics.';
        emptyDiv.appendChild(icon);
        emptyDiv.appendChild(msg);
        root.appendChild(emptyDiv);
        container.appendChild(root);
        return;
      }

      // KPI grid (safe — only numeric values interpolated)
      const kpiWrapper = document.createElement('div');
      kpiWrapper.innerHTML = buildKpiGrid(metrics);
      while (kpiWrapper.firstChild) root.appendChild(kpiWrapper.firstChild);

      // Charts row
      const chartsRow = document.createElement('div');
      chartsRow.className = 'af-charts-row animate-up';
      chartsRow.innerHTML = `
        <div class="card"><h3 class="af-section-title">Tempo médio por etapa</h3><canvas id="af-chart-step-avg"></canvas></div>
        <div class="card"><h3 class="af-section-title">Conclusões por semana</h3><canvas id="af-chart-completions"></canvas></div>
      `;
      root.appendChild(chartsRow);

      // Doughnut
      const doughnutRow = document.createElement('div');
      doughnutRow.className = 'af-doughnut-row animate-up';
      const total = metrics.onTimeCount + metrics.overdueCount;
      const onTimePct = total ? Math.round((metrics.onTimeCount / total) * 100) : 0;
      const overduePct = total ? 100 - onTimePct : 0;
      doughnutRow.innerHTML = '<div class="card af-doughnut-card">'
        + '<h3 class="af-section-title">Distribuição de pontualidade</h3>'
        + '<canvas id="af-chart-ontime"></canvas>'
        + '<div class="af-doughnut-legend">'
        + '<div class="af-doughnut-legend-item"><span class="af-doughnut-legend-dot" style="background:rgba(52,199,89,0.8)"></span>No prazo <span class="af-doughnut-legend-value">' + metrics.onTimeCount + ' (' + onTimePct + '%)</span></div>'
        + '<div class="af-doughnut-legend-item"><span class="af-doughnut-legend-dot" style="background:rgba(255,69,58,0.8)"></span>Atrasado <span class="af-doughnut-legend-value">' + metrics.overdueCount + ' (' + overduePct + '%)</span></div>'
        + '</div></div>';
      root.appendChild(doughnutRow);

      // Tables row
      const tablesRow = document.createElement('div');
      tablesRow.className = 'af-tables-row animate-up';

      const memberCard = document.createElement('div');
      memberCard.className = 'card af-table-card';
      const memberTitle = document.createElement('h3');
      memberTitle.className = 'af-section-title';
      memberTitle.textContent = 'Desempenho da equipe';
      memberCard.appendChild(memberTitle);
      const memberTableWrapper = document.createElement('div');
      memberTableWrapper.innerHTML = buildMemberTable(metrics.memberPerformance);
      while (memberTableWrapper.firstChild) memberCard.appendChild(memberTableWrapper.firstChild);
      tablesRow.appendChild(memberCard);

      const bottleneckCard = document.createElement('div');
      bottleneckCard.className = 'card af-table-card';
      const bottleneckTitle = document.createElement('h3');
      bottleneckTitle.className = 'af-section-title';
      bottleneckTitle.textContent = 'Gargalos';
      bottleneckCard.appendChild(bottleneckTitle);
      const bottleneckTableWrapper = document.createElement('div');
      bottleneckTableWrapper.innerHTML = buildBottleneckTable(metrics.bottlenecks);
      while (bottleneckTableWrapper.firstChild) bottleneckCard.appendChild(bottleneckTableWrapper.firstChild);
      tablesRow.appendChild(bottleneckCard);

      root.appendChild(tablesRow);
      container.appendChild(root);

      // Render charts after DOM is ready
      renderCharts(metrics);
    }

    render();
  } catch (err: any) {
    container.textContent = '';
    const errDiv = document.createElement('div');
    errDiv.className = 'card';
    errDiv.style.cssText = 'padding:2rem;color:var(--danger)';
    errDiv.textContent = 'Erro ao carregar analytics: ' + (err.message || String(err));
    container.appendChild(errDiv);
  }
}

// --------------- Charts ---------------

function renderCharts(metrics: Metrics) {
  const chartFont = { family: 'DM Sans, sans-serif' };
  const gridColor = 'rgba(255,255,255,0.06)';
  const textColor = 'rgba(255,255,255,0.5)';

  // Bar chart: avg time per step
  const stepCtx = document.getElementById('af-chart-step-avg') as HTMLCanvasElement | null;
  if (stepCtx && metrics.stepAvgDays.length) {
    const chart = new Chart(stepCtx, {
      type: 'bar',
      data: {
        labels: metrics.stepAvgDays.map(s => s.nome),
        datasets: [{
          label: 'Dias (média)',
          data: metrics.stepAvgDays.map(s => s.avg),
          backgroundColor: 'rgba(255,212,38,0.7)',
          borderRadius: 6,
          maxBarThickness: 48,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx: any) => `${formatDuration(ctx.parsed.y)} (${metrics.stepAvgDays[ctx.dataIndex].count} amostras)` } },
        },
        scales: {
          x: { ticks: { color: textColor, font: chartFont }, grid: { display: false } },
          y: { ticks: { color: textColor, font: chartFont }, grid: { color: gridColor }, beginAtZero: true },
        },
      },
    });
    chartInstances.push(chart);
  }

  // Line chart: completions over time
  const compCtx = document.getElementById('af-chart-completions') as HTMLCanvasElement | null;
  if (compCtx && metrics.completionsOverTime.length) {
    const chart = new Chart(compCtx, {
      type: 'line',
      data: {
        labels: metrics.completionsOverTime.map(c => c.label),
        datasets: [{
          label: 'Conclusões',
          data: metrics.completionsOverTime.map(c => c.count),
          borderColor: 'rgba(52,199,89,1)',
          backgroundColor: 'rgba(52,199,89,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: 'rgba(52,199,89,1)',
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: textColor, font: chartFont }, grid: { display: false } },
          y: { ticks: { color: textColor, font: chartFont, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true },
        },
      },
    });
    chartInstances.push(chart);
  }

  // Doughnut chart: on-time vs overdue
  const otCtx = document.getElementById('af-chart-ontime') as HTMLCanvasElement | null;
  if (otCtx && (metrics.onTimeCount + metrics.overdueCount) > 0) {
    const chart = new Chart(otCtx, {
      type: 'doughnut',
      data: {
        labels: ['No prazo', 'Atrasado'],
        datasets: [{
          data: [metrics.onTimeCount, metrics.overdueCount],
          backgroundColor: ['rgba(52,199,89,0.8)', 'rgba(255,69,58,0.8)'],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        cutout: '65%',
        plugins: {
          legend: { display: false },
        },
      },
    });
    chartInstances.push(chart);
  }
}
