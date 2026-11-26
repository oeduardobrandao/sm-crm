import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type RestrictionVariant = 'financeiro' | 'contratos';

/**
 * Shown inside AppLayout's <Outlet /> slot, so the sidebar and nav survive.
 * Deliberately not a redirect: a silent bounce to /dashboard leaves the user
 * with no idea why the page they clicked did not open.
 *
 * The `contratos` variant exists because /contratos stopped being guarded by
 * the FINANCEIRO capability (see CONTRACT_PATHS in AppLayout) -- a member who
 * has financeiro but not contratos would otherwise be told the wrong thing
 * about why the page is closed.
 */
export default function FinancialRestrictionScreen({
  variant = 'financeiro',
}: {
  variant?: RestrictionVariant;
}) {
  const { t } = useTranslation('shell');
  const title = t(`restriction.${variant}.title`);
  const body = t(`restriction.${variant}.body`);
  return (
    <div className="page-content">
      <div className="card" style={{ maxWidth: 520, margin: '3rem auto', textAlign: 'center' }}>
        <Lock size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h3 style={{ marginBottom: '0.75rem' }}>{title}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{body}</p>
      </div>
    </div>
  );
}
