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
          borderColor: '#eab308',
          backgroundColor: 'rgba(234,179,8,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: history.map(h => h.source === 'manual' ? 5 : postDateSet.has(h.date) ? 6 : 2),
          pointStyle: history.map(h => h.source === 'manual' ? 'rectRot' : 'circle'),
          pointBackgroundColor: history.map(h => h.source === 'manual' ? '#8b5cf6' : postDateSet.has(h.date) ? '#f5a342' : '#eab308'),
          pointBorderColor: history.map(h => h.source === 'manual' ? '#8b5cf6' : postDateSet.has(h.date) ? '#f5a342' : '#eab308'),
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 10 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor } },
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

  const scoreColor = analysis ? (analysis.healthScore >= 70 ? 'var(--success)' : analysis.healthScore >= 40 ? 'var(--warning)' : 'var(--danger)') : '';

  return (
    <div className="card animate-up">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3>Análise Inteligente</h3>
        <Button size="sm" variant="outline" disabled={loading} onClick={handleGenerate}>{loading ? <Spinner size="sm" /> : <Zap className="h-3 w-3" />} Gerar Análise IA</Button>
      </div>
      {!analysis && !error && !loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Clique em "Gerar Análise IA" para obter insights personalizados.</p>
      )}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {analysis && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '2.8rem', fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{analysis.healthScore}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Health Score</div>
              <p style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>{analysis.healthExplanation}</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '1.25rem', padding: '1.25rem 0', borderBottom: '1px solid var(--border-color)' }}>
            <div>
              <h4 style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>Performance de Conteúdo</h4>
              <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.contentInsights}</p>
            </div>
            <div>
              <h4 style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>Análise de Legendas</h4>
              <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.captionAnalysis}</p>
            </div>
            <div>
              <h4 style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}>Projeção de Crescimento</h4>
              <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.growthForecast}</p>
            </div>
          </div>
          <div style={{ paddingTop: '1.25rem' }}>
            <h4 style={{ fontSize: '0.8rem', marginBottom: '0.6rem', color: 'var(--text-muted)' }}>Recomendações</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {analysis.topRecommendations.map((r: string, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', fontSize: '0.85rem' }}>
                  <span className="badge badge-success" style={{ fontSize: '0.7rem', minWidth: 20, textAlign: 'center' }}>{i + 1}</span>
                  <span style={{ lineHeight: 1.4 }}>{r}</span>
                </div>
              ))}
            </div>
          </div>
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
          <Button variant="outline" onClick={() => navigate(`/cliente/${clientId}`)}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3>Crescimento de Seguidores</h3>
          <Button size="sm" variant="outline" onClick={() => setManualFollowerOpen(true)}>✏ Inserir manualmente</Button>
        </div>
        <FollowerChart history={history} postDates={postDates} />
      </div>

      {/* Content Performance Table */}
      <div className="card animate-up">
        <h3>Performance de Conteúdo</h3>
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
                      { col: 'engagement_rate', label: 'Eng.' },
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
                        <td><span className="badge badge-info">{formatMediaType(p.media_type)}</span></td>
                        <td>{p.reach.toLocaleString('pt-BR')}</td>
                        <td>
                          <span className={`badge ${p.engagement_rate >= 5 ? 'badge-success' : p.engagement_rate >= 2 ? 'badge-warning' : 'badge-neutral'}`}>
                            {p.engagement_rate.toFixed(1)}%
                          </span>
                        </td>
                        <td>{p.saved}</td>
                        <td>{p.comments}</td>
                        <td>{p.shares}</td>
                        <td onClick={e => e.stopPropagation()}>
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
          <h3>Desempenho por Tipo</h3>
          <TypeChart typeBreakdown={typeBreakdown} />
        </div>
        <div className="card">
          <h3>Desempenho por Tópico</h3>
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
      <div className="widgets-grid animate-up" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h3>Demografia da Audiência</h3>
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
          <h3>Melhor Horário para Postar</h3>
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
          <h3>Relatórios Gerados</h3>
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
      let tds = `<td style="font-weight:bold; font-size:11px;">${d.labels_days[day].substring(0,3)}</td>`;
      for (let h = 0; h < d.heatmap[day].length; h+=3) {
         const val1 = d.heatmap[day][h] || 0;
         const val2 = d.heatmap[day][h+1] || 0;
         const val3 = d.heatmap[day][h+2] || 0;
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

    const tops = d.topSlots.slice(0,3).map((t,i) => `
      <div style="font-size:13px; margin-bottom:4px; display:flex; gap:8px;">
        <span style="background:#f5a342; color:#fff; border-radius:12px; height:20px; width:20px; text-align:center; line-height:20px; font-size:11px;">${i+1}</span>
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
              <svg width="70" height="24" viewBox="100 0 400 200" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform:translateY(1px)">
                <path d="M372.2 135.185C368.552 135.185 364.838 134.721 361.057 133.792C357.276 132.93 354.125 131.769 351.604 130.31L352.102 116.778H353.097L356.181 123.246C357.11 125.103 358.105 126.761 359.166 128.22C360.228 129.613 361.687 130.708 363.544 131.504C364.871 132.167 366.131 132.631 367.325 132.897C368.585 133.096 369.978 133.195 371.504 133.195C375.55 133.195 378.734 132.101 381.056 129.912C383.444 127.723 384.637 124.904 384.637 121.455C384.637 118.204 383.842 115.684 382.25 113.893C380.658 112.036 378.104 110.245 374.588 108.52L370.509 106.729C364.804 104.208 360.327 101.323 357.077 98.0728C353.893 94.7563 352.301 90.3784 352.301 84.9392C352.301 81.0257 353.296 77.6428 355.286 74.7905C357.342 71.9383 360.161 69.7494 363.743 68.2237C367.391 66.6981 371.637 65.9353 376.479 65.9353C379.994 65.9353 383.311 66.3996 386.428 67.3283C389.612 68.2569 392.365 69.5172 394.687 71.1091L394.09 83.0488H393.095L389.015 75.5865C387.888 73.2649 386.76 71.6398 385.632 70.7112C384.505 69.7162 383.211 69.0197 381.752 68.6217C380.89 68.3564 380.094 68.1906 379.364 68.1242C378.635 67.9916 377.706 67.9252 376.578 67.9252C373.195 67.9252 370.343 68.9202 368.021 70.9102C365.7 72.8338 364.539 75.4539 364.539 78.7704C364.539 82.1533 365.435 84.8729 367.226 86.9292C369.016 88.9191 371.637 90.7101 375.086 92.302L379.663 94.292C386.03 97.0779 390.607 100.063 393.393 103.247C396.179 106.364 397.572 110.41 397.572 115.385C397.572 121.222 395.35 125.998 390.906 129.713C386.528 133.361 380.293 135.185 372.2 135.185Z" fill="#0A0B0E"/>
                <path d="M427.448 86.9431L419.951 108.452L410.377 78.9695L399.632 109.913H419.442L418.748 111.903H398.935L394.159 125.932C393.695 127.392 393.528 128.553 393.661 129.415C393.86 130.277 394.657 130.973 396.05 131.504L398.238 132.399V133.394H384.508V132.399L386.995 131.504C388.322 130.973 389.35 130.343 390.08 129.613C390.81 128.817 391.406 127.723 391.87 126.33L412.367 67.5271H420.824L427.448 86.9431ZM420.784 111.903L416.009 125.932C415.545 127.392 415.378 128.553 415.511 129.415C415.71 130.277 416.507 130.973 417.899 131.504L420.088 132.399V133.394H406.357V132.399L408.845 131.504C410.171 130.973 411.2 130.343 411.93 129.613C412.659 128.817 413.255 127.723 413.72 126.33L418.748 111.903H420.784ZM435.965 111.903L441.022 126.728C441.553 128.187 442.15 129.315 442.813 130.111C443.396 130.752 444.261 131.316 445.407 131.803C445.327 131.837 445.245 131.87 445.161 131.902L443.669 132.399V133.394H421.819V132.399L423.312 131.902C424.704 131.371 425.534 130.641 425.799 129.713C426.13 128.718 426.097 127.557 425.699 126.23L421.023 111.903H435.965ZM462.872 126.728C463.403 128.187 464 129.315 464.663 130.111C465.326 130.841 466.354 131.471 467.747 132.002L468.941 132.399V133.394H447.092V132.399L445.897 132.002C445.729 131.937 445.565 131.871 445.407 131.803C446.652 131.282 447.399 130.585 447.648 129.713C447.98 128.718 447.947 127.557 447.549 126.23L442.873 111.903H435.965L435.285 109.913H442.275L432.227 78.9695L428.443 89.8611L427.448 86.9431L434.217 67.5271H442.674L462.872 126.728ZM420.426 109.913H419.442L419.951 108.452L420.426 109.913ZM435.285 109.913H421.481L428.443 89.8611L435.285 109.913Z" fill="#FF9E21"/>
                <path d="M474.779 135.185C471.131 135.185 467.417 134.721 463.636 133.792C459.855 132.93 456.704 131.769 454.184 130.31L454.681 116.778H455.676L458.76 123.246C459.689 125.103 460.684 126.761 461.745 128.22C462.807 129.613 464.266 130.708 466.123 131.504C467.45 132.167 468.71 132.631 469.904 132.897C471.164 133.096 472.557 133.195 474.083 133.195C478.129 133.195 481.313 132.101 483.635 129.912C486.023 127.723 487.217 124.904 487.217 121.455C487.217 118.204 486.421 115.684 484.829 113.893C483.237 112.036 480.683 110.245 477.167 108.52L473.088 106.729C467.384 104.208 462.906 101.323 459.656 98.0728C456.472 94.7563 454.88 90.3784 454.88 84.9392C454.88 81.0257 455.875 77.6428 457.865 74.7905C459.921 71.9383 462.74 69.7494 466.322 68.2237C469.97 66.6981 474.216 65.9353 479.058 65.9353C482.573 65.9353 485.89 66.3996 489.008 67.3283C492.191 68.2569 494.944 69.5172 497.266 71.1091L496.669 83.0488H495.674L491.594 75.5865C490.467 73.2649 489.339 71.6398 488.212 70.7112C487.084 69.7162 485.79 69.0197 484.331 68.6217C483.469 68.3564 482.673 68.1906 481.943 68.1242C481.214 67.9916 480.285 67.9252 479.157 67.9252C475.774 67.9252 472.922 68.9202 470.601 70.9102C468.279 72.8338 467.118 75.4539 467.118 78.7704C467.118 82.1533 468.014 84.8729 469.805 86.9292C471.596 88.9191 474.216 90.7101 477.665 92.302L482.242 94.292C488.61 97.0779 493.186 100.063 495.972 103.247C498.758 106.364 500.151 110.41 500.151 115.385C500.151 121.222 497.929 125.998 493.485 129.713C489.107 133.361 482.872 135.185 474.779 135.185Z" fill="#0A0B0E"/>
                <path d="M297.413 132.399V133.394H347.062L347.659 118.072H346.664L342.585 127.425C342.12 128.685 341.523 129.68 340.794 130.409C340.064 131.073 339.036 131.404 337.709 131.404H317.611V100.461H328.257C329.584 100.461 330.579 100.826 331.242 101.555C331.905 102.219 332.536 103.147 333.133 104.341L335.122 108.52H336.117V90.6106H335.122L333.133 94.5905C332.602 95.7845 331.972 96.7463 331.242 97.4759C330.579 98.1392 329.584 98.4709 328.257 98.4709H317.611V69.7163H335.52C336.847 69.7163 337.842 70.0811 338.505 70.8107C339.169 71.5404 339.799 72.5022 340.396 73.6961L344.674 83.0489H345.669L345.072 67.7263H302.686V126.529C302.686 127.856 302.454 128.917 301.99 129.713C301.592 130.443 300.829 131.04 299.702 131.504L297.413 132.399Z" fill="#0A0B0E"/>
                <path d="M247.092 133.394V132.399L249.082 131.703C251.337 130.973 252.465 129.083 252.465 126.032V75.0891C252.465 73.7625 252.299 72.7012 251.967 71.9052C251.702 71.1092 250.939 70.4459 249.679 69.9153L247.092 68.7213V67.7263H266.295L284.702 115.883L302.014 67.7263H314.224V68.7213L312.632 69.3183C311.371 69.7826 310.509 70.4459 310.045 71.3082C309.58 72.1042 309.348 73.1655 309.348 74.4921V126.529C309.348 127.856 309.514 128.884 309.846 129.613C310.177 130.343 310.973 130.973 312.234 131.504L314.224 132.399V133.394H296.84V132.399L298.93 131.504C300.19 130.973 300.986 130.343 301.318 129.613C301.649 128.884 301.815 127.856 301.815 126.529V104.142L302.014 75.6861L281.219 133.394H276.244L254.554 76.3826L254.853 101.157V126.231C254.853 127.69 255.052 128.884 255.45 129.812C255.914 130.675 256.776 131.305 258.036 131.703L260.225 132.399V133.394H247.092Z" fill="#0A0B0E"/>
                <rect x="118.708" y="106.579" width="36.1281" height="14.8383" rx="3.22572" fill="#FF9E21"/>
                <rect x="164.514" y="106.579" width="36.1281" height="14.8383" rx="3.22572" fill="#FF9E21"/>
                <path d="M100 133.675V94.4551H218.823V133.675" stroke="#FF9E21" stroke-width="12.7829"/>
                <path d="M150.255 82.064H123.405C121.632 82.064 120.294 80.4592 120.621 78.7171C121.099 76.1686 121.732 72.8525 122.333 69.8442C123.266 65.1688 127.195 64 129.042 64H144.503C148.587 64 150.921 67.4534 151.504 69.8442C151.847 71.247 152.524 75.4027 153.052 78.8113C153.318 80.5245 151.989 82.064 150.255 82.064Z" fill="#FF9E21"/>
                <path d="M196.06 82.064H169.209C167.437 82.064 166.098 80.4592 166.425 78.7171C166.904 76.1686 167.537 72.8525 168.137 69.8442C169.071 65.1688 172.999 64 174.847 64H190.308C194.392 64 196.726 67.4534 197.309 69.8442C197.652 71.247 198.329 75.4027 198.857 78.8113C199.123 80.5245 197.794 82.064 196.06 82.064Z" fill="#FF9E21"/>
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
            <Button variant="outline" onClick={() => navigate('/analytics')}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
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
