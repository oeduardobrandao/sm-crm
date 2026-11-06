// Sections of `/analytics/google` shared by the desktop page and the phone layout: the
// reviews that need attention, the units that need attention and the highlight cards' data.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow, formatDistanceToNowStrict } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import {
  MessageSquarePlus,
  MousePointerClick,
  Star,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import type { StatTone } from '@/components/StatCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import type {
  GbpAttentionReview,
  GbpPortfolioDays,
  GbpPortfolioUnit,
} from '../../services/gbpAnalytics';
import { sanitizeUrl } from '../../utils/security';
import { Stars } from '../analytics-conta/google/GbpCard';
import { formatGbpCount, formatRating } from '../analytics-conta/google/gbpTabFormat';
import {
  daysSince,
  highlightsFor,
  type GbpHighlightKind,
  type GbpUnitSortCol,
} from './gbpOverviewModel';

export const GBP_PORTFOLIO_PERIODS: readonly GbpPortfolioDays[] = [7, 30, 90];

export const UNIT_SORT_KEY: Record<GbpUnitSortCol, string> = {
  title: 'overview.colUnit',
  profileViews: 'overview.colViews',
  calls: 'overview.colCalls',
  directions: 'overview.colDirections',
  websiteClicks: 'overview.colWebsite',
  messages: 'overview.colMessages',
  avgRating: 'overview.colRating',
  newReviews: 'overview.colNewReviews',
  lastSyncedAt: 'overview.colUpdated',
};

export interface ClientOption {
  id: number;
  name: string;
}

/** The reviews list shows this many before "Ver todas". */
export const REVIEWS_SHOWN = 10;

export const reconnectHref = (clientId: number) =>
  `/clientes/${clientId}/redes-sociais?rede=google`;
export const unitHref = (clientId: number) => `/analytics/${clientId}/google`;

/** A `maps_uri` safe to open, or null: only http(s) survives `sanitizeUrl`. */
export function safeMapsHref(uri: string | null): string | null {
  if (!uri) return null;
  const href = sanitizeUrl(uri);
  return /^https?:\/\//i.test(href) ? href : null;
}

export const dateLocale = (language: string) => (language.startsWith('en') ? enUS : ptBR);

export type GbpTFn = TFunction<'analyticsGoogle'>;

export interface GbpHighlightCard {
  key: GbpHighlightKind;
  label: string;
  icon: LucideIcon;
  tone: StatTone;
  /** The unit's title. */
  name: string;
  clientName: string;
  sub: string;
  /** The number alone, for compact rows. */
  short: string;
}

const HIGHLIGHT_STYLE: Record<GbpHighlightKind, { icon: LucideIcon; tone: StatTone }> = {
  actions: { icon: MousePointerClick, tone: 'blue' },
  growth: { icon: TrendingUp, tone: 'green' },
  rating: { icon: Star, tone: 'amber' },
  newReviews: { icon: MessageSquarePlus, tone: 'pink' },
};

export const formatGrowth = (ratio: number) => `+${Math.round(ratio * 100)}%`;

export function highlightCards(t: GbpTFn, units: GbpPortfolioUnit[]): GbpHighlightCard[] {
  return highlightsFor(units).map(({ kind, unit, value }) => {
    const base = {
      key: kind,
      ...HIGHLIGHT_STYLE[kind],
      name: unit.title || t('filters.untitledUnit'),
      clientName: unit.clientName,
    };
    switch (kind) {
      case 'actions':
        return {
          ...base,
          label: t('overview.highlightActions'),
          sub: t('overview.highlightActionsSub', {
            count: value,
            formatted: formatGbpCount(value),
          }),
          short: formatGbpCount(value),
        };
      case 'growth':
        return {
          ...base,
          label: t('overview.highlightGrowth'),
          sub: t('overview.highlightGrowthSub', { value: formatGrowth(value) }),
          short: formatGrowth(value),
        };
      case 'rating':
        return {
          ...base,
          label: t('overview.highlightRating'),
          sub: t('overview.highlightRatingSub', {
            rating: formatRating(value),
            reviews: formatGbpCount(unit.reviewCount ?? 0),
          }),
          short: `★ ${formatRating(value)}`,
        };
      default:
        return {
          ...base,
          label: t('overview.highlightNewReviews'),
          sub: t('overview.highlightNewReviewsSub', { count: value }),
          short: `+${value}`,
        };
    }
  });
}

/** Signed whole percent of a change, or null when there is nothing to compare with. */
export function viewsChange(u: GbpPortfolioUnit): string | null {
  if (u.prevProfileViews === null || u.prevProfileViews <= 0) return null;
  const pct = Math.round(((u.profileViews - u.prevProfileViews) / u.prevProfileViews) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

export function updatedAgo(u: GbpPortfolioUnit, t: GbpTFn, language: string): string {
  if (!u.lastSyncedAt) return t('overview.never');
  const d = new Date(u.lastSyncedAt);
  if (isNaN(d.getTime())) return t('overview.never');
  return formatDistanceToNowStrict(d, { addSuffix: true, locale: dateLocale(language) });
}

/** "Avaliações que pedem atenção": 10 at first, "Ver todas" expands in place. */
export function AttentionReviews({
  reviews,
  days,
  phone,
}: {
  reviews: GbpAttentionReview[];
  days: number;
  phone?: boolean;
}) {
  const { t } = useTranslation('analyticsGoogle');
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? reviews : reviews.slice(0, REVIEWS_SHOWN);
  const title = t('overview.reviewsTitle');
  const sub = t('overview.reviewsSub', { count: days });
  const hint = t('overview.reviewsTotal', { count: reviews.length });

  const body =
    reviews.length === 0 ? (
      <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('overview.reviewsEmpty')}</p>
    ) : (
      <>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {shown.map((r, i) => (
            <ReviewItem key={`${r.unitId}-${r.createTime}-${i}`} review={r} first={i === 0} />
          ))}
        </ul>
        {reviews.length > REVIEWS_SHOWN && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            style={{ marginTop: '0.5rem' }}
          >
            {expanded
              ? t('overview.reviewsSeeLess')
              : t('overview.reviewsSeeAll', { count: reviews.length })}
          </Button>
        )}
      </>
    );

  if (phone) {
    return (
      <section className="phone-an-card" aria-label={title}>
        <div className="phone-an-card__top">
          <h2 className="phone-group__header">{title}</h2>
        </div>
        <p className="phone-an-footnote">
          {sub} {reviews.length > 0 && hint}
        </p>
        {body}
      </section>
    );
  }
  return (
    <section className="card animate-up" aria-label={title} style={{ minWidth: 0 }}>
      <div className="dashboard-hub-card-header">
        <div style={{ minWidth: 0 }}>
          <h3>{title}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
            {sub} {reviews.length > 0 && hint}
          </p>
        </div>
      </div>
      <div style={{ marginTop: '0.75rem' }}>{body}</div>
    </section>
  );
}

function ReviewItem({ review, first }: { review: GbpAttentionReview; first: boolean }) {
  const { t, i18n } = useTranslation('analyticsGoogle');
  const name = review.reviewerName?.trim() || t('reviews.anonymous');
  // A missing or unparseable createTime drops the date: `new Date(null)` would read "há 56 anos".
  const created = review.createTime ? new Date(review.createTime) : null;
  const when =
    created && !isNaN(created.getTime())
      ? formatDistanceToNow(created, { addSuffix: true, locale: dateLocale(i18n.language) })
      : null;
  const meta = [review.unitTitle || t('filters.untitledUnit'), when].filter(Boolean).join(' · ');
  const href = safeMapsHref(review.mapsUri);
  return (
    <li
      data-attention-review
      style={{
        padding: '0.75rem 0',
        borderTop: first ? undefined : '1px solid var(--border-color)',
        minWidth: 0,
      }}
    >
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.25rem 0.5rem' }}
      >
        <Stars rating={review.starRating} small />
        <strong>{name}</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{meta}</span>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: 'auto', fontSize: '0.8rem' }}
          >
            {t('overview.reviewsOpen')}
          </a>
        )}
      </div>
      {review.comment && (
        <p
          style={{
            margin: '0.35rem 0 0',
            overflowWrap: 'anywhere',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {review.comment}
        </p>
      )}
    </li>
  );
}

/** "Unidades que precisam de atenção": revoked first, then stale. Hidden when empty. */
export function AttentionUnits({ units, phone }: { units: GbpPortfolioUnit[]; phone?: boolean }) {
  const { t } = useTranslation('analyticsGoogle');
  if (units.length === 0) return null;
  const title = t('overview.attentionTitle');
  const name = (u: GbpPortfolioUnit) => u.title || t('filters.untitledUnit');
  const staleLine = (u: GbpPortfolioUnit) =>
    t('overview.attentionLastSync', { count: daysSince(u.lastSyncedAt) ?? 0 });

  if (phone) {
    return (
      <section aria-label={title}>
        <GroupedList header={title}>
          {units.map((u) =>
            u.status === 'revoked' ? (
              <Cell
                key={u.id}
                to={reconnectHref(u.clientId)}
                label={name(u)}
                subtitle={`${u.clientName} · ${t('overview.attentionRevoked')}`}
                value={
                  <span className="phone-an-badge phone-an-badge--warn">
                    {t('overview.attentionReconnect')}
                  </span>
                }
              />
            ) : (
              <Cell
                key={u.id}
                to={unitHref(u.clientId)}
                label={name(u)}
                subtitle={`${u.clientName} · ${staleLine(u)}`}
                value={
                  <span className="phone-an-badge phone-an-badge--warn">
                    {t('overview.attentionStale')}
                  </span>
                }
              />
            ),
          )}
        </GroupedList>
      </section>
    );
  }

  return (
    <section className="card animate-up" aria-label={title} style={{ minWidth: 0 }}>
      <div className="dashboard-hub-card-header">
        <h3>{title}</h3>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0' }}>
        {units.map((u, i) => (
          <li
            key={u.id}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.25rem 0.75rem',
              padding: '0.6rem 0',
              borderTop: i === 0 ? undefined : '1px solid var(--border-color)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <strong>{name(u)}</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: 6 }}>
                {u.clientName}
              </span>
            </div>
            {u.status === 'revoked' ? (
              <>
                <Badge variant="warning" size="sm">
                  {t('overview.attentionRevoked')}
                </Badge>
                <Button asChild size="sm" variant="outline" style={{ marginLeft: 'auto' }}>
                  <Link to={reconnectHref(u.clientId)}>{t('overview.attentionReconnect')}</Link>
                </Button>
              </>
            ) : (
              <>
                <Badge variant="warning" size="sm">
                  {t('overview.attentionStale')}
                </Badge>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {staleLine(u)}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
