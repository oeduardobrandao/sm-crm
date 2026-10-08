import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NicheCalendarDef } from '../nicheCalendars/types';

// vi.mock is hoisted above regular top-level consts, so the fixtures it references must be
// created inside vi.hoisted (see https://vitest.dev/api/vi.html#vi-mock).
const { NICHE_A, NICHE_B } = vi.hoisted(() => {
  const nicheA: NicheCalendarDef = {
    key: 'niche-a',
    label: 'Nicho A',
    title: 'Calendário Nicho A',
    subtitle: 'Subtítulo A',
    filterLabels: {},
    data: [
      {
        month: 'Janeiro',
        num: '01',
        events: [{ date: '01/01', name: 'Evento Exclusivo A', type: 'br', tags: ['br'] }],
      },
    ],
  };
  const nicheB: NicheCalendarDef = {
    key: 'niche-b',
    label: 'Nicho B',
    title: 'Calendário Nicho B',
    subtitle: 'Subtítulo B',
    filterLabels: {},
    data: [
      {
        month: 'Janeiro',
        num: '01',
        events: [{ date: '02/01', name: 'Evento Exclusivo B', type: 'world', tags: ['world'] }],
      },
    ],
  };
  return { NICHE_A: nicheA, NICHE_B: nicheB };
});

vi.mock('../nicheCalendars/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../nicheCalendars/registry')>();
  return { ...actual, NICHE_CALENDARS: [NICHE_A, NICHE_B], DEFAULT_NICHE_KEY: 'niche-a' };
});

// The Agenda (FullCalendar + its own queries) has its own suite; here it only has
// to prove the flag folds the page into it and that the old tabs still work.
vi.mock('../agenda/AgendaTab', () => ({
  default: () => <div data-testid="agenda-tab">AgendaTab</div>,
}));

// Agenda is behind the plan flag feature_agenda: each test sets the answer (null = limits
// still unknown), and rerender() lets a test flip it after mount.
const { mockFeatures, mockLoading } = vi.hoisted(() => ({
  mockFeatures: { current: null as { feature_agenda: boolean } | null },
  mockLoading: { current: false },
}));
vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: mockFeatures.current, isLoading: mockLoading.current }),
}));

const { mockFinanceiro } = vi.hoisted(() => ({ mockFinanceiro: { current: false } }));
vi.mock('@/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return { ...actual, useAuth: () => ({ canSeeFinancials: mockFinanceiro.current }) };
});
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

vi.mock('../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../store')>('../../../store');
  return {
    ...actual,
    getClientes: vi.fn(),
    getMembros: vi.fn(),
    getTransacoes: vi.fn(),
    getWorkflows: vi.fn(),
    getWorkflowEtapas: vi.fn(),
    getAllClienteDatas: vi.fn(),
    addTransacao: vi.fn(),
  };
});

// Radix Select requires pointer-capture/scrollIntoView APIs jsdom doesn't implement — mocked
// the same way ClientesPage.test.tsx/WorkflowModals.test.tsx do, so onValueChange is still
// exercised without fighting jsdom.
vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  const SelectContext = ReactModule.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    );
  }
  function SelectTrigger({ children }: { children: React.ReactNode }) {
    return <button type="button">{children}</button>;
  }
  function SelectValue() {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

import * as store from '../../../store';
import CalendarioPage from '../CalendarioPage';

const nav: { current: NavigateFunction | null } = { current: null };
function NavProbe() {
  const navigate = useNavigate();
  useEffect(() => {
    nav.current = navigate;
  }, [navigate]);
  return null;
}

function pageTree(queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/calendario']}>
        <CalendarioPage />
        <NavProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(pageTree(queryClient));
  return { ...utils, rerenderPage: () => utils.rerender(pageTree(queryClient)) };
}

function armStore() {
  mockFinanceiro.current = false;
  // vitest.setup.ts calls vi.restoreAllMocks() in afterEach, which wipes the resolved
  // values these mock fns got inside the vi.mock factory — re-arm them every test.
  vi.mocked(store.getClientes).mockResolvedValue([]);
  vi.mocked(store.getMembros).mockResolvedValue([]);
  vi.mocked(store.getTransacoes).mockResolvedValue([]);
  vi.mocked(store.getWorkflows).mockResolvedValue([]);
  vi.mocked(store.getWorkflowEtapas).mockResolvedValue([]);
  vi.mocked(store.getAllClienteDatas).mockResolvedValue([]);
}

describe('CalendarioPage — Agenda (flag on)', () => {
  beforeEach(() => {
    localStorage.clear();
    armStore();
    mockLoading.current = false;
    mockFeatures.current = { feature_agenda: true };
  });

  it('is the Agenda alone: no tab bar, the old tabs are layers now', async () => {
    const { container } = renderPage();

    expect(await screen.findByTestId('agenda-tab')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByText('Eventos, reuniões e gravações da equipe.')).toBeInTheDocument();
    expect(container.querySelector('.calendar-tabs')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Calendário' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Datas Comemorativas' })).not.toBeInTheDocument();
    // The old page's own queries never run.
    expect(store.getClientes).not.toHaveBeenCalled();
    expect(store.getTransacoes).not.toHaveBeenCalled();
  });

  it.each(['/calendario?evento=5', '/calendario?data=2026-12-24'])(
    'keeps rendering the Agenda (which reads the param) for %s',
    async (url) => {
      renderPage();
      await screen.findByTestId('agenda-tab');

      act(() => {
        void nav.current!(url);
      });

      expect(screen.getByTestId('agenda-tab')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    },
  );

  it('shows a skeleton only while the limits load, then the Agenda', async () => {
    mockFeatures.current = null;
    mockLoading.current = true;
    const { rerenderPage } = renderPage();

    expect(screen.getByRole('status', { name: 'Carregando calendário' })).toBeInTheDocument();
    expect(screen.queryByTestId('agenda-tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Calendário' })).not.toBeInTheDocument();

    mockFeatures.current = { feature_agenda: true };
    mockLoading.current = false;
    rerenderPage();

    expect(await screen.findByTestId('agenda-tab')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Carregando calendário' })).not.toBeInTheDocument();
  });

  it('a failed limits call (features null, not loading) is the flag-off page, never a skeleton', () => {
    mockFeatures.current = null;
    mockLoading.current = false;
    renderPage();

    expect(screen.queryByRole('status', { name: 'Carregando calendário' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calendário' })).toHaveClass('active');
    expect(screen.queryByTestId('agenda-tab')).not.toBeInTheDocument();
  });

  it('sets the tab title while mounted and restores the previous one on unmount', async () => {
    document.title = 'Anterior | Mesaas';
    const { unmount } = renderPage();

    await screen.findByTestId('agenda-tab');
    expect(document.title).toBe('Agenda | Mesaas');
    unmount();
    expect(document.title).toBe('Anterior | Mesaas');
  });

  it('restores the title from before the skeleton, not an intermediate one', async () => {
    document.title = 'Anterior | Mesaas';
    mockFeatures.current = null;
    mockLoading.current = true;
    const { rerenderPage, unmount } = renderPage();

    mockFeatures.current = { feature_agenda: true };
    mockLoading.current = false;
    rerenderPage();
    await screen.findByTestId('agenda-tab');
    expect(document.title).toBe('Agenda | Mesaas');
    unmount();
    expect(document.title).toBe('Anterior | Mesaas');
  });
});

describe.each([
  ['off', { feature_agenda: false }],
  ['unknown', null],
])('CalendarioPage — flag %s', (_name, features) => {
  beforeEach(() => {
    localStorage.clear();
    armStore();
    mockLoading.current = false;
    mockFeatures.current = features;
  });

  it('is the page from before the Agenda: no Agenda tab, opens on Calendário', () => {
    renderPage();

    expect(screen.queryByRole('button', { name: 'Agenda' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('agenda-tab')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Calendário' })).toBeInTheDocument();
    expect(screen.getByText('Visão geral mensal.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calendário' })).toHaveClass('active');
  });

  it.each(['/calendario?evento=5', '/calendario?data=2026-12-24'])(
    'ignores %s: the Agenda tab does not exist, the page keeps its own tab',
    (url) => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Datas Comemorativas' }));

      act(() => {
        void nav.current!(url);
      });

      expect(screen.queryByTestId('agenda-tab')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Datas Comemorativas' })).toHaveClass('active');
    },
  );

  it('still sets the per-tab title and restores it on unmount', () => {
    document.title = 'Anterior | Mesaas';
    const { unmount } = renderPage();

    expect(document.title).toBe('Calendário | Mesaas');
    unmount();
    expect(document.title).toBe('Anterior | Mesaas');
  });
});

describe('CalendarioPage — Datas Comemorativas (flag off)', () => {
  beforeEach(() => {
    localStorage.clear();
    armStore();
    mockLoading.current = false;
    mockFeatures.current = { feature_agenda: false };
  });

  it('switches to the niche tab, defaults to the first niche, and lets the user switch niches', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Datas Comemorativas' }));

    await waitFor(() => expect(screen.getByText('Evento Exclusivo A')).toBeInTheDocument());
    expect(screen.queryByText('Evento Exclusivo B')).not.toBeInTheDocument();
    expect(screen.getByText('Calendário Nicho A')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Nicho B' }));

    await waitFor(() => expect(screen.getByText('Evento Exclusivo B')).toBeInTheDocument());
    expect(screen.queryByText('Evento Exclusivo A')).not.toBeInTheDocument();
    expect(screen.getByText('Calendário Nicho B')).toBeInTheDocument();
  });

  it('remembers the last selected niche across remounts', async () => {
    const { unmount } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Datas Comemorativas' }));
    await waitFor(() => expect(screen.getByText('Evento Exclusivo A')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Nicho B' }));
    await waitFor(() => expect(screen.getByText('Evento Exclusivo B')).toBeInTheDocument());

    unmount();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Datas Comemorativas' }));
    await waitFor(() => expect(screen.getByText('Evento Exclusivo B')).toBeInTheDocument());
  });

  it('resets the category filter and search term when switching niches', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Datas Comemorativas' }));
    await waitFor(() => expect(screen.getByText('Evento Exclusivo A')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Buscar data...'), {
      target: { value: 'não existe' },
    });
    expect(screen.queryByText('Evento Exclusivo A')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Nicho B' }));
    await waitFor(() => expect(screen.getByText('Evento Exclusivo B')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Buscar data...')).toHaveValue('');
  });
});

describe('CalendarioPage — payment confirm (flag off)', () => {
  beforeEach(() => {
    localStorage.clear();
    armStore();
    mockLoading.current = false;
    mockFeatures.current = { feature_agenda: false };
  });

  it('confirms a receivable through the same AlertDialog and payload as before', async () => {
    mockFinanceiro.current = true;
    const hoje = new Date();
    vi.mocked(store.getClientes).mockResolvedValue([
      {
        id: 12,
        nome: 'Clínica Sorriso',
        sigla: 'CS',
        cor: '#123',
        plano: 'pro',
        email: '',
        telefone: '',
        status: 'ativo',
        valor_mensal: 1500,
        data_pagamento: hoje.getDate(),
      },
    ]);
    vi.mocked(store.addTransacao).mockResolvedValue({} as never);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /CONFIRMAR/ }));
    expect(await screen.findByText('Confirmar Agendamento')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(store.addTransacao).toHaveBeenCalledTimes(1));
    const mm = String(hoje.getMonth() + 1).padStart(2, '0');
    expect(store.addTransacao).toHaveBeenCalledWith({
      descricao: 'Clínica Sorriso',
      detalhe: 'Baixa efetuada pelo Calendário',
      categoria: 'Mensalidade Cliente',
      valor: 1500,
      data: new Date().toISOString().split('T')[0],
      tipo: 'entrada',
      status: 'pago',
      referencia_agendamento: `cliente_12_${hoje.getFullYear()}_${mm}`,
    });
  });
});
