import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({
  listReportTemplates: vi.fn(),
  createReportTemplate: vi.fn(),
  updateReportTemplate: vi.fn(),
  deleteReportTemplate: vi.fn(),
  setDefaultReportTemplate: vi.fn(),
  buildSystemDefaultLayout: vi.fn(() => ({ version: 1, blocks: [] })),
  SYSTEM_TEMPLATE_NAME: 'Padrão do sistema',
}));
vi.mock('../../../../services/reportTemplates', () => svc);

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigateMock,
}));

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

// DropdownMenu mockado no padrão da casa (RelatorioEditorPage.test.tsx): o
// Radix real não abre com fireEvent no jsdom.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}));

import { ReportTemplatesCard } from '../ReportTemplatesCard';

const rows = [
  {
    id: 't1',
    name: 'Mensal completo',
    layout: { version: 1, blocks: [{ id: 'a', type: 'cover', size: 'full' }] },
    is_default: true,
    created_at: '2026-09-01',
  },
  {
    id: 't2',
    name: 'Resumo rápido',
    layout: { version: 1, blocks: [] },
    is_default: false,
    created_at: '2026-08-01',
  },
];

let qc: QueryClient;
function renderCard() {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReportTemplatesCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(svc))
    if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
  svc.buildSystemDefaultLayout.mockReturnValue({ version: 1, blocks: [] });
  svc.listReportTemplates.mockResolvedValue(rows);
  svc.createReportTemplate.mockResolvedValue({ ...rows[1], id: 'new-1' });
  svc.updateReportTemplate.mockResolvedValue(undefined);
  svc.deleteReportTemplate.mockResolvedValue(undefined);
  svc.setDefaultReportTemplate.mockResolvedValue(undefined);
  navigateMock.mockReset();
});

function rowOf(name: string) {
  return screen.getByText(name).closest('[data-template-row]') as HTMLElement;
}

describe('ReportTemplatesCard', () => {
  it('lista o padrão do sistema primeiro, depois os modelos com badge e contagem', async () => {
    renderCard();
    await screen.findByText('Mensal completo');
    const names = Array.from(document.querySelectorAll('[data-template-row]')).map((r) =>
      r.getAttribute('data-template-row'),
    );
    expect(names).toEqual(['system', 't1', 't2']);
    expect(within(rowOf('Mensal completo')).getByText('padrão')).toBeInTheDocument();
    expect(within(rowOf('Mensal completo')).getByText('1 bloco')).toBeInTheDocument();
    expect(within(rowOf('Resumo rápido')).getByText('0 blocos')).toBeInTheDocument();
  });

  it('Novo modelo cria com o layout do sistema e abre o editor', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Novo modelo/ }));
    await waitFor(() =>
      expect(svc.createReportTemplate).toHaveBeenCalledWith('Novo modelo', {
        version: 1,
        blocks: [],
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/relatorios/modelos/new-1');
  });

  it('Duplicar o padrão do sistema cria "Padrão do sistema (cópia)"', async () => {
    renderCard();
    await screen.findByText('Mensal completo');
    fireEvent.click(within(rowOf('Padrão do sistema')).getByRole('button', { name: /Duplicar/ }));
    await waitFor(() =>
      expect(svc.createReportTemplate).toHaveBeenCalledWith(
        'Padrão do sistema (cópia)',
        expect.anything(),
      ),
    );
  });

  it('Duplicar um modelo cria "Cópia de {nome}" com o layout dele', async () => {
    renderCard();
    await screen.findByText('Resumo rápido');
    fireEvent.click(within(rowOf('Resumo rápido')).getByRole('button', { name: /Duplicar/ }));
    await waitFor(() =>
      expect(svc.createReportTemplate).toHaveBeenCalledWith(
        'Cópia de Resumo rápido',
        rows[1].layout,
      ),
    );
  });

  it('Editar navega para o editor do modelo', async () => {
    renderCard();
    await screen.findByText('Resumo rápido');
    fireEvent.click(within(rowOf('Resumo rápido')).getByRole('button', { name: /Editar/ }));
    expect(navigateMock).toHaveBeenCalledWith('/relatorios/modelos/t2');
  });

  it('Definir como padrão chama a RPC e só aparece em modelos não padrão', async () => {
    renderCard();
    await screen.findByText('Resumo rápido');
    expect(
      within(rowOf('Mensal completo')).queryByRole('button', { name: /Definir como padrão/ }),
    ).toBeNull();
    fireEvent.click(
      within(rowOf('Resumo rápido')).getByRole('button', { name: /Definir como padrão/ }),
    );
    await waitFor(() => expect(svc.setDefaultReportTemplate).toHaveBeenCalledWith('t2'));
  });

  it('Renomear grava o novo nome e invalida o detalhe do modelo', async () => {
    renderCard();
    await screen.findByText('Resumo rápido');
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(within(rowOf('Resumo rápido')).getByRole('button', { name: /Renomear/ }));
    const input = await screen.findByLabelText('Nome do modelo');
    fireEvent.change(input, { target: { value: 'Resumo semanal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(svc.updateReportTemplate).toHaveBeenCalledWith('t2', { name: 'Resumo semanal' }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['report-template', 't2'] });
  });

  it('Excluir pede confirmação, exclui e remove o detalhe do cache', async () => {
    renderCard();
    await screen.findByText('Resumo rápido');
    qc.setQueryData(['report-template', 't2'], rows[1]);
    fireEvent.click(within(rowOf('Resumo rápido')).getByRole('button', { name: /Excluir/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir modelo' }));
    await waitFor(() => expect(svc.deleteReportTemplate).toHaveBeenCalledWith('t2'));
    await waitFor(() => expect(qc.getQueryData(['report-template', 't2'])).toBeUndefined());
    expect(toastMock.success).toHaveBeenCalledWith('Modelo excluído.');
  });

  it('erro numa ação vira toast genérico', async () => {
    svc.setDefaultReportTemplate.mockRejectedValue(new Error('rpc boom'));
    renderCard();
    await screen.findByText('Resumo rápido');
    fireEvent.click(
      within(rowOf('Resumo rápido')).getByRole('button', { name: /Definir como padrão/ }),
    );
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Não foi possível atualizar o modelo.'),
    );
  });

  it('sem modelos, mostra o texto de ajuda', async () => {
    svc.listReportTemplates.mockResolvedValue([]);
    renderCard();
    expect(
      await screen.findByText(
        'Crie um modelo para reaproveitar a mesma estrutura em todos os relatórios.',
      ),
    ).toBeInTheDocument();
  });
});
