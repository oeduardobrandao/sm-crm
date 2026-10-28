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
vi.mock('../../../../services/instagram', () => ({ getInstagramSummary: vi.fn() }));
vi.mock('../../../../services/tiktok', () => ({ getTikTokSummary: vi.fn() }));
const { featuresRef } = vi.hoisted(() => ({
  featuresRef: { current: { feature_tiktok: true } as Record<string, boolean> },
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: featuresRef.current, isLoading: false }),
}));
vi.mock('../NewReportDialog', () => ({
  NewReportDialog: ({ open, connected }: { open: boolean; connected?: string[] }) =>
    open ? (
      <div
        role="dialog"
        aria-label="Novo relatório"
        data-connected={connected ? connected.join(',') : 'unknown'}
      />
    ) : null,
}));

import { ClientReportsPanel } from '../ClientReportsPanel';
import { getClientes } from '../../../../store';
import { getClientReports } from '../../../../services/analytics';
import { getInstagramSummary } from '../../../../services/instagram';
import { getTikTokSummary } from '../../../../services/tiktok';
import { deleteReportDoc, listReportDocs } from '../../../../services/reportDocs';

const DOC = {
  id: 'doc-1',
  title: 'Relatório de Julho',
  period_start: '2026-07-01',
  status: 'ready',
  created_at: '2026-08-01T00:00:00Z',
  platforms: ['instagram'],
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
  featuresRef.current = { feature_tiktok: true };
  vi.mocked(getInstagramSummary).mockResolvedValue({ account: { id: 'ig' } });
  vi.mocked(getTikTokSummary).mockResolvedValue({
    account: { authorization_status: 'active' },
  } as never);
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

  it('mostra um badge por plataforma do documento', async () => {
    vi.mocked(listReportDocs).mockResolvedValue([
      { ...DOC, platforms: ['instagram', 'tiktok'] } as never,
      { ...DOC, id: 'doc-2', title: 'Só TikTok', platforms: ['tiktok'] } as never,
      { ...DOC, id: 'doc-3', title: 'Neutro', platforms: [] } as never,
    ]);
    renderPanel();
    await screen.findByText('Relatório de Julho');
    const row = (title: string) =>
      screen.getByText(title).closest('[data-testid="report-doc-row"]');
    const within1 = row('Relatório de Julho') as HTMLElement;
    expect(within1.textContent).toContain('Instagram');
    expect(within1.textContent).toContain('TikTok');
    const within2 = row('Só TikTok') as HTMLElement;
    expect(within2.textContent).toContain('TikTok');
    expect(within2.textContent).not.toContain('Instagram');
    const within3 = row('Neutro') as HTMLElement;
    expect(within3.textContent).not.toContain('TikTok');
    expect(within3.textContent).not.toContain('Instagram');
  });

  it('passa ao dialog as plataformas conectadas (Instagram e TikTok com o plano)', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Novo relatório' })).toHaveAttribute(
        'data-connected',
        'instagram,tiktok',
      ),
    );
  });

  it('sem feature_tiktok, o TikTok não conta como conectado e nem é consultado', async () => {
    featuresRef.current = { feature_tiktok: false };
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Novo relatório' })).toHaveAttribute(
        'data-connected',
        'instagram',
      ),
    );
    expect(getTikTokSummary).not.toHaveBeenCalled();
  });

  it('sem Instagram conectado, só o TikTok', async () => {
    vi.mocked(getInstagramSummary).mockResolvedValue(null);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Novo relatório' })).toHaveAttribute(
        'data-connected',
        'tiktok',
      ),
    );
  });

  it.each(['revoked', 'disconnected'])('TikTok %s não conta como conectado', async (status) => {
    vi.mocked(getTikTokSummary).mockResolvedValue({
      account: { authorization_status: status },
    } as never);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Novo relatório' })).toHaveAttribute(
        'data-connected',
        'instagram',
      ),
    );
  });

  it('token do Instagram expirado ainda conta como conectado', async () => {
    vi.mocked(getInstagramSummary).mockRejectedValue(new Error('TOKEN_EXPIRED'));
    vi.mocked(getTikTokSummary).mockRejectedValue(new Error('404'));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Novo relatório' })).toHaveAttribute(
        'data-connected',
        'instagram',
      ),
    );
  });

  it('resumo do TikTok com erro: o dialog recebe só o Instagram como conectado (o dialog então não envia platforms)', async () => {
    vi.mocked(getTikTokSummary).mockRejectedValue(new Error('boom'));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Novo relatório' })).toHaveAttribute(
        'data-connected',
        'instagram',
      ),
    );
  });

  it('redes ainda carregando: o dialog recebe connected desconhecido', async () => {
    vi.mocked(getInstagramSummary).mockReturnValue(new Promise(() => {}));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar' }));
    expect(screen.getByRole('dialog', { name: 'Novo relatório' })).toHaveAttribute(
      'data-connected',
      'unknown',
    );
  });
});
