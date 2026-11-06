import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { GbpRatingDistribution } from '../../../services/gbpAnalytics';
import { GbpCard, QueryBody, Stars, type GbpQuery } from './GbpCard';
import { formatRating, pctOf } from './gbpTabFormat';

const STARS = ['5', '4', '3', '2', '1'] as const;

/**
 * "Avaliações": the average, Google's review count and the star distribution. The distribution
 * comes from the stored reviews (the latest 200 per unit), so it says so when that is partial.
 */
export function GbpRatingCard({
  query,
  avgRating,
  newReviews,
  scope,
  phone,
}: {
  query: GbpQuery<GbpRatingDistribution>;
  /** The overview's `avg_rating` (review-count weighted across the selected units). */
  avgRating: number | null;
  /** The overview's `new_reviews` for the period. */
  newReviews: number | null;
  /** "Todas as unidades" or the selected unit's title. */
  scope: string;
  phone?: boolean;
}) {
  const { t } = useTranslation('analyticsGoogle');
  return (
    <GbpCard phone={phone} title={t('rating.title')} sub={scope}>
      <QueryBody query={query}>
        {(dist) => (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '2.25rem', fontWeight: 700, lineHeight: 1 }}>
                {avgRating === null ? t('states.noData') : formatRating(avgRating)}
              </span>
              <div style={{ display: 'grid', gap: 2 }}>
                {avgRating !== null && <Stars rating={avgRating} />}
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {t('rating.count', {
                    count: dist.total,
                    formattedCount: dist.total.toLocaleString('pt-BR'),
                  })}
                </span>
              </div>
            </div>
            {dist.storedTotal === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('rating.empty')}</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                {STARS.map((star) => {
                  const count = dist.counts[star] ?? 0;
                  return (
                    <li
                      key={star}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2.25rem 1fr 3rem',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: '0.8rem',
                      }}
                    >
                      <span>{star} ★</span>
                      <span
                        aria-hidden="true"
                        style={{
                          height: 6,
                          borderRadius: 999,
                          background: 'var(--surface-2)',
                          overflow: 'hidden',
                        }}
                      >
                        <span
                          style={{
                            display: 'block',
                            width: `${pctOf(count, dist.storedTotal)}%`,
                            height: '100%',
                            background: '#d97706',
                          }}
                        />
                      </span>
                      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {count.toLocaleString('pt-BR')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {(newReviews !== null && newReviews > 0) || dist.partial ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {newReviews !== null && newReviews > 0 && (
                  <Badge variant="success" size="sm">
                    {t('rating.newInPeriod', { n: newReviews.toLocaleString('pt-BR') })}
                  </Badge>
                )}
                {dist.partial && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    {t('rating.partial')}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        )}
      </QueryBody>
    </GbpCard>
  );
}
