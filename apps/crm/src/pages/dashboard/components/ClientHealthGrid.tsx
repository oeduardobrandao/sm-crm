import { useTranslation } from 'react-i18next';
import type { ClientHealth } from '../../../services/clientHealth';
import { filterAndSortClients, type HealthFilterKey, type HealthSort } from '../../../lib/health/filter';
import { ClientHealthCard } from './ClientHealthCard';

interface Props {
  clients: ClientHealth[];
  isLoading: boolean;
  isError: boolean;
  filter: HealthFilterKey;
  search: string;
  sort: HealthSort;
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: 12,
  marginTop: 12,
};

export function ClientHealthGrid({ clients, isLoading, isError, filter, search, sort }: Props) {
  const { t } = useTranslation('dashboard');

  if (isLoading) {
    return (
      <div style={gridStyle}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            data-testid="health-skeleton"
            className="card"
            style={{ height: 150, borderRadius: 16, opacity: 0.5 }}
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center' }}>
        {t('health.error')}
      </p>
    );
  }

  if (clients.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center' }}>
        {t('health.empty.noClients')}
      </p>
    );
  }

  const anyConnected = clients.some((c) => c.connected);
  if (!anyConnected) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center' }}>
        {t('health.empty.noneConnected')}
      </p>
    );
  }

  const visible = filterAndSortClients(clients, { filter, search, sort });
  if (visible.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center' }}>
        {t('health.empty.filtered')}
      </p>
    );
  }

  return (
    <div style={gridStyle}>
      {visible.map((c) => (
        <ClientHealthCard key={c.client_id} client={c} />
      ))}
    </div>
  );
}
