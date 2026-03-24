import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Zap, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Chart, registerables } from 'chart.js';
import { getPortfolioSummary, getPortfolioAIAnalysis, type PortfolioAccount } from '../../services/analytics';
import { syncInstagramData } from '../../services/instagram';

Chart.register(...registerables);

function formatNumber(n: number) {
  return n.toLocaleString('pt-BR');
}

function BenchmarkChart({ accounts }: { accounts: PortfolioAccount[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || accounts.length < 2) return;
    const canvas = canvasRef.current;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e0e0e0' : '#333';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    const sorted = [...accounts].sort((a, b) => a.engagement_rate_avg - b.engagement_rate_avg);
    const avg = accounts.reduce((s, a) => s + a.engagement_rate_avg, 0) / accounts.length;

    const chart = new Chart(canvas, {
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
    return () => chart.destroy();
  }, [accounts]);

  if (accounts.length < 2) return null;
  return (
    <div style={{ position: 'relative', height: Math.max(200, accounts.length * 40) }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function AIPortfolioSection({ accounts }: { accounts: PortfolioAccount[] }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getPortfolioAIAnalysis();
      if (!result || result.analysis.error) {
        setError('Não foi possível gerar a análise. Tente novamente.');
        return;
      }
      setAnalysis({ ...result.analysis, generatedAt: result.generatedAt });
    } catch {
      setError('Erro ao gerar análise. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (accounts.length < 1) return null;

  return (
    <div className="card animate-up">
      <div className="dashboard-hub-card-header" style={{ marginBottom: '1rem' }}>
        <h3>Análise Inteligente do Portfólio</h3>
        <Button onClick={handleGenerate} disabled={loading} size="sm">
          {loading ? <Spinner size="sm" /> : <Zap className="h-4 w-4" />}
          Gerar Análise IA
        </Button>
      </div>

      {!analysis && !error && !loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Clique para obter uma análise estratégica do portfólio com IA.
        </p>
      )}

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {analysis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <h4 style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>Resumo do Portfólio</h4>
            <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.portfolioSummary}</p>
          </div>
          <div>
            <h4 style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>Insights Cruzados</h4>
            <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.crossAccountInsights}</p>
          </div>
          <div>
            <h4 style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>Resumo Mensal</h4>
            <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{analysis.monthlyDigest}</p>
          </div>
          <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
            <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Ações Prioritárias</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {analysis.priorityActions.map((r: string, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <span className="badge badge-success" style={{ fontSize: '0.7rem', minWidth: 20, textAlign: 'center' }}>{i + 1}</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>
            Gerado em {new Date(analysis.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          </p>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: number; failed: number } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['portfolio-summary'],
    queryFn: getPortfolioSummary,
  });

  const handleSyncAll = async () => {
    if (!data?.accounts.length) return;
    setSyncing(true);
    setSyncResult(null);
    let success = 0;
    let failed = 0;
    await Promise.allSettled(
      data.accounts.map(a =>
        syncInstagramData(a.client_id).then(() => success++).catch(() => failed++)
      )
    );
    setSyncing(false);
    setSyncResult({ success, failed });
    refetch();
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <p style={{ color: 'var(--danger)' }}>
          Erro ao carregar analytics: {error instanceof Error ? error.message : 'Erro desconhecido'}
        </p>
      </div>
    );
  }

  const { accounts, summary } = data;

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


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <h1>Analytics Instagram</h1>
          <p>Visão geral de todas as contas conectadas.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {syncResult && (
            <span style={{ fontSize: '0.8rem', color: syncResult.failed > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {syncResult.success} sincronizada{syncResult.success !== 1 ? 's' : ''}
              {syncResult.failed > 0 && `, ${syncResult.failed} falhou`}
            </span>
          )}
          <Button onClick={handleSyncAll} disabled={syncing || !data?.accounts.length} size="sm" variant="outline">
            <RefreshCw className={`h-4 w-4${syncing ? ' animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar Tudo'}
          </Button>
        </div>
      </header>

      {silentAccounts.length > 0 && (
        <div className="analytics-callout animate-up">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <strong style={{ color: 'var(--warning)' }}>Contas Silenciosas</strong>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {silentAccounts.map(a => {
              const daysSince = a.last_post_at
                ? Math.floor((Date.now() - new Date(a.last_post_at).getTime()) / 86400000)
                : null;
              return (
                <Link key={a.client_id} to={`/analytics/${a.client_id}`} className="silent-account-chip">
                  <span className="avatar" style={{ width: 24, height: 24, fontSize: '0.6rem', background: a.client_cor }}>{a.client_sigla}</span>
                  <span>{a.client_name}</span>
                  <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>
                    {daysSince !== null ? `${daysSince}d sem postar` : 'Sem posts'}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="kpi-grid animate-up">
        <div className="kpi-card card-dark">
          <span className="kpi-label" style={{ color: 'rgba(255,255,255,0.7)' }}>CONTAS CONECTADAS</span>
          <span className="kpi-value" style={{ color: '#ffffff' }}>
            {summary.connected} <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)' }}>/ {summary.total}</span>
          </span>
          <span className="kpi-sub" style={{ color: 'var(--success)' }}>{summary.growing} crescendo</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">SEGUIDORES TOTAIS</span>
          <span className="kpi-value">{formatNumber(totalFollowers)}</span>
          <span className="kpi-sub" style={{ color: 'var(--text-muted)' }}>{summary.declining} em declínio</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">ALCANCE TOTAL (28D)</span>
          <span className="kpi-value">{formatNumber(totalReach)}</span>
          <span className="kpi-sub" style={{ color: 'var(--text-muted)' }}>Soma de todas as contas</span>
        </div>
        <div className="kpi-card card-blue">
          <span className="kpi-label" style={{ color: 'rgba(0,0,0,0.6)' }}>ENGAJAMENTO MÉDIO</span>
          <span className="kpi-value" style={{ color: 'var(--dark)' }}>{avgEngagement.toFixed(2)}%</span>
          <span className="kpi-sub" style={{ color: 'rgba(0,0,0,0.7)' }}>Média de todas as contas</span>
        </div>
      </div>

      {accounts.length > 0 && (() => {
        const bestByReach = [...accounts].sort((a, b) => b.reach_28d - a.reach_28d)[0];
        const mostPosts = [...accounts].sort((a, b) => b.posts_last_30d - a.posts_last_30d)[0];
        const mostFollowers = [...accounts].sort((a, b) => b.follower_count - a.follower_count)[0];
        return (
          <div className="kpi-grid animate-up" style={{ marginTop: 0 }}>
            {summary.bestByEngagement && (
              <div className="kpi-card" style={{ borderLeft: '3px solid var(--success)' }}>
                <span className="kpi-label">MELHOR ENGAJAMENTO</span>
                <span className="kpi-value" style={{ fontSize: '1.1rem' }}>{summary.bestByEngagement.client_name}</span>
                <span className="kpi-sub" style={{ color: 'var(--success)' }}>{summary.bestByEngagement.engagement_rate_avg.toFixed(2)}%</span>
              </div>
            )}
            {summary.mostImproved && summary.mostImproved.follower_delta > 0 && (
              <div className="kpi-card" style={{ borderLeft: '3px solid var(--primary-color)' }}>
                <span className="kpi-label">MAIOR CRESCIMENTO</span>
                <span className="kpi-value" style={{ fontSize: '1.1rem' }}>{summary.mostImproved.client_name}</span>
                <span className="kpi-sub" style={{ color: 'var(--primary-color)' }}>+{formatNumber(summary.mostImproved.follower_delta)} seguidores</span>
              </div>
            )}
            {bestByReach && bestByReach.reach_28d > 0 && (
              <div className="kpi-card" style={{ borderLeft: '3px solid var(--info, #3b82f6)' }}>
                <span className="kpi-label">MAIOR ALCANCE</span>
                <span className="kpi-value" style={{ fontSize: '1.1rem' }}>{bestByReach.client_name}</span>
                <span className="kpi-sub" style={{ color: 'var(--info, #3b82f6)' }}>{formatNumber(bestByReach.reach_28d)} alcance 28d</span>
              </div>
            )}
            {mostFollowers && (
              <div className="kpi-card" style={{ borderLeft: '3px solid var(--warning, #f59e0b)' }}>
                <span className="kpi-label">MAIS SEGUIDORES</span>
                <span className="kpi-value" style={{ fontSize: '1.1rem' }}>{mostFollowers.client_name}</span>
                <span className="kpi-sub" style={{ color: 'var(--warning, #f59e0b)' }}>{formatNumber(mostFollowers.follower_count)} seguidores</span>
              </div>
            )}
            {mostPosts && mostPosts.posts_last_30d > 0 && (
              <div className="kpi-card" style={{ borderLeft: '3px solid var(--text-muted)' }}>
                <span className="kpi-label">MAIS ATIVO</span>
                <span className="kpi-value" style={{ fontSize: '1.1rem' }}>{mostPosts.client_name}</span>
                <span className="kpi-sub" style={{ color: 'var(--text-muted)' }}>{mostPosts.posts_last_30d} posts em 30d</span>
              </div>
            )}
          </div>
        );
      })()}

      <div className="card animate-up">
        <div className="dashboard-hub-card-header" style={{ marginBottom: '1rem' }}>
          <h3>Todas as Contas</h3>
        </div>
        {accounts.length === 0
          ? <p style={{ color: 'var(--text-muted)' }}>Nenhuma conta Instagram conectada. Conecte contas na página de cada cliente.</p>
          : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Seguidores</TableHead>
                    <TableHead>Engajamento</TableHead>
                    <TableHead>Alcance (28d)</TableHead>
                    <TableHead>Posts (30d)</TableHead>
                    <TableHead>Último Post</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...accounts].sort((a, b) => b.engagement_rate_avg - a.engagement_rate_avg).map(a => {
                    const daysSince = a.last_post_at
                      ? Math.floor((Date.now() - new Date(a.last_post_at).getTime()) / 86400000)
                      : null;
                    const isSilent = daysSince === null || daysSince > 7;
                    const deltaColor = a.follower_delta > 0 ? 'var(--success)' : a.follower_delta < 0 ? 'var(--danger)' : 'var(--text-muted)';
                    const deltaIcon = a.follower_delta > 0 ? '↑' : a.follower_delta < 0 ? '↓' : '→';
                    return (
                      <TableRow key={a.client_id}>
                        <TableCell data-label="Cliente">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {a.profile_picture_url
                              ? <img src={a.profile_picture_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                              : <span className="avatar" style={{ width: 32, height: 32, fontSize: '0.65rem', background: a.client_cor }}>{a.client_sigla}</span>
                            }
                            <div>
                              <strong>{a.client_name}</strong>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{a.username}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell data-label="Seguidores">
                          {formatNumber(a.follower_count)}
                          {a.follower_delta !== 0 && (
                            <span style={{ color: deltaColor, fontSize: '0.75rem', marginLeft: 4 }}>
                              {deltaIcon}{formatNumber(Math.abs(a.follower_delta))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell data-label="Engajamento">
                          <Badge variant={a.engagement_rate_avg >= 3 ? 'default' : a.engagement_rate_avg >= 1 ? 'secondary' : 'outline'}>
                            {a.engagement_rate_avg.toFixed(2)}%
                          </Badge>
                        </TableCell>
                        <TableCell data-label="Alcance (28d)">{formatNumber(a.reach_28d)}</TableCell>
                        <TableCell data-label="Posts (30d)">{a.posts_last_30d}</TableCell>
                        <TableCell data-label="Último Post">
                          {daysSince !== null
                            ? <span style={{ color: isSilent ? 'var(--danger)' : 'var(--text-main)' }}>{daysSince}d atrás</span>
                            : <span style={{ color: 'var(--danger)' }}>Sem posts</span>
                          }
                        </TableCell>
                        <TableCell>
                          <Link to={`/analytics/${a.client_id}`} className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', whiteSpace: 'nowrap' }}>
                            Ver Analytics
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
      </div>

      {accounts.length >= 2 && (
        <div className="widgets-grid animate-up">
          <div className="card">
            <div className="dashboard-hub-card-header">
              <h3>Benchmarking de Engajamento</h3>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <BenchmarkChart accounts={accounts} />
            </div>
          </div>

          {specialtyStats.length >= 2 && (
            <div className="card">
              <div className="dashboard-hub-card-header">
                <h3>Por Especialidade</h3>
              </div>
              <div style={{ marginTop: '1rem' }}>
                {specialtyStats.map(s => (
                  <div key={s.specialty} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))' }}>
                    <div>
                      <strong>{s.specialty}</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{s.count} conta{s.count > 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Badge variant={s.avgEngagement >= 3 ? 'default' : s.avgEngagement >= 1 ? 'secondary' : 'outline'}>{s.avgEngagement.toFixed(2)}%</Badge>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{formatNumber(s.avgFollowers)} seg. médio</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AIPortfolioSection accounts={accounts} />
    </div>
  );
}
