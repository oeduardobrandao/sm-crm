import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ChartView } from '../ChartView';
import { EMPTY_FILTERS, type FilterState } from '../../components/EntregasFilters';
import type { BoardCard } from '../../hooks/useEntregasData';

// jsdom's matchMedia reports false, so useIsDesktop() is false: the phone branch.
vi.mock('react-chartjs-2', () => ({ Bar: () => null, getElementAtEvent: () => [] }));

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
  const utils = render(
    <MemoryRouter>
      <ChartView {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

const tile = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^\\d+\\s*${label}$`) });

describe('ChartView (phone)', () => {
  it('renders the five KPIs as tiles that apply the desktop filters', () => {
    const { props } = renderView();
    expect(tile('Atrasadas')).toHaveTextContent('2');
    expect(tile('Urgentes \\(24h\\)')).toHaveTextContent('1');
    expect(tile('Em dia')).toHaveTextContent('1');
    expect(tile('Aguardando cliente')).toHaveTextContent('1');
    expect(tile('Vencem hoje')).toHaveTextContent('2');

    fireEvent.click(tile('Atrasadas'));
    expect(props.onFiltersChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTERS,
      filterStatus: ['atrasado'],
    });
    fireEvent.click(tile('Vencem hoje'));
    expect(props.onFiltersChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTERS,
      filterPrazo: ['hoje'],
    });
    fireEvent.click(tile('Aguardando cliente'));
    expect(props.onFiltersChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTERS,
      filterEtapas: ['Aprovação do cliente'],
    });
  });

  it('marks an applied KPI and clears it on a second tap', () => {
    const applied: FilterState = { ...EMPTY_FILTERS, filterStatus: ['atrasado'] };
    const { props } = renderView({ filters: applied });
    expect(tile('Atrasadas')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tile('Atrasadas'));
    expect(props.onFiltersChange).toHaveBeenCalledWith({ ...applied, filterStatus: [] });
  });

  it('keeps "Aguardando cliente" a plain number when nothing waits on the cliente', () => {
    renderView({ cards: [hojeCard, atrasadaCard] });
    expect(screen.queryByRole('button', { name: /Aguardando cliente/ })).not.toBeInTheDocument();
    expect(screen.getByText('Aguardando cliente')).toBeInTheDocument();
  });

  it('switches the vencimentos period and opens a fluxo from its row', () => {
    const { props } = renderView();
    const tabs = screen.getByRole('tablist', { name: 'Período dos vencimentos' });
    expect(within(tabs).getByRole('tab', { name: 'Hoje' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const panel = screen.getByRole('tabpanel');
    fireEvent.click(within(panel).getByRole('button', { name: /Carrossel de setembro/ }));
    expect(props.onCardClick).toHaveBeenCalledWith(hojeCard);

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Atrasadas' }));
    expect(
      within(screen.getByRole('tabpanel')).getByRole('button', { name: /Reels de bastidores/ }),
    ).toBeInTheDocument();
  });

  it('offers "+N · ver na lista" past the cap, with the desktop filter + view switch', () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      card({
        id: 100 + i,
        titulo: `Atrasado ${i}`,
        cliente: ACME,
        deadline: { estourado: true, diasRestantes: -2 },
      }),
    );
    const { props } = renderView({ cards: many });
    fireEvent.click(screen.getByRole('tab', { name: 'Atrasadas' }));
    fireEvent.click(screen.getByRole('button', { name: '+1 · ver na lista' }));
    expect(props.onFiltersChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      filterStatus: ['atrasado'],
      filterPrazo: [],
      filterPrazoFrom: '',
      filterPrazoTo: '',
    });
    expect(props.onGoToView).toHaveBeenCalledWith('list');
  });

  it('a cliente row opens a status choice that applies cliente + status', () => {
    const { props } = renderView();
    const section = screen.getByRole('list', { name: 'Situação por cliente' });
    fireEvent.click(within(section).getByRole('button', { name: /Beta Labs/ }));
    const sheet = screen.getByRole('dialog', { name: 'Beta Labs' });
    expect(within(sheet).queryByRole('button', { name: /Em dia/ })).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Atrasado · 2' }));
    expect(props.onFiltersChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      filterClientes: [2],
      filterStatus: ['atrasado'],
    });
  });

  it('a responsável row filters by membro + status; the "sem responsável" row is inert', () => {
    const { props } = renderView();
    const section = screen.getByRole('list', { name: 'Carga por responsável' });
    expect(within(section).queryByRole('button', { name: /Sem responsável/ })).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: /Ana/ }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Ana' })).getByRole('button', {
        name: 'Em dia · 1',
      }),
    );
    expect(props.onFiltersChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      filterMembros: [5],
      filterStatus: ['em_dia'],
    });
  });

  it('an etapa row filters by etapa and an aging row drills into its range', () => {
    const { props } = renderView();
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Fluxos por etapa' })).getByRole('button', {
        name: /Copy/,
      }),
    );
    expect(props.onFiltersChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTERS,
      filterEtapas: ['Copy'],
    });
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Idade dos atrasos' })).getByRole('button', {
        name: /2 a 3 dias/,
      }),
    );
    const last = props.onFiltersChange.mock.calls.at(-1)![0] as FilterState;
    expect(last.filterStatus).toEqual(['atrasado']);
    expect(last.filterPrazo).toEqual([]);
    expect(last.filterPrazoFrom).not.toBe('');
    expect(last.filterPrazoTo).not.toBe('');
  });

  it('shows one honest empty note, plus the "Somente fluxos" link with the flag', () => {
    const onGoToKanban = vi.fn();
    renderView({ cards: [], postProcessesEnabled: true, onGoToKanban });
    expect(screen.getByText('Nenhuma entrega encontrada. Ajuste os filtros.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'quadro' }));
    expect(onGoToKanban).toHaveBeenCalled();
  });
});
