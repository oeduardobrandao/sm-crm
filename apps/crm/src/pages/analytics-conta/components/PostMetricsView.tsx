import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Bookmark, Heart, MessageCircle, Repeat2, Send, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
import { Badge } from '@/components/ui/badge';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import type { PostAnalytics } from '../../../services/analytics';
import type { RateDistributions, RateKey } from '../../../lib/ig-rates';
import { missingActionMetricTitle, type ActionMetricKey } from '../../../lib/post-action-metrics';
import { PostCommentsPanel } from '../comments/PostCommentsPanel';
import {
  GOOD_ENGAGEMENT_RATE,
  formatMediaType,
  formatPublishedAt,
  formatSyncedAgo,
  rateBenchmark,
} from '../contaFormat';
import { PostThumbnail } from './PostThumbnail';

type Tab = 'overview' | 'engagement' | 'comments';

const fmtCount = (n: number) => n.toLocaleString('pt-BR');
const fmtPercent = (pct: number) =>
  `${pct.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const ACTION_ROWS: { metric: ActionMetricKey; label: string }[] = [
  { metric: 'profile_visits', label: 'Visitas ao perfil' },
  { metric: 'follows', label: 'Novos seguidores' },
  { metric: 'bio_link_clicks', label: 'Toques no link da bio' },
];

const RATE_ROWS: { key: RateKey; label: string }[] = [
  { key: 'share_rate', label: 'Compartilhamentos' },
  { key: 'like_rate', label: 'Curtidas' },
  { key: 'save_rate', label: 'Salvamentos' },
  { key: 'comment_rate', label: 'Comentários' },
];

/** A post's action-metric value, or "—" with a tooltip explaining why it's missing. */
export function ActionMetricValue({
  post,
  metric,
  as: Tag = 'strong',
}: {
  post: PostAnalytics;
  metric: ActionMetricKey;
  /** `span` renders plain text (table cells); `strong` is for label/value rows. */
  as?: 'strong' | 'span';
}) {
  const value = post[metric];
  if (typeof value === 'number') return <Tag>{value.toLocaleString('pt-BR')}</Tag>;
  return (
    <Tag
      title={missingActionMetricTitle(metric, post.unavailable_metrics, post.media_type)}
      style={{ color: 'var(--text-muted)', fontWeight: 400 }}
    >
      —
    </Tag>
  );
}

/** A titled block whose heading names it, so it reads as a region. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="post-metrics__section" aria-labelledby={id}>
      <h3 id={id} className="post-metrics__heading">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="post-metrics__row">
      <span>{label}</span>
      {children}
    </div>
  );
}

/** Resumo card for an action metric: the number, or "—" with the reason underneath. */
function ActionCard({
  post,
  metric,
  label,
}: {
  post: PostAnalytics;
  metric: ActionMetricKey;
  label: string;
}) {
  const value = post[metric];
  if (typeof value === 'number') {
    return (
      <div className="post-metrics__card">
        <span>{label}</span>
        <strong>{fmtCount(value)}</strong>
      </div>
    );
  }
  return (
    <div className="post-metrics__card post-metrics__card--missing">
      <span>{label}</span>
      <strong>—</strong>
      <em>{missingActionMetricTitle(metric, post.unavailable_metrics, post.media_type)}</em>
    </div>
  );
}

function Caption({ post }: { post: PostAnalytics }) {
  const ref = useRef<HTMLParagraphElement>(null);
  // Expansion belongs to one post, like the tab: another post opens clamped.
  const [state, setState] = useState<{ postId: string; expanded: boolean }>({
    postId: post.id,
    expanded: false,
  });
  const expanded = state.postId === post.id && state.expanded;
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    if (expanded) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [post.caption, expanded]);

  if (!post.caption) {
    return <p className="post-metrics__caption post-metrics__caption--empty">Sem legenda</p>;
  }
  return (
    <div className="post-metrics__caption-wrap">
      <p
        ref={ref}
        className={`post-metrics__caption${expanded ? '' : ' post-metrics__caption--clamped'}`}
      >
        {post.caption}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          className="post-metrics__more"
          aria-expanded={expanded}
          onClick={() => setState({ postId: post.id, expanded: !expanded })}
        >
          {expanded ? 'Ver menos' : 'Ver mais'}
        </button>
      )}
    </div>
  );
}

function IconRow({ post }: { post: PostAnalytics }) {
  const items: { icon: LucideIcon; value: number; label: string }[] = [
    { icon: Heart, value: post.likes ?? 0, label: 'Curtidas' },
    { icon: MessageCircle, value: post.comments ?? 0, label: 'Comentários' },
    ...(typeof post.reposts === 'number'
      ? [{ icon: Repeat2, value: post.reposts, label: 'Reposts' }]
      : []),
    // `shares` is what Instagram labels as sends.
    { icon: Send, value: post.shares ?? 0, label: 'Envios' },
    { icon: Bookmark, value: post.saved ?? 0, label: 'Salvos' },
  ];
  return (
    <ul className="post-metrics__stats" aria-label="Interações">
      {items.map(({ icon: Icon, value, label }) => (
        <li key={label} className="post-metrics__stat">
          <Icon aria-hidden="true" strokeWidth={1.8} />
          <strong>{fmtCount(value)}</strong>
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}

function OverviewPanel({ post, footer }: { post: PostAnalytics; footer?: ReactNode }) {
  return (
    <>
      <Section title="Resumo">
        <div className="post-metrics__cards">
          <div className="post-metrics__card">
            <span>Visualizações</span>
            <strong>{fmtCount(post.views)}</strong>
          </div>
          <div className="post-metrics__card">
            <span>Contas alcançadas</span>
            <strong>{fmtCount(post.reach)}</strong>
          </div>
          <ActionCard post={post} metric="profile_visits" label="Visitas ao perfil" />
          <ActionCard post={post} metric="follows" label="Novos seguidores" />
        </div>
        <div className="post-metrics__ratios">
          <div className="post-metrics__ratio">
            <span>Engajamento</span>
            <strong
              className={
                post.engagement_rate >= GOOD_ENGAGEMENT_RATE
                  ? 'post-metrics__ratio-value--good'
                  : undefined
              }
            >
              {fmtPercent(post.engagement_rate)}
            </strong>
          </div>
          {typeof post.ig_score === 'number' && (
            <div className="post-metrics__ratio">
              <span>IG Score</span>
              <strong>{post.ig_score} de 100</strong>
            </div>
          )}
        </div>
      </Section>
      {footer != null && <div className="post-metrics__overview-footer">{footer}</div>}
    </>
  );
}

function RateBlock({ post, dists }: { post: PostAnalytics; dists: RateDistributions }) {
  const rows = RATE_ROWS.flatMap(({ key, label }) => {
    const rate = post.rates?.[key];
    if (typeof rate !== 'number') return [];
    const bench = rateBenchmark(dists, post.media_type, key);
    // With a median the scale fits both the bar and the tick (spec §2.6). Without one there is
    // nothing to compare against, so the bar fills two thirds of the track.
    const scale = bench ? Math.max(rate, bench.p75 * 1.5) : rate * 1.5;
    const pct = (v: number) => (scale > 0 ? Math.min(100, (v / scale) * 100) : 0);
    return [{ key, label, rate, bench, fill: pct(rate), tick: bench ? pct(bench.p50) : null }];
  });
  if (rows.length === 0) return null;
  const anyTick = rows.some((r) => r.tick !== null);
  return (
    <Section title="Por visualização">
      <p className="post-metrics__hint">
        {anyTick
          ? 'A barra é este post; o traço é a mediana dos posts da conta.'
          : 'A barra é este post.'}
      </p>
      {rows.map((r) => (
        <div key={r.key} className="post-metrics__rate">
          <span>{r.label}</span>
          <span className="post-metrics__rate-track" aria-hidden="true">
            <span className="post-metrics__rate-fill" style={{ width: `${r.fill}%` }} />
            {r.tick !== null && (
              <span className="post-metrics__rate-tick" style={{ left: `${r.tick}%` }} />
            )}
          </span>
          <strong>{fmtPercent(r.rate * 100)}</strong>
          {r.bench && (
            <span className="sr-only">Mediana da conta: {fmtPercent(r.bench.p50 * 100)}</span>
          )}
        </div>
      ))}
    </Section>
  );
}

function EngagementPanel({ post, dists }: { post: PostAnalytics; dists?: RateDistributions }) {
  const follows = post.follows;
  const reachPerFollower =
    typeof follows === 'number' && follows > 0 && post.reach > 0
      ? Math.max(1, Math.round(post.reach / follows))
      : null;
  // Touch has no hover title, so the reason for a "—" is also written out.
  const missing = ACTION_ROWS.filter(({ metric }) => typeof post[metric] !== 'number').map(
    ({ metric, label }) => ({
      label,
      reason: missingActionMetricTitle(metric, post.unavailable_metrics, post.media_type),
    }),
  );
  const reasons = [...new Set(missing.map((m) => m.reason))];
  const missingNote =
    reasons.length === 1
      ? `${reasons[0]}.`
      : missing.map((m) => `${m.label}: ${m.reason}.`).join(' ');

  return (
    <>
      <Section title="Ações após a visualização">
        {ACTION_ROWS.map(({ metric, label }) => (
          <Row key={metric} label={label}>
            <ActionMetricValue post={post} metric={metric} />
          </Row>
        ))}
        {missing.length > 0 && <p className="post-metrics__hint">{missingNote}</p>}
        {reachPerFollower !== null && (
          <p className="post-metrics__hint">
            1 novo seguidor a cada {fmtCount(reachPerFollower)} contas alcançadas
          </p>
        )}
      </Section>
      <Section title="Interações">
        <Row label="Curtidas">
          <strong>{fmtCount(post.likes ?? 0)}</strong>
        </Row>
        <Row label="Comentários">
          <strong>{fmtCount(post.comments ?? 0)}</strong>
        </Row>
        {typeof post.reposts === 'number' && (
          <Row label="Reposts">
            <strong>{fmtCount(post.reposts)}</strong>
          </Row>
        )}
        <Row label="Compartilhamentos">
          <strong>{fmtCount(post.shares ?? 0)}</strong>
        </Row>
        <Row label="Salvamentos">
          <strong>{fmtCount(post.saved ?? 0)}</strong>
        </Row>
      </Section>
      {dists && <RateBlock post={post} dists={dists} />}
      <p className="post-metrics__note">
        O Instagram não informa curtidas por foto do carrossel, de onde vieram as visualizações nem
        o público do post.
      </p>
    </>
  );
}

/**
 * The metrics pop-up's content, shared by the desktop dialog and the phone sheet. The hosts own
 * the header (title, Instagram link, Fechar); this view starts at the post block.
 */
export function PostMetricsView({
  post,
  clientId,
  dists,
  commentsEnabled,
  variant,
  overviewFooter,
}: {
  post: PostAnalytics;
  clientId: number;
  dists?: RateDistributions;
  commentsEnabled: boolean;
  variant: 'dialog' | 'sheet';
  overviewFooter?: ReactNode;
}) {
  const { t } = useTranslation('analyticsComments');
  const intlLocale = useIntlLocale();
  const uid = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The tab belongs to one post: any other post opens on Visão geral, decided during render so
  // the comments panel never mounts (and fetches) for a post nobody asked about.
  const [tabState, setTabState] = useState<{ postId: string | null; tab: Tab }>({
    postId: null,
    tab: 'overview',
  });
  let tab: Tab = tabState.postId === post.id ? tabState.tab : 'overview';
  if (tab === 'comments' && !commentsEnabled) tab = 'overview';
  const setTab = (next: Tab) => setTabState({ postId: post.id, tab: next });

  const isReel = post.media_type === 'VIDEO';
  const synced = formatSyncedAgo(post.synced_at);
  const panelId = `${uid}-panel`;
  const tabId = (key: Tab) => `${uid}-tab-${key}`;
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: t('common.tabOverview') },
    { key: 'engagement', label: t('common.tabEngagement') },
    ...(commentsEnabled
      ? [
          {
            key: 'comments' as const,
            label: t('common.tabComments', {
              n: (post.comments || 0).toLocaleString(intlLocale),
            }),
          },
        ]
      : []),
  ];

  const onTabKeyDown = (i: number, e: KeyboardEvent<HTMLButtonElement>) => {
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
    setTab(tabs[next].key);
  };

  return (
    <div className={`post-metrics post-metrics--${variant}${isReel ? ' post-metrics--reel' : ''}`}>
      <div className="post-metrics__post">
        <div className="post-metrics__thumb">
          <PostThumbnail post={post} size="metrics" />
        </div>
        <div className="post-metrics__meta">
          <div className="post-metrics__meta-line">
            <Badge variant="neutral" size="sm">
              {formatMediaType(post.media_type)}
            </Badge>
            <span>{formatPublishedAt(post.posted_at)}</span>
          </div>
          <Caption post={post} />
        </div>
      </div>

      <IconRow post={post} />

      {variant === 'sheet' ? (
        <SegmentedControl
          semantics="tablist"
          aria-label={t('common.tabsAriaLabel')}
          className="post-metrics__segmented"
          value={tab}
          onChange={setTab}
          options={tabs.map((tb) => ({
            value: tb.key,
            label: tb.label,
            id: tabId(tb.key),
            controls: panelId,
          }))}
        />
      ) : (
        <div className="post-metrics__tabs" role="tablist" aria-label={t('common.tabsAriaLabel')}>
          {tabs.map((tb, i) => {
            const selected = tab === tb.key;
            return (
              <button
                key={tb.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={tabId(tb.key)}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                className="post-metrics__tab"
                data-state={selected ? 'active' : 'inactive'}
                onClick={() => setTab(tb.key)}
                onKeyDown={(e) => onTabKeyDown(i, e)}
              >
                {tb.label}
              </button>
            );
          })}
        </div>
      )}

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(tab)}
        className="post-metrics__panel"
      >
        {tab === 'overview' && <OverviewPanel post={post} footer={overviewFooter} />}
        {tab === 'engagement' && <EngagementPanel post={post} dists={dists} />}
        {tab === 'comments' && (
          <PostCommentsPanel
            key={post.id}
            clientId={clientId}
            post={post}
            compact={variant === 'sheet'}
          />
        )}
      </div>

      <div className="post-metrics__footer">
        <span>Dados da API oficial do Instagram. Podem levar até 48 h para fechar.</span>
        {synced && <span>{synced}</span>}
      </div>
    </div>
  );
}
