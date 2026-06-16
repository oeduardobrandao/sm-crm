import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CalendarView } from '../CalendarView';

// Stub useScheduledPosts so tests don't hit real network / QueryClient internals
vi.mock('../../hooks/useScheduledPosts', () => ({
  useScheduledPosts: () => ({
    byDay: new Map(),
    igStatuses: new Map(),
    isLoading: false,
  }),
}));

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>{children}</QueryClientProvider>
  );
}

const defaultProps = {
  mode: 'entregas' as const,
  onModeChange: vi.fn(),
  openableWorkflowIds: new Set<number>(),
  onPostClick: vi.fn(),
};

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

function getDayCell(container: HTMLElement, day: number) {
  return Array.from(container.querySelectorAll('.calendar-day')).find(
    (node) => node.querySelector('.day-number')?.textContent === String(day),
  ) as HTMLElement | undefined;
}

describe('CalendarView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the empty state when there are no cards to schedule', () => {
    render(
      <Wrapper>
        <CalendarView cards={[]} onCardClick={vi.fn()} {...defaultProps} />
      </Wrapper>,
    );

    expect(screen.getByText('Nenhuma entrega encontrada. Ajuste os filtros.')).toBeInTheDocument();
  });

  it('shows current-day events, lets the user switch days, and opens a scheduled card', () => {
    const onCardClick = vi.fn();
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
      allEtapas: [
        {
          id: 21,
          nome: 'Roteiro',
          ordem: 0,
          iniciado_em: '2026-04-14T12:00:00.000Z',
          prazo_dias: 3,
          tipo_prazo: 'corridos',
        },
      ],
    });

    const { container } = render(
      <Wrapper>
        <CalendarView
          cards={[cardToday, cardLater]}
          onCardClick={onCardClick}
          {...defaultProps}
        />
      </Wrapper>,
    );

    // MonthGrid renders month name via date-fns format (lowercase Portuguese) in a span.month-grid-title
    expect(document.querySelector('.month-grid-title')).toHaveTextContent(/abril/i);
    expect(screen.getByText('Fluxo Editorial')).toBeInTheDocument();
    expect(screen.getByText('⚑ PRAZO DA ETAPA')).toBeInTheDocument();

    fireEvent.click(getDayCell(container, 17)!);

    expect(screen.getByText('Fluxo Comercial')).toBeInTheDocument();
    expect(screen.getByText('◎ CONCLUSÃO PREVISTA')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Fluxo Comercial'));
    expect(onCardClick).toHaveBeenCalledWith(cardLater);
  });

  it('renders the Publicações panel in publicacoes mode and toggles back via the Entregas button', () => {
    const onModeChange = vi.fn();
    render(
      <Wrapper>
        <CalendarView
          cards={[]}
          onCardClick={vi.fn()}
          {...defaultProps}
          mode="publicacoes"
          onModeChange={onModeChange}
        />
      </Wrapper>,
    );

    // The PublicacoesPanel heading must be present
    expect(screen.getByRole('heading', { name: 'Publicações' })).toBeInTheDocument();

    // Clicking the "Entregas" toggle calls onModeChange with 'entregas'
    fireEvent.click(screen.getByRole('button', { name: 'Entregas' }));
    expect(onModeChange).toHaveBeenCalledWith('entregas');
  });

  it('changes month, clears the selected day, and waits for a new day selection', () => {
    const { container } = render(
      <Wrapper>
        <CalendarView cards={[makeCard()]} onCardClick={vi.fn()} {...defaultProps} />
      </Wrapper>,
    );

    // MonthGrid uses aria-label for navigation
    fireEvent.click(screen.getByLabelText('Próximo mês'));

    expect(document.querySelector('.month-grid-title')).toHaveTextContent(/maio/i);
    expect(screen.getByText('Selecione um dia.')).toBeInTheDocument();

    fireEvent.click(getDayCell(container, 1)!);
    expect(screen.getByText('Nenhuma entrega neste dia.')).toBeInTheDocument();
  });
});
