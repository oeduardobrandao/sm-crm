import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  getEmailMetrics: vi.fn(),
  runEmailBackfill: vi.fn(),
}));
vi.mock('react-chartjs-2', () => ({ Bar: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import EmailsPage from '../EmailsPage';
import * as api from '../../lib/api';

const counts = {
  delayed: 0,
  pending: 0,
  not_sent: 0,
  complained: 0,
};

const FIXTURE: api.EmailMetricsResponse = {
  coverage_start: '2026-10-01T03:00:00Z',
  by_type: [
    {
      category: 'notificacoes',
      type: 'notification_digest',
      sent: 90,
      delivered: 80,
      bounced: 8,
      ...counts,
      complained: 1,
    },
    { category: 'ciclo_de_vida', type: 'welcome', sent: 10, delivered: 10, bounced: 0, ...counts },
    { category: 'interno', type: 'alerta_interno', sent: 5, delivered: 5, bounced: 0, ...counts },
  ],
  daily: [{ day: '2026-11-01', sent: 100, delivered: 90, bounced: 8, other: 2 }],
  recent: [],
};

const EMPTY: api.EmailMetricsResponse = {
  coverage_start: null,
  by_type: [],
  daily: [],
  recent: [],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EmailsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.getEmailMetrics).mockResolvedValue(FIXTURE);
});

describe('EmailsPage', () => {
  it('renders the header and KPIs without the Interno total, with alert marks', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'E-mails' })).toBeInTheDocument();
    expect(await screen.findByTestId('email-kpi-sent')).toHaveTextContent('100');
    // 8 / 100 = 8% bounce, above the 4% alert
    expect(screen.getByTestId('email-kpi-bounce')).toHaveTextContent('8,0%');
    expect(screen.getByTestId('email-kpi-bounce-card')).toHaveAttribute('data-alert', 'true');
    expect(screen.getByText('Interno (fora do total)')).toBeInTheDocument();
    expect(
      screen.getByText(/Os convites de equipe e de acesso demo estão incluídos\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/Dados desde 01\/10\/2026/)).toBeInTheDocument();
  });

  it('expands a category to show its types', async () => {
    renderPage();
    const row = await screen.findByRole('button', { name: /Notificações/ });
    expect(screen.queryByText('Resumo de notificações')).toBeNull();
    fireEvent.click(row);
    expect(screen.getByText('Resumo de notificações')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    vi.mocked(api.getEmailMetrics).mockResolvedValue(EMPTY);
    renderPage();
    expect(await screen.findByText('Nenhum e-mail no período')).toBeInTheDocument();
  });

  it('shows the error state', async () => {
    vi.mocked(api.getEmailMetrics).mockRejectedValue(new Error('x'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar');
  });

  it('refetches with a 30 day range when picked, 90 days after switching', async () => {
    renderPage();
    await screen.findByTestId('email-kpi-sent');
    fireEvent.click(screen.getByRole('radio', { name: '90 dias' }));
    await waitFor(() => expect(api.getEmailMetrics).toHaveBeenCalledTimes(2));
    const [s, e] = vi.mocked(api.getEmailMetrics).mock.calls[1];
    expect((Date.parse(e) - Date.parse(s)) / 86_400_000).toBe(89);
    const [s0, e0] = vi.mocked(api.getEmailMetrics).mock.calls[0];
    expect((Date.parse(e0) - Date.parse(s0)) / 86_400_000).toBe(29);
  });

  it('custom range: invalid shows a message and does not fetch', async () => {
    renderPage();
    await screen.findByTestId('email-kpi-sent');
    vi.mocked(api.getEmailMetrics).mockClear();
    fireEvent.click(screen.getByRole('radio', { name: 'Personalizado' }));
    expect(screen.getByText('Informe as duas datas.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-10-10' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-10-01' } });
    expect(screen.getByText('A data inicial não pode ser depois da final.')).toBeInTheDocument();
    expect(api.getEmailMetrics).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-10-20' } });
    await waitFor(() =>
      expect(api.getEmailMetrics).toHaveBeenCalledWith('2026-10-10', '2026-10-20'),
    );
  });

  it('backfill confirms, loops until done and reports the result', async () => {
    vi.mocked(api.runEmailBackfill)
      .mockResolvedValueOnce({
        inserted: 10,
        scanned: 10,
        nextCursor: 'c1',
        oldestReached: '2026-09-15T12:00:00Z',
        done: false,
      })
      .mockResolvedValueOnce({
        inserted: 5,
        scanned: 5,
        nextCursor: null,
        oldestReached: '2026-09-02T12:00:00Z',
        done: true,
      });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('email-kpi-sent');
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: /Importar histórico do Resend/ }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Linhas já recebidas pelo webhook não mudam\./),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Importar' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Importados 15 e-mails, desde 02/09/2026',
      ),
    );
    expect(api.runEmailBackfill).toHaveBeenNthCalledWith(1, null);
    expect(api.runEmailBackfill).toHaveBeenNthCalledWith(2, 'c1');
  });

  it('backfill failure mid-loop refetches and reports how many were imported', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.runEmailBackfill)
      .mockResolvedValueOnce({
        inserted: 7,
        scanned: 7,
        nextCursor: 'c1',
        oldestReached: null,
        done: false,
      })
      .mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('email-kpi-sent');
    vi.mocked(api.getEmailMetrics).mockClear();
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: /Importar histórico/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Importar' }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Importados 7 e-mails')),
    );
    expect(api.getEmailMetrics).toHaveBeenCalled();
  });
});
