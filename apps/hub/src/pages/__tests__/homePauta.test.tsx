import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType, ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { i18n } from '@mesaas/i18n';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchPostsInRange: vi.fn(),
  fetchAgenda: vi.fn(),
  fetchAgendaPeriodo: vi.fn(),
  fetchDashboard: vi.fn(),
  responderAgenda: vi.fn(),
  cancelarRemarcacao: vi.fn(),
  agendaIcsUrl: (token: string, id: number) =>
    `https://x.supabase.co/functions/v1/hub-agenda/ocorrencia/${id}.ics?token=${token}`,
}));
vi.mock('../../components/dashboard/DashboardSection', () => ({ DashboardSection: () => null }));
vi.mock('../../components/PostCalendar', () => ({
  PostCalendar: (props: { posts: Array<{ titulo: string }>; notice?: ReactNode }) => (
    <div>
      <span>Cal: {props.posts.map((p) => p.titulo).join(', ')}</span>
      {props.notice}
    </div>
  ),
}));

import { fetchAgenda, fetchDashboard, fetchPosts } from '../../api';
import { HomePage } from '../HomePage';

const posts = vi.mocked(fetchPosts);
const agenda = vi.mocked(fetchAgenda);
const dashboard = vi.mocked(fetchDashboard);

const baseBootstrap = {
  workspace: { name: 'M', logo_url: '', brand_color: '#0f766e' },
  cliente_nome: 'Ana Souza',
  cliente_foto_url: null,
  is_active: true,
  cliente_id: 14,
};

/** Provider value with the Pauta flag on, plus any extra bootstrap flags. */
function hubValue(extra: Record<string, unknown> = {}) {
  return {
    bootstrap: { ...baseBootstrap, feature_hub_pauta: true, ...extra },
    token: 'tk',
    workspace: 'mesaas',
  };
}

function renderWithHub(ui: ReactNode, value: unknown = hubValue()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={value as never}>
        <MemoryRouter initialEntries={['/mesaas/hub/tk']}>
          <Routes>
            <Route path="/:workspace/hub/:token/*" element={ui} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

const renderHome = (value: unknown = hubValue()) => renderWithHub(<HomePage />, value);

const post = (id: number, titulo: string, status: string, scheduled_at: string | null = null) => ({
  id,
  titulo,
  status,
  scheduled_at,
  ordem: id,
  tipo: 'feed',
  media: [],
});

describe('Home, Pauta look', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 8, 9, 0)); // Thursday 09:00 local
    posts.mockReset();
    agenda.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Unmount first: a language change re-renders every mounted consumer outside act().
    cleanup();
    await i18n.changeLanguage('pt');
  });

  it('greets by the hour, without italics or emoji', async () => {
    posts.mockResolvedValue({ posts: [], historyCutoff: null } as never);
    renderHome();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bom dia, Ana.' }),
    ).toBeInTheDocument();
    expect(document.querySelector('em')).toBeNull();
    expect(screen.queryByText(/👋/)).toBeNull();
    expect(screen.getByText('Quinta, 8 de outubro')).toHaveClass('hub-eyebrow');
  });

  it('summary with both clauses and the review button', async () => {
    posts.mockResolvedValue({
      posts: [
        post(1, 'A', 'enviado_cliente'),
        post(2, 'B', 'enviado_cliente'),
        post(3, 'C', 'agendado', new Date(2026, 9, 9, 10).toISOString()),
      ],
      historyCutoff: null,
    } as never);
    renderHome();
    const p = await screen.findByText(/para aprovar e/);
    expect(p).toHaveTextContent('Você tem 2 posts para aprovar e 1 publicação saindo esta semana.');
    expect(screen.getByRole('button', { name: 'Revisar aprovações' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revisar agora' })).toBeInTheDocument();
    expect(screen.getByText('01 · Aprovações')).toBeInTheDocument();
    expect(screen.getByText('02 · Calendário')).toBeInTheDocument();
    expect(screen.getByText('03 · Recursos')).toBeInTheDocument();
    expect(screen.getByText('Esperando você')).toBeInTheDocument();
    const review = screen.getAllByRole('link', { name: /^Revisar: / });
    expect(review).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Revisar: A' })).toHaveAttribute(
      'href',
      '/mesaas/hub/tk/aprovacoes/1',
    );
    expect(screen.getByRole('link', { name: 'Revisar: B' })).toHaveAttribute(
      'href',
      '/mesaas/hub/tk/aprovacoes/2',
    );
    expect(screen.getByRole('link', { name: /Ver todas/ })).toHaveAttribute(
      'href',
      '/mesaas/hub/tk/aprovacoes',
    );
  });

  it('no pending: "Tudo em dia por aqui.", no Esperando você, calendar is 01', async () => {
    posts.mockResolvedValue({ posts: [], historyCutoff: null } as never);
    renderHome();
    expect(await screen.findByText('Tudo em dia por aqui.')).toBeInTheDocument();
    expect(screen.queryByText('Esperando você')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revisar aprovações' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revisar agora' })).toBeNull();
    expect(screen.getByText('01 · Calendário')).toBeInTheDocument();
    expect(screen.getByText('02 · Recursos')).toBeInTheDocument();
    expect(screen.queryByText(/· Agenda/)).toBeNull();
  });

  it('only this week: weekOnly summary, no review button', async () => {
    posts.mockResolvedValue({
      posts: [
        post(3, 'C', 'agendado', new Date(2026, 9, 9, 10).toISOString()),
        post(4, 'D', 'aprovado_cliente', new Date(2026, 9, 10, 10).toISOString()),
      ],
      historyCutoff: null,
    } as never);
    renderHome();
    expect(await screen.findByText(/saindo esta semana/)).toHaveTextContent(
      '2 publicações saindo esta semana.',
    );
    expect(screen.queryByRole('button', { name: 'Revisar aprovações' })).toBeNull();
  });

  it('with the agenda on: agenda card always present, empty state', async () => {
    posts.mockResolvedValue({ posts: [], historyCutoff: null } as never);
    agenda.mockResolvedValue({ itens: [], proximo: null } as never);
    renderHome(hubValue({ feature_agenda: true }));
    expect(await screen.findByText('02 · Agenda')).toBeInTheDocument();
    expect(await screen.findByText('Nenhum evento nos próximos dias')).toBeInTheDocument();
    expect(screen.getByText('03 · Recursos')).toBeInTheDocument();
  });

  it('agenda card lists upcoming events with the waiting notice', async () => {
    posts.mockResolvedValue({ posts: [], historyCutoff: null } as never);
    const evento = {
      ocorrencia_id: 7,
      sequencia: 1,
      titulo: 'Gravação no consultório',
      inicio: '2026-10-09T17:00:00.000Z',
      fim: '2026-10-09T18:00:00.000Z',
      dia_inteiro: false,
      data_inicio_local: '2026-10-09',
      data_fim_local: '2026-10-09',
      tz: 'America/Sao_Paulo',
      descricao: null,
      local: null,
      link_reuniao: null,
      resposta: null,
      remarcacao: null,
    };
    agenda.mockResolvedValue({ itens: [evento], proximo: null } as never);
    renderHome(hubValue({ feature_agenda: true }));
    const card = (await screen.findByText('02 · Agenda')).closest('section') as HTMLElement;
    expect(await within(card).findByText('Gravação no consultório')).toBeInTheDocument();
    expect(within(card).getByText('Você tem 1 evento aguardando sua resposta')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /Gravação no consultório/ })).toHaveAttribute(
      'href',
      '/mesaas/hub/tk/agenda?ocorrencia=7',
    );
  });

  it('agenda card shows an error line when the agenda fails to load', async () => {
    posts.mockResolvedValue({ posts: [], historyCutoff: null } as never);
    agenda.mockRejectedValue(new Error('boom'));
    renderHome(hubValue({ feature_agenda: true }));
    const card = (await screen.findByText('02 · Agenda')).closest('section') as HTMLElement;
    expect(await within(card).findByText('Erro ao carregar a agenda')).toBeInTheDocument();
    expect(within(card).queryByText('Nenhum evento nos próximos dias')).toBeNull();
    expect(within(card).getByRole('link', { name: /Ver agenda/ })).toBeInTheDocument();
  });

  it('waiting list is chronological, unscheduled last, capped at 3', async () => {
    posts.mockResolvedValue({
      posts: [
        post(1, 'Sem data', 'enviado_cliente'),
        post(2, 'Sexta', 'enviado_cliente', new Date(2026, 9, 16, 10).toISOString()),
        post(3, 'Sábado', 'enviado_cliente', new Date(2026, 9, 17, 10).toISOString()),
        post(4, 'Amanhã', 'enviado_cliente', new Date(2026, 9, 9, 10).toISOString()),
      ],
      historyCutoff: null,
    } as never);
    renderHome();
    const card = (await screen.findByText('01 · Aprovações')).closest('section') as HTMLElement;
    const hrefs = within(card)
      .getAllByRole('link', { name: /^Revisar: / })
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/mesaas/hub/tk/aprovacoes/4',
      '/mesaas/hub/tk/aprovacoes/2',
      '/mesaas/hub/tk/aprovacoes/3',
    ]);
  });

  it('agenda card shows a skeleton while the agenda loads', async () => {
    posts.mockResolvedValue({ posts: [], historyCutoff: null } as never);
    agenda.mockReturnValue(new Promise(() => {}) as never);
    renderHome(hubValue({ feature_agenda: true }));
    const card = (await screen.findByText('02 · Agenda')).closest('section') as HTMLElement;
    expect(card.querySelector('[data-testid="hub-skeleton"]')).not.toBeNull();
    expect(within(card).queryByText('Nenhum evento nos próximos dias')).toBeNull();
  });

  it('while posts load: skeleton, no numbered sections', async () => {
    posts.mockReturnValue(new Promise(() => {}) as never);
    renderHome();
    expect(await screen.findByTestId('pauta-home-loading')).toBeInTheDocument();
    expect(screen.getByTestId('pauta-summary-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/01 ·/)).toBeNull();
  });

  it('en summary renders through <Trans>', async () => {
    await i18n.changeLanguage('en');
    posts.mockResolvedValue({
      posts: [post(1, 'A', 'enviado_cliente')],
      historyCutoff: null,
    } as never);
    renderHome();
    expect(await screen.findByText(/to approve/)).toHaveTextContent('You have 1 post to approve.');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Good morning, Ana.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Thursday, October 8')).toBeInTheDocument();
  });

  it('classic look is unchanged without the flag', async () => {
    posts.mockResolvedValue({
      posts: [post(1, 'A', 'enviado_cliente')],
      historyCutoff: null,
    } as never);
    renderHome({ ...hubValue(), bootstrap: baseBootstrap });
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(document.querySelector('em')).not.toBeNull();
    expect(screen.queryByText(/01 ·/)).toBeNull();
    expect(screen.queryByTestId('pauta-summary-skeleton')).toBeNull();
  });
});

describe('DashboardSection sectionNumber', () => {
  let RealDashboard: ComponentType<{ sectionNumber?: number }>;

  beforeEach(async () => {
    dashboard.mockReset();
    dashboard.mockResolvedValue({
      account: { username: 'ana' },
      topPosts: [],
      followerHistory: [],
      reachHistory: [],
    } as never);
    ({ DashboardSection: RealDashboard } = await vi.importActual<
      typeof import('../../components/dashboard/DashboardSection')
    >('../../components/dashboard/DashboardSection'));
  });

  it('renders a numbered Results header when given a number', async () => {
    renderWithHub(<RealDashboard sectionNumber={5} />);
    expect(await screen.findByText('05 · Resultados')).toHaveClass('hub-eyebrow');
    expect(screen.getByRole('heading', { level: 2, name: 'Desempenho' })).toBeInTheDocument();
  });

  it('keeps the classic h2 header without a number', async () => {
    renderWithHub(<RealDashboard />);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Desempenho' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Resultados/)).toBeNull();
  });
});
