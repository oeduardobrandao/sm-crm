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
  PINHEIROS,
  registerGoogleI18n,
  review,
  surfaces,
  twoUnits,
  unit,
} from './fixtures';

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('chart.js', () => ({
  Chart: class {
    static register = vi.fn();
    destroy = vi.fn();
  },
  registerables: [],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Keep the real error classes: the tab tells "not connected" apart with instanceof.
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

import { toast } from 'sonner';
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
import { GoogleServiceError, syncGoogleProduct } from '../../../../services/google';
import { GoogleAnalyticsTab } from '../GoogleAnalyticsTab';

let client: QueryClient;
function renderTab() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GoogleAnalyticsTab clientId={12} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const kpi = (label: string) =>
  screen.getByText(label, { selector: '.kpi-label' }).closest('.kpi-card') as HTMLElement;
const card = (title: string) =>
  screen.getByRole('heading', { name: title }).closest('.card') as HTMLElement;

beforeAll(registerGoogleI18n);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGbpOverview).mockResolvedValue(overview());
  vi.mocked(getGbpDaily).mockResolvedValue(daily());
  vi.mocked(getGbpSurfaces).mockResolvedValue(surfaces());
  vi.mocked(getGbpKeywords).mockResolvedValue(keywords());
  vi.mocked(getGbpReviews).mockResolvedValue([
    review('Mariana Lopes'),
    review('Carlos Henrique', { rating: 3, hasReply: false, unitTitle: 'Pinheiros' }),
  ]);
  vi.mocked(getGbpRatingDistribution).mockResolvedValue(distribution());
  vi.mocked(getGbpUnits).mockResolvedValue(twoUnits());
});

describe('GoogleAnalyticsTab', () => {
  it('renders the eight KPIs pt-BR formatted, with the data-through note', async () => {
    renderTab();
    await screen.findByText('Visualizações do perfil');
    expect(within(kpi('Visualizações do perfil')).getByText(/^24,8\smil$/)).toBeInTheDocument();
    expect(within(kpi('Pedidos de rota')).getByText('1.204')).toBeInTheDocument();
    expect(within(kpi('Ligações')).getByText('386')).toBeInTheDocument();
    expect(within(kpi('Nota média')).getByText('4,7')).toBeInTheDocument();
    expect(within(kpi('Nota média')).getByText('+0,1 vs. 30 dias anteriores')).toBeInTheDocument();
    expect(within(kpi('Novas avaliações')).getByText('23')).toBeInTheDocument();
    expect(within(kpi('Ligações')).getByText('vs. 30 dias anteriores')).toBeInTheDocument();
    const cards = Array.from(document.querySelectorAll('.kpi-card')).filter((c) => c.textContent);
    expect(cards).toHaveLength(8);
    expect(
      screen.getByText(
        'Dados até 27 de out. O Google conta pessoas diferentes por dia em cada superfície.',
      ),
    ).toBeInTheDocument();
    // Default period is 30 days, every unit.
    expect(getGbpOverview).toHaveBeenLastCalledWith(12, { days: 30 }, 'all');
  });

  it('renders the cards of board 4', async () => {
    renderTab();
    await screen.findByText('Visualizações do perfil');
    expect(await screen.findByRole('heading', { name: 'Ações por dia' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'Gráfico de barras empilhadas: ligações, rotas, cliques no site e mensagens por dia',
      }),
    ).toBeInTheDocument();
    const where = card('Onde viram o perfil');
    expect(await within(where).findByText('Pesquisa Google no celular')).toBeInTheDocument();
    expect(within(where).getByText('78% pelo celular. Maps responde por 41% das visualizações.'));
    const rating = card('Avaliações');
    expect(within(rating).getByText('440 avaliações')).toBeInTheDocument();
    expect(within(rating).getByText('+23 no período')).toBeInTheDocument();
    const units = card('Comparar unidades');
    expect(within(units).getByText('Moema')).toBeInTheDocument();
    expect(within(units).getByText('★ 4,8 (312)')).toBeInTheDocument();
  });

  it('a threshold keyword reads "menos de 15"', async () => {
    renderTab();
    const kw = await screen.findByRole('heading', { name: 'O que buscaram no Google' });
    const body = kw.closest('.card') as HTMLElement;
    expect(await within(body).findByText('menos de 15')).toBeInTheDocument();
    expect(within(body).getByText('1.240')).toBeInTheDocument();
    expect(within(body).getByText('Termos que mostraram o perfil · setembro')).toBeInTheDocument();
    fireEvent.click(within(body).getByRole('tab', { name: 'Ago.' }));
    await waitFor(() => expect(getGbpKeywords).toHaveBeenLastCalledWith(12, '2026-08', 'all'));
  });

  it('choosing a unit refetches every read with location=<uuid>', async () => {
    renderTab();
    const units = await screen.findByRole('tablist', { name: 'Unidade' });
    expect(within(units).getByRole('tab', { name: 'Todas as unidades (2)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(within(units).getByRole('tab', { name: 'Moema' }));
    await waitFor(() => expect(getGbpOverview).toHaveBeenLastCalledWith(12, { days: 30 }, MOEMA));
    await waitFor(() => expect(getGbpDaily).toHaveBeenLastCalledWith(12, { days: 30 }, MOEMA));
    await waitFor(() => expect(getGbpReviews).toHaveBeenLastCalledWith(12, 'all', MOEMA));
    await waitFor(() => expect(getGbpRatingDistribution).toHaveBeenLastCalledWith(12, MOEMA));
  });

  it('the unit control is hidden for one unit', async () => {
    vi.mocked(getGbpUnits).mockResolvedValue([unit(MOEMA, 'Moema')]);
    renderTab();
    await screen.findByText('Visualizações do perfil');
    await waitFor(() => expect(getGbpUnits).toHaveBeenCalled());
    await screen.findByRole('heading', { name: 'Avaliações recentes' });
    expect(screen.queryByRole('tablist', { name: 'Unidade' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Unidade' })).toBeNull();
  });

  it('more than four units become a select', async () => {
    vi.mocked(getGbpUnits).mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e'].map((s, i) =>
        unit(`${i}${i}${i}${i}${i}${i}${i}${i}-0000-4000-8000-000000000000`, `Unidade ${s}`),
      ),
    );
    renderTab();
    const select = await screen.findByRole('combobox', { name: 'Unidade' });
    expect(within(select).getByRole('option', { name: 'Todas as unidades (5)' })).toBeTruthy();
    fireEvent.change(select, { target: { value: '22222222-0000-4000-8000-000000000000' } });
    await waitFor(() =>
      expect(getGbpOverview).toHaveBeenLastCalledWith(
        12,
        { days: 30 },
        '22222222-0000-4000-8000-000000000000',
      ),
    );
  });

  it('the review filter "Sem resposta" refetches with unanswered', async () => {
    renderTab();
    const filter = await screen.findByRole('tablist', { name: 'Filtro de avaliações' });
    expect(getGbpReviews).toHaveBeenLastCalledWith(12, 'all', 'all');
    fireEvent.click(within(filter).getByRole('tab', { name: 'Sem resposta' }));
    await waitFor(() => expect(getGbpReviews).toHaveBeenLastCalledWith(12, 'unanswered', 'all'));
    fireEvent.click(within(filter).getByRole('tab', { name: '3 estrelas ou menos' }));
    await waitFor(() => expect(getGbpReviews).toHaveBeenLastCalledWith(12, 'low', 'all'));
  });

  it('review rows show status and stars, and links pass through sanitizeUrl', async () => {
    vi.mocked(getGbpReviews).mockResolvedValue([
      review('Mariana Lopes'),
      review('Evil', { unitMapsUri: 'javascript:alert(1)' }),
      review('Sem link', { unitMapsUri: null, hasReply: false, rating: 3 }),
    ]);
    renderTab();
    const list = (await screen.findByRole('heading', { name: 'Avaliações recentes' })).closest(
      '.card',
    ) as HTMLElement;
    const item = (name: string) =>
      within(list).getByText(name).closest('[data-review]') as HTMLElement;
    await within(list).findByText('Mariana Lopes');
    expect(
      within(item('Mariana Lopes')).getByRole('link', { name: 'Abrir no Google' }),
    ).toHaveAttribute('href', 'https://maps.google.com/?cid=123');
    expect(within(item('Evil')).getByRole('link', { name: 'Abrir no Google' })).toHaveAttribute(
      'href',
      '#',
    );
    expect(within(item('Sem link')).queryByRole('link')).toBeNull();
    expect(within(item('Sem link')).getByText('Sem resposta')).toBeInTheDocument();
    expect(within(item('Sem link')).getByLabelText('3 de 5 estrelas')).toBeInTheDocument();
    expect(within(item('Mariana Lopes')).getByText('Respondida')).toBeInTheDocument();
    expect(within(item('Mariana Lopes')).getByText(/^Moema · há 2 dias$/)).toBeInTheDocument();
  });

  it('the partial note appears when only part of the reviews is stored', async () => {
    vi.mocked(getGbpRatingDistribution).mockResolvedValue(
      distribution({ storedTotal: 200, total: 440, partial: true }),
    );
    renderTab();
    expect(await screen.findByText('Últimas 200 avaliações por unidade')).toBeInTheDocument();
  });

  it('no partial note when every review is stored', async () => {
    renderTab();
    await screen.findByText('440 avaliações');
    expect(screen.queryByText('Últimas 200 avaliações por unidade')).toBeNull();
  });

  it('not connected shows the connect card and fetches nothing else', async () => {
    vi.mocked(getGbpOverview).mockRejectedValue(new GbpNotConnectedError());
    renderTab();
    expect(await screen.findByText('Google Meu Negócio não conectado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para Redes sociais' })).toHaveAttribute(
      'href',
      '/clientes/12/redes-sociais',
    );
    expect(getGbpDaily).not.toHaveBeenCalled();
    expect(getGbpUnits).not.toHaveBeenCalled();
  });

  it('a plan without the flag shows the locked card', async () => {
    vi.mocked(getGbpOverview).mockRejectedValue(new Error('feature_disabled'));
    renderTab();
    expect(
      await screen.findByText(
        'Os números do Google Meu Negócio não estão disponíveis no seu plano.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver planos' })).toHaveAttribute(
      'href',
      '/configuracao/cobranca',
    );
  });

  it('an overview error shows a retry and keeps the period control', async () => {
    vi.mocked(getGbpOverview).mockRejectedValueOnce(new Error('Error 500'));
    renderTab();
    expect(
      await screen.findByText('Não foi possível carregar os dados do Google Meu Negócio.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Período' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Visualizações do perfil')).toBeInTheDocument();
  });

  it('before the first sync shows "Primeira sincronização em andamento"', async () => {
    vi.mocked(getGbpOverview).mockResolvedValue(overview({}, null));
    renderTab();
    expect(await screen.findByText('Primeira sincronização em andamento')).toBeInTheDocument();
    expect(screen.queryByText('Visualizações do perfil')).toBeNull();
  });

  it('a revoked unit shows the reconnect callout and its data still renders', async () => {
    vi.mocked(getGbpUnits).mockResolvedValue([
      unit(MOEMA, 'Moema'),
      unit(PINHEIROS, 'Pinheiros', { status: 'revoked' }),
    ]);
    renderTab();
    expect(
      await screen.findByText(
        'A autorização do Google expirou. Reconecte a conta para voltar a sincronizar.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Unidade com autorização expirada: Pinheiros')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reconectar' })).toHaveAttribute(
      'href',
      '/clientes/12/redes-sociais',
    );
    expect(screen.getByText('Visualizações do perfil')).toBeInTheDocument();
    expect(within(card('Comparar unidades')).getByText('Pinheiros')).toBeInTheDocument();
  });

  it('a unit that is gone (404) resets the selection to every unit', async () => {
    renderTab();
    const units = await screen.findByRole('tablist', { name: 'Unidade' });
    vi.mocked(getGbpOverview).mockImplementation(async (_id, _range, location) => {
      if (location === MOEMA) throw new Error('Error 404');
      return overview();
    });
    fireEvent.click(within(units).getByRole('tab', { name: 'Moema' }));
    await waitFor(() => expect(getGbpOverview).toHaveBeenCalledWith(12, { days: 30 }, MOEMA));
    await waitFor(() =>
      expect(
        within(screen.getByRole('tablist', { name: 'Unidade' })).getByRole('tab', {
          name: 'Todas as unidades (2)',
        }),
      ).toHaveAttribute('aria-selected', 'true'),
    );
    expect(screen.getByText('Visualizações do perfil')).toBeInTheDocument();
  });

  it('periods are 7, 30 and 90 days, and Personalizado sends a range ending on data-through', async () => {
    renderTab();
    const period = await screen.findByRole('tablist', { name: 'Período' });
    expect(
      within(period)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['7 dias', '30 dias', '90 dias', 'Personalizado']);
    fireEvent.click(within(period).getByRole('tab', { name: '90 dias' }));
    await waitFor(() => expect(getGbpOverview).toHaveBeenLastCalledWith(12, { days: 90 }, 'all'));
    fireEvent.click(within(period).getByRole('tab', { name: 'Personalizado' }));
    const input = screen.getByRole('spinbutton', { name: 'Período personalizado em dias' });
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(getGbpOverview).toHaveBeenLastCalledWith(
        12,
        { start: '2026-09-13', end: '2026-10-27' },
        'all',
      ),
    );
  });

  it('Sincronizar calls syncGoogleProduct and refetches the gbp queries', async () => {
    vi.mocked(syncGoogleProduct).mockResolvedValue();
    renderTab();
    await screen.findByText('Visualizações do perfil');
    await waitFor(() => expect(getGbpUnits).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));
    await waitFor(() => expect(syncGoogleProduct).toHaveBeenCalledWith('gbp', 12));
    await waitFor(() => expect(getGbpOverview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getGbpUnits).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalledWith('Dados do Google Meu Negócio atualizados.');
  });

  it('a rate-limited sync says so', async () => {
    vi.mocked(syncGoogleProduct).mockRejectedValue(new GoogleServiceError('rate_limited'));
    renderTab();
    await screen.findByText('Visualizações do perfil');
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Limite da API do Google atingido. Tente de novo em alguns minutos.',
      ),
    );
  });

  it('a failed card read shows a retry without hiding the rest', async () => {
    vi.mocked(getGbpSurfaces).mockRejectedValueOnce(new Error('Error 500'));
    renderTab();
    const where = (await screen.findByRole('heading', { name: 'Onde viram o perfil' })).closest(
      '.card',
    ) as HTMLElement;
    fireEvent.click(await within(where).findByRole('button', { name: 'Tentar novamente' }));
    expect(await within(where).findByText('Pesquisa Google no celular')).toBeInTheDocument();
    expect(screen.getByText('Visualizações do perfil')).toBeInTheDocument();
  });

  it('a null KPI reads "sem dados" and no em dash appears anywhere', async () => {
    vi.mocked(getGbpOverview).mockResolvedValue(
      overview({ avg_rating: { value: null, prev: null } }),
    );
    renderTab();
    await screen.findByText('Visualizações do perfil');
    expect(within(kpi('Nota média')).getByText('sem dados')).toBeInTheDocument();
    await screen.findByText('Mariana Lopes');
    expect(document.body.textContent).not.toContain('—');
  });
});
