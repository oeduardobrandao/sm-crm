import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { useAuthMock, listMcpKeysMock, listOAuthGrantsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listMcpKeysMock: vi.fn(async () => []),
  listOAuthGrantsMock: vi.fn(async () => []),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));

vi.mock('@/services/mcp-keys', () => ({
  listMcpKeys: listMcpKeysMock,
  createMcpKey: vi.fn(),
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
