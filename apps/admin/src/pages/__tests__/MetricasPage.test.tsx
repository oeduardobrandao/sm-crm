import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({ getDeposits: vi.fn(() => new Promise(() => {})) }));

import MetricasPage from '../MetricasPage';

describe('MetricasPage', () => {
  it('renders the page header and the Depósitos section anchor', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MetricasPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Métricas' })).toBeInTheDocument();
    expect(document.getElementById('depositos')).not.toBeNull();
  });
});
