import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CalendarioPage />
    </QueryClientProvider>,
  );
}

describe('CalendarioPage — Datas Comemorativas', () => {
  beforeEach(() => {
    localStorage.clear();
    // vitest.setup.ts calls vi.restoreAllMocks() in afterEach, which wipes the resolved
    // values these mock fns got inside the vi.mock factory — re-arm them every test.
    vi.mocked(store.getClientes).mockResolvedValue([]);
    vi.mocked(store.getMembros).mockResolvedValue([]);
    vi.mocked(store.getTransacoes).mockResolvedValue([]);
    vi.mocked(store.getWorkflows).mockResolvedValue([]);
    vi.mocked(store.getWorkflowEtapas).mockResolvedValue([]);
    vi.mocked(store.getAllClienteDatas).mockResolvedValue([]);
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
