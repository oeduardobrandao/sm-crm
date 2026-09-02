import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-chartjs-2', () => ({
  Chart: ({ data, 'aria-label': ariaLabel }: any) => (
    <div
      data-testid="ritmo-chart"
      aria-label={ariaLabel}
      data-labels={JSON.stringify(data.labels)}
      data-series={JSON.stringify(data.datasets.map((d: any) => [d.label, ...d.data]))}
    />
  ),
}));

vi.mock('@/services/workflowAnalytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/workflowAnalytics')>(
    '@/services/workflowAnalytics',
  );
  return { ...actual, getWorkflowAnalytics: vi.fn() };
});

vi.mock('../../../store', () => ({
  getClientes: vi.fn(),
  getWorkflowTemplates: vi.fn(),
  getMembros: vi.fn(),
}));

vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  const SelectContext = ReactModule.createContext<{ onValueChange?: (v: string) => void }>({});

  return {
    Select: ({ onValueChange, children }: any) => (
      <SelectContext.Provider value={{ onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children, ...props }: any) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ value, children }: any) => {
      const { onValueChange } = ReactModule.useContext(SelectContext);
      return (
        <button type="button" onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

import AnalyticsFluxosPage from '../AnalyticsFluxosPage';
import { getWorkflowAnalytics, NotEntitledError } from '@/services/workflowAnalytics';
import type { WorkflowAnalytics } from '@/services/workflowAnalytics';
import { getClientes, getMembros, getWorkflowTemplates } from '../../../store';

const mockedAnalytics = vi.mocked(getWorkflowAnalytics);
const mockedClientes = vi.mocked(getClientes);
const mockedTemplates = vi.mocked(getWorkflowTemplates);
const mockedMembros = vi.mocked(getMembros);

function payload(overrides: Partial<WorkflowAnalytics> = {}): WorkflowAnalytics {
  return {
    kpis: {
      concluidos: 4,
      concluidos_prev: 3,
      ativos: 35,
      tempo_medio_dias: 5.75,
      tempo_medio_prev: 6.5,
      pontualidade_pct: 61,
      pontualidade_prev: 69,
      etapas_avaliadas: 43,
    },
    etapas: [
      { nome: 'Copy', media_dias: 5, amostras: 24, atraso_pct: 62 },
      { nome: 'Captação', media_dias: 2.2, amostras: 12, atraso_pct: 8 },
    ],
    semanas: [{ semana: '2026-08-04', concluidos: 2, criados: 3 }],
    semanas_criados_sem_conclusao: [{ semana: '2026-08-11', criados: 5 }],
    equipe: [
      { membro_id: 7, concluidas: 18, media_dias: 2.1, no_prazo: 15, atrasadas: 3, avaliadas: 18 },
      { membro_id: 8, concluidas: 2, media_dias: 1.9, no_prazo: 2, atrasadas: 0, avaliadas: 2 },
    ],
    ...overrides,
  };
}

/** Renders the page under a fresh query client and router, exposing the URL. */
function renderPage(initialEntry = '/analytics-fluxos') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const seen = { search: '' };

  function LocationProbe() {
    seen.search = useLocation().search;
    return null;
  }

  // A function, not a constant element: React bails out of re-rendering when it
  // is handed the very same element reference, which would make `rerenderSame`
  // a no-op.
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AnalyticsFluxosPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );

  const utils = render(tree());
  return {
    ...utils,
    seen,
    client,
    /** Re-renders the same tree, without remounting it. */
    rerenderSame: () => utils.rerender(tree()),
    analyticsKeys: () =>
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey)
        .filter((key) => key[0] === 'workflow-analytics'),
  };
}

/** Today as the page's anchor day format ('YYYY-MM-DD', local). */
function anchorHoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** The KPI card carrying `label`. Scoped to `.kpi-label`: several of these
 *  words also appear as table column headers. */
function kpiCard(label: string): HTMLElement {
  const el = screen
    .getAllByText(label)
    .find((node) => node.classList.contains('kpi-label'))
    ?.closest('.kpi-card');
  if (!el) throw new Error(`KPI card "${label}" não encontrado`);
  return el as HTMLElement;
}

function delta(card: HTMLElement) {
  return card.querySelector('.kpi-delta');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAnalytics.mockResolvedValue(payload());
  mockedClientes.mockResolvedValue([{ id: 1, nome: 'Cliente A' } as never]);
  mockedTemplates.mockResolvedValue([{ id: 10, nome: 'Template A' } as never]);
  mockedMembros.mockResolvedValue([
    { id: 7, nome: 'Ana', avatar_url: '' } as never,
    { id: 8, nome: 'Pedro', avatar_url: '' } as never,
  ]);
});

describe('AnalyticsFluxosPage', () => {
  it('sets the document title', async () => {
    renderPage();
    await screen.findByTestId('ritmo-chart');

    expect(document.title).toBe('Analytics de Fluxos | Mesaas');
  });

  it('renders the KPI row with deltas computed against the previous window', async () => {
    renderPage();
    await screen.findByTestId('ritmo-chart');

    const concluidos = kpiCard('Concluídos');
    expect(within(concluidos).getByText('4')).toBeTruthy();
    expect(delta(concluidos)?.getAttribute('data-direction')).toBe('up');
    // More finished flows is good news, so an up arrow reads as good.
    expect(delta(concluidos)?.getAttribute('data-good')).toBe('true');
    expect(within(concluidos).getByText('33.3%')).toBeTruthy();

    const pontualidade = kpiCard('Pontualidade');
    expect(within(pontualidade).getByText('61%')).toBeTruthy();
    expect(delta(pontualidade)?.getAttribute('data-direction')).toBe('down');
    expect(delta(pontualidade)?.getAttribute('data-good')).toBe('false');
  });

  it('flips the verdict on tempo médio: falling is the good direction', async () => {
    renderPage();
    await screen.findByTestId('ritmo-chart');

    const tempo = kpiCard('Tempo médio');
    expect(within(tempo).getByText('5d 18h')).toBeTruthy();
    expect(delta(tempo)?.getAttribute('data-direction')).toBe('down');
    expect(delta(tempo)?.getAttribute('data-good')).toBe('true');
  });

  it('gives "Ativos agora" no delta, only the snapshot caption', async () => {
    renderPage();
    await screen.findByTestId('ritmo-chart');

    const ativos = kpiCard('Ativos agora');
    expect(within(ativos).getByText('35')).toBeTruthy();
    expect(delta(ativos)).toBeNull();
    expect(within(ativos).getByText('retrato atual')).toBeTruthy();
  });

  it('suppresses the delta when the previous window has no data', async () => {
    mockedAnalytics.mockResolvedValue(
      payload({
        kpis: {
          concluidos: 4,
          concluidos_prev: 0,
          ativos: 35,
          tempo_medio_dias: 5.75,
          tempo_medio_prev: null,
          pontualidade_pct: null,
          pontualidade_prev: null,
          etapas_avaliadas: 0,
        },
      }),
    );
    renderPage();
    await screen.findByTestId('ritmo-chart');

    expect(delta(kpiCard('Concluídos'))).toBeNull();
    expect(within(kpiCard('Concluídos')).getByText('sem base de comparação')).toBeTruthy();
    expect(within(kpiCard('Pontualidade')).getByText('Sem dados')).toBeTruthy();
    expect(within(kpiCard('Pontualidade')).getByText('nenhuma etapa avaliada')).toBeTruthy();
  });

  it('marks a member with fewer than three rated etapas as "Poucos dados"', async () => {
    renderPage();
    await screen.findByTestId('ritmo-chart');

    // Ana has 18 rated etapas: a real percentage. Pedro has 2: not a verdict.
    expect(screen.getAllByText('83%').length).toBeGreaterThan(0);
    const poucos = screen.getAllByText('Poucos dados');
    expect(poucos.length).toBeGreaterThan(0);
    expect(poucos[0].getAttribute('data-tooltip')).toBe('Menos de 3 etapas avaliadas no período');
  });

  it('names an unresolved membro instead of leaking the id', async () => {
    mockedMembros.mockResolvedValue([{ id: 7, nome: 'Ana', avatar_url: '' } as never]);
    renderPage();
    await screen.findByTestId('ritmo-chart');

    expect(screen.getAllByText('Membro removido').length).toBeGreaterThan(0);
  });

  it('plots the union of concluded and created-only weeks, ordered by week', async () => {
    renderPage();
    const chart = await screen.findByTestId('ritmo-chart');

    expect(JSON.parse(chart.getAttribute('data-labels') ?? '[]')).toEqual(['04/08', '11/08']);
    expect(JSON.parse(chart.getAttribute('data-series') ?? '[]')).toEqual([
      ['Concluídos', 2, 0],
      ['Criados', 3, 5],
    ]);
  });

  it('caps the gargalos table at ten rows behind a toggle', async () => {
    mockedAnalytics.mockResolvedValue(
      payload({
        etapas: Array.from({ length: 12 }, (_, i) => ({
          nome: `Etapa ${i + 1}`,
          media_dias: 12 - i,
          amostras: 3,
          atraso_pct: 10,
        })),
      }),
    );
    renderPage();
    await screen.findByTestId('ritmo-chart');

    expect(screen.queryAllByText('Etapa 11').length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Mostrar todas as etapas/ }));
    expect(screen.getAllByText('Etapa 11').length).toBeGreaterThan(0);
  });

  it('writes the period to the URL and refires the query with a new window', async () => {
    const { seen } = renderPage();
    await screen.findByTestId('ritmo-chart');

    const firstCall = mockedAnalytics.mock.calls[0][0];
    expect(Math.round((firstCall.to.getTime() - firstCall.from.getTime()) / 86400000)).toBe(30);

    fireEvent.click(screen.getByRole('tab', { name: '7d' }));

    await waitFor(() => expect(mockedAnalytics.mock.calls.length).toBeGreaterThan(1));
    expect(seen.search).toBe('?periodo=7d');
    const lastCall = mockedAnalytics.mock.calls.at(-1)![0];
    expect(Math.round((lastCall.to.getTime() - lastCall.from.getTime()) / 86400000)).toBe(7);
    expect(screen.getByRole('tab', { name: '7d' }).getAttribute('aria-selected')).toBe('true');
  });

  it('keys the query by the anchor day and keeps it stable within the day', async () => {
    const { analyticsKeys, rerenderSame } = renderPage();
    await screen.findByTestId('ritmo-chart');

    expect(analyticsKeys()).toEqual([['workflow-analytics', '30d', null, null, anchorHoje()]]);

    rerenderSame();
    // Still one key, still one fetch: a plain rerender must not churn the cache.
    expect(analyticsKeys()).toHaveLength(1);
    expect(mockedAnalytics.mock.calls.length).toBe(1);
  });

  it('rolls the query key over at midnight with no interaction at all', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 2, 23, 59, 0));
    try {
      const { analyticsKeys } = renderPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(analyticsKeys()).toEqual([['workflow-analytics', '30d', null, null, '2026-09-02']]);
      expect(mockedAnalytics.mock.calls).toHaveLength(1);

      // Two regressions in one: the window used to re-anchor while the key did
      // not (React Query never refetches on a changed queryFn closure alone),
      // and the anchor itself only moved when something else forced a render.
      // Here nothing touches the page. Only the clock moves.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });

      expect(mockedAnalytics.mock.calls).toHaveLength(2);
      expect(analyticsKeys().map((key) => key[4])).toContain('2026-09-03');
      const janela = mockedAnalytics.mock.calls.at(-1)![0];
      expect(janela.to.getDate()).toBe(3);
      // keepPreviousData carries yesterday's numbers across the swap: no skeleton.
      expect(screen.getByTestId('ritmo-chart')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes the cliente filter through to the RPC', async () => {
    const { seen } = renderPage();
    await screen.findByTestId('ritmo-chart');

    fireEvent.click(screen.getByRole('button', { name: 'Cliente A' }));

    await waitFor(() => expect(mockedAnalytics.mock.calls.at(-1)![0].clienteId).toBe(1));
    expect(seen.search).toBe('?cliente=1');
  });

  it('says the filter matched nothing instead of pretending the workspace is empty', async () => {
    mockedAnalytics.mockResolvedValue(
      payload({
        kpis: {
          concluidos: 0,
          concluidos_prev: 0,
          ativos: 0,
          tempo_medio_dias: null,
          tempo_medio_prev: null,
          pontualidade_pct: null,
          pontualidade_prev: null,
          etapas_avaliadas: 0,
        },
      }),
    );
    renderPage('/analytics-fluxos?cliente=1');
    await screen.findByTestId('ritmo-chart');

    expect(screen.getAllByText('nenhum fluxo no filtro').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Crie fluxos de trabalho/)).toBeNull();
  });

  it('shows the onboarding empty state for a workspace with no flows at all', async () => {
    mockedAnalytics.mockResolvedValue(
      payload({
        kpis: {
          concluidos: 0,
          concluidos_prev: 0,
          ativos: 0,
          tempo_medio_dias: null,
          tempo_medio_prev: null,
          pontualidade_pct: null,
          pontualidade_prev: null,
          etapas_avaliadas: 0,
        },
      }),
    );
    renderPage();

    expect(await screen.findByText(/Crie fluxos de trabalho/)).toBeTruthy();
  });

  it('shows QueryErrorCard on failure and recovers on retry', async () => {
    mockedAnalytics.mockRejectedValueOnce(new Error('network down'));
    renderPage();

    expect(await screen.findByText('Não foi possível carregar os dados.')).toBeTruthy();

    mockedAnalytics.mockResolvedValue(payload());
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await screen.findByTestId('ritmo-chart');
    expect(screen.queryByText('Não foi possível carregar os dados.')).toBeNull();
  });

  it('explains a plan gate instead of offering a pointless retry', async () => {
    mockedAnalytics.mockRejectedValue(new NotEntitledError());
    renderPage();

    expect(
      await screen.findByText('Analytics de Fluxos não está disponível no seu plano.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });
});
