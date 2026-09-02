import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Two charts on this page now, so the stub keys its testid off the aria-label
// rather than handing both the same one — `findByTestId` throws on duplicates,
// and every test below waits on the ritmo chart to know the page has settled.
vi.mock('react-chartjs-2', () => ({
  Chart: ({ data, 'aria-label': ariaLabel }: any) => (
    <div
      data-testid={/aprova/i.test(ariaLabel ?? '') ? 'aprovacao-chart' : 'ritmo-chart'}
      aria-label={ariaLabel}
      data-labels={JSON.stringify(data.labels)}
      data-series={JSON.stringify(data.datasets.map((d: any) => [d.label, ...d.data]))}
      data-colors={JSON.stringify(data.datasets.map((d: any) => d.backgroundColor))}
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

/** The five buckets the RPC always returns, in its fixed order. */
function buckets(quantidades: [number, number, number, number, number] = [9, 14, 11, 6, 3]) {
  return ['<4h', '4-24h', '1-3d', '3-7d', '7d+'].map((faixa, i) => ({
    faixa,
    quantidade: quantidades[i],
  }));
}

/** An approval block with nothing in it, for the sections that must vanish. */
function aprovacaoVazia(): WorkflowAnalytics['aprovacao_cliente'] {
  return {
    mediana_horas: null,
    amostras: 0,
    pendentes: 0,
    resolvidos_internamente: 0,
    buckets: buckets([0, 0, 0, 0, 0]),
    por_cliente: [],
    etapas: { amostras: 0, mediana_horas: null },
  };
}

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
      etapas_avaliadas_prev: 40,
      retrabalho_pct: 18,
      retrabalho_prev: 24,
    },
    etapas: [
      { nome: 'Copy', media_dias: 5, amostras: 24, atraso_pct: 62, retrabalho_pct: 21 },
      { nome: 'Captação', media_dias: 2.2, amostras: 12, atraso_pct: 8, retrabalho_pct: null },
    ],
    semanas: [{ semana: '2026-08-04', concluidos: 2, criados: 3 }],
    semanas_criados_sem_conclusao: [{ semana: '2026-08-11', criados: 5 }],
    equipe: [
      {
        membro_id: 7,
        concluidas: 18,
        media_dias: 2.1,
        no_prazo: 15,
        atrasadas: 3,
        avaliadas: 18,
        retrabalho: 2,
        atividade: 96,
      },
      {
        membro_id: 8,
        concluidas: 2,
        media_dias: 1.9,
        no_prazo: 2,
        atrasadas: 0,
        avaliadas: 2,
        retrabalho: 0,
        atividade: 12,
      },
    ],
    horizonte: {
      workflow_events_since: '2026-07-15T09:00:00+00:00',
      post_events_since: '2026-08-01T12:00:00+00:00',
    },
    aprovacao_cliente: {
      mediana_horas: 28,
      amostras: 43,
      pendentes: 5,
      resolvidos_internamente: 2,
      buckets: buckets(),
      por_cliente: [
        { cliente_id: 1, mediana_horas: 98, amostras: 8, pendentes: 1 },
        { cliente_id: 2, mediana_horas: 3.333, amostras: 10, pendentes: 0 },
        { cliente_id: 99, mediana_horas: 50, amostras: 4, pendentes: 0 },
        { cliente_id: 3, mediana_horas: null, amostras: 0, pendentes: 3 },
      ],
      etapas: { amostras: 6, mediana_horas: 12 },
    },
    origem: [
      { origem: 'human', concluidos: 30, tempo_medio_dias: 5.2 },
      { origem: 'agent', concluidos: 13, tempo_medio_dias: 3.1 },
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

/** One row of the approval ranking, addressed by the client it links to. */
function rankingRow(clienteId: number): HTMLElement {
  const el = document.querySelector(`a[href="/clientes/${clienteId}/entregas"]`);
  if (!el) throw new Error(`Linha do cliente ${clienteId} não encontrada no ranking`);
  return el as HTMLElement;
}

/** Every ranking row's href, in render order. */
function rankingHrefs(): string[] {
  return [...document.querySelectorAll('a[href^="/clientes/"]')].map(
    (a) => a.getAttribute('href') ?? '',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAnalytics.mockResolvedValue(payload());
  mockedClientes.mockResolvedValue([
    { id: 1, nome: 'Cliente A', sigla: 'CA', cor: '#f542c8', foto_url: null } as never,
    { id: 2, nome: 'Odonto Prime', sigla: 'OP', cor: '#42c8f5', foto_url: null } as never,
    { id: 3, nome: 'Clínica Vitalis', sigla: 'CV', cor: '#3ecf8e', foto_url: null } as never,
  ]);
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

  it('renders the Retrabalho KPI and reads falling rework as good news', async () => {
    renderPage();
    await screen.findByTestId('ritmo-chart');

    const retrabalho = kpiCard('Retrabalho');
    expect(within(retrabalho).getByText('18%')).toBeTruthy();
    // 18% against 24%: the arrow points down, and down is the GOOD direction
    // here. Without invertDelta this card would paint an improvement red.
    expect(delta(retrabalho)?.getAttribute('data-direction')).toBe('down');
    expect(delta(retrabalho)?.getAttribute('data-good')).toBe('true');
  });

  it('says so instead of printing a zero when no event backs the retrabalho KPI', async () => {
    mockedAnalytics.mockResolvedValue(
      payload({
        kpis: {
          ...payload().kpis,
          retrabalho_pct: null,
          retrabalho_prev: null,
        },
      }),
    );
    renderPage();
    await screen.findByTestId('ritmo-chart');

    const retrabalho = kpiCard('Retrabalho');
    expect(within(retrabalho).getByText('Sem dados')).toBeTruthy();
    expect(delta(retrabalho)).toBeNull();
    expect(within(retrabalho).getByText('nenhum evento de fluxo no período')).toBeTruthy();
  });

  it('measures the pontualidade delta in points, not as a relative change', async () => {
    renderPage();
    await screen.findByTestId('ritmo-chart');

    const pontualidade = kpiCard('Pontualidade');
    // 61 vs 69 is 8 points. The relative reading would be 11.6%.
    expect(within(pontualidade).getByText('8.0%')).toBeTruthy();
    expect(within(pontualidade).getByText('vs período anterior (pp)')).toBeTruthy();
  });

  it('withholds the pontualidade delta when the previous window rated nothing', async () => {
    mockedAnalytics.mockResolvedValue(
      payload({ kpis: { ...payload().kpis, etapas_avaliadas_prev: 0 } }),
    );
    renderPage();
    await screen.findByTestId('ritmo-chart');

    expect(delta(kpiCard('Pontualidade'))).toBeNull();
    expect(within(kpiCard('Pontualidade')).getByText('sem base de comparação')).toBeTruthy();
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
          etapas_avaliadas_prev: 0,
          retrabalho_pct: null,
          retrabalho_prev: null,
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
          retrabalho_pct: 5,
        })),
      }),
    );
    renderPage();
    await screen.findByTestId('ritmo-chart');

    expect(screen.queryAllByText('Etapa 11').length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Mostrar todas as etapas/ }));
    expect(screen.getAllByText('Etapa 11').length).toBeGreaterThan(0);
  });

  it('plots all five approval buckets, in the RPC order, with human labels', async () => {
    renderPage();
    const chart = await screen.findByTestId('aprovacao-chart');

    expect(JSON.parse(chart.getAttribute('data-labels') ?? '[]')).toEqual([
      '< 4h',
      '4 a 24h',
      '1 a 3d',
      '3 a 7d',
      '7d+',
    ]);
    expect(JSON.parse(chart.getAttribute('data-series') ?? '[]')).toEqual([
      ['Aprovações', 9, 14, 11, 6, 3],
    ]);
  });

  it('colours the two slow buckets with the warning and danger tokens', async () => {
    renderPage();
    const chart = await screen.findByTestId('aprovacao-chart');

    const [cores] = JSON.parse(chart.getAttribute('data-colors') ?? '[]');
    expect(cores).toHaveLength(5);
    // jsdom resolves no CSS variables, so these are chartTheme's own fallbacks:
    // the assertion is that the last two come from the SEMANTIC ramp and the
    // first three do not, never that a literal was typed into the section.
    expect(cores[3]).toBe('#f5a342');
    expect(cores[4]).toBe('#f55a42');
    expect(new Set(cores.slice(0, 3)).has('#f55a42')).toBe(false);
  });

  it('summarises the approval window under the histogram', async () => {
    renderPage();
    await screen.findByTestId('aprovacao-chart');

    expect(screen.getByText('1d 4h')).toBeTruthy();
    expect(screen.getByText(/43 respostas/)).toBeTruthy();
    expect(screen.getByText(/5 aguardando · 2 resolvidos internamente/)).toBeTruthy();
    // The etapa-only approvals are a complement, not a substitute: they are
    // stated separately so nobody adds them into the 43.
    expect(screen.getByText(/\+6 aprovações por etapa \(mediana 12h\)/)).toBeTruthy();
  });

  it('stamps both approval cards with the date the post event log starts', async () => {
    renderPage();
    await screen.findByTestId('aprovacao-chart');

    expect(screen.getAllByText(/Registrado desde 01\/08\/2026/).length).toBe(2);
  });

  it('omits the horizon caption entirely when there are no post events yet', async () => {
    mockedAnalytics.mockResolvedValue(
      payload({
        horizonte: { workflow_events_since: '2026-07-15T09:00:00+00:00', post_events_since: null },
      }),
    );
    renderPage();
    await screen.findByTestId('aprovacao-chart');

    expect(screen.queryByText(/Registrado desde/)).toBeNull();
  });

  it("ranks the slowest clients and links each row to that client's entregas", async () => {
    renderPage();
    await screen.findByTestId('aprovacao-chart');

    // By href, not by name: the client names also sit in the filter select, and
    // this assertion is about the ranking row, not about the toolbar.
    const odonto = rankingRow(2);
    expect(within(odonto).getByText('Odonto Prime')).toBeTruthy();
    expect(within(odonto).getByText('3h 20min')).toBeTruthy();
    expect(within(odonto).getByText('10 respostas')).toBeTruthy();

    // 98h is the slowest and keeps the top row.
    expect(within(rankingRow(1)).getByText('4d 2h')).toBeTruthy();
    expect(rankingHrefs()[0]).toBe('/clientes/1/entregas');
  });

  it('names a removed cliente instead of leaking the id in the ranking', async () => {
    renderPage();
    await screen.findByTestId('aprovacao-chart');

    expect(within(rankingRow(99)).getByText('Cliente removido')).toBeTruthy();
  });

  it('says a client is still sitting on the cycle instead of claiming zero answers', async () => {
    renderPage();
    await screen.findByTestId('aprovacao-chart');

    const vitalis = rankingRow(3);
    expect(within(vitalis).getByText('Sem dados')).toBeTruthy();
    expect(within(vitalis).getByText('3 aguardando')).toBeTruthy();
    expect(within(vitalis).queryByText('0 respostas')).toBeNull();
  });

  it('caps the ranking at eight rows', async () => {
    mockedAnalytics.mockResolvedValue(
      payload({
        aprovacao_cliente: {
          ...payload().aprovacao_cliente,
          por_cliente: Array.from({ length: 12 }, (_, i) => ({
            cliente_id: 100 + i,
            mediana_horas: 100 - i,
            amostras: 4,
            pendentes: 0,
          })),
        },
      }),
    );
    renderPage();
    await screen.findByTestId('aprovacao-chart');

    expect(screen.getAllByText('Cliente removido')).toHaveLength(8);
  });

  it('drops the whole approval section when no cycle touched the period', async () => {
    mockedAnalytics.mockResolvedValue(payload({ aprovacao_cliente: aprovacaoVazia() }));
    renderPage();
    await screen.findByTestId('ritmo-chart');

    expect(screen.getByText('Sem aprovações de cliente no período.')).toBeTruthy();
    expect(screen.queryByTestId('aprovacao-chart')).toBeNull();
    expect(screen.queryByText('Clientes mais lentos para aprovar')).toBeNull();
  });

  it('adds the retrabalho and atividade columns, sourced from the event log', async () => {
    renderPage();
    await screen.findByTestId('ritmo-chart');

    // Etapa retrabalho: a real percentage, and a dot where the etapa recorded
    // no conclusion at all — never a fabricated 0%.
    expect(screen.getAllByText('21%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('·').length).toBeGreaterThan(0);

    // Membro columns are COUNTS, not percentages.
    expect(screen.getAllByText('96 eventos').length).toBeGreaterThan(0);

    const retrabalhoHeaders = screen
      .getAllByText('Retrabalho')
      .filter((n) => n.tagName === 'TH')
      .map((n) => n.getAttribute('data-tooltip'));
    expect(retrabalhoHeaders.length).toBe(2);
    expect(retrabalhoHeaders.every((t) => t?.includes('15/07/2026'))).toBe(true);
    expect(
      screen
        .getAllByText('Atividade')
        .find((n) => n.tagName === 'TH')
        ?.getAttribute('data-tooltip'),
    ).toContain('15/07/2026');

    // The tooltips live inside an `overflow-x: auto` wrapper that clips them,
    // so the captions carry the same horizon outside it.
    expect(screen.getByText(/retrabalho registrado desde 15\/07\/2026/)).toBeTruthy();
    expect(screen.getByText(/retrabalho e atividade desde 15\/07\/2026/)).toBeTruthy();
  });

  it('drops the horizon from the table captions when no event was ever logged', async () => {
    mockedAnalytics.mockResolvedValue(
      payload({
        horizonte: { workflow_events_since: null, post_events_since: '2026-08-01T12:00:00+00:00' },
      }),
    );
    renderPage();
    await screen.findByTestId('ritmo-chart');

    expect(screen.queryByText(/desde 15\/07\/2026/)).toBeNull();
    expect(screen.getByText('tempo médio real de cada etapa concluída no período')).toBeTruthy();
    expect(
      screen
        .getAllByText('Retrabalho')
        .find((n) => n.tagName === 'TH')
        ?.getAttribute('data-tooltip'),
    ).toBe('Nenhuma devolução registrada ainda');
  });

  it('shows the origin breakdown once an agent is in the mix', async () => {
    renderPage();
    await screen.findByTestId('ritmo-chart');

    expect(screen.getByText('Origem dos fluxos')).toBeTruthy();
    expect(screen.getByText('Agente')).toBeTruthy();
    expect(screen.getByText('Humano')).toBeTruthy();
  });

  it('hides the origin card for a workspace that has only ever created flows by hand', async () => {
    mockedAnalytics.mockResolvedValue(
      payload({ origem: [{ origem: 'human', concluidos: 43, tempo_medio_dias: 5.2 }] }),
    );
    renderPage();
    await screen.findByTestId('ritmo-chart');

    // One row restating the total is not a breakdown.
    expect(screen.queryByText('Origem dos fluxos')).toBeNull();
  });

  it('echoes the applied filters for the print sheet, which drops the toolbar', async () => {
    renderPage('/analytics-fluxos?periodo=7d&cliente=1');
    await screen.findByTestId('ritmo-chart');

    const echo = document.querySelector('.analytics-fluxos-print-echo');
    expect(echo?.textContent).toBe('Período: 7d · Cliente: Cliente A · Template: todos');
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
          etapas_avaliadas_prev: 0,
          retrabalho_pct: null,
          retrabalho_prev: null,
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
          etapas_avaliadas_prev: 0,
          retrabalho_pct: null,
          retrabalho_prev: null,
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
