import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

let mockFeatures: { feature_google_business?: boolean } | null | undefined = {
  feature_google_business: false,
};

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: mockFeatures }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// jsdom has no layout: render the desktop card (a phone shows the analytics link as a cell).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

// Shows the path only after a navigation, so "renders nothing" tests still see an empty container.
function PathProbe() {
  const { pathname } = useLocation();
  return pathname.startsWith('/analytics') ? <span data-testid="path">{pathname}</span> : null;
}

const {
  getGoogleSummaryMock,
  getGoogleAuthUrlMock,
  listOptionsMock,
  linkMock,
  syncMock,
  disconnectGbpMock,
} = vi.hoisted(() => ({
  getGoogleSummaryMock: vi.fn(),
  getGoogleAuthUrlMock: vi.fn(),
  listOptionsMock: vi.fn(),
  linkMock: vi.fn(),
  syncMock: vi.fn(),
  disconnectGbpMock: vi.fn(),
}));

vi.mock('../../../services/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/google')>();
  return {
    ...actual,
    getGoogleSummary: (...a: unknown[]) => getGoogleSummaryMock(...a),
    getGoogleAuthUrl: (...a: unknown[]) => getGoogleAuthUrlMock(...a),
    listGbpLocationOptions: (...a: unknown[]) => listOptionsMock(...a),
    linkGbpLocations: (...a: unknown[]) => linkMock(...a),
    syncGoogleProduct: (...a: unknown[]) => syncMock(...a),
    disconnectGbp: (...a: unknown[]) => disconnectGbpMock(...a),
  };
});

import { GoogleBusinessSection } from '../GoogleBusinessSection';

const summary = {
  youtube: null,
  gmn: {
    locations: [
      {
        id: 'l1',
        title: 'Sorriso Pleno Moema',
        addressLine: 'Av. Ibirapuera, 2120, São Paulo',
        averageRating: 4.8,
        totalReviewCount: 312,
        status: 'active',
      },
      {
        id: 'l2',
        title: 'Sorriso Pleno Pinheiros',
        addressLine: 'R. dos Pinheiros, 870, São Paulo',
        averageRating: 4.6,
        totalReviewCount: 1,
        status: 'active',
      },
    ],
    connections: [{ id: 'conn-1', email: 'contato@sorrisopleno.com.br', status: 'active' }],
  },
};

function renderSection(props: Partial<{ pick: string | null; onPickHandled: () => void }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/clientes/7/redes-sociais']}>
        <Routes>
          <Route
            path="*"
            element={
              <GoogleBusinessSection
                clienteId={7}
                clienteNome="Clínica Sorriso Pleno"
                pickConnectionId={props.pick ?? null}
                onPickHandled={props.onPickHandled ?? (() => {})}
              />
            }
          />
        </Routes>
        <PathProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  cleanup();
  vi.clearAllMocks();
  mockFeatures = { feature_google_business: false };
});

describe('GoogleBusinessSection', () => {
  it('renders_nothing_without_flag', () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(getGoogleSummaryMock).not.toHaveBeenCalled();
  });

  it('shows the connect card when there are no units', async () => {
    mockFeatures = { feature_google_business: true };
    getGoogleSummaryMock.mockResolvedValue({
      youtube: null,
      gmn: { locations: [], connections: [] },
    });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        set href(v: string) {
          assign(v);
        },
      },
    });
    getGoogleAuthUrlMock.mockResolvedValue('https://accounts.google.com/auth?gbp=1');
    renderSection();

    expect(await screen.findByText('Conectar Google Meu Negócio')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Conectar com o Google' }));
    await waitFor(() => expect(getGoogleAuthUrlMock).toHaveBeenCalledWith(7, 'gbp'));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://accounts.google.com/auth?gbp=1'),
    );
  });

  it('lists_units_with_rating', async () => {
    mockFeatures = { feature_google_business: true };
    getGoogleSummaryMock.mockResolvedValue(summary);
    renderSection();

    expect(await screen.findByText('2 unidades')).toBeInTheDocument();
    expect(screen.getByText('Conta Google: contato@sorrisopleno.com.br')).toBeInTheDocument();
    const rows = screen.getAllByTestId('gmn-unit');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Sorriso Pleno Moema')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Av. Ibirapuera, 2120, São Paulo')).toBeInTheDocument();
    expect(within(rows[0]).getByText('★ 4,8')).toBeInTheDocument();
    expect(within(rows[0]).getByText('312 avaliações')).toBeInTheDocument();
    expect(within(rows[1]).getByText('1 avaliação')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerenciar unidades' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar outra conta Google' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pick_param_opens_dialog', async () => {
    mockFeatures = { feature_google_business: true };
    getGoogleSummaryMock.mockResolvedValue({
      youtube: null,
      gmn: { locations: [], connections: summary.gmn.connections },
    });
    listOptionsMock.mockResolvedValue({ options: [], truncated: false });
    const onPickHandled = vi.fn();
    renderSection({ pick: 'conn-1', onPickHandled });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Quais unidades são da Clínica Sorriso Pleno?')).toBeInTheDocument();
    await waitFor(() => expect(listOptionsMock).toHaveBeenCalledWith(7, 'conn-1'));
    expect(onPickHandled).toHaveBeenCalledTimes(1);
  });

  it('shows the reconnect banner when a unit is revoked', async () => {
    mockFeatures = { feature_google_business: true };
    getGoogleSummaryMock.mockResolvedValue({
      ...summary,
      gmn: {
        ...summary.gmn,
        locations: [{ ...summary.gmn.locations[0], status: 'revoked' }],
      },
    });
    renderSection();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('badge-warning');
    expect(within(alert).getByRole('button', { name: 'Reconectar' })).toBeInTheDocument();
  });

  it('shows the load error, not the connect card, when the summary fails', async () => {
    mockFeatures = { feature_google_business: true };
    getGoogleSummaryMock.mockRejectedValue(new Error('boom'));
    renderSection();

    expect(
      await screen.findByText('Não foi possível carregar o Google Meu Negócio deste cliente.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Conectar Google Meu Negócio')).toBeNull();
  });

  it('offers Escolher unidades, not the connect card, when a connection has no units yet', async () => {
    mockFeatures = { feature_google_business: true };
    getGoogleSummaryMock.mockResolvedValue({
      youtube: null,
      gmn: { locations: [], connections: summary.gmn.connections },
    });
    listOptionsMock.mockResolvedValue({ options: [], truncated: false });
    renderSection();

    expect(
      await screen.findByText('Nenhuma unidade vinculada a este cliente ainda.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Conectar Google Meu Negócio')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Escolher unidades' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(listOptionsMock).toHaveBeenCalledWith(7, 'conn-1'));
  });

  it('labels the section in every state', async () => {
    mockFeatures = { feature_google_business: true };
    getGoogleSummaryMock.mockRejectedValue(new Error('boom'));
    renderSection();
    expect(await screen.findByRole('region', { name: 'Google Meu Negócio' })).toBeInTheDocument();
  });

  it('sync calls the GMN sync for the client', async () => {
    mockFeatures = { feature_google_business: true };
    getGoogleSummaryMock.mockResolvedValue(summary);
    syncMock.mockResolvedValue({ ok: true, locations: [{ id: 'l1', status: 'synced' }] });
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar Dados' }));
    await waitFor(() => expect(syncMock).toHaveBeenCalledWith('gbp', 7));
  });

  it('disconnect confirms, then unlinks every unit of the client', async () => {
    mockFeatures = { feature_google_business: true };
    getGoogleSummaryMock.mockResolvedValue(summary);
    disconnectGbpMock.mockResolvedValue(undefined);
    renderSection();

    await userEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/em até 30 dias/)).toBeInTheDocument();
    expect(disconnectGbpMock).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => expect(disconnectGbpMock).toHaveBeenCalledWith(7));
  });

  it('full analytics opens the client Google analytics tab', async () => {
    mockFeatures = { feature_google_business: true };
    getGoogleSummaryMock.mockResolvedValue(summary);
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: /Ver Analytics Completo/ }));
    expect(screen.getByTestId('path')).toHaveTextContent('/analytics/7/google');
  });
});
