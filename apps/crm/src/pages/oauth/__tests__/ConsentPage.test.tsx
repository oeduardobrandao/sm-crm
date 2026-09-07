import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDetails, approve, deny, listWorkspaces, recordGrant } = vi.hoisted(() => ({
  getDetails: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
  listWorkspaces: vi.fn(),
  recordGrant: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      oauth: {
        getAuthorizationDetails: getDetails,
        approveAuthorization: approve,
        denyAuthorization: deny,
      },
    },
  },
}));

vi.mock('@/services/mcp-oauth', () => ({
  listEligibleWorkspaces: listWorkspaces,
  recordOAuthGrant: recordGrant,
}));

import ConsentPage from '../ConsentPage';

const DETAILS = {
  authorization_id: 'auth-1',
  redirect_uri: 'https://claude.ai/api/mcp/callback',
  client: { id: 'client-1', name: 'Claude', uri: 'https://claude.ai', logo_uri: '' },
  scope: 'openid',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/oauth/consent?authorization_id=auth-1']}>
      <ConsentPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, assign: vi.fn() },
    writable: true,
    configurable: true,
  });
  getDetails.mockResolvedValue({ data: DETAILS, error: null });
  approve.mockResolvedValue({ data: { redirect_url: 'https://claude.ai/cb?code=x' }, error: null });
  deny.mockResolvedValue({
    data: { redirect_url: 'https://claude.ai/cb?error=denied' },
    error: null,
  });
  listWorkspaces.mockResolvedValue({
    workspaces: [{ id: 'conta-1', name: 'Agência X', role: 'owner', feature_mcp: true }],
    platform_admin: false,
  });
  recordGrant.mockResolvedValue({ ok: true });
});

describe('ConsentPage', () => {
  it('shows the client + workspace and records the grant on approve', async () => {
    renderPage();

    expect(await screen.findByText(/Conectar Claude/)).toBeInTheDocument();
    expect(await screen.findByText('Agência X')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Autorizar' }));

    await waitFor(() => expect(recordGrant).toHaveBeenCalledTimes(1));
    // client_id is NOT sent — the edge function derives it from authorization_id server-side.
    expect(recordGrant).toHaveBeenCalledWith({
      authorization_id: 'auth-1',
      conta_id: 'conta-1',
      scopes: [
        'clientes:read',
        'posts:read',
        'workflows:read',
        'ideias:read',
        'tarefas:read',
        'membros:read',
      ],
    });
    await waitFor(() => expect(approve).toHaveBeenCalledWith('auth-1'));
  });

  it('denies without recording a grant', async () => {
    renderPage();
    await screen.findByText(/Conectar Claude/);

    fireEvent.click(screen.getByRole('button', { name: 'Negar' }));

    await waitFor(() => expect(deny).toHaveBeenCalledWith('auth-1'));
    expect(recordGrant).not.toHaveBeenCalled();
  });

  it('renders an error when no authorization_id is present', async () => {
    render(
      <MemoryRouter initialEntries={['/oauth/consent']}>
        <ConsentPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Pedido de autorização inválido/)).toBeInTheDocument();
    expect(getDetails).not.toHaveBeenCalled();
  });

  it('mostra "Administração da plataforma" só para platform admins e envia target platform', async () => {
    listWorkspaces.mockResolvedValue({
      workspaces: [{ id: 'conta-1', name: 'Agência X', role: 'owner', feature_mcp: true }],
      platform_admin: true,
    });
    renderPage();
    const adminOption = await screen.findByRole('button', {
      name: /Administração da plataforma/,
    });
    fireEvent.click(adminOption);

    // Escopos trocam para os do admin, com o preset de leitura marcado.
    expect(screen.getByLabelText('Artigos de suporte (leitura)')).toBeChecked();
    expect(screen.getByLabelText('Artigos de suporte (escrita)')).not.toBeChecked();
    expect(screen.queryByLabelText('Posts (leitura)')).toBeNull();

    fireEvent.click(screen.getByLabelText('Artigos de suporte (escrita)'));
    fireEvent.click(screen.getByRole('button', { name: 'Autorizar' }));

    await waitFor(() => expect(recordGrant).toHaveBeenCalledTimes(1));
    expect(recordGrant).toHaveBeenCalledWith({
      authorization_id: 'auth-1',
      target: 'platform',
      scopes: ['banners:read', 'popups:read', 'kb:read', 'platform:read', 'kb:write'],
    });
    await waitFor(() => expect(approve).toHaveBeenCalledWith('auth-1'));
  });

  it('não mostra a opção de administração para quem não é platform admin', async () => {
    renderPage();
    await screen.findByText('Agência X');
    expect(screen.queryByText(/Administração da plataforma/)).toBeNull();
  });

  it('platform admin sem workspace elegível ainda consegue autorizar o admin', async () => {
    listWorkspaces.mockResolvedValue({ workspaces: [], platform_admin: true });
    renderPage();
    await screen.findByRole('button', { name: /Administração da plataforma/ });

    // A opção de plataforma já vem pré-selecionada — nenhum clique necessário — com os
    // escopos de leitura do admin marcados (não os escopos de workspace).
    expect(screen.getByLabelText('Artigos de suporte (leitura)')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Autorizar' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Autorizar' }));

    await waitFor(() => expect(recordGrant).toHaveBeenCalledTimes(1));
    expect(recordGrant).toHaveBeenCalledWith({
      authorization_id: 'auth-1',
      target: 'platform',
      scopes: ['banners:read', 'popups:read', 'kb:read', 'platform:read'],
    });
  });
});
