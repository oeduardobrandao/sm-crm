import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';
import type { PermissionAction, PermissionCheck, PermissionModule } from '@/lib/permissions';

// Regression test for the FIX 1(b) fetch-gate: getTransacoes returns raw
// financial rows and MembroDetalhePage is not a financial route, so nothing
// else stops the fetch. This asserts the `enabled` option passed to useQuery
// for the ['transacoes'] key directly, at the exact point the bug lived —
// not just the eventual masked render, which was already correct before this
// fix and would not have caught a missing gate.

const {
  paramsState,
  navigateMock,
  queryClientMock,
  queryState,
  queryCalls,
  useAuthMock,
  useWorkspaceLimitsMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  paramsState: { id: '1' },
  navigateMock: vi.fn(),
  queryClientMock: { invalidateQueries: vi.fn() },
  queryState: {} as Record<string, { data?: unknown; isLoading?: boolean }>,
  queryCalls: {} as Record<string, { queryKey: unknown[]; enabled?: boolean }>,
  useAuthMock: vi.fn(),
  useWorkspaceLimitsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
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

vi.mock('../../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: useWorkspaceLimitsMock,
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

vi.mock('../../../store', () => ({
  getMembros: vi.fn(),
  getTransacoes: vi.fn(),
  getWorkspaceRoles: vi.fn(),
  getWorkspaceUsers: vi.fn(),
  formatDate: (value: string) => value,
  getInitials: (nome: string) => nome.slice(0, 2).toUpperCase(),
  updateMembro: vi.fn(),
  setMembroCrmUser: vi.fn(),
}));

vi.mock('../../../services/invite', () => ({
  inviteUser: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}));

import * as store from '../../../store';
import * as inviteService from '../../../services/invite';
import MembroDetalhePage from '../MembroDetalhePage';

const mockedUpdateMembro = vi.mocked(store.updateMembro);
const mockedInviteUser = vi.mocked(inviteService.inviteUser);

const membro = {
  id: 1,
  nome: 'Ana Editora',
  cargo: 'Editora',
  tipo: 'clt' as const,
  custo_mensal: 1000,
  data_pagamento: 5,
  avatar_url: 'https://cdn.exemplo.com/ana.jpg',
  crm_user_id: null,
};

function setup(
  canSeeFinancials: boolean | 'unknown',
  can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck = makeCan(
    fakeMembership({ role: 'admin' }),
  ),
) {
  useAuthMock.mockReturnValue({
    canSeeFinancials,
    can,
    workspaceRole: 'admin',
    profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
  });
  useWorkspaceLimitsMock.mockReturnValue({
    limits: { max_team_members: 10 },
    isLoading: false,
    isUnlimited: false,
  });
  queryState.membros = { data: [membro], isLoading: false };
  queryState.transacoes = { data: [], isLoading: false };
  queryState['workspace-users'] = { data: [], isLoading: false };
  queryState.invites = { data: [], isLoading: false };
  render(<MembroDetalhePage />);
}

describe('MembroDetalhePage financial query gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

describe('MembroDetalhePage member editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets a workspace admin save the member and invite them to the CRM', async () => {
    mockedUpdateMembro.mockResolvedValueOnce(undefined);
    mockedInviteUser.mockResolvedValueOnce({ success: true, message: 'Convite enviado' });
    setup(true);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Conta CRM' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('switch', { name: 'Convidar para o workspace' }));
    fireEvent.change(within(dialog).getByLabelText('Email *'), {
      target: { value: 'ana@exemplo.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar e convidar' }));

    await waitFor(() => {
      expect(mockedUpdateMembro).toHaveBeenCalledTimes(1);
      expect(mockedInviteUser).toHaveBeenCalledWith('ana@exemplo.com', 'agent', 1);
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Convite enviado');
  });

  it('does not clear the existing avatar when saving from the detail page', async () => {
    mockedUpdateMembro.mockResolvedValueOnce(undefined);
    setup(true);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdateMembro).toHaveBeenCalledTimes(1));
    const [, payload] = mockedUpdateMembro.mock.calls[0];
    expect(payload).not.toHaveProperty('avatar_url');
  });
});
