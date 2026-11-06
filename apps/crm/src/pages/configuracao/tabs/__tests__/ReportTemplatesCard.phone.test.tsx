import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// No useIsDesktop mock: jsdom's matchMedia never matches, so the card renders its phone face.

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

import { ReportTemplatesCard } from '../ReportTemplatesCard';

const rows = [
  {
    id: 't1',
    name: 'Mensal completo',
    // Seccionado: a contagem é de blocos de conteúdo, o marcador `section` não conta.
    layout: {
      version: 1,
      blocks: [
        { id: 's', type: 'section', size: 'full' },
        { id: 'a', type: 'cover', size: 'full' },
      ],
    },
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

/** Opens a row's hold menu through its explicit "…" trigger. */
async function openMenu(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
  return screen.findByRole('menu');
}

describe('ReportTemplatesCard on phones', () => {
  it('lists the system template, then each template with its badge and block count', async () => {
    renderCard();
    await screen.findByText('Mensal completo');
    const ids = Array.from(document.querySelectorAll('[data-template-row]')).map((r) =>
      r.getAttribute('data-template-row'),
    );
    expect(ids).toEqual(['system', 't1', 't2']);
    expect(screen.getByText('padrão')).toBeInTheDocument();
    expect(screen.getByText('1 bloco')).toBeInTheDocument();
    // No desktop DropdownMenu triggers.
    expect(screen.queryByRole('button', { name: /^Editar$/ })).toBeNull();
  });

  it('Novo modelo creates from the system layout and opens the editor', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Novo modelo' }));
    await waitFor(() =>
      expect(svc.createReportTemplate).toHaveBeenCalledWith('Novo modelo', {
        version: 1,
        blocks: [],
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/relatorios/modelos/new-1');
  });

  it('tapping the system row opens its preview; its menu duplicates it', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Padrão do sistema embutido/ }));
    expect(navigateMock).toHaveBeenCalledWith('/relatorios/modelos/padrao');

    const menu = await openMenu('Ações de Padrão do sistema');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Duplicar' }));
    await waitFor(() =>
      expect(svc.createReportTemplate).toHaveBeenCalledWith(
        'Padrão do sistema (cópia)',
        expect.anything(),
      ),
    );
  });

  it('tapping a template opens its editor', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Resumo rápido 0 blocos/ }));
    expect(navigateMock).toHaveBeenCalledWith('/relatorios/modelos/t2');
  });

  it('Definir como padrão goes through the same RPC and is hidden on the default', async () => {
    renderCard();
    const defaultMenu = await openMenu('Mais ações de Mensal completo');
    expect(within(defaultMenu).queryByRole('menuitem', { name: 'Definir como padrão' })).toBeNull();
    fireEvent.keyDown(defaultMenu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    const menu = await openMenu('Mais ações de Resumo rápido');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Definir como padrão' }));
    await waitFor(() => expect(svc.setDefaultReportTemplate).toHaveBeenCalledWith('t2'));
  });

  it('Renomear opens a sheet whose Salvar saves the new name', async () => {
    renderCard();
    const menu = await openMenu('Mais ações de Resumo rápido');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Renomear' }));

    const sheet = await screen.findByRole('dialog', { name: 'Renomear modelo' });
    const input = within(sheet).getByLabelText('Nome do modelo');
    expect(input).toHaveValue('Resumo rápido');
    fireEvent.change(input, { target: { value: 'Resumo semanal' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(svc.updateReportTemplate).toHaveBeenCalledWith('t2', { name: 'Resumo semanal' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Renomear modelo' })).toBeNull(),
    );
  });

  it('Excluir confirms with the desktop copy and deletes through the same mutation', async () => {
    renderCard();
    const menu = await openMenu('Mais ações de Resumo rápido');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Excluir' }));

    const confirm = await screen.findByRole('dialog', { name: 'Excluir o modelo?' });
    expect(
      within(confirm).getByText('Resumo rápido. Relatórios já gerados com ele não mudam.'),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Excluir modelo' }));

    await waitFor(() => expect(svc.deleteReportTemplate).toHaveBeenCalledWith('t2'));
    expect(toastMock.success).toHaveBeenCalledWith('Modelo excluído.');
  });

  it('a failed delete can be confirmed again on the same template', async () => {
    svc.deleteReportTemplate.mockRejectedValueOnce(new Error('rls'));
    renderCard();
    let menu = await openMenu('Mais ações de Resumo rápido');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Excluir' }));
    let confirm = await screen.findByRole('dialog', { name: 'Excluir o modelo?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Excluir modelo' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    menu = await openMenu('Mais ações de Resumo rápido');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Excluir' }));
    confirm = await screen.findByRole('dialog', { name: 'Excluir o modelo?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Excluir modelo' }));
    await waitFor(() => expect(svc.deleteReportTemplate).toHaveBeenCalledTimes(2));
  });
});
