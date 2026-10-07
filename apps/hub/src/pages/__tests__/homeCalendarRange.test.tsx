import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchPostsInRange: vi.fn(),
  fetchAgenda: vi.fn(),
  fetchAgendaPeriodo: vi.fn(),
  responderAgenda: vi.fn(),
  cancelarRemarcacao: vi.fn(),
  agendaIcsUrl: (token: string, id: number) =>
    `https://x.supabase.co/functions/v1/hub-agenda/ocorrencia/${id}.ics?token=${token}`,
}));
vi.mock('../../components/dashboard/DashboardSection', () => ({ DashboardSection: () => null }));
// The fake calendar exposes what Home passes and lets the test pick the shown month.
vi.mock('../../components/PostCalendar', () => ({
  PostCalendar: (props: {
    posts: Array<{ titulo: string }>;
    onMonthChange?: (y: number, m: number) => void;
    loading?: boolean;
    notice?: ReactNode;
    eventos?: Array<{ titulo: string }>;
    eventosErro?: boolean;
    onRetryEventos?: () => void;
    onEventoClick?: (item: unknown) => void;
  }) => (
    <div>
      <span>Cal: {props.posts.map((p) => p.titulo).join(', ')}</span>
      {props.eventos && <span>Ev: {props.eventos.map((e) => e.titulo).join(', ')}</span>}
      {props.eventosErro && <button onClick={() => props.onRetryEventos?.()}>erro-eventos</button>}
      {props.eventos?.[0] && (
        <button onClick={() => props.onEventoClick?.(props.eventos![0])}>abrir-evento</button>
      )}
      {props.loading && <span>carregando-mes</span>}
      {props.notice}
      <button onClick={() => props.onMonthChange?.(2025, 10)}>nov-2025</button>
      <button onClick={() => props.onMonthChange?.(2026, 8)}>set-2026</button>
    </div>
  ),
}));

import {
  fetchAgenda,
  fetchAgendaPeriodo,
  fetchPosts,
  fetchPostsInRange,
  responderAgenda,
} from '../../api';
import { localMonthRange } from '../../lib/postView';
import { HomePage } from '../HomePage';

const posts = vi.mocked(fetchPosts);
const range = vi.mocked(fetchPostsInRange);
const agenda = vi.mocked(fetchAgenda);
const periodo = vi.mocked(fetchAgendaPeriodo);
const responder = vi.mocked(responderAgenda);
const hubValue = {
  bootstrap: {
    workspace: { name: 'M', logo_url: '', brand_color: '#0f766e' },
    cliente_nome: 'Ana',
    cliente_foto_url: null,
    is_active: true,
    cliente_id: 14,
  },
  token: 'tk',
  workspace: 'mesaas',
} as never;

const p = (id: number, titulo: string, status = 'agendado') => ({
  id,
  titulo,
  status,
  scheduled_at: '2026-09-10T10:00:00.000Z',
});

function renderHome(value: unknown = hubValue) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={value as never}>
        <MemoryRouter initialEntries={['/mesaas/hub/tk']}>
          <Routes>
            <Route path="/:workspace/hub/:token/*" element={<HomePage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

describe('Home calendar range', () => {
  beforeEach(() => {
    posts.mockReset();
    range.mockReset();
  });

  it('fetches a month that starts before historyCutoff once, by its local bounds, and merges it', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: '2026-07-04T00:00:00.000Z',
      olderCursor: 'x|0',
    } as never);
    range.mockResolvedValue({
      posts: [p(2, 'Antigo', 'postado'), p(1, 'Recente')],
      postApprovals: [],
    } as never);
    renderHome();
    fireEvent.click(await screen.findByText('nov-2025'));
    expect(await screen.findByText('Cal: Recente, Antigo')).toBeInTheDocument();
    const { from, to } = localMonthRange(2025, 10);
    expect(range).toHaveBeenCalledTimes(1);
    expect(range).toHaveBeenCalledWith('tk', from, to);
  });

  it('does not fetch a month that starts after the cutoff', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: '2026-07-04T00:00:00.000Z',
    } as never);
    renderHome();
    fireEvent.click(await screen.findByText('set-2026'));
    await screen.findByText('Cal: Recente');
    expect(range).not.toHaveBeenCalled();
  });

  it('does not fetch any month when historyCutoff is null (or absent: old backend)', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: null,
    } as never);
    renderHome();
    fireEvent.click(await screen.findByText('nov-2025'));
    await screen.findByText('Cal: Recente');
    expect(range).not.toHaveBeenCalled();
  });

  it('shows the shell posts and a retry when a month fails', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: '2026-07-04T00:00:00.000Z',
    } as never);
    range.mockRejectedValue(new Error('x'));
    renderHome();
    fireEvent.click(await screen.findByText('nov-2025'));
    expect(
      await screen.findByText('Não foi possível carregar este mês.', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Cal: Recente')).toBeInTheDocument();
    range.mockResolvedValue({ posts: [p(2, 'Antigo', 'postado')], postApprovals: [] } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByText('Cal: Recente, Antigo')).toBeInTheDocument());
  });
});

describe('Home agenda block', () => {
  const comAgenda = {
    ...(hubValue as { bootstrap: object }),
    bootstrap: { ...(hubValue as { bootstrap: object }).bootstrap, feature_agenda: true },
  };
  const ev = (id: number, titulo: string, inicio: string, resposta: 'sim' | 'nao' | null) => ({
    ocorrencia_id: id,
    sequencia: 0,
    inicio,
    fim: new Date(Date.parse(inicio) + 3_600_000).toISOString(),
    dia_inteiro: false,
    data_inicio_local: inicio.slice(0, 10),
    data_fim_local: inicio.slice(0, 10),
    tz: 'America/Sao_Paulo',
    titulo,
    descricao: null,
    local: null,
    link_reuniao: null,
    resposta,
    remarcacao: null,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T15:00:00Z'));
    posts.mockReset();
    agenda.mockReset();
    posts.mockResolvedValue({ posts: [], postApprovals: [], historyCutoff: null } as never);
  });
  afterEach(() => vi.useRealTimers());

  it('is hidden and never fetches without feature_agenda', async () => {
    renderHome();
    await screen.findByText('Cal:');
    expect(screen.queryByText('Próximos eventos')).not.toBeInTheDocument();
    expect(agenda).not.toHaveBeenCalled();
  });

  it('shows up to 3 upcoming events, the Ver agenda link and the pending-answer notice', async () => {
    agenda.mockResolvedValue({
      itens: [
        ev(1, 'Passado', '2026-10-01T15:00:00Z', null),
        ev(2, 'Primeiro', '2026-10-08T15:00:00Z', null),
        ev(3, 'Segundo', '2026-10-09T15:00:00Z', 'sim'),
        ev(4, 'Terceiro', '2026-10-10T15:00:00Z', null),
        ev(5, 'Quarto', '2026-10-11T15:00:00Z', 'nao'),
      ],
      proximo: null,
    });
    renderHome(comAgenda);

    expect(await screen.findByText('Próximos eventos')).toBeInTheDocument();
    for (const titulo of ['Primeiro', 'Segundo', 'Terceiro']) {
      expect(screen.getByText(titulo)).toBeInTheDocument();
    }
    expect(screen.queryByText('Quarto')).not.toBeInTheDocument();
    expect(screen.queryByText('Passado')).not.toBeInTheDocument();
    expect(screen.getByText('Primeiro').closest('a')).toHaveAttribute(
      'href',
      '/mesaas/hub/tk/agenda?ocorrencia=2',
    );
    expect(screen.getByRole('link', { name: /Ver agenda/ })).toHaveAttribute(
      'href',
      '/mesaas/hub/tk/agenda',
    );
    expect(screen.getByText('Você tem 2 eventos aguardando sua resposta')).toBeInTheDocument();
  });

  it('renders nothing when there is no upcoming event', async () => {
    agenda.mockResolvedValue({
      itens: [ev(1, 'Passado', '2026-10-01T15:00:00Z', null)],
      proximo: null,
    });
    renderHome(comAgenda);
    await waitFor(() => expect(agenda).toHaveBeenCalled());
    await screen.findByText('Cal:');
    expect(screen.queryByText('Próximos eventos')).not.toBeInTheDocument();
    expect(screen.queryByText(/aguardando sua resposta/)).not.toBeInTheDocument();
  });
});

describe('Home calendar events', () => {
  const comAgenda = {
    ...(hubValue as { bootstrap: object }),
    bootstrap: { ...(hubValue as { bootstrap: object }).bootstrap, feature_agenda: true },
  };
  const ev = (over: Record<string, unknown> = {}) => ({
    ocorrencia_id: 7,
    sequencia: 1,
    inicio: '2026-09-15T17:00:00.000Z',
    fim: '2026-09-15T18:00:00.000Z',
    dia_inteiro: false,
    data_inicio_local: '2026-09-15',
    data_fim_local: '2026-09-15',
    tz: 'America/Sao_Paulo',
    titulo: 'Reunião de pauta',
    descricao: null,
    local: null,
    link_reuniao: null,
    resposta: null as 'sim' | 'nao' | null,
    remarcacao: null,
    ...over,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T15:00:00Z'));
    posts.mockReset();
    agenda.mockReset();
    periodo.mockReset();
    responder.mockReset();
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: '2026-07-04T00:00:00.000Z',
    } as never);
    agenda.mockResolvedValue({ itens: [], proximo: null });
  });
  afterEach(() => vi.useRealTimers());

  it('never asks for the month events without feature_agenda', async () => {
    renderHome();
    fireEvent.click(await screen.findByText('set-2026'));
    await screen.findByText('Cal: Recente');
    expect(periodo).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Ev:/)).not.toBeInTheDocument();
  });

  it('fetches the events of every month shown, also after historyCutoff, by its local bounds', async () => {
    periodo.mockImplementation(async () => ({ itens: [ev()] }) as never);
    renderHome(comAgenda);

    fireEvent.click(await screen.findByText('set-2026'));
    expect(await screen.findByText('Ev: Reunião de pauta')).toBeInTheDocument();
    const set = localMonthRange(2026, 8);
    expect(periodo).toHaveBeenCalledWith('tk', set.from, set.to);

    fireEvent.click(screen.getByText('nov-2025'));
    const nov = localMonthRange(2025, 10);
    await waitFor(() => expect(periodo).toHaveBeenCalledWith('tk', nov.from, nov.to));
  });

  it('keeps the posts and passes the error (with a working retry) when the events fail', async () => {
    periodo.mockRejectedValue(new Error('x'));
    renderHome(comAgenda);
    fireEvent.click(await screen.findByText('set-2026'));
    const retry = await screen.findByText('erro-eventos', {}, { timeout: 3000 });
    expect(screen.getByText('Cal: Recente')).toBeInTheDocument();

    periodo.mockResolvedValue({ itens: [ev()] } as never);
    fireEvent.click(retry);
    expect(await screen.findByText('Ev: Reunião de pauta')).toBeInTheDocument();
    expect(screen.queryByText('erro-eventos')).not.toBeInTheDocument();
  });

  it('opens the event card in a dialog; confirming answers and reloads the month', async () => {
    periodo.mockResolvedValueOnce({ itens: [ev()] } as never);
    periodo.mockResolvedValue({ itens: [ev({ resposta: 'sim' })] } as never);
    responder.mockResolvedValue({ item: ev({ resposta: 'sim' }) } as never);
    renderHome(comAgenda);

    fireEvent.click(await screen.findByText('set-2026'));
    fireEvent.click(await screen.findByText('abrir-evento'));

    const dialogo = await screen.findByRole('dialog');
    const cartao = within(dialogo).getByRole('article', { name: 'Reunião de pauta' });
    expect(within(cartao).getByText('Aguardando sua resposta')).toBeInTheDocument();

    fireEvent.click(within(cartao).getByRole('button', { name: /Confirmar/ }));
    await waitFor(() =>
      expect(responder).toHaveBeenCalledWith('tk', 7, 'sim', '2026-09-15T17:00:00.000Z'),
    );
    expect(await within(dialogo).findByText('Confirmado')).toBeInTheDocument();
    // The success path invalidates the month query under ['hub-agenda', token]: it refetches.
    await waitFor(() => expect(periodo).toHaveBeenCalledTimes(2));

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
