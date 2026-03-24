import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Chart, registerables } from 'chart.js';
import {
  getWorkflows, getClientes, getWorkflowTemplates, getMembros, getAllEtapasWithWorkflow,
  type Workflow, type WorkflowEtapa, type Membro, type WorkflowTemplate,
} from '../../store';

Chart.register(...registerables);

// ---- Types ----
interface Filters {
  clienteId: number | null;
  templateId: number | null;
  days: number | null;
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

// ---- Helpers ----
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
  d.setDate(d.getDate() - d.getDay());
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function computeMetrics(
  allEtapas: EtapaRow[],
  allWorkflows: Workflow[],
  membros: Membro[],
  filters: Filters,
): Metrics {
  const now = new Date();
  const cutoff = filters.days ? new Date(now.getTime() - filters.days * 86400000) : null;

  const filteredWorkflows = allWorkflows.filter(w => {
    if (cutoff && w.created_at && new Date(w.created_at) < cutoff) return false;
    if (filters.clienteId && w.cliente_id !== filters.clienteId) return false;
    if (filters.templateId && w.template_id !== filters.templateId) return false;
    return true;
  });
  const wfIds = new Set(filteredWorkflows.map(w => w.id));

  const etapas = allEtapas.filter(e => wfIds.has(e.workflow_id));
  const completedEtapas = etapas.filter(e => e.status === 'concluido');

  const completedWorkflows = filteredWorkflows.filter(w => w.status === 'concluido').length;
  const activeWorkflows = filteredWorkflows.filter(w => w.status === 'ativo').length;

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

  let onTimeCount = 0;
  let overdueCount = 0;
  for (const e of completedEtapas) {
    const ot = isOnTime(e);
    if (ot === null) continue;
    if (ot) onTimeCount++; else overdueCount++;
  }
  const totalRated = onTimeCount + overdueCount;
  const onTimeRate = totalRated > 0 ? Math.round((onTimeCount / totalRated) * 100) : null;

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
      const totalR = stats.onTime + stats.overdue;
      return {
        membro,
        completed: stats.completed,
        avgDays: stats.count ? stats.totalDays / stats.count : 0,
        onTimeRate: totalR ? Math.round((stats.onTime / totalR) * 100) : 100,
        overdueCount: stats.overdue,
      };
    })
    .filter(Boolean) as Metrics['memberPerformance'];
  memberPerformance.sort((a, b) => b.onTimeRate - a.onTimeRate || b.completed - a.completed);

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

  return { completedWorkflows, activeWorkflows, avgCompletionDays, onTimeRate, stepAvgDays, completionsOverTime, onTimeCount, overdueCount, memberPerformance, bottlenecks };
}

// ---- Charts component ----
function AnalyticsCharts({ metrics }: { metrics: Metrics }) {
  const stepRef = useRef<HTMLCanvasElement>(null);
  const compRef = useRef<HTMLCanvasElement>(null);
  const doughnutRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const gridColor = 'rgba(255,255,255,0.06)';
    const textColor = 'rgba(255,255,255,0.5)';
    const chartFont = { family: 'DM Sans, sans-serif' };
    const charts: Chart[] = [];

    if (stepRef.current && metrics.stepAvgDays.length) {
      charts.push(new Chart(stepRef.current, {
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
            tooltip: {
              callbacks: {
                label: (ctx: any) => `${formatDuration(ctx.parsed.y)} (${metrics.stepAvgDays[ctx.dataIndex].count} amostras)`,
              },
            },
          },
          scales: {
            x: { ticks: { color: textColor, font: chartFont }, grid: { display: false } },
            y: { ticks: { color: textColor, font: chartFont }, grid: { color: gridColor }, beginAtZero: true },
          },
        },
      }));
    }

    if (compRef.current && metrics.completionsOverTime.length) {
      charts.push(new Chart(compRef.current, {
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
      }));
    }

    if (doughnutRef.current && (metrics.onTimeCount + metrics.overdueCount) > 0) {
      charts.push(new Chart(doughnutRef.current, {
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
          plugins: { legend: { display: false } },
        },
      }));
    }

    return () => { charts.forEach(c => { try { c.destroy(); } catch { /* */ } }); };
  }, [metrics]);

  const total = metrics.onTimeCount + metrics.overdueCount;
  const onTimePct = total ? Math.round((metrics.onTimeCount / total) * 100) : 0;
  const overduePct = total ? 100 - onTimePct : 0;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }} className="animate-up">
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Tempo médio por etapa</h3>
          <canvas ref={stepRef} />
        </div>
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Conclusões por semana</h3>
          <canvas ref={compRef} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }} className="animate-up">
        <div className="card" style={{ maxWidth: 400, width: '100%' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Distribuição de pontualidade</h3>
          <canvas ref={doughnutRef} />
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(52,199,89,0.8)', flexShrink: 0 }} />
              No prazo <strong style={{ color: 'var(--text-main)' }}>{metrics.onTimeCount} ({onTimePct}%)</strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,69,58,0.8)', flexShrink: 0 }} />
              Atrasado <strong style={{ color: 'var(--text-main)' }}>{metrics.overdueCount} ({overduePct}%)</strong>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function AnalyticsFluxosPage() {
  const [filters, setFilters] = useState<Filters>({ clienteId: null, templateId: null, days: 30 });

  const { data: etapas = [], isLoading: loadingEtapas } = useQuery({ queryKey: ['all-etapas-workflow'], queryFn: getAllEtapasWithWorkflow });
  const { data: workflows = [], isLoading: loadingWf } = useQuery({ queryKey: ['workflows'], queryFn: getWorkflows });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: templates = [] } = useQuery({ queryKey: ['workflow-templates'], queryFn: getWorkflowTemplates });
  const { data: membros = [] } = useQuery({ queryKey: ['membros'], queryFn: getMembros });

  const isLoading = loadingEtapas || loadingWf;

  const metrics = computeMetrics(etapas as EtapaRow[], workflows, membros, filters);
  const hasData = etapas.length > 0;

  const DAY_OPTIONS = [
    { label: '7d', value: 7 },
    { label: '30d', value: 30 },
    { label: '90d', value: 90 },
    { label: 'Todos', value: 0 },
  ];

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <h1>Analytics de Fluxos</h1>
          <p style={{ color: 'var(--text-muted)' }}>{workflows.length} fluxos no total</p>
        </div>
      </header>

      <div className="filter-bar animate-up">
        <Select
          value={filters.clienteId !== null ? String(filters.clienteId) : 'all'}
          onValueChange={val => setFilters(f => ({ ...f, clienteId: val === 'all' ? null : Number(val) }))}
        >
          <SelectTrigger style={{ width: 'auto', minWidth: 200 }}>
            <SelectValue placeholder="Todos os clientes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {clientes.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.templateId !== null ? String(filters.templateId) : 'all'}
          onValueChange={val => setFilters(f => ({ ...f, templateId: val === 'all' ? null : Number(val) }))}
        >
          <SelectTrigger style={{ width: 'auto', minWidth: 200 }}>
            <SelectValue placeholder="Todos os templates" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os templates</SelectItem>
            {templates.map(t => (
              <SelectItem key={t.id} value={String(t.id)}>{t.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {DAY_OPTIONS.map(opt => (
            <button
              key={opt.label}
              className={`filter-btn${(opt.value === 0 ? filters.days === null : filters.days === opt.value) ? ' active' : ''}`}
              onClick={() => setFilters(f => ({ ...f, days: opt.value === 0 ? null : opt.value }))}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="animate-up" style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
          <p>Nenhum dado de fluxo encontrado. Crie fluxos de trabalho para começar a ver analytics.</p>
        </div>
      ) : (
        <>
          <div className="kpi-grid animate-up">
            <div className="kpi-card">
              <span className="kpi-label">CONCLUÍDOS</span>
              <span className="kpi-value">{metrics.completedWorkflows}</span>
              <span className="kpi-sub">fluxos finalizados</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">ATIVOS</span>
              <span className="kpi-value">{metrics.activeWorkflows}</span>
              <span className="kpi-sub">fluxos em andamento</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">TEMPO MÉDIO</span>
              <span className="kpi-value">{metrics.avgCompletionDays !== null ? formatDuration(metrics.avgCompletionDays) : '—'}</span>
              <span className="kpi-sub">dias para conclusão</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">PONTUALIDADE</span>
              <span className="kpi-value">{metrics.onTimeRate !== null ? metrics.onTimeRate + '%' : '—'}</span>
              <span className="kpi-sub">etapas no prazo</span>
            </div>
          </div>

          <AnalyticsCharts metrics={metrics} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }} className="animate-up">
            <div className="card">
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Desempenho da equipe</h3>
              {metrics.memberPerformance.length === 0
                ? <p style={{ color: 'var(--text-muted)' }}>Nenhuma etapa com responsável atribuído.</p>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Membro</th>
                          <th>Concluídas</th>
                          <th>Tempo médio</th>
                          <th>Pontualidade</th>
                          <th>Atrasos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.memberPerformance.map(mp => {
                          const badgeVariant = mp.onTimeRate >= 80 ? 'default' : mp.onTimeRate >= 50 ? 'secondary' : 'destructive';
                          return (
                            <tr key={mp.membro.id}>
                              <td data-label="Membro">
                                {mp.membro.avatar_url && <img src={mp.membro.avatar_url} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', marginRight: '0.5rem', verticalAlign: 'middle' }} alt="" />}
                                {mp.membro.nome}
                              </td>
                              <td data-label="Concluídas">{mp.completed}</td>
                              <td data-label="Tempo médio">{formatDuration(mp.avgDays)}</td>
                              <td data-label="Pontualidade"><Badge variant={badgeVariant}>{mp.onTimeRate}%</Badge></td>
                              <td data-label="Atrasos">{mp.overdueCount > 0 ? <Badge variant="destructive">{mp.overdueCount}</Badge> : '0'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>

            <div className="card">
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Gargalos</h3>
              {metrics.bottlenecks.length === 0
                ? <p style={{ color: 'var(--text-muted)' }}>Nenhuma etapa concluída ainda.</p>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Etapa</th>
                          <th>Tempo médio</th>
                          <th>Taxa de atraso</th>
                          <th>Amostras</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.bottlenecks.map((b, i) => {
                          const badgeVariant2 = b.overdueRate <= 20 ? 'default' : b.overdueRate <= 50 ? 'secondary' : 'destructive';
                          return (
                            <tr key={i}>
                              <td data-label="Etapa">{b.nome}</td>
                              <td data-label="Tempo médio">{formatDuration(b.avgDays)}</td>
                              <td data-label="Taxa de atraso"><Badge variant={badgeVariant2}>{b.overdueRate}%</Badge></td>
                              <td data-label="Amostras">{b.count}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
