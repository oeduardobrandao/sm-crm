import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaOcorrencia } from '../../../../store/agenda';

// ---- FullCalendar mock ---------------------------------------------------------
// Records the last props and exposes a fake CalendarApi through the ref. On mount
// it fires datesSet once with a fixed week, like the real calendar does.
const { fc, RANGE } = vi.hoisted(() => {
  const RANGE = {
    start: new Date(2026, 9, 5, 0, 0, 0),
    end: new Date(2026, 9, 12, 0, 0, 0),
  };
  const api = {
    changeView: vi.fn(),
    gotoDate: vi.fn(),
    prev: vi.fn(),
    next: vi.fn(),
    today: vi.fn(),
    unselect: vi.fn(),
  };
  const fc = {
    props: null as Record<string, any> | null,
    api,
    record(p: Record<string, any>) {
      fc.props = p;
    },
  };
  return { fc, RANGE };
});

vi.mock('@fullcalendar/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const FullCalendar = React.forwardRef(function FullCalendarMock(
    props: Record<string, any>,
    ref: React.Ref<unknown>,
  ) {
    fc.record(props);
    React.useImperativeHandle(ref, () => ({ getApi: () => fc.api }));
    React.useEffect(() => {
      props.datesSet?.({
        start: RANGE.start,
        end: RANGE.end,
        view: {
          type: props.initialView,
          title: 'ignored',
          currentStart: RANGE.start,
          currentEnd: RANGE.end,
        },
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="fullcalendar">
        {/* Keyed by title too, so an edited event gets a NEW node, as FullCalendar
            re-renders chips after a refetch. */}
        {(props.events ?? []).map((e: { id: string; title: string }) => (
          <span key={`${e.id}:${e.title}`} data-ocorrencia-id={e.id}>
            {e.title}
          </span>
        ))}
      </div>
    );
  });
  return { default: FullCalendar };
});
vi.mock('@fullcalendar/daygrid', () => ({ default: {} }));
vi.mock('@fullcalendar/timegrid', () => ({ default: {} }));
vi.mock('@fullcalendar/list', () => ({ default: {} }));
vi.mock('@fullcalendar/interaction', () => ({ default: {} }));
vi.mock('@fullcalendar/core/locales/pt-br', () => ({ default: {} }));

// ---- Tasks 10/11 components (never the stubs) ---------------------------------------
const { moverMock } = vi.hoisted(() => ({ moverMock: vi.fn() }));
vi.mock('../EventoFormDialog', () => ({
  EventoFormDialog: (p: { open: boolean; modo: string; inicial?: { diaInteiro: boolean } }) =>
    p.open ? (
      <div data-testid="evento-form">
        {p.modo}
        {p.inicial ? ` dia-inteiro:${String(p.inicial.diaInteiro)}` : ''}
      </div>
    ) : null,
}));
vi.mock('../EventoPopover', () => ({
  EventoPopover: (p: {
    ocorrencia: AgendaOcorrencia;
    anchor: HTMLElement;
    onEditar: (o: AgendaOcorrencia) => void;
  }) => (
    <div
      data-testid="evento-popover"
      data-anchor-connected={String(p.anchor.isConnected)}
      data-anchor-id={p.anchor.dataset.ocorrenciaId ?? 'container'}
    >
      {p.ocorrencia.titulo}
      <button type="button" onClick={() => p.onEditar(p.ocorrencia)}>
        editar-stub
      </button>
    </div>
  ),
}));
vi.mock('../useAgendaMutations', () => ({
  useAgendaMutations: () => ({ mover: moverMock, dialog: null }),
}));

// ---- App modules ------------------------------------------------------------------
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-me' } }),
}));
vi.mock('../../../../store/agenda', () => ({
  AGENDA_QUERY_KEY: 'agenda-ocorrencias',
  listAgenda: vi.fn(),
  getAgendaOcorrencia: vi.fn(),
}));
vi.mock('../../../../store/workspace', () => ({
  getWorkspaceUsers: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: vi.fn() }));

import { toast } from 'sonner';
import * as agendaStore from '../../../../store/agenda';
import * as workspaceStore from '../../../../store/workspace';
import AgendaTab from '../AgendaTab';
import { permitirArraste, tituloDoPeriodo } from '../AgendaView';

function oc(over: Partial<AgendaOcorrencia>): AgendaOcorrencia {
  return {
    ocorrencia_id: 1,
    evento_id: 1,
    data_original: '2026-10-05',
    inicio: '2026-10-05T12:00:00Z',
    fim: '2026-10-05T13:00:00Z',
    dia_inteiro: false,
    data_inicio_local: '2026-10-05',
    data_fim_local: '2026-10-06',
    titulo: 'Evento',
    descricao: null,
    local: null,
    link_reuniao: null,
    tipo: 'reuniao',
    cor: null,
    cliente_id: null,
    cliente_nome: null,
    privado: false,
    mascarado: false,
    recorrente: false,
    regra: null,
    lembretes: [10],
    organizador_id: 'u-me',
    participantes: [],
    minha_resposta: null,
    pode_editar: true,
    pode_responder: false,
    tz: 'America/Sao_Paulo',
    ...over,
  };
}

const MEU = oc({ ocorrencia_id: 1, titulo: 'Reunião de pauta', organizador_id: 'u-me' });
const CONVIDADO = oc({
  ocorrencia_id: 2,
  titulo: 'Gravação: Clínica Sorriso',
  organizador_id: 'u-bruno',
  participantes: [{ user_id: 'u-me', resposta: 'pendente' }],
  minha_resposta: 'pendente',
});
const DE_OUTRO = oc({
  ocorrencia_id: 3,
  titulo: '1:1 Bruno e Carla',
  organizador_id: 'u-bruno',
  participantes: [{ user_id: 'u-carla', resposta: 'sim' }],
  minha_resposta: null,
});

// Same shape getWorkspaceUsers() returns (flattened; id = auth uid).
const ROSTER = [
  { id: 'u-me', nome: 'Ana Lima', avatar_url: null },
  { id: 'u-bruno', nome: 'Bruno Costa', avatar_url: null },
  { id: 'u-carla', nome: 'Carla Mendes', avatar_url: null },
];

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.search}</div>;
}

function renderTab(url = '/calendario') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <AgendaTab />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

const mqListeners = new Map<string, Set<(e: { matches: boolean }) => void>>();

function stubMatchMedia(matching: (q: string) => boolean) {
  mqListeners.clear();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: matching(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        if (!mqListeners.has(query)) mqListeners.set(query, new Set());
        mqListeners.get(query)!.add(fn);
      },
      removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        mqListeners.get(query)?.delete(fn);
      },
      dispatchEvent: vi.fn(),
    }),
  });
}

/** Resize: re-stub matchMedia and fire every registered change listener. */
function resizeTo(matching: (q: string) => boolean) {
  const atuais = [...mqListeners.entries()];
  stubMatchMedia(matching);
  act(() => {
    for (const [query, fns] of atuais) fns.forEach((fn) => fn({ matches: matching(query) }));
  });
}

describe('AgendaTab', () => {
  beforeEach(() => {
    localStorage.clear();
    fc.props = null;
    Object.values(fc.api).forEach((f) => f.mockReset());
    moverMock.mockReset();
    vi.mocked(toast).mockReset();
    stubMatchMedia(() => false);
    vi.mocked(agendaStore.listAgenda).mockResolvedValue([MEU, CONVIDADO, DE_OUTRO]);
    vi.mocked(agendaStore.getAgendaOcorrencia).mockResolvedValue(null);
    vi.mocked(workspaceStore.getWorkspaceUsers).mockResolvedValue(ROSTER);
  });

  it('fetches the range FullCalendar reports through datesSet and renders the events', async () => {
    renderTab();

    await waitFor(() =>
      expect(agendaStore.listAgenda).toHaveBeenCalledWith(RANGE.start, RANGE.end),
    );
    expect(await screen.findByText('Reunião de pauta')).toBeInTheDocument();
    expect(screen.getByText('Gravação: Clínica Sorriso')).toBeInTheDocument();
    expect(screen.getByText('1:1 Bruno e Carla')).toBeInTheDocument();
    expect(fc.props?.initialView).toBe('timeGridWeek');
    expect(screen.getByRole('heading', { name: '5 a 11 de outubro de 2026' })).toBeInTheDocument();
  });

  it('"Minha agenda" keeps only events where the user organizes or participates', async () => {
    renderTab();
    await screen.findByText('1:1 Bruno e Carla');

    fireEvent.click(screen.getByRole('radio', { name: 'Minha agenda' }));

    await waitFor(() => expect(screen.queryByText('1:1 Bruno e Carla')).not.toBeInTheDocument());
    expect(screen.getByText('Reunião de pauta')).toBeInTheDocument();
    expect(screen.getByText('Gravação: Clínica Sorriso')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('agenda-filtro') ?? '{}')).toMatchObject({
      modo: 'minha',
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Toda a equipe' }));
    expect(await screen.findByText('1:1 Bruno e Carla')).toBeInTheDocument();
  });

  it('unchecking a person hides the events only that person is in', async () => {
    renderTab();
    await screen.findByText('1:1 Bruno e Carla');
    expect(await screen.findByText('Ana Lima (você)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Carla Mendes' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bruno Costa' }));

    await waitFor(() => expect(screen.queryByText('1:1 Bruno e Carla')).not.toBeInTheDocument());
    expect(screen.getByText('Reunião de pauta')).toBeInTheDocument();
  });

  it('?evento=42 loads that occurrence, moves the grid to it and opens the popover', async () => {
    vi.mocked(agendaStore.getAgendaOcorrencia).mockResolvedValue(
      oc({ ocorrencia_id: 42, titulo: 'Alinhamento: Dr. Paulo', inicio: '2026-10-07T14:00:00Z' }),
    );
    renderTab('/calendario?evento=42');

    await waitFor(() => expect(agendaStore.getAgendaOcorrencia).toHaveBeenCalledWith(42));
    expect(await screen.findByTestId('evento-popover')).toHaveTextContent('Alinhamento: Dr. Paulo');
    expect(fc.api.gotoDate).toHaveBeenCalledWith(new Date('2026-10-07T14:00:00Z'));
    expect(toast).not.toHaveBeenCalled();
    // Outside the loaded rows, so the popover shows the fetched snapshot.
    expect(screen.getByTestId('evento-popover')).toHaveAttribute('data-anchor-id', 'container');
  });

  it('drops ?evento= once the popover opens, so it is not reopened later', async () => {
    vi.mocked(agendaStore.getAgendaOcorrencia).mockResolvedValue(
      oc({ ocorrencia_id: 42, titulo: 'Alinhamento: Dr. Paulo', inicio: '2026-10-07T14:00:00Z' }),
    );
    const { unmount } = renderTab('/calendario?evento=42&x=1');

    expect(await screen.findByTestId('evento-popover')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?x=1'));
    expect(screen.getByTestId('location')).not.toHaveTextContent('evento');
    expect(agendaStore.getAgendaOcorrencia).toHaveBeenCalledTimes(1);

    // Tab switch and back = AgendaTab remounts on the now clean URL.
    unmount();
    renderTab('/calendario?x=1');
    await screen.findByText('Reunião de pauta');
    expect(screen.queryByTestId('evento-popover')).not.toBeInTheDocument();
    expect(agendaStore.getAgendaOcorrencia).toHaveBeenCalledTimes(1);
  });

  it('keeps the popover on fresh data and a live anchor after a refetch', async () => {
    const { queryClient } = renderTab();
    await screen.findByText('Gravação: Clínica Sorriso');

    const chip = screen.getByText('Gravação: Clínica Sorriso');
    act(() =>
      fc.props!.eventClick({
        el: chip,
        jsEvent: { preventDefault: vi.fn() },
        event: { extendedProps: { ocorrencia: CONVIDADO } },
      }),
    );
    const pop = await screen.findByTestId('evento-popover');
    expect(pop).toHaveAttribute('data-anchor-id', '2');
    expect(pop).toHaveAttribute('data-anchor-connected', 'true');

    // An RSVP/edit elsewhere invalidates the agenda; the chip is re-rendered.
    vi.mocked(agendaStore.listAgenda).mockResolvedValue([
      MEU,
      { ...CONVIDADO, titulo: 'Gravação remarcada', minha_resposta: 'sim' },
      DE_OUTRO,
    ]);
    await act(() => queryClient.invalidateQueries({ queryKey: ['agenda-ocorrencias'] }));

    await waitFor(() =>
      expect(screen.getByTestId('evento-popover')).toHaveTextContent('Gravação remarcada'),
    );
    expect(chip.isConnected).toBe(false);
    const atual = screen.getByTestId('evento-popover');
    expect(atual).toHaveAttribute('data-anchor-connected', 'true');
    expect(atual).toHaveAttribute('data-anchor-id', '2');
  });

  it('?evento= that does not exist shows a toast and drops the param', async () => {
    renderTab('/calendario?evento=99&x=1');

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Este evento não existe mais ou você não tem acesso.'),
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?x=1'));
    expect(screen.queryByTestId('evento-popover')).not.toBeInTheDocument();
  });

  it('?evento= that is not a number never queries and drops the param', async () => {
    renderTab('/calendario?evento=abc');

    await waitFor(() => expect(screen.getByTestId('location')).toBeEmptyDOMElement());
    expect(agendaStore.getAgendaOcorrencia).not.toHaveBeenCalled();
  });

  it('?data=yyyy-mm-dd only positions the grid', async () => {
    renderTab('/calendario?data=2026-12-24');

    await waitFor(() => expect(fc.api.gotoDate).toHaveBeenCalledWith(new Date(2026, 11, 24)));
    expect(screen.queryByTestId('evento-popover')).not.toBeInTheDocument();
  });

  it('starts in listWeek on a phone, with the floating create button', async () => {
    stubMatchMedia((q) => q.includes('max-width: 767px') || q.includes('max-width: 1100px'));
    renderTab();

    await screen.findByText('Reunião de pauta');
    expect(fc.props?.initialView).toBe('listWeek');
    expect(screen.getByRole('button', { name: 'Criar evento' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Lista' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Semana' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pessoas e filtros' })).toBeInTheDocument();
  });

  it('switching the view toggle calls changeView on the calendar', async () => {
    renderTab();
    await screen.findByText('Reunião de pauta');

    fireEvent.click(screen.getByRole('radio', { name: 'Mês' }));
    expect(fc.api.changeView).toHaveBeenCalledWith('dayGridMonth');
  });

  it('selecting a slot opens the create form; clicking an event opens the popover', async () => {
    renderTab();
    await screen.findByText('Reunião de pauta');

    act(() =>
      fc.props!.select({
        start: new Date(2026, 9, 6, 9),
        end: new Date(2026, 9, 6, 10),
        allDay: false,
      }),
    );
    expect(await screen.findByTestId('evento-form')).toHaveTextContent('criar dia-inteiro:false');

    const el = document.createElement('div');
    act(() =>
      fc.props!.eventClick({
        el,
        jsEvent: { preventDefault: vi.fn() },
        event: { extendedProps: { ocorrencia: CONVIDADO } },
      }),
    );
    expect(await screen.findByTestId('evento-popover')).toHaveTextContent(
      'Gravação: Clínica Sorriso',
    );

    fireEvent.click(screen.getByRole('button', { name: 'editar-stub' }));
    expect(await screen.findByTestId('evento-form')).toHaveTextContent('editar');
    expect(screen.queryByTestId('evento-popover')).not.toBeInTheDocument();
  });

  it('dragging an event hands it to useAgendaMutations.mover', async () => {
    renderTab();
    await screen.findByText('Reunião de pauta');

    const revert = vi.fn();
    const start = new Date(2026, 9, 7, 9);
    const end = new Date(2026, 9, 7, 10);
    fc.props!.eventDrop({ event: { start, end, extendedProps: { ocorrencia: MEU } }, revert });
    expect(moverMock).toHaveBeenCalledWith(MEU, start, end, revert);
  });
});

describe('AgendaTab resize', () => {
  beforeEach(() => {
    fc.props = null;
    Object.values(fc.api).forEach((f) => f.mockReset());
    stubMatchMedia(() => false);
    vi.mocked(agendaStore.listAgenda).mockResolvedValue([MEU]);
    vi.mocked(workspaceStore.getWorkspaceUsers).mockResolvedValue(ROSTER);
  });

  it('leaves the week view when the window shrinks to a phone', async () => {
    renderTab();
    await screen.findByText('Reunião de pauta');
    expect(fc.api.changeView).not.toHaveBeenCalled();

    resizeTo((q) => q.includes('max-width: 767px') || q.includes('max-width: 1100px'));

    await waitFor(() => expect(fc.api.changeView).toHaveBeenCalledWith('listWeek'));
  });
});

describe('permitirArraste (eventAllow)', () => {
  it('rejects moving between the all-day row and the time grid', () => {
    expect(permitirArraste({ allDay: true }, { allDay: false })).toBe(false);
    expect(permitirArraste({ allDay: false }, { allDay: true })).toBe(false);
  });

  it('allows same-kind moves and external drops', () => {
    expect(permitirArraste({ allDay: false }, { allDay: false })).toBe(true);
    expect(permitirArraste({ allDay: true }, { allDay: true })).toBe(true);
    expect(permitirArraste({ allDay: true }, null)).toBe(true);
  });

  it('is wired into FullCalendar', async () => {
    stubMatchMedia(() => false);
    vi.mocked(agendaStore.listAgenda).mockResolvedValue([]);
    vi.mocked(workspaceStore.getWorkspaceUsers).mockResolvedValue(ROSTER);
    renderTab();
    await waitFor(() => expect(fc.props).not.toBeNull());
    expect(fc.props!.eventAllow).toBe(permitirArraste);
  });
});

describe('tituloDoPeriodo', () => {
  it('formats weeks, months and days without dashes', () => {
    expect(tituloDoPeriodo('timeGridWeek', new Date(2026, 9, 5), new Date(2026, 9, 12))).toBe(
      '5 a 11 de outubro de 2026',
    );
    expect(tituloDoPeriodo('timeGridWeek', new Date(2026, 8, 28), new Date(2026, 9, 5))).toBe(
      '28 de setembro a 4 de outubro de 2026',
    );
    expect(tituloDoPeriodo('listWeek', new Date(2025, 11, 29), new Date(2026, 0, 5))).toBe(
      '29 de dezembro de 2025 a 4 de janeiro de 2026',
    );
    expect(tituloDoPeriodo('dayGridMonth', new Date(2026, 9, 1), new Date(2026, 10, 1))).toBe(
      'Outubro de 2026',
    );
    expect(tituloDoPeriodo('timeGridDay', new Date(2026, 9, 5), new Date(2026, 9, 6))).toBe(
      'Segunda, 5 de outubro de 2026',
    );
  });
});
