import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

// No useIsDesktop mock: jsdom's matchMedia never matches, so the page renders its phone branch.

const svc = vi.hoisted(() => ({
  listMcpKeys: vi.fn(),
  createMcpKey: vi.fn(),
  revokeMcpKey: vi.fn(),
  listOAuthGrants: vi.fn(),
  revokeOAuthGrant: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: svc.useAuth }));
vi.mock('@/services/mcp-keys', () => ({
  listMcpKeys: svc.listMcpKeys,
  createMcpKey: svc.createMcpKey,
  revokeMcpKey: svc.revokeMcpKey,
}));
vi.mock('@/services/mcp-oauth', () => ({
  listOAuthGrants: svc.listOAuthGrants,
  revokeOAuthGrant: svc.revokeOAuthGrant,
}));
vi.mock('@/components/paywall/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

import IntegracoesClaudePage from '../IntegracoesClaudePage';

const KEY = {
  id: 'k1',
  name: 'Agente de pautas',
  token_suffix: 'a1b2',
  scopes: ['posts:read'],
  last_used_at: null,
  expires_at: null,
  revoked_at: null,
  created_at: '2026-10-01T00:00:00Z',
};
const GRANT = {
  id: 'g1',
  connected_by: 'ana@exemplo.com',
  scopes: ['clientes:read'],
  created_at: '2026-10-02T00:00:00Z',
  revoked_at: null,
};

const writeText = vi.fn(async () => {});

function renderPage(role: 'owner' | 'agent' = 'owner') {
  svc.useAuth.mockReturnValue({ can: makeCan(fakeMembership({ role })) });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <IntegracoesClaudePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IntegracoesClaudePage on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.listMcpKeys.mockResolvedValue([KEY]);
    svc.listOAuthGrants.mockResolvedValue([GRANT]);
    svc.createMcpKey.mockResolvedValue({ token: 'mesaas_sk_secret123' });
    svc.revokeMcpKey.mockResolvedValue(undefined);
    svc.revokeOAuthGrant.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  it('shows an agent the connector guide and their own connections, without API keys', async () => {
    renderPage('agent');
    expect(screen.getByRole('heading', { level: 1, name: 'Agentes (MCP)' })).toBeInTheDocument();
    expect(await screen.findByText('Suas conexões')).toBeInTheDocument();
    expect(screen.queryByText('Chaves de API')).toBeNull();
    const tabs = screen.getByRole('tablist', { name: 'Escolha o assistente' });
    expect(within(tabs).queryByRole('tab', { name: 'Codex' })).toBeNull();
    expect(svc.listMcpKeys).not.toHaveBeenCalled();
  });

  it('switches the guide with the segmented tabs', async () => {
    renderPage();
    const tabs = screen.getByRole('tablist', { name: 'Escolha o assistente' });
    expect(within(tabs).getByRole('tab', { name: 'Claude' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText(/Adicionar conector personalizado/)).toBeInTheDocument();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'ChatGPT' }));
    expect(screen.getByText(/Developer mode/)).toBeInTheDocument();
    expect(screen.queryByText(/Adicionar conector personalizado/)).toBeNull();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Codex' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('[mcp_servers.mesaas]');
    expect(screen.queryByRole('button', { name: 'Copiar URL do MCP' })).toBeNull();
  });

  it('copies the MCP URL from its copy row', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar URL do MCP' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/functions\/v1\/mcp$/));
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
  });

  it('creates a key from the sheet, then reveals the token once in the same sheet', async () => {
    renderPage();
    await screen.findByText('Agente de pautas');
    fireEvent.click(screen.getByRole('button', { name: 'Criar chave' }));

    const sheet = await screen.findByRole('dialog', { name: 'Criar chave de API' });
    const submit = within(sheet).getByRole('button', { name: 'Criar chave' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText('Nome'), {
      target: { value: 'Agente novo' },
    });
    // Scopes: the content-agent preset is on by default; add one write scope.
    expect(within(sheet).getByRole('button', { name: 'Clientes (leitura)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Posts (escrita)' }));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(svc.createMcpKey).toHaveBeenCalledWith({
        name: 'Agente novo',
        scopes: [
          'clientes:read',
          'posts:read',
          'workflows:read',
          'ideias:read',
          'tarefas:read',
          'membros:read',
          'posts:write',
        ],
        expires_at: null,
      }),
    );

    const reveal = await screen.findByRole('dialog', { name: 'Copie sua chave agora' });
    expect(within(reveal).getByText('mesaas_sk_secret123')).toBeInTheDocument();
    fireEvent.click(within(reveal).getByRole('button', { name: 'Copiar chave' }));
    expect(writeText).toHaveBeenCalledWith('mesaas_sk_secret123');
    fireEvent.click(within(reveal).getByRole('button', { name: 'Copiar comando do Claude Code' }));
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining('Authorization: Bearer mesaas_sk_secret123'),
    );

    fireEvent.click(within(reveal).getByRole('button', { name: 'Concluído' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('revokes a key after the confirm sheet', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ações da chave Agente de pautas' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Revogar' }));

    const confirm = await screen.findByRole('dialog', { name: 'Revogar chave?' });
    expect(within(confirm).getByText(/deixará de funcionar imediatamente/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(svc.revokeMcpKey).toHaveBeenCalledWith('k1'));
  });

  it('opens the connect sheet for an existing key with the pasted token in the snippets', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Agente de pautas …a1b2/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Conectar: Agente de pautas' });
    expect(within(sheet).getAllByText(/SUA_CHAVE_AQUI/).length).toBeGreaterThan(0);
    fireEvent.change(within(sheet).getByLabelText('Sua chave (opcional)'), {
      target: { value: 'mesaas_sk_colada' },
    });
    fireEvent.click(
      within(sheet).getByRole('button', { name: 'Copiar configuração do Codex CLI' }),
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Bearer mesaas_sk_colada'));
  });

  it('disconnects a grant from its swipe action after the confirm sheet', async () => {
    renderPage();
    await screen.findByText('ana@exemplo.com');
    // The swipe actions are real buttons (keyboard and screen-reader path).
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));

    const confirm = await screen.findByRole('dialog', { name: 'Desconectar?' });
    expect(within(confirm).getByText(/perderá o acesso imediatamente/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => expect(svc.revokeOAuthGrant).toHaveBeenCalledWith('g1'));
  });
});
