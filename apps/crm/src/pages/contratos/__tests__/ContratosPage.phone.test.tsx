import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';
import { PhoneLayoutProvider } from '@/components/layout/PhoneLayoutContext';

// jsdom's matchMedia reports false, so ContratosPage renders its phone branch (PLAN F2d).

const { useAuthMock, navigateMock, store } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  navigateMock: vi.fn(),
  store: {
    getContratos: vi.fn(),
    getClientes: vi.fn(),
    addContrato: vi.fn(),
    updateContrato: vi.fn(),
    removeContrato: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  ...store,
}));

import ContratosPage from '../ContratosPage';

const CONTRATOS = [
  {
    id: 1,
    titulo: 'Gestão de redes 2026',
    cliente_id: 5,
    cliente_nome: 'Café Aurora',
    data_inicio: '2026-02-01',
    data_fim: '2027-01-31',
    valor_total: 38400,
    status: 'vigente' as const,
  },
  {
    id: 2,
    titulo: 'Campanha de verão',
    cliente_id: null,
    cliente_nome: 'Pet Feliz',
    data_inicio: '2025-12-01',
    data_fim: '2026-02-28',
    valor_total: 7500,
    status: 'encerrado' as const,
  },
];

function renderPage({ phoneShell = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/contratos']}>
        <ContratosPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(phoneShell ? <PhoneLayoutProvider isPhone>{page}</PhoneLayoutProvider> : page);
}

function rowOf(text: string) {
  return screen.getByText(text).closest('li') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  const membership = fakeMembership({ role: 'owner' });
  useAuthMock.mockReturnValue({
    can: makeCan(membership),
    workspaceRole: membership.role,
    profile: { id: 'u1', conta_id: 'w1' },
  });
  store.getContratos.mockResolvedValue(CONTRATOS);
  store.getClientes.mockResolvedValue([{ id: 5, nome: 'Café Aurora' }]);
  store.removeContrato.mockResolvedValue(undefined);
  store.updateContrato.mockResolvedValue(undefined);
});

describe('ContratosPage on phones', () => {
  it('renders the page header and one row per contract, with no inline page padding', async () => {
    const { container } = renderPage();

    expect(await screen.findByText('Gestão de redes 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Contratos' })).toBeInTheDocument();
    expect(screen.getByText('Gerencie os contratos dos seus clientes.')).toBeInTheDocument();
    expect(document.querySelector('.header')).toBeNull();
    expect(container.querySelector('[style*="padding: 1.5rem"]')).toBeNull();
    const row = rowOf('Gestão de redes 2026');
    expect(within(row).getByText('Café Aurora')).toBeInTheDocument();
    expect(within(row).getByText('Vigente')).toBeInTheDocument();
    expect(within(row).getByText(/38\.400,00/)).toBeInTheDocument();
  });

  it('filters by status with the chips', async () => {
    renderPage();
    await screen.findByText('Gestão de redes 2026');

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Status' })).getByRole('button', {
        name: 'Encerrado',
      }),
    );
    expect(screen.queryByText('Gestão de redes 2026')).not.toBeInTheDocument();
    expect(screen.getByText('Campanha de verão')).toBeInTheDocument();
  });

  it('keeps Importar CSV and its columns behind "…"', async () => {
    renderPage();
    await screen.findByText('Gestão de redes 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações: Importar CSV' }));
    const sheet = await screen.findByRole('dialog', { name: 'Mais ações' });
    expect(within(sheet).getByText(/titulo\*, cliente_nome, data_inicio\*/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Importar CSV' })).toBeInTheDocument();
  });

  it('opens the edit form on tap and asks before removing from the swipe action', async () => {
    renderPage();
    await screen.findByText('Gestão de redes 2026');

    fireEvent.click(within(rowOf('Campanha de verão')).getByRole('button', { name: 'Remover' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Remover este contrato?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Sim' }));
    await waitFor(() => expect(store.removeContrato).toHaveBeenCalledWith(2));

    fireEvent.click(screen.getByText('Gestão de redes 2026'));
    expect(await screen.findByRole('dialog', { name: 'Editar Contrato' })).toBeInTheDocument();
  });

  it('opens Novo Contrato from the ink "+"', async () => {
    renderPage();
    await screen.findByText('Gestão de redes 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Novo Contrato' }));
    expect(await screen.findByRole('dialog', { name: 'Novo Contrato' })).toBeInTheDocument();
  });

  it('links the client from the edit sheet inside the phone shell', async () => {
    renderPage({ phoneShell: true });
    await screen.findByText('Gestão de redes 2026');

    fireEvent.click(screen.getByText('Gestão de redes 2026'));
    const dialog = await screen.findByRole('dialog', { name: 'Editar Contrato' });
    expect(within(dialog).getByLabelText('Título')).toHaveValue('Gestão de redes 2026');
    expect(within(dialog).getByLabelText('Data início')).toHaveValue('2026-02-01');
    expect(within(dialog).getByRole('button', { name: /Cliente \(opcional\)/ })).toHaveTextContent(
      'Café Aurora',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: /Abrir cliente/ }));
    expect(navigateMock).toHaveBeenCalledWith('/clientes/5');
  });

  it('saves a status change picked from the checkmark list', async () => {
    renderPage({ phoneShell: true });
    await screen.findByText('Gestão de redes 2026');

    fireEvent.click(screen.getByText('Gestão de redes 2026'));
    const dialog = await screen.findByRole('dialog', { name: 'Editar Contrato' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Status/ }));
    const picker = await screen.findByRole('dialog', { name: 'Status' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Encerrado' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Salvar/ }));

    await waitFor(() =>
      expect(store.updateContrato).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'encerrado', cliente_id: 5 }),
      ),
    );
  });
});
