import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  getDeposits: vi.fn(() => new Promise(() => {})),
  getMetricsHistory: vi.fn(() => new Promise(() => {})),
  backfillMetrics: vi.fn(),
}));
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import MetricasPage from '../MetricasPage';

// The global test setup runs vi.restoreAllMocks() after each test, which wipes the
// factory-time implementations above, so re-arm them here.
beforeEach(async () => {
  const api = await import('../../lib/api');
  vi.mocked(api.getDeposits).mockReturnValue(new Promise(() => {}) as never);
  vi.mocked(api.getMetricsHistory).mockReturnValue(new Promise(() => {}) as never);
});

describe('MetricasPage', () => {
  it('renders the page header and the section anchors', () => {
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
    expect(document.getElementById('mrr')).not.toBeNull();
    expect(document.getElementById('churn')).not.toBeNull();
  });

  it('asks for confirmation before running the backfill and maps 403 to a production-only toast', async () => {
    const { backfillMetrics } = await import('../../lib/api');
    const { toast } = await import('sonner');
    vi.mocked(backfillMetrics).mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    );
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MetricasPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const button = screen.getByRole('button', { name: /reconstruir histórico/i });
    fireEvent.click(button);
    expect(backfillMetrics).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Disponível só em produção'));
    confirmSpy.mockRestore();
  });
});
