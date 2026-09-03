import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));

const { updateClienteMock } = vi.hoisted(() => ({ updateClienteMock: vi.fn() }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  updateCliente: (...args: unknown[]) => updateClienteMock(...args),
}));

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

// Radix Switch mocked to a plain checkbox, same convention used across the
// suite (NotificacoesTab.test.tsx, MembrosTab.test.tsx, InstagramSection.test.tsx).
vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    'aria-label': ariaLabel,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel}
      checked={checked ?? false}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

import RelatoriosTab from '../RelatoriosTab';

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
  send_report_email: false,
  include_ai_analysis: true,
};

function OutletContextProvider({ cliente }: { cliente: Cliente }) {
  return (
    <Outlet context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext} />
  );
}

function renderTab(cliente: Cliente = CLIENTE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OutletContextProvider cliente={cliente} />}>
            <Route path="/" element={<RelatoriosTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, invalidateSpy };
}

/**
 * RelatoriosTab reads BOTH `can` (module permission, Task 14) and the coarse
 * `workspaceRole` (the send_report_email DB trigger's own owner/admin check,
 * migration 20260904000001) off `useAuth()`, so every mock has to supply both
 * or one of the two gates silently reads `undefined`. This helper keeps them
 * consistent: `workspaceRole` defaults to the membership's chassis role,
 * which is exactly what a custom role reports in the real app.
 */
function authValue(overrides: Parameters<typeof fakeMembership>[0] = {}) {
  const membership = fakeMembership(overrides);
  return { can: makeCan(membership), workspaceRole: membership.role };
}

beforeEach(() => {
  // Default to owner so the pre-existing suites (written before either gate
  // existed) keep exercising the "current behaviour intact" path without
  // every test having to set this up.
  useAuthMock.mockReturnValue(authValue({ role: 'owner' }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RelatoriosTab', () => {
  it('renders the card title/description and both switches reflecting the cliente prefs', () => {
    renderTab();
    expect(screen.getByText('Relatório Mensal')).toBeInTheDocument();
    expect(
      screen.getByText('Configure as opções de envio e análise do relatório mensal.'),
    ).toBeInTheDocument();

    const sendEmail = screen.getByLabelText('Enviar relatório por e-mail');
    const includeAi = screen.getByLabelText('Incluir análise AI');
    expect((sendEmail as HTMLInputElement).checked).toBe(false);
    expect((includeAi as HTMLInputElement).checked).toBe(true);
  });

  it('renders no hardcoded fallback text — the toggle descriptions come from i18n', () => {
    renderTab();
    expect(
      screen.getByText('Envia automaticamente o relatório mensal para o e-mail do cliente'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Adiciona resumo e recomendações geradas por inteligência artificial'),
    ).toBeInTheDocument();
  });

  it('toggling send_report_email on: calls updateCliente, invalidates the cliente query, toasts success', async () => {
    updateClienteMock.mockResolvedValue(undefined);
    const { invalidateSpy } = renderTab();

    fireEvent.click(screen.getByLabelText('Enviar relatório por e-mail'));

    await waitFor(() =>
      expect(updateClienteMock).toHaveBeenCalledWith(42, { send_report_email: true }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cliente', 42] });
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Envio por e-mail ativado'));
  });

  it('toggling include_ai_analysis off: calls updateCliente, invalidates, toasts success with the "off" copy', async () => {
    updateClienteMock.mockResolvedValue(undefined);
    const { invalidateSpy } = renderTab();

    fireEvent.click(screen.getByLabelText('Incluir análise AI'));

    await waitFor(() =>
      expect(updateClienteMock).toHaveBeenCalledWith(42, { include_ai_analysis: false }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cliente', 42] });
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Análise AI desativada'));
  });

  it('a failed update toasts the generic error message and does not invalidate the query', async () => {
    updateClienteMock.mockRejectedValue(new Error('network down'));
    const { invalidateSpy } = renderTab();

    fireEvent.click(screen.getByLabelText('Enviar relatório por e-mail'));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Erro ao atualizar configuração'),
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('renders a shortcut to Analytics that navigates to /analytics/:id', () => {
    renderTab();
    const btn = screen.getByRole('button', { name: 'Ver Analytics Completo →' });
    fireEvent.click(btn);
    expect(navigateMock).toHaveBeenCalledWith('/analytics/42');
  });

  it('fires no Entregas/Hub/Financeiro/Instagram queries — this tab has none of its own data fetches', async () => {
    const { queryClient } = renderTab();
    await waitFor(() => expect(screen.getByText('Relatório Mensal')).toBeInTheDocument());
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey[0]);
    expect(keys).toEqual([]);
  });

  /**
   * Task 14, revisão externa round 3 (P1): the TAB's own mount is gated on
   * `analytics:ver` at the route layer (clienteTabs.model.ts) -- unrelated
   * to whether the two switches here should be interactive, since both call
   * `updateCliente` (a write against a tenant-only-RLS table). A viewer with
   * read-only `analytics:ver` (custom role, no `clientes:editar`) previously
   * got fully working write toggles just by reaching this tab. Gated on
   * `can('clientes','editar') === true`; `AGENT_ROLE_PRESET.clientes` is
   * 'editar', so a legacy agent (who already sees this tab, per the
   * documented delta) keeps the switches -- parity with the client-edit
   * access it already has everywhere else.
   *
   * send_report_email carries a SECOND, independent gate (migration
   * 20260904000001's trg_cliente_notify_guard, which checks the coarse
   * owner/admin role and knows nothing about role_id/permissions), so it is
   * only interactive when BOTH gates clear. include_ai_analysis has no such
   * trigger and only carries the clientes:editar gate.
   */
  describe('switches gated on clientes:editar', () => {
    it('keeps include_ai_analysis enabled for a legacy agent (clientes preset is editar — parity, not a regression)', () => {
      useAuthMock.mockReturnValue(authValue({ role: 'agent' }));
      renderTab();

      expect(screen.getByLabelText('Incluir análise AI')).not.toBeDisabled();
      expect(screen.queryByText('Somente leitura')).not.toBeInTheDocument();
      // send_report_email still blocked by the DB trigger's owner/admin check.
      expect(screen.getByLabelText('Enviar relatório por e-mail')).toBeDisabled();
    });

    it('keeps both switches enabled for a custom role with clientes:editar on an admin chassis', () => {
      useAuthMock.mockReturnValue(
        authValue({ role: 'admin', role_id: 'role-1', permissions: { clientes: 'editar' } }),
      );
      renderTab();

      expect(screen.getByLabelText('Enviar relatório por e-mail')).not.toBeDisabled();
      expect(screen.getByLabelText('Incluir análise AI')).not.toBeDisabled();
      expect(screen.queryByText('Somente leitura')).not.toBeInTheDocument();
    });

    it('disables both switches (with "Somente leitura") for a custom role with analytics:ver but no clientes:editar', () => {
      useAuthMock.mockReturnValue(
        authValue({
          role: 'agent',
          role_id: 'role-1',
          permissions: { analytics: 'ver' },
        }),
      );
      renderTab();

      // Asserts the `disabled` attribute itself, not a click-then-no-call
      // round trip: the mocked Switch is a plain controlled <input>, and
      // jsdom's fireEvent.click dispatches a synthetic event that still
      // reaches its onChange handler even when disabled (real browsers
      // suppress this for genuine user clicks; Radix's actual Switch
      // enforces it in its own click handling regardless). `disabled` is
      // the contract this suite can verify without re-testing Radix/jsdom
      // click semantics.
      const sendEmail = screen.getByLabelText('Enviar relatório por e-mail');
      const includeAi = screen.getByLabelText('Incluir análise AI');
      expect(sendEmail).toBeDisabled();
      expect(includeAi).toBeDisabled();
      expect(screen.getByText('Somente leitura')).toBeInTheDocument();
      // The read-only hint replaces the owner/admin note: with no
      // clientes:editar at all, "only owners/admins" would misdescribe why.
      expect(
        screen.queryByText('Apenas donos e admins alteram e-mails de cliente.'),
      ).not.toBeInTheDocument();
    });

    it('keeps include_ai_analysis enabled for a custom role with clientes:editar', () => {
      useAuthMock.mockReturnValue(
        authValue({
          role: 'agent',
          role_id: 'role-1',
          permissions: { clientes: 'editar' },
        }),
      );
      renderTab();

      expect(screen.getByLabelText('Incluir análise AI')).not.toBeDisabled();
      expect(screen.queryByText('Somente leitura')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Enviar relatório por e-mail')).toBeDisabled();
    });
  });
});

// The route itself already keeps an agent off /clientes/:id/relatorios
// (clienteTabs.model.ts gates it STAFF-only), but that route guard is a
// separate module this component's own tests know nothing about — see the
// role-gating comment atop RelatoriosTab.tsx. This suite covers the
// component's own defense so a future change to the route roles can't
// silently resurrect a send_report_email switch that always 42501s
// (trg_cliente_notify_guard, migration 20260904000001).
describe('RelatoriosTab — agent role gate on send_report_email', () => {
  it('disables the send_report_email switch and shows the explanatory note for an agent', () => {
    useAuthMock.mockReturnValue(authValue({ role: 'agent' }));
    renderTab();

    const sendEmail = screen.getByLabelText('Enviar relatório por e-mail') as HTMLInputElement;
    expect(sendEmail.disabled).toBe(true);
    expect(
      screen.getByText('Apenas donos e admins alteram e-mails de cliente.'),
    ).toBeInTheDocument();
  });

  it('does not call updateCliente when an agent clicks the disabled send_report_email switch', () => {
    useAuthMock.mockReturnValue(authValue({ role: 'agent' }));
    renderTab();

    fireEvent.click(screen.getByLabelText('Enviar relatório por e-mail'));

    expect(updateClienteMock).not.toHaveBeenCalled();
  });

  it('leaves include_ai_analysis enabled and clickable for an agent', async () => {
    useAuthMock.mockReturnValue(authValue({ role: 'agent' }));
    updateClienteMock.mockResolvedValue(undefined);
    renderTab();

    const includeAi = screen.getByLabelText('Incluir análise AI') as HTMLInputElement;
    expect(includeAi.disabled).toBe(false);

    fireEvent.click(includeAi);

    await waitFor(() =>
      expect(updateClienteMock).toHaveBeenCalledWith(42, { include_ai_analysis: false }),
    );
  });

  it('does not show the agent note or disable the switch for an owner', () => {
    useAuthMock.mockReturnValue(authValue({ role: 'owner' }));
    renderTab();

    const sendEmail = screen.getByLabelText('Enviar relatório por e-mail') as HTMLInputElement;
    expect(sendEmail.disabled).toBe(false);
    expect(
      screen.queryByText('Apenas donos e admins alteram e-mails de cliente.'),
    ).not.toBeInTheDocument();
  });

  it('does not show the agent note or disable the switch for an admin', () => {
    useAuthMock.mockReturnValue(authValue({ role: 'admin' }));
    renderTab();

    const sendEmail = screen.getByLabelText('Enviar relatório por e-mail') as HTMLInputElement;
    expect(sendEmail.disabled).toBe(false);
    expect(
      screen.queryByText('Apenas donos e admins alteram e-mails de cliente.'),
    ).not.toBeInTheDocument();
  });
});
