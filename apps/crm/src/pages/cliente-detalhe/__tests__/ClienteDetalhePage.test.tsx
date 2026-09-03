import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  getCliente: vi.fn(),
  updateCliente: vi.fn(),
}));

import { useAuth } from '../../../context/AuthContext';
import { getCliente, updateCliente, type Cliente } from '../../../store';
import ClienteDetalhePage from '../ClienteDetalhePage';
import ClienteDetalheIndexRedirect from '../ClienteDetalheIndexRedirect';
import { makeCan, fakeMembership } from '@/test/makeCan';
import type { PermissionAction, PermissionCheck, PermissionModule } from '@/lib/permissions';

type CanFn = (module: PermissionModule, action?: PermissionAction) => PermissionCheck;

const mockedUseAuth = vi.mocked(useAuth);
const mockedGetCliente = vi.mocked(getCliente);
const mockedUpdateCliente = vi.mocked(updateCliente);

const CLIENTE: Cliente = {
  id: 42,
  nome: 'Aurora Estética',
  sigla: 'AE',
  cor: '#ffbf30',
  plano: 'Plano Ouro',
  email: 'contato@aurora.com.br',
  telefone: '(85) 99999-0000',
  status: 'ativo',
  valor_mensal: 1500,
};

function setAuth(
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
  {
    loading = false,
    signedIn = true,
    canSeeFinancials = true as boolean | 'unknown',
    membershipResolved = true as boolean | 'error',
    can,
  }: {
    loading?: boolean;
    signedIn?: boolean;
    canSeeFinancials?: boolean | 'unknown';
    membershipResolved?: boolean | 'error';
    /**
     * Override for a custom-role scenario. Defaults to a real
     * derivePermission-backed `can` for a LEGACY membership of
     * `workspaceRole` (`null` -> unresolved membership, 'unknown' for every
     * module — matching the fact that `membership` and `workspaceRole` are
     * always set together in the real AuthContext).
     */
    can?: CanFn;
  } = {},
) {
  mockedUseAuth.mockReturnValue({
    user: signedIn ? { id: 'u1', email: 'a@b.c' } : null,
    profile: { nome: 'Débora Kristin' },
    role: workspaceRole ?? 'agent',
    workspaceRole,
    membershipResolved,
    canSeeFinancials,
    can:
      can ??
      makeCan(
        workspaceRole === null
          ? null
          : fakeMembership({ role: workspaceRole, can_see_financials: canSeeFinancials === true }),
      ),
    loading,
    signOut: vi.fn(),
    refetchProfile: vi.fn(),
  } as never);
}

function PathProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname + location.search}</span>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/clientes" element={<div>lista de clientes</div>} />
          <Route path="/clientes/:id" element={<ClienteDetalhePage />}>
            <Route index element={<ClienteDetalheIndexRedirect />} />
            <Route path="visao-geral" element={<div>conteudo visao-geral</div>} />
            <Route path="entregas" element={<div>conteudo entregas</div>} />
            <Route path="redes-sociais" element={<div>conteudo redes-sociais</div>} />
            <Route path="relatorios" element={<div>conteudo relatorios</div>} />
            <Route path="hub" element={<div>conteudo hub</div>} />
            <Route path="arquivos" element={<div>conteudo arquivos</div>} />
            <Route path="financeiro" element={<div>conteudo financeiro</div>} />
            <Route path="*" element={null} />
          </Route>
        </Routes>
        <PathProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, invalidateSpy, queryClient };
}

function tabLabels() {
  return screen.queryAllByRole('link').map((el) => el.textContent);
}

describe('ClienteDetalhePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCliente.mockResolvedValue(CLIENTE);
  });

  it('redirects to /clientes when the id param is not a number', async () => {
    setAuth('owner');
    renderAt('/clientes/not-a-number');
    await waitFor(() => expect(screen.getByText('lista de clientes')).toBeInTheDocument());
  });

  it('shows a spinner while the client is loading, not the shell', () => {
    setAuth('owner');
    mockedGetCliente.mockReturnValue(new Promise(() => undefined));
    const { container } = renderAt('/clientes/42/visao-geral');
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText('conteudo visao-geral')).not.toBeInTheDocument();
  });

  it('shows a not-found card when the client does not exist', async () => {
    setAuth('owner');
    mockedGetCliente.mockResolvedValue(null);
    renderAt('/clientes/42/visao-geral');
    expect(await screen.findByText('Cliente não encontrado')).toBeInTheDocument();
  });

  it('renders the seven tabs grouped and in order for an owner', async () => {
    setAuth('owner');
    renderAt('/clientes/42/visao-geral');
    await screen.findByText('conteudo visao-geral');
    expect(tabLabels()).toEqual([
      'Visão geral',
      'Entregas',
      'Redes sociais',
      'Relatórios',
      'Hub',
      'Arquivos',
      'Financeiro',
    ]);
  });

  it('marks the active tab per the current route', async () => {
    setAuth('owner');
    renderAt('/clientes/42/entregas');
    await screen.findByText('conteudo entregas');
    expect(screen.getByRole('link', { name: 'Entregas' })).toHaveAttribute('aria-current', 'page');
  });

  describe('index redirect', () => {
    it('redirects the base route to Visão geral', async () => {
      setAuth('owner');
      renderAt('/clientes/42');
      await screen.findByText('conteudo visao-geral');
      expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42/visao-geral');
    });

    it('preserves query parameters across the redirect', async () => {
      setAuth('owner');
      renderAt('/clientes/42?foo=bar');
      await screen.findByText('conteudo visao-geral');
      expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42/visao-geral?foo=bar');
    });

    it.each(['ig_connected', 'ig_error', 'tt_error'])(
      'sends OAuth callbacks with %s to Redes sociais, params intact',
      async (param) => {
        setAuth('owner');
        renderAt(`/clientes/42?${param}=1`);
        await screen.findByText('conteudo redes-sociais');
        expect(screen.getByTestId('path')).toHaveTextContent(
          `/clientes/42/redes-sociais?${param}=1`,
        );
      },
    );
  });

  describe('unknown segment', () => {
    it('redirects an unregistered tab segment to Visão geral', async () => {
      setAuth('owner');
      renderAt('/clientes/42/bogus-tab');
      await screen.findByText('conteudo visao-geral');
      expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42/visao-geral');
    });

    it('redirects a known tab prefix with a bogus nested segment to Visão geral', async () => {
      setAuth('owner');
      renderAt('/clientes/42/visao-geral/extra');
      await screen.findByText('conteudo visao-geral');
      expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42/visao-geral');
    });
  });

  describe('per-tab permission gating', () => {
    // Task 12: `relatorios` maps to {analytics,ver}, which the legacy agent
    // preset already grants (it did before this task too, for the top-level
    // /analytics route) — an agent visiting Relatórios directly now renders
    // it instead of bouncing. See clienteTabs.model.test.ts for the full
    // truth table this divergence is drawn from.
    it('renders Relatórios directly for an agent, who has analytics:ver via the legacy preset', async () => {
      setAuth('agent', { canSeeFinancials: false });
      renderAt('/clientes/42/relatorios');
      expect(await screen.findByText('conteudo relatorios')).toBeInTheDocument();
      expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42/relatorios');
    });

    it('redirects a custom role without analytics access away from Relatórios to Visão geral', async () => {
      setAuth('agent', {
        canSeeFinancials: false,
        can: makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} })),
      });
      renderAt('/clientes/42/relatorios');
      await screen.findByText('conteudo visao-geral');
      expect(screen.queryByText('conteudo relatorios')).not.toBeInTheDocument();
    });

    it('renders Relatórios directly for an owner', async () => {
      setAuth('owner');
      renderAt('/clientes/42/relatorios');
      expect(await screen.findByText('conteudo relatorios')).toBeInTheDocument();
      expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42/relatorios');
    });

    // Task 12: `hub` maps to {configuracoes,editar}, which the legacy agent
    // preset has always lacked ('none') — an agent visiting Hub directly now
    // bounces, where it used to render an internal RoleRestrictionNotice
    // (HubClienteTab.tsx) instead.
    it('redirects an agent away from Hub to Visão geral', async () => {
      setAuth('agent');
      renderAt('/clientes/42/hub');
      await screen.findByText('conteudo visao-geral');
      expect(screen.queryByText('conteudo hub')).not.toBeInTheDocument();
    });

    it('renders Hub directly for an admin (configuracoes:editar, unconditional for admin outside financeiro/contratos)', async () => {
      setAuth('admin');
      renderAt('/clientes/42/hub');
      expect(await screen.findByText('conteudo hub')).toBeInTheDocument();
    });

    it('redirects a restricted admin away from Financeiro to Visão geral', async () => {
      setAuth('admin', { canSeeFinancials: false });
      renderAt('/clientes/42/financeiro');
      await screen.findByText('conteudo visao-geral');
      expect(screen.queryByText('conteudo financeiro')).not.toBeInTheDocument();
    });

    it('renders Financeiro directly for an owner with financial access', async () => {
      setAuth('owner', { canSeeFinancials: true });
      renderAt('/clientes/42/financeiro');
      expect(await screen.findByText('conteudo financeiro')).toBeInTheDocument();
      expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42/financeiro');
    });
  });

  describe('no premature redirect while state is still loading', () => {
    it('shows a loading state for Financeiro (not a redirect, not the tab) while canSeeFinancials is unknown', async () => {
      setAuth('owner', { canSeeFinancials: 'unknown' });
      const { container } = renderAt('/clientes/42/financeiro');
      await waitFor(() => expect(mockedGetCliente).toHaveBeenCalled());
      expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42/financeiro');
      expect(screen.queryByText('conteudo financeiro')).not.toBeInTheDocument();
      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('never bounces off Relatórios while workspaceRole is still resolving', () => {
      setAuth(null, { loading: true });
      renderAt('/clientes/42/relatorios');
      expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42/relatorios');
      expect(screen.queryByText('conteudo relatorios')).not.toBeInTheDocument();
      expect(screen.queryByText('conteudo visao-geral')).not.toBeInTheDocument();
    });
  });

  /**
   * Task 14: `canEditPhoto = workspaceRole === 'owner' || workspaceRole ===
   * 'admin'` collapsed onto `can('clientes', 'editar') === true`.
   * `AGENT_ROLE_PRESET.clientes` is 'editar' (lib/permissions.ts, same
   * preset ClientesPage's own mutation buttons rely on), so a LEGACY agent
   * now sees the control too — this is a deliberate widening that brings the
   * photo control in line with the rest of the clientes module, not a
   * regression. Only a CUSTOM role can still be denied it.
   */
  it('shows the photo-upload control for an owner and for a legacy agent (clientes preset is editar)', async () => {
    setAuth('owner');
    mockedGetCliente.mockResolvedValue({ ...CLIENTE, foto_url: null });
    const ownerRender = renderAt('/clientes/42/visao-geral');
    expect(await screen.findByLabelText('Alterar foto do cliente')).toBeInTheDocument();
    ownerRender.unmount();

    setAuth('agent');
    mockedGetCliente.mockResolvedValue({ ...CLIENTE, foto_url: null });
    const agentRender = renderAt('/clientes/42/visao-geral');
    expect(await screen.findByLabelText('Alterar foto do cliente')).toBeInTheDocument();
    agentRender.unmount();
  });

  it('hides the photo-upload control for a custom role with clientes:ver only', async () => {
    setAuth('agent', {
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { clientes: 'ver' } }),
      ),
    });
    mockedGetCliente.mockResolvedValue({ ...CLIENTE, foto_url: null });
    renderAt('/clientes/42/visao-geral');
    await screen.findByText('conteudo visao-geral');
    expect(screen.queryByLabelText('Alterar foto do cliente')).not.toBeInTheDocument();
  });

  it('shows the photo-upload control for a custom role with clientes:editar', async () => {
    setAuth('agent', {
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { clientes: 'editar' } }),
      ),
    });
    mockedGetCliente.mockResolvedValue({ ...CLIENTE, foto_url: null });
    renderAt('/clientes/42/visao-geral');
    expect(await screen.findByLabelText('Alterar foto do cliente')).toBeInTheDocument();
  });

  /**
   * Task 14, revisão externa round 4 (P2): the header's "Editar" button
   * (opens ClienteEditDialog) used to render unconditionally regardless of
   * role -- a custom role with only `clientes:ver` reached this page and
   * could still open the edit dialog, even though `canEditPhoto` was
   * already gated on `can('clientes','editar')`. Both flags now share the
   * same derived `canEditClient` in ClienteDetalhePage.tsx.
   */
  it('hides the header Editar button for a custom role with clientes:ver only', async () => {
    setAuth('agent', {
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { clientes: 'ver' } }),
      ),
    });
    renderAt('/clientes/42/visao-geral');
    await screen.findByText('conteudo visao-geral');
    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument();
  });

  it('keeps the header Editar button for a legacy agent (clientes preset is editar — unchanged)', async () => {
    setAuth('agent');
    renderAt('/clientes/42/visao-geral');
    expect(await screen.findByRole('button', { name: /editar/i })).toBeInTheDocument();
  });

  it('keeps the header Editar button for a legacy admin (unchanged)', async () => {
    setAuth('admin');
    renderAt('/clientes/42/visao-geral');
    expect(await screen.findByRole('button', { name: /editar/i })).toBeInTheDocument();
  });

  describe('client edit', () => {
    it('invalidates both cliente and clientes query keys after a successful save', async () => {
      setAuth('owner');
      mockedUpdateCliente.mockResolvedValue(undefined);
      const { invalidateSpy } = renderAt('/clientes/42/visao-geral');
      await screen.findByText('conteudo visao-geral');

      fireEvent.click(screen.getByRole('button', { name: /editar/i }));
      const saveButton = await screen.findByRole('button', { name: 'Salvar' });
      fireEvent.click(saveButton);

      await waitFor(() => expect(mockedUpdateCliente).toHaveBeenCalledTimes(1));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cliente', 42] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientes'] });
    });
  });
});
