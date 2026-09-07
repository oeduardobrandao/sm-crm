import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// AcessoPage is the split-out "Acesso" screen of the pre-existing HubTab.tsx
// (see git history at d30adeea) — this suite is HubTab.test.tsx's "HubTab —
// Acesso" describe block, ported to render the route directly instead of a
// `<HubTab>` prop-driven component, plus the workspace-slug-specific
// assertions that used to live in tabs/__tests__/HubClienteTab.test.tsx
// (workspace-slug moved here because Acesso is the only screen that builds
// the portal URL — see clienteTabs.model.ts / task-2-brief.md).

// Radix AlertDialog relies on portals/focus-trap plumbing that's overkill to exercise
// here — mirrors the simplified context-driven mock already used by ClientesPage.test.tsx,
// extended with Trigger/Description since AcessoPage drives the dialog via an uncontrolled
// trigger.
vi.mock('@/components/ui/alert-dialog', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface AlertDialogContextValue {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }

  const AlertDialogContext = ReactModule.createContext<AlertDialogContextValue>({ open: false });

  function AlertDialog({
    open: openProp = false,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    const [open, setOpen] = ReactModule.useState(openProp);
    ReactModule.useEffect(() => {
      setOpen(openProp);
    }, [openProp]);
    return (
      <AlertDialogContext.Provider
        value={{
          open,
          onOpenChange: (v: boolean) => {
            setOpen(v);
            onOpenChange?.(v);
          },
        }}
      >
        <div>{children}</div>
      </AlertDialogContext.Provider>
    );
  }

  function AlertDialogTrigger({ children }: { asChild?: boolean; children: React.ReactElement }) {
    const { onOpenChange } = ReactModule.useContext(AlertDialogContext);
    return ReactModule.cloneElement(children, {
      onClick: (event: unknown) => {
        (children.props as { onClick?: (e: unknown) => void }).onClick?.(event);
        onOpenChange?.(true);
      },
    });
  }

  function AlertDialogContent({ children }: { children: React.ReactNode }) {
    const { open } = ReactModule.useContext(AlertDialogContext);
    return open ? <div role="alertdialog">{children}</div> : null;
  }

  function AlertDialogHeader({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function AlertDialogFooter({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function AlertDialogTitle({ children }: { children: React.ReactNode }) {
    return <h2>{children}</h2>;
  }

  function AlertDialogDescription({ children }: { children: React.ReactNode }) {
    return <p>{children}</p>;
  }

  function AlertDialogAction({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { onOpenChange } = ReactModule.useContext(AlertDialogContext);
    return (
      <button
        type="button"
        onClick={(event) => {
          onClick?.(event);
          onOpenChange?.(false);
        }}
      >
        {children}
      </button>
    );
  }

  function AlertDialogCancel({ children }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { onOpenChange } = ReactModule.useContext(AlertDialogContext);
    return (
      <button type="button" onClick={() => onOpenChange?.(false)}>
        {children}
      </button>
    );
  }

  return {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
  };
});

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => mockEntitlements,
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));

vi.mock('@/store/hub');

// The "O que o cliente vê" panel tests drive usePortalFill's return value directly
// (data/isLoading/isError), the same way the rest of this suite drives hubStore's
// mocked promises -- this hook is the one exception, mocked as a whole rather than
// through its underlying getPortalFill, so the loading/error/zero predicates can be
// asserted without wiring up a real react-query cache for them. usePortalFill's own
// gating (enabled: !isRestricted) is covered by usePortalFill.test.tsx instead.
vi.mock('../usePortalFill');

import { useAuth } from '@/context/AuthContext';
import AcessoPage from '../AcessoPage';
import * as hubStore from '@/store/hub';
import { usePortalFill } from '../usePortalFill';
import type { PortalFill } from '@/store';

const mockedUseAuth = vi.mocked(useAuth);
const mockedUsePortalFill = vi.mocked(usePortalFill);

const ZERO_FILL: PortalFill = {
  briefingTotal: 0,
  briefingAnswered: 0,
  brandFiles: 0,
  hasBrand: false,
  pages: 0,
  newIdeasWithoutReply: 0,
};

// Fail-open by default (matches useEntitlements while the plan is still loading).
let mockEntitlements: { hasFeature: (flag: string) => boolean } = { hasFeature: () => true };

const DAY = 86_400_000;
const token = (expiresInDays: number) => ({
  id: 't1',
  token: 'tok-1',
  is_active: true,
  expires_at: new Date(Date.now() + expiresInDays * DAY).toISOString(),
});

const CLIENTE: Cliente = {
  id: 15,
  nome: 'Aurora Estética',
  sigla: 'AE',
  cor: '#ffbf30',
  plano: 'Plano Ouro',
  email: 'contato@aurora.com.br',
  telefone: '(85) 99999-0000',
  status: 'ativo',
  valor_mensal: 1500,
  conta_id: 'ws-1',
};

function setAuth(workspaceRole: 'owner' | 'admin' | 'agent' | null) {
  mockedUseAuth.mockReturnValue({ workspaceRole } as never);
}

function OutletContextProvider({ cliente }: { cliente: Cliente }) {
  return (
    <Outlet context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext} />
  );
}

function renderPage(cliente: Cliente = CLIENTE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OutletContextProvider cliente={cliente} />}>
            <Route path="/" element={<AcessoPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

describe('AcessoPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEntitlements = { hasFeature: () => true };
    setAuth('owner');
    vi.mocked(hubStore.getWorkspaceSlug).mockResolvedValue('dk-marketing-medico');
    mockedUsePortalFill.mockReturnValue({
      data: ZERO_FILL,
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a healthy link with no Estender button', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Expira em/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Estender/ })).not.toBeInTheDocument();
  });

  it('shows Estender when the link is near expiry', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(12));
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Estender/ })).toBeInTheDocument(),
    );
  });

  it('shows the Expirado badge and Estender when lapsed', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(-1));
    renderPage();
    await waitFor(() => expect(screen.getByText('Expirado')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Estender/ })).toBeInTheDocument();
  });

  it('shows Expirado (not "Expira em 0 dias") for a token that lapsed a few hours ago today', async () => {
    // Same calendar day as "now", but the instant itself is already past — regression
    // guard for the differenceInCalendarDays(0) trap that hid a same-day expiry as healthy.
    vi.mocked(hubStore.getHubToken).mockResolvedValue({
      id: 't1',
      token: 'tok-1',
      is_active: true,
      expires_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Expirado')).toBeInTheDocument());
    expect(screen.queryByText(/Expira em 0 dias/)).not.toBeInTheDocument();
  });

  it('offers to generate a link when the plan includes the hub portal', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(null);
    renderPage();
    await waitFor(() => expect(screen.getByText('Nenhum link gerado ainda.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Gerar link/ })).toBeInTheDocument();
  });

  it('prompts for an upgrade instead of generating when feature_hub_portal is off', async () => {
    mockEntitlements = { hasFeature: (flag) => flag !== 'feature_hub_portal' };
    vi.mocked(hubStore.getHubToken).mockResolvedValue(null);
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText('O Portal do Cliente faz parte dos planos pagos.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Ver planos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gerar link/ })).not.toBeInTheDocument();
    expect(hubStore.createHubToken).not.toHaveBeenCalled();
  });

  it('does not rotate until the confirm dialog is accepted', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    vi.mocked(hubStore.rotateHubToken).mockResolvedValue({
      token: 'tok-2',
      expires_at: new Date(Date.now() + 365 * DAY).toISOString(),
    });
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Gerar novo link/ }));

    fireEvent.click(screen.getByRole('button', { name: /Gerar novo link/ }));
    expect(hubStore.rotateHubToken).not.toHaveBeenCalled(); // dialog open, not confirmed

    fireEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(hubStore.rotateHubToken).toHaveBeenCalledWith('t1'));
  });

  // Ported from HubTab.test.tsx's "scrolls the selected tab into view and groups
  // access actions" — the scroll-into-view half tested the pill-tab strip, which
  // no longer exists now that Acesso/Briefing/Marca/Páginas/Ideias are separate
  // routes (see ClienteDetalheNav.test.tsx for the nav-link equivalent). Only the
  // "groups access actions" half still applies to this screen.
  it('groups access actions into secondary/primary containers', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    renderPage();
    await waitFor(() => screen.getByText(/Expira em/));
    const urlEl = document.querySelector('.hub-access__url');
    expect(urlEl).not.toBeNull();
    // Regression guard for the old HubClienteTab.test.tsx assertion that the workspace
    // slug reaches URL construction (dropped, not superseded, in the split — see
    // task-2-report.md "Fix round 1"). hubUrl gained a `tokenData && workspaceSlug`
    // condition during the split (see AcessoPage.tsx above), so this is live logic.
    expect(urlEl).toHaveTextContent(/\/dk-marketing-medico\/hub\/tok-1$/);
    expect(document.querySelector('.hub-access__secondary-actions')).not.toBeNull();
    expect(document.querySelector('.hub-access__primary-actions')).not.toBeNull();
  });

  // Ported from tabs/__tests__/HubClienteTab.test.tsx, which tested this at the
  // old wrapper level (the wrapper waited on workspaceSlug before rendering
  // HubTab at all). Now that AcessoPage owns the workspace-slug query directly,
  // it is the one that must not render until the slug resolves.
  it('does not render until workspaceSlug resolves, for an owner', () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    vi.mocked(hubStore.getWorkspaceSlug).mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();

    expect(screen.queryByText('Acesso do Cliente')).not.toBeInTheDocument();
  });

  it('fires only the hub-token and workspace-slug queries — nothing from Marca/Páginas/Briefing', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    const { queryClient } = renderPage();
    await waitFor(() => screen.getByText(/Expira em/));

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey[0]);
    expect(new Set(keys)).toEqual(new Set(['hub-token', 'workspace-slug']));
  });

  // Regression guard: before the split, HubClienteTab returned RoleRestrictionNotice
  // before HubTab (and hub-token) ever mounted, so an agent never issued the request.
  // The split moved the useQuery calls above <HubRoleGate>, so without `enabled:
  // !isRestricted` on both queries this fires again — landing the portal bearer token
  // in an agent's React Query cache and network log even though RoleRestrictionNotice
  // hides it from the screen.
  it('does not fire the hub-token or workspace-slug queries for an agent', async () => {
    setAuth('agent');
    renderPage();

    await screen.findByText('Hub do Cliente');
    expect(hubStore.getHubToken).not.toHaveBeenCalled();
    expect(hubStore.getWorkspaceSlug).not.toHaveBeenCalled();
  });

  // AcessoPage had no agent-role test at all before this fix — the deleted
  // HubClienteTab.test.tsx covered "agent sees no hub content" for the whole Hub,
  // Acesso included, but that assertion did not survive the split.
  it('shows the restriction notice, not Acesso do Cliente, for an agent', async () => {
    setAuth('agent');
    renderPage();

    expect(
      await screen.findByText(
        'O gerenciamento do Hub do Cliente está disponível apenas para proprietários e administradores do workspace.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Acesso do Cliente')).not.toBeInTheDocument();
  });

  // "O que o cliente vê" panel: the three predicates fixed in task-3-brief.md — a
  // dash (never zero) while pending, "vazia" only for a resolved-zero count, and no
  // Link wrapping a row whose count failed to load. usePortalFill is mocked as a
  // whole (see the vi.mock above), so these drive its return value directly instead
  // of a real query lifecycle.
  describe('painel "O que o cliente vê"', () => {
    beforeEach(() => {
      vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    });

    it('mostra traço, não zero, enquanto carrega', async () => {
      mockedUsePortalFill.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        isSuccess: false,
      } as never);
      renderPage();
      await waitFor(() => screen.getByText(/Expira em/));

      expect(screen.getByTestId('fill-paginas')).toHaveTextContent('–');
      expect(screen.queryByText('vazia')).not.toBeInTheDocument();
    });

    it('mostra traço, não o valor zerado, com dado obsoleto durante um refetch', async () => {
      // isSuccess stays false while the query refetches with `isLoading: true` even
      // though `data` still holds the previous (successful) result — a bare `data &&`
      // check would render the stale ZERO_FILL as "vazia" instead of the dash.
      mockedUsePortalFill.mockReturnValue({
        data: ZERO_FILL,
        isLoading: true,
        isError: false,
        isSuccess: false,
      } as never);
      renderPage();
      await waitFor(() => screen.getByText(/Expira em/));

      expect(screen.getByTestId('fill-paginas')).toHaveTextContent('–');
      expect(screen.queryByText('vazia')).not.toBeInTheDocument();
    });

    it('mostra "vazia" só quando a contagem resolvida é zero', async () => {
      mockedUsePortalFill.mockReturnValue({
        data: { ...ZERO_FILL, pages: 0, briefingTotal: 12, briefingAnswered: 8 },
        isLoading: false,
        isError: false,
        isSuccess: true,
      } as never);
      renderPage();
      await waitFor(() => screen.getByText(/Expira em/));

      expect(screen.getByTestId('fill-paginas')).toHaveTextContent('vazia');
      expect(screen.getByTestId('fill-briefing')).toHaveTextContent('8 de 12 respondidas');
    });

    it('não vira link quando a query falha', async () => {
      mockedUsePortalFill.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        isSuccess: false,
      } as never);
      renderPage();
      await waitFor(() => screen.getByText(/Expira em/));

      expect(screen.getByTestId('fill-paginas').querySelector('a')).toBeNull();
    });
  });
});
