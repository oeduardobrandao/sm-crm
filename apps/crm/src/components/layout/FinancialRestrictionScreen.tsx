import { Lock } from 'lucide-react';

/**
 * Shown inside AppLayout's <Outlet /> slot, so the sidebar and nav survive.
 * Deliberately not a redirect: a silent bounce to /dashboard leaves the user
 * with no idea why the page they clicked did not open.
 */
export default function FinancialRestrictionScreen() {
  return (
    <div className="page-content">
      <div className="card" style={{ maxWidth: 520, margin: '3rem auto', textAlign: 'center' }}>
        <Lock size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h3 style={{ marginBottom: '0.75rem' }}>Acesso financeiro restrito</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          O proprietário do workspace desativou seu acesso aos dados financeiros. Fale com ele se
          você precisa visualizar esta área.
        </p>
      </div>
    </div>
  );
}
