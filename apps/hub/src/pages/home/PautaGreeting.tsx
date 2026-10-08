import { Trans, useTranslation } from 'react-i18next';
import { formatEyebrowDate, greetingKey } from './pautaHome';

export function PautaGreeting({
  firstName,
  pendingCount,
  weekTotal,
  loading,
  onReview,
}: {
  firstName: string;
  pendingCount: number;
  weekTotal: number;
  loading: boolean;
  onReview: () => void;
}) {
  const { t, i18n } = useTranslation('hubHome');
  const now = new Date();
  const summaryKey =
    pendingCount > 0 && weekTotal > 0
      ? 'both'
      : pendingCount > 0
        ? 'pendingOnly'
        : weekTotal > 0
          ? 'weekOnly'
          : 'none';
  const chip = (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-[var(--hub-r-chip)] font-semibold hub-txt"
      style={{ background: 'var(--hub-acc-soft)' }}
    />
  );
  return (
    <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="hub-eyebrow">{formatEyebrowDate(now, i18n.language)}</div>
        <h1 className="font-display hub-display-title text-[clamp(2rem,5vw,2.75rem)] leading-[1.05] tracking-tight hub-txt mt-3">
          {t(`home.pauta.greeting.${greetingKey(now.getHours())}`, { name: firstName })}
        </h1>
        {loading ? (
          <div
            data-testid="pauta-summary-skeleton"
            className="h-5 w-72 max-w-full mt-3 rounded-[var(--hub-r-chip)] hub-bg-soft animate-pulse"
          />
        ) : (
          <p className="text-[15px] leading-relaxed hub-tx2 mt-3">
            <Trans
              t={t}
              i18nKey={`home.pauta.summary.${summaryKey}`}
              values={{
                posts: t('home.pauta.chip.posts', { count: pendingCount }),
                publications: t('home.pauta.chip.publications', { count: weekTotal }),
              }}
              components={{ chip }}
            />
          </p>
        )}
      </div>
      {!loading && pendingCount > 0 && (
        <button
          type="button"
          onClick={onReview}
          className="hub-btn-primary h-11 px-5 text-[14px] font-semibold shrink-0 self-start sm:self-end"
        >
          {t('home.pauta.cta.review', 'Revisar aprovações')}
        </button>
      )}
    </section>
  );
}
