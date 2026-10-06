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

// The Agenda tab (FullCalendar + its own queries) has its own suite; here it only
// has to prove it is the default tab and that the old tabs still work.
vi.mock('../agenda/AgendaTab', () => ({
  default: () => <div data-testid="agenda-tab">AgendaTab</div>,
}));

// Agenda is behind the plan flag feature_agenda: each test sets the answer (null = limits
// still unknown), and rerender() lets a test flip it after mount.
const { mockFeatures } = vi.hoisted(() => ({
  mockFeatures: { current: null as { feature_agenda: boolean } | null },
}));
vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: mockFeatures.current }),
}));

vi.mock('@/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return { ...actual, useAuth: () => ({ canSeeFinancials: false }) };
});

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
    mockFeatures.current = { feature_agenda: true };
  });

  it('opens on the Agenda tab by default', async () => {
    renderPage();

    expect(await screen.findByTestId('agenda-tab')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByText('Eventos, reuniões e gravações da equipe.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveClass('active');

    fireEvent.click(screen.getByRole('button', { name: 'Calendário' }));
    expect(screen.queryByTestId('agenda-tab')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Calendário' })).toBeInTheDocument();
  });

  it.each(['/calendario?evento=5', '/calendario?data=2026-12-24'])(
    'switches back to Agenda when %s arrives while another tab is open',
    async (url) => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Datas Comemorativas' }));
      expect(screen.queryByTestId('agenda-tab')).not.toBeInTheDocument();

      act(() => {
        void nav.current!(url);
      });

      expect(await screen.findByTestId('agenda-tab')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    },
  );

  it('switches back again for a new ?evento= even when an older one is still in the URL', async () => {
    renderPage();
    act(() => {
      void nav.current!('/calendario?evento=5');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Calendário' }));
    expect(screen.queryByTestId('agenda-tab')).not.toBeInTheDocument();

    act(() => {
      void nav.current!('/calendario?evento=6');
    });
    expect(await screen.findByTestId('agenda-tab')).toBeInTheDocument();
  });

  it('resolves null -> on to the Agenda tab when the user has not picked one', async () => {
    mockFeatures.current = null;
    const { rerenderPage } = renderPage();
    expect(screen.queryByRole('button', { name: 'Agenda' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calendário' })).toHaveClass('active');

    mockFeatures.current = { feature_agenda: true };
    rerenderPage();

    expect(await screen.findByTestId('agenda-tab')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveClass('active');
  });

  it('does not override a tab the user clicked when the flag resolves to on', () => {
    mockFeatures.current = null;
    const { rerenderPage } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Datas Comemorativas' }));

    mockFeatures.current = { feature_agenda: true };
    rerenderPage();

    expect(screen.queryByTestId('agenda-tab')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Datas Comemorativas' })).toHaveClass('active');
  });

  it('sets the tab title while mounted and restores the previous one on unmount', async () => {
    document.title = 'Anterior | Mesaas';
    const { unmount } = renderPage();

    await screen.findByTestId('agenda-tab');
    expect(document.title).toBe('Agenda | Mesaas');
    unmount();
    expect(document.title).toBe('Anterior | Mesaas');
  });

  it('names the tab title after the active tab', () => {
    document.title = 'Anterior | Mesaas';
    const { unmount } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Calendário' }));
    expect(document.title).toBe('Calendário | Mesaas');
    fireEvent.click(screen.getByRole('button', { name: 'Datas Comemorativas' }));
    expect(document.title).toBe('Datas Comemorativas | Mesaas');
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

describe('CalendarioPage — Datas Comemorativas', () => {
  beforeEach(() => {
    localStorage.clear();
    armStore();
    mockFeatures.current = { feature_agenda: true };
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
