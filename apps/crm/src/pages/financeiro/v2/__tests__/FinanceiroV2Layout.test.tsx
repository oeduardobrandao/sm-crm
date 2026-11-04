import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMembership, makeCan } from '@/test/makeCan';

const { useAuthMock, getRentabilidadeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getRentabilidadeMock: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getRentabilidade: getRentabilidadeMock,
}));
vi.mock('../ConfigSheet', () => ({ default: () => null }));
vi.mock('../OnboardingCard', () => ({ default: () => null }));

import FinanceiroV2Layout from '../FinanceiroV2Layout';

const BADGE = 'Valores dos seus clientes';

function renderLayout(path = '/financeiro/rentabilidade') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/financeiro" element={<FinanceiroV2Layout />}>
            <Route path="rentabilidade" element={<div>conteudo</div>} />
            <Route path="lancamentos" element={<div>conteudo</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getRentabilidadeMock.mockResolvedValue({ seeded: true });
});

describe('FinanceiroV2Layout — membro restrito', () => {
  it('financeiro_badge_when_restricted: shows "Valores dos seus clientes"', async () => {
    const membership = fakeMembership({
      role: 'admin',
      can_see_financials: true,
      client_scope: 'atribuidos',
    });
    useAuthMock.mockReturnValue({ can: makeCan(membership), membership });
    renderLayout();

    expect(await screen.findByText('conteudo')).toBeInTheDocument();
    expect(screen.getByText(BADGE)).toBeInTheDocument();
  });

  it('keeps the badge on the Lançamentos tab too', async () => {
    const membership = fakeMembership({
      role: 'admin',
      can_see_financials: true,
      client_scope: 'atribuidos',
    });
    useAuthMock.mockReturnValue({ can: makeCan(membership), membership });
    renderLayout('/financeiro/lancamentos');

    expect(await screen.findByText('conteudo')).toBeInTheDocument();
    expect(screen.getByText(BADGE)).toBeInTheDocument();
  });

  it('todos_unchanged: no badge for a todos member nor for the owner', async () => {
    const membership = fakeMembership({ role: 'admin', can_see_financials: true });
    useAuthMock.mockReturnValue({ can: makeCan(membership), membership });
    renderLayout();

    expect(await screen.findByText('conteudo')).toBeInTheDocument();
    expect(screen.queryByText(BADGE)).not.toBeInTheDocument();
  });
});
