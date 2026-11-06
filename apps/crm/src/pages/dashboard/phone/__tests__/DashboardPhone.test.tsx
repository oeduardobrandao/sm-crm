import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from '../../todayAgenda';

const { todayState, filaState, agentState, healthMock, syncMock, authUrlMock } = vi.hoisted(() => ({
  todayState: { current: null as unknown },
  filaState: { current: null as unknown },
  agentState: { current: null as unknown },
  healthMock: vi.fn(),
  syncMock: vi.fn(),
  authUrlMock: vi.fn(),
}));

vi.mock('../../useTodayCard', async () => {
  const actual = await vi.importActual<typeof import('../../useTodayCard')>('../../useTodayCard');
  return { ...actual, useTodayCard: () => todayState.current };
});
vi.mock('../../useMinhaFilaTeaser', async () => {
  const actual = await vi.importActual<typeof import('../../useMinhaFilaTeaser')>(
    '../../useMinhaFilaTeaser',
  );
  return { ...actual, useMinhaFilaTeaser: () => filaState.current };
});
vi.mock('../../useAgentPending', () => ({ useAgentPending: () => agentState.current }));
vi.mock('../../../../services/clientHealth', () => ({ getClientHealthMonitor: healthMock }));
vi.mock('../../../../services/instagram', () => ({
  syncInstagramData: syncMock,
  getInstagramAuthUrl: authUrlMock,
}));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));
vi.mock('@/components/layout/GlobalSearchDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="global-search" /> : null),
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DashboardPhone } from '../DashboardPhone';
import i18n from 'i18next';

const fixedT = i18n.getFixedT(null, 'dashboard');
const t = ((key: string, fallbackOrOpts?: unknown, opts?: unknown) =>
  fixedT(
    key,
    (typeof fallbackOrOpts === 'object' ? fallbackOrOpts : opts) as Record<string, unknown>,
  )) as never;

function item(over: Partial<AgendaItem>): AgendaItem {
  return {
    key: over.key ?? 'k',
    kind: 'tarefa',
    bucket: 'atrasado',
    title: 'Relatório mensal',
    context: 'Clínica Sol',
    when: null,
    href: '/tarefas?tarefa=1',
    badge: { label: '2 dias de atraso', className: 'deadline-overdue' } as never,
    tarefaId: 1,
    tarefaStatus: 'pendente',
    ...over,
  };
}

function makeToday(over: Record<string, unknown> = {}) {
  const atrasado = [
    item({ key: 'a1' }),
    item({
      key: 'a2',
      kind: 'etapa',
      title: 'Produção',
      context: 'Pet Feliz',
      tarefaId: undefined,
      href: '/entregas?drawer=4',
    }),
  ];
  const hoje = [item({ key: 'h1', title: 'Aprovar roteiro', bucket: 'hoje', tarefaId: 2 })];
  return {
    t,
    status: 'ready',
    scope: 'workspace',
    buckets: { atrasado, hoje, proximos: [] },
    counts: { atrasado: 2, hoje: 1, proximos: 0 },
    total: 3,
    summary: 'Domingo, 11 de outubro · 2 atrasados, 1 para hoje',
    visible: new Set(['atrasado', 'hoje']),
    toggle: vi.fn(),
    limits: { atrasado: 8, hoje: 8, proximos: 8 },
    showMore: vi.fn(),
    showLess: vi.fn(),
    complete: { isPending: false, mutate: vi.fn() },
    ...over,
  };
}

const CLIENTS = [
  {
    client_id: 7,
    client_name: 'Ótica Visão',
    client_sigla: 'OV',
    client_cor: '#f00',
    username: 'oticavisao',
    profile_picture_url: null,
    connected: true,
    follower_count: 1200,
    follower_delta: 0,
    follower_delta_pct: 0,
    follower_series: [],
    engagement_rate: 2,
    reach_28d: 300,
    reach_trend_pct: 0,
    days_since_last_post: 3,
    pipeline: { agendados: 0, em_producao: 0, agente: 0, falha: 0 },
    authorization_status: null,
    token_expires_at: null,
    last_synced_at: null,
    status: 'reconectar',
    score: null,
  },
  {
    client_id: 8,
    client_name: 'Café Aurora',
    client_sigla: 'CA',
    client_cor: '#0f0',
    username: 'cafeaurora',
    profile_picture_url: null,
    connected: true,
    follower_count: 5400,
    follower_delta: 12,
    follower_delta_pct: 1,
    follower_series: [],
    engagement_rate: 3.1,
    reach_28d: 9000,
    reach_trend_pct: 0,
    days_since_last_post: 1,
    pipeline: { agendados: 2, em_producao: 1, agente: 0, falha: 0 },
    authorization_status: null,
    token_expires_at: null,
    last_synced_at: null,
    status: 'sem_sincronizar',
    score: 70,
  },
];

function PathProbe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

function renderPhone(isAgent = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <DashboardPhone
                  isAgent={isAgent}
                  cards={<div data-testid="cards" />}
                  footer={<div data-testid="footer" />}
                />
                <PathProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  todayState.current = makeToday();
  filaState.current = {
    canManageTeam: true,
    membroId: 3,
    state: 'ready',
    fila: {
      items: [
        {
          key: 'f1',
          post: {
            id: 11,
            workflow_id: 5,
            titulo: 'Carrossel de lançamento',
            cliente_nome: 'Café Aurora',
            scheduled_at: null,
          },
          prazoDate: new Date(),
          deadline: { estourado: false, urgente: true, diasRestantes: 0 },
        },
      ],
    },
  };
  agentState.current = {
    membro: { id: 3 },
    membroLoading: false,
    tarefasLoading: false,
    minhasTarefas: [{ id: 9, titulo: 'Legenda do reel', cliente_nome: 'Pet Feliz' }],
    nothingPending: false,
    badgeOf: () => ({ label: 'Hoje', className: 'deadline-warning' }),
  };
  healthMock.mockResolvedValue({
    clients: CLIENTS,
    summary: { total: 2, atencao: 0, saudaveis: 0, estaveis: 0, conexao: 2, precisamAtencao: 2 },
  });
});

describe('DashboardPhone', () => {
  it('page header: Início, the day summary as subtitle, Buscar opens the global search', () => {
    renderPhone();
    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
    expect(
      screen.getByText('Domingo, 11 de outubro · 2 atrasados, 1 para hoje'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('global-search')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByTestId('global-search')).toBeInTheDocument();
  });

  it('Hoje: bucket chips toggle, grouped sections, check completes the tarefa', () => {
    const today = makeToday();
    todayState.current = today;
    renderPhone();
    const chips = screen.getByRole('group', { name: 'Hoje' });
    fireEvent.click(within(chips).getByRole('button', { name: /Próximos 7 dias/ }));
    expect(today.toggle).toHaveBeenCalledWith('proximos');

    expect(screen.getByRole('heading', { name: 'Atrasado · 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hoje · 1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Calendário' })).toHaveAttribute('href', '/calendario');
    expect(screen.getByRole('link', { name: /Produção/ })).toHaveAttribute(
      'href',
      '/entregas?drawer=4',
    );
    const checks = screen.getAllByRole('button', { name: 'Concluir tarefa' });
    expect(checks).toHaveLength(2);
    fireEvent.click(checks[0]);
    expect(today.complete.mutate).toHaveBeenCalledWith({ id: 1, previousStatus: 'pendente' });
  });

  it('Hoje: show more appears past the row limit', () => {
    const today = makeToday({ limits: { atrasado: 1, hoje: 8, proximos: 8 } });
    todayState.current = today;
    renderPhone();
    fireEvent.click(screen.getByRole('button', { name: /Mostrar mais 1/ }));
    expect(today.showMore).toHaveBeenCalledWith('atrasado');
  });

  it('Minha fila: rows deep-link into the queue with the prazo badge', () => {
    renderPhone();
    expect(screen.getByRole('link', { name: 'Ver minha fila' })).toHaveAttribute(
      'href',
      '/entregas?view=fila',
    );
    expect(screen.getByRole('link', { name: /Carrossel de lançamento/ })).toHaveAttribute(
      'href',
      '/entregas?view=fila&drawer=5&post=11',
    );
  });

  it('Minha fila without a linked membro offers Vincular na Equipe to managers', () => {
    filaState.current = { canManageTeam: true, membroId: null, state: 'no-membro', fila: null };
    renderPhone();
    expect(screen.getByRole('link', { name: 'Vincular na Equipe' })).toHaveAttribute(
      'href',
      '/equipe',
    );
  });

  it('Saúde dos clientes: chips, rows and the client sheet with every card action', async () => {
    renderPhone();
    const row = await screen.findByRole('button', { name: /Café Aurora/ });
    expect(screen.getByRole('button', { name: /Ótica Visão/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conexão/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(row);
    const sheet = await screen.findByRole('dialog', { name: 'Café Aurora' });
    expect(within(sheet).getByText('5.400 ▲12')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sincronizar agora' }));
    await waitFor(() => expect(syncMock).toHaveBeenCalledWith(8));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Analytics' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/analytics/8'));
  });

  it('Saúde dos clientes: Reconectar lives in the sheet of a revoked client', async () => {
    renderPhone();
    fireEvent.click(await screen.findByRole('button', { name: /Ótica Visão/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Ótica Visão' });
    expect(within(sheet).getByRole('button', { name: 'Reconectar' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Detalhe' })).toBeInTheDocument();
  });

  it('agents see their pending tasks instead of client health', () => {
    renderPhone(true);
    expect(screen.queryByTestId('health-phone')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Legenda do reel/ })).toHaveAttribute(
      'href',
      '/tarefas?tarefa=9',
    );
    expect(screen.getByRole('link', { name: 'Ver todas' })).toHaveAttribute('href', '/tarefas');
  });
});
