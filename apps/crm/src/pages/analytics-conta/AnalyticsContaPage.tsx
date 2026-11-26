import { Fragment, type ReactNode, useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowUpDown,
  Bookmark,
  ChevronRight,
  FileText,
  Film,
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
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { StatCard, type StatTone } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { PageSkeleton } from '@/components/ui/skeletons';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Chart, registerables } from 'chart.js';
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
  removeTagFromPost,
  getAccountAIAnalysis,
  upsertManualFollowerCount,
  getClientRateBaseline,
  getStoriesAnalytics,
  getAccountHealth,
  getPostAnalyticsById,
  type KpiDelta,
  type PostAnalytics,
  type PostTag,
  type AudienceDemographics,
  type BestPostingTimes,
  type StoriesAnalyticsResponse,
  type StoryInsight,
} from '../../services/analytics';
import { getInstagramSummary, syncInstagramData } from '../../services/instagram';
import { sanitizeUrl } from '../../utils/security';
import {
  formatRate,
  IG_RATE_WEIGHTS,
  type Baseline,
  type Quartiles,
  type RateKey,
} from '../../lib/ig-rates';
import { compareNullableNumber, type ActionSortKey } from '../../lib/post-action-metrics';
import { InstagramPostCarousel } from '@/components/instagram/InstagramPostCarousel';
import { NewReportDialog } from './reports/NewReportDialog';
import { FollowerChart } from './FollowerChart';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVidroShell } from '@/components/layout/PageToolbarContext';
import { ContaPhone, ContaPhoneMessage } from './phone/ContaPhone';
import {
  BEST_TIME_BUCKET_STARTS,
  GOOD_ENGAGEMENT_RATE,
  bucketBestTimes,
  formatMediaType,
  formatPublishedDateTime,
  toStatDelta,
  dayFull,
  dayShort,
  hourText,
} from './contaFormat';
import { PostThumbnail } from './components/PostThumbnail';
import { ActionMetricValue } from './components/PostMetricsView';
import { PostMetricsDialog } from './components/PostMetricsDialog';
import { InstagramLinkButton } from '@/components/instagram/InstagramLinkButton';
import { cn } from '@/lib/utils';
import { AccountCommentsCard } from './comments/AccountCommentsCard';
import { keepPostsAcrossBaselineRefresh } from './postsPlaceholder';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { AccountHealthCard } from './health/AccountHealthCard';

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

function formatNumber(n: number): string {
  return (n || 0).toLocaleString(getIntlLocale());
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
  return new Date(date).toLocaleDateString(getIntlLocale(), { day: '2-digit', month: 'short' });
}

/** A one-line caption for an accessible name: whitespace collapsed, cut at 60 characters. */
function captionExcerpt(caption: string | null | undefined): string {
  const text = (caption ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return i18n.t('analyticsAccount:page.noCaption');
  return text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text;
}

/** Opens a post's metrics pop-up; `opener` is the control focus returns to on close. */
type OpenPostHandler = (post: PostAnalytics, opener: HTMLElement) => void;

function RankedPostCard({
  post,
  tone,
  onOpen,
}: {
  post: PostAnalytics;
  tone: 'best' | 'worst';
  onOpen: OpenPostHandler;
}) {
  const { t } = useTranslation('analyticsAccount');
  const reachColor = tone === 'best' ? 'var(--success)' : 'var(--danger)';

  return (
    <div className="analytics-post-card analytics-post-card--openable" style={{ minWidth: 180 }}>
      <button
        type="button"
        className="analytics-post-card__open"
        aria-label={t('page.viewMetrics', { caption: captionExcerpt(post.caption) })}
        onClick={(e) => onOpen(post, e.currentTarget)}
      >
        <div
          style={{
            aspectRatio: '3/4',
            position: 'relative',
            overflow: 'hidden',
            background: 'var(--surface-darker)',
          }}
        >
          <PostThumbnail post={post} size="card" />
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
        <div
          style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}
        >
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
            {post.caption || t('page.noCaption')}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
            {formatPostDate(post.posted_at)}
          </span>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {t('metric.views')}
            </span>
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
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {t('metric.engagement')}
            </span>
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
            {typeof post.follows === 'number' && (
              <span
                title={t('metric.newFollowers')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: '0.65rem',
                  color: 'var(--text-muted)',
                }}
              >
                <UserPlus className="h-3 w-3" />{' '}
                <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                  {formatNumber(post.follows)}
                </strong>
              </span>
            )}
          </div>
        </div>
      </button>
      <InstagramLinkButton
        permalink={post.permalink}
        className="analytics-post-card__ig"
        size={32}
        shape="round"
      />
    </div>
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
  onOpen: OpenPostHandler;
}

function RankedPostsSection(props: RankedPostsSectionProps) {
  const { t } = useTranslation('analyticsAccount');
  return (
    <InstagramPostCarousel
      title={props.title}
      description={props.description}
      ariaLabel={props.title}
      icon={props.icon}
      posts={props.posts}
      getKey={(post) => post.id}
      renderPost={(post) => <RankedPostCard post={post} tone={props.tone} onOpen={props.onOpen} />}
      action={
        props.canSeeMore ? (
          <Button variant="ghost" size="sm" onClick={props.onSeeMore}>
            {t('page.seeMore')} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
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
  | 'comment_rate'
  | ActionSortKey;

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
  const { t } = useTranslation('analyticsAccount');
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
              caption: t('format.vsPrevious'),
            }
          : undefined
      }
      sub={sub}
      footNote={
        <>
          {prevFormatted != null && (
            <span>
              {t('page.previous')} {prevFormatted}
            </span>
          )}
          {period && <span className="kpi-period-chip">{period}</span>}
        </>
      }
    />
  );
}

// ---- Insight helpers ----
const formatPct = (v: number) =>
  getIntlLocale() === 'en-US' ? v.toFixed(1) : v.toFixed(1).replace('.', ',');

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
  const { t } = useTranslation('analyticsAccount');
  if (typeBreakdown.length === 0)
    return <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>{t('page.noData')}</p>;
  const max = Math.max(...typeBreakdown.map((row) => row.avgEngagement), 0.1);
  return (
    <div style={{ marginTop: '0.5rem' }}>
      {typeBreakdown.map((row, i) => {
        const pct = (row.avgEngagement / max) * 80;
        return (
          <div key={row.type} className="an-tbar-row">
            <div className="an-tbar-label">
              {row.type}
              <small>{t('count.posts', { count: row.count })}</small>
            </div>
            <div className="an-tbar-track">
              <div className={`an-tbar-fill${i > 0 ? ' dim' : ''}`} style={{ width: `${pct}%` }} />
              <span className="an-tbar-val" style={{ left: `${pct}%` }}>
                {formatPct(row.avgEngagement)}%
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
  const { t } = useTranslation('analyticsAccount');
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
            title={t('age.tooltip', {
              range: a.age_range,
              male: a.male.toLocaleString(getIntlLocale()),
              female: a.female.toLocaleString(getIntlLocale()),
            })}
          >
            {i === hotIdx && total > 0 && (
              <span className="an-age-peak">{t('age.peak', { share: hotShare })}</span>
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
// Cells are 3h buckets weighted by post count (see bucketBestTimes).
// Also drawn by the TikTok tab, which counts videos instead of posts.
export function BestTimesHeatmap({
  data,
  countLabel: countLabelProp,
}: {
  data: BestPostingTimes;
  countLabel?: (count: number) => string;
}) {
  const { t } = useTranslation('analyticsAccount');
  const countLabel = countLabelProp ?? ((n: number) => t('count.posts', { count: n }));
  const hourLabel = (h: number) => t('hm.hour', { h });
  const bucketStarts = BEST_TIME_BUCKET_STARTS;
  const { buckets, bucketSize, max, topCell } = bucketBestTimes(data);
  return (
    <div>
      <div className="an-hm">
        <span />
        {bucketStarts.map((h) => (
          <span key={h} className="an-hm-hlab">
            {hourLabel(h)}
          </span>
        ))}
        {data.labels_days.map((day, d) => (
          <Fragment key={day}>
            <span className="an-hm-dlab">{dayShort(day)}</span>
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
                      ? t('hm.tooltip', {
                          day: dayShort(day),
                          from: hourLabel(bucketStarts[b]),
                          to: hourLabel(bucketStarts[b] + bucketSize - 1),
                          pct: formatPct(cell.value),
                          count: countLabel(cell.count),
                        })
                      : t('hm.empty', { day: dayShort(day), hour: hourLabel(bucketStarts[b]) })
                  }
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="an-hm-scale">
        <span>{t('hm.less')}</span>
        <span className="an-hm-ramp" />
        <span>{t('hm.more')}</span>
      </div>
    </div>
  );
}

// ---- AI Section ----
export interface AIAnalysisResult {
  analysis: any;
  generatedAt: string;
}

/** The headings that name the content unit; TikTok says "vídeo" and "títulos". */
export interface AISectionLabels {
  topPerformer: string;
  worstPerformer: string;
  captionDiagnostic: string;
}

// Also drawn by the TikTok tab: `load` fetches its analysis (same output shape) and throws an
// Error whose message is the copy to show.
export function AISection({
  clientId,
  days,
  load,
  title: titleProp,
  labels: labelsProp,
}: {
  clientId: number;
  days: number;
  load?: (days: number) => Promise<AIAnalysisResult>;
  title?: string;
  labels?: AISectionLabels;
}) {
  const { t } = useTranslation('analyticsAccount');
  const title = titleProp ?? t('ai.title');
  const labels: AISectionLabels = labelsProp ?? {
    topPerformer: t('ai.topPerformer'),
    worstPerformer: t('ai.worstPerformer'),
    captionDiagnostic: t('ai.captionDiagnostic'),
  };
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await (load ? load(days) : getAccountAIAnalysis(clientId, days));
      if (result.analysis.error) {
        setError(t('ai.failed'));
        return;
      }
      setAnalysis({ ...result.analysis, generatedAt: result.generatedAt });
    } catch (e: any) {
      setError(e.message || t('ai.error'));
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
        <h3>{title}</h3>
        <Button size="sm" variant="outline" disabled={loading} onClick={handleGenerate}>
          {loading ? <Spinner size="sm" /> : <Zap className="h-3 w-3" />} {t('ai.generate')}
        </Button>
      </div>
      {!analysis && !error && !loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('ai.prompt')}</p>
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
                {t('ai.healthScore')}
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
                  {labels.topPerformer}
                </h4>
                <BulletText text={analysis.performanceMap.topPerformer} />
              </div>
              <div>
                <h4
                  style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}
                >
                  {labels.worstPerformer}
                </h4>
                <BulletText text={analysis.performanceMap.worstPerformer} />
              </div>
              <div>
                <h4
                  style={{ fontSize: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-muted)' }}
                >
                  {t('ai.contentMix')}
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
                  {labels.captionDiagnostic}
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
                    {t('ai.trajectory')}
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
                    {t('ai.projection')}
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
                {t('ai.actionPlan')}
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
            {t('ai.generatedAt')}{' '}
            {new Date(analysis.generatedAt).toLocaleString(getIntlLocale(), {
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
  const { t } = useTranslation('analyticsAccount');
  return (
    <span
      className="tag-pill"
      style={{ background: tag.color + '20', color: tag.color, border: `1px solid ${tag.color}40` }}
    >
      {tag.tag_name}
      <span
        className="tag-remove"
        title={t('tag.remove')}
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
  tabs,
}: {
  clientId: number;
  cliente: any;
  account: any;
  /** The shell's platform tabs, shown under the phone identity (desktop renders them itself). */
  tabs?: ReactNode;
}) {
  const { t } = useTranslation('analyticsAccount');
  const qc = useQueryClient();
  const isPhone = !useIsDesktop(768);
  // Under the Vidro shell the three inline var(--card-bg) surfaces below drop their background so
  // the Vidro family rules paint them (spec: inline-style escapes).
  const vidroShell = useVidroShell();

  const [days, setDays] = useState(30);
  const [overviewDays, setOverviewDays] = useState(30);
  const [periodStart, setPeriodStart] = useState<string | undefined>();
  const [periodEnd, setPeriodEnd] = useState<string | undefined>();
  const [periodLabel, setPeriodLabel] = useState<string | undefined>();
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({
    col: 'posted_at',
    dir: 'desc',
  });
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  // The post as it was when opened: a posts-key change empties the list for a moment, and the
  // dialog keeps showing this one until the list settles.
  const [heldPost, setHeldPost] = useState<PostAnalytics | null>(null);
  // A post opened by id from the health card that may sit outside the loaded list: the
  // close-when-missing effect below must leave it open.
  const [fetchedPostId, setFetchedPostId] = useState<string | null>(null);
  // Bumped on every open and close: a by-id fetch that resolves after another open or a close
  // is stale and must not take over the dialog (nor toast its error).
  const openRequestRef = useRef(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const commentsAiEnabled = useWorkspaceLimits().features?.feature_instagram_comments_ai === true;
  const [syncing, setSyncing] = useState(false);
  // Collapsed by default on phones (and the phone shell on touch tablets), where the
  // callout ate most of a screen
  const [savesOpen, setSavesOpen] = useState(
    () => !isPhone && !window.matchMedia('(max-width: 900px)').matches,
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
  const [newReportOpen, setNewReportOpen] = useState(false);

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
  const healthQuery = useQuery({
    queryKey: ['ig-account-health', clientId],
    queryFn: () => getAccountHealth(clientId),
    staleTime: 3_600_000,
    retry: false,
  });
  // Non-critical: a failed first read hides the card and leaves the rest of the page alone;
  // a failed background refetch keeps the card already shown.
  const health = healthQuery.data ?? (healthQuery.error ? null : undefined);
  const postsKey = [
    'analytics-posts',
    clientId,
    days,
    sort.col,
    sort.dir,
    periodStart,
    periodEnd,
    baselineQuery.dataUpdatedAt,
  ];
  const {
    data: postsRes,
    isLoading: loadingPosts,
    isSuccess: postsSettled,
    isFetching: postsFetching,
  } = useQuery({
    queryKey: postsKey,
    queryFn: () =>
      getPostsAnalytics(clientId, days, sort.col, sort.dir, dateRange, baselineQuery.data?.dists),
    enabled: baselineQuery.isSuccess || baselineQuery.isError,
    // A baseline refetch only changes the key's last part: keep the posts on screen (and an
    // open metrics dialog mounted) instead of dropping to the skeleton.
    placeholderData: (prev, prevQuery) => keepPostsAcrossBaselineRefresh(prev, prevQuery, postsKey),
  });
  const { data: historyRes } = useQuery({
    queryKey: ['analytics-history', clientId, days, periodStart, periodEnd],
    queryFn: () => getFollowerHistory(clientId, days, dateRange),
  });
  const { data: tagsData = [] } = useQuery({ queryKey: ['analytics-tags'], queryFn: getTags });
  const { data: demoRes } = useQuery({
    queryKey: ['analytics-demo', clientId],
    queryFn: () => getAudienceDemographics(clientId).catch(() => null),
  });
  const { data: onlineRes } = useQuery({
    queryKey: ['analytics-times', clientId],
    queryFn: () => getBestPostingTimes(clientId).catch(() => null),
  });
  const storiesQuery = useQuery({
    queryKey: ['stories-analytics', clientId, days, periodStart, periodEnd],
    queryFn: () => getStoriesAnalytics(clientId, days, dateRange),
  });

  const isLoading = loadingOv || loadingPosts;
  const overview = overviewRes?.data;
  const posts = postsRes?.posts || [];
  const openPost = posts.find((p) => p.id === openPostId) ?? null;
  const dialogPost = openPostId === null ? null : (openPost ?? heldPost);
  const openPostMetrics: OpenPostHandler = (post, opener) => {
    openRequestRef.current += 1;
    openerRef.current = opener;
    setFetchedPostId(null);
    setHeldPost(post);
    setOpenPostId(post.id);
  };
  // The health card's best post can be older than the loaded period: open it from the list
  // when it is there, otherwise fetch it by id and hold it.
  const openHealthPost = async (postId: string) => {
    const request = ++openRequestRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const listed = posts.find((p) => p.id === postId);
    if (listed) {
      openerRef.current = opener;
      setFetchedPostId(null);
      setHeldPost(listed);
      setOpenPostId(listed.id);
      return;
    }
    try {
      const fetched = await getPostAnalyticsById(clientId, postId, baselineQuery.data?.dists);
      if (request !== openRequestRef.current) return;
      if (!fetched) {
        toast.error(t('toast.openPostFailed'));
        return;
      }
      openerRef.current = opener;
      setFetchedPostId(fetched.id);
      setHeldPost(fetched);
      setOpenPostId(fetched.id);
    } catch {
      if (request === openRequestRef.current) toast.error(t('toast.openPostFailed'));
    }
  };
  // Close only once the list has settled without the post (a sync removed it). A key change
  // or a refetch empties or holds the list while fetching and must not close the dialog.
  // A post fetched by id was never in the list, so it stays open.
  useEffect(() => {
    if (
      openPostId !== null &&
      openPostId !== fetchedPostId &&
      !openPost &&
      postsSettled &&
      !postsFetching
    ) {
      openRequestRef.current += 1;
      setOpenPostId(null);
      setHeldPost(null);
    }
  }, [openPostId, fetchedPostId, openPost, postsSettled, postsFetching]);
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
        next.sort((a, b) =>
          compareNullableNumber(
            (a as PostAnalytics).ig_score,
            (b as PostAnalytics).ig_score,
            rankedAsc ? 'asc' : 'desc',
          ),
        );
        break;
      case 'share_rate':
      case 'like_rate':
      case 'save_rate':
      case 'comment_rate': {
        const key = rankedOrderBy as RateKey;
        next.sort((a, b) =>
          compareNullableNumber(
            (a as PostAnalytics).rates[key],
            (b as PostAnalytics).rates[key],
            rankedAsc ? 'asc' : 'desc',
          ),
        );
        break;
      }
      case 'profile_visits':
      case 'follows':
      case 'bio_link_clicks':
      case 'follows_per_mil_reach': {
        const key = rankedOrderBy;
        next.sort((a, b) =>
          compareNullableNumber(
            (a as PostAnalytics)[key],
            (b as PostAnalytics)[key],
            rankedAsc ? 'asc' : 'desc',
          ),
        );
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
      toast.success(t('toast.synced'));
      // account-metrics sits behind a 6h server-side cache
      // (instagram_analytics_cache) -- a plain invalidateQueries would just
      // refetch with the same non-refresh queryFn and hit that cache again,
      // so a manual sync would silently show stale numbers. fetchQuery with
      // refresh:true bypasses the cache read for exactly this query's key and
      // writes the fresh result straight into it; the mounted useQuery on the
      // same key picks it up like any other cache update. staleTime MUST be
      // forced to 0 here: fetchQuery only calls queryFn when the CACHED entry
      // is stale, and the app's global default is staleTime: 30_000
      // (App.tsx) -- without this override, clicking "Sincronizar" within 30s
      // of the page mounting (or a previous fetch) would silently resolve
      // from cache and skip the refresh=1 request entirely.
      //
      // cancelQueries FIRST is required too: if the page's own initial
      // useQuery for this exact key is still in flight when "Sincronizar" is
      // clicked, fetchQuery would DEDUPE onto that in-flight (non-refresh)
      // request instead of issuing its own refresh:true one -- same stale-data
      // outcome, one layer removed. Cancelling clears the in-flight query so
      // fetchQuery always starts its own fresh, refresh:true request.
      const accountMetricsKey = ['account-metrics', clientId, metricsRange.start, metricsRange.end];
      await qc.cancelQueries({ queryKey: accountMetricsKey });
      qc.fetchQuery({
        queryKey: accountMetricsKey,
        queryFn: () =>
          getAccountMetrics(clientId, metricsRange.start, metricsRange.end, { refresh: true }),
        staleTime: 0,
      });
      qc.invalidateQueries({ queryKey: ['analytics-overview', clientId] });
      qc.invalidateQueries({ queryKey: ['analytics-posts', clientId] });
      qc.invalidateQueries({ queryKey: ['analytics-history', clientId] });
      qc.invalidateQueries({ queryKey: ['client-rate-baseline', clientId] });
      qc.invalidateQueries({ queryKey: ['ig-account-health', clientId] });
    } catch (err: any) {
      if (err.message === 'TOKEN_EXPIRED') {
        toast.error(t('toast.tokenExpired'));
      } else {
        toast.error(
          t('toast.syncError', { message: err.message || t('toast.syncFailedFallback') }),
        );
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
    setPeriodLabel(
      firstOfLastMonth.toLocaleString(getIntlLocale(), { month: 'short', year: 'numeric' }),
    );
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
      toast.error(t('toast.fillAll'));
      return;
    }
    try {
      await upsertManualFollowerCount(clientId, manualDate, count);
      toast.success(t('toast.followersSaved'));
      setManualFollowerOpen(false);
      setManualCount('');
      qc.invalidateQueries({ queryKey: ['analytics-history', clientId] });
    } catch (err: any) {
      toast.error(err.message || t('toast.saveError'));
    }
  };

  // Resolves true when the tag was created. The phone's "Nova tag" sheet calls it
  // directly; desktop asks for the name with prompt() first.
  const createTagNamed = async (name: string): Promise<boolean> => {
    const colors = ['#3ecf8e', '#f5a342', '#42c8f5', '#f542c8', '#eab308', '#f55a42', '#8b5cf6'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    try {
      await createTag(name.trim(), color);
      toast.success(t('toast.tagCreated'));
      qc.invalidateQueries({ queryKey: ['analytics-tags'] });
      return true;
    } catch (err: any) {
      toast.error(err.message || t('toast.tagCreateError'));
      return false;
    }
  };

  const handleAddTag = async () => {
    const name = prompt(t('tag.newNamePrompt'));
    if (!name || !name.trim()) return;
    await createTagNamed(name);
  };

  const deleteTagConfirmed = async (tagId: number) => {
    try {
      await deleteTag(tagId);
      toast.success(t('toast.tagRemoved'));
      qc.invalidateQueries({ queryKey: ['analytics-tags'] });
    } catch (err: any) {
      toast.error(err.message || t('toast.genericError'));
    }
  };

  const handleRemoveTag = async (tagId: number) => {
    if (!confirm(t('tag.confirmRemove'))) return;
    await deleteTagConfirmed(tagId);
  };

  // Phone tag toggles in the post sheet: assigning is the desktop "+ tag" chip;
  // un-assigning uses removeTagFromPost, which the desktop table doesn't offer.
  const handleToggleTag = async (post: PostAnalytics, tag: PostTag, assigned: boolean) => {
    try {
      if (assigned) await removeTagFromPost(post.id, tag.id);
      else await assignTagToPost(post.id, tag.id);
      await qc.invalidateQueries({ queryKey: ['analytics-posts', clientId] });
    } catch (err: any) {
      toast.error(
        err.message || (assigned ? t('toast.tagRemoveError') : t('toast.tagAssignError')),
      );
    }
  };

  const handleAssignTag = async (postId: string, tagId: number) => {
    try {
      await assignTagToPost(postId, tagId);
      qc.invalidateQueries({ queryKey: ['analytics-posts', clientId] });
    } catch (err: any) {
      toast.error(err.message || t('toast.tagAssignError'));
    }
  };

  const applyCustomDays = (val: number) => {
    setOverviewDays(val);
    setPeriodStart(undefined);
    setPeriodEnd(undefined);
    setPeriodLabel(undefined);
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
    loadingMetrics ? '…' : v != null ? v.toLocaleString(getIntlLocale()) : '—';
  const metricDelta = (current: number | null | undefined, previous: number | null | undefined) =>
    current != null && previous != null ? makeDelta(current, previous) : undefined;
  const metricPrevFormatted = (previous: number | null | undefined) =>
    previous != null ? previous.toLocaleString(getIntlLocale()) : undefined;

  const viewsSub = !loadingMetrics && !metricsRes ? t('page.unavailableNow') : undefined;

  const followersWindow = metricsCurrent?.followers ?? null;
  const followersPrevWindow = metricsPrevious?.followers ?? null;
  const followersDelta =
    followersWindow && followersPrevWindow
      ? makeDelta(followersWindow.delta, followersPrevWindow.delta)
      : undefined;
  const followersValue = loadingMetrics
    ? '…'
    : followersWindow
      ? followersWindow.end.toLocaleString(getIntlLocale())
      : '—';
  const followersPrevFormatted = followersWindow
    ? followersWindow.start.toLocaleString(getIntlLocale())
    : undefined;

  const cacheNote = overviewRes?.fromCache ? (
    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
      {t('page.dataFrom')}{' '}
      {new Date(overviewRes.fetchedAt).toLocaleString(getIntlLocale(), {
        timeZone: 'America/Sao_Paulo',
      })}
    </span>
  ) : null;

  const handleLink = (
    <a
      href={sanitizeUrl(`https://instagram.com/${encodeURIComponent(account.username)}`)}
      target="_blank"
      rel="noopener noreferrer"
      className="conta-identity__handle-link"
    >
      @{account.username}
    </a>
  );
  // The client's name and photo live in the shell's header; the Instagram-only header actions
  // (sync, Gerar Relatório) and the handle sit at the top of this tab.
  const headerActions = (
    <>
      <Button
        variant="outline"
        size="icon"
        disabled={syncing}
        onClick={handleSync}
        title={t('page.syncData')}
      >
        {syncing ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
      </Button>
    </>
  );
  const primaryAction = (
    <Button onClick={() => setNewReportOpen(true)}>
      <FileText className="h-4 w-4" /> {t('page.generateReport')}
    </Button>
  );

  // Below the shell's header and tabs: no header bars in this placeholder.
  if (isLoading) return <PageSkeleton body="report" header={false} />;

  if (!overview) return null;

  const kpiGrid = (
    <>
      {/* KPI Cards */}
      {/* 8 metrics as two clean rows of 4: eight-up squeezes the cards until
      labels wrap into the icon bubbles */}
      <StatCardGrid className="animate-up" maxCols={4} phoneLayout="scroll">
        <KpiCard
          label={t('kpi.views')}
          icon={Play}
          tone="violet"
          value={metricValue(metricsCurrent?.views)}
          delta={metricDelta(metricsCurrent?.views, metricsPrevious?.views)}
          period={periodTag}
          prevFormatted={metricPrevFormatted(metricsPrevious?.views)}
          sub={viewsSub}
        />
        <KpiCard
          label={t('kpi.followers')}
          icon={Users}
          tone="blue"
          value={followersValue}
          delta={followersDelta}
          period={periodTag}
          prevFormatted={followersPrevFormatted}
        />
        <KpiCard
          label={t('kpi.engagement')}
          icon={Heart}
          tone="pink"
          value={overview.engagement.current.toFixed(2) + '%'}
          delta={overview.engagement}
          period={periodTag}
          prevFormatted={overview.engagement.previous.toFixed(2) + '%'}
        />
        <KpiCard
          label={t('kpi.accountsEngaged')}
          icon={Zap}
          tone="amber"
          value={metricValue(metricsCurrent?.accounts_engaged)}
          delta={metricDelta(metricsCurrent?.accounts_engaged, metricsPrevious?.accounts_engaged)}
          period={periodTag}
          prevFormatted={metricPrevFormatted(metricsPrevious?.accounts_engaged)}
        />
        <KpiCard
          label={t('kpi.reach')}
          icon={Eye}
          tone="violet"
          value={metricValue(metricsCurrent?.reach)}
          delta={metricDelta(metricsCurrent?.reach, metricsPrevious?.reach)}
          period={periodTag}
          prevFormatted={metricPrevFormatted(metricsPrevious?.reach)}
        />
        <KpiCard
          label={t('kpi.linkClicks')}
          icon={MousePointerClick}
          tone="green"
          value={metricValue(metricsCurrent?.website_clicks)}
          delta={metricDelta(metricsCurrent?.website_clicks, metricsPrevious?.website_clicks)}
          period={periodTag}
          prevFormatted={metricPrevFormatted(metricsPrevious?.website_clicks)}
        />
        <KpiCard
          label={t('kpi.savesRate')}
          icon={Bookmark}
          tone="slate"
          value={overview.savesRate.current.toFixed(2) + '%'}
          delta={overview.savesRate}
          period={periodTag}
          prevFormatted={overview.savesRate.previous.toFixed(2) + '%'}
        />
        <KpiCard
          label={t('kpi.postsPublished')}
          icon={Send}
          tone="blue"
          value={String(overview.postsPublished.current)}
          delta={overview.postsPublished}
          period={periodTag}
          prevFormatted={String(overview.postsPublished.previous)}
        />
      </StatCardGrid>
    </>
  );

  // Rendered by both layouts (F0c turns the dialogs into sheets on phones).
  const dialogs = (
    <>
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
            <DialogTitle>{t('manual.title')}</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            {t('manual.help')}
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('manual.date')}</Label>
              <Input
                type="date"
                value={manualDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setManualDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('manual.count')}</Label>
              <Input
                type="number"
                min={0}
                placeholder={t('manual.placeholder')}
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
              {t('manual.cancel')}
            </Button>
            <Button onClick={handleSaveManualFollower}>{t('manual.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NewReportDialog open={newReportOpen} onOpenChange={setNewReportOpen} clientId={clientId} />
    </>
  );

  if (isPhone) {
    const typeHeadline =
      typeTop && typeSecond && typeRatio !== null && typeRatio >= 1.3
        ? t('insight.formatBeats', {
            top: typeTop.type,
            ratio: formatPct(typeRatio),
            second: typeSecond.type,
          })
        : typeTop
          ? t('insight.formatTop', { top: typeTop.type })
          : null;
    const demoHeadline = !demographicsData
      ? t('insight.unavailable')
      : demoHotAge && demoAgeTotal > 0
        ? t('insight.audienceCore', {
            who: demoFemaleDominant ? t('insight.women') : t('insight.men'),
            age: demoHotAge.age_range,
          })
        : null;
    return (
      <>
        <ContaPhone
          clientId={clientId}
          clienteNome={cliente.nome}
          account={account}
          cachedAt={overviewRes?.fromCache ? overviewRes.fetchedAt : null}
          syncing={syncing}
          onSync={handleSync}
          onNewReport={() => setNewReportOpen(true)}
          overviewDays={overviewDays}
          days={days}
          periodStart={periodStart}
          periodTag={periodTag}
          onDays={handleDaysChange}
          onLastMonth={handleLastMonth}
          onCustomDays={applyCustomDays}
          kpis={kpiGrid}
          history={history}
          onManualFollower={() => setManualFollowerOpen(true)}
          posts={posts}
          rankedPosts={rankedPosts}
          matureRankedPosts={matureRankedPosts}
          drawer={{
            mode: rankedDrawer,
            open: openRankedDrawer,
            close: resetRankedDrawer,
            posts: rankedDrawerPosts,
            total: rankedDrawer === 'worst' ? matureRankedPosts.length : posts.length,
            orderBy: rankedOrderBy,
            setOrderBy: (v) => setRankedOrderBy(v as RankedPostOrderBy),
            asc: rankedAsc,
            setAsc: setRankedAsc,
            format: rankedFormatFilter,
            setFormat: setRankedFormatFilter,
            formats: rankedPostFormats,
            dateFrom: rankedDateFrom,
            setDateFrom: setRankedDateFrom,
            dateTo: rankedDateTo,
            setDateTo: setRankedDateTo,
          }}
          sort={sort}
          onSort={setSort}
          showAllPosts={showAllPosts}
          onToggleShowAll={() => setShowAllPosts((v) => !v)}
          tags={tagsData}
          onToggleTag={handleToggleTag}
          onCreateTag={createTagNamed}
          onDeleteTag={deleteTagConfirmed}
          topSaved={topSaved}
          typeBreakdown={typeBreakdown}
          topicStats={topicStats}
          typeHeadline={typeHeadline}
          demographics={demographicsData}
          demoHeadline={demoHeadline}
          bestTimes={bestTimesData}
          stories={storiesQuery.data ?? null}
          baseline={baselineQuery.data?.baseline ?? null}
          dists={baselineQuery.data?.dists}
          health={health}
          healthLoading={healthQuery.isLoading}
          tabs={tabs}
        />
        {dialogs}
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="flex flex-wrap items-center justify-between gap-3 animate-up">
        <p className="flex flex-wrap items-center gap-2" style={{ margin: 0 }}>
          {handleLink} {cacheNote}
        </p>
        <div className="header-actions">
          {headerActions}
          {primaryAction}
        </div>
      </div>

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
              {t('filter.days', { count: d })}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={!!periodStart}
            className={`page-tab${periodStart ? ' active' : ''}`}
            onClick={handleLastMonth}
          >
            {t('filter.lastMonth')}
          </button>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t('filter.or')}</span>
        <Input
          type="number"
          min={1}
          max={730}
          placeholder={t('filter.daysPlaceholder')}
          aria-label={t('filter.customDaysLabel')}
          className="!rounded-full !text-xs h-9 w-[110px] mb-0"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = parseInt((e.target as HTMLInputElement).value, 10);
              if (isNaN(val) || val < 1 || val > 730) {
                toast.error(t('filter.invalidDays'));
                return;
              }
              applyCustomDays(val);
            }
          }}
        />
      </div>

      <AccountHealthCard
        health={health}
        isLoading={healthQuery.isLoading}
        onOpenPost={(postId) => void openHealthPost(postId)}
      />

      {kpiGrid}

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
                {t('saves.title')}
                <span className="analytics-callout__count">
                  {t('saves.featured', { count: topSaved.length })}
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 analytics-callout__chevron${savesOpen ? ' open' : ''}`}
                aria-hidden
              />
            </button>
            {savesOpen && (
              <div id="saves-callout-content" className="analytics-callout__collapsible">
                <p className="analytics-callout__text">{t('saves.help')}</p>
                <div className="analytics-callout__grid">
                  {topSaved.map((p) => (
                    <div key={p.id} className="analytics-callout__item">
                      <Trans
                        t={t}
                        i18nKey="saves.item"
                        values={{ count: p.saved }}
                        components={{ strong: <strong /> }}
                      />
                      <span style={{ color: 'var(--text-muted)', marginLeft: '0.25rem' }}>
                        {t('saves.rate', { rate: p.saves_rate.toFixed(1) })}
                      </span>
                      <div className="analytics-callout__item-caption">
                        {p.caption || t('page.noCaption')}
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
        title={t('ranked.bestTitle')}
        description={t('ranked.bestDescription', { period: periodTag })}
        icon={<Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} />}
        posts={rankedPosts.slice(0, 5)}
        tone="best"
        canSeeMore={rankedPosts.length > 5}
        onSeeMore={() => openRankedDrawer('best')}
        onOpen={openPostMetrics}
      />

      <RankedPostsSection
        title={t('ranked.worstTitle')}
        description={t('ranked.worstDescription')}
        icon={<AlertTriangle className="h-5 w-5" style={{ color: 'var(--warning)' }} />}
        posts={matureRankedPosts.slice(0, 5)}
        tone="worst"
        canSeeMore={matureRankedPosts.length > 5}
        onSeeMore={() => openRankedDrawer('worst')}
        onOpen={openPostMetrics}
      />

      {/* Follower Growth Chart */}
      <div className="card animate-up">
        <div className="dashboard-hub-card-header">
          <h3>{t('followers.title')}</h3>
          <Button size="sm" variant="outline" onClick={() => setManualFollowerOpen(true)}>
            {t('followers.manualButton')}
          </Button>
        </div>
        <FollowerChart history={history} postDates={postDates} />
      </div>

      {/* Content Performance Table */}
      <div className="card animate-up">
        <div className="dashboard-hub-card-header">
          <h3>{t('table.title')}</h3>
        </div>
        {posts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>{t('table.empty')}</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table className="data-table" id="posts-table">
              <thead>
                <tr>
                  {[
                    { col: 'posted_at', key: 'date' },
                    { col: null, key: 'type' },
                    { col: 'impressions', key: 'views' },
                    { col: 'reach', key: 'reach' },
                    { col: 'engagement_rate', key: 'eng' },
                    { col: 'ig_score', key: 'igScore' },
                    { col: 'likes', key: 'likes' },
                    { col: 'saved', key: 'saved' },
                    { col: 'comments', key: 'comments' },
                    { col: 'shares', key: 'shares' },
                    { col: 'follows', key: 'follows' },
                    { col: null, key: 'tags' },
                  ].map(({ col, key }) => (
                    <th
                      key={key}
                      style={{ cursor: col ? 'pointer' : 'default' }}
                      onClick={col ? () => handleSortChange(col) : undefined}
                    >
                      {t(`table.${key}`)}
                      {col && sort.col === col && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiblePosts.map((p) => (
                  <tr
                    key={p.id}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      // Focus returns to the row's button, never to the <tr>.
                      const opener = e.currentTarget.querySelector<HTMLElement>('.post-row-open');
                      if (opener) openPostMetrics(p, opener);
                    }}
                  >
                    <td data-label={t('table.date')}>
                      <button
                        type="button"
                        className="post-row-open"
                        aria-label={t('table.viewPostMetrics', {
                          when: formatPublishedDateTime(p.posted_at),
                        })}
                        onClick={(e) => {
                          e.stopPropagation();
                          openPostMetrics(p, e.currentTarget);
                        }}
                      >
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
                        <span>{new Date(p.posted_at).toLocaleDateString(getIntlLocale())}</span>
                      </button>
                    </td>
                    <td data-label={t('table.type')}>
                      <span className="badge badge-info">{formatMediaType(p.media_type)}</span>
                    </td>
                    <td data-label={t('table.views')}>{p.views.toLocaleString(getIntlLocale())}</td>
                    <td data-label={t('table.reach')}>{p.reach.toLocaleString(getIntlLocale())}</td>
                    <td data-label={t('table.eng')}>
                      <span
                        className={`badge ${p.engagement_rate >= 5 ? 'badge-success' : p.engagement_rate >= 2 ? 'badge-warning' : 'badge-neutral'}`}
                      >
                        {p.engagement_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td data-label={t('table.igScore')}>
                      {(p as PostAnalytics).ig_score === null ||
                      (p as PostAnalytics).ig_score === undefined ? (
                        <span
                          title={t('table.insufficientSample')}
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
                    <td data-label={t('table.likes')}>
                      {(p.likes || 0).toLocaleString(getIntlLocale())}
                    </td>
                    <td data-label={t('table.saved')}>{p.saved}</td>
                    <td data-label={t('table.comments')}>{p.comments}</td>
                    <td data-label={t('table.shares')}>{p.shares}</td>
                    <td data-label={t('table.follows')}>
                      <ActionMetricValue post={p} metric="follows" as="span" />
                    </td>
                    <td data-label={t('table.tags')} onClick={(e) => e.stopPropagation()}>
                      {p.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="tag-pill"
                          style={{
                            background: tag.color + '20',
                            color: tag.color,
                            border: `1px solid ${tag.color}40`,
                            marginRight: 2,
                          }}
                        >
                          {tag.tag_name}
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
                            .filter((tag) => !p.tags.some((pt) => pt.id === tag.id))
                            .map((tag) => (
                              <span
                                key={tag.id}
                                title={t('table.addTag', { tag: tag.tag_name })}
                                onClick={() => handleAssignTag(p.id, tag.id)}
                                style={{
                                  background: tag.color + '20',
                                  color: tag.color,
                                  border: `1px solid ${tag.color}40`,
                                  cursor: 'pointer',
                                  display: 'inline-block',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  fontSize: '0.7rem',
                                  marginRight: 2,
                                }}
                              >
                                + {tag.tag_name}
                              </span>
                            ))}
                        </span>
                      )}
                    </td>
                  </tr>
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
                {showAllPosts ? t('table.showLess') : t('table.showMore')}
              </button>
            )}
          </div>
        )}
      </div>

      <AccountCommentsCard clientId={clientId} posts={posts} />

      {/* AI Analysis */}
      <AISection clientId={clientId} days={days} />

      {baselineQuery.data && <BaselineCard baseline={baselineQuery.data.baseline} />}

      {storiesQuery.data && storiesQuery.data.kpis.current.stories_count > 0 && (
        <StoriesSection data={storiesQuery.data} />
      )}

      {/* Type + Topic */}
      <div className="widgets-grid animate-up">
        <div className="card">
          {typeTop && typeSecond && typeRatio !== null && typeRatio >= 1.3 ? (
            <InsightHeader
              kpi={
                <Trans
                  t={t}
                  i18nKey="insight.formatBeatsRich"
                  values={{
                    top: typeTop.type,
                    ratio: formatPct(typeRatio),
                    second: typeSecond.type,
                  }}
                  components={{ em: <em /> }}
                />
              }
              sub={t('insight.avgVs', {
                a: formatPct(typeTop.avgEngagement),
                b: formatPct(typeSecond.avgEngagement),
                days,
              })}
            />
          ) : typeTop ? (
            <InsightHeader
              kpi={
                <Trans
                  t={t}
                  i18nKey="insight.formatTopRich"
                  values={{ top: typeTop.type }}
                  components={{ em: <em /> }}
                />
              }
              sub={t('insight.avgTop', { a: formatPct(typeTop.avgEngagement), days })}
            />
          ) : (
            <div className="dashboard-hub-card-header">
              <h3>{t('insight.byType')}</h3>
            </div>
          )}
          <TypeChart typeBreakdown={typeBreakdown} />
        </div>
        <div className="card">
          {topicStats.length > 0 ? (
            <InsightHeader
              kpi={
                <Trans
                  t={t}
                  i18nKey="insight.topicTopRich"
                  values={{ tag: topicStats[0].tag_name }}
                  components={{ em: <em /> }}
                />
              }
              sub={t('insight.topicSub', {
                pct: formatPct(topicStats[0].avgEngagement),
                count: topicStats[0].count,
              })}
            />
          ) : (
            <div className="dashboard-hub-card-header">
              <h3>{t('insight.byTopic')}</h3>
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
            {tagsData.map((tag) => (
              <TagPill key={tag.id} tag={tag} onRemove={() => handleRemoveTag(tag.id)} />
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddTag}
              style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
            >
              <Plus className="h-3 w-3" /> {t('topic.newTag')}
            </Button>
          </div>
          {topicStats.length === 0 ? (
            <>
              {tagsData.length === 0 && (
                <div className="an-ghost-pills">
                  <span className="an-ghost-pill">{t('topic.ghost1')}</span>
                  <span className="an-ghost-pill">{t('topic.ghost2')}</span>
                  <span className="an-ghost-pill">{t('topic.ghost3')}</span>
                </div>
              )}
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {tagsData.length === 0 ? t('topic.hintNoTags') : t('topic.hintAssign')}
              </p>
            </>
          ) : (
            <div style={{ marginTop: '0.5rem' }}>
              {topicStats.map((topic, i) => (
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
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: topic.color,
                      }}
                    />
                    <span style={{ fontSize: '0.85rem' }}>{topic.tag_name}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {t('topic.count', { count: topic.count })}
                    </span>
                  </div>
                  <span
                    className={`badge ${topic.avgEngagement >= 5 ? 'badge-success' : topic.avgEngagement >= 2 ? 'badge-warning' : 'badge-neutral'}`}
                  >
                    {topic.avgEngagement.toFixed(2)}%
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
                <Trans
                  t={t}
                  i18nKey="demo.headlineRich"
                  values={{
                    who: demoFemaleDominant ? t('insight.women') : t('insight.men'),
                    age: demoHotAge.age_range,
                  }}
                  components={{ em: <em /> }}
                />
              }
              sub={
                <>
                  {demoFemaleDominant
                    ? t('demo.female', { pct: demographicsData.gender_split.female })
                    : t('demo.male', { pct: demographicsData.gender_split.male })}
                  {demoTopCity && demoTopCityShare > 0 && (
                    <>
                      {' '}
                      ·{' '}
                      {t('demo.city', {
                        share: demoTopCityShare,
                        city: demoTopCity.name.split(',')[0],
                      })}
                    </>
                  )}
                </>
              }
            />
          ) : (
            <div className="dashboard-hub-card-header">
              <h3>{t('demo.title')}</h3>
            </div>
          )}
          {!demographicsData ? (
            <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>{t('demo.unavailable')}</p>
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
                  {t('demo.maleLabel')} <strong>{demographicsData.gender_split.male}%</strong>
                </span>
                <span>
                  <span className="an-dot" style={{ background: 'var(--an-female)' }} />
                  {t('demo.femaleLabel')} <strong>{demographicsData.gender_split.female}%</strong>
                </span>
              </div>
              <h4 className="an-mini-h">{t('demo.ageRange')}</h4>
              <AgeChart demographics={demographicsData} />
              <h4 className="an-mini-h">{t('demo.topCities')}</h4>
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
                    <span className="an-city-val">{c.count.toLocaleString(getIntlLocale())}</span>
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
                <Trans
                  t={t}
                  i18nKey="best.headlineRich"
                  values={{
                    day: dayFull(bestTimesData.labels_days[bestSlot.day]),
                    hour: hourText(bestTimesData.labels_hours[bestSlot.hour]),
                  }}
                  components={{ em: <em /> }}
                />
              }
              sub={t('best.sub', {
                pct: formatPct(bestSlot.value),
                count: bestTimesData.totalPosts,
              })}
            />
          ) : (
            <div className="dashboard-hub-card-header">
              <h3>{t('best.title')}</h3>
            </div>
          )}
          {!bestTimesData || bestTimesData.totalPosts < 5 ? (
            <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
              {t('best.insufficient')}
            </p>
          ) : (
            <div style={{ marginTop: '0.5rem' }}>
              <BestTimesHeatmap data={bestTimesData} />
              {bestTimesData.topSlots.length > 0 && (
                <div style={{ marginTop: '1.2rem' }}>
                  <h4 className="an-mini-h" style={{ margin: '0 0 0.5rem' }}>
                    {t('best.recommended')}
                  </h4>
                  {bestTimesData.topSlots.map((s, i) => (
                    <div key={i} className="an-slot-row">
                      <span className={`an-slot-rank${i === 0 ? ' r1' : ''}`}>{i + 1}</span>
                      <span className="an-slot-when">
                        {t('best.when', {
                          day: dayShort(bestTimesData.labels_days[s.day]),
                          hour: hourText(bestTimesData.labels_hours[s.hour]),
                        })}
                      </span>
                      <span className="an-slot-meta">
                        {t('best.meta', { pct: formatPct(s.value), count: s.postCount })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {dialogs}

      <PostMetricsDialog
        post={dialogPost}
        onOpenChange={(o) => {
          if (!o) {
            openRequestRef.current += 1;
            setOpenPostId(null);
            setHeldPost(null);
            setFetchedPostId(null);
          }
        }}
        returnFocusTo={openerRef}
        dists={baselineQuery.data?.dists}
        commentsEnabled={commentsAiEnabled}
        clientId={clientId}
      />

      <Sheet
        open={rankedDrawer !== null}
        onOpenChange={(open) => {
          if (!open) resetRankedDrawer();
        }}
      >
        <SheetContent
          side="right"
          // While a post is open the drawer steps below the Dialog layer (9010/9011): the metrics
          // pop-up keeps the default layer so the Comentários tab's menu, delete confirmation and
          // idea modal, which portal at that same layer, stack above it instead of behind.
          className={cn('!w-full !max-w-xl overflow-y-auto', openPostId !== null && 'z-[9005]')}
          overlayClassName={openPostId !== null ? 'z-[9004]' : undefined}
          // The metrics dialog opens above the drawer: a click or focus in it must not close it.
          onInteractOutside={(e) => {
            if (openPostId !== null) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (openPostId !== null) e.preventDefault();
          }}
          onFocusOutside={(e) => {
            if (openPostId !== null) e.preventDefault();
          }}
        >
          <SheetHeader>
            <SheetTitle style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {rankedDrawer === 'worst' ? (
                <>
                  <AlertTriangle className="h-5 w-5" style={{ color: 'var(--warning)' }} />{' '}
                  {t('drawer.worstTitle')}
                </>
              ) : (
                <>
                  <Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} />{' '}
                  {t('drawer.bestTitle')}
                </>
              )}
            </SheetTitle>
            <SheetDescription>
              {t('drawer.subtitle', {
                shown: rankedDrawerPosts.length,
                total: rankedDrawer === 'worst' ? matureRankedPosts.length : posts.length,
                username: account.username,
              })}
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
                aria-label={t('drawer.sortLabel')}
                className="drawer-select"
                style={{
                  height: 36,
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: vidroShell ? undefined : 'var(--card-bg)',
                  color: 'var(--text-main)',
                  padding: '0 0.6rem',
                  fontSize: '0.85rem',
                }}
              >
                <option value="views">{t('drawer.sort.views')}</option>
                <option value="reach">{t('drawer.sort.reach')}</option>
                <option value="engagement">{t('drawer.sort.engagement')}</option>
                <option value="likes">{t('drawer.sort.likes')}</option>
                <option value="comments">{t('drawer.sort.comments')}</option>
                <option value="saved">{t('drawer.sort.saved')}</option>
                <option value="shares">{t('drawer.sort.shares')}</option>
                <option value="profile_visits">{t('drawer.sort.profile_visits')}</option>
                <option value="follows">{t('drawer.sort.follows')}</option>
                <option value="date">{t('drawer.sort.date')}</option>
                <option value="ig_score">{t('drawer.sort.ig_score')}</option>
                <option value="share_rate">{t('drawer.sort.share_rate')}</option>
                <option value="like_rate">{t('drawer.sort.like_rate')}</option>
                <option value="save_rate">{t('drawer.sort.save_rate')}</option>
                <option value="comment_rate">{t('drawer.sort.comment_rate')}</option>
                <option value="follows_per_mil_reach">
                  {t('drawer.sort.follows_per_mil_reach')}
                </option>
              </select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setRankedAsc((v) => !v)}
                className="mb-0 h-9 w-9 shrink-0 rounded-lg"
                title={rankedAsc ? t('drawer.ascending') : t('drawer.descending')}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
              </Button>
              <select
                value={rankedFormatFilter}
                onChange={(e) => setRankedFormatFilter(e.target.value)}
                aria-label={t('drawer.filterFormat')}
                className="drawer-select"
                style={{
                  height: 36,
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: vidroShell ? undefined : 'var(--card-bg)',
                  color: 'var(--text-main)',
                  padding: '0 0.6rem',
                  fontSize: '0.85rem',
                }}
              >
                <option value="all">{t('drawer.allFormats')}</option>
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
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {t('drawer.until')}
              </span>
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
                  {t('drawer.clearDates')}
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
                {t('drawer.empty')}
              </p>
            ) : (
              rankedDrawerPosts.map((post, i) => (
                <div
                  key={post.id}
                  className="ranked-drawer-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.65rem 0.75rem',
                    borderRadius: 10,
                    border: '1px solid var(--border-color)',
                    background: vidroShell ? undefined : 'var(--card-bg)',
                  }}
                >
                  <button
                    type="button"
                    className="ranked-drawer-row__open"
                    aria-label={t('page.viewMetrics', { caption: captionExcerpt(post.caption) })}
                    onClick={(e) => openPostMetrics(post, e.currentTarget)}
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
                          {post.caption || t('page.noCaption')}
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
                          {t('drawer.rowViews')}{' '}
                          <strong
                            style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}
                          >
                            {formatNumber(post.views)}
                          </strong>
                        </span>
                        <span>
                          {t('drawer.rowEng')}{' '}
                          <strong
                            style={{
                              fontFamily: 'var(--font-mono)',
                              color:
                                post.engagement_rate >= GOOD_ENGAGEMENT_RATE
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
                        {typeof post.follows === 'number' && (
                          <span
                            title={t('metric.newFollowers')}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
                          >
                            <UserPlus className="h-3 w-3" />{' '}
                            <strong
                              style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}
                            >
                              {formatNumber(post.follows)}
                            </strong>
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <InstagramLinkButton permalink={post.permalink} size={36} shape="square" />
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---- Stories Section ----
type StorySortCol =
  | 'posted_at'
  | 'reach'
  | 'impressions'
  | 'retention_rate'
  | 'taps_forward'
  | 'taps_back'
  | 'exits'
  | 'replies';

const STORY_COLUMNS: StorySortCol[] = [
  'posted_at',
  'reach',
  'impressions',
  'retention_rate',
  'taps_forward',
  'taps_back',
  'exits',
  'replies',
];

function StoriesSection({ data }: { data: StoriesAnalyticsResponse }) {
  const { t } = useTranslation('analyticsAccount');
  const { current, previous } = data.kpis;
  const [sort, setSort] = useState<{ col: StorySortCol; dir: 'asc' | 'desc' }>({
    col: 'posted_at',
    dir: 'desc',
  });

  const sortedStories = useMemo(() => {
    const value = (s: StoryInsight) =>
      sort.col === 'posted_at' ? new Date(s.posted_at).getTime() : s[sort.col];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...data.stories].sort((a, b) => (value(a) - value(b)) * sign);
  }, [data.stories, sort]);

  const handleSort = (col: StorySortCol) => {
    setSort((s) => ({ col, dir: s.col === col ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }));
  };

  return (
    <section className="animate-up" style={{ animationDelay: '0.4s' }}>
      <div className="flex items-center gap-2 mb-4">
        <Film className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-main)' }}>
          {t('stories.title')}
        </h2>
      </div>

      <StatCardGrid maxCols={4}>
        <StatCard
          label={t('stories.published')}
          value={current.stories_count}
          icon={Film}
          tone="blue"
          delta={toStatDelta(current.stories_count, previous?.stories_count)}
        />
        <StatCard
          label={t('stories.reach')}
          value={formatNumber(current.total_reach)}
          icon={Eye}
          tone="violet"
          delta={toStatDelta(current.total_reach, previous?.total_reach)}
        />
        <StatCard
          label={t('stories.retention')}
          value={`${(current.avg_retention_rate * 100).toFixed(1)}%`}
          icon={ChevronRight}
          tone="green"
          delta={toStatDelta(current.avg_retention_rate, previous?.avg_retention_rate)}
        />
        <StatCard
          label={t('stories.replies')}
          value={current.total_replies}
          icon={MessageCircle}
          tone="pink"
          delta={toStatDelta(current.total_replies, previous?.total_replies)}
        />
      </StatCardGrid>

      {data.stories.length > 0 && (
        <div className="card animate-up mt-4" style={{ animationDelay: '0.5s' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
            {t('stories.breakdown')}
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {STORY_COLUMNS.map((col) => (
                    <th
                      key={col}
                      className={`${col === 'posted_at' ? 'text-left' : 'text-right'} py-2 px-2 font-medium`}
                      style={{ color: 'var(--text-muted)' }}
                      aria-sort={
                        sort.col === col
                          ? sort.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => handleSort(col)}
                        className="font-medium"
                        style={{ cursor: 'pointer', color: 'inherit' }}
                      >
                        {t(`stories.col.${col}`)}
                        {sort.col === col && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedStories.map((story) => {
                  const retPct = (story.retention_rate * 100).toFixed(1);
                  // --danger fails AA as text on a light card (see
                  // DESIGN_SYSTEM.md); keep it for the fill and swap in
                  // --danger-text for the foreground on the low-retention chip.
                  const retFill =
                    story.retention_rate > 0.7
                      ? 'var(--success)'
                      : story.retention_rate > 0.5
                        ? 'var(--warning)'
                        : 'var(--danger)';
                  const retText = story.retention_rate > 0.5 ? retFill : 'var(--danger-text)';
                  return (
                    <tr
                      key={story.instagram_media_id}
                      style={{ borderBottom: '1px solid var(--border-color)' }}
                    >
                      <td className="py-2 px-2" style={{ color: 'var(--text-main)' }}>
                        {new Date(story.posted_at).toLocaleDateString(getIntlLocale(), {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </td>
                      <td className="text-right py-2 px-2" style={{ color: 'var(--text-main)' }}>
                        {formatNumber(story.reach)}
                      </td>
                      <td className="text-right py-2 px-2" style={{ color: 'var(--text-main)' }}>
                        {formatNumber(story.impressions)}
                      </td>
                      <td className="text-right py-2 px-2">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ backgroundColor: `${retFill}20`, color: retText }}
                        >
                          {retPct}%
                        </span>
                      </td>
                      <td className="text-right py-2 px-2" style={{ color: 'var(--text-muted)' }}>
                        {story.taps_forward}
                      </td>
                      <td className="text-right py-2 px-2" style={{ color: 'var(--text-muted)' }}>
                        {story.taps_back}
                      </td>
                      <td className="text-right py-2 px-2" style={{ color: 'var(--text-muted)' }}>
                        {story.exits}
                      </td>
                      <td className="text-right py-2 px-2" style={{ color: 'var(--text-muted)' }}>
                        {story.replies}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- Baseline Card ----
function BaselineCard({ baseline }: { baseline: Baseline }) {
  const { t } = useTranslation('analyticsAccount');
  if (baseline.sample_size === 0) return null;
  const strip = (key: RateKey) => {
    const stat = baseline.overall[key];
    const q: Quartiles | null = stat.quartiles;
    const scaleMax = q ? (q.p75 || 0) * 1.5 || 1 : 1;
    const pct = (v: number) => Math.max(0, Math.min(100, (v / scaleMax) * 100));
    const perFormat = Object.entries(baseline.by_format)
      .map(([fmt, m]) => {
        const fq = m[key].quartiles;
        return `${['VIDEO', 'CAROUSEL_ALBUM', 'IMAGE'].includes(fmt) ? t(`baseline.format.${fmt}`) : fmt} ${fq ? formatRate(fq.p50) : 'n<5'}`;
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
            {t(`baseline.rate.${key}`)}{' '}
            <span style={{ color: 'var(--primary-color)', fontSize: '0.62rem' }}>
              {t('baseline.weight', { pct: Math.round(IG_RATE_WEIGHTS[key] * 100) })}
            </span>
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {q ? formatRate(q.p50) : '—'}{' '}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.65rem' }}>
              {t('baseline.median')}
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
          {q
            ? t('baseline.quartiles', { p25: formatRate(q.p25), p75: formatRate(q.p75) })
            : t('baseline.insufficient')}
          {perFormat}
        </div>
      </div>
    );
  };
  return (
    <div className="card animate-up">
      <div className="dashboard-hub-card-header" style={{ marginBottom: '0.25rem' }}>
        <h3>{t('baseline.title')}</h3>
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        {t('baseline.description', { count: baseline.sample_size })}
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
        {t('baseline.note')}
      </div>
    </div>
  );
}

// ---- Instagram tab ----
/**
 * The Instagram tab of the client analytics page (`/analytics/:id/instagram`). The shell
 * (AnalyticsClientShell) owns the client lookup, the header and the tabs; this tab renders
 * its connection states below them, never replacing them.
 */
export function InstagramAnalyticsTab({
  clientId,
  cliente,
  tabs,
}: {
  clientId: number;
  cliente: any;
  /** Phone only: the shell's tab control, rendered under ContaPhone's identity. */
  tabs?: ReactNode;
}) {
  const { t } = useTranslation('analyticsAccount');
  const navigate = useNavigate();

  const {
    data: igSummary,
    isLoading: loadingIg,
    error: igError,
  } = useQuery({
    queryKey: ['ig-summary', clientId],
    queryFn: () => getInstagramSummary(clientId),
    enabled: !!clientId && !isNaN(clientId) && !!cliente,
  });
  const isPhone = !useIsDesktop(768);

  if (loadingIg) {
    return <PageSkeleton body="report" header={false} />;
  }

  if (igError) {
    const msg = igError instanceof Error ? igError.message : t('tab.error');
    if (msg === 'TOKEN_EXPIRED') {
      if (isPhone) {
        return (
          <ContaPhoneMessage
            title={t('tab.tokenExpiredTitle')}
            message={t('tab.tokenExpiredMessage')}
            action={{ label: t('tab.reconnectPhone'), to: `/clientes/${clientId}/redes-sociais` }}
            tabs={tabs}
          />
        );
      }
      return (
        <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>{t('tab.tokenExpiredTitle')}</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {t('tab.tokenExpiredMessage')}
          </p>
          <Button
            style={{ marginTop: '1rem' }}
            onClick={() => navigate(`/clientes/${clientId}/redes-sociais`)}
          >
            {t('tab.reconnect')}
          </Button>
        </div>
      );
    }
    if (isPhone) {
      return <ContaPhoneMessage title={t('tab.loadErrorTitle')} message={msg} tabs={tabs} />;
    }
    return (
      <div className="card">
        <p style={{ color: 'var(--danger)' }}>{t('tab.loadError', { message: msg })}</p>
      </div>
    );
  }

  if (!igSummary) {
    if (isPhone) {
      return (
        <ContaPhoneMessage
          title={t('tab.notConnectedTitle')}
          message={t('tab.notConnectedMessage')}
          action={{
            label: t('tab.goToClient'),
            to: `/clientes/${clientId}/redes-sociais`,
          }}
          tabs={tabs}
        />
      );
    }
    return (
      <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem' }}>
        <h3>{t('tab.notConnectedTitle')}</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          {t('tab.notConnectedMessage')}
        </p>
        <Button
          style={{ marginTop: '1rem' }}
          onClick={() => navigate(`/clientes/${clientId}/redes-sociais`)}
        >
          {t('tab.goToClient')}
        </Button>
      </div>
    );
  }

  return (
    <AnalyticsContent
      clientId={clientId}
      cliente={cliente}
      account={igSummary.account}
      tabs={tabs}
    />
  );
}
