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
import i18n from 'i18next';
import { getIntlLocale, useIntlLocale } from '@mesaas/i18n';
import { Badge } from '@/components/ui/badge';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import type { PostAnalytics } from '../../../services/analytics';
import type { RateDistributions, RateKey } from '../../../lib/ig-rates';
import {
  notReturnedTitle,
  missingActionMetricTitle,
  type ActionMetricKey,
} from '../../../lib/post-action-metrics';
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

const fmtCount = (n: number) => n.toLocaleString(getIntlLocale());
const fmtPercent = (pct: number) =>
  `${pct.toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const ACTION_ROWS: ActionMetricKey[] = ['profile_visits', 'follows', 'bio_link_clicks'];

/** `unavailable_metrics` tokens of the counts the sync stores as 0 when Instagram skips them. */
type CountToken = 'impressions' | 'reach' | 'likes' | 'comments' | 'shares' | 'saved';

/**
 * A count the last sync didn't get and that never had a value before: the stored 0 is not a real
 * zero, so it reads "—". A non-zero value the sync kept from an earlier run is still shown.
 */
function countMissing(post: PostAnalytics, token: CountToken, value: number | null | undefined) {
  return (value ?? 0) === 0 && (post.unavailable_metrics ?? []).includes(token);
}

/** The written-out reason under a group of "—" counts (touch has no hover title). */
function missingCountsNote(labels: string[]): string {
  if (labels.length === 1) return i18n.t('analyticsAccount:pm.missingOne', { label: labels[0] });
  const list = i18n.t('analyticsAccount:pm.listAnd', {
    head: labels.slice(0, -1).join(', '),
    last: labels[labels.length - 1],
  });
  return i18n.t('analyticsAccount:pm.missingMany', { list });
}

/** A count for a label/value row: the number, or a muted "—" with the reason as its title. */
function CountValue({
  post,
  token,
  value,
}: {
  post: PostAnalytics;
  token: CountToken;
  value: number | null | undefined;
}) {
  if (!countMissing(post, token, value)) return <strong>{fmtCount(value ?? 0)}</strong>;
  return (
    <strong title={notReturnedTitle()} style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
      —
    </strong>
  );
}

const RATE_ROWS: RateKey[] = ['share_rate', 'like_rate', 'save_rate', 'comment_rate'];

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
  if (typeof value === 'number') return <Tag>{value.toLocaleString(getIntlLocale())}</Tag>;
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

/** Resumo card for a count (views, reach): the number, or "—" with the reason underneath. */
function CountCard({
  post,
  token,
  value,
  label,
}: {
  post: PostAnalytics;
  token: CountToken;
  value: number;
  label: string;
}) {
  if (!countMissing(post, token, value)) {
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
      <em>{notReturnedTitle()}</em>
    </div>
  );
}

function Caption({ post }: { post: PostAnalytics }) {
  const { t } = useTranslation('analyticsAccount');
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
    return (
      <p className="post-metrics__caption post-metrics__caption--empty">{t('pm.noCaption')}</p>
    );
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
          {expanded ? t('pm.less') : t('pm.more')}
        </button>
      )}
    </div>
  );
}

function IconRow({ post }: { post: PostAnalytics }) {
  const { t } = useTranslation('analyticsAccount');
  const items: { icon: LucideIcon; value: number; label: string; missing: boolean }[] = [
    {
      icon: Heart,
      value: post.likes ?? 0,
      label: t('pm.likes'),
      missing: countMissing(post, 'likes', post.likes),
    },
    {
      icon: MessageCircle,
      value: post.comments ?? 0,
      label: t('pm.comments'),
      missing: countMissing(post, 'comments', post.comments),
    },
    // Reposts is nullable already (null is hidden), so it never needs the unavailable check.
    ...(typeof post.reposts === 'number'
      ? [{ icon: Repeat2, value: post.reposts, label: t('pm.reposts'), missing: false }]
      : []),
    // `shares` is what Instagram labels as sends.
    {
      icon: Send,
      value: post.shares ?? 0,
      label: t('pm.sends'),
      missing: countMissing(post, 'shares', post.shares),
    },
    {
      icon: Bookmark,
      value: post.saved ?? 0,
      label: t('pm.saved'),
      missing: countMissing(post, 'saved', post.saved),
    },
  ];
  const missing = items.filter((i) => i.missing).map((i) => i.label);
  return (
    <>
      <ul className="post-metrics__stats" aria-label={t('pm.interactions')}>
        {items.map(({ icon: Icon, value, label, missing: isMissing }) => (
          <li
            key={label}
            className={`post-metrics__stat${isMissing ? ' post-metrics__stat--missing' : ''}`}
          >
            <Icon aria-hidden="true" strokeWidth={1.8} />
            {isMissing ? (
              <strong title={notReturnedTitle()}>—</strong>
            ) : (
              <strong>{fmtCount(value)}</strong>
            )}
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="post-metrics__hint post-metrics__stats-note">{missingCountsNote(missing)}</p>
      )}
    </>
  );
}

/**
 * Engagement is interactions over reach: without reach there is no rate, and a 0% built on
 * interactions Instagram didn't return is not a real 0% either.
 */
function engagementMissing(post: PostAnalytics): boolean {
  if (countMissing(post, 'reach', post.reach)) return true;
  return (
    post.engagement_rate === 0 &&
    (countMissing(post, 'likes', post.likes) ||
      countMissing(post, 'comments', post.comments) ||
      countMissing(post, 'saved', post.saved) ||
      countMissing(post, 'shares', post.shares))
  );
}

function OverviewPanel({ post, footer }: { post: PostAnalytics; footer?: ReactNode }) {
  const { t } = useTranslation('analyticsAccount');
  const noEngagement = engagementMissing(post);
  return (
    <>
      <Section title={t('pm.summary')}>
        <div className="post-metrics__cards">
          <CountCard post={post} token="impressions" value={post.views} label={t('pm.views')} />
          <CountCard post={post} token="reach" value={post.reach} label={t('pm.accountsReached')} />
          <ActionCard post={post} metric="profile_visits" label={t('pm.profileVisits')} />
          <ActionCard post={post} metric="follows" label={t('pm.newFollowers')} />
        </div>
        <div className="post-metrics__ratios">
          {noEngagement ? (
            <div className="post-metrics__ratio post-metrics__ratio--missing">
              <span>{t('pm.engagement')}</span>
              <strong>—</strong>
              <em>{notReturnedTitle()}</em>
            </div>
          ) : (
            <div className="post-metrics__ratio">
              <span>{t('pm.engagement')}</span>
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
          )}
          {typeof post.ig_score === 'number' && (
            <div className="post-metrics__ratio">
              <span>{t('pm.igScore')}</span>
              <strong>{t('pm.scoreOf', { score: post.ig_score })}</strong>
            </div>
          )}
        </div>
      </Section>
      {footer != null && <div className="post-metrics__overview-footer">{footer}</div>}
    </>
  );
}

function RateBlock({ post, dists }: { post: PostAnalytics; dists: RateDistributions }) {
  const { t } = useTranslation('analyticsAccount');
  const shown = RATE_ROWS.flatMap((key) => {
    const rate = post.rates?.[key];
    if (typeof rate !== 'number') return [];
    return [
      { key, label: t(`pm.rate.${key}`), rate, bench: rateBenchmark(dists, post.media_type, key) },
    ];
  });
  // Rows without a median compare against this post's largest rate, which fills the track.
  const ownMax = Math.max(0, ...shown.map((r) => r.rate));
  const rows = shown.map((r) => {
    // With a median the scale fits both the bar and the tick (spec §2.6).
    const scale = r.bench ? Math.max(r.rate, r.bench.p75 * 1.5) : ownMax;
    const pct = (v: number) => (scale > 0 ? Math.min(100, (v / scale) * 100) : 0);
    return { ...r, fill: pct(r.rate), tick: r.bench ? pct(r.bench.p50) : null };
  });
  if (rows.length === 0) return null;
  const anyTick = rows.some((r) => r.tick !== null);
  return (
    <Section title={t('pm.perView')}>
      <p className="post-metrics__hint">{anyTick ? t('pm.barPostMedian') : t('pm.barPost')}</p>
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
            <span className="sr-only">
              {t('pm.accountMedian', { value: fmtPercent(r.bench.p50 * 100) })}
            </span>
          )}
        </div>
      ))}
    </Section>
  );
}

function EngagementPanel({ post, dists }: { post: PostAnalytics; dists?: RateDistributions }) {
  const { t } = useTranslation('analyticsAccount');
  const follows = post.follows;
  const reachPerFollower =
    typeof follows === 'number' && follows > 0 && post.reach > 0
      ? Math.max(1, Math.round(post.reach / follows))
      : null;
  // Touch has no hover title, so the reason for a "—" is also written out.
  const missing = ACTION_ROWS.filter((metric) => typeof post[metric] !== 'number').map(
    (metric) => ({
      label: t(`pm.action.${metric}`),
      reason: missingActionMetricTitle(metric, post.unavailable_metrics, post.media_type),
    }),
  );
  const reasons = [...new Set(missing.map((m) => m.reason))];
  const missingNote =
    reasons.length === 1
      ? `${reasons[0]}.`
      : missing.map((m) => `${m.label}: ${m.reason}.`).join(' ');
  const missingInteractions = (
    [
      ['likes', post.likes, t('pm.likes')],
      ['comments', post.comments, t('pm.comments')],
      ['shares', post.shares, t('pm.sharesFull')],
      ['saved', post.saved, t('pm.savesFull')],
    ] as const
  )
    .filter(([token, value]) => countMissing(post, token, value))
    .map(([, , label]) => label);

  return (
    <>
      <Section title={t('pm.actionsAfter')}>
        {ACTION_ROWS.map((metric) => (
          <Row key={metric} label={t(`pm.action.${metric}`)}>
            <ActionMetricValue post={post} metric={metric} />
          </Row>
        ))}
        {missing.length > 0 && <p className="post-metrics__hint">{missingNote}</p>}
        {reachPerFollower !== null && (
          <p className="post-metrics__hint">
            {t('pm.followerEvery', { n: fmtCount(reachPerFollower) })}
          </p>
        )}
      </Section>
      <Section title={t('pm.interactions')}>
        <Row label={t('pm.likes')}>
          <CountValue post={post} token="likes" value={post.likes} />
        </Row>
        <Row label={t('pm.comments')}>
          <CountValue post={post} token="comments" value={post.comments} />
        </Row>
        {typeof post.reposts === 'number' && (
          <Row label={t('pm.reposts')}>
            <strong>{fmtCount(post.reposts)}</strong>
          </Row>
        )}
        <Row label={t('pm.sharesFull')}>
          <CountValue post={post} token="shares" value={post.shares} />
        </Row>
        <Row label={t('pm.savesFull')}>
          <CountValue post={post} token="saved" value={post.saved} />
        </Row>
        {missingInteractions.length > 0 && (
          <p className="post-metrics__hint">{missingCountsNote(missingInteractions)}</p>
        )}
      </Section>
      {dists && <RateBlock post={post} dists={dists} />}
      <p className="post-metrics__note">{t('pm.carouselNote')}</p>
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
  const { t: tp } = useTranslation('analyticsAccount');
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
        <span>{tp('pm.footer')}</span>
        {synced && <span>{synced}</span>}
      </div>
    </div>
  );
}
