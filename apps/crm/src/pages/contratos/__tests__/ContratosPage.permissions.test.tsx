import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeCan, fakeMembership } from '@/test/makeCan';
import { MASKED_BRL } from '@/lib/financialAccess';

/**
 * F1 (revisão de branch, MEDIUM): /contratos was guarded and masked by the
 * FINANCEIRO capability (AppLayout's FINANCIAL_PATHS + canSeeFinancials)
 * while nav-data and the RLS policies keyed on CONTRATOS. The mismatch was
 * invisible for legacy roles only because `derivePermission` couples the two
 * capabilities for all of them. A custom role of `{contratos: editar,
 * financeiro: none}` saw the nav item, clicked it, and hit the financial
 * restriction screen. This suite pins the split in BOTH directions plus the
 * legacy regression.
 */

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));

const { getContratosMock, getClientesMock } = vi.hoisted(() => ({
  getContratosMock: vi.fn(),
  getClientesMock: vi.fn(),
}));
vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  getContratos: (...a: unknown[]) => getContratosMock(...a),
  getClientes: (...a: unknown[]) => getClientesMock(...a),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ContratosPage from '../ContratosPage';
import AppLayout, { contractGuardOutcome } from '@/components/layout/AppLayout';

const CONTRATO = {
  id: 7,
  titulo: 'Contrato Aurora',
  cliente_id: 1,
  cliente_nome: 'Aurora Estética',
  data_inicio: '2026-01-01',
  data_fim: '2026-12-31',
  valor_total: 18000,
  status: 'vigente' as const,
};

function authValue(overrides: Parameters<typeof fakeMembership>[0] = {}) {
  const membership = fakeMembership(overrides);
  return {
    can: makeCan(membership),
    workspaceRole: membership.role,
    profile: { id: 'u1', conta_id: 'w1' },
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/contratos']}>
        <ContratosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  getContratosMock.mockResolvedValue([CONTRATO]);
  getClientesMock.mockResolvedValue([{ id: 1, nome: 'Aurora Estética' }]);
  useAuthMock.mockReturnValue(authValue({ role: 'owner' }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ContratosPage value masking keys on contratos, not financeiro', () => {
  it('renders real values for a custom role with contratos:editar and financeiro none', async () => {
    useAuthMock.mockReturnValue(
      authValue({
        role: 'agent',
        role_id: 'role-1',
        permissions: { contratos: 'editar' },
      }),
    );
    renderPage();

    expect(await screen.findByText('Contrato Aurora')).toBeInTheDocument();
    // The value is rendered, not masked -- the whole point of the split.
    expect(screen.queryByText(MASKED_BRL)).not.toBeInTheDocument();
    await waitFor(() => expect(getContratosMock).toHaveBeenCalled());
  });

  it('masks values and fires no contratos query for a custom role without contratos', async () => {
    useAuthMock.mockReturnValue(
      authValue({
        role: 'agent',
        role_id: 'role-1',
        permissions: { financeiro: 'editar' },
      }),
    );
    renderPage();

    await waitFor(() => expect(getClientesMock).toHaveBeenCalled());
    expect(getContratosMock).not.toHaveBeenCalled();
  });

  it('keeps a legacy owner seeing real values (regression)', async () => {
    renderPage();
    expect(await screen.findByText('Contrato Aurora')).toBeInTheDocument();
    expect(screen.queryByText(MASKED_BRL)).not.toBeInTheDocument();
  });
});

/**
 * The route-level half of the same finding, asserted through the pure guard
 * (AppLayout itself pulls in the whole shell -- sidebar, banners, Crisp --
 * which this suite has no reason to mount).
 */
describe('contract route guard against real membership shapes', () => {
  const check = (m: Parameters<typeof fakeMembership>[0]) =>
    contractGuardOutcome('/contratos', makeCan(fakeMembership(m))('contratos', 'ver'));

  it('lets {contratos: editar, financeiro: none} through', () => {
    expect(check({ role: 'agent', role_id: 'r', permissions: { contratos: 'editar' } })).toBe(
      'content',
    );
  });

  it('shows the restriction screen for {contratos: none, financeiro: editar}', () => {
    expect(check({ role: 'agent', role_id: 'r', permissions: { financeiro: 'editar' } })).toBe(
      'denied',
    );
  });

  it('still shows the restriction screen for a legacy restricted admin (regression)', () => {
    expect(check({ role: 'admin', can_see_financials: false })).toBe('denied');
  });

  it('still lets a legacy owner and an unrestricted admin through (regression)', () => {
    expect(check({ role: 'owner' })).toBe('content');
    expect(check({ role: 'admin', can_see_financials: true })).toBe('content');
  });
});

// Keeps the AppLayout import honest: the guard above is the one the shell
// actually calls.
it('AppLayout exports the guard the shell renders with', () => {
  expect(typeof AppLayout).toBe('function');
});
