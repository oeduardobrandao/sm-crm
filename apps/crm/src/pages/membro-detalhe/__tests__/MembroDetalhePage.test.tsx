import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';
import type { PermissionAction, PermissionCheck, PermissionModule } from '@/lib/permissions';

// Regression test for the FIX 1(b) fetch-gate: getTransacoes returns raw
// financial rows and MembroDetalhePage is not a financial route, so nothing
// else stops the fetch. This asserts the `enabled` option passed to useQuery
// for the ['transacoes'] key directly, at the exact point the bug lived —
// not just the eventual masked render, which was already correct before this
// fix and would not have caught a missing gate.

const { paramsState, navigateMock, queryClientMock, queryState, queryCalls, useAuthMock } =
  vi.hoisted(() => ({
    paramsState: { id: '1' },
    navigateMock: vi.fn(),
    queryClientMock: { invalidateQueries: vi.fn() },
    queryState: {} as Record<string, { data?: unknown; isLoading?: boolean }>,
    queryCalls: {} as Record<string, { queryKey: unknown[]; enabled?: boolean }>,
    useAuthMock: vi.fn(),
  }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => paramsState,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options: { queryKey: unknown[]; enabled?: boolean }) => {
    const key = String(options.queryKey[0]);
    queryCalls[key] = options;
    return queryState[key] ?? { data: undefined, isLoading: false };
  }),
  useQueryClient: () => queryClientMock,
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../store', () => ({
  getMembros: vi.fn(),
  getTransacoes: vi.fn(),
  formatDate: (value: string) => value,
  getInitials: (nome: string) => nome.slice(0, 2).toUpperCase(),
  updateMembro: vi.fn(),
}));

import MembroDetalhePage from '../MembroDetalhePage';

const membro = {
  id: 1,
  nome: 'Ana Editora',
  cargo: 'Editora',
  tipo: 'clt' as const,
  custo_mensal: 1000,
  data_pagamento: 5,
};

function setup(
  canSeeFinancials: boolean | 'unknown',
  can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck = makeCan(
    fakeMembership({ role: 'admin' }),
  ),
) {
  useAuthMock.mockReturnValue({ canSeeFinancials, can });
  queryState.membros = { data: [membro], isLoading: false };
  queryState.transacoes = { data: [], isLoading: false };
  render(<MembroDetalhePage />);
}

describe('MembroDetalhePage financial query gate', () => {
  it('disables the transacoes fetch when the caller cannot see financials', () => {
    setup(false);

    expect(queryCalls.transacoes).toBeDefined();
    expect(queryCalls.transacoes.enabled).toBe(false);
  });

  it('enables the transacoes fetch when the caller can see financials', () => {
    setup(true);

    expect(queryCalls.transacoes).toBeDefined();
    expect(queryCalls.transacoes.enabled).toBe(true);
  });

  it('shows a restriction notice instead of an empty transactions table when restricted', () => {
    setup(false);

    expect(screen.getByText(/apenas para quem tem acesso financeiro liberado/i)).toBeTruthy();
    expect(screen.queryByText('Descrição')).toBeNull();
  });

  it('shows the transactions table when the caller can see financials', () => {
    setup(true);

    expect(screen.getByText('Descrição')).toBeTruthy();
    expect(screen.queryByText(/apenas para quem tem acesso financeiro liberado/i)).toBeNull();
  });
});

/**
 * Task 14: `isAgent = role === 'agent'` collapsed onto `canEditTeam =
 * can('equipe', 'editar') === true`. `AGENT_ROLE_PRESET.equipe` is 'none' and
 * admin resolves to `true` for every non-financial module, so the two legacy
 * cases below reproduce the OLD isAgent gate byte-for-byte — only a CUSTOM
 * role (role_id set) can diverge from its chassis role.
 */
describe('MembroDetalhePage — Editar button gated on equipe:editar', () => {
  it('hides the Editar button for a legacy agent (equipe preset is none, matches the old isAgent gate)', () => {
    setup(true, makeCan(fakeMembership({ role: 'agent' })));

    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull();
  });

  it('shows the Editar button for a legacy admin (equipe preset resolves to true)', () => {
    setup(true, makeCan(fakeMembership({ role: 'admin' })));

    expect(screen.getByRole('button', { name: /Editar/ })).toBeTruthy();
  });

  it('hides the Editar button for a custom role with equipe:ver only', () => {
    setup(
      true,
      makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { equipe: 'ver' } })),
    );

    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull();
  });

  it('shows the Editar button for a custom role with equipe:editar (the fix)', () => {
    setup(
      true,
      makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { equipe: 'editar' } }),
      ),
    );

    expect(screen.getByRole('button', { name: /Editar/ })).toBeTruthy();
  });
});
