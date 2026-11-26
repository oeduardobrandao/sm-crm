import { Link } from 'react-router-dom';
import { ArrowRight, Import } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Onboarding nudge shown on the dashboard while the workspace has no clientes yet. */
export function ImportBanner({
  clienteCount,
  clientScoped = false,
}: {
  clienteCount: number;
  /**
   * Member restricted to assigned clients (`isClientScoped`): they see zero clients until
   * one is assigned and never import clients, so the nudge would point at something they
   * cannot do.
   */
  clientScoped?: boolean;
}) {
  const { t } = useTranslation('importWizard');
  if (clienteCount > 0 || clientScoped) return null;
  return (
    <div
      className="card animate-up"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        padding: '1.25rem 1.5rem',
        marginBottom: '1.5rem',
      }}
    >
      <Import className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
      <div style={{ flex: 1 }}>
        <strong>{t('banner.title')}</strong>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('banner.body')}</div>
      </div>
      <Link
        to="/importar"
        className="btn-primary"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
      >
        {t('banner.cta')} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
