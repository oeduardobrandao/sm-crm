import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom's matchMedia matches nothing, so the page renders its phone branch (below 768px).

vi.mock('react-chartjs-2', () => ({
  Chart: () => <div data-testid="chart" />,
}));

vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

vi.mock('@/services/workflowAnalytics', async () => {
  const actual = await vi.importActual<typeof import('@/services/workflowAnalytics')>(
    '@/services/workflowAnalytics',
  );
  return { ...actual, getWorkflowAnalytics: vi.fn() };
});

vi.mock('../../../store', () => ({
  getClientes: vi.fn(),
  sortClientesByNome: <T extends { nome: string }>(clientes: T[]) =>
    [...clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  getWorkflowTemplates: vi.fn(),
  getMembros: vi.fn(),
}));

vi.mock('../csv', async () => {
  const actual = await vi.importActual<typeof import('../csv')>('../csv');
  return { ...actual, downloadCsv: vi.fn() };
});

import AnalyticsFluxosPage from '../AnalyticsFluxosPage';
import {
  getWorkflowAnalytics,
  NotEntitledError,
  type WorkflowAnalytics,
} from '@/services/workflowAnalytics';
import { getClientes, getMembros, getWorkflowTemplates } from '../../../store';
import { downloadCsv } from '../csv';

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
    etapas: Array.from({ length: 12 }, (_, i) => ({
      nome: `Etapa ${i + 1}`,
      media_dias: 12 - i,
      amostras: 5,
      atraso_pct: i === 0 ? 62 : 10,
      retrabalho_pct: i === 0 ? 21 : null,
    })),
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
      buckets: ['<4h', '4-24h', '1-3d', '3-7d', '7d+'].map((faixa, i) => ({
        faixa,
        quantidade: [9, 14, 11, 6, 3][i],
      })),
      por_cliente: [
        { cliente_id: 1, mediana_horas: 98, amostras: 8, pendentes: 1 },
        { cliente_id: 3, mediana_horas: null, amostras: 0, pendentes: 3 },
      ],
      etapas: { amostras: 0, mediana_horas: null },
    },
    origem: [
      { origem: 'human', concluidos: 30, tempo_medio_dias: 5.2 },
      { origem: 'agent', concluidos: 13, tempo_medio_dias: 3.1 },
    ],
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analytics-fluxos']}>
        <AnalyticsFluxosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AnalyticsFluxosPage (phone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkflowAnalytics).mockResolvedValue(payload());
    vi.mocked(getClientes).mockResolvedValue([
      { id: 1, nome: 'Cliente A', sigla: 'CA', cor: '#f542c8', foto_url: null } as never,
      { id: 3, nome: 'Clínica Vitalis', sigla: 'CV', cor: '#3ecf8e', foto_url: null } as never,
    ]);
    vi.mocked(getWorkflowTemplates).mockResolvedValue([{ id: 5, nome: 'Post padrão' }] as never);
    vi.mocked(getMembros).mockResolvedValue([
      { id: 7, nome: 'Ana Souza' } as never,
      { id: 8, nome: 'Bruno Lima' } as never,
    ]);
  });

  it('renders the page header with the period hint visible and no desktop header', async () => {
    const { container } = renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Analytics de fluxos' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'O período filtra pela data de conclusão. Ativos são sempre o retrato atual.',
      ),
    ).toBeInTheDocument();
    expect(container.querySelector('.header')).toBeNull();
    expect(
      await screen.findByText('Concluídos', { selector: '.phone-stat-tile__label' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.phone-stat-grid--scroll')).not.toBeNull();
    // No canvas charts on phones: the weekly rhythm and the approval histogram are rows.
    expect(screen.queryByTestId('chart')).toBeNull();
  });

  it('shows the weeks with their full date and both series', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Ritmo de entrega' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Semana de 11/08/2026');
    expect(rows[1]).toHaveTextContent('Semana de 04/08/2026');
    expect(rows[1]).toHaveTextContent('Concluídos: 2');
    expect(rows[1]).toHaveTextContent('Criados: 3');
  });

  it('lists the approval buckets with the median and the pending count', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Tempo de resposta do cliente' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).getByText('7d+')).toBeInTheDocument();
    expect(screen.getByText(/5 aguardando · 2 resolvidos internamente/)).toBeInTheDocument();
    const slow = screen.getByRole('link', { name: /Cliente A/ });
    expect(slow).toHaveAttribute('href', '/clientes/1/entregas');
    expect(screen.getByRole('link', { name: /Clínica Vitalis/ })).toHaveTextContent('3 aguardando');
  });

  it('caps the bottlenecks at ten and reveals the rest on demand', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Gargalos por etapa' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar todas as etapas (2 ocultas)' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
  });

  it('says why a member is flagged "Poucos dados" instead of hiding it in a tooltip', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Desempenho da equipe' });
    const bruno = within(list).getByText('Bruno Lima').closest('li') as HTMLElement;
    expect(bruno).toHaveTextContent('Poucos dados');
    expect(bruno).toHaveTextContent('Menos de 3 etapas avaliadas no período');
    const ana = within(list).getByText('Ana Souza').closest('li') as HTMLElement;
    expect(ana).toHaveTextContent('83%');
  });

  it('exports the CSV from the "…" action sheet', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Gargalos por etapa' });
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar CSV' }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
  });

  it('filters by client through a picker sheet', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Gargalos por etapa' });
    fireEvent.click(screen.getByRole('button', { name: 'Cliente: todos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clínica Vitalis' }));
    await waitFor(() =>
      expect(getWorkflowAnalytics).toHaveBeenLastCalledWith(
        expect.objectContaining({ clienteId: 3 }),
      ),
    );
  });

  it('explains a plan without access instead of offering a retry', async () => {
    vi.mocked(getWorkflowAnalytics).mockRejectedValue(new NotEntitledError());
    renderPage();
    expect(
      await screen.findByText('Analytics de Fluxos não está disponível no seu plano.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });
});
