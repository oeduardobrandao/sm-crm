import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostCalendar } from '../PostCalendar';
import type { HubPost } from '../../types';

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
  const button = screen.getAllByRole('button').find((candidate) => (
    within(candidate).queryByText(String(day), { selector: 'div' }) !== null
  ));

  if (!button) {
    throw new Error(`Could not find calendar day button for ${day}`);
  }

  return button;
}

describe('PostCalendar', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows grouped posts for the current day, lets the user choose another day, and navigates to the post details', () => {
    vi.setSystemTime(new Date('2026-04-18T12:00:00.000Z'));

    render(
      <PostCalendar
        posts={[
          makePost({ id: 1, titulo: 'Feed 1 do dia 18', tipo: 'feed', scheduled_at: '2026-04-18T10:00:00.000Z' }),
          makePost({ id: 2, titulo: 'Feed 2 do dia 18', tipo: 'feed', scheduled_at: '2026-04-18T12:00:00.000Z' }),
          makePost({ id: 3, titulo: 'Stories do dia 18', tipo: 'stories', scheduled_at: '2026-04-18T14:00:00.000Z' }),
          makePost({ id: 4, titulo: 'Post do dia 20', tipo: 'reels', scheduled_at: '2026-04-20T09:00:00.000Z' }),
          makePost({ id: 5, titulo: 'Post de maio', tipo: 'carrossel', scheduled_at: '2026-05-05T09:00:00.000Z' }),
        ]}
      />,
    );

    expect(screen.getByText('2 Feed')).toBeInTheDocument();
    expect(screen.getByText('1 Stories')).toBeInTheDocument();
    expect(screen.getByText('18 de Abril, 2026')).toBeInTheDocument();
    expect(screen.getByText('Feed 1 do dia 18')).toBeInTheDocument();
    expect(screen.queryByText('Post do dia 20')).not.toBeInTheDocument();

    fireEvent.click(getDayButton(20));

    expect(screen.getByText('20 de Abril, 2026')).toBeInTheDocument();
    expect(screen.getByText('Post do dia 20')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Post do dia 20/i }));

    expect(navigateMock).toHaveBeenCalledWith('postagens?post=4');
  });

  it('moves between months across year boundaries and clears the selected day until another one is picked', () => {
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));

    render(
      <PostCalendar
        posts={[
          makePost({ id: 11, titulo: 'Retrospectiva 2025', scheduled_at: '2025-12-12T15:00:00.000Z' }),
          makePost({ id: 12, titulo: 'Campanha de fevereiro', scheduled_at: '2026-02-03T15:00:00.000Z' }),
        ]}
      />,
    );

    expect(screen.getByText('10 de Janeiro, 2026')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mês anterior' }));

    expect(screen.getAllByText(/Dezembro 2025/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Selecione um dia.')).toBeInTheDocument();

    fireEvent.click(getDayButton(12));

    expect(screen.getByText('12 de Dezembro, 2025')).toBeInTheDocument();
    expect(screen.getByText('Retrospectiva 2025')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));

    expect(screen.getAllByText(/Janeiro 2026/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Selecione um dia.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));

    expect(screen.getAllByText(/Fevereiro 2026/).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(getDayButton(3));

    expect(screen.getByText('3 de Fevereiro, 2026')).toBeInTheDocument();
    expect(screen.getByText('Campanha de fevereiro')).toBeInTheDocument();
  });
});
