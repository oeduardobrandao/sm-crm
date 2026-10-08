import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostCalendar } from '../PostCalendar';
import type { HubAgendaItem, HubPost } from '../../types';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'Post padrão',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo_plain: 'Conteúdo do post',
    scheduled_at: '2026-04-18T10:00:00.000Z',
    workflow_id: 42,
    workflow_titulo: 'Editorial',
    media: [],
    cover_media: null,
    ...overrides,
  };
}

function getDayButton(day: number) {
  const button = screen
    .getAllByRole('button')
    .find((candidate) => within(candidate).queryByText(String(day), { selector: 'div' }) !== null);

  if (!button) {
    throw new Error(`Could not find calendar day button for ${day}`);
  }

  return button;
}

describe('PostCalendar', () => {
  const originalTZ = process.env.TZ;

  beforeEach(() => {
    navigateMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTZ;
  });

  it('shows grouped posts for the current day, lets the user choose another day, and navigates to the post details', () => {
    vi.setSystemTime(new Date('2026-04-18T12:00:00.000Z'));

    render(
      <PostCalendar
        posts={[
          makePost({
            id: 1,
            titulo: 'Feed 1 do dia 18',
            tipo: 'feed',
            scheduled_at: '2026-04-18T10:00:00.000Z',
          }),
          makePost({
            id: 2,
            titulo: 'Feed 2 do dia 18',
            tipo: 'feed',
            scheduled_at: '2026-04-18T12:00:00.000Z',
          }),
          makePost({
            id: 3,
            titulo: 'Stories do dia 18',
            tipo: 'stories',
            scheduled_at: '2026-04-18T14:00:00.000Z',
          }),
          makePost({
            id: 4,
            titulo: 'Post do dia 20',
            tipo: 'reels',
            scheduled_at: '2026-04-20T09:00:00.000Z',
          }),
          makePost({
            id: 5,
            titulo: 'Post de maio',
            tipo: 'carrossel',
            scheduled_at: '2026-05-05T09:00:00.000Z',
          }),
        ]}
      />,
    );

    expect(screen.getByText('2 Imagem')).toBeInTheDocument();
    expect(screen.getByText('1 Stories')).toBeInTheDocument();
    expect(screen.getByText('18 de Abril, 2026')).toBeInTheDocument();
    expect(screen.getByText('Feed 1 do dia 18')).toBeInTheDocument();
    expect(screen.queryByText('Post do dia 20')).not.toBeInTheDocument();

    fireEvent.click(getDayButton(20));

    expect(screen.getByText('20 de Abril, 2026')).toBeInTheDocument();
    expect(screen.getByText('Post do dia 20')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Post do dia 20/i }));

    expect(navigateMock).toHaveBeenCalledWith('postagens/4');
  });

  it('moves between months across year boundaries and clears the selected day until another one is picked', () => {
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));

    render(
      <PostCalendar
        posts={[
          makePost({
            id: 11,
            titulo: 'Retrospectiva 2025',
            scheduled_at: '2025-12-12T15:00:00.000Z',
          }),
          makePost({
            id: 12,
            titulo: 'Campanha de fevereiro',
            scheduled_at: '2026-02-03T15:00:00.000Z',
          }),
        ]}
      />,
    );

    expect(screen.getByText('10 de Janeiro, 2026')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Mês anterior' })[0]);

    expect(screen.getAllByText(/Dezembro 2025/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Selecione um dia.')).toBeInTheDocument();

    fireEvent.click(getDayButton(12));

    expect(screen.getByText('12 de Dezembro, 2025')).toBeInTheDocument();
    expect(screen.getByText('Retrospectiva 2025')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Próximo mês' })[0]);

    expect(screen.getAllByText(/Janeiro 2026/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Selecione um dia.')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Próximo mês' })[0]);

    expect(screen.getAllByText(/Fevereiro 2026/).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(getDayButton(3));

    expect(screen.getByText('3 de Fevereiro, 2026')).toBeInTheDocument();
    expect(screen.getByText('Campanha de fevereiro')).toBeInTheDocument();
  });

  it('anchors "today" and the initially selected day to the viewer\'s LOCAL calendar day', () => {
    // Posts are bucketed by their local day (postsForDay), so "today" must be the local
    // date too: at 22:00 in UTC-3 it is still the 20th, even though UTC is already the 21st.
    process.env.TZ = 'America/Fortaleza'; // UTC-3
    vi.setSystemTime(new Date('2026-07-21T01:00:00.000Z')); // 2026-07-20 22:00 local

    render(
      <PostCalendar
        posts={[
          makePost({
            id: 21,
            titulo: 'Post da noite',
            scheduled_at: '2026-07-20T23:30:00.000Z', // 20:30 local, the 20th
          }),
        ]}
      />,
    );

    expect(screen.getByText('20 de Julho, 2026')).toBeInTheDocument();
    expect(screen.getByText('Post da noite')).toBeInTheDocument();
    expect(getDayButton(20)).toHaveAttribute('aria-current', 'date');
  });

  it('starts on the local day near midnight in UTC-3 (23:30 on the 7th is still the 7th)', () => {
    process.env.TZ = 'America/Sao_Paulo';
    vi.setSystemTime(new Date('2026-10-07T23:30:00-03:00'));
    render(<PostCalendar posts={[]} />);
    expect(screen.getByText('7 de Outubro, 2026')).toBeInTheDocument();
    expect(getDayButton(7)).toHaveAttribute('aria-current', 'date');
    expect(getDayButton(8)).not.toHaveAttribute('aria-current');
  });

  it('shows an em-produção post with the purple label instead of its internal status', () => {
    vi.setSystemTime(new Date('2026-04-18T12:00:00.000Z'));

    render(
      <PostCalendar
        posts={[
          makePost({
            id: 1,
            titulo: 'Em ajuste após aprovação',
            status: 'revisao_interna',
            em_producao: 'correcao',
            scheduled_at: '2026-04-18T10:00:00.000Z',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Em produção')).toBeInTheDocument();
    expect(screen.queryByText('Revisão interna')).not.toBeInTheDocument();
  });

  it('reports the shown month on mount and on navigation, and renders loading and notice', () => {
    vi.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));
    const onMonthChange = vi.fn();
    render(<PostCalendar posts={[]} onMonthChange={onMonthChange} loading notice={<p>aviso</p>} />);
    expect(onMonthChange).toHaveBeenLastCalledWith(2026, 3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Mês anterior' })[0]);
    expect(onMonthChange).toHaveBeenLastCalledWith(2026, 2);
    expect(screen.getByTestId('post-calendar-grid')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('aviso')).toBeInTheDocument();
  });

  describe('with Agenda events', () => {
    function evento(over: Partial<HubAgendaItem> = {}): HubAgendaItem {
      return {
        ocorrencia_id: 100,
        sequencia: 1,
        inicio: '2026-10-14T17:00:00.000Z',
        fim: '2026-10-14T18:00:00.000Z',
        dia_inteiro: false,
        data_inicio_local: '2026-10-14',
        data_fim_local: '2026-10-14',
        tz: 'America/Sao_Paulo',
        titulo: 'Reunião de pauta',
        descricao: null,
        local: null,
        link_reuniao: null,
        resposta: null,
        remarcacao: null,
        ...over,
      };
    }

    const pills = (day: number) => within(getDayButton(day)).getByTestId('post-calendar-pills');
    const dots = (day: number) => within(getDayButton(day)).getByTestId('post-calendar-dots');

    beforeEach(() => {
      process.env.TZ = 'America/Sao_Paulo';
      vi.setSystemTime(new Date('2026-10-07T15:00:00.000Z'));
    });

    it('places an all-day event on every day from data_inicio_local to data_fim_local (exclusive)', () => {
      const ev = evento({
        dia_inteiro: true,
        inicio: '2026-10-14T03:00:00.000Z',
        fim: '2026-10-17T03:00:00.000Z',
        data_inicio_local: '2026-10-14',
        data_fim_local: '2026-10-17',
      });
      render(<PostCalendar posts={[]} eventos={[ev]} />);
      for (const day of [14, 15, 16]) {
        expect(within(pills(day)).getByText('1 evento')).toBeInTheDocument();
      }
      expect(within(pills(13)).queryByText(/evento/)).not.toBeInTheDocument();
      expect(within(pills(17)).queryByText(/evento/)).not.toBeInTheDocument();
    });

    it("places a timed event on its local day in the event tz, not the viewer's", () => {
      // The viewer is in UTC; the event is 23:30 on the 20th in São Paulo (02:30Z on the 21st).
      process.env.TZ = 'UTC';
      const ev = evento({
        inicio: '2026-10-21T02:30:00.000Z',
        fim: '2026-10-21T03:30:00.000Z',
        data_inicio_local: '2026-10-20',
        data_fim_local: '2026-10-21',
      });
      render(<PostCalendar posts={[]} eventos={[ev]} />);
      expect(within(pills(20)).getByText('1 evento')).toBeInTheDocument();
      expect(within(pills(21)).queryByText(/evento/)).not.toBeInTheDocument();
    });

    it('puts the "N eventos" pill before the post pills (desktop) and the event dot first, max 3 (mobile)', () => {
      render(
        <PostCalendar
          posts={[
            makePost({ id: 1, tipo: 'feed', scheduled_at: '2026-10-14T13:00:00.000Z' }),
            makePost({ id: 2, tipo: 'reels', scheduled_at: '2026-10-14T14:00:00.000Z' }),
            makePost({ id: 3, tipo: 'stories', scheduled_at: '2026-10-14T15:00:00.000Z' }),
          ]}
          eventos={[evento({ ocorrencia_id: 1 }), evento({ ocorrencia_id: 2 })]}
        />,
      );
      const textos = Array.from(pills(14).children).map((c) => c.textContent);
      expect(textos).toEqual(['2 eventos', '1 Imagem', '1 Vídeo vertical', '1 Stories']);

      const pontos = Array.from(dots(14).children);
      expect(pontos).toHaveLength(3);
      expect(pontos[0]).toHaveAttribute('data-kind', 'evento');
      expect(pontos[1]).toHaveAttribute('data-kind', 'post');
    });

    it("lists the day's events above its posts in the side panel and opens one on click", () => {
      const onEventoClick = vi.fn();
      const ev = evento({ resposta: 'sim' });
      render(
        <PostCalendar
          posts={[
            makePost({ id: 9, titulo: 'Post do dia 14', scheduled_at: '2026-10-14T13:00:00.000Z' }),
          ]}
          eventos={[ev]}
          onEventoClick={onEventoClick}
        />,
      );
      fireEvent.click(getDayButton(14));

      const eventos = screen.getByRole('heading', { name: 'Eventos' });
      const posts = screen.getByRole('heading', { name: 'Posts' });
      expect(
        eventos.compareDocumentPosition(posts) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getByText('Post do dia 14')).toBeInTheDocument();

      const botao = screen.getByRole('button', { name: /Reunião de pauta/ });
      expect(within(botao).getByText('14:00')).toBeInTheDocument();
      expect(within(botao).getByText('Confirmado')).toBeInTheDocument();
      fireEvent.click(botao);
      expect(onEventoClick).toHaveBeenCalledWith(ev);
    });

    it('keeps the posts and offers a retry when the events failed to load', () => {
      const onRetryEventos = vi.fn();
      render(
        <PostCalendar
          posts={[
            makePost({ id: 9, titulo: 'Post de hoje', scheduled_at: '2026-10-07T13:00:00.000Z' }),
          ]}
          eventos={[]}
          eventosErro
          onRetryEventos={onRetryEventos}
        />,
      );
      expect(screen.getByText('Não foi possível carregar os eventos.')).toBeInTheDocument();
      expect(screen.getByText('Post de hoje')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
      expect(onRetryEventos).toHaveBeenCalledTimes(1);
    });

    it('shows no Eventos/Posts headings when the day has no event', () => {
      render(
        <PostCalendar
          posts={[
            makePost({ id: 9, titulo: 'Post de hoje', scheduled_at: '2026-10-07T13:00:00.000Z' }),
          ]}
          eventos={[evento()]}
        />,
      );
      expect(screen.queryByRole('heading', { name: 'Eventos' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Posts' })).not.toBeInTheDocument();
      expect(screen.getByText('Post de hoje')).toBeInTheDocument();
    });
  });
});
