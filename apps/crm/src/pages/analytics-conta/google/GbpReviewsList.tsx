import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import type { GbpReview, GbpReviewFilter } from '../../../services/gbpAnalytics';
import { sanitizeUrl } from '../../../utils/security';
import { GbpCard, QueryBody, Segments, Stars, type GbpQuery } from './GbpCard';

const FILTERS: { value: GbpReviewFilter; key: string }[] = [
  { value: 'all', key: 'reviews.filterAll' },
  { value: 'unanswered', key: 'reviews.filterUnanswered' },
  { value: 'low', key: 'reviews.filterLow' },
];

/** "Avaliações recentes": read only; each review opens its unit on Google to reply. */
export function GbpReviewsList({
  query,
  filter,
  onFilter,
  phone,
}: {
  query: GbpQuery<GbpReview[]>;
  filter: GbpReviewFilter;
  onFilter: (filter: GbpReviewFilter) => void;
  phone?: boolean;
}) {
  const { t } = useTranslation('analyticsGoogle');
  return (
    <GbpCard
      phone={phone}
      title={t('reviews.title')}
      sub={t('reviews.sub')}
      trailing={
        <Segments
          phone={phone}
          ariaLabel={t('reviews.filterAria')}
          value={filter}
          onChange={onFilter}
          options={FILTERS.map((f) => ({ value: f.value, label: t(f.key) }))}
        />
      }
    >
      <QueryBody query={query}>
        {(reviews) =>
          reviews.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('reviews.empty')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {reviews.map((r, i) => (
                <ReviewItem key={`${r.createTime}-${i}`} review={r} first={i === 0} />
              ))}
            </ul>
          )
        }
      </QueryBody>
    </GbpCard>
  );
}

function ReviewItem({ review, first }: { review: GbpReview; first: boolean }) {
  const { t, i18n } = useTranslation('analyticsGoogle');
  const name = review.reviewer?.trim() || t('reviews.anonymous');
  // A missing or unparseable createTime drops the date: `new Date(null)` would read "há 56 anos".
  const created = review.createTime ? new Date(review.createTime) : null;
  const when =
    created && !isNaN(created.getTime())
      ? formatDistanceToNow(created, {
          addSuffix: true,
          locale: i18n.language.startsWith('en') ? enUS : ptBR,
        })
      : null;
  const meta = [review.unitTitle, when].filter(Boolean).join(' · ');
  // A URI that sanitizes to '#' (not http/https) opens nothing: no link at all.
  const href = review.unitMapsUri ? sanitizeUrl(review.unitMapsUri) : '#';
  return (
    <li
      data-review
      style={{
        display: 'grid',
        gridTemplateColumns: '2rem minmax(0, 1fr)',
        gap: '0.75rem',
        padding: '0.9rem 0',
        borderTop: first ? undefined : '1px solid var(--border-color)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface-2)',
          fontSize: '0.75rem',
          fontWeight: 600,
        }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.25rem 0.5rem',
          }}
        >
          <strong>{name}</strong>
          <Stars rating={review.rating} small />
          {meta && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{meta}</span>}
          <span style={{ marginLeft: 'auto' }}>
            {review.hasReply ? (
              <Badge variant="success" size="sm">
                {t('reviews.answered')}
              </Badge>
            ) : (
              <Badge variant="warning" size="sm">
                {t('reviews.unanswered')}
              </Badge>
            )}
          </span>
        </div>
        {review.comment && (
          <p style={{ margin: '0.4rem 0 0', overflowWrap: 'anywhere' }}>{review.comment}</p>
        )}
        {href !== '#' && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-block', marginTop: '0.4rem', fontSize: '0.8rem' }}
          >
            {t('reviews.open')}
          </a>
        )}
      </div>
    </li>
  );
}
