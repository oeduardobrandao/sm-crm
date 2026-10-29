import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockFeatures: { feature_google_business?: boolean } | null | undefined = {
  feature_google_business: false,
};

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: mockFeatures }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { getGoogleSummaryMock, getGoogleAuthUrlMock, listOptionsMock, linkMock } = vi.hoisted(
  () => ({
    getGoogleSummaryMock: vi.fn(),
    getGoogleAuthUrlMock: vi.fn(),
    listOptionsMock: vi.fn(),
    linkMock: vi.fn(),
  }),
);

vi.mock('../../../services/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/google')>();
  return {
    ...actual,
    getGoogleSummary: (...a: unknown[]) => getGoogleSummaryMock(...a),
    getGoogleAuthUrl: (...a: unknown[]) => getGoogleAuthUrlMock(...a),
    listGbpLocationOptions: (...a: unknown[]) => listOptionsMock(...a),
    linkGbpLocations: (...a: unknown[]) => linkMock(...a),
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
      <GoogleBusinessSection
        clienteId={7}
        clienteNome="Clínica Sorriso Pleno"
        pickConnectionId={props.pick ?? null}
        onPickHandled={props.onPickHandled ?? (() => {})}
      />
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
});
