import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

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
    'aria-label': ariaLabel,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel}
      checked={checked ?? false}
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
});
