import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChartView } from '../ChartView';
import { EMPTY_FILTERS, type FilterState } from '../../components/EntregasFilters';
import { matchesEtapaPrazo } from '../../etapaPrazo';
import type { BoardCard } from '../../hooks/useEntregasData';

vi.mock('react-chartjs-2', () => ({
  Bar: ({ data }: any) => <div data-testid="bar-chart" data-labels={JSON.stringify(data.labels)} />,
  getElementAtEvent: () => [],
}));

interface CardOverrides {
  id: number;
  titulo: string;
  cliente?: { id: number; nome: string };
  membro?: { id: number; nome: string };
  etapa?: Partial<BoardCard['etapa']>;
  deadline?: Partial<BoardCard['deadline']>;
}

function card(o: CardOverrides): BoardCard {
  return {
    workflow: { id: o.id, titulo: o.titulo, cliente_id: o.cliente?.id ?? null },
    etapa: {
      id: o.id,
      workflow_id: o.id,
      ordem: 0,
      nome: 'Design',
      prazo_dias: 2,
      tipo_prazo: 'corridos',
      tipo: 'padrao',
      status: 'ativo',
      ...o.etapa,
    },
    cliente: o.cliente,
    membro: o.membro,
    deadline: {
      diasRestantes: 3,
      horasRestantes: 0,
      estourado: false,
      urgente: false,
      ...o.deadline,
    },
    totalEtapas: 3,
    etapaIdx: 0,
    allEtapas: [],
  } as unknown as BoardCard;
}

function today(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

const ACME = { id: 1, nome: 'Acme' };
const BETA = { id: 2, nome: 'Beta Labs' };

const hojeCard = card({
  id: 10,
  titulo: 'Carrossel de setembro',
  cliente: ACME,
  membro: { id: 5, nome: 'Ana' },
  etapa: { nome: 'Design', data_limite: today() },
});
const atrasadaCard = card({
  id: 11,
  titulo: 'Reels de bastidores',
  cliente: BETA,
  etapa: { nome: 'Copy' },
  deadline: { estourado: true, diasRestantes: -3 },
});
const aguardandoCard = card({
  id: 12,
  titulo: 'Post institucional',
  cliente: ACME,
  etapa: { nome: 'Aprovação do cliente', tipo: 'aprovacao_cliente' },
  deadline: { urgente: true, diasRestantes: 0, horasRestantes: 6 },
});
/** Prazo é hoje e já estourou: entra no KPI "Vencem hoje", fora da aba Hoje. */
const estouradaHojeCard = card({
  id: 13,
  titulo: 'Stories da campanha',
  cliente: BETA,
  etapa: { nome: 'Agendamento', data_limite: today() },
  deadline: { estourado: true, diasRestantes: -1 },
});

const CARDS = [hojeCard, atrasadaCard, aguardandoCard, estouradaHojeCard];

function renderView(overrides: Partial<Parameters<typeof ChartView>[0]> = {}) {
  const props = {
    cards: CARDS,
    totalCards: 8,
    filters: EMPTY_FILTERS,
    onFiltersChange: vi.fn(),
    onCardClick: vi.fn(),
    onGoToView: vi.fn(),
    ...overrides,
  };
  const utils = render(<ChartView {...props} />);
  return { ...utils, props };
}

function kpiButton(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button.kpi-card')).find(
    (el) => el.querySelector('.kpi-label')?.textContent === label,
  );
  if (!found) throw new Error(`KPI "${label}" não encontrado`);
  return found as HTMLButtonElement;
}

function kpiValue(container: HTMLElement, label: string): string {
  return kpiButton(container, label).querySelector('.kpi-value')?.textContent ?? '';
}

describe('ChartView', () => {
  it('renders the five KPI cards with the counts of the filtered cards', () => {
    const { container } = renderView();

    expect(kpiValue(container, 'Atrasadas')).toBe('2');
    expect(kpiValue(container, 'Urgentes (24h)')).toBe('1');
    expect(kpiValue(container, 'Em dia')).toBe('1');
    expect(kpiValue(container, 'Aguardando cliente')).toBe('1');
    expect(screen.getAllByText('de 8 fluxos')).toHaveLength(5);
  });

  it('counts "Vencem hoje" with the same predicate its filter applies', () => {
    const { container, props } = renderView();
    // hojeCard + estouradaHojeCard: o filtro filterPrazo:['hoje'] pega os dois,
    // então o KPI também precisa pegar, mesmo com um deles já estourado.
    expect(kpiValue(container, 'Vencem hoje')).toBe('2');
    expect(CARDS.filter((c) => matchesEtapaPrazo(c, ['hoje'], '', '')).length).toBe(2);

    fireEvent.click(kpiButton(container, 'Vencem hoje'));
    expect(props.onFiltersChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      filterPrazo: ['hoje'],
    });
  });

  it('applies and clears the atrasado filter from the KPI card', () => {
    const { container, props } = renderView();
    fireEvent.click(kpiButton(container, 'Atrasadas'));
    expect(props.onFiltersChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      filterStatus: ['atrasado'],
    });

    const applied: FilterState = { ...EMPTY_FILTERS, filterStatus: ['atrasado'] };
    const onFiltersChange = vi.fn();
    const second = render(
      <ChartView
        cards={CARDS}
        totalCards={8}
        filters={applied}
        onFiltersChange={onFiltersChange}
        onCardClick={vi.fn()}
        onGoToView={vi.fn()}
      />,
    );
    const activeCard = kpiButton(second.container, 'Atrasadas');
    expect(activeCard.dataset.active).toBe('true');
    fireEvent.click(activeCard);
    expect(onFiltersChange).toHaveBeenCalledWith({ ...applied, filterStatus: [] });
  });

  it('patches filterEtapas with the aprovação do cliente etapas', () => {
    const { container, props } = renderView();
    fireEvent.click(kpiButton(container, 'Aguardando cliente'));
    expect(props.onFiltersChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      filterEtapas: ['Aprovação do cliente'],
    });
  });

  it('does not offer the aguardando cliente click when nothing waits on the cliente', () => {
    const applied: FilterState = { ...EMPTY_FILTERS, filterEtapas: ['Design'] };
    const { container } = renderView({ cards: [hojeCard, atrasadaCard], filters: applied });
    const kpi = Array.from(container.querySelectorAll('.kpi-card')).find(
      (el) => el.querySelector('.kpi-label')?.textContent === 'Aguardando cliente',
    );
    // A plain div, not a button: clicking would only wipe filterEtapas.
    expect(kpi?.tagName).toBe('DIV');
    expect(kpi?.querySelector('.kpi-value')?.textContent).toBe('0');
  });

  it('switches the upcoming tab and opens a fluxo from its chip', () => {
    const { props } = renderView();

    expect(screen.getByText('Carrossel de setembro')).toBeInTheDocument();
    expect(screen.queryByText('Reels de bastidores')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Atrasadas' }));
    expect(screen.getByText('Reels de bastidores')).toBeInTheDocument();
    expect(screen.queryByText('Carrossel de setembro')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Reels de bastidores'));
    expect(props.onCardClick).toHaveBeenCalledWith(atrasadaCard);
  });

  it('shows the celebratory empty state when nothing is overdue', () => {
    renderView({ cards: [hojeCard, aguardandoCard] });
    expect(screen.getByText('Nenhuma entrega atrasada')).toBeInTheDocument();
  });

  it('feeds the cliente chart with the cliente names, riskiest first', () => {
    renderView();
    const charts = screen.getAllByTestId('bar-chart');
    expect(JSON.parse(charts[0].getAttribute('data-labels') ?? '[]')).toEqual([
      'Beta Labs',
      'Acme',
    ]);
  });
});
