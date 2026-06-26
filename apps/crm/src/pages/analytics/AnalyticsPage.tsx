import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Zap,
  RefreshCw,
  ArrowUpDown,
  SlidersHorizontal,
  Trophy,
  AlertTriangle,
  ChevronRight,
  Heart,
  MessageCircle,
  Bookmark,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Chart, registerables } from 'chart.js';
import {
  getPortfolioSummary,
  getPortfolioAIAnalysis,
  type PortfolioAccount,
  type PortfolioTopPost,
} from '../../services/analytics';
import { sanitizeUrl } from '../../utils/security';
import { formatRate } from '../../lib/ig-rates';
import { syncInstagramData } from '../../services/instagram';
import { HelpTooltip } from '../../components/help/HelpTooltip';

Chart.register(...registerables);

function BulletText({ text }: { text: unknown }) {
  if (!text || typeof text !== 'string') {
    return <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{String(text ?? '')}</p>;
  }
  const lines = text
    .split(/\n|[,.]?\s*•\s*/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{text}</p>;
  }
  return (
    <ul
      style={{
        fontSize: '0.85rem',
        lineHeight: 1.6,
        margin: 0,
        paddingLeft: '1.2rem',
        listStyle: 'disc',
      }}
    >
      {lines.map((line, i) => (
        <li key={i} style={{ marginBottom: '0.25rem' }}>
          {line}
        </li>
      ))}
    </ul>
  );
}

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
        labels: sorted.map((a) => a.client_name),
        datasets: [
          {
            data: sorted.map((a) => a.engagement_rate_avg),
            backgroundColor: sorted.map((a) =>
              a.engagement_rate_avg >= avg ? 'rgba(62, 207, 142, 0.7)' : 'rgba(245, 90, 66, 0.5)',
            ),
            borderRadius: 4,
            barThickness: 24,
          },
        ],
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
          {/* Portfolio Health */}
          {analysis.portfolioHealth && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                paddingBottom: '0.75rem',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div
                style={{
                  fontSize: '2.4rem',
                  fontWeight: 800,
                  color:
                    analysis.portfolioHealth.score >= 70
                      ? 'var(--success)'
                      : analysis.portfolioHealth.score >= 40
                        ? 'var(--warning)'
                        : 'var(--danger)',
                  lineHeight: 1,
                }}
              >
                {analysis.portfolioHealth.score}
              </div>
              <div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                  }}
                >
                  Saúde do Portfólio
                </div>
                <p style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
                  {analysis.portfolioHealth.summary}
                </p>
              </div>
            </div>
          )}

          {/* Account Ranking */}
          {analysis.accountRanking && analysis.accountRanking.length > 0 && (
            <div>
              <h4 style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>Ranking de Contas</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {analysis.accountRanking.map((acc: any, i: number) => {
                  const statusColor =
                    acc.status === 'destaque'
                      ? 'var(--success)'
                      : acc.status === 'estável'
                        ? 'var(--info)'
                        : acc.status === 'atenção'
                          ? 'var(--warning)'
                          : 'var(--danger)';
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '0.5rem',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span
                        className="badge"
                        style={{
                          fontSize: '0.65rem',
                          minWidth: 52,
                          textAlign: 'center',
                          background: statusColor + '20',
                          color: statusColor,
                          border: `1px solid ${statusColor}40`,
                        }}
                      >
                        {acc.status}
                      </span>
                      <span style={{ fontWeight: 600 }}>{acc.username}</span>
                      <span style={{ color: 'var(--text-muted)' }}>— {acc.keyMetric}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <h4 style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>Insights Cruzados</h4>
            <BulletText text={analysis.crossAccountInsights} />
          </div>
          {analysis.resourceAllocation && (
            <div>
              <h4 style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>Alocação de Esforço</h4>
              <BulletText text={analysis.resourceAllocation} />
            </div>
          )}
          <div>
            <h4 style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>Resumo Mensal</h4>
            <BulletText text={analysis.monthlyDigest} />
          </div>

          {/* Priority Actions */}
          {analysis.priorityActions && analysis.priorityActions.length > 0 && (
            <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
              <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Ações Prioritárias</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {analysis.priorityActions.map((a: any, i: number) => {
                  const pColor =
                    a.prioridade === 'alta'
                      ? 'var(--danger)'
                      : a.prioridade === 'media'
                        ? 'var(--warning)'
                        : 'var(--success)';
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '0.5rem',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span
                        className="badge"
                        style={{
                          fontSize: '0.65rem',
                          minWidth: 44,
                          textAlign: 'center',
                          background: pColor + '20',
                          color: pColor,
                          border: `1px solid ${pColor}40`,
                        }}
                      >
                        {a.prioridade}
                      </span>
                      <div style={{ lineHeight: 1.4 }}>
                        <span style={{ fontWeight: 600 }}>{a.conta}: </span>
                        <span>{a.acao}</span>
                        <div
                          style={{
                            fontSize: '0.8rem',
                            color: 'var(--text-muted)',
                            marginTop: '0.1rem',
                          }}
                        >
                          {a.impacto}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>
            Gerado em{' '}
            {new Date(analysis.generatedAt).toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })}
          </p>
        </div>
      )}
    </div>
  );
}

type SortCol =
  | 'client_name'
  | 'follower_count'
  | 'engagement_rate_avg'
  | 'reach_28d'
  | 'alcance_seg'
  | 'posts_last_30d'
  | 'website_clicks_28d'
  | 'last_post_at';

export default function AnalyticsPage() {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: number;
    failed: number;
    failedNames: string[];
  } | null>(null);
  const [sortColumn, setSortColumn] = useState<SortCol>('engagement_rate_avg');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [days, setDays] = useState<number>(28);
  const [clienteFilter, setClienteFilter] = useState<string>('all');
  const [drawerSort, setDrawerSort] = useState<'best' | 'worst' | null>(null);
  const [drawerOrderBy, setDrawerOrderBy] = useState<string>('reach');
  const [drawerAsc, setDrawerAsc] = useState(false);
  const [drawerClientFilter, setDrawerClientFilter] = useState<string>('all');
  const [drawerFormatFilter, setDrawerFormatFilter] = useState<string>('all');
  const [drawerDateFrom, setDrawerDateFrom] = useState<string>('');
  const [drawerDateTo, setDrawerDateTo] = useState<string>('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['portfolio-summary', days],
    queryFn: () => getPortfolioSummary(days),
  });

  const drawerClients = useMemo(() => {
    const names = new Set((data?.allRankedPosts ?? []).map((p) => p.client_name));
    return [...names].sort();
  }, [data?.allRankedPosts]);

  const reachRankedPosts = useMemo(() => {
    return [...(data?.allRankedPosts ?? [])].sort((a, b) => b.reach - a.reach);
  }, [data?.allRankedPosts]);

  const matureReachRankedPosts = useMemo(() => {
    const cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
    return [...(data?.allRankedPosts ?? [])]
      .filter((p) => new Date(p.posted_at).getTime() < cutoff48h)
      .sort((a, b) => a.reach - b.reach);
  }, [data?.allRankedPosts]);

  const drawerPosts = useMemo(() => {
    let posts =
      drawerSort === 'worst' ? [...matureReachRankedPosts] : [...(data?.allRankedPosts ?? [])];

    if (drawerClientFilter !== 'all') {
      posts = posts.filter((p) => p.client_name === drawerClientFilter);
    }
    if (drawerFormatFilter !== 'all') {
      posts = posts.filter((p) => p.media_type === drawerFormatFilter);
    }
    if (drawerDateFrom) {
      const from = new Date(drawerDateFrom).getTime();
      posts = posts.filter((p) => new Date(p.posted_at).getTime() >= from);
    }
    if (drawerDateTo) {
      const to = new Date(drawerDateTo + 'T23:59:59').getTime();
      posts = posts.filter((p) => new Date(p.posted_at).getTime() <= to);
    }

    const dir = drawerAsc ? 1 : -1;
    switch (drawerOrderBy) {
      case 'engagement':
        posts.sort((a, b) => (a.engagement_rate - b.engagement_rate) * dir);
        break;
      case 'likes':
        posts.sort((a, b) => (a.likes - b.likes) * dir);
        break;
      case 'comments':
        posts.sort((a, b) => (a.comments - b.comments) * dir);
        break;
      case 'saved':
        posts.sort((a, b) => (a.saved - b.saved) * dir);
        break;
      case 'share_rate':
      case 'like_rate':
      case 'save_rate':
      case 'comment_rate': {
        const key = drawerOrderBy as 'share_rate' | 'like_rate' | 'save_rate' | 'comment_rate';
        posts.sort((a, b) => {
          const va = a.rates[key];
          const vb = b.rates[key];
          if (va === null && vb === null) return 0;
          if (va === null) return 1; // nulls last regardless of dir
          if (vb === null) return -1;
          return (va - vb) * dir;
        });
        break;
      }
      case 'reach':
        posts.sort((a, b) => (a.reach - b.reach) * dir);
        break;
      case 'date':
        posts.sort(
          (a, b) => (new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime()) * dir,
        );
        break;
    }

    return posts;
  }, [
    data?.allRankedPosts,
    drawerAsc,
    drawerOrderBy,
    drawerClientFilter,
    drawerFormatFilter,
    drawerDateFrom,
    drawerDateTo,
    drawerSort,
    matureReachRankedPosts,
  ]);

  const handleSyncAll = async () => {
    if (!data?.accounts.length) return;
    setSyncing(true);
    setSyncResult(null);
    let success = 0;
    let failed = 0;
    const failedNames: string[] = [];
    await Promise.allSettled(
      data.accounts.map((a) =>
        syncInstagramData(a.client_id)
          .then(() => success++)
          .catch(() => {
            failed++;
            failedNames.push(a.client_name);
          }),
      ),
    );
    setSyncing(false);
    setSyncResult({ success, failed, failedNames });
    refetch();
  };

  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}
      >
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

  const filteredAccounts =
    clienteFilter === 'all'
      ? accounts
      : accounts.filter((a) => String(a.client_id) === clienteFilter);

  const silentAccounts = filteredAccounts.filter((a) => {
    if (!a.last_post_at) return true;
    const daysSince = (Date.now() - new Date(a.last_post_at).getTime()) / 86400000;
    return daysSince > 7;
  });

  const totalFollowers = filteredAccounts.reduce((s, a) => s + a.follower_count, 0);
  const totalReach = filteredAccounts.reduce((s, a) => s + a.reach_28d, 0);
  const avgEngagement =
    filteredAccounts.length > 0
      ? filteredAccounts.reduce((s, a) => s + a.engagement_rate_avg, 0) / filteredAccounts.length
      : 0;
  const avgWebsiteClicks =
    filteredAccounts.length > 0
      ? Math.round(
          filteredAccounts.reduce((s, a) => s + (a.website_clicks_28d ?? 0), 0) /
            filteredAccounts.length,
        )
      : 0;

  const specialtyMap: Record<string, PortfolioAccount[]> = {};
  for (const a of filteredAccounts) {
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

  const handleSort = (col: SortCol) => {
    if (sortColumn === col) setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSortColumn(col);
      setSortDirection('desc');
    }
  };

  const renderSortableHead = (col: SortCol, label: string) => (
    <TableHead onClick={() => handleSort(col)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {label}
        <ArrowUpDown
          className="h-3 w-3"
          style={{
            opacity: sortColumn === col ? 1 : 0.3,
            transform: sortColumn === col && sortDirection === 'desc' ? 'scaleY(-1)' : 'none',
          }}
        />
      </div>
    </TableHead>
  );

  const sortedAccounts = [...filteredAccounts].sort((a, b) => {
    let valA: any = a[sortColumn as keyof typeof a];
    let valB: any = b[sortColumn as keyof typeof b];

    if (sortColumn === 'alcance_seg') {
      valA = a.follower_count ? a.reach_28d / a.follower_count : 0;
      valB = b.follower_count ? b.reach_28d / b.follower_count : 0;
    } else if (sortColumn === 'last_post_at') {
      valA = a.last_post_at ? new Date(a.last_post_at).getTime() : 0;
      valB = b.last_post_at ? new Date(b.last_post_at).getTime() : 0;
    }

    if (typeof valA === 'string' && typeof valB === 'string') {
      const cmp = valA.localeCompare(valB);
      return sortDirection === 'asc' ? cmp : -cmp;
    }

    valA = valA || 0;
    valB = valB || 0;
    return sortDirection === 'asc' ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1;
  });

  const sortedClientOptions = [...accounts]
    .sort((a, b) => a.client_name.localeCompare(b.client_name, 'pt-BR'))
    .filter((a, i, arr) => arr.findIndex((x) => x.client_id === a.client_id) === i); // dedupe

  return (
    <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <h1>Analytics</h1>
        </div>
        <div className="header-actions">
          {syncResult && (
            <span
              style={{
                fontSize: '0.8rem',
                color: syncResult.failed > 0 ? 'var(--warning)' : 'var(--success)',
              }}
            >
              {syncResult.success} sincronizada{syncResult.success !== 1 ? 's' : ''}
              {syncResult.failed > 0 &&
                `, ${syncResult.failed} falhou: ${syncResult.failedNames.join(', ')}`}
            </span>
          )}
          <Button
            onClick={handleSyncAll}
            disabled={syncing || !data?.accounts.length}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4${syncing ? ' animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sync'}
          </Button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <Select value={clienteFilter} onValueChange={setClienteFilter}>
          <SelectTrigger className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto">
            <SelectValue placeholder="Todos os clientes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {sortedClientOptions.map((a) => (
              <SelectItem key={a.client_id} value={String(a.client_id)}>
                {a.client_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto min-w-[130px] shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 dias</SelectItem>
            <SelectItem value="28">28 dias</SelectItem>
            <SelectItem value="90">90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {silentAccounts.length > 0 && (
        <div className="analytics-callout animate-up">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
            <strong style={{ color: 'var(--warning)' }}>Contas Silenciosas</strong>
            {silentAccounts.map((a) => {
              const daysSince = a.last_post_at
                ? Math.floor((Date.now() - new Date(a.last_post_at).getTime()) / 86400000)
                : null;
              return (
                <Link
                  key={a.client_id}
                  to={`/analytics/${a.client_id}`}
                  className="silent-account-chip"
                >
                  <span
                    className="avatar"
                    style={{ width: 24, height: 24, fontSize: '0.6rem', background: a.client_cor }}
                  >
                    {a.client_sigla}
                  </span>
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

      <div className="kpi-grid analytics-kpi-scroll animate-up">
        <div className="kpi-card card-dark">
          <span className="kpi-label" style={{ color: 'rgba(255,255,255,0.7)' }}>
            CONTAS CONECTADAS
          </span>
          <span className="kpi-value" style={{ color: '#ffffff' }}>
            {summary.connected}{' '}
            <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)' }}>
              / {summary.total}
            </span>
          </span>
          <span className="kpi-sub" style={{ color: 'var(--success)' }}>
            {summary.growing} crescendo
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">SEGUIDORES TOTAIS</span>
          <span className="kpi-value">{formatNumber(totalFollowers)}</span>
          <span className="kpi-sub" style={{ color: 'var(--text-muted)' }}>
            {summary.declining} em declínio
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">ALCANCE TOTAL (28D)</span>
          <span className="kpi-value">{formatNumber(totalReach)}</span>
          <span className="kpi-sub" style={{ color: 'var(--text-muted)' }}>
            Soma de todas as contas
          </span>
        </div>
        <div className="kpi-card card-blue">
          <span className="kpi-label" style={{ color: 'rgba(0,0,0,0.6)' }}>
            ENGAJAMENTO MÉDIO
          </span>
          <span className="kpi-value" style={{ color: 'var(--dark)' }}>
            {avgEngagement.toFixed(2)}%
          </span>
          <span className="kpi-sub" style={{ color: 'rgba(0,0,0,0.7)' }}>
            Média de todas as contas
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">CLIQUES NO LINK (28D)</span>
          <span className="kpi-value">{formatNumber(avgWebsiteClicks)}</span>
          <span className="kpi-sub" style={{ color: 'var(--text-muted)' }}>
            Média por conta
          </span>
        </div>
      </div>

      {filteredAccounts.length > 0 &&
        (() => {
          const bestByReach = [...filteredAccounts].sort((a, b) => b.reach_28d - a.reach_28d)[0];
          const mostPosts = [...filteredAccounts].sort(
            (a, b) => b.posts_last_30d - a.posts_last_30d,
          )[0];
          const mostFollowers = [...filteredAccounts].sort(
            (a, b) => b.follower_count - a.follower_count,
          )[0];
          return (
            <div className="kpi-grid analytics-kpi-scroll animate-up" style={{ marginTop: 0 }}>
              {summary.bestByEngagement && (
                <div className="kpi-card" style={{ borderLeft: '3px solid var(--success)' }}>
                  <span className="kpi-label">MELHOR ENGAJAMENTO</span>
                  <span className="kpi-value" style={{ fontSize: '1.1rem' }}>
                    {summary.bestByEngagement.client_name}
                  </span>
                  <span className="kpi-sub" style={{ color: 'var(--success)' }}>
                    {summary.bestByEngagement.engagement_rate_avg.toFixed(2)}%
                  </span>
                </div>
              )}
              {summary.mostImproved && summary.mostImproved.follower_delta > 0 && (
                <div className="kpi-card" style={{ borderLeft: '3px solid var(--primary-color)' }}>
                  <span className="kpi-label">MAIOR CRESCIMENTO</span>
                  <span className="kpi-value" style={{ fontSize: '1.1rem' }}>
                    {summary.mostImproved.client_name}
                  </span>
                  <span className="kpi-sub" style={{ color: 'var(--primary-color)' }}>
                    +{formatNumber(summary.mostImproved.follower_delta)} seguidores
                  </span>
                </div>
              )}
              {bestByReach && bestByReach.reach_28d > 0 && (
                <div className="kpi-card" style={{ borderLeft: '3px solid var(--info, #3b82f6)' }}>
                  <span className="kpi-label">MAIOR ALCANCE</span>
                  <span className="kpi-value" style={{ fontSize: '1.1rem' }}>
                    {bestByReach.client_name}
                  </span>
                  <span className="kpi-sub" style={{ color: 'var(--info, #3b82f6)' }}>
                    {formatNumber(bestByReach.reach_28d)} alcance 28d
                  </span>
                </div>
              )}
              {mostFollowers && (
                <div
                  className="kpi-card"
                  style={{ borderLeft: '3px solid var(--warning, #f59e0b)' }}
                >
                  <span className="kpi-label">MAIS SEGUIDORES</span>
                  <span className="kpi-value" style={{ fontSize: '1.1rem' }}>
                    {mostFollowers.client_name}
                  </span>
                  <span className="kpi-sub" style={{ color: 'var(--warning, #f59e0b)' }}>
                    {formatNumber(mostFollowers.follower_count)} seguidores
                  </span>
                </div>
              )}
              {mostPosts && mostPosts.posts_last_30d > 0 && (
                <div className="kpi-card" style={{ borderLeft: '3px solid var(--text-muted)' }}>
                  <span className="kpi-label">MAIS ATIVO</span>
                  <span className="kpi-value" style={{ fontSize: '1.1rem' }}>
                    {mostPosts.client_name}
                  </span>
                  <span className="kpi-sub" style={{ color: 'var(--text-muted)' }}>
                    {mostPosts.posts_last_30d} posts em 30d
                  </span>
                </div>
              )}
            </div>
          );
        })()}

      {/* Top posts */}
      {reachRankedPosts.length > 0 && (
        <div className="card animate-up">
          <div className="dashboard-hub-card-header" style={{ marginBottom: '1rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} />
              Melhores Posts
              <HelpTooltip content="Top 5 posts com maior alcance no período selecionado." />
            </h3>
            {reachRankedPosts.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDrawerSort('best');
                  setDrawerAsc(false);
                }}
                style={{ fontSize: '0.75rem', gap: '0.25rem' }}
              >
                Ver mais <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="analytics-posts-row">
            {reachRankedPosts.slice(0, 5).map((post) => (
              <a
                key={post.id}
                href={sanitizeUrl(post.permalink)}
                target="_blank"
                rel="noopener noreferrer"
                className="analytics-post-card"
              >
                <div
                  style={{
                    aspectRatio: '3/4',
                    position: 'relative',
                    overflow: 'hidden',
                    background:
                      post.media_type === 'VIDEO'
                        ? 'linear-gradient(135deg, #8b5cf6, #8b5cf6dd)'
                        : post.media_type === 'CAROUSEL_ALBUM'
                          ? 'linear-gradient(135deg, #10b981, #10b981dd)'
                          : 'linear-gradient(135deg, #3b82f6, #3b82f6dd)',
                  }}
                >
                  {post.thumbnail_url ? (
                    <img
                      src={post.thumbnail_url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <div
                        style={{
                          width: 60,
                          height: 60,
                          borderRadius: 8,
                          background: 'rgba(255,255,255,0.15)',
                        }}
                      />
                    </div>
                  )}
                  <span
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      background: 'rgba(0,0,0,0.5)',
                      color: '#fff',
                      fontSize: '0.6rem',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontWeight: 600,
                    }}
                  >
                    {{ CAROUSEL_ALBUM: 'Carrossel', VIDEO: 'Reels', IMAGE: 'Imagem' }[
                      post.media_type
                    ] ?? post.media_type}
                  </span>
                </div>
                <div
                  style={{
                    padding: '0.75rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {post.client_name}
                  </span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
                    {format(new Date(post.posted_at), "d 'de' MMM", { locale: ptBR })}
                  </span>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Alcance</span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--success)',
                      }}
                    >
                      {formatNumber(post.reach)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Engajamento
                    </span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {post.engagement_rate.toFixed(2)}%
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-start',
                      gap: '0.5rem',
                      marginTop: 2,
                    }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        fontSize: '0.65rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <Heart className="h-3 w-3" />{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                        {formatNumber(post.likes)}
                      </strong>
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        fontSize: '0.65rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <MessageCircle className="h-3 w-3" />{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                        {formatNumber(post.comments)}
                      </strong>
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        fontSize: '0.65rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <Bookmark className="h-3 w-3" />{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                        {formatNumber(post.saved)}
                      </strong>
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Worst posts */}
      {(() => {
        if (matureReachRankedPosts.length === 0) return null;
        return (
          <div className="card animate-up">
            <div className="dashboard-hub-card-header" style={{ marginBottom: '1rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle className="h-5 w-5" style={{ color: 'var(--warning)' }} />
                Precisam de Atenção
                <HelpTooltip content="Posts com pelo menos 48h desde a publicação e menor alcance no período." />
              </h3>
              {matureReachRankedPosts.length > 5 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDrawerSort('worst');
                    setDrawerAsc(true);
                  }}
                  style={{ fontSize: '0.75rem', gap: '0.25rem' }}
                >
                  Ver mais <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="analytics-posts-row">
              {matureReachRankedPosts.slice(0, 5).map((post) => (
                <a
                  key={post.id}
                  href={sanitizeUrl(post.permalink)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="analytics-post-card"
                >
                  <div
                    style={{
                      aspectRatio: '3/4',
                      position: 'relative',
                      overflow: 'hidden',
                      background:
                        post.media_type === 'VIDEO'
                          ? 'linear-gradient(135deg, #8b5cf6, #8b5cf6dd)'
                          : post.media_type === 'CAROUSEL_ALBUM'
                            ? 'linear-gradient(135deg, #10b981, #10b981dd)'
                            : 'linear-gradient(135deg, #3b82f6, #3b82f6dd)',
                    }}
                  >
                    {post.thumbnail_url ? (
                      <img
                        src={post.thumbnail_url}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <div
                          style={{
                            width: 60,
                            height: 60,
                            borderRadius: 8,
                            background: 'rgba(255,255,255,0.15)',
                          }}
                        />
                      </div>
                    )}
                    <span
                      style={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        background: 'rgba(0,0,0,0.5)',
                        color: '#fff',
                        fontSize: '0.6rem',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontWeight: 600,
                      }}
                    >
                      {{ CAROUSEL_ALBUM: 'Carrossel', VIDEO: 'Reels', IMAGE: 'Imagem' }[
                        post.media_type
                      ] ?? post.media_type}
                    </span>
                  </div>
                  <div
                    style={{
                      padding: '0.75rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {post.client_name}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
                      {format(new Date(post.posted_at), "d 'de' MMM", { locale: ptBR })}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Alcance
                      </span>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--danger)',
                        }}
                      >
                        {formatNumber(post.reach)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Engajamento
                      </span>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {post.engagement_rate.toFixed(2)}%
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'flex-start',
                        gap: '0.5rem',
                        marginTop: 2,
                      }}
                    >
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          fontSize: '0.65rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <Heart className="h-3 w-3" />{' '}
                        <strong
                          style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}
                        >
                          {formatNumber(post.likes)}
                        </strong>
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          fontSize: '0.65rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <MessageCircle className="h-3 w-3" />{' '}
                        <strong
                          style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}
                        >
                          {formatNumber(post.comments)}
                        </strong>
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          fontSize: '0.65rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <Bookmark className="h-3 w-3" />{' '}
                        <strong
                          style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}
                        >
                          {formatNumber(post.saved)}
                        </strong>
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Desktop table */}
      <div className="card animate-up analytics-desktop-table">
        <div className="dashboard-hub-card-header" style={{ marginBottom: '1rem' }}>
          <h3>Todas as Contas</h3>
        </div>
        {filteredAccounts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>
            Nenhuma conta Instagram conectada. Conecte contas na página de cada cliente.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {renderSortableHead('client_name', 'Cliente')}
                  {renderSortableHead('follower_count', 'Seguidores')}
                  {renderSortableHead('engagement_rate_avg', 'Engajamento')}
                  {renderSortableHead('reach_28d', 'Alcance (28d)')}
                  {renderSortableHead('alcance_seg', 'Alcance / Seg.')}
                  {renderSortableHead('posts_last_30d', 'Posts (30d)')}
                  {renderSortableHead('website_clicks_28d', 'Cliques no link')}
                  {renderSortableHead('last_post_at', 'Último Post')}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAccounts.map((a) => {
                  const daysSince = a.last_post_at
                    ? Math.floor((Date.now() - new Date(a.last_post_at).getTime()) / 86400000)
                    : null;
                  const isSilent = daysSince === null || daysSince > 7;
                  const deltaColor =
                    a.follower_delta > 0
                      ? 'var(--success)'
                      : a.follower_delta < 0
                        ? 'var(--danger)'
                        : 'var(--text-muted)';
                  const deltaIcon = a.follower_delta > 0 ? '↑' : a.follower_delta < 0 ? '↓' : '→';
                  return (
                    <TableRow key={a.client_id}>
                      <TableCell data-label="Cliente">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {a.profile_picture_url ? (
                            <img
                              src={a.profile_picture_url}
                              alt=""
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: '50%',
                                objectFit: 'cover',
                              }}
                            />
                          ) : (
                            <span
                              className="avatar"
                              style={{
                                width: 32,
                                height: 32,
                                fontSize: '0.65rem',
                                background: a.client_cor,
                              }}
                            >
                              {a.client_sigla}
                            </span>
                          )}
                          <div>
                            <Link
                              to={`/analytics/${a.client_id}`}
                              style={{ color: 'inherit', textDecoration: 'none' }}
                            >
                              <strong style={{ cursor: 'pointer' }}>{a.client_name}</strong>
                            </Link>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              @{a.username}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell data-label="Seguidores">
                        {formatNumber(a.follower_count)}
                        {a.follower_delta !== 0 && (
                          <span style={{ color: deltaColor, fontSize: '0.75rem', marginLeft: 4 }}>
                            {deltaIcon}
                            {formatNumber(Math.abs(a.follower_delta))}
                          </span>
                        )}
                      </TableCell>
                      <TableCell data-label="Engajamento">
                        <Badge
                          variant={
                            a.engagement_rate_avg >= 3
                              ? 'default'
                              : a.engagement_rate_avg >= 1
                                ? 'secondary'
                                : 'outline'
                          }
                        >
                          {a.engagement_rate_avg.toFixed(2)}%
                        </Badge>
                      </TableCell>
                      <TableCell data-label="Alcance (28d)">{formatNumber(a.reach_28d)}</TableCell>
                      <TableCell data-label="Alcance / Seg.">
                        {a.follower_count > 0
                          ? ((a.reach_28d / a.follower_count) * 100).toFixed(1) + '%'
                          : '0.0%'}
                      </TableCell>
                      <TableCell data-label="Posts (30d)">{a.posts_last_30d}</TableCell>
                      <TableCell data-label="Cliques no link (28d)">
                        {formatNumber(a.website_clicks_28d ?? 0)}
                      </TableCell>
                      <TableCell data-label="Último Post">
                        {daysSince !== null ? (
                          <span style={{ color: isSilent ? 'var(--danger)' : 'var(--text-main)' }}>
                            {daysSince}d atrás
                          </span>
                        ) : (
                          <span style={{ color: 'var(--danger)' }}>Sem posts</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="analytics-mobile-cards">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.5rem',
          }}
        >
          <h3
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '1.1rem',
              fontWeight: 600,
              margin: 0,
            }}
          >
            Todas as Contas
          </h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8 shrink-0 mb-0">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortColumn}
                onValueChange={(v) => {
                  setSortColumn(v as SortCol);
                  setSortDirection('desc');
                }}
              >
                <DropdownMenuRadioItem value="client_name">Nome</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="follower_count">Seguidores</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="engagement_rate_avg">
                  Engajamento
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="reach_28d">Alcance</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="posts_last_30d">Posts (30d)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="last_post_at">Último Post</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
              >
                <ArrowUpDown className="h-4 w-4 mr-2" />
                {sortDirection === 'asc' ? 'Decrescente' : 'Crescente'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {filteredAccounts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Nenhuma conta conectada.
          </p>
        ) : (
          sortedAccounts.map((a) => {
            const daysSince = a.last_post_at
              ? Math.floor((Date.now() - new Date(a.last_post_at).getTime()) / 86400000)
              : null;
            const isSilent = daysSince === null || daysSince > 7;
            const deltaColor =
              a.follower_delta > 0
                ? 'var(--success)'
                : a.follower_delta < 0
                  ? 'var(--danger)'
                  : 'var(--text-muted)';
            const deltaIcon = a.follower_delta > 0 ? '↑' : a.follower_delta < 0 ? '↓' : '';
            return (
              <Link
                key={a.client_id}
                to={`/analytics/${a.client_id}`}
                className="team-card card animate-up"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  {a.profile_picture_url ? (
                    <img
                      src={a.profile_picture_url}
                      alt=""
                      className="client-avatar"
                      style={{ objectFit: 'cover', flexShrink: 0 }}
                    />
                  ) : (
                    <span
                      className="avatar client-avatar"
                      style={{ background: a.client_cor, flexShrink: 0 }}
                    >
                      {a.client_sigla}
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.client_name}</span>
                      <Badge
                        variant={
                          a.engagement_rate_avg >= 3
                            ? 'default'
                            : a.engagement_rate_avg >= 1
                              ? 'secondary'
                              : 'outline'
                        }
                        style={{ fontSize: '0.6rem', padding: '0 0.4rem' }}
                      >
                        {a.engagement_rate_avg.toFixed(2)}%
                      </Badge>
                    </div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: '#888',
                        display: 'flex',
                        gap: '0.35rem',
                        flexWrap: 'wrap',
                        marginTop: 2,
                      }}
                    >
                      <span>{formatNumber(a.follower_count)} seg.</span>
                      {a.follower_delta !== 0 && (
                        <span style={{ color: deltaColor }}>
                          {deltaIcon}
                          {formatNumber(Math.abs(a.follower_delta))}
                        </span>
                      )}
                      <span>&bull;</span>
                      <span>{formatNumber(a.reach_28d)} alcance</span>
                      <span>&bull;</span>
                      {daysSince !== null ? (
                        <span style={{ color: isSilent ? 'var(--danger)' : undefined }}>
                          {daysSince}d atrás
                        </span>
                      ) : (
                        <span style={{ color: 'var(--danger)' }}>Sem posts</span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {filteredAccounts.length >= 2 && (
        <div className="widgets-grid animate-up">
          <div className="card">
            <div className="dashboard-hub-card-header">
              <h3>Benchmarking de Engajamento</h3>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <BenchmarkChart accounts={filteredAccounts} />
            </div>
          </div>

          {specialtyStats.length >= 2 && (
            <div className="card">
              <div className="dashboard-hub-card-header">
                <h3>Por Especialidade</h3>
              </div>
              <div style={{ marginTop: '1rem' }}>
                {specialtyStats.map((s) => (
                  <div
                    key={s.specialty}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.5rem 0',
                      borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))',
                    }}
                  >
                    <div>
                      <strong>{s.specialty}</strong>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          marginLeft: '0.5rem',
                        }}
                      >
                        {s.count} conta{s.count > 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Badge
                        variant={
                          s.avgEngagement >= 3
                            ? 'default'
                            : s.avgEngagement >= 1
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {s.avgEngagement.toFixed(2)}%
                      </Badge>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {formatNumber(s.avgFollowers)} seg. médio
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AIPortfolioSection accounts={filteredAccounts} />

      <Sheet
        open={drawerSort !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDrawerSort(null);
            setDrawerOrderBy('reach');
            setDrawerAsc(false);
            setDrawerClientFilter('all');
            setDrawerFormatFilter('all');
            setDrawerDateFrom('');
            setDrawerDateTo('');
          }
        }}
      >
        <SheetContent side="right" className="!w-full !max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {drawerSort === 'best' ? (
                <>
                  <Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} /> Todos os Posts
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5" style={{ color: 'var(--warning)' }} /> Todos os
                  Posts
                </>
              )}
            </SheetTitle>
            <SheetDescription>
              {drawerPosts.length} de{' '}
              {drawerSort === 'worst'
                ? matureReachRankedPosts.length
                : (data?.allRankedPosts?.length ?? 0)}{' '}
              posts
              {['share_rate', 'like_rate', 'save_rate', 'comment_rate'].includes(drawerOrderBy) && (
                <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Top 200 por alcance, reordenado por taxa
                </span>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-3 grid gap-2 border-b border-border pb-3">
            <div className="grid grid-cols-[minmax(0,1fr)_2.25rem_minmax(0,1fr)] items-center gap-2">
              <Select value={drawerOrderBy} onValueChange={setDrawerOrderBy}>
                <SelectTrigger className="h-9 rounded-lg text-sm">
                  <SelectValue placeholder="Ordenar por" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reach">Alcance</SelectItem>
                  <SelectItem value="engagement">Engajamento</SelectItem>
                  <SelectItem value="likes">Curtidas</SelectItem>
                  <SelectItem value="comments">Comentários</SelectItem>
                  <SelectItem value="saved">Salvos</SelectItem>
                  <SelectItem value="share_rate">Compart./visualização</SelectItem>
                  <SelectItem value="like_rate">Curt./visualização</SelectItem>
                  <SelectItem value="save_rate">Salvos/visualização</SelectItem>
                  <SelectItem value="comment_rate">Coment./visualização</SelectItem>
                  <SelectItem value="date">Data</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setDrawerAsc((v) => !v)}
                className="mb-0 h-9 w-9 shrink-0 rounded-lg"
                title={drawerAsc ? 'Crescente' : 'Decrescente'}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
              </Button>
              <Select value={drawerFormatFilter} onValueChange={setDrawerFormatFilter}>
                <SelectTrigger className="h-9 rounded-lg text-sm">
                  <SelectValue placeholder="Formato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os formatos</SelectItem>
                  <SelectItem value="IMAGE">Imagem</SelectItem>
                  <SelectItem value="VIDEO">Reels</SelectItem>
                  <SelectItem value="CAROUSEL_ALBUM">Carrossel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select value={drawerClientFilter} onValueChange={setDrawerClientFilter}>
                <SelectTrigger className="h-9 rounded-lg text-sm">
                  <SelectValue placeholder="Cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os clientes</SelectItem>
                  {drawerClients.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <Input
                type="date"
                value={drawerDateFrom}
                onChange={(e) => setDrawerDateFrom(e.target.value)}
                className="h-9 rounded-lg font-mono text-sm"
              />
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="date"
                value={drawerDateTo}
                onChange={(e) => setDrawerDateTo(e.target.value)}
                className="h-9 rounded-lg font-mono text-sm"
              />
            </div>
            {(drawerDateFrom || drawerDateTo) && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setDrawerDateFrom('');
                    setDrawerDateTo('');
                  }}
                  className="text-xs font-medium text-destructive"
                >
                  Limpar datas
                </button>
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              marginTop: '0.75rem',
            }}
          >
            {drawerPosts.map((post, i) => (
              <a
                key={post.id}
                href={sanitizeUrl(post.permalink)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.6rem 0.75rem',
                  borderRadius: 12,
                  border: '1px solid var(--border-color)',
                  background: 'var(--card-bg)',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--card-bg)')}
              >
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)',
                    minWidth: 24,
                    textAlign: 'center',
                  }}
                >
                  {i + 1}
                </span>
                {post.thumbnail_url ? (
                  <img
                    src={post.thumbnail_url}
                    alt=""
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 8,
                      objectFit: 'cover',
                      flexShrink: 0,
                      background: 'var(--surface-darker)',
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 8,
                      flexShrink: 0,
                      background:
                        post.media_type === 'VIDEO'
                          ? '#8b5cf6'
                          : post.media_type === 'CAROUSEL_ALBUM'
                            ? '#10b981'
                            : '#3b82f6',
                    }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      style={{
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {post.client_name}
                    </span>
                    <span
                      style={{ fontSize: '0.65rem', color: 'var(--text-light)', flexShrink: 0 }}
                    >
                      {format(new Date(post.posted_at), "d 'de' MMM", { locale: ptBR })}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.75rem',
                      fontSize: '0.7rem',
                      color: 'var(--text-muted)',
                      marginTop: 2,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>
                      Alcance{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                        {formatNumber(post.reach)}
                      </strong>
                    </span>
                    <span>
                      Eng.{' '}
                      <strong
                        style={{
                          fontFamily: 'var(--font-mono)',
                          color:
                            post.engagement_rate >= 3
                              ? 'var(--success)'
                              : post.engagement_rate < 1
                                ? 'var(--danger)'
                                : 'var(--text-main)',
                        }}
                      >
                        {post.engagement_rate.toFixed(2)}%
                      </strong>
                    </span>
                    {['share_rate', 'like_rate', 'save_rate', 'comment_rate'].includes(drawerOrderBy) && (
                      <span>
                        {{ share_rate: 'Compart.', like_rate: 'Curt.', save_rate: 'Salvos', comment_rate: 'Coment.' }[drawerOrderBy]}
                        /view{' '}
                        <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                          {formatRate(post.rates[drawerOrderBy as 'share_rate' | 'like_rate' | 'save_rate' | 'comment_rate'])}
                        </strong>
                      </span>
                    )}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <Heart className="h-3 w-3" />{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                        {formatNumber(post.likes)}
                      </strong>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <MessageCircle className="h-3 w-3" />{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                        {formatNumber(post.comments)}
                      </strong>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <Bookmark className="h-3 w-3" />{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                        {formatNumber(post.saved)}
                      </strong>
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
