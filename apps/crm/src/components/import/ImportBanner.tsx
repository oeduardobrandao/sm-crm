import { Link } from 'react-router-dom';
import { ArrowRight, Import } from 'lucide-react';

/** Onboarding nudge shown on the dashboard while the workspace has no clientes yet. */
export function ImportBanner({ clienteCount }: { clienteCount: number }) {
  if (clienteCount > 0) return null;
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
        <strong>Migrando do Notion, Trello ou ClickUp?</strong>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Importe seus clientes, calendário e entregas em minutos.
        </div>
      </div>
      <Link
        to="/importar"
        className="btn-primary"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
      >
        Importar dados <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
