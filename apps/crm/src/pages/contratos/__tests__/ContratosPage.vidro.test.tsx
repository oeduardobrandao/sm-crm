import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';
import { VidroToolbarHarness } from '@/test/vidroToolbar';

// The desktop table layout (the phone branch has its own suite).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

const { useAuthMock, store } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
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
vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  ...store,
}));

import ContratosPage from '../ContratosPage';

function renderPage(vidroShell: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/contratos']}>
        <VidroToolbarHarness vidroShell={vidroShell}>
          <ContratosPage />
        </VidroToolbarHarness>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const membership = fakeMembership({ role: 'owner' });
  useAuthMock.mockReturnValue({
    can: makeCan(membership),
    workspaceRole: membership.role,
    profile: { id: 'u1', conta_id: 'w1' },
  });
  store.getContratos.mockResolvedValue([]);
  store.getClientes.mockResolvedValue([]);
});

describe('ContratosPage in the Vidro toolbar', () => {
  it('puts the title, Importar CSV and Novo Contrato in the toolbar, once each', async () => {
    renderPage(true);

    const h1s = await screen.findAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    const toolbar = h1s[0].closest('.vidro-toolbar') as HTMLElement;
    expect(toolbar).not.toBeNull();
    expect(h1s[0]).toHaveTextContent('Contratos');
    expect(screen.getAllByRole('button', { name: /Novo Contrato/ })).toHaveLength(1);
    expect(within(toolbar).getByRole('button', { name: /Novo Contrato/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Importar CSV/ })).toHaveLength(1);
    expect(within(toolbar).getByRole('button', { name: /Importar CSV/ })).toBeInTheDocument();
    expect(document.querySelector('.header')).toBeNull();
  });

  it('keeps the in-page header when the Vidro shell is off', async () => {
    renderPage(false);

    const h1 = await screen.findByRole('heading', { level: 1, name: 'Contratos' });
    expect(h1.closest('.header')).not.toBeNull();
    expect(document.querySelector('.vidro-toolbar')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Novo Contrato/ })).toHaveLength(1);
  });
});
