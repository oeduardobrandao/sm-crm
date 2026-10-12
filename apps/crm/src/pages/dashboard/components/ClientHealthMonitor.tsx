import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useVidroShell } from '@/components/layout/PageToolbarContext';
import { getClientHealthMonitor } from '../../../services/clientHealth';
import { HealthFilterBar } from './HealthFilterBar';
import { ClientHealthGrid } from './ClientHealthGrid';
import type { HealthFilterKey, HealthSort } from '../../../lib/health/filter';

const EMPTY_SUMMARY = {
  total: 0,
  atencao: 0,
  saudaveis: 0,
  estaveis: 0,
  conexao: 0,
  precisamAtencao: 0,
};

export function ClientHealthMonitor() {
  const { t } = useTranslation('dashboard');
  // Under the Vidro toolbar the page h1 is "Início"; this section then titles itself with an h2.
  const Heading = useVidroShell() ? 'h2' : 'h1';
  const [filter, setFilter] = useState<HealthFilterKey>('todos');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<HealthSort>('atencao');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['clientHealth'],
    queryFn: () => getClientHealthMonitor(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const clients = data?.clients ?? [];
  const summary = data?.summary ?? EMPTY_SUMMARY;

  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <Heading>{t('health.title')}</Heading>
          <p>
            {t('health.subtitle', {
              count: summary.total,
              total: summary.total,
              attention: summary.precisamAtencao,
            })}
          </p>
        </div>
      </header>
      <HealthFilterBar
        summary={summary}
        filter={filter}
        onFilter={setFilter}
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={setSort}
      />
      <ClientHealthGrid
        clients={clients}
        isLoading={isLoading}
        isError={isError}
        filter={filter}
        search={search}
        sort={sort}
      />
    </section>
  );
}
