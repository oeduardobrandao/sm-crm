import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
import { useAuth } from '../../context/AuthContext';
import { getWorkspaceSubscription } from '../../services/billing';

/**
 * Derived state, deliberately not a global_banners row.
 *
 * global_banners targets a workspace rather than a role (every agent would read the owner's
 * billing failure), is dismissible, and would need create-on-fail / archive-on-recovery lifecycle
 * that can drift from Stripe. Rendering straight from workspace_subscriptions cannot drift: the
 * banner exists exactly while Stripe says the payment is failing.
 */
export function DunningBanner() {
  const { t } = useTranslation('billing');
  const intlLocale = useIntlLocale();
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const { data } = useQuery({
    queryKey: ['workspace-subscription-dunning'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner,
    staleTime: 5 * 60_000,
  });

  if (!isOwner || data?.status !== 'past_due') return null;

  const retryLabel = data.next_payment_attempt
    ? new Date(data.next_payment_attempt).toLocaleDateString(intlLocale, {
        day: '2-digit',
        month: 'long',
      })
    : null;

  return (
    <div
      role="alert"
      className="banner-bar"
      style={{
        background: 'rgba(245, 90, 66, 0.1)',
        borderBottom: '1px solid var(--danger)',
        color: 'var(--text-main)',
      }}
    >
      <div className="banner-content">
        <strong>{t('dunningBanner.title')}</strong>{' '}
        {retryLabel ? t('dunningBanner.retryOn', { date: retryLabel }) : t('dunningBanner.noRetry')}
      </div>
      <Link
        to="/configuracao/cobranca"
        style={{
          flexShrink: 0,
          background: 'var(--danger)',
          color: '#fff',
          textDecoration: 'none',
          padding: '0.4rem 0.9rem',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: '0.8rem',
        }}
      >
        {t('dunningBanner.cta')}
      </Link>
    </div>
  );
}
