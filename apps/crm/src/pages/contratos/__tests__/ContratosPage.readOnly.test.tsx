import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, store, isDesktop } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  isDesktop: { value: true },
  store: { getContratos: vi.fn(), getClientes: vi.fn() },
}));

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => isDesktop.value }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/paywall/useReadOnlyGrandfather', () => ({
  useReadOnlyGrandfather: () => ({ readOnly: true, pending: false }),
}));
vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  ...store,
}));

import ContratosPage from '../ContratosPage';

const CONTRATOS = [
  {
    id: 1,
    titulo: 'Gestão de redes 2026',
    cliente_id: 7,
    cliente_nome: 'Café Aurora',
    data_inicio: '2026-01-01',
    data_fim: '2026-12-31',
    valor_total: 24000,
    status: 'vigente',
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/contratos']}>
        <ContratosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isDesktop.value = true;
  useAuthMock.mockReturnValue({
    can: () => true,
    role: 'owner',
    workspaceRole: 'owner',
    profile: { conta_id: 'w1' },
  });
  store.getContratos.mockResolvedValue(CONTRATOS);
  store.getClientes.mockResolvedValue([]);
});

describe('ContratosPage read-only after a reverse trial', () => {
  it('contratos_no_mutating_controls on desktop', async () => {
    renderPage();
    expect(await screen.findByText('Gestão de redes 2026')).toBeInTheDocument();
    expect(screen.getByText('Só para consulta no Free. Recupere o Pro para editar.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Novo Contrato/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Importar CSV/ })).toBeNull();
    expect(screen.queryByText('Ações')).toBeNull();
    // The client link still works.
    expect(screen.getByRole('button', { name: 'Café Aurora' })).toBeInTheDocument();
  });

  it('contratos_no_mutating_controls on phones', async () => {
    isDesktop.value = false;
    renderPage();
    expect(await screen.findByText('Gestão de redes 2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo Contrato' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Importar CSV/ })).toBeNull();
  });
});
