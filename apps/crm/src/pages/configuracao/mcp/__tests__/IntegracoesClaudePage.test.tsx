import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { useAuthMock, listMcpKeysMock, listOAuthGrantsMock, createMcpKeyMock, toastErrorMock } =
  vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    listMcpKeysMock: vi.fn(async () => []),
    listOAuthGrantsMock: vi.fn(async () => []),
    createMcpKeyMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastErrorMock } }));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
// jsdom has no matchMedia match: keep this suite on the desktop layout (phone has its own suite).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

vi.mock('@/services/mcp-keys', () => ({
  listMcpKeys: listMcpKeysMock,
  createMcpKey: createMcpKeyMock,
  revokeMcpKey: vi.fn(),
}));

vi.mock('@/services/mcp-oauth', () => ({
  listOAuthGrants: listOAuthGrantsMock,
  revokeOAuthGrant: vi.fn(),
}));

vi.mock('@/components/paywall/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import IntegracoesClaudePage from '../IntegracoesClaudePage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntegracoesClaudePage />
    </QueryClientProvider>,
  );
}

const OWNER_ADMIN_ONLY_TEXT =
  'Apenas proprietários e administradores podem gerenciar as chaves de API.';

/**
 * Task 14: `isOwnerOrAdmin = role === 'owner' || role === 'admin'` collapsed
 * onto `can('configuracoes', 'ver') === true`, gating both the page's own
 * queries (mcp-keys, mcp-oauth-grants) and its early "owner/admin only"
 * return. `AGENT_ROLE_PRESET.configuracoes` is 'none' and admin resolves to
 * `true` for every non-financial module (lib/permissions.ts), so the two
 * legacy-preset cases below reproduce the OLD isOwnerOrAdmin gate
 * byte-for-byte -- only a CUSTOM role (role_id set) can now diverge from
 * its chassis role.
 */
describe('IntegracoesClaudePage — gated on configuracoes:ver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMcpKeysMock.mockResolvedValue([]);
    listOAuthGrantsMock.mockResolvedValue([]);
  });

  it('keeps a legacy agent blocked (configuracoes preset is none)', async () => {
    useAuthMock.mockReturnValue({ can: makeCan(fakeMembership({ role: 'agent' })) });
    renderPage();

    expect(await screen.findByText(OWNER_ADMIN_ONLY_TEXT)).toBeInTheDocument();
    expect(listMcpKeysMock).not.toHaveBeenCalled();
    expect(listOAuthGrantsMock).not.toHaveBeenCalled();
  });

  it('keeps a legacy admin unchanged (configuracoes preset resolves to true)', async () => {
    useAuthMock.mockReturnValue({ can: makeCan(fakeMembership({ role: 'admin' })) });
    renderPage();

    expect(screen.queryByText(OWNER_ADMIN_ONLY_TEXT)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(listMcpKeysMock).toHaveBeenCalled();
      expect(listOAuthGrantsMock).toHaveBeenCalled();
    });
  });

  it('blocks a custom role with no configuracoes grant at all', async () => {
    useAuthMock.mockReturnValue({
      can: makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} })),
    });
    renderPage();

    expect(await screen.findByText(OWNER_ADMIN_ONLY_TEXT)).toBeInTheDocument();
    expect(listMcpKeysMock).not.toHaveBeenCalled();
  });

  it('unblocks a custom role with configuracoes:editar (the fix)', async () => {
    useAuthMock.mockReturnValue({
      can: makeCan(
        fakeMembership({
          role: 'agent',
          role_id: 'role-1',
          permissions: { configuracoes: 'editar' },
        }),
      ),
    });
    renderPage();

    expect(screen.queryByText(OWNER_ADMIN_ONLY_TEXT)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(listMcpKeysMock).toHaveBeenCalled();
      expect(listOAuthGrantsMock).toHaveBeenCalled();
    });
  });
});

/**
 * F4 (revisão externa): a `configuracoes:ver`-only role reached the page and
 * still saw "Criar chave", "Revogar" and "Desconectar" as live controls. The
 * writes here go through edge functions that DO deny, so nothing was silently
 * lost -- but an enabled control that always fails is the same UX defect the
 * finding names, so the controls follow `can('configuracoes','editar')` like
 * every other config surface.
 */
describe('IntegracoesClaudePage — mutation controls gated on configuracoes:editar', () => {
  const KEY = {
    id: 'key-1',
    name: 'Chave Claude',
    scopes: ['clients:read'],
    created_at: '2026-01-01T00:00:00Z',
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listMcpKeysMock.mockResolvedValue([KEY]);
    listOAuthGrantsMock.mockResolvedValue([]);
  });

  it('disables Criar chave / Revogar and shows "Somente leitura" for a ver-only custom role', async () => {
    useAuthMock.mockReturnValue({
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { configuracoes: 'ver' } }),
      ),
    });
    renderPage();

    expect(await screen.findByText('Somente leitura')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar chave' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revogar' })).toBeDisabled());
  });

  it('keeps them enabled for configuracoes:editar', async () => {
    useAuthMock.mockReturnValue({
      can: makeCan(
        fakeMembership({
          role: 'agent',
          role_id: 'role-1',
          permissions: { configuracoes: 'editar' },
        }),
      ),
    });
    renderPage();

    expect(screen.getByRole('button', { name: 'Criar chave' })).not.toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revogar' })).not.toBeDisabled());
    expect(screen.queryByText('Somente leitura')).not.toBeInTheDocument();
  });

  it('keeps them enabled for a legacy admin (regression)', async () => {
    useAuthMock.mockReturnValue({ can: makeCan(fakeMembership({ role: 'admin' })) });
    renderPage();

    expect(screen.getByRole('button', { name: 'Criar chave' })).not.toBeDisabled();
    expect(screen.queryByText('Somente leitura')).not.toBeInTheDocument();
  });
});

/**
 * financeiro:* scopes are owner-only. The picker follows `workspaceRole` (the active
 * workspace membership), never the profile role; null/unresolved counts as not owner.
 */
describe('IntegracoesClaudePage — financeiro scopes are owner-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMcpKeysMock.mockResolvedValue([]);
    listOAuthGrantsMock.mockResolvedValue([]);
  });

  async function openCreate(workspaceRole: 'owner' | 'admin' | 'agent' | null, role = 'owner') {
    useAuthMock.mockReturnValue({
      can: makeCan(fakeMembership({ role: role as 'owner' })),
      workspaceRole,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Criar chave' }));
    await screen.findByText('Preset: Agente de conteúdo');
  }

  it('non-owner sees financeiro scopes disabled with the helper text', async () => {
    await openCreate('admin', 'admin');
    expect(screen.getByLabelText('Financeiro (leitura, só donos)')).toBeDisabled();
    expect(screen.getByLabelText('Financeiro (escrita, só donos)')).toBeDisabled();
    expect(screen.getAllByText('Somente o dono do workspace')).toHaveLength(2);
    expect(screen.getByLabelText('Posts (escrita)')).not.toBeDisabled();
  });

  it('treats an unresolved workspaceRole (null) as not owner', async () => {
    await openCreate(null);
    expect(screen.getByLabelText('Financeiro (leitura, só donos)')).toBeDisabled();
  });

  it('owner can tick them', async () => {
    await openCreate('owner');
    const write = screen.getByLabelText('Financeiro (escrita, só donos)');
    expect(write).not.toBeDisabled();
    expect(screen.queryByText('Somente o dono do workspace')).toBeNull();
    fireEvent.click(write);
    expect(write).toBeChecked();
  });
});

/**
 * mcp-keys answers `owner_only_scope` when a non-owner asks for financeiro:* (the server-side
 * check, e.g. a role changed after the page loaded). The toast says it in Portuguese, with the
 * same copy the OAuth consent page uses, instead of "Erro ao criar chave: owner_only_scope".
 */
describe('IntegracoesClaudePage — owner_only_scope error copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMcpKeysMock.mockResolvedValue([]);
    listOAuthGrantsMock.mockResolvedValue([]);
  });

  it('maps owner_only_scope to the consent page copy', async () => {
    createMcpKeyMock.mockRejectedValue(new Error('owner_only_scope'));
    useAuthMock.mockReturnValue({
      can: makeCan(fakeMembership({ role: 'owner' })),
      workspaceRole: 'owner',
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Criar chave' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Ex: Agente de conteúdo'), {
      target: { value: 'Agente financeiro' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar chave' }));

    await waitFor(() => expect(createMcpKeyMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'As permissões do Financeiro são somente do dono do workspace.',
      ),
    );
  });
});
