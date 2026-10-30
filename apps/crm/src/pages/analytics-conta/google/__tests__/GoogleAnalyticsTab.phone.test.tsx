import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  daily,
  distribution,
  keywords,
  MOEMA,
  overview,
  registerGoogleI18n,
  review,
  surfaces,
  twoUnits,
} from './fixtures';

// Below 768px: the tab renders its phone variant.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('chart.js', () => ({
  Chart: class {
    static register = vi.fn();
    destroy = vi.fn();
  },
  registerables: [],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../../../../services/gbpAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/gbpAnalytics')>()),
  getGbpOverview: vi.fn(),
  getGbpDaily: vi.fn(),
  getGbpSurfaces: vi.fn(),
  getGbpKeywords: vi.fn(),
  getGbpReviews: vi.fn(),
  getGbpRatingDistribution: vi.fn(),
  getGbpUnits: vi.fn(),
}));
vi.mock('../../../../services/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/google')>()),
  syncGoogleProduct: vi.fn(),
}));

import {
  GbpNotConnectedError,
  getGbpDaily,
  getGbpKeywords,
  getGbpOverview,
  getGbpRatingDistribution,
  getGbpReviews,
  getGbpSurfaces,
  getGbpUnits,
} from '../../../../services/gbpAnalytics';
import { syncGoogleProduct } from '../../../../services/google';
import { GoogleAnalyticsTab } from '../GoogleAnalyticsTab';

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GoogleAnalyticsTab
          clientId={12}
          phoneFrame={{
            nome: 'Clínica Sorriso Pleno',
            cor: null,
            photo: [],
            tabs: <div data-testid="shell-tabs" />,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeAll(registerGoogleI18n);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGbpOverview).mockResolvedValue(overview());
  vi.mocked(getGbpDaily).mockResolvedValue(daily());
  vi.mocked(getGbpSurfaces).mockResolvedValue(surfaces());
  vi.mocked(getGbpKeywords).mockResolvedValue(keywords());
  vi.mocked(getGbpReviews).mockResolvedValue([
    review('Mariana Lopes'),
    review('Evil', { unitMapsUri: 'javascript:alert(1)', hasReply: false }),
  ]);
  vi.mocked(getGbpRatingDistribution).mockResolvedValue(distribution());
  vi.mocked(getGbpUnits).mockResolvedValue(twoUnits());
});

describe('GoogleAnalyticsTab (phone)', () => {
  it('renders the phone frame with the KPI tiles and the sections', async () => {
    const { container } = renderTab();
    await screen.findByText('Visualizações do perfil');
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Clínica Sorriso Pleno');
    expect(screen.getByTestId('shell-tabs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sincronizar' })).toBeInTheDocument();
    expect(container.querySelectorAll('.phone-stat-tile')).toHaveLength(8);
    expect(container.querySelector('.kpi-grid')).toBeNull();
    expect(container.querySelector('.data-table')).toBeNull();
    expect(container.querySelector('.page-tabs')).toBeNull();
    expect(await screen.findByRole('heading', { level: 2, name: 'Ações por dia' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Avaliações recentes' })).toBeTruthy();
    expect(await screen.findByText('menos de 15')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('—');
  });

  it('period and unit controls refetch', async () => {
    renderTab();
    await screen.findByText('Visualizações do perfil');
    const period = screen.getByRole('radiogroup', { name: 'Período' });
    expect(within(period).getByRole('radio', { name: '30d' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(period).getByRole('radio', { name: '7d' }));
    await waitFor(() => expect(getGbpOverview).toHaveBeenLastCalledWith(12, { days: 7 }, 'all'));

    const unitSelect = await screen.findByRole('combobox', { name: 'Unidade' });
    fireEvent.change(unitSelect, { target: { value: MOEMA } });
    await waitFor(() => expect(getGbpOverview).toHaveBeenLastCalledWith(12, { days: 7 }, MOEMA));
  });

  it('review links are sanitized and the filter refetches', async () => {
    renderTab();
    const evil = await screen.findByText('Evil');
    const row = evil.closest('[data-review]') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Abrir no Google' })).toHaveAttribute('href', '#');
    const filter = screen.getByRole('radiogroup', { name: 'Filtro de avaliações' });
    fireEvent.click(within(filter).getByRole('radio', { name: 'Sem resposta' }));
    await waitFor(() => expect(getGbpReviews).toHaveBeenLastCalledWith(12, 'unanswered', 'all'));
  });

  it('not connected keeps the frame and links to Redes sociais', async () => {
    vi.mocked(getGbpOverview).mockRejectedValue(new GbpNotConnectedError());
    renderTab();
    expect(await screen.findByText('Google Meu Negócio não conectado')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Clínica Sorriso Pleno');
    expect(screen.getByRole('link', { name: 'Ir para Redes sociais' })).toHaveAttribute(
      'href',
      '/clientes/12/redes-sociais',
    );
  });

  it('the sync button calls syncGoogleProduct', async () => {
    vi.mocked(syncGoogleProduct).mockResolvedValue();
    renderTab();
    await screen.findByText('Visualizações do perfil');
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));
    await waitFor(() => expect(syncGoogleProduct).toHaveBeenCalledWith('gbp', 12));
  });
});
