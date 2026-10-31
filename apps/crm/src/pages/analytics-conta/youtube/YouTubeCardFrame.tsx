import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { dimmed, formatThrough } from './youtubeTabFormat';

/** Where a card's read stands: loading, failed (with a retry) or ready. */
export interface CardLoadState {
  loading?: boolean;
  /** Set when the read failed: the card says so and offers a retry. */
  onRetry?: (() => void) | null;
  /** The previous period's numbers are on screen while the next loads. */
  stale?: boolean;
}

/**
 * One section of the YouTube tab: a desktop `.card` or a phone `.phone-an-card`, with its
 * subtitle, its own "Dados até" when its watermark lags the channel's, and the loading and
 * error bodies every card shares.
 */
export function YouTubeCardFrame({
  phone,
  title,
  sub,
  lagThrough,
  legend,
  state,
  style,
  children,
}: {
  phone?: boolean;
  title: string;
  sub?: ReactNode;
  /** The card's own watermark, set only when it lags `dataThrough`. */
  lagThrough?: string | null;
  legend?: ReactNode;
  state?: CardLoadState;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation('analyticsYoutube');
  const lag = lagThrough ? (
    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0.25rem 0 0' }}>
      {t('lag', { date: formatThrough(lagThrough, i18n.language) })}
    </p>
  ) : null;

  const body = state?.loading ? (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem 0' }}>
      <Spinner />
    </div>
  ) : state?.onRetry ? (
    <RetryLine phone={phone} onRetry={state.onRetry} />
  ) : (
    <div style={dimmed(!!state?.stale)} aria-busy={state?.stale || undefined}>
      {children}
    </div>
  );

  if (phone) {
    return (
      <section className="phone-an-card" aria-label={title} style={style}>
        <div className="phone-an-card__top">
          <h2 className="phone-group__header">{title}</h2>
        </div>
        {sub && (
          <p className="phone-an-tone--muted" style={{ fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
            {sub}
          </p>
        )}
        {lag}
        {legend}
        {body}
      </section>
    );
  }

  return (
    <div className="card animate-up" style={style}>
      <div className="dashboard-hub-card-header">
        <h3>{title}</h3>
        {legend}
      </div>
      {sub && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
          {sub}
        </p>
      )}
      {lag}
      <div style={{ marginTop: '1rem' }}>{body}</div>
    </div>
  );
}

/** Inline "couldn't load" with a retry, inside a section. */
export function RetryLine({ phone, onRetry }: { phone?: boolean; onRetry: () => void }) {
  const { t } = useTranslation('analyticsYoutube');
  if (phone) {
    return (
      <div className="phone-an-empty">
        <p>{t('states.error')}</p>
        <button type="button" className="phone-an-link-button" onClick={onRetry}>
          {t('states.retry')}
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('states.error')}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t('states.retry')}
      </Button>
    </div>
  );
}

/** A muted one-liner for an empty section. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p style={{ color: 'var(--text-muted)', margin: 0 }}>{children}</p>;
}

/** Turns a query into the card's load state: pending, failed without data, or stale. */
export function cardState(q: {
  isPending: boolean;
  isError: boolean;
  data: unknown;
  isPlaceholderData: boolean;
  refetch: () => unknown;
}): CardLoadState {
  return {
    loading: q.isPending,
    onRetry: q.isError && !q.data ? () => void q.refetch() : null,
    stale: q.isPlaceholderData,
  };
}
