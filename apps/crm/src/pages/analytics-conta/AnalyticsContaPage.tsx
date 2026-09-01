import { Fragment, type ReactNode, useMemo, useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Bookmark,
  ChevronRight,
  FileText,
  Heart,
  MessageCircle,
  Play,
  Plus,
  RefreshCw,
  Trophy,
  Zap,
  Users,
  Eye,
  MousePointerClick,
  Send,
  ChevronDown,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { StatCard, type StatTone } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Chart, registerables } from 'chart.js';
import { getClientes } from '../../store';
import {
  getAnalyticsOverview,
  getAccountMetrics,
  makeDelta,
  getPostsAnalytics,
  getFollowerHistory,
  getAudienceDemographics,
  getBestPostingTimes,
  getTags,
  createTag,
  deleteTag,
  assignTagToPost,
  getClientReports,
  getAccountAIAnalysis,
  upsertManualFollowerCount,
  generateReport,
  sendReportEmail,
  getReportDownloadUrl,
  getClientRateBaseline,
  type KpiDelta,
  type PostAnalytics,
  type PostTag,
  type AudienceDemographics,
  type BestPostingTimes,
  type AnalyticsReport,
} from '../../services/analytics';
import { getInstagramSummary, syncInstagramData } from '../../services/instagram';
import { deleteReportDoc, listReportDocs } from '../../services/reportDocs';
import { openExternalUrl, sanitizeUrl } from '../../utils/security';
import {
  formatRate,
  IG_RATE_WEIGHTS,
  type Baseline,
  type Quartiles,
  type RateKey,
} from '../../lib/ig-rates';
import { captureEvent } from '@/lib/analytics';
import { InstagramPostCarousel } from '@/components/instagram/InstagramPostCarousel';
import { NewReportDialog } from './components/NewReportDialog';

Chart.register(...registerables);

// ---- Helpers ----
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

function formatMediaType(type: string): string {
  switch (type) {
    case 'VIDEO':
      return 'Reel';
    case 'CAROUSEL_ALBUM':
      return 'Carrossel';
    case 'IMAGE':
      return 'Imagem';
    case 'STORY':
      return 'Story';
    default:
      return type;
  }
}

function formatReportMonth(month: string): string {
  const [y, m] = month.split('-');
  const months = [
    'Jan',
    'Fev',
    'Mar',
    'Abr',
    'Mai',
    'Jun',
    'Jul',
    'Ago',
    'Set',
    'Out',
    'Nov',
    'Dez',
  ];
  return `${months[parseInt(m) - 1]} ${y}`;
}

function formatNumber(n: number): string {
  return (n || 0).toLocaleString('pt-BR');
}

// The account-metrics endpoint (Task 13) takes an explicit start/end range
// (end INCLUSIVE) — it has no "days" shorthand like the old /views endpoint.
// The "últimos N dias" tabs still drive the UI in days, so this translates
// that window into start/end with today as the inclusive end, same as the
// explicit calendar-month picker already does.
function lastNDaysRange(days: number, today: Date = new Date()): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const start = new Date(today.getTime() - (days - 1) * 86400000);
  return { start: fmt(start), end: fmt(today) };
}

function formatPostDate(date: string): string {
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function mediaAccentColor(type: string): string {
  switch (type) {
    case 'VIDEO':
      return '#8b5cf6';
    case 'CAROUSEL_ALBUM':
      return '#10b981';
    case 'IMAGE':
      return '#3b82f6';
    default:
      return '#64748b';
  }
}

function PostThumbnail({ post, size = 'card' }: { post: PostAnalytics; size?: 'card' | 'list' }) {
  const accent = mediaAccentColor(post.media_type);
  const dimensions =
    size === 'card' ? { width: '100%', height: '100%' } : { width: 52, height: 52 };

  if (post.thumbnail_url) {
    return (
      <img
        src={sanitizeUrl(post.thumbnail_url)}
        alt=""
        style={{
          ...dimensions,
          objectFit: 'cover',
          flexShrink: 0,
          background: 'var(--surface-darker)',
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  return (
    <div
      style={{
        ...dimensions,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
      }}
    >
      <span
        style={{ width: 42, height: 42, borderRadius: 8, background: 'rgba(255,255,255,0.18)' }}
      />
    </div>
  );
}

function RankedPostCard({ post, tone }: { post: PostAnalytics; tone: 'best' | 'worst' }) {
  const reachColor = tone === 'best' ? 'var(--success)' : 'var(--danger)';

  return (
    <a
      href={sanitizeUrl(post.permalink)}
      target="_blank"
      rel="noopener noreferrer"
      className="analytics-post-card"
      style={{ minWidth: 180, textDecoration: 'none', color: 'inherit' }}
    >
      <div
        style={{
          aspectRatio: '3/4',
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--surface-darker)',
        }}
      >
        <PostThumbnail post={post} />
        <span
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            fontSize: '0.6rem',
            padding: '2px 6px',
            borderRadius: 4,
            fontWeight: 600,
          }}
        >
          {formatMediaType(post.media_type)}
        </span>
      </div>
      <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <span
          style={{
            minHeight: 34,
            fontSize: '0.72rem',
            fontWeight: 600,
            color: 'var(--text-muted)',
            lineHeight: 1.35,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {post.caption || 'Sem legenda'}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
          {formatPostDate(post.posted_at)}
        </span>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Visualizações</span>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: reachColor,
            }}
          >
            {formatNumber(post.views)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Engajamento</span>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {post.engagement_rate.toFixed(2)}%
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-start',
            gap: '0.5rem',
            marginTop: 2,
            flexWrap: 'wrap',
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
  );
}

interface RankedPostsSectionProps {
  title: string;
  description: string;
  icon: ReactNode;
  posts: PostAnalytics[];
  tone: 'best' | 'worst';
  onSeeMore: () => void;
  canSeeMore: boolean;
}

function RankedPostsSection(props: RankedPostsSectionProps) {
  return (
    <InstagramPostCarousel
      title={props.title}
      description={props.description}
      ariaLabel={props.title}
      icon={props.icon}
      posts={props.posts}
      getKey={(post) => post.id}
      renderPost={(post) => <RankedPostCard post={post} tone={props.tone} />}
      action={
        props.canSeeMore ? (
          <Button variant="ghost" size="sm" onClick={props.onSeeMore}>
            Ver mais <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : undefined
      }
    />
  );
}

type RankedDrawerMode = 'best' | 'worst';
type RankedPostOrderBy =
  | 'engagement'
  | 'views'
  | 'reach'
  | 'likes'
  | 'comments'
  | 'saved'
  | 'shares'
  | 'date'
  | 'ig_score'
  | 'share_rate'
  | 'like_rate'
  | 'save_rate'
  | 'comment_rate';

// ---- KPI Card ----
function KpiCard({
  label,
  value,
  delta,
  period,
  prevFormatted,
  icon,
  tone,
  sub,
}: {
  label: string;
  value: string;
  delta?: KpiDelta;
  period?: string;
  prevFormatted?: string;
  icon?: LucideIcon;
  tone?: StatTone;
  sub?: ReactNode;
}) {
  return (
    <StatCard
      label={label}
      value={value}
      icon={icon}
      tone={tone}
      delta={
        delta
          ? {
              direction: delta.direction,
              percent: delta.deltaPercent,
              caption: 'vs período anterior',
            }
          : undefined
      }
      sub={sub}
      footNote={
        <>
          {prevFormatted != null && <span>Anterior: {prevFormatted}</span>}
          {period && <span className="kpi-period-chip">{period}</span>}
        </>
      }
    />
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
        labels: history.map((h) =>
          new Date(h.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        ),
        datasets: [
          {
            label: 'Seguidores',
            data: history.map((h) => h.follower_count),
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
              label: (ctx: any) => ` ${ctx.parsed.y.toLocaleString('pt-BR')} Seguidores`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: 10 },
          },
          y: {
            // @ts-ignore
            grid: { color: gridColor, borderDash: [5, 5] },
            ticks: { color: textColor, font: { size: 10 }, precision: 0 },
            beginAtZero: false,
          },
        },
      },
    });
    return () => chart.destroy();
  }, [history, postDates]);
  if (history.length < 2)
    return (
      <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
        Dados insuficientes. O histórico é construído diariamente.
      </p>
    );
  return (
    <div style={{ position: 'relative', height: 280, marginTop: '1rem' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ---- Insight helpers ----
const formatPct = (v: number) => v.toFixed(1).replace('.', ',');

const DAY_FULL: Record<string, string> = {
  Seg: 'Segunda',
  Ter: 'Terça',
  Qua: 'Quarta',
  Qui: 'Quinta',
  Sex: 'Sexta',
  Sab: 'Sábado',
  Sáb: 'Sábado',
  Dom: 'Domingo',
};

function InsightHeader({ kpi, sub }: { kpi: ReactNode; sub?: ReactNode }) {
  return (
    <div className="an-insight">
      <h3 className="an-insight-kpi">{kpi}</h3>
      {sub && <div className="an-insight-sub">{sub}</div>}
    </div>
  );
}

// ---- Type performance bars ----
function TypeChart({
  typeBreakdown,
}: {
  typeBreakdown: { type: string; count: number; avgEngagement: number }[];
}) {
  if (typeBreakdown.length === 0)
    return <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Sem dados.</p>;
  const max = Math.max(...typeBreakdown.map((t) => t.avgEngagement), 0.1);
  return (
    <div style={{ marginTop: '0.5rem' }}>
      {typeBreakdown.map((t, i) => {
        const pct = (t.avgEngagement / max) * 80;
        return (
          <div key={t.type} className="an-tbar-row">
            <div className="an-tbar-label">
              {t.type}
              <small>
                {t.count} post{t.count !== 1 ? 's' : ''}
              </small>
            </div>
            <div className="an-tbar-track">
              <div className={`an-tbar-fill${i > 0 ? ' dim' : ''}`} style={{ width: `${pct}%` }} />
              <span className="an-tbar-val" style={{ left: `${pct}%` }}>
                {formatPct(t.avgEngagement)}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Age Chart ----
function AgeChart({ demographics }: { demographics: AudienceDemographics }) {
  const groups = demographics.age_gender;
  if (groups.length === 0) return null;
  const maxVal = Math.max(...groups.flatMap((a) => [a.male, a.female]), 1);
  const total = groups.reduce((s, a) => s + a.male + a.female, 0);
  const hotIdx = groups.reduce(
    (best, a, i) => (a.male + a.female > groups[best].male + groups[best].female ? i : best),
    0,
  );
  const hotShare =
    total > 0 ? Math.round(((groups[hotIdx].male + groups[hotIdx].female) / total) * 100) : 0;
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div className="an-age-chart">
        {groups.map((a, i) => (
          <div
            key={a.age_range}
            className={`an-age-group${i === hotIdx ? ' hot' : ''}`}
            title={`${a.age_range}: ${a.male.toLocaleString('pt-BR')} homens · ${a.female.toLocaleString('pt-BR')} mulheres`}
          >
            {i === hotIdx && total > 0 && (
              <span className="an-age-peak">{hotShare}% do público</span>
            )}
            <div className="an-age-col m" style={{ height: `${(a.male / maxVal) * 100}%` }} />
            <div className="an-age-col f" style={{ height: `${(a.female / maxVal) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="an-age-axis">
        {groups.map((a, i) => (
          <span key={a.age_range} className={i === hotIdx ? 'hot' : ''}>
            {a.age_range}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- Best Times Heatmap ----
// The API returns a 7x24 grid but posts are sparse, so cells are aggregated into
// 3h buckets (weighted by post count) — otherwise slots at e.g. 1h or 23h would
// be invisible in a grid that samples only every 3rd hour.
function BestTimesHeatmap({ data }: { data: BestPostingTimes }) {
  const bucketStarts = [0, 3, 6, 9, 12, 15, 18, 21];
  const cols = data.heatmap[0]?.length ?? 0;
  const bucketSize = cols >= 24 ? 3 : 1;
  const buckets = data.labels_days.map((_, d) =>
    bucketStarts.map((start, b) => {
      let eng = 0;
      let n = 0;
      for (let i = 0; i < bucketSize; i++) {
        const h = bucketSize === 3 ? start + i : b;
        eng += (data.heatmap[d]?.[h] ?? 0) * (data.counts[d]?.[h] ?? 0);
        n += data.counts[d]?.[h] ?? 0;
      }
      return { value: n > 0 ? eng / n : 0, count: n };
    }),
  );
  const max = Math.max(...buckets.flat().map((c) => c.value), 0.1);
  const topSlot = data.topSlots[0];
  const topCell = topSlot
    ? { day: topSlot.day, bucket: bucketSize === 3 ? Math.floor(topSlot.hour / 3) : topSlot.hour }
    : null;
  return (
    <div>
      <div className="an-hm">
        <span />
        {bucketStarts.map((h) => (
          <span key={h} className="an-hm-hlab">
            {h}h
          </span>
        ))}
        {data.labels_days.map((day, d) => (
          <Fragment key={day}>
            <span className="an-hm-dlab">{day}</span>
            {buckets[d].map((cell, b) => {
              const step = cell.value > 0 ? 1 + Math.round((cell.value / max) * 7) : 0;
              const isTop = topCell !== null && topCell.day === d && topCell.bucket === b;
              return (
                <span
                  key={b}
                  className={`an-hm-cell${isTop ? ' top' : ''}`}
                  style={{ background: `var(--an-heat-${Math.min(step, 8)})` }}
                  title={
                    cell.count > 0
                      ? `${day} ${bucketStarts[b]}h–${bucketStarts[b] + bucketSize - 1}h: ${formatPct(cell.value)}% eng. (${cell.count} post${cell.count !== 1 ? 's' : ''})`
                      : `${day} ${bucketStarts[b]}h: sem posts`
                  }
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="an-hm-scale">
        <span>menos</span>
        <span className="an-hm-ramp" />
        <span>mais engajamento</span>
      </div>
    </div>
  );
}

// ---- AI Section ----
function AISection({ clientId, days }: { clientId: number; days: number }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
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
  const scoreColor = analysis
    ? score >= 70
      ? 'var(--success)'
      : score >= 40
        ? 'var(--warning)'
        : 'var(--danger)'
    : '';
  const priorityColor = (p: string) =>
    p === 'alta' ? 'var(--danger)' : p === 'media' ? 'var(--warning)' : 'var(--success)';

  return (
    <div className="card animate-up">
      <div className="dashboard-hub-card-header" style={{ marginBottom: '1rem' }}>
        <h3>Análise Inteligente</h3>
        <Button size="sm" variant="outline" disabled={loading} onClick={handleGenerate}>
          {loading ? <Spinner size="sm" /> : <Zap className="h-3 w-3" />} Gerar Análise IA
        </Button>
      </div>
      {!analysis && !error && !loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Clique em "Gerar Análise IA" para obter insights personalizados.
        </p>
      )}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {analysis && (
        <div>
          {/* Health Score */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1.25rem',
              paddingBottom: '1rem',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '2.8rem', fontWeight: 800, color: scoreColor, lineHeight: 1 }}>
              {score}
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  marginBottom: '0.2rem',
                }}
              >
                Health Score
              </div>
              <p style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
                {String(analysis.healthScore?.summary ?? '')}
              </p>
            </div>
          </div>

          {/* Health Score Breakdown */}
          {analysis.healthScore?.breakdown && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
                gap: '0.75rem',
                padding: '1rem 0',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              {Object.entries(analysis.healthScore.breakdown).map(([key, val]: [string, any]) => (
                <div key={key} style={{ fontSize: '0.8rem' }}>
                  <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                    {key.replace(/([A-Z])/g, ' $1')}:{' '}
                  </span>
                  <span>{typeof val === 'string' ? val : val === null ? 'N/A' : String(val)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Performance Map */}
          {analysis.performanceMap && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
                gap: '1.25rem',
                padding: '1.25rem 0',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div>
                <h4
                  style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}
                >
                  Melhor Post
                </h4>
                <BulletText text={analysis.performanceMap.topPerformer} />
              </div>
              <div>
                <h4
                  style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}
                >
                  Pior Post
                </h4>
                <BulletText text={analysis.performanceMap.worstPerformer} />
              </div>
              <div>
                <h4
                  style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}
                >
                  Mix de Conteúdo
                </h4>
                <BulletText text={analysis.performanceMap.contentMix} />
              </div>
            </div>
          )}

          {/* Caption Diagnostic + Growth */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
              gap: '1.25rem',
              padding: '1.25rem 0',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            {analysis.captionDiagnostic && (
              <div>
                <h4
                  style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}
                >
                  Diagnóstico de Legendas
                </h4>
                <BulletText text={analysis.captionDiagnostic} />
              </div>
            )}
            {analysis.growthAnalysis && (
              <>
                <div>
                  <h4
                    style={{
                      fontSize: '0.8rem',
                      marginBottom: '0.4rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    Trajetória de Crescimento
                  </h4>
                  <BulletText text={analysis.growthAnalysis.trajectory} />
                </div>
                <div>
                  <h4
                    style={{
                      fontSize: '0.8rem',
                      marginBottom: '0.4rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    Projeção
                  </h4>
                  <BulletText text={analysis.growthAnalysis.projection} />
                </div>
              </>
            )}
          </div>

          {/* Action Plan */}
          {analysis.actionPlan && analysis.actionPlan.length > 0 && (
            <div style={{ paddingTop: '1.25rem' }}>
              <h4
                style={{ fontSize: '0.8rem', marginBottom: '0.6rem', color: 'var(--text-muted)' }}
              >
                Plano de Ação
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {analysis.actionPlan.map((a: any, i: number) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '0.6rem',
                      fontSize: '0.85rem',
                    }}
                  >
                    <span
                      className="badge"
                      style={{
                        fontSize: '0.65rem',
                        minWidth: 44,
                        textAlign: 'center',
                        background: priorityColor(a.prioridade) + '20',
                        color: priorityColor(a.prioridade),
                        border: `1px solid ${priorityColor(a.prioridade)}40`,
                      }}
                    >
                      {a.prioridade}
                    </span>
                    <div style={{ lineHeight: 1.4 }}>
                      <div style={{ fontWeight: 600 }}>{a.acao}</div>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-muted)',
                          marginTop: '0.15rem',
                        }}
                      >
                        {a.porque}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p
            style={{
              fontSize: '0.65rem',
              color: 'var(--text-muted)',
              marginTop: '1rem',
              textAlign: 'right',
            }}
          >
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

// ---- Tag pill component ----
function TagPill({ tag, onRemove }: { tag: PostTag; onRemove: () => void }) {
  return (
    <span
      className="tag-pill"
      style={{ background: tag.color + '20', color: tag.color, border: `1px solid ${tag.color}40` }}
    >
      {tag.tag_name}
      <span
        className="tag-remove"
        title="Remover tag"
        style={{ cursor: 'pointer', marginLeft: 4 }}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
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
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({
    col: 'posted_at',
    dir: 'desc',
  });
  const [expandedPostId, setExpandedPostId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Collapsed by default on phones, where the callout ate most of a screen
  const [savesOpen, setSavesOpen] = useState(
    () => !window.matchMedia('(max-width: 900px)').matches,
  );
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [manualFollowerOpen, setManualFollowerOpen] = useState(false);
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0]);
  const [manualCount, setManualCount] = useState('');
  const [rankedDrawer, setRankedDrawer] = useState<RankedDrawerMode | null>(null);
  const [rankedOrderBy, setRankedOrderBy] = useState<RankedPostOrderBy>('views');
  const [rankedAsc, setRankedAsc] = useState(false);
  const [rankedFormatFilter, setRankedFormatFilter] = useState('all');
  const [rankedDateFrom, setRankedDateFrom] = useState('');
  const [rankedDateTo, setRankedDateTo] = useState('');
  const [emailReportTarget, setEmailReportTarget] = useState<AnalyticsReport | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [generateIncludeAI, setGenerateIncludeAI] = useState(true);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [newReportOpen, setNewReportOpen] = useState(false);
  // Which report row is currently being downloaded, so only that row spins.
  const [downloadingReportId, setDownloadingReportId] = useState<number | null>(null);

  const dateRange = periodStart && periodEnd ? { start: periodStart, end: periodEnd } : undefined;
  // account-metrics has no "days" shorthand -- always resolve an explicit
  // start/end, translating the "últimos N dias" tabs the same way the
  // calendar-month picker already produces an explicit range.
  const metricsRange = dateRange ?? lastNDaysRange(overviewDays);

  const { data: overviewRes, isLoading: loadingOv } = useQuery({
    queryKey: ['analytics-overview', clientId, overviewDays, periodStart, periodEnd],
    queryFn: () => getAnalyticsOverview(clientId, overviewDays, dateRange),
  });
  const { data: metricsRes, isLoading: loadingMetrics } = useQuery({
    queryKey: ['account-metrics', clientId, metricsRange.start, metricsRange.end],
    queryFn: () => getAccountMetrics(clientId, metricsRange.start, metricsRange.end),
  });
  const baselineQuery = useQuery({
    queryKey: ['client-rate-baseline', clientId],
    queryFn: () => getClientRateBaseline(clientId),
    retry: false, // non-critical: never block/delay the posts query
  });
  const { data: postsRes, isLoading: loadingPosts } = useQuery({
    queryKey: [
      'analytics-posts',
      clientId,
      days,
      sort.col,
      sort.dir,
      periodStart,
      periodEnd,
      baselineQuery.dataUpdatedAt,
    ],
    queryFn: () =>
      getPostsAnalytics(clientId, days, sort.col, sort.dir, dateRange, baselineQuery.data?.dists),
    enabled: baselineQuery.isSuccess || baselineQuery.isError,
  });
  const { data: historyRes } = useQuery({
    queryKey: ['analytics-history', clientId, days, periodStart, periodEnd],
    queryFn: () => getFollowerHistory(clientId, days, dateRange),
  });
  const { data: tagsData = [] } = useQuery({ queryKey: ['analytics-tags'], queryFn: getTags });
  const { data: reportsData = [] } = useQuery({
    queryKey: ['analytics-reports', clientId],
    queryFn: () => getClientReports(clientId),
    refetchInterval: (query) => {
      const reports = query.state.data;
      if (reports?.some((r) => r.status === 'pending' || r.status === 'generating')) return 10000;
      return false;
    },
  });
  const { data: reportDocs = [] } = useQuery({
    queryKey: ['report-docs', clientId],
    queryFn: () => listReportDocs(clientId),
  });
  const { data: demoRes } = useQuery({
    queryKey: ['analytics-demo', clientId],
    queryFn: () => getAudienceDemographics(clientId).catch(() => null),
  });
  const { data: onlineRes } = useQuery({
    queryKey: ['analytics-times', clientId],
    queryFn: () => getBestPostingTimes(clientId).catch(() => null),
  });

  const isLoading = loadingOv || loadingPosts;
  const overview = overviewRes?.data;
  const posts = postsRes?.posts || [];
  const history = historyRes?.history || [];
  const postDates = historyRes?.postDates || [];
  const demographicsData: AudienceDemographics | null = demoRes?.data || null;
  const bestTimesData: BestPostingTimes | null = onlineRes?.data || null;

  const topSaved = [...posts].sort((a, b) => b.saved - a.saved).slice(0, 5);
  const rankedPosts = useMemo(() => [...posts].sort((a, b) => b.views - a.views), [posts]);
  const matureRankedPosts = useMemo(() => {
    const cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
    return [...posts]
      .filter((p) => new Date(p.posted_at).getTime() < cutoff48h)
      .sort((a, b) => a.views - b.views);
  }, [posts]);
  const rankedPostFormats = useMemo(
    () => Array.from(new Set(posts.map((p) => p.media_type))).sort(),
    [posts],
  );
  const rankedDrawerPosts = useMemo(() => {
    const basePosts = rankedDrawer === 'worst' ? matureRankedPosts : posts;
    let next = [...basePosts];

    if (rankedFormatFilter !== 'all') {
      next = next.filter((p) => p.media_type === rankedFormatFilter);
    }
    if (rankedDateFrom) {
      const from = new Date(rankedDateFrom).getTime();
      next = next.filter((p) => new Date(p.posted_at).getTime() >= from);
    }
    if (rankedDateTo) {
      const to = new Date(`${rankedDateTo}T23:59:59`).getTime();
      next = next.filter((p) => new Date(p.posted_at).getTime() <= to);
    }

    const dir = rankedAsc ? 1 : -1;
    switch (rankedOrderBy) {
      case 'engagement':
        next.sort((a, b) => (a.engagement_rate - b.engagement_rate) * dir);
        break;
      case 'views':
        next.sort((a, b) => (a.views - b.views) * dir);
        break;
      case 'reach':
        next.sort((a, b) => (a.reach - b.reach) * dir);
        break;
      case 'likes':
        next.sort((a, b) => (a.likes - b.likes) * dir);
        break;
      case 'comments':
        next.sort((a, b) => (a.comments - b.comments) * dir);
        break;
      case 'saved':
        next.sort((a, b) => (a.saved - b.saved) * dir);
        break;
      case 'shares':
        next.sort((a, b) => (a.shares - b.shares) * dir);
        break;
      case 'date':
        next.sort(
          (a, b) => (new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime()) * dir,
        );
        break;
      case 'ig_score':
        next.sort((a, b) => {
          const va = (a as PostAnalytics).ig_score;
          const vb = (b as PostAnalytics).ig_score;
          if (va === null && vb === null) return 0;
          if (va === null) return 1;
          if (vb === null) return -1;
          return (va - vb) * dir;
        });
        break;
      case 'share_rate':
      case 'like_rate':
      case 'save_rate':
      case 'comment_rate': {
        const key = rankedOrderBy as RateKey;
        next.sort((a, b) => {
          const va = (a as PostAnalytics).rates[key];
          const vb = (b as PostAnalytics).rates[key];
          if (va === null && vb === null) return 0;
          if (va === null) return 1;
          if (vb === null) return -1;
          return (va - vb) * dir;
        });
        break;
      }
    }

    return next;
  }, [
    matureRankedPosts,
    posts,
    rankedAsc,
    rankedDateFrom,
    rankedDateTo,
    rankedDrawer,
    rankedFormatFilter,
    rankedOrderBy,
  ]);

  // Content type breakdown
  const typeMap: Record<string, { count: number; totalEng: number }> = {};
  for (const p of posts) {
    const type = formatMediaType(p.media_type);
    if (!typeMap[type]) typeMap[type] = { count: 0, totalEng: 0 };
    typeMap[type].count++;
    typeMap[type].totalEng += p.engagement_rate;
  }
  const typeBreakdown = Object.entries(typeMap)
    .map(([type, data]) => ({
      type,
      count: data.count,
      avgEngagement: data.count > 0 ? data.totalEng / data.count : 0,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  // Topic performance
  const tagEngMap: Record<string, { tag: PostTag; totalEng: number; count: number }> = {};
  for (const p of posts) {
    for (const t of p.tags) {
      if (!tagEngMap[t.tag_name]) tagEngMap[t.tag_name] = { tag: t, totalEng: 0, count: 0 };
      tagEngMap[t.tag_name].totalEng += p.engagement_rate;
      tagEngMap[t.tag_name].count++;
    }
  }
  const topicStats = Object.values(tagEngMap)
    .map((t) => ({
      ...t.tag,
      avgEngagement: t.count > 0 ? t.totalEng / t.count : 0,
      count: t.count,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  // Insight headlines (computed client-side from the data above)
  const typeTop = typeBreakdown[0];
  const typeSecond = typeBreakdown[1];
  const typeRatio =
    typeTop && typeSecond && typeSecond.avgEngagement > 0
      ? typeTop.avgEngagement / typeSecond.avgEngagement
      : null;

  const demoAgeGroups = demographicsData?.age_gender ?? [];
  const demoAgeTotal = demoAgeGroups.reduce((s, a) => s + a.male + a.female, 0);
  const demoHotAge =
    demoAgeGroups.length > 0
      ? demoAgeGroups.reduce((best, a) => (a.male + a.female > best.male + best.female ? a : best))
      : null;
  const demoFemaleDominant = demographicsData
    ? demographicsData.gender_split.female >= demographicsData.gender_split.male
    : false;
  const demoCities = demographicsData?.cities ?? [];
  const demoCityTotal = demoCities.reduce((s, c) => s + c.count, 0);
  const demoTopCity = demoCities[0] ?? null;
  const demoTopCityShare =
    demoTopCity && demoCityTotal > 0 ? Math.round((demoTopCity.count / demoCityTotal) * 100) : 0;

  const bestSlot = bestTimesData?.topSlots[0] ?? null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncInstagramData(clientId);
      toast.success('Dados sincronizados com sucesso!');
      // account-metrics sits behind a 6h server-side cache
      // (instagram_analytics_cache) -- a plain invalidateQueries would just
      // refetch with the same non-refresh queryFn and hit that cache again,
      // so a manual sync would silently show stale numbers. fetchQuery with
      // refresh:true bypasses the cache read for exactly this query's key and
      // writes the fresh result straight into it; the mounted useQuery on the
      // same key picks it up like any other cache update.
      qc.fetchQuery({
        queryKey: ['account-metrics', clientId, metricsRange.start, metricsRange.end],
        queryFn: () =>
          getAccountMetrics(clientId, metricsRange.start, metricsRange.end, { refresh: true }),
      });
      qc.invalidateQueries({ queryKey: ['analytics-overview', clientId] });
      qc.invalidateQueries({ queryKey: ['analytics-posts', clientId] });
      qc.invalidateQueries({ queryKey: ['analytics-history', clientId] });
      qc.invalidateQueries({ queryKey: ['client-rate-baseline', clientId] });
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
    setDays(newDays);
    setOverviewDays(newDays);
    setPeriodStart(undefined);
    setPeriodEnd(undefined);
    setPeriodLabel(undefined);
    setShowAllPosts(false);
    resetRankedDrawer();
  };

  const handleLastMonth = () => {
    const now = new Date();
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const daysInLastMonth = lastOfLastMonth.getDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    setDays(daysInLastMonth);
    setOverviewDays(daysInLastMonth);
    setPeriodStart(fmt(firstOfLastMonth));
    setPeriodEnd(fmt(lastOfLastMonth));
    setPeriodLabel(firstOfLastMonth.toLocaleString('pt-BR', { month: 'short', year: 'numeric' }));
    setShowAllPosts(false);
    resetRankedDrawer();
  };

  const handleSortChange = (col: string) => {
    setSort((s) => ({ col, dir: s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }));
  };

  const resetRankedDrawer = () => {
    setRankedDrawer(null);
    setRankedOrderBy('views');
    setRankedAsc(false);
    setRankedFormatFilter('all');
    setRankedDateFrom('');
    setRankedDateTo('');
  };

  const openRankedDrawer = (mode: RankedDrawerMode) => {
    setRankedDrawer(mode);
    setRankedOrderBy('views');
    setRankedAsc(mode === 'worst');
    setRankedFormatFilter('all');
    setRankedDateFrom('');
    setRankedDateTo('');
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

  const handleConfirmSendEmail = async () => {
    if (!emailReportTarget) return;
    setSendingEmail(true);
    try {
      const result = await sendReportEmail(emailReportTarget.id);
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success('E-mail enviado com sucesso!');
      }
      qc.invalidateQueries({ queryKey: ['analytics-reports', clientId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar e-mail');
    } finally {
      setSendingEmail(false);
      setEmailReportTarget(null);
    }
  };

  const handleDownloadReport = async (reportId: number) => {
    // Signing the URL takes a moment; without feedback the row looks inert and
    // gets clicked again. Every download button locks so the spinner on the
    // active row is the only thing that looks clickable.
    if (downloadingReportId !== null) return;
    setDownloadingReportId(reportId);
    try {
      const url = await getReportDownloadUrl(reportId);
      openExternalUrl(url);
    } catch {
      toast.error('Erro ao baixar relatório');
    } finally {
      setDownloadingReportId(null);
    }
  };

  const handleGenerateScheduledReport = async (month?: string) => {
    // Both "Gerar" buttons share this handler; the guard makes a double-click
    // (or one click on each) a no-op rather than a second queued report.
    if (generatingReport) return;
    setGeneratingReport(true);
    try {
      await generateReport(clientId, month, generateIncludeAI);
      toast.success('Geração de relatório iniciada!');
      captureEvent('report_generated');
      // Awaited so the button stays busy until the new row is actually on
      // screen — the request resolving is not what the user is waiting for.
      await qc.invalidateQueries({ queryKey: ['analytics-reports', clientId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar relatório');
    } finally {
      setGeneratingReport(false);
    }
  };

  const periodTag = periodLabel || `${overviewDays}d`;
  const visiblePosts = showAllPosts ? posts : posts.slice(0, 5);

  // Account-level KPI parity (Task 13): reach, views, followers delta,
  // accounts engaged, profile views and website clicks all come from
  // account-metrics' current/previous pair now, instead of the account
  // row's reach_28d/impressions_28d/profile_views_28d columns.
  const metricsCurrent = metricsRes?.current;
  const metricsPrevious = metricsRes?.previous ?? null;

  const metricValue = (v: number | null | undefined) =>
    loadingMetrics ? '…' : v != null ? v.toLocaleString('pt-BR') : '—';
  const metricDelta = (current: number | null | undefined, previous: number | null | undefined) =>
    current != null && previous != null ? makeDelta(current, previous) : undefined;
  const metricPrevFormatted = (previous: number | null | undefined) =>
    previous != null ? previous.toLocaleString('pt-BR') : undefined;

  const viewsSub = !loadingMetrics && !metricsRes ? 'Indisponível no momento' : undefined;

  const followersWindow = metricsCurrent?.followers ?? null;
  const followersPrevWindow = metricsPrevious?.followers ?? null;
  const followersDelta =
    followersWindow && followersPrevWindow
      ? makeDelta(followersWindow.delta, followersPrevWindow.delta)
      : undefined;
  const followersValue = loadingMetrics
    ? '…'
    : followersWindow
      ? followersWindow.end.toLocaleString('pt-BR')
      : '—';
  const followersPrevFormatted = followersWindow
    ? followersWindow.start.toLocaleString('pt-BR')
    : undefined;

  if (isLoading)
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <Spinner size="lg" />
      </div>
    );

  if (!overview) return null;

  const cacheNote = overviewRes?.fromCache ? (
    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
      Dados de{' '}
      {new Date(overviewRes.fetchedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
    </span>
  ) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header header--flush animate-up">
        <div className="header-title">
          {(() => {
            const avatarUrl =
              account.profile_picture_url && account.profile_picture_url.startsWith('https://')
                ? account.profile_picture_url
                : null;
            return (
              <div className={`conta-identity${avatarUrl ? ' conta-identity--avatar' : ''}`}>
                <div className="conta-identity__row">
                  {avatarUrl && <img src={avatarUrl} alt="" className="conta-identity__avatar" />}
                  <h1>{cliente.nome}</h1>
                </div>
                <p className="conta-identity__handle">
                  @{account.username} {cacheNote}
                </p>
              </div>
            );
          })()}
        </div>
        <div className="header-actions">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={syncing}
            onClick={handleSync}
            title="Sincronizar Dados"
          >
            {syncing ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button disabled={generatingReport} onClick={() => handleGenerateScheduledReport()}>
            {generatingReport ? <Spinner size="sm" /> : <FileText className="h-4 w-4" />}{' '}
            {generatingReport ? 'Gerando…' : 'Gerar Relatório'}
          </Button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 animate-up">
        <div className="page-tabs page-tabs--inline" role="tablist">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={!periodStart && overviewDays === d}
              className={`page-tab${!periodStart && overviewDays === d ? ' active' : ''}`}
              onClick={() => handleDaysChange(d)}
            >
              {d} dias
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={!!periodStart}
            className={`page-tab${periodStart ? ' active' : ''}`}
            onClick={handleLastMonth}
          >
            Último mês
          </button>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>ou</span>
        <Input
          type="number"
          min={1}
          max={730}
          placeholder="Dias..."
          aria-label="Período personalizado em dias"
          className="!rounded-full !text-xs h-9 w-[110px] mb-0"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = parseInt((e.target as HTMLInputElement).value, 10);
              if (isNaN(val) || val < 1 || val > 730) {
                toast.error('Insira um valor entre 1 e 730 dias');
                return;
              }
              setOverviewDays(val);
              setPeriodStart(undefined);
              setPeriodEnd(undefined);
              setPeriodLabel(undefined);
            }
          }}
        />
      </div>

      {/* KPI Cards */}
      {/* 8 metrics as two clean rows of 4: eight-up squeezes the cards until
          labels wrap into the icon bubbles */}
      <StatCardGrid className="animate-up" maxCols={4}>
        <KpiCard
          label="Visualizações"
          icon={Play}
          tone="violet"
          value={metricValue(metricsCurrent?.views)}
          delta={metricDelta(metricsCurrent?.views, metricsPrevious?.views)}
          period={periodTag}
          prevFormatted={metricPrevFormatted(metricsPrevious?.views)}
          sub={viewsSub}
        />
        <KpiCard
          label="Seguidores"
          icon={Users}
          tone="blue"
          value={followersValue}
          delta={followersDelta}
          period={periodTag}
          prevFormatted={followersPrevFormatted}
        />
        <KpiCard
          label="Engajamento"
          icon={Heart}
          tone="pink"
          value={overview.engagement.current.toFixed(2) + '%'}
          delta={overview.engagement}
          period={periodTag}
          prevFormatted={overview.engagement.previous.toFixed(2) + '%'}
        />
        <KpiCard
          label="Contas engajadas"
          icon={Zap}
          tone="amber"
          value={metricValue(metricsCurrent?.accounts_engaged)}
          delta={metricDelta(metricsCurrent?.accounts_engaged, metricsPrevious?.accounts_engaged)}
          period={periodTag}
          prevFormatted={metricPrevFormatted(metricsPrevious?.accounts_engaged)}
        />
        <KpiCard
          label="Alcance acumulado"
          icon={Eye}
          tone="violet"
          value={metricValue(metricsCurrent?.reach)}
          delta={metricDelta(metricsCurrent?.reach, metricsPrevious?.reach)}
          period={periodTag}
          prevFormatted={metricPrevFormatted(metricsPrevious?.reach)}
        />
        <KpiCard
          label="Cliques no link"
          icon={MousePointerClick}
          tone="green"
          value={metricValue(metricsCurrent?.website_clicks)}
          delta={metricDelta(metricsCurrent?.website_clicks, metricsPrevious?.website_clicks)}
          period={periodTag}
          prevFormatted={metricPrevFormatted(metricsPrevious?.website_clicks)}
        />
        <KpiCard
          label="Taxa de salvamentos"
          icon={Bookmark}
          tone="slate"
          value={overview.savesRate.current.toFixed(2) + '%'}
          delta={overview.savesRate}
          period={periodTag}
          prevFormatted={overview.savesRate.previous.toFixed(2) + '%'}
        />
        <KpiCard
          label="Posts publicados"
          icon={Send}
          tone="blue"
          value={String(overview.postsPublished.current)}
          delta={overview.postsPublished}
          period={periodTag}
          prevFormatted={String(overview.postsPublished.previous)}
        />
      </StatCardGrid>

      {/* Top Saved callout */}
      {topSaved.length > 0 && (
        <div className="analytics-callout analytics-callout--with-icon analytics-callout--primary animate-up">
          <Bookmark className="h-5 w-5 analytics-callout__icon" aria-hidden />
          <div className="analytics-callout__body">
            <button
              type="button"
              className="analytics-callout__toggle"
              aria-expanded={savesOpen}
              aria-controls="saves-callout-content"
              onClick={() => setSavesOpen((v) => !v)}
            >
              <span className="analytics-callout__title">
                Taxa de salvamentos
                <span className="analytics-callout__count">
                  {topSaved.length === 1
                    ? '1 post em destaque'
                    : `${topSaved.length} posts em destaque`}
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 analytics-callout__chevron${savesOpen ? ' open' : ''}`}
                aria-hidden
              />
            </button>
            {savesOpen && (
              <div id="saves-callout-content" className="analytics-callout__collapsible">
                <p className="analytics-callout__text">
                  Salvamentos indicam que alguém guardou o conteúdo para uma decisão de saúde. É a
                  métrica mais subestimada para conteúdo médico.
                </p>
                <div className="analytics-callout__grid">
                  {topSaved.map((p) => (
                    <div key={p.id} className="analytics-callout__item">
                      <strong>{p.saved}</strong> salvamentos
                      <span style={{ color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
                        ({p.saves_rate.toFixed(1)}% taxa)
                      </span>
                      <div className="analytics-callout__item-caption">
                        {p.caption || 'Sem legenda'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <RankedPostsSection
        title="Melhores Posts"
        description={`Top posts por visualizações neste período (${periodTag}).`}
        icon={<Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} />}
        posts={rankedPosts.slice(0, 5)}
        tone="best"
        canSeeMore={rankedPosts.length > 5}
        onSeeMore={() => openRankedDrawer('best')}
      />

      <RankedPostsSection
        title="Precisam de Atenção"
        description="Posts com pelo menos 48h de publicação e menos visualizações no período."
        icon={<AlertTriangle className="h-5 w-5" style={{ color: 'var(--warning)' }} />}
        posts={matureRankedPosts.slice(0, 5)}
        tone="worst"
        canSeeMore={matureRankedPosts.length > 5}
        onSeeMore={() => openRankedDrawer('worst')}
      />

      {/* Follower Growth Chart */}
      <div className="card animate-up">
        <div className="dashboard-hub-card-header">
          <h3>Crescimento de Seguidores</h3>
          <Button size="sm" variant="outline" onClick={() => setManualFollowerOpen(true)}>
            ✏ Inserir manualmente
          </Button>
        </div>
        <FollowerChart history={history} postDates={postDates} />
      </div>

      {/* Content Performance Table */}
      <div className="card animate-up">
        <div className="dashboard-hub-card-header">
          <h3>Performance de Conteúdo</h3>
        </div>
        {posts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
            Nenhuma publicação neste período.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table className="data-table" id="posts-table">
              <thead>
                <tr>
                  {[
                    { col: 'posted_at', label: 'Data' },
                    { col: null, label: 'Tipo' },
                    { col: 'impressions', label: 'Visualizações' },
                    { col: 'reach', label: 'Alcance' },
                    { col: 'engagement_rate', label: 'Eng.' },
                    { col: 'ig_score', label: 'IG Score' },
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
                {visiblePosts.map((p) => (
                  <Fragment key={p.id}>
                    <tr
                      style={{ cursor: 'pointer' }}
                      onClick={() => setExpandedPostId(expandedPostId === p.id ? null : p.id)}
                    >
                      <td data-label="Data">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          {p.thumbnail_url ? (
                            <img
                              loading="lazy"
                              src={sanitizeUrl(p.thumbnail_url)}
                              alt=""
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: 6,
                                objectFit: 'cover',
                                flexShrink: 0,
                                background: 'var(--bg-secondary)',
                              }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: 6,
                                background: 'var(--bg-secondary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              📷
                            </div>
                          )}
                          <span>{new Date(p.posted_at).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </td>
                      <td data-label="Tipo">
                        <span className="badge badge-info">{formatMediaType(p.media_type)}</span>
                      </td>
                      <td data-label="Visualizações">{p.views.toLocaleString('pt-BR')}</td>
                      <td data-label="Alcance">{p.reach.toLocaleString('pt-BR')}</td>
                      <td data-label="Eng.">
                        <span
                          className={`badge ${p.engagement_rate >= 5 ? 'badge-success' : p.engagement_rate >= 2 ? 'badge-warning' : 'badge-neutral'}`}
                        >
                          {p.engagement_rate.toFixed(1)}%
                        </span>
                      </td>
                      <td data-label="IG Score">
                        {(p as PostAnalytics).ig_score === null ||
                        (p as PostAnalytics).ig_score === undefined ? (
                          <span
                            title="amostra insuficiente (<5)"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            —
                          </span>
                        ) : (
                          <span
                            className={`badge ${(p as PostAnalytics).ig_score! >= 75 ? 'badge-success' : (p as PostAnalytics).ig_score! >= 40 ? 'badge-neutral' : 'badge-danger'}`}
                          >
                            {(p as PostAnalytics).ig_score}
                          </span>
                        )}
                      </td>
                      <td data-label="Curtidas">{(p.likes || 0).toLocaleString('pt-BR')}</td>
                      <td data-label="Salvos">{p.saved}</td>
                      <td data-label="Coment.">{p.comments}</td>
                      <td data-label="Compart.">{p.shares}</td>
                      <td data-label="Tags" onClick={(e) => e.stopPropagation()}>
                        {p.tags.map((t) => (
                          <span
                            key={t.id}
                            className="tag-pill"
                            style={{
                              background: t.color + '20',
                              color: t.color,
                              border: `1px solid ${t.color}40`,
                              marginRight: 2,
                            }}
                          >
                            {t.tag_name}
                          </span>
                        ))}
                        {tagsData.length > 0 && (
                          <span
                            style={{
                              cursor: 'pointer',
                              color: 'var(--text-muted)',
                              fontSize: '0.8rem',
                            }}
                          >
                            {tagsData
                              .filter((t) => !p.tags.some((pt) => pt.id === t.id))
                              .map((t) => (
                                <span
                                  key={t.id}
                                  title={`Adicionar "${t.tag_name}"`}
                                  onClick={() => handleAssignTag(p.id, t.id)}
                                  style={{
                                    background: t.color + '20',
                                    color: t.color,
                                    border: `1px solid ${t.color}40`,
                                    cursor: 'pointer',
                                    display: 'inline-block',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    fontSize: '0.7rem',
                                    marginRight: 2,
                                  }}
                                >
                                  + {t.tag_name}
                                </span>
                              ))}
                          </span>
                        )}
                      </td>
                    </tr>
                    {expandedPostId === p.id && (
                      <tr key={`detail-${p.id}`} className="post-detail-row">
                        <td colSpan={10} style={{ padding: '1rem', background: 'var(--card-bg)' }}>
                          <p
                            style={{
                              fontSize: '0.85rem',
                              whiteSpace: 'pre-wrap',
                              marginBottom: '0.5rem',
                            }}
                          >
                            {p.caption || 'Sem legenda'}
                          </p>
                          <div
                            style={{
                              display: 'flex',
                              gap: '1rem',
                              alignItems: 'center',
                              fontSize: '0.8rem',
                            }}
                          >
                            <a
                              href={sanitizeUrl(p.permalink)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--primary-color)' }}
                            >
                              ↗ Ver no Instagram
                            </a>
                            <span style={{ color: 'var(--text-muted)' }}>
                              Visualizações: {p.views.toLocaleString('pt-BR')}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>
                              Curtidas: {p.likes.toLocaleString('pt-BR')}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {posts.length > 5 && (
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  margin: '0.75rem auto 0',
                  padding: '0.4rem 1rem',
                  fontSize: '0.8rem',
                  color: 'var(--primary-color)',
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
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

      {baselineQuery.data && <BaselineCard baseline={baselineQuery.data.baseline} />}

      {/* Type + Topic */}
      <div className="widgets-grid animate-up">
        <div className="card">
          {typeTop && typeSecond && typeRatio !== null && typeRatio >= 1.3 ? (
            <InsightHeader
              kpi={
                <>
                  {typeTop.type} engaja <em>{formatPct(typeRatio)}×</em> mais que {typeSecond.type}
                </>
              }
              sub={`${formatPct(typeTop.avgEngagement)}% vs ${formatPct(typeSecond.avgEngagement)}% de engajamento médio · últimos ${days} dias`}
            />
          ) : typeTop ? (
            <InsightHeader
              kpi={
                <>
                  <em>{typeTop.type}</em> é o formato que mais engaja
                </>
              }
              sub={`${formatPct(typeTop.avgEngagement)}% de engajamento médio · últimos ${days} dias`}
            />
          ) : (
            <div className="dashboard-hub-card-header">
              <h3>Desempenho por Tipo</h3>
            </div>
          )}
          <TypeChart typeBreakdown={typeBreakdown} />
        </div>
        <div className="card">
          {topicStats.length > 0 ? (
            <InsightHeader
              kpi={
                <>
                  <em>{topicStats[0].tag_name}</em> é o tema que mais engaja
                </>
              }
              sub={`${formatPct(topicStats[0].avgEngagement)}% de engajamento médio em ${topicStats[0].count} post${topicStats[0].count !== 1 ? 's' : ''}`}
            />
          ) : (
            <div className="dashboard-hub-card-header">
              <h3>Desempenho por Tópico</h3>
            </div>
          )}
          <div
            style={{
              marginTop: '0.75rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              marginBottom: '1rem',
            }}
          >
            {tagsData.map((t) => (
              <TagPill key={t.id} tag={t} onRemove={() => handleRemoveTag(t.id)} />
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddTag}
              style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
            >
              <Plus className="h-3 w-3" /> Nova Tag
            </Button>
          </div>
          {topicStats.length === 0 ? (
            <>
              {tagsData.length === 0 && (
                <div className="an-ghost-pills">
                  <span className="an-ghost-pill">bastidores</span>
                  <span className="an-ghost-pill">dicas</span>
                  <span className="an-ghost-pill">promoção</span>
                </div>
              )}
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {tagsData.length === 0
                  ? 'Crie tags e atribua aos posts para descobrir quais temas engajam mais.'
                  : 'Atribua tags aos posts para ver o desempenho por tópico.'}
              </p>
            </>
          ) : (
            <div style={{ marginTop: '0.5rem' }}>
              {topicStats.map((t, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.4rem 0',
                    borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      style={{ width: 10, height: 10, borderRadius: '50%', background: t.color }}
                    />
                    <span style={{ fontSize: '0.85rem' }}>{t.tag_name}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      ({t.count} posts)
                    </span>
                  </div>
                  <span
                    className={`badge ${t.avgEngagement >= 5 ? 'badge-success' : t.avgEngagement >= 2 ? 'badge-warning' : 'badge-neutral'}`}
                  >
                    {t.avgEngagement.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Demographics + Best Times */}
      <div
        className="widgets-grid animate-up"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}
      >
        <div className="card">
          {demographicsData && demoHotAge && demoAgeTotal > 0 ? (
            <InsightHeader
              kpi={
                <>
                  {demoFemaleDominant ? 'Mulheres' : 'Homens'} de <em>{demoHotAge.age_range}</em>{' '}
                  são o núcleo da audiência
                </>
              }
              sub={
                <>
                  {demoFemaleDominant
                    ? `${demographicsData.gender_split.female}% do público é feminino`
                    : `${demographicsData.gender_split.male}% do público é masculino`}
                  {demoTopCity && demoTopCityShare > 0 && (
                    <>
                      {' '}
                      · {demoTopCityShare}% está em {demoTopCity.name.split(',')[0]}
                    </>
                  )}
                </>
              }
            />
          ) : (
            <div className="dashboard-hub-card-header">
              <h3>Demografia da Audiência</h3>
            </div>
          )}
          {!demographicsData ? (
            <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
              Dados demográficos indisponíveis. A conta pode não ter seguidores suficientes ou a
              permissão instagram_manage_insights pode estar ausente.
            </p>
          ) : (
            <div>
              <div className="an-split">
                <div className="an-split-m" style={{ flex: demographicsData.gender_split.male }} />
                <div
                  className="an-split-f"
                  style={{ flex: demographicsData.gender_split.female }}
                />
              </div>
              <div className="an-split-labels">
                <span>
                  <span className="an-dot" style={{ background: 'var(--an-male)' }} />
                  Masculino <strong>{demographicsData.gender_split.male}%</strong>
                </span>
                <span>
                  <span className="an-dot" style={{ background: 'var(--an-female)' }} />
                  Feminino <strong>{demographicsData.gender_split.female}%</strong>
                </span>
              </div>
              <h4 className="an-mini-h">Faixa etária</h4>
              <AgeChart demographics={demographicsData} />
              <h4 className="an-mini-h">Principais cidades</h4>
              {demographicsData.cities.slice(0, 5).map((c, i) => {
                const maxCity = demographicsData.cities[0]?.count || 1;
                const [cityName, cityRegion] = c.name.split(/,\s*/, 2);
                return (
                  <div key={i} className="an-city-row">
                    <span className="an-city-name">
                      {cityName}{' '}
                      {cityRegion && (
                        <small style={{ color: 'var(--text-muted)' }}>{cityRegion}</small>
                      )}
                    </span>
                    <span className="an-city-bar">
                      <i style={{ width: `${(c.count / maxCity) * 100}%` }} />
                    </span>
                    <span className="an-city-val">{c.count.toLocaleString('pt-BR')}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card">
          {bestTimesData && bestTimesData.totalPosts >= 5 && bestSlot ? (
            <InsightHeader
              kpi={
                <>
                  {DAY_FULL[bestTimesData.labels_days[bestSlot.day]] ??
                    bestTimesData.labels_days[bestSlot.day]}{' '}
                  às <em>{bestTimesData.labels_hours[bestSlot.hour]}</em> é o melhor horário
                </>
              }
              sub={`${formatPct(bestSlot.value)}% de engajamento médio · ${bestTimesData.totalPosts} posts nos últimos 90 dias`}
            />
          ) : (
            <div className="dashboard-hub-card-header">
              <h3>Melhor Horário para Postar</h3>
            </div>
          )}
          {!bestTimesData || bestTimesData.totalPosts < 5 ? (
            <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
              Dados insuficientes. São necessários pelo menos 5 posts nos últimos 90 dias para
              análise.
            </p>
          ) : (
            <div style={{ marginTop: '0.5rem' }}>
              <BestTimesHeatmap data={bestTimesData} />
              {bestTimesData.topSlots.length > 0 && (
                <div style={{ marginTop: '1.2rem' }}>
                  <h4 className="an-mini-h" style={{ margin: '0 0 0.5rem' }}>
                    Horários recomendados
                  </h4>
                  {bestTimesData.topSlots.map((s, i) => (
                    <div key={i} className="an-slot-row">
                      <span className={`an-slot-rank${i === 0 ? ' r1' : ''}`}>{i + 1}</span>
                      <span className="an-slot-when">
                        {bestTimesData.labels_days[s.day]} às {bestTimesData.labels_hours[s.hour]}
                      </span>
                      <span className="an-slot-meta">
                        {formatPct(s.value)}% eng. · {s.postCount} post{s.postCount > 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Relatórios interativos (novo formato) */}
      <div className="card animate-up">
        <div
          className="dashboard-hub-card-header"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <h3>Relatórios Interativos</h3>
          <Button variant="outline" size="sm" onClick={() => setNewReportOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Novo relatório
          </Button>
        </div>
        <div style={{ marginTop: '1rem' }}>
          {reportDocs.length === 0 && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Nenhum relatório interativo ainda. Clique em "Novo relatório" para criar o primeiro.
            </p>
          )}
          {reportDocs.map((doc) => (
            <div
              key={doc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0',
                borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))',
              }}
            >
              <div>
                <strong>{doc.title}</strong>
                <span
                  style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}
                >
                  {new Date(doc.created_at).toLocaleDateString('pt-BR')}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/relatorios/${doc.id}`)}
                >
                  Abrir
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Excluir relatório"
                  onClick={async () => {
                    if (
                      !window.confirm('Excluir este relatório? O PDF exportado também é removido.')
                    )
                      return;
                    try {
                      await deleteReportDoc(doc.id);
                      qc.invalidateQueries({ queryKey: ['report-docs', clientId] });
                      toast.success('Relatório excluído.');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Erro ao excluir relatório');
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reports */}
      <div className="card animate-up">
        <div
          className="dashboard-hub-card-header"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <h3>Relatórios Gerados</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={generateIncludeAI}
                onChange={(e) => setGenerateIncludeAI(e.target.checked)}
                style={{ accentColor: 'var(--primary-color)' }}
              />
              Incluir IA
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={generatingReport}
              onClick={() => handleGenerateScheduledReport()}
            >
              {generatingReport ? <Spinner size="sm" /> : <Plus className="h-3.5 w-3.5" />}{' '}
              {generatingReport ? 'Gerando…' : 'Gerar'}
            </Button>
          </div>
        </div>
        <div style={{ marginTop: '1rem' }}>
          {reportsData.length === 0 && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Nenhum relatório gerado ainda. Clique em "Gerar" para criar o primeiro.
            </p>
          )}
          {reportsData.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0',
                borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))',
              }}
            >
              <div>
                <strong>{formatReportMonth(r.report_month)}</strong>
                {r.generated_at && (
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginLeft: '0.5rem',
                    }}
                  >
                    {new Date(r.generated_at).toLocaleDateString('pt-BR')}
                  </span>
                )}
                {r.include_ai && (
                  <span className="badge badge-neutral badge--sm" style={{ marginLeft: '0.5rem' }}>
                    IA
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {r.status === 'pending' && <span className="badge badge-warning">Pendente</span>}
                {r.status === 'generating' && (
                  <span className="badge badge-info">
                    <Spinner size="sm" /> Gerando...
                  </span>
                )}
                {r.status === 'failed' && (
                  <span
                    className="badge badge-danger"
                    title={r.generation_error || 'Erro desconhecido'}
                    style={{ cursor: 'help' }}
                  >
                    Falha
                  </span>
                )}
                {r.status === 'ready' && (
                  <>
                    <span className="badge badge-success">Pronto</span>
                    {r.storage_path && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={downloadingReportId !== null}
                        onClick={() => handleDownloadReport(r.id)}
                      >
                        {downloadingReportId === r.id ? (
                          <>
                            <Spinner size="sm" /> Baixando…
                          </>
                        ) : (
                          '↓ Baixar PDF'
                        )}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setEmailReportTarget(r)}>
                      Enviar
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Send report email confirmation dialog */}
      <AlertDialog
        open={emailReportTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEmailReportTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar relatório por e-mail</AlertDialogTitle>
            <AlertDialogDescription>
              {emailReportTarget && (
                <>
                  Enviar o relatório de{' '}
                  <strong>{formatReportMonth(emailReportTarget.report_month)}</strong> por e-mail
                  para o cliente <strong>{cliente.nome}</strong>?
                  {cliente.send_report_email === false && (
                    <span
                      style={{
                        display: 'block',
                        marginTop: '0.5rem',
                        color: 'var(--warning)',
                        fontWeight: 600,
                      }}
                    >
                      Atenção: este cliente tem o envio de relatórios por e-mail desativado.
                    </span>
                  )}
                  {emailReportTarget.last_emailed_at && (
                    <span
                      style={{
                        display: 'block',
                        marginTop: '0.25rem',
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Último envio:{' '}
                      {new Date(emailReportTarget.last_emailed_at).toLocaleString('pt-BR')}
                    </span>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sendingEmail}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={sendingEmail} onClick={handleConfirmSendEmail}>
              {sendingEmail ? 'Enviando...' : 'Enviar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manual follower modal */}
      <Dialog
        open={manualFollowerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setManualFollowerOpen(false);
            setManualCount('');
          }
        }}
      >
        <DialogContent
          onConfirmClose={() => {
            setManualFollowerOpen(false);
            setManualCount('');
          }}
        >
          <DialogHeader>
            <DialogTitle>Inserir Seguidores Manualmente</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Insira a contagem de seguidores para uma data específica. Dados manuais não serão
            sobrescritos pela sincronização automática.
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Data</Label>
              <Input
                type="date"
                value={manualDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setManualDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Número de seguidores</Label>
              <Input
                type="number"
                min={0}
                placeholder="Ex: 15432"
                value={manualCount}
                onChange={(e) => setManualCount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setManualFollowerOpen(false);
                setManualCount('');
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleSaveManualFollower}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={rankedDrawer !== null}
        onOpenChange={(open) => {
          if (!open) resetRankedDrawer();
        }}
      >
        <SheetContent side="right" className="!w-full !max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {rankedDrawer === 'worst' ? (
                <>
                  <AlertTriangle className="h-5 w-5" style={{ color: 'var(--warning)' }} /> Posts
                  que precisam de atenção
                </>
              ) : (
                <>
                  <Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} /> Melhores posts
                </>
              )}
            </SheetTitle>
            <SheetDescription>
              {rankedDrawerPosts.length} de{' '}
              {rankedDrawer === 'worst' ? matureRankedPosts.length : posts.length} posts de @
              {account.username}
            </SheetDescription>
          </SheetHeader>

          <div
            style={{
              display: 'grid',
              gap: '0.5rem',
              paddingBottom: '0.75rem',
              marginTop: '0.75rem',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) 2.25rem minmax(0,1fr)',
                gap: '0.5rem',
                alignItems: 'center',
              }}
            >
              <select
                value={rankedOrderBy}
                onChange={(e) => setRankedOrderBy(e.target.value as RankedPostOrderBy)}
                aria-label="Ordenar posts"
                className="drawer-select"
                style={{
                  height: 36,
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: 'var(--card-bg)',
                  color: 'var(--text-main)',
                  padding: '0 0.6rem',
                  fontSize: '0.85rem',
                }}
              >
                <option value="views">Visualizações</option>
                <option value="reach">Alcance</option>
                <option value="engagement">Engajamento</option>
                <option value="likes">Curtidas</option>
                <option value="comments">Comentários</option>
                <option value="saved">Salvos</option>
                <option value="shares">Compart.</option>
                <option value="date">Data</option>
                <option value="ig_score">IG Score</option>
                <option value="share_rate">Compart./visualização</option>
                <option value="like_rate">Curt./visualização</option>
                <option value="save_rate">Salvos/visualização</option>
                <option value="comment_rate">Coment./visualização</option>
              </select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setRankedAsc((v) => !v)}
                className="mb-0 h-9 w-9 shrink-0 rounded-lg"
                title={rankedAsc ? 'Crescente' : 'Decrescente'}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
              </Button>
              <select
                value={rankedFormatFilter}
                onChange={(e) => setRankedFormatFilter(e.target.value)}
                aria-label="Filtrar formato"
                className="drawer-select"
                style={{
                  height: 36,
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: 'var(--card-bg)',
                  color: 'var(--text-main)',
                  padding: '0 0.6rem',
                  fontSize: '0.85rem',
                }}
              >
                <option value="all">Todos os formatos</option>
                {rankedPostFormats.map((type) => (
                  <option key={type} value={type}>
                    {formatMediaType(type)}
                  </option>
                ))}
              </select>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
                gap: '0.5rem',
                alignItems: 'center',
              }}
            >
              <Input
                type="date"
                value={rankedDateFrom}
                onChange={(e) => setRankedDateFrom(e.target.value)}
                className="h-9 rounded-lg font-mono text-sm"
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>até</span>
              <Input
                type="date"
                value={rankedDateTo}
                onChange={(e) => setRankedDateTo(e.target.value)}
                className="h-9 rounded-lg font-mono text-sm"
              />
            </div>
            {(rankedDateFrom || rankedDateTo) && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    setRankedDateFrom('');
                    setRankedDateTo('');
                  }}
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'var(--danger)',
                    background: 'none',
                    border: 0,
                    cursor: 'pointer',
                  }}
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
            {rankedDrawerPosts.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '1rem 0' }}>
                Nenhum post encontrado com estes filtros.
              </p>
            ) : (
              rankedDrawerPosts.map((post, i) => (
                <a
                  key={post.id}
                  href={sanitizeUrl(post.permalink)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.65rem 0.75rem',
                    borderRadius: 10,
                    border: '1px solid var(--border-color)',
                    background: 'var(--card-bg)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
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
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 8,
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    <PostThumbnail post={post} size="list" />
                  </div>
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
                        {post.caption || 'Sem legenda'}
                      </span>
                      <span
                        style={{ fontSize: '0.65rem', color: 'var(--text-light)', flexShrink: 0 }}
                      >
                        {formatPostDate(post.posted_at)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.7rem',
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)',
                        marginTop: 3,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>{formatMediaType(post.media_type)}</span>
                      <span>
                        Visualizações{' '}
                        <strong
                          style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}
                        >
                          {formatNumber(post.views)}
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
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <Heart className="h-3 w-3" />{' '}
                        <strong
                          style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}
                        >
                          {formatNumber(post.likes)}
                        </strong>
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <MessageCircle className="h-3 w-3" />{' '}
                        <strong
                          style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}
                        >
                          {formatNumber(post.comments)}
                        </strong>
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
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
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      <NewReportDialog open={newReportOpen} onOpenChange={setNewReportOpen} clientId={clientId} />
    </div>
  );
}

// ---- Baseline Card ----
const RATE_STRIP_LABELS: Record<RateKey, string> = {
  share_rate: 'Compartilhamentos',
  like_rate: 'Curtidas',
  save_rate: 'Salvos',
  comment_rate: 'Comentários',
};
const FORMAT_LABELS: Record<string, string> = {
  VIDEO: 'Reels',
  CAROUSEL_ALBUM: 'Carrossel',
  IMAGE: 'Imagem',
};

function BaselineCard({ baseline }: { baseline: Baseline }) {
  if (baseline.sample_size === 0) return null;
  const strip = (key: RateKey) => {
    const stat = baseline.overall[key];
    const q: Quartiles | null = stat.quartiles;
    const scaleMax = q ? (q.p75 || 0) * 1.5 || 1 : 1;
    const pct = (v: number) => Math.max(0, Math.min(100, (v / scaleMax) * 100));
    const perFormat = Object.entries(baseline.by_format)
      .map(([fmt, m]) => {
        const fq = m[key].quartiles;
        return `${FORMAT_LABELS[fmt] ?? fmt} ${fq ? formatRate(fq.p50) : 'n<5'}`;
      })
      .join(' · ');
    return (
      <div key={key} style={{ marginBottom: '0.85rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontSize: '0.78rem',
          }}
        >
          <span style={{ fontWeight: 600 }}>
            {RATE_STRIP_LABELS[key]}{' '}
            <span style={{ color: 'var(--primary-color)', fontSize: '0.62rem' }}>
              peso {Math.round(IG_RATE_WEIGHTS[key] * 100)}%
            </span>
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {q ? formatRate(q.p50) : '—'}{' '}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.65rem' }}>
              mediana
            </span>
          </span>
        </div>
        <div
          style={{
            position: 'relative',
            height: 8,
            background: 'var(--surface-darker)',
            borderRadius: 4,
            marginTop: 5,
          }}
        >
          {q && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: `${pct(q.p25)}%`,
                  width: `${Math.max(0, pct(q.p75) - pct(q.p25))}%`,
                  top: 0,
                  bottom: 0,
                  background: 'rgba(234,179,8,0.33)',
                  borderRadius: 4,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: `${pct(q.p50)}%`,
                  top: -2,
                  width: 3,
                  height: 12,
                  background: 'var(--primary-color)',
                  borderRadius: 2,
                }}
              />
            </>
          )}
        </div>
        <div
          style={{
            fontSize: '0.6rem',
            color: 'var(--text-muted)',
            marginTop: 3,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {q ? `p25 ${formatRate(q.p25)} · p75 ${formatRate(q.p75)} — ` : 'amostra insuficiente — '}
          {perFormat}
        </div>
      </div>
    );
  };
  return (
    <div className="card animate-up">
      <div className="dashboard-hub-card-header" style={{ marginBottom: '0.25rem' }}>
        <h3>Baseline Instagram</h3>
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Histórico completo · {baseline.sample_size} posts · por visualização · pontuado vs.
        histórico completo do cliente — igual ao que o agente vê.
      </div>
      {(['share_rate', 'like_rate', 'save_rate', 'comment_rate'] as RateKey[]).map(strip)}
      <div
        style={{
          fontSize: '0.62rem',
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border-color)',
          paddingTop: '0.6rem',
          lineHeight: 1.5,
        }}
      >
        Heurística interna alinhada ao IG (compart.&gt;curt.&gt;salvos&gt;coment.) — não são os
        pesos oficiais do Instagram. Taxa de skip e repost não estão na API.
      </div>
    </div>
  );
}

// ---- Main Page ----
export default function AnalyticsContaPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const clientId = parseInt(id || '', 10);

  const { data: clientes = [], isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
  });

  const cliente = clientes.find((c) => c.id === clientId);

  const {
    data: igSummary,
    isLoading: loadingIg,
    error: igError,
  } = useQuery({
    queryKey: ['ig-summary', clientId],
    queryFn: () => getInstagramSummary(clientId),
    enabled: !!clientId && !isNaN(clientId) && !!cliente,
  });

  if (isNaN(clientId) || clientId <= 0) {
    return (
      <div className="card">
        <p style={{ color: 'var(--danger)' }}>ID de cliente inválido.</p>
      </div>
    );
  }

  if (loadingClientes || loadingIg) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}
      >
        <Spinner size="lg" />
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="card">
        <p style={{ color: 'var(--danger)' }}>Cliente não encontrado.</p>
      </div>
    );
  }

  if (igError) {
    const msg = igError instanceof Error ? igError.message : 'Erro';
    if (msg === 'TOKEN_EXPIRED') {
      return (
        <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>Token do Instagram expirado</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Reconecte a conta Instagram para continuar visualizando os analytics.
          </p>
          <Button style={{ marginTop: '1rem' }} onClick={() => navigate(`/cliente/${clientId}`)}>
            Reconectar Conta
          </Button>
        </div>
      );
    }
    return (
      <div className="card">
        <p style={{ color: 'var(--danger)' }}>Erro ao carregar analytics: {msg}</p>
      </div>
    );
  }

  if (!igSummary) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <header className="header header--flush animate-up">
          <div className="header-title">
            <h1>Analytics</h1>
          </div>
          <div className="header-actions">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Button>
          </div>
        </header>
        <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>Instagram não conectado</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            Conecte a conta Instagram deste cliente para acessar os analytics.
          </p>
          <Button style={{ marginTop: '1rem' }} onClick={() => navigate(`/cliente/${clientId}`)}>
            Ir para o perfil do cliente
          </Button>
        </div>
      </div>
    );
  }

  return <AnalyticsContent clientId={clientId} cliente={cliente} account={igSummary.account} />;
}
