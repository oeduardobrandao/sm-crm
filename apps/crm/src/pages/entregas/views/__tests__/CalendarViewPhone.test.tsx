import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ScheduledPost } from '@/store';

import { CalendarView } from '../CalendarView';

// jsdom's matchMedia reports false, so useIsDesktop() is false: the phone branch.

const scheduled = vi.hoisted(() => ({
  byDay: new Map<string, unknown[]>(),
  isLoading: false,
}));
vi.mock('../../hooks/useScheduledPosts', () => ({
  useScheduledPosts: () => ({
    byDay: scheduled.byDay,
    igStatuses: new Map(),
    isLoading: scheduled.isLoading,
  }),
}));
vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  const registry = buildStatusRegistry([]);
  return { useStatusRegistry: () => registry };
});
vi.mock('../../components/ScheduleButton', () => ({
  ScheduleButton: ({ post }: { post: { id: number } }) => (
    <button type="button">Agendar post {post.id}</button>
  ),
}));

function renderView(props: Partial<React.ComponentProps<typeof CalendarView>> = {}) {
  const all = {
    cards: [],
    onCardClick: vi.fn(),
    mode: 'entregas' as const,
    openableWorkflowIds: new Set<number>(),
    onPostClick: vi.fn(),
    ...props,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalendarView {...all} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return all;
}

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    workflow: {
      id: 1,
      titulo: 'Fluxo Editorial',
    },
    cliente: {
      id: 1,
      nome: 'Aurora',
      cor: '#0f766e',
    },
    etapa: {
      id: 11,
      nome: 'Briefing',
      ordem: 0,
      iniciado_em: '2026-04-12T12:00:00.000Z',
      prazo_dias: 3,
      tipo_prazo: 'corridos',
    },
    membro: {
      id: 7,
      nome: 'Ana',
    },
    deadline: {
      estourado: false,
      urgente: false,
      diasRestantes: 2,
      horasRestantes: 24,
    },
    totalEtapas: 2,
    etapaIdx: 0,
    allEtapas: [
      {
        id: 11,
        nome: 'Briefing',
        ordem: 0,
        iniciado_em: '2026-04-12T12:00:00.000Z',
        prazo_dias: 3,
        tipo_prazo: 'corridos',
      },
      {
        id: 12,
        nome: 'Entrega',
        ordem: 1,
        iniciado_em: null,
        prazo_dias: 2,
        tipo_prazo: 'corridos',
      },
    ],
    ...overrides,
  } as any;
}

function scheduledPost(over: Partial<ScheduledPost>): ScheduledPost {
  return {
    id: 1,
    workflow_id: null,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    workflow_titulo: null,
    titulo: 'Post',
    tipo: 'feed',
    status: 'agendado',
    custom_status_id: null,
    scheduled_at: new Date(2026, 3, 15, 9, 0).toISOString(),
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    publish_error_code: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    board_ordem: null,
    ...over,
  };
}

const day = (label: RegExp) => screen.getByRole('button', { name: label });

describe('CalendarView (phone)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 3, 15, 12, 0, 0));
    scheduled.byDay = new Map();
    scheduled.isLoading = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the empty state and the "Somente fluxos" link', () => {
    const onGoToKanban = vi.fn();
    renderView({ postProcessesEnabled: true, onGoToKanban });
    expect(screen.getByText('Nenhuma entrega encontrada. Ajuste os filtros.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'quadro' }));
    expect(onGoToKanban).toHaveBeenCalled();
  });

  it('marks deadline days, lists the selected day and opens the fluxo', () => {
    const cardToday = makeCard();
    const cardLater = makeCard({
      workflow: { id: 2, titulo: 'Fluxo Comercial' },
      etapa: {
        id: 21,
        nome: 'Roteiro',
        ordem: 0,
        iniciado_em: '2026-04-14T12:00:00.000Z',
        prazo_dias: 3,
        tipo_prazo: 'corridos',
      },
      allEtapas: [],
    });
    const props = renderView({ cards: [cardToday, cardLater] });
    expect(day(/^15 de abril, 1 prazo de etapa/)).toHaveAttribute('aria-pressed', 'true');
    const list = screen.getByRole('list', { name: /quarta-feira, 15 de abril/i });
    fireEvent.click(within(list).getByRole('button', { name: /Fluxo Editorial/ }));
    expect(props.onCardClick).toHaveBeenCalledWith(cardToday);

    fireEvent.click(day(/^17 de abril, 1 prazo de etapa/));
    const list17 = screen.getByRole('list', { name: /sexta-feira, 17 de abril/i });
    expect(within(list17).getByText('Fluxo Comercial')).toBeInTheDocument();
    expect(within(list17).getByText('Prazo da etapa')).toBeInTheDocument();
  });

  it('changes month, clears the selected day and asks for a new one', () => {
    renderView({ cards: [makeCard()] });
    fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));
    expect(screen.getByRole('heading', { name: 'maio 2026' })).toBeInTheDocument();
    expect(screen.getByText('Selecione um dia.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(screen.getByRole('heading', { name: 'abril 2026' })).toBeInTheDocument();
  });

  it('lists fluxos without a deadline behind a "Sem data" chip', () => {
    const undated = makeCard({
      workflow: { id: 3, titulo: 'Fluxo Parado' },
      etapa: { id: 31, nome: 'Copy', ordem: 0, iniciado_em: null, prazo_dias: 2 },
    });
    const props = renderView({ cards: [makeCard(), undated] });
    fireEvent.click(screen.getByRole('button', { name: /Sem data\s*1/ }));
    const sheet = screen.getByRole('dialog', { name: 'Sem data · 1' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Fluxo Parado/ }));
    expect(props.onCardClick).toHaveBeenCalledWith(undated);
  });

  it('publicações mode: dots per post, rows open only openable posts, inline actions kept', () => {
    scheduled.byDay = new Map([
      [
        '2026-3-15',
        [
          scheduledPost({ id: 1, titulo: 'Avulso aberto' }),
          scheduledPost({
            id: 2,
            titulo: 'De fluxo fechado',
            workflow_id: 99,
            scheduled_at: new Date(2026, 3, 15, 12, 30).toISOString(),
          }),
          scheduledPost({
            id: 3,
            titulo: 'Já postado',
            status: 'postado',
            instagram_permalink: 'https://www.instagram.com/p/abc/',
            scheduled_at: new Date(2026, 3, 15, 18, 0).toISOString(),
          }),
        ],
      ],
    ]);
    const props = renderView({ mode: 'publicacoes', cards: [makeCard()] });
    expect(screen.queryByRole('button', { name: /Sem data/ })).not.toBeInTheDocument();
    expect(day(/^15 de abril, 3 posts, 1 postado$/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /15 de abril/i });
    fireEvent.click(within(list).getByRole('button', { name: /09:00.*Avulso aberto/ }));
    expect(props.onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(within(list).queryByRole('button', { name: /De fluxo fechado/ })).toBeNull();
    expect(within(list).getByText('De fluxo fechado')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Agendar post 2' })).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: /Ver no Instagram/ })).toHaveAttribute(
      'href',
      'https://www.instagram.com/p/abc/',
    );
  });
});
