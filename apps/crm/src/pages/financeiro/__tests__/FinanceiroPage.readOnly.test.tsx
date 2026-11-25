import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, store, isDesktop } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  isDesktop: { value: true },
  store: {
    getTransacoes: vi.fn(),
    getClientes: vi.fn(),
    getMembros: vi.fn(),
    getRecorrentes: vi.fn(),
  },
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
  projetarAgendamentos: (rows: unknown[]) => rows,
}));

import FinanceiroPage from '../FinanceiroPage';

const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const ROWS = [
  {
    id: 1,
    descricao: 'Mensalidade Café Aurora',
    detalhe: '',
    categoria: 'Mensalidade',
    tipo: 'entrada',
    valor: 3200,
    data: `${ym}-10`,
    status: 'pago',
  },
  {
    id: 3,
    descricao: 'Clínica Sol',
    detalhe: '',
    categoria: 'Agendamento',
    tipo: 'entrada',
    valor: 2500,
    data: `${ym}-12`,
    status: 'agendado',
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/financeiro']}>
        <FinanceiroPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isDesktop.value = true;
  useAuthMock.mockReturnValue({
    canSeeFinancials: true,
    role: 'owner',
    workspaceRole: 'owner',
    profile: { conta_id: 'w1' },
  });
  store.getTransacoes.mockResolvedValue(ROWS);
  store.getClientes.mockResolvedValue([]);
  store.getMembros.mockResolvedValue([]);
  store.getRecorrentes.mockResolvedValue([]);
});

describe('FinanceiroPage read-only after a reverse trial', () => {
  it('financeiro_read_only_for_ex_trial: lists rows with no mutating control on desktop', async () => {
    renderPage();
    expect((await screen.findAllByText('Clínica Sol')).length).toBeGreaterThan(0);
    expect(
      screen.getByText('Só para consulta no Free. Recupere o Pro para editar.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recuperar o Pro' })).toHaveAttribute(
      'href',
      '/comecar?recomendado=pro',
    );
    expect(screen.queryByRole('button', { name: /Entrada/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Saída/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Importar CSV/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Confirmar/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Ações')).toBeNull();
  });

  it('hides the phone add, select and row actions', async () => {
    isDesktop.value = false;
    renderPage();
    expect(await screen.findByText('Clínica Sol')).toBeInTheDocument();
    expect(screen.getByText('Só para consulta no Free. Recupere o Pro para editar.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Adicionar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Selecionar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ações de/ })).toBeNull();
  });
});
