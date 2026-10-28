import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Desktop card; the phone lists are covered through the shell (AnalyticsContaPage.phone).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError, warning: vi.fn(), loading: vi.fn() },
}));

vi.mock('../../../../store', () => ({ getClientes: vi.fn() }));
vi.mock('../../../../services/analytics', () => ({
  getClientReports: vi.fn(),
  getReportDownloadUrl: vi.fn(),
  sendReportEmail: vi.fn(),
}));
vi.mock('../../../../services/reportDocs', () => ({
  listReportDocs: vi.fn(),
  deleteReportDoc: vi.fn(),
}));
vi.mock('../NewReportDialog', () => ({
  NewReportDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Novo relatório" /> : null,
}));

import { ClientReportsPanel } from '../ClientReportsPanel';
import { getClientes } from '../../../../store';
import { getClientReports } from '../../../../services/analytics';
import { deleteReportDoc, listReportDocs } from '../../../../services/reportDocs';

const DOC = {
  id: 'doc-1',
  title: 'Relatório de Julho',
  period_start: '2026-07-01',
  status: 'ready',
  created_at: '2026-08-01T00:00:00Z',
};

let client: QueryClient;

function renderPanel() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ClientReportsPanel clientId={42} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClientes).mockResolvedValue([{ id: 42, nome: 'Clinica Aurora' } as never]);
  vi.mocked(getClientReports).mockResolvedValue([]);
  vi.mocked(listReportDocs).mockResolvedValue([]);
});

describe('ClientReportsPanel (moved from the Instagram page)', () => {
  it('shows the empty state', async () => {
    renderPanel();
    expect(
      await screen.findByText(
        'Nenhum relatório gerado ainda. Clique em "Gerar" para criar o primeiro.',
      ),
    ).toBeInTheDocument();
  });

  it('Gerar opens the interactive report dialog', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar' }));
    expect(screen.getByRole('dialog', { name: 'Novo relatório' })).toBeInTheDocument();
  });

  it('mostra o badge "Fora do plano" para relatório com status skipped', async () => {
    vi.mocked(getClientReports).mockResolvedValue([
      { id: 11, report_month: '2026-05', generated_at: null, status: 'skipped' } as never,
    ]);
    renderPanel();
    expect(await screen.findByText('Fora do plano')).toBeInTheDocument();
  });

  it('excluir pede confirmação e, confirmado, chama deleteReportDoc, invalida a lista e mostra toast', async () => {
    vi.mocked(listReportDocs).mockResolvedValue([DOC as never]);
    vi.mocked(deleteReportDoc).mockResolvedValue(undefined as never);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(await screen.findByLabelText('Excluir relatório'));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Excluir este relatório? O PDF exportado também é removido.',
    );
    await waitFor(() => expect(deleteReportDoc).toHaveBeenCalledWith('doc-1'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Relatório excluído.'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['report-docs', 42] });
    confirmSpy.mockRestore();
  });

  it('cancelar no confirm não exclui', async () => {
    vi.mocked(listReportDocs).mockResolvedValue([DOC as never]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel();

    fireEvent.click(await screen.findByLabelText('Excluir relatório'));

    expect(deleteReportDoc).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('erro ao excluir mostra toast e não invalida a lista', async () => {
    vi.mocked(listReportDocs).mockResolvedValue([DOC as never]);
    vi.mocked(deleteReportDoc).mockRejectedValue(new Error('Erro ao excluir relatório (500)'));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(await screen.findByLabelText('Excluir relatório'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Erro ao excluir relatório (500)'));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['report-docs', 42] });
    confirmSpy.mockRestore();
  });

  it('names the client in the e-mail confirmation', async () => {
    vi.mocked(getClientReports).mockResolvedValue([
      {
        id: 10,
        report_month: '2026-04',
        generated_at: '2026-04-17T09:00:00Z',
        status: 'ready',
        storage_path: null,
      } as never,
    ]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Enviar relatório por e-mail')).toBeInTheDocument();
    expect(await screen.findByText('Clinica Aurora')).toBeInTheDocument();
  });
});
