import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, RefreshCw, FileText, Zap, Plus, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Chart, registerables } from 'chart.js';
import { getClientes, getCurrentWorkspace } from '../../store';
import {
  getAnalyticsOverview, getPostsAnalytics, getFollowerHistory,
  getAudienceDemographics, getBestPostingTimes, getTags, createTag, deleteTag,
  assignTagToPost, removeTagFromPost, getClientReports, getAccountAIAnalysis,
  upsertManualFollowerCount,
  type KpiDelta, type PostAnalytics, type PostTag, type AudienceDemographics,
  type BestPostingTimes, type AnalyticsReport,
} from '../../services/analytics';
import { getInstagramSummary, syncInstagramData } from '../../services/instagram';
import { sanitizeUrl } from '../../utils/security';

Chart.register(...registerables);

// ---- Helpers ----
function formatMediaType(type: string): string {
  switch (type) {
    case 'VIDEO': return 'Reel';
    case 'CAROUSEL_ALBUM': return 'Carrossel';
    case 'IMAGE': return 'Imagem';
    case 'STORY': return 'Story';
    default: return type;
  }
}

function formatReportMonth(month: string): string {
  const [y, m] = month.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

// ---- KPI Card ----
function KpiCard({ label, value, delta, period, prevFormatted }: {
  label: string;
  value: string;
  delta: KpiDelta;
  period?: string;
  prevFormatted?: string;
}) {
  const dirIcon = delta.direction === 'up' ? '↑' : delta.direction === 'down' ? '↓' : '→';
  const dirColor = delta.direction === 'up' ? 'var(--success)' : delta.direction === 'down' ? 'var(--danger)' : 'var(--text-muted)';
  const pct = Math.abs(delta.deltaPercent).toFixed(1);

  return (
    <div className="kpi-card">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value" style={{ fontSize: '1.3rem' }}>{value}</span>
      <span className="kpi-sub" style={{ color: dirColor }}>{dirIcon} {pct}% vs período anterior</span>
      {prevFormatted != null && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>Anterior: {prevFormatted}</span>}
      {period && <span style={{ display: 'inline-block', alignSelf: 'flex-start', marginTop: 4, fontSize: '0.72rem', padding: '2px 7px', borderRadius: 4, background: 'var(--border-color,rgba(0,0,0,0.08))', color: 'var(--text-muted)' }}>{period}</span>}
    </div>
  );
}

// ---- Follower Chart ----
function FollowerChart({ history, postDates }: { history: any[]; postDates: any[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current || history.length < 2) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e0e0e0' : '#333';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const postDateSet = new Set(postDates.map((p: any) => p.date));
    const chart = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: history.map(h => new Date(h.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
        datasets: [{
          label: 'Seguidores',
          data: history.map(h => h.follower_count),
          borderColor: '#E1306C',
          backgroundColor: 'rgba(225, 48, 108, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointStyle: 'circle',
          pointBackgroundColor: '#E1306C',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#E1306C',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
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
              label: (ctx: any) => ` ${ctx.parsed.y.toLocaleString('pt-BR')} Seguidores`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: 10 } },
          // @ts-ignore
          y: { grid: { color: gridColor, borderDash: [5, 5] }, ticks: { color: textColor, font: { size: 10 }, precision: 0 }, beginAtZero: false },
        },
      },
    });
    return () => chart.destroy();
  }, [history, postDates]);
  if (history.length < 2) return <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Dados insuficientes. O histórico é construído diariamente.</p>;
  return <div style={{ position: 'relative', height: 280, marginTop: '1rem' }}><canvas ref={canvasRef} /></div>;
}

// ---- Type Chart ----
function TypeChart({ typeBreakdown }: { typeBreakdown: { type: string; count: number; avgEngagement: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current || typeBreakdown.length === 0) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e0e0e0' : '#333';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const colors = ['#eab308', '#42c8f5', '#f5a342', '#f542c8', '#3ecf8e'];
    const chart = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: typeBreakdown.map(t => `${t.type} (${t.count})`),
        datasets: [{
          label: 'Engajamento Médio',
          data: typeBreakdown.map(t => t.avgEngagement),
          backgroundColor: typeBreakdown.map((_, i) => colors[i % colors.length] + '99'),
          borderRadius: 4,
          barThickness: 28,
        }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx: any) => `${ctx.parsed.x.toFixed(2)}%` } } },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => v + '%' } },
          y: { grid: { display: false }, ticks: { color: textColor } },
        },
      },
    });
    return () => chart.destroy();
  }, [typeBreakdown]);
  if (typeBreakdown.length === 0) return <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Sem dados.</p>;
  return <div style={{ position: 'relative', height: Math.max(150, typeBreakdown.length * 50), marginTop: '1rem' }}><canvas ref={canvasRef} /></div>;
}

// ---- Age Chart ----
function AgeChart({ demographics }: { demographics: AudienceDemographics }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e0e0e0' : '#333';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const chart = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: demographics.age_gender.map(a => a.age_range),
        datasets: [
          { label: 'Masculino', data: demographics.age_gender.map(a => a.male), backgroundColor: 'rgba(66,133,244,0.6)', borderRadius: 4 },
          { label: 'Feminino', data: demographics.age_gender.map(a => a.female), backgroundColor: 'rgba(234,67,149,0.6)', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: textColor, boxWidth: 12 } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor } },
          y: { grid: { color: gridColor }, ticks: { color: textColor } },
        },
      },
    });
    return () => chart.destroy();
  }, [demographics]);
  return <div style={{ position: 'relative', height: 200, marginBottom: '1rem' }}><canvas ref={canvasRef} /></div>;
}

// ---- Best Times Heatmap ----
function BestTimesHeatmap({ data }: { data: BestPostingTimes }) {
  const hours = [0, 3, 6, 9, 12, 15, 18, 21];
  const max = Math.max(...data.heatmap.flat(), 0.1);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3 }}>
        <thead>
          <tr>
            <th />
            {hours.map(h => <th key={h} style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 400 }}>{h}h</th>)}
          </tr>
        </thead>
        <tbody>
          {data.labels_days.map((day, d) => (
            <tr key={d}>
              <td style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'right', paddingRight: 4 }}>{day}</td>
              {hours.map(h => {
                const val = data.heatmap[d][h];
                const postCount = data.counts[d][h];
                const intensity = max > 0 ? val / max : 0;
                const isTop = data.topSlots.some(s => s.day === d && s.hour === h);
                const bg = intensity > 0 ? `rgba(76,175,80,${0.1 + intensity * 0.8})` : 'rgba(0,0,0,0.02)';
                return (
                  <td
                    key={h}
                    style={{ background: bg, ...(isTop ? { outline: '2px solid var(--primary-color)', outlineOffset: -1 } : {}), fontSize: '0.6rem', textAlign: 'center', padding: '4px 2px' }}
                    title={`${day} ${h}h: ${val.toFixed(1)}% eng. (${postCount} post${postCount !== 1 ? 's' : ''})`}
                  >
                    {val > 0 ? val.toFixed(1) + '%' : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- AI Section ----
function AISection({ clientId, days }: { clientId: number; days: number }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setLoading(true); setError('');
    try {
      const result = await getAccountAIAnalysis(clientId, days);
      if (result.analysis.error) {
        setError('Não foi possível gerar a análise.');
        return;
      }
      setAnalysis({ ...result.analysis, generatedAt: result.generatedAt });
    } catch (e: any) {
      setError(e.message || 'Erro na análise');
    } finally {
      setLoading(false);
    }
  };

  const score = analysis?.healthScore?.score ?? 0;
  const scoreColor = analysis ? (score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : 'var(--danger)') : '';
  const priorityColor = (p: string) => p === 'alta' ? 'var(--danger)' : p === 'media' ? 'var(--warning)' : 'var(--success)';

  return (
    <div className="card animate-up">
      <div className="dashboard-hub-card-header" style={{ marginBottom: '1rem' }}>
        <h3>Análise Inteligente</h3>
        <Button size="sm" variant="outline" disabled={loading} onClick={handleGenerate}>{loading ? <Spinner size="sm" /> : <Zap className="h-3 w-3" />} Gerar Análise IA</Button>
      </div>
      {!analysis && !error && !loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Clique em "Gerar Análise IA" para obter insights personalizados.</p>
      )}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {analysis && (
        <div>
          {/* Health Score */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '2.8rem', fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{score}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Health Score</div>
              <p style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>{analysis.healthScore?.summary}</p>
            </div>
          </div>

          {/* Health Score Breakdown */}
          {analysis.healthScore?.breakdown && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '0.75rem', padding: '1rem 0', borderBottom: '1px solid var(--border-color)' }}>
              {Object.entries(analysis.healthScore.breakdown).map(([key, val]: [string, any]) => (
                <div key={key} style={{ fontSize: '0.8rem' }}>
                  <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{key.replace(/([A-Z])/g, ' $1')}: </span>
                  <span>{typeof val === 'string' ? val : val === null ? 'N/A' : val}</span>
                </div>
              ))}
            </div>
          )}

          {/* Performance Map */}
          {analysis.performanceMap && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '1.25rem', padding: '1.25rem 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <h4 style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>Melhor Post</h4>
                <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.performanceMap.topPerformer}</p>
              </div>
              <div>
                <h4 style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>Pior Post</h4>
                <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.performanceMap.worstPerformer}</p>
              </div>
              <div>
                <h4 style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>Mix de Conteúdo</h4>
                <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.performanceMap.contentMix}</p>
              </div>
            </div>
          )}

          {/* Caption Diagnostic + Growth */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '1.25rem', padding: '1.25rem 0', borderBottom: '1px solid var(--border-color)' }}>
            {analysis.captionDiagnostic && (
              <div>
                <h4 style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>Diagnóstico de Legendas</h4>
                <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.captionDiagnostic}</p>
              </div>
            )}
            {analysis.growthAnalysis && (
              <>
                <div>
                  <h4 style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>Trajetória de Crescimento</h4>
                  <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.growthAnalysis.trajectory}</p>
                </div>
                <div>
                  <h4 style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>Projeção</h4>
                  <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.growthAnalysis.projection}</p>
                </div>
              </>
            )}
          </div>

          {/* Action Plan */}
          {analysis.actionPlan && analysis.actionPlan.length > 0 && (
            <div style={{ paddingTop: '1.25rem' }}>
              <h4 style={{ fontSize: '0.8rem', marginBottom: '0.6rem', color: 'var(--text-muted)' }}>Plano de Ação</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {analysis.actionPlan.map((a: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', fontSize: '0.85rem' }}>
                    <span className="badge" style={{ fontSize: '0.65rem', minWidth: 44, textAlign: 'center', background: priorityColor(a.prioridade) + '20', color: priorityColor(a.prioridade), border: `1px solid ${priorityColor(a.prioridade)}40` }}>{a.prioridade}</span>
                    <div style={{ lineHeight: 1.4 }}>
                      <div style={{ fontWeight: 600 }}>{a.acao}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{a.porque}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '1rem', textAlign: 'right' }}>
            Gerado em {new Date(analysis.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          </p>
        </div>
      )}
    </div>
  );
}

// ---- Tag pill component ----
function TagPill({ tag, onRemove }: { tag: PostTag; onRemove: () => void }) {
  return (
    <span className="tag-pill" style={{ background: tag.color + '20', color: tag.color, border: `1px solid ${tag.color}40` }}>
      {tag.tag_name}
      <span
        className="tag-remove"
        title="Remover tag"
        style={{ cursor: 'pointer', marginLeft: 4 }}
        onClick={e => { e.stopPropagation(); onRemove(); }}
      >
        ×
      </span>
    </span>
  );
}

// ---- Main Content ----
function AnalyticsContent({
  clientId,
  cliente,
  account,
}: {
  clientId: number;
  cliente: any;
  account: any;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [days, setDays] = useState(30);
  const [overviewDays, setOverviewDays] = useState(30);
  const [periodStart, setPeriodStart] = useState<string | undefined>();
  const [periodEnd, setPeriodEnd] = useState<string | undefined>();
  const [periodLabel, setPeriodLabel] = useState<string | undefined>();
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'posted_at', dir: 'desc' });
  const [expandedPostId, setExpandedPostId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [manualFollowerOpen, setManualFollowerOpen] = useState(false);
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0]);
  const [manualCount, setManualCount] = useState('');

  const dateRange = periodStart && periodEnd ? { start: periodStart, end: periodEnd } : undefined;
  const queryKey = [clientId, overviewDays, days, sort.col, sort.dir, periodStart, periodEnd];

  const { data: overviewRes, isLoading: loadingOv } = useQuery({
    queryKey: ['analytics-overview', clientId, overviewDays, periodStart, periodEnd],
    queryFn: () => getAnalyticsOverview(clientId, overviewDays, dateRange),
  });
  const { data: postsRes, isLoading: loadingPosts } = useQuery({
    queryKey: ['analytics-posts', clientId, days, sort.col, sort.dir, periodStart, periodEnd],
    queryFn: () => getPostsAnalytics(clientId, days, sort.col, sort.dir, dateRange),
  });
  const { data: historyRes } = useQuery({
    queryKey: ['analytics-history', clientId, days, periodStart, periodEnd],
    queryFn: () => getFollowerHistory(clientId, days, dateRange),
  });
  const { data: tagsData = [] } = useQuery({ queryKey: ['analytics-tags'], queryFn: getTags });
  const { data: reportsData = [] } = useQuery({ queryKey: ['analytics-reports', clientId], queryFn: () => getClientReports(clientId) });
  const { data: demoRes } = useQuery({ queryKey: ['analytics-demo', clientId], queryFn: () => getAudienceDemographics(clientId).catch(() => null) });
  const { data: onlineRes } = useQuery({ queryKey: ['analytics-times', clientId], queryFn: () => getBestPostingTimes(clientId).catch(() => null) });

  const isLoading = loadingOv || loadingPosts;
  const overview = overviewRes?.data;
  const posts = postsRes?.posts || [];
  const history = historyRes?.history || [];
  const postDates = historyRes?.postDates || [];
  const demographicsData: AudienceDemographics | null = demoRes?.data || null;
  const bestTimesData: BestPostingTimes | null = onlineRes?.data || null;

  const topSaved = [...posts].sort((a, b) => b.saved - a.saved).slice(0, 5);

  // Content type breakdown
  const typeMap: Record<string, { count: number; totalEng: number }> = {};
  for (const p of posts) {
    const type = formatMediaType(p.media_type);
    if (!typeMap[type]) typeMap[type] = { count: 0, totalEng: 0 };
    typeMap[type].count++;
    typeMap[type].totalEng += p.engagement_rate;
  }
  const typeBreakdown = Object.entries(typeMap).map(([type, data]) => ({
    type, count: data.count, avgEngagement: data.count > 0 ? data.totalEng / data.count : 0,
  })).sort((a, b) => b.avgEngagement - a.avgEngagement);

  // Topic performance
  const tagEngMap: Record<string, { tag: PostTag; totalEng: number; count: number }> = {};
  for (const p of posts) {
    for (const t of p.tags) {
      if (!tagEngMap[t.tag_name]) tagEngMap[t.tag_name] = { tag: t, totalEng: 0, count: 0 };
      tagEngMap[t.tag_name].totalEng += p.engagement_rate;
      tagEngMap[t.tag_name].count++;
    }
  }
  const topicStats = Object.values(tagEngMap).map(t => ({
    ...t.tag, avgEngagement: t.count > 0 ? t.totalEng / t.count : 0, count: t.count,
  })).sort((a, b) => b.avgEngagement - a.avgEngagement);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncInstagramData(clientId);
      toast.success('Dados sincronizados com sucesso!');
      qc.invalidateQueries({ queryKey: ['analytics-overview', clientId] });
      qc.invalidateQueries({ queryKey: ['analytics-posts', clientId] });
      qc.invalidateQueries({ queryKey: ['analytics-history', clientId] });
    } catch (err: any) {
      if (err.message === 'TOKEN_EXPIRED') {
        toast.error('Token expirado. Por favor, reconecte a conta.');
      } else {
        toast.error('Erro na sincronização: ' + (err.message || 'Falha'));
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleDaysChange = (newDays: number) => {
    setDays(newDays); setOverviewDays(newDays);
    setPeriodStart(undefined); setPeriodEnd(undefined); setPeriodLabel(undefined);
    setShowAllPosts(false);
  };

  const handleLastMonth = () => {
    const now = new Date();
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const daysInLastMonth = lastOfLastMonth.getDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    setDays(daysInLastMonth); setOverviewDays(daysInLastMonth);
    setPeriodStart(fmt(firstOfLastMonth));
    setPeriodEnd(fmt(lastOfLastMonth));
    setPeriodLabel(firstOfLastMonth.toLocaleString('pt-BR', { month: 'short', year: 'numeric' }));
    setShowAllPosts(false);
  };

  const handleSortChange = (col: string) => {
    setSort(s => ({ col, dir: s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }));
  };

  const handleSaveManualFollower = async () => {
    const count = parseInt(manualCount, 10);
    if (!manualDate || isNaN(count) || count < 0) {
      toast.error('Preencha todos os campos corretamente');
      return;
    }
    try {
      await upsertManualFollowerCount(clientId, manualDate, count);
      toast.success('Seguidores registrados com sucesso');
      setManualFollowerOpen(false);
      setManualCount('');
      qc.invalidateQueries({ queryKey: ['analytics-history', clientId] });
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar');
    }
  };

  const handleAddTag = async () => {
    const name = prompt('Nome da nova tag (ex: Educativo, Procedimento, Bastidores):');
    if (!name || !name.trim()) return;
    const colors = ['#3ecf8e', '#f5a342', '#42c8f5', '#f542c8', '#eab308', '#f55a42', '#8b5cf6'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    try {
      await createTag(name.trim(), color);
      toast.success('Tag criada!');
      qc.invalidateQueries({ queryKey: ['analytics-tags'] });
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar tag');
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!confirm('Remover esta tag?')) return;
    try {
      await deleteTag(tagId);
      toast.success('Tag removida');
      qc.invalidateQueries({ queryKey: ['analytics-tags'] });
    } catch (err: any) {
      toast.error(err.message || 'Erro');
    }
  };

  const handleAssignTag = async (postId: number, tagId: number) => {
    try {
      await assignTagToPost(postId, tagId);
      qc.invalidateQueries({ queryKey: ['analytics-posts', clientId] });
    } catch (err: any) {
      toast.error(err.message || 'Erro ao atribuir tag');
    }
  };

  const handleGenerateReport = async () => {
    const workspace = await getCurrentWorkspace();
    const periodTag = periodLabel || `${overviewDays}d`;
    // Open a simple report in a new tab
    const html = buildReportHtml({
      clientName: cliente.nome,
      username: account.username,
      profilePicUrl: account.profile_picture_url,
      overviewDays,
      overview,
      posts,
      typeBreakdown,
      topicStats,
      topSaved,
      demographicsData,
      bestTimesData,
      workspaceName: workspace?.name,
      workspaceLogoUrl: workspace?.logo_url || undefined,
      periodLabel,
    });
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-${account.username}-${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast.success('Relatório aberto em nova aba. Use "Salvar como PDF" para baixar.', { duration: 4000 });
  };

  const periodTag = periodLabel || `${overviewDays}d`;
  const visiblePosts = showAllPosts ? posts : posts.slice(0, 5);

  if (isLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><Spinner size="lg" /></div>
  );

  if (!overview) return null;

  const cacheNote = overviewRes?.fromCache
    ? <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Dados de {new Date(overviewRes.fetchedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {account.profile_picture_url && (
              <img src={account.profile_picture_url} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
            )}
            <div>
              <h1>{cliente.nome}</h1>
              <p>@{account.username} {cacheNote}</p>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <Button variant="outline" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
          <Button variant="outline" size="icon" disabled={syncing} onClick={handleSync} title="Sincronizar Dados">{syncing ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}</Button>
          <Button onClick={handleGenerateReport}><FileText className="h-4 w-4" /> Gerar Relatório</Button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="filter-bar animate-up">
        {[7, 30, 90].map(d => (
          <button
            key={d}
            className={`filter-btn${(!periodStart && overviewDays === d) ? ' active' : ''}`}
            onClick={() => handleDaysChange(d)}
          >
            {d} dias
          </button>
        ))}
        <button
          className={`filter-btn${periodStart ? ' active' : ''}`}
          onClick={handleLastMonth}
        >
          Último mês
        </button>
        <span style={{ color: 'var(--text-muted)', alignSelf: 'center', fontSize: '0.75rem' }}>ou</span>
        <input
          type="number"
          className="filter-btn"
          min={1}
          max={730}
          placeholder="Dias..."
          style={{ width: 80 }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const val = parseInt((e.target as HTMLInputElement).value, 10);
              if (isNaN(val) || val < 1 || val > 730) { toast.error('Insira um valor entre 1 e 730 dias'); return; }
              setOverviewDays(val);
              setPeriodStart(undefined); setPeriodEnd(undefined); setPeriodLabel(undefined);
            }
          }}
        />
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid animate-up" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <KpiCard label="SEGUIDORES" value={overview.followerCount.toLocaleString('pt-BR')} delta={overview.followers} period={periodTag} prevFormatted={(overview.followerCount - overview.followers.current).toLocaleString('pt-BR')} />
        <KpiCard label="ENGAJAMENTO" value={overview.engagement.current.toFixed(2) + '%'} delta={overview.engagement} period={periodTag} prevFormatted={overview.engagement.previous.toFixed(2) + '%'} />
        <KpiCard label="ALCANCE" value={overview.reach.current.toLocaleString('pt-BR')} delta={overview.reach} period={periodTag} prevFormatted={overview.reach.previous.toLocaleString('pt-BR')} />
        <KpiCard label="CONTAS ENGAJADAS" value={overview.profileViews.current.toLocaleString('pt-BR')} delta={overview.profileViews} period="28d fixo" />
        <KpiCard label="CLIQUES NO LINK" value={overview.websiteClicks.current.toLocaleString('pt-BR')} delta={overview.websiteClicks} period="28d fixo" />
        <KpiCard label="TAXA DE SALVAMENTOS" value={overview.savesRate.current.toFixed(2) + '%'} delta={overview.savesRate} period={periodTag} prevFormatted={overview.savesRate.previous.toFixed(2) + '%'} />
        <KpiCard label="POSTS PUBLICADOS" value={String(overview.postsPublished.current)} delta={overview.postsPublished} period={periodTag} prevFormatted={String(overview.postsPublished.previous)} />
      </div>

      {/* Top Saved callout */}
      {topSaved.length > 0 && (
        <div className="analytics-callout animate-up" style={{ borderLeftColor: 'var(--primary-color)', background: 'rgba(234,179,8,0.03)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <strong>Taxa de Salvamentos</strong>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Salvamentos indicam que alguém guardou o conteúdo para uma decisão de saúde. É a métrica mais subestimada para conteúdo médico.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {topSaved.map(p => (
              <div key={p.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color,rgba(0,0,0,0.08))', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}>
                <strong>{p.saved}</strong> salvamentos
                <span style={{ color: 'var(--text-muted)', marginLeft: '0.25rem' }}>({p.saves_rate.toFixed(1)}% taxa)</span>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {(p.caption || '').slice(0, 60)}{(p.caption || '').length > 60 ? '...' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Follower Growth Chart */}
      <div className="card animate-up">
        <div className="dashboard-hub-card-header">
          <h3>Crescimento de Seguidores</h3>
          <Button size="sm" variant="outline" onClick={() => setManualFollowerOpen(true)}>✏ Inserir manualmente</Button>
        </div>
        <FollowerChart history={history} postDates={postDates} />
      </div>

      {/* Content Performance Table */}
      <div className="card animate-up">
        <div className="dashboard-hub-card-header"><h3>Performance de Conteúdo</h3></div>
        {posts.length === 0
          ? <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Nenhuma publicação neste período.</p>
          : (
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table className="data-table" id="posts-table">
                <thead>
                  <tr>
                    {[
                      { col: 'posted_at', label: 'Data' },
                      { col: null, label: 'Tipo' },
                      { col: 'reach', label: 'Alcance' },
                      { col: 'impressions', label: 'Impressões' },
                      { col: 'engagement_rate', label: 'Eng.' },
                      { col: 'likes', label: 'Curtidas' },
                      { col: 'saved', label: 'Salvos' },
                      { col: 'comments', label: 'Coment.' },
                      { col: 'shares', label: 'Compart.' },
                      { col: null, label: 'Tags' },
                    ].map(({ col, label }) => (
                      <th
                        key={label}
                        style={{ cursor: col ? 'pointer' : 'default' }}
                        onClick={col ? () => handleSortChange(col) : undefined}
                      >
                        {label}
                        {col && sort.col === col && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiblePosts.map(p => (
                    <>
                      <tr
                        key={p.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setExpandedPostId(expandedPostId === p.id ? null : p.id)}
                      >
                        <td data-label="Data">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            {p.thumbnail_url
                              ? <img loading="lazy" src={sanitizeUrl(p.thumbnail_url)} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0, background: 'var(--bg-secondary)' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              : <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>📷</div>
                            }
                            <span>{new Date(p.posted_at).toLocaleDateString('pt-BR')}</span>
                          </div>
                        </td>
                        <td data-label="Tipo"><span className="badge badge-info">{formatMediaType(p.media_type)}</span></td>
                        <td data-label="Alcance">{p.reach.toLocaleString('pt-BR')}</td>
                        <td data-label="Impressões">{(p.impressions || 0).toLocaleString('pt-BR')}</td>
                        <td data-label="Eng.">
                          <span className={`badge ${p.engagement_rate >= 5 ? 'badge-success' : p.engagement_rate >= 2 ? 'badge-warning' : 'badge-neutral'}`}>
                            {p.engagement_rate.toFixed(1)}%
                          </span>
                        </td>
                        <td data-label="Curtidas">{(p.likes || 0).toLocaleString('pt-BR')}</td>
                        <td data-label="Salvos">{p.saved}</td>
                        <td data-label="Coment.">{p.comments}</td>
                        <td data-label="Compart.">{p.shares}</td>
                        <td data-label="Tags" onClick={e => e.stopPropagation()}>
                          {p.tags.map(t => (
                            <span key={t.id} className="tag-pill" style={{ background: t.color + '20', color: t.color, border: `1px solid ${t.color}40`, marginRight: 2 }}>
                              {t.tag_name}
                            </span>
                          ))}
                          {tagsData.length > 0 && (
                            <span style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                              {tagsData.filter(t => !p.tags.some(pt => pt.id === t.id)).map(t => (
                                <span
                                  key={t.id}
                                  title={`Adicionar "${t.tag_name}"`}
                                  onClick={() => handleAssignTag(p.id, t.id)}
                                  style={{ background: t.color + '20', color: t.color, border: `1px solid ${t.color}40`, cursor: 'pointer', display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: '0.7rem', marginRight: 2 }}
                                >
                                  + {t.tag_name}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                      {expandedPostId === p.id && (
                        <tr key={`detail-${p.id}`}>
                          <td colSpan={8} style={{ padding: '1rem', background: 'var(--card-bg)' }}>
                            <p style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', marginBottom: '0.5rem' }}>{p.caption || 'Sem legenda'}</p>
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.8rem' }}>
                              <a href={sanitizeUrl(p.permalink)} target="_blank" rel="noopener" style={{ color: 'var(--primary-color)' }}>
                                ↗ Ver no Instagram
                              </a>
                              <span style={{ color: 'var(--text-muted)' }}>Impressões: {p.impressions.toLocaleString('pt-BR')}</span>
                              <span style={{ color: 'var(--text-muted)' }}>Curtidas: {p.likes.toLocaleString('pt-BR')}</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {posts.length > 5 && (
                <button
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', margin: '0.75rem auto 0', padding: '0.4rem 1rem', fontSize: '0.8rem', color: 'var(--primary-color)', background: 'none', border: '1px solid var(--border-color)', borderRadius: 6, cursor: 'pointer' }}
                  onClick={() => setShowAllPosts(!showAllPosts)}
                >
                  {showAllPosts ? '↑ Ver menos' : '↓ Ver mais publicações'}
                </button>
              )}
            </div>
          )}
      </div>

      {/* AI Analysis */}
      <AISection clientId={clientId} days={days} />

      {/* Type + Topic */}
      <div className="widgets-grid animate-up">
        <div className="card">
          <div className="dashboard-hub-card-header"><h3>Desempenho por Tipo</h3></div>
          <TypeChart typeBreakdown={typeBreakdown} />
        </div>
        <div className="card">
          <div className="dashboard-hub-card-header"><h3>Desempenho por Tópico</h3></div>
          <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            {tagsData.map(t => <TagPill key={t.id} tag={t} onRemove={() => handleRemoveTag(t.id)} />)}
            <Button size="sm" variant="outline" onClick={handleAddTag} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}><Plus className="h-3 w-3" /> Nova Tag</Button>
          </div>
          {topicStats.length === 0
            ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Atribua tags aos posts para ver o desempenho por tópico.</p>
            : (
              <div style={{ marginTop: '0.5rem' }}>
                {topicStats.map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color }} />
                      <span style={{ fontSize: '0.85rem' }}>{t.tag_name}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({t.count} posts)</span>
                    </div>
                    <span className={`badge ${t.avgEngagement >= 5 ? 'badge-success' : t.avgEngagement >= 2 ? 'badge-warning' : 'badge-neutral'}`}>{t.avgEngagement.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>

      {/* Demographics + Best Times */}
      <div className="widgets-grid animate-up" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card">
          <div className="dashboard-hub-card-header"><h3>Demografia da Audiência</h3></div>
          {!demographicsData
            ? <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Dados demográficos indisponíveis. A conta pode não ter seguidores suficientes ou a permissão instagram_manage_insights pode estar ausente.</p>
            : (
              <div style={{ marginTop: '1rem' }}>
                <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Gênero</h4>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ flex: 1, background: 'rgba(66,133,244,0.1)', borderRadius: 8, padding: '0.5rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#4285f4' }}>{demographicsData.gender_split.male}%</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Masculino</div>
                  </div>
                  <div style={{ flex: 1, background: 'rgba(234,67,149,0.1)', borderRadius: 8, padding: '0.5rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#ea4395' }}>{demographicsData.gender_split.female}%</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Feminino</div>
                  </div>
                </div>
                <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Faixa Etária</h4>
                <AgeChart demographics={demographicsData} />
                <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Principais Cidades</h4>
                {demographicsData.cities.slice(0, 5).map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3rem 0', fontSize: '0.85rem' }}>
                    <span>{i + 1}. {c.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{c.count.toLocaleString('pt-BR')}</span>
                  </div>
                ))}
              </div>
            )}
        </div>
        <div className="card">
          <div className="dashboard-hub-card-header"><h3>Melhor Horário para Postar</h3></div>
          {!bestTimesData || bestTimesData.totalPosts < 5
            ? <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Dados insuficientes. São necessários pelo menos 5 posts nos últimos 90 dias para análise.</p>
            : (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                  Baseado no engajamento de {bestTimesData.totalPosts} posts dos últimos 90 dias
                </p>
                <div style={{ marginTop: '0.75rem' }}>
                  <BestTimesHeatmap data={bestTimesData} />
                  {bestTimesData.topSlots.length > 0 && (
                    <div style={{ marginTop: '1rem' }}>
                      <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Top 3 Horários Recomendados</h4>
                      {bestTimesData.topSlots.map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', fontSize: '0.85rem' }}>
                          <span className="badge badge-success">{i + 1}</span>
                          <span>{bestTimesData.labels_days[s.day]} às {bestTimesData.labels_hours[s.hour]}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{s.value.toFixed(1)}% eng. ({s.postCount} post{s.postCount > 1 ? 's' : ''})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
        </div>
      </div>

      {/* Reports */}
      {reportsData.length > 0 && (
        <div className="card animate-up">
          <div className="dashboard-hub-card-header"><h3>Relatórios Gerados</h3></div>
          <div style={{ marginTop: '1rem' }}>
            {reportsData.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))' }}>
                <div>
                  <strong>{formatReportMonth(r.report_month)}</strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                    {new Date(r.generated_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                {r.status === 'ready' && r.report_url
                  ? <a href={sanitizeUrl(r.report_url)} target="_blank" rel="noopener" className="btn-secondary" style={{ fontSize: '0.75rem' }}>↓ Baixar PDF</a>
                  : <span className="badge badge-warning">{r.status === 'generating' ? 'Gerando...' : r.status}</span>
                }
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual follower modal */}
      <Dialog open={manualFollowerOpen} onOpenChange={open => { if (!open) { setManualFollowerOpen(false); setManualCount(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Inserir Seguidores Manualmente</DialogTitle></DialogHeader>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Insira a contagem de seguidores para uma data específica. Dados manuais não serão sobrescritos pela sincronização automática.
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Data</Label>
              <Input type="date" value={manualDate} max={new Date().toISOString().split('T')[0]} onChange={e => setManualDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Número de seguidores</Label>
              <Input type="number" min={0} placeholder="Ex: 15432" value={manualCount} onChange={e => setManualCount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setManualFollowerOpen(false); setManualCount(''); }}>Cancelar</Button>
            <Button onClick={handleSaveManualFollower}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- HTML report builder ----
function buildReportHtml(data: {
  clientName: string;
  username: string;
  profilePicUrl?: string;
  overviewDays: number;
  overview: any;
  posts: PostAnalytics[];
  typeBreakdown: { type: string; count: number; avgEngagement: number }[];
  topicStats: { tag_name: string; color: string; avgEngagement: number; count: number }[];
  topSaved: PostAnalytics[];
  demographicsData?: AudienceDemographics | null;
  bestTimesData?: BestPostingTimes | null;
  workspaceName?: string;
  workspaceLogoUrl?: string;
  periodLabel?: string;
}): string {
  const { clientName, username, overviewDays, overview, posts, typeBreakdown, topSaved, demographicsData, bestTimesData, periodLabel, workspaceName, workspaceLogoUrl } = data;
  const periodTag = periodLabel || `${overviewDays} dias`;
  const dateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const ov = overview || {};

  const escHtml = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtN = (n: number) => n?.toLocaleString('pt-BR') ?? '—';
  const fmtP = (n: number) => (n != null ? n.toFixed(2) + '%' : '—');
  const arrow = (d: any) => !d ? '' : d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '→';
  const arrowColor = (d: any) => !d ? '#888' : d.direction === 'up' ? '#16a34a' : d.direction === 'down' ? '#dc2626' : '#888';

  const kpiCard = (label: string, value: string, delta?: any, prefix?: string, noDelta?: boolean) => `
    <div class="kpi-card">
      <div class="kpi-label">${escHtml(label)}</div>
      <div class="kpi-value">${value}</div>
      ${!noDelta && delta ? `
      <div class="kpi-delta" style="color: ${arrowColor(delta)}">
        <strong>${arrow(delta)} ${Math.abs(delta.deltaPercent).toFixed(1)}%</strong>
        <span style="color:#a1a1aa; font-weight:normal; font-size:10px; margin-left:4px;">Anterior: ${prefix || ''}${fmtN(delta.previous)}</span>
      </div>` : ''}
    </div>`;

  let demoHtml = '';
  if (demographicsData) {
    const fPct = demographicsData.gender_split?.female ?? 0;
    const mPct = demographicsData.gender_split?.male ?? 0;

    const ageRows = (demographicsData.age_gender || []).map(a => {
      const malePt = (a.male / (a.male + a.female || 1) * 100).toFixed(0);
      const femalePt = (a.female / (a.male + a.female || 1) * 100).toFixed(0);
      return `<tr><td>${escHtml(a.age_range)}</td><td style="color:#2563eb; font-weight:bold;">${malePt}%</td><td style="color:#db2777; font-weight:bold;">${femalePt}%</td></tr>`;
    }).join('');

    const cityRows = (demographicsData.cities || []).slice(0, 5).map((c, i) => `<tr><td style="border:none; padding:4px 8px;">${i + 1}. ${escHtml(c.name)}</td><td style="border:none; padding:4px 8px; text-align:right">${fmtN(c.count)}</td></tr>`).join('');
    const countryRows = (demographicsData.countries || []).slice(0, 5).map((c, i) => `<tr><td style="border:none; padding:4px 8px;">${i + 1}. ${escHtml(c.code)}</td><td style="border:none; padding:4px 8px; text-align:right">${fmtN(c.count)}</td></tr>`).join('');

    demoHtml = `
      <h2 class="section-title">Demografia da Audiência</h2>
      <div class="demo-split">
        <div class="gender-box male-box"><div class="val">${mPct}%</div><div class="lbl">Masculino</div></div>
        <div class="gender-box female-box"><div class="val">${fPct}%</div><div class="lbl">Feminino</div></div>
      </div>
      
      <div style="margin-top:20px;">
        <h3 class="subsection-title">Faixa Etária</h3>
        <table class="data-table">
          <thead><tr><th>Idade</th><th>Masculino</th><th>Feminino</th></tr></thead>
          <tbody>${ageRows}</tbody>
        </table>
      </div>

      <div style="display:flex; gap:20px; margin-top:20px;">
        <div style="flex:1;">
          <h3 class="subsection-title">Principais Cidades</h3>
          <table style="width:100%; font-size:12px;"><tbody>${cityRows}</tbody></table>
        </div>
        <div style="flex:1;">
          <h3 class="subsection-title">Principais Países</h3>
          <table style="width:100%; font-size:12px;"><tbody>${countryRows}</tbody></table>
        </div>
      </div>
    `;
  }

  let heatmapHtml = '';
  if (bestTimesData && bestTimesData.totalPosts >= 5) {
    const d = bestTimesData;
    let tableTrs = '';

    // Header row (Hours)
    let ths = '<th></th>';
    for (let h = 0; h < d.labels_hours.length; h++) {
      if (h % 3 === 0) ths += `<th style="text-align:center; font-size:10px;">${d.labels_hours[h]}</th>`;
    }

    for (let day = 0; day < 7; day++) {
      let tds = `<td style="font-weight:bold; font-size:11px;">${d.labels_days[day].substring(0, 3)}</td>`;
      for (let h = 0; h < d.heatmap[day].length; h += 3) {
        const val1 = d.heatmap[day][h] || 0;
        const val2 = d.heatmap[day][h + 1] || 0;
        const val3 = d.heatmap[day][h + 2] || 0;
        const maxVal = Math.max(val1, val2, val3);

        let bg = '#f8fafc';
        if (maxVal > 5) bg = '#bbf7d0';
        if (maxVal > 10) bg = '#86efac';
        if (maxVal > 15) bg = '#4ade80';
        if (maxVal > 20) bg = '#22c55e';
        if (maxVal > 30) bg = '#16a34a';

        tds += `<td style="background-color:${bg}; border-radius:2px; height:24px; padding:0; border:2px solid white;"></td>`;
      }
      tableTrs += `<tr>${tds}</tr>`;
    }

    const tops = d.topSlots.slice(0, 3).map((t, i) => `
      <div style="font-size:13px; margin-bottom:4px; display:flex; gap:8px;">
        <span style="background:#f5a342; color:#fff; border-radius:12px; height:20px; width:20px; text-align:center; line-height:20px; font-size:11px;">${i + 1}</span>
        <span><strong>${d.labels_days[t.day]} ${d.labels_hours[t.hour]}</strong> - ${(t.value).toFixed(1)}% engaj. médio</span>
      </div>`).join('');

    heatmapHtml = `
      <h2 class="section-title" style="margin-top:30px;">Melhor Horário para Postar</h2>
      <p style="font-size:11px; color:#888; margin-top:-10px; margin-bottom:12px;">Baseado no engajamento de ${d.totalPosts} posts limitados a 90 dias</p>
      <table style="width:100%; border-collapse:collapse; margin-bottom:16px;">
        <thead><tr>${ths}</tr></thead>
        <tbody>${tableTrs}</tbody>
      </table>
      ${tops}
    `;
  }

  const savedRows = topSaved.map(p => `
    <tr>
      <td width="300" style="padding-right:20px;">
        <div style="display:flex; align-items:center; gap:12px;">
          ${p.thumbnail_url ? `<img src="${escHtml(p.thumbnail_url)}" crossorigin="anonymous" style="width:48px; height:48px; border-radius:6px; object-fit:cover;">` : '<div style="width:48px;height:48px;border-radius:6px;background:#f3f4f6;"></div>'}
          <span style="font-size:12px; color:#4b5563; line-height:1.4; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${escHtml((p.caption || 'Sem legenda'))}</span>
        </div>
      </td>
      <td style="font-weight:bold; font-size:16px; text-align:center;">${p.saved}</td>
      <td style="text-align:center;">${p.saves_rate.toFixed(1)}%</td>
    </tr>
  `).join('');

  const perfRows = posts.slice(0, 20).map(p => {
    return `
      <tr>
        <td style="font-size:12px;">${new Date(p.posted_at).toLocaleDateString('pt-BR')}</td>
        <td style="font-size:12px;">${escHtml(p.media_type === 'VIDEO' ? 'Reel' : p.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Imagem')}</td>
        <td style="font-weight:600;">${fmtN(p.reach)}</td>
        <td style="color:${p.engagement_rate >= 3 ? '#16a34a' : p.engagement_rate > 1.5 ? '#eab308' : '#64748b'}; font-weight:bold;">${p.engagement_rate.toFixed(1)}%</td>
        <td>${p.saved}</td>
        <td>${p.comments}</td>
        <td>${p.shares}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html><html lang="pt-BR">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Relatório - ${escHtml(clientName)}</title>
      <style>
        :root { --surface: #ffffff; --bg: #fafafa; --dark: #12151a; --border: #e4e4e7; }
        * { box-sizing: border-box; }
        body { font-family: 'Inter', -apple-system, sans-serif; margin: 0; padding: 0; background: var(--bg); color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        
        .header { background: var(--dark); padding: 40px; color: #fff; position: relative; }
        .header-logo { max-height: 40px; max-width: 140px; margin-bottom: 30px; }
        .title { font-size: 28px; font-weight: 800; margin: 0; letter-spacing: -0.5px; }
        .subtitle { font-size: 14px; color: #eab308; font-weight: 600; margin: 4px 0 16px 0; }
        .head-meta { font-size: 13px; color: #a1a1aa; }
        
        .print-btn { position: absolute; top: 40px; right: 40px; background: #eab308; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; font-family: inherit; }
        @media print { .print-btn { display: none !important; } .header { padding: 30px; } .container { box-shadow: none !important; margin: 0 !important; } body { background: #fff; } }
        
        .container { max-width: 900px; margin: 0 auto; background: var(--surface); box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .content { padding: 40px; }
        
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 40px; }
        .kpi-card { border: 1px solid var(--border); border-radius: 8px; padding: 16px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .kpi-label { font-size: 10px; text-transform: uppercase; color: #71717a; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px; }
        .kpi-value { font-size: 22px; font-weight: 800; color: #18181b; margin-bottom: 4px; }
        .kpi-delta { font-size: 12px; display: flex; align-items: baseline; }
        
        .section-title { font-size: 16px; font-weight: 700; border-bottom: 2px solid #f4f4f5; padding-bottom: 8px; margin-top: 30px; margin-bottom: 20px; color: #18181b; }
        .subsection-title { font-size: 14px; font-weight: 600; color: #3f3f46; margin-bottom: 12px; }
        
        .data-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 30px; }
        .data-table th, .data-table td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border); }
        .data-table th { background: #f8fafc; font-weight: 600; color: #475569; position: sticky; top: 0; }
        .data-table tr:hover { background: #f8fafc; }
        
        .demo-split { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .gender-box { border-radius: 8px; padding: 20px; text-align: center; }
        .male-box { background: #eff6ff; color: #2563eb; }
        .female-box { background: #fdf2f8; color: #db2777; }
        .gender-box .val { font-size: 28px; font-weight: 800; margin-bottom: 4px; }
        .gender-box .lbl { font-size: 12px; font-weight: 600; text-transform: uppercase; opacity: 0.8;}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          ${workspaceLogoUrl ? `<img src="${escHtml(workspaceLogoUrl)}" crossorigin="anonymous" class="header-logo" alt="Logo" onerror="this.style.display='none'">` : (workspaceName ? `<div style="font-size:24px; font-weight:800; letter-spacing:-1px; margin-bottom:20px;">${escHtml(workspaceName)}</div>` : '')}
          <div class="title">${escHtml(clientName)}</div>
          <div class="subtitle">@${escHtml(username)}</div>
          <div class="head-meta">Relatório de Rendimento · Últimos ${overviewDays} dias · Gerado em ${dateStr}</div>
          <button class="print-btn" onclick="window.print()">Salvar como PDF</button>
        </div>
        
        <div class="content">
          <div class="kpi-grid">
            ${kpiCard('Seguidores', fmtN(ov.followerCount), ov.followers, '')}
            ${kpiCard('Engajamento', fmtP(ov.engagement?.current), ov.engagement, '')}
            ${kpiCard('Alcance', fmtN(ov.reach?.current), ov.reach, '')}
            ${kpiCard('Contas Engajadas', fmtN(ov.profileViews?.current), null, '', true)}
            ${kpiCard('Cliques no Link', fmtN(ov.websiteClicks?.current), null, '', true)}
            ${kpiCard('Tax. de Salvamentos', fmtP(ov.savesRate?.current), ov.savesRate, '')}
            ${kpiCard('Posts Publicados', String(ov.postsPublished?.current ?? '—'), ov.postsPublished, '')}
          </div>

          <h2 class="section-title">Posts Mais Salvos</h2>
          <table class="data-table">
            <thead><tr><th width="300">Post</th><th style="text-align:center;">Salvamentos</th><th style="text-align:center;">Taxa %</th></tr></thead>
            <tbody>${savedRows}</tbody>
          </table>

          <h2 class="section-title">Performance de Conteúdo</h2>
          <table class="data-table">
            <thead><tr><th>Data</th><th>Tipo</th><th>Alcance</th><th>Engaj.</th><th>Salvos</th><th>Coment.</th><th>Compart.</th></tr></thead>
            <tbody>${perfRows}</tbody>
          </table>

          <h2 class="section-title">Desempenho por Tipo de Conteúdo</h2>
          <table class="data-table">
            <thead><tr><th>Tipo</th><th>Quantidade</th><th>Engajamento Médio</th></tr></thead>
            <tbody>
              ${typeBreakdown.map(t => `<tr><td>${escHtml(t.type)}</td><td>${t.count}</td><td style="font-weight:bold;">${t.avgEngagement.toFixed(2)}%</td></tr>`).join('')}
            </tbody>
          </table>

          ${demoHtml}
          ${heatmapHtml}

          <div style="text-align:center; padding: 40px 0 20px 0; font-size: 11px; color:#a1a1aa; display:flex; flex-direction:column; align-items:center; gap:8px;">
            <div>
              ${workspaceName ? escHtml(workspaceName) : 'Mesaas'} · Relatório de Inteligência para ${escHtml(clientName)} · Gerado em ${dateStr}
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:12px; opacity:0.85;">
              <span>fornecido por</span>
              <svg width="120" height="18" style="transform:translateY(1px)" viewBox="0 0 1468 186" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M1388.48 185.52C1361.96 185.52 1340.31 179.513 1323.54 167.5C1306.99 155.487 1297.93 138.713 1296.34 117.18H1345.3C1346.89 126.927 1351.42 134.293 1358.9 139.28C1366.38 144.267 1375.67 146.76 1386.78 146.76C1392.9 146.76 1398.68 145.967 1404.12 144.38C1409.56 142.793 1413.98 140.3 1417.38 136.9C1420.78 133.273 1422.48 128.853 1422.48 123.64C1422.48 118.427 1420.89 114.347 1417.72 111.4C1414.77 108.227 1410.24 105.733 1404.12 103.92C1398.23 102.107 1390.18 100.407 1379.98 98.82C1378.62 98.5933 1377.15 98.3667 1375.56 98.14C1374.2 97.9133 1372.73 97.6867 1371.14 97.46C1355.05 95.42 1342.01 92.9266 1332.04 89.98C1322.29 86.8066 1314.93 82.6133 1309.94 77.4C1305.18 71.96 1302.8 64.9333 1302.8 56.32C1302.8 45.8933 1306.09 36.94 1312.66 29.46C1319.23 21.7533 1328.3 15.9733 1339.86 12.12C1351.65 8.04 1365.02 6 1379.98 6C1406.05 6 1426.79 12.0067 1442.2 24.02C1457.84 36.0333 1466.34 53.0333 1467.7 75.02H1420.78C1420.1 65.0467 1416.25 57.5667 1409.22 52.58C1402.19 47.5933 1393.58 45.1 1383.38 45.1C1374.31 45.1 1366.49 47.2533 1359.92 51.56C1353.35 55.64 1350.06 61.5333 1350.06 69.24C1350.06 73.5467 1351.42 77.2867 1354.14 80.46C1357.09 83.6333 1361.51 86.3533 1367.4 88.62C1373.29 90.66 1381 92.36 1390.52 93.72C1392.11 93.9466 1393.69 94.1733 1395.28 94.4C1397.09 94.6267 1398.91 94.8533 1400.72 95.08C1401.63 95.3067 1402.53 95.42 1403.44 95.42C1404.35 95.42 1405.25 95.5333 1406.16 95.76C1420.44 97.5733 1432.11 100.18 1441.18 103.58C1450.25 106.98 1456.93 111.4 1461.24 116.84C1465.55 122.053 1467.7 128.74 1467.7 136.9C1467.7 147.1 1464.3 155.827 1457.5 163.08C1450.7 170.333 1441.29 175.887 1429.28 179.74C1417.27 183.593 1403.67 185.52 1388.48 185.52Z" fill="#1E1E1E"/>
<path d="M1167.26 184.84C1152.07 184.84 1139.83 181.213 1130.54 173.96C1121.24 166.48 1116.6 155.94 1116.6 142.34C1116.6 129.193 1120.9 118.993 1129.52 111.74C1138.36 104.487 1148.56 99.4999 1160.12 96.7799C1171.9 94.0599 1185.16 92.0199 1199.9 90.6599C1211.46 89.9799 1220.41 88.5065 1226.76 86.2399C1233.33 83.9732 1236.62 79.6665 1236.62 73.3199C1236.62 64.2532 1233.44 57.3399 1227.1 52.5799C1220.98 47.5932 1213.5 45.0999 1204.66 45.0999C1194.23 45.0999 1185.73 47.9332 1179.16 53.5999C1172.58 59.2665 1168.73 67.1999 1167.6 77.3999H1123.74C1124.42 62.6665 1128.5 50.0865 1135.98 39.6599C1143.46 29.0065 1153.2 20.9599 1165.22 15.5199C1177.46 10.0799 1190.83 7.35986 1205.34 7.35986C1219.84 7.35986 1232.76 10.0799 1244.1 15.5199C1255.43 20.9599 1264.27 28.8932 1270.62 39.3199C1276.96 49.7465 1280.14 62.2132 1280.14 76.7199V139.28H1299.86V180.76H1236.96V119.56C1233.1 138.6 1225.17 154.24 1213.16 166.48C1201.37 178.72 1186.07 184.84 1167.26 184.84ZM1190.72 148.12C1198.88 148.12 1206.47 145.74 1213.5 140.98C1220.52 136.22 1226.08 130.1 1230.16 122.62C1234.46 114.913 1236.62 106.753 1236.62 98.1399L1236.96 87.5999C1234.24 90.0932 1230.84 91.9065 1226.76 93.0399C1222.9 94.1732 1217.46 95.3065 1210.44 96.4399C1209.98 96.4399 1209.53 96.5532 1209.08 96.7799C1208.62 96.7799 1208.28 96.7799 1208.06 96.7799C1193.78 98.1399 1183.01 101.087 1175.76 105.62C1168.5 109.927 1164.88 116.5 1164.88 125.34C1164.88 133.047 1167.26 138.827 1172.02 142.68C1176.78 146.307 1183.01 148.12 1190.72 148.12Z" fill="#1E1E1E"/>
<path d="M983.457 184.84C968.27 184.84 956.03 181.213 946.737 173.96C937.444 166.48 932.797 155.94 932.797 142.34C932.797 129.193 937.104 118.993 945.717 111.74C954.557 104.487 964.757 99.4999 976.317 96.7799C988.104 94.0599 1001.36 92.0199 1016.1 90.6599C1027.66 89.9799 1036.61 88.5065 1042.96 86.2399C1049.53 83.9732 1052.82 79.6665 1052.82 73.3199C1052.82 64.2532 1049.64 57.3399 1043.3 52.5799C1037.18 47.5932 1029.7 45.0999 1020.86 45.0999C1010.43 45.0999 1001.93 47.9332 995.357 53.5999C988.784 59.2665 984.93 64.8 983.797 75H939.937C940.617 60.2667 944.697 50.0865 952.177 39.6599C959.657 29.0065 969.404 20.9599 981.417 15.5199C993.657 10.0799 1007.03 7.35986 1021.54 7.35986C1036.04 7.35986 1048.96 10.0799 1060.3 15.5199C1071.63 20.9599 1080.47 28.8932 1086.82 39.3199C1093.16 49.7465 1096.34 62.2132 1096.34 76.7199V139.28H1116.06V180.76H1053.16V119.56C1049.3 138.6 1041.37 154.24 1029.36 166.48C1017.57 178.72 1002.27 184.84 983.457 184.84ZM1006.92 148.12C1015.08 148.12 1022.67 145.74 1029.7 140.98C1036.72 136.22 1042.28 130.1 1046.36 122.62C1050.66 114.913 1052.82 106.753 1052.82 98.1399L1053.16 87.5999C1050.44 90.0932 1047.04 91.9065 1042.96 93.0399C1039.1 94.1732 1033.66 95.3065 1026.64 96.4399C1026.18 96.4399 1025.73 96.5532 1025.28 96.7799C1024.82 96.7799 1024.48 96.7799 1024.26 96.7799C1009.98 98.1399 999.21 101.087 991.957 105.62C984.704 109.927 981.077 116.5 981.077 125.34C981.077 133.047 983.457 138.827 988.217 142.68C992.977 146.307 999.21 148.12 1006.92 148.12Z" fill="#1E1E1E"/>
<path d="M851.027 185.52C824.507 185.52 802.86 179.513 786.087 167.5C769.54 155.487 760.473 138.713 758.887 117.18H807.847C809.433 126.927 813.967 134.293 821.447 139.28C828.927 144.267 838.22 146.76 849.327 146.76C855.447 146.76 861.227 145.967 866.667 144.38C872.107 142.793 876.527 140.3 879.927 136.9C883.327 133.273 885.027 128.853 885.027 123.64C885.027 118.427 883.44 114.347 880.267 111.4C877.32 108.227 872.787 105.733 866.667 103.92C860.773 102.107 852.727 100.407 842.527 98.82C841.167 98.5933 839.693 98.3667 838.107 98.14C836.747 97.9133 835.273 97.6867 833.687 97.46C817.593 95.42 804.56 92.9266 794.587 89.98C784.84 86.8066 777.473 82.6133 772.487 77.4C767.727 71.96 765.347 64.9333 765.347 56.32C765.347 45.8933 768.633 36.94 775.207 29.46C781.78 21.7533 790.847 15.9733 802.407 12.12C814.193 8.04 827.567 6 842.527 6C868.593 6 889.333 12.0067 904.747 24.02C920.387 36.0333 928.887 53.0333 930.247 75.02H883.327C882.647 65.0467 878.793 57.5667 871.767 52.58C864.74 47.5933 856.127 45.1 845.927 45.1C836.86 45.1 829.04 47.2533 822.467 51.56C815.893 55.64 812.607 61.5333 812.607 69.24C812.607 73.5467 813.967 77.2867 816.687 80.46C819.633 83.6333 824.053 86.3533 829.947 88.62C835.84 90.66 843.547 92.36 853.067 93.72C854.653 93.9466 856.24 94.1733 857.827 94.4C859.64 94.6267 861.453 94.8533 863.267 95.08C864.173 95.3067 865.08 95.42 865.987 95.42C866.893 95.42 867.8 95.5333 868.707 95.76C882.987 97.5733 894.66 100.18 903.727 103.58C912.793 106.98 919.48 111.4 923.787 116.84C928.093 122.053 930.247 128.74 930.247 136.9C930.247 147.1 926.847 155.827 920.047 163.08C913.247 170.333 903.84 175.887 891.827 179.74C879.813 183.593 866.213 185.52 851.027 185.52Z" fill="#1E1E1E"/>
<path d="M666.667 184.16C649.441 184.16 633.8 180.42 619.747 172.94C605.92 165.46 594.927 155.147 586.767 142C578.834 128.853 574.867 113.893 574.867 97.1199C574.867 79.6665 578.947 64.1399 587.107 50.5399C595.267 36.9399 606.374 26.3999 620.427 18.9199C634.481 11.2132 650.007 7.35986 667.007 7.35986C684.007 7.35986 699.307 11.2132 712.907 18.9199C726.734 26.3999 737.614 36.9399 745.547 50.5399C753.481 63.9132 757.447 78.9865 757.447 95.7599C757.447 96.2132 757.447 96.7799 757.447 97.4599C757.447 98.1399 757.447 98.7065 757.447 99.1599H621.447C621.901 107.32 624.167 114.687 628.247 121.26C632.554 127.607 637.994 132.707 644.567 136.56C651.367 140.187 658.847 142 667.007 142C674.941 142 682.081 140.413 688.427 137.24C694.774 134.067 699.194 129.873 701.687 124.66H752.347C751.214 134.18 746.907 143.587 739.427 152.88C732.174 161.947 722.201 169.427 709.507 175.32C697.041 181.213 682.761 184.16 666.667 184.16ZM712.907 92.3599C712.454 84.1999 710.187 76.9465 706.107 70.5999C702.027 64.0265 696.587 58.9265 689.787 55.2999C683.214 51.4465 675.734 49.5199 667.347 49.5199C659.187 49.5199 651.707 51.4465 644.907 55.2999C638.334 58.9265 632.894 64.0265 628.587 70.5999C624.507 76.9465 622.241 84.1999 621.787 92.3599H712.907Z" fill="#1E1E1E"/>
<path d="M288 174.928V-7.85056e-06L335.277 11.0719V68.7981C337.998 49.6727 344.233 34.7455 353.983 24.0165C363.733 13.0544 376.998 7.57331 393.777 7.57331C412.37 7.57331 426.429 13.171 435.952 24.3664C445.475 35.3286 451.144 50.9555 452.958 71.2471C455.452 51.1887 461.461 35.5618 470.984 24.3664C480.735 13.171 494.453 7.57331 512.139 7.57331C527.104 7.57331 538.895 10.722 547.511 17.0194C556.354 23.0836 562.59 31.7134 566.218 42.9088C570.073 54.1042 572 68.0984 572 84.8915V186L524.383 174.928V92.5883C524.156 80.6932 520.869 71.1305 514.52 63.9001C508.171 56.4365 499.895 52.7048 489.691 52.7048C482.889 52.7048 476.766 54.5706 471.325 58.3024C465.883 62.0342 461.574 67.0488 458.4 73.3462C455.226 79.6437 453.638 86.7574 453.638 94.6875V186L406.022 174.928V92.5883C405.795 80.6932 402.507 71.1305 396.158 63.9001C389.809 56.4365 381.533 52.7048 371.329 52.7048C364.527 52.7048 358.405 54.5706 352.963 58.3024C347.521 62.0342 343.213 67.0488 340.038 73.3462C336.864 79.6437 335.277 86.7574 335.277 94.6875V186L288 174.928Z" fill="#1E1E1E"/>
<path d="M130 100.76H250V163.76C250 173.149 242.389 180.76 233 180.76H130V100.76Z" fill="url(#paint0_linear_55_2816)"/>
<path d="M0 27.7598C0 18.3709 7.61116 10.7598 17 10.7598H120V90.7598H0V27.7598Z" fill="#3984FF"/>
<rect y="100.76" width="120" height="80" fill="#FF3F3F"/>
<rect x="130" y="11" width="120" height="80" fill="#6AC9D0"/>
<defs>
<linearGradient id="paint0_linear_55_2816" x1="130" y1="101" x2="244.5" y2="175.5" gradientUnits="userSpaceOnUse">
<stop stop-color="#C6229B"/>
<stop offset="0.284203" stop-color="#EA0E78"/>
<stop offset="0.581908" stop-color="#FE3452"/>
<stop offset="0.757174" stop-color="#FE7340"/>
<stop offset="1" stop-color="#FFC32E"/>
</linearGradient>
</defs>
</svg>

            </div>
          </div>
        </div>
      </div>
      <script>
        // Automatic small adjustments after load if necessary
      </script>
    </body>
  </html>`;
}

// ---- Main Page ----
export default function AnalyticsContaPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const clientId = parseInt(id || '', 10);

  const { data: clientes = [], isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes'], queryFn: getClientes,
  });

  const cliente = clientes.find(c => c.id === clientId);

  const { data: igSummary, isLoading: loadingIg, error: igError } = useQuery({
    queryKey: ['ig-summary', clientId],
    queryFn: () => getInstagramSummary(clientId),
    enabled: !!clientId && !isNaN(clientId) && !!cliente,
  });

  if (isNaN(clientId) || clientId <= 0) {
    return <div className="card"><p style={{ color: 'var(--danger)' }}>ID de cliente inválido.</p></div>;
  }

  if (loadingClientes || loadingIg) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!cliente) {
    return <div className="card"><p style={{ color: 'var(--danger)' }}>Cliente não encontrado.</p></div>;
  }

  if (igError) {
    const msg = igError instanceof Error ? igError.message : 'Erro';
    if (msg === 'TOKEN_EXPIRED') {
      return (
        <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>Token do Instagram expirado</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Reconecte a conta Instagram para continuar visualizando os analytics.</p>
          <Button style={{ marginTop: '1rem' }} onClick={() => navigate(`/cliente/${clientId}`)}>Reconectar Conta</Button>
        </div>
      );
    }
    return <div className="card"><p style={{ color: 'var(--danger)' }}>Erro ao carregar analytics: {msg}</p></div>;
  }

  if (!igSummary) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <header className="header animate-up">
          <div className="header-title"><h1>Analytics</h1></div>
          <div className="header-actions">
            <Button variant="outline" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
          </div>
        </header>
        <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>Instagram não conectado</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Conecte a conta Instagram deste cliente para acessar os analytics.</p>
          <Button style={{ marginTop: '1rem' }} onClick={() => navigate(`/cliente/${clientId}`)}>Ir para o perfil do cliente</Button>
        </div>
      </div>
    );
  }

  return (
    <AnalyticsContent
      clientId={clientId}
      cliente={cliente}
      account={igSummary.account}
    />
  );
}
