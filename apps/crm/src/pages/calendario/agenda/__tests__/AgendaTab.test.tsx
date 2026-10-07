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
const { moverMock, rapido } = vi.hoisted(() => ({
  moverMock: vi.fn(),
  rapido: { montagens: 0, fechamentos: [] as (() => void)[] },
}));
vi.mock('../EventoFormDialog', () => ({
  EventoFormDialog: (p: {
    open: boolean;
    modo: string;
    inicial?: { inicio: Date; diaInteiro: boolean };
    rascunho?: { titulo?: string };
  }) =>
    p.open ? (
      <div data-testid="evento-form">
        {p.modo}
        {p.inicial ? ` dia-inteiro:${String(p.inicial.diaInteiro)}` : ''}
        {p.inicial ? ` inicio:${p.inicial.inicio.getHours()}h` : ''}
        {p.rascunho ? ` rascunho:${p.rascunho.titulo ?? ''}` : ''}
      </div>
    ) : null,
}));
vi.mock('../FeedAgendaDialog', () => ({
  FeedAgendaDialog: (p: { open: boolean; onOpenChange: (v: boolean) => void }) =>
    p.open ? (
      <div data-testid="feed-dialog">
        <button type="button" onClick={() => p.onOpenChange(false)}>
          fechar-feed-stub
        </button>
      </div>
    ) : null,
}));
vi.mock('../EventoRapidoCard', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    EventoRapidoCard: (p: {
      inicial: { inicio: Date; fim: Date; diaInteiro: boolean };
      anchor: HTMLElement;
      onRascunhoChange: (r: {
        inicio: Date;
        fim: Date;
        diaInteiro: boolean;
        titulo: string;
        tipo: string;
      }) => void;
      onClose: () => void;
      onMaisOpcoes: (v: Record<string, unknown>) => void;
    }) => {
      React.useEffect(() => {
        rapido.montagens += 1;
        rapido.fechamentos.push(p.onClose);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <div
          data-testid="evento-rapido"
          data-anchor-id={p.anchor.dataset.ocorrenciaId ?? 'outro'}
          data-anchor-connected={String(p.anchor.isConnected)}
          data-fim={`${p.inicial.fim.getHours()}:${p.inicial.fim.getMinutes()}`}
        >
          {`rapido inicio:${p.inicial.inicio.getHours()}h dia-inteiro:${String(p.inicial.diaInteiro)}`}
          <button
            type="button"
            onClick={() =>
              p.onRascunhoChange({
                inicio: new Date(2026, 9, 6, 14),
                fim: new Date(2026, 9, 6, 15),
                diaInteiro: false,
                titulo: 'Pauta ao vivo',
                tipo: 'gravacao',
              })
            }
          >
            digitar-stub
          </button>
          <button type="button" onClick={() => p.onMaisOpcoes({ titulo: 'Pauta ao vivo' })}>
            mais-stub
          </button>
          <button type="button" onClick={p.onClose}>
            fechar-stub
          </button>
        </div>
      );
    },
  };
});
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

// ---- Layers: the data hook and the popover have their own suites --------------------
const { camadasMock } = vi.hoisted(() => ({
  camadasMock: {
    itens: [] as unknown[],
    chamadas: [] as { ativas: Record<string, boolean>; fin: unknown; nicho: string }[],
  },
}));
vi.mock('../../camadas/useCamadas', () => ({
  useCamadas: (_periodo: unknown, ativas: Record<string, boolean>, fin: unknown, nicho: string) => {
    camadasMock.chamadas.push({ ativas, fin, nicho });
    return camadasMock.itens;
  },
}));
vi.mock('../../camadas/CamadaPopover', () => ({
  CamadaPopover: (p: { item: { id: string }; anchor: HTMLElement; onClose: () => void }) => (
    <div data-testid="camada-popover" data-anchor-id={p.anchor.dataset.ocorrenciaId ?? 'container'}>
      {p.item.id}
      <button type="button" onClick={p.onClose}>
        fechar-camada-stub
      </button>
    </div>
  ),
}));

// ---- App modules ------------------------------------------------------------------
let podeEditar: boolean | 'unknown' = true;
let verFinanceiro: boolean | 'unknown' | undefined = undefined;
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-me' },
    canSeeFinancials: verFinanceiro,
    can: (mod: string, acao?: string) =>
      mod === 'calendario' && acao === 'editar' ? podeEditar : true,
  }),
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
    podeEditar = true;
    verFinanceiro = undefined;
    camadasMock.itens = [];
    camadasMock.chamadas = [];
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

  it.each([false, 'unknown'] as const)(
    'without calendario:editar (%s) there is no way to start creating an event',
    async (valor) => {
      podeEditar = valor;
      renderTab();
      await waitFor(() => expect(fc.props).not.toBeNull());
      expect(screen.queryByRole('button', { name: 'Criar evento' })).toBeNull();
      expect(fc.props?.selectable).toBe(false);
    },
  );

  it.each([true, false, 'unknown'] as const)(
    'the sync button opens the feed dialog whatever the edit permission (%s)',
    async (valor) => {
      podeEditar = valor;
      renderTab();
      await waitFor(() => expect(fc.props).not.toBeNull());
      expect(screen.queryByTestId('feed-dialog')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Sincronizar com seu calendário' }));
      expect(screen.getByTestId('feed-dialog')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'fechar-feed-stub' }));
      expect(screen.queryByTestId('feed-dialog')).toBeNull();
    },
  );

  it('with calendario:editar the create button and select-to-create are on', async () => {
    renderTab();
    await waitFor(() => expect(fc.props).not.toBeNull());
    expect(screen.getAllByRole('button', { name: 'Criar evento' }).length).toBeGreaterThan(0);
    expect(fc.props?.selectable).toBe(true);
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

  it('selecting a slot opens the quick card; clicking an event opens the popover', async () => {
    renderTab();
    await screen.findByText('Reunião de pauta');

    act(() =>
      fc.props!.select({
        start: new Date(2026, 9, 6, 9),
        end: new Date(2026, 9, 6, 10),
        allDay: false,
      }),
    );
    expect(await screen.findByTestId('evento-rapido')).toHaveTextContent(
      'rapido inicio:9h dia-inteiro:false',
    );
    expect(screen.queryByTestId('evento-form')).not.toBeInTheDocument();

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
    // Opening an event drops the draft.
    expect(screen.queryByTestId('evento-rapido')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'editar-stub' }));
    expect(await screen.findByTestId('evento-form')).toHaveTextContent('editar');
    expect(screen.queryByTestId('evento-popover')).not.toBeInTheDocument();
  });

  describe('quick create', () => {
    const selecionar = (start: Date, end: Date, allDay = false) =>
      act(() => fc.props!.select({ start, end, allDay }));

    it('a late close from an earlier card leaves the newer draft alone', async () => {
      rapido.fechamentos = [];
      renderTab();
      await screen.findByText('Reunião de pauta');
      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 10));
      await screen.findByTestId('evento-rapido');
      selecionar(new Date(2026, 9, 7, 14), new Date(2026, 9, 7, 15));
      // Also wait for the second card's mount effect: the stub records onClose
      // after commit, so the text can match before the close exists.
      await waitFor(() => {
        expect(screen.getByTestId('evento-rapido')).toHaveTextContent('inicio:14h');
        expect(rapido.fechamentos).toHaveLength(2);
      });
      // What the first card's save calls when it resolves after the second select.
      act(() => rapido.fechamentos[0]());
      expect(screen.getByTestId('evento-rapido')).toHaveTextContent('inicio:14h');
      expect(screen.getByText('(Sem título)')).toBeInTheDocument();
      // The current card's own close still works.
      act(() => rapido.fechamentos[rapido.fechamentos.length - 1]());
      expect(screen.queryByTestId('evento-rapido')).not.toBeInTheDocument();
    });

    it('a single-slot click (30 min) starts a 1 h draft; a drag keeps its range', async () => {
      renderTab();
      await screen.findByText('Reunião de pauta');
      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 9, 30));
      expect(await screen.findByTestId('evento-rapido')).toHaveAttribute('data-fim', '10:0');
      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 11, 30));
      await waitFor(() =>
        expect(screen.getByTestId('evento-rapido')).toHaveAttribute('data-fim', '11:30'),
      );
    });

    beforeEach(() => {
      rapido.montagens = 0;
    });

    it('a desktop select drops a draft chip, anchors the card to it and unselects', async () => {
      renderTab();
      await screen.findByText('Reunião de pauta');

      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 10));

      const card = await screen.findByTestId('evento-rapido');
      expect(fc.api.unselect).toHaveBeenCalled();
      expect(screen.getByText('(Sem título)')).toBeInTheDocument();
      await waitFor(() => expect(card).toHaveAttribute('data-anchor-id', 'rascunho'));
      const draft = (fc.props!.events as Array<Record<string, any>>).find(
        (e) => e.id === 'rascunho',
      );
      expect(draft).toMatchObject({
        title: '(Sem título)',
        start: new Date(2026, 9, 6, 9),
        end: new Date(2026, 9, 6, 10),
        allDay: false,
        editable: false,
        classNames: ['agenda-ev', 'agenda-ev--rascunho'],
        borderColor: '#3b82f6',
        extendedProps: { rascunho: 1, ordem: 0 },
      });
      expect(draft!.extendedProps.ocorrencia).toBeUndefined();
      // Agenda events (ordem 0) before layers, the draft first among them, so
      // "+N mais" never folds it away.
      expect(fc.props!.eventOrder).toBe('ordem,rascunho,start,-duration,allDay,title');
    });

    it('the chip follows the card without remounting it, on a live anchor', async () => {
      renderTab();
      await screen.findByText('Reunião de pauta');
      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 10));
      await screen.findByTestId('evento-rapido');

      fireEvent.click(screen.getByRole('button', { name: 'digitar-stub' }));

      expect(await screen.findByText('Pauta ao vivo')).toBeInTheDocument();
      expect(screen.queryByText('(Sem título)')).not.toBeInTheDocument();
      const draft = (fc.props!.events as Array<Record<string, any>>).find(
        (e) => e.id === 'rascunho',
      );
      expect(draft).toMatchObject({
        start: new Date(2026, 9, 6, 14),
        end: new Date(2026, 9, 6, 15),
        borderColor: '#e1306c',
      });
      // The mock re-creates the chip node on a title change: the card re-anchors.
      await waitFor(() =>
        expect(screen.getByTestId('evento-rapido')).toHaveAttribute(
          'data-anchor-connected',
          'true',
        ),
      );
      expect(screen.getByTestId('evento-rapido')).toHaveAttribute('data-anchor-id', 'rascunho');
      expect(rapido.montagens).toBe(1);

      // A new selection, even on the same slot, remounts the card.
      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 10));
      await waitFor(() => expect(rapido.montagens).toBe(2));
      expect(await screen.findByText('(Sem título)')).toBeInTheDocument();
    });

    it('a phone select opens the full editor directly', async () => {
      stubMatchMedia((q) => q.includes('max-width: 767px') || q.includes('max-width: 1100px'));
      renderTab();
      await screen.findByText('Reunião de pauta');

      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 10));

      expect(await screen.findByTestId('evento-form')).toHaveTextContent('criar dia-inteiro:false');
      expect(screen.queryByTestId('evento-rapido')).not.toBeInTheDocument();
      expect(screen.queryByText('(Sem título)')).not.toBeInTheDocument();
    });

    it('"Mais opções" swaps the card for the full editor, carrying the draft', async () => {
      renderTab();
      await screen.findByText('Reunião de pauta');
      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 10));
      await screen.findByTestId('evento-rapido');
      fireEvent.click(screen.getByRole('button', { name: 'digitar-stub' }));
      await screen.findByText('Pauta ao vivo');

      fireEvent.click(screen.getByRole('button', { name: 'mais-stub' }));

      // The live range (moved to 14h in the card), not the original selection.
      expect(await screen.findByTestId('evento-form')).toHaveTextContent(
        'criar dia-inteiro:false inicio:14h rascunho:Pauta ao vivo',
      );
      expect(screen.queryByTestId('evento-rapido')).not.toBeInTheDocument();
      expect(screen.queryByText('Pauta ao vivo')).not.toBeInTheDocument();
    });

    it('closing the card removes it and the draft chip', async () => {
      renderTab();
      await screen.findByText('Reunião de pauta');
      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 10));
      await screen.findByTestId('evento-rapido');

      fireEvent.click(screen.getByRole('button', { name: 'fechar-stub' }));

      await waitFor(() => expect(screen.queryByTestId('evento-rapido')).not.toBeInTheDocument());
      expect(screen.queryByText('(Sem título)')).not.toBeInTheDocument();
      expect(screen.queryByTestId('evento-form')).not.toBeInTheDocument();
    });

    it('a month-view day click drops an all-day draft', async () => {
      renderTab();
      await screen.findByText('Reunião de pauta');
      selecionar(new Date(2026, 9, 8), new Date(2026, 9, 9), true);

      expect(await screen.findByTestId('evento-rapido')).toHaveTextContent('dia-inteiro:true');
      const draft = (fc.props!.events as Array<Record<string, any>>).find(
        (e) => e.id === 'rascunho',
      );
      expect(draft).toMatchObject({ allDay: true, start: new Date(2026, 9, 8) });
    });

    it('clicking the draft chip never opens the event popover', async () => {
      renderTab();
      await screen.findByText('Reunião de pauta');
      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 10));
      await screen.findByTestId('evento-rapido');

      const preventDefault = vi.fn();
      act(() =>
        fc.props!.eventClick({
          el: screen.getByText('(Sem título)'),
          jsEvent: { preventDefault },
          event: { extendedProps: { rascunho: 1 } },
        }),
      );
      expect(preventDefault).toHaveBeenCalled();
      expect(screen.queryByTestId('evento-popover')).not.toBeInTheDocument();
      expect(screen.getByTestId('evento-rapido')).toBeInTheDocument();
    });

    it('shrinking to a phone drops the draft', async () => {
      renderTab();
      await screen.findByText('Reunião de pauta');
      selecionar(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 10));
      await screen.findByTestId('evento-rapido');

      resizeTo((q) => q.includes('max-width: 767px') || q.includes('max-width: 1100px'));

      await waitFor(() => expect(screen.queryByTestId('evento-rapido')).not.toBeInTheDocument());
      expect(screen.queryByText('(Sem título)')).not.toBeInTheDocument();
    });
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

describe('AgendaTab layers', () => {
  const POST = {
    camada: 'posts',
    id: 'posts:9',
    inicio: '2026-10-06T13:00:00.000Z',
    post: { id: 9, titulo: 'Carrossel', cliente_nome: 'Clínica', platform: 'instagram' },
    estado: 'agendado',
  };

  beforeEach(() => {
    podeEditar = true;
    verFinanceiro = undefined;
    camadasMock.itens = [];
    camadasMock.chamadas = [];
    localStorage.clear();
    fc.props = null;
    Object.values(fc.api).forEach((f) => f.mockReset());
    moverMock.mockReset();
    stubMatchMedia(() => false);
    vi.mocked(agendaStore.listAgenda).mockResolvedValue([MEU]);
    vi.mocked(agendaStore.getAgendaOcorrencia).mockResolvedValue(null);
    vi.mocked(workspaceStore.getWorkspaceUsers).mockResolvedValue(ROSTER);
  });

  const ultimaChamada = () => camadasMock.chamadas[camadasMock.chamadas.length - 1];

  it('the sidebar has a Camadas group between Pessoas and Legenda, financial ones hidden', async () => {
    renderTab();
    await screen.findByText('Reunião de pauta');

    const grupo = screen.getByRole('group', { name: 'Camadas' });
    for (const nome of [
      'Posts agendados',
      'Prazos de entrega',
      'Datas dos clientes',
      'Datas comemorativas',
    ]) {
      expect(screen.getByRole('checkbox', { name: nome })).toBeInTheDocument();
    }
    expect(screen.queryByRole('checkbox', { name: 'Recebimentos' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Pagamentos da equipe' })).toBeNull();
    // DOM order: people list, layers, legend.
    const pessoas = screen.getByText('Pessoas');
    const legenda = screen.getByText('Legenda');
    expect(pessoas.compareDocumentPosition(grupo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(grupo.compareDocumentPosition(legenda) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ultimaChamada().fin).toBeUndefined();
  });

  it('shows the financial toggles and forwards access with canSeeFinancials === true', async () => {
    verFinanceiro = true;
    renderTab();
    await screen.findByText('Reunião de pauta');
    expect(screen.getByRole('checkbox', { name: 'Recebimentos' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Pagamentos da equipe' })).toBeChecked();
    expect(ultimaChamada().fin).toBe(true);
  });

  it('a toggle reaches useCamadas and is remembered; the niche picker follows its layer', async () => {
    renderTab();
    await screen.findByText('Reunião de pauta');
    expect(ultimaChamada().ativas.comemorativas).toBe(false);
    expect(screen.queryByRole('combobox', { name: 'Nicho' })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Datas comemorativas' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Posts agendados' }));

    expect(ultimaChamada().ativas).toMatchObject({ comemorativas: true, posts: false });
    expect(JSON.parse(localStorage.getItem('agenda-camadas')!)).toMatchObject({
      comemorativas: true,
      posts: false,
    });
    expect(screen.getByRole('combobox', { name: 'Nicho' })).toBeInTheDocument();
    expect(ultimaChamada().nicho).toBe('medico');
  });

  it('layer items join the grid read-only, after Agenda events', async () => {
    camadasMock.itens = [POST];
    renderTab();
    await screen.findByText('Reunião de pauta');

    const eventos = fc.props!.events as Array<Record<string, any>>;
    const agenda = eventos.find((e) => e.id === String(MEU.ocorrencia_id));
    const camada = eventos.find((e) => e.id === 'camada:posts:9');
    expect(agenda!.extendedProps.ordem).toBe(0);
    expect(camada).toMatchObject({ editable: false, extendedProps: { ordem: 1, camada: POST } });
    expect(camada!.classNames).toEqual(['agenda-camada', 'agenda-camada--posts']);
  });

  it('clicking a layer chip opens its popover, never the event popover', async () => {
    camadasMock.itens = [POST];
    renderTab();
    await screen.findByText('Reunião de pauta');

    const chip = document.querySelector<HTMLElement>('[data-ocorrencia-id="camada:posts:9"]')!;
    act(() => {
      fc.props!.eventClick({
        jsEvent: { preventDefault: vi.fn() },
        event: { extendedProps: { camada: POST } },
        el: chip,
      });
    });
    expect(screen.getByTestId('camada-popover')).toHaveTextContent('posts:9');
    expect(screen.getByTestId('camada-popover')).toHaveAttribute(
      'data-anchor-id',
      'camada:posts:9',
    );
    expect(screen.queryByTestId('evento-popover')).toBeNull();

    // Opening an Agenda event swaps the popovers.
    const evChip = document.querySelector<HTMLElement>(
      `[data-ocorrencia-id="${MEU.ocorrencia_id}"]`,
    )!;
    act(() => {
      fc.props!.eventClick({
        jsEvent: { preventDefault: vi.fn() },
        event: { extendedProps: { ocorrencia: MEU } },
        el: evChip,
      });
    });
    expect(screen.queryByTestId('camada-popover')).toBeNull();
    expect(screen.getByTestId('evento-popover')).toBeInTheDocument();
  });

  it('a layer item can never be dragged: eventAllow refuses, a drop reverts', async () => {
    camadasMock.itens = [POST];
    renderTab();
    await screen.findByText('Reunião de pauta');

    expect(
      fc.props!.eventAllow({ allDay: false }, { allDay: false, extendedProps: { camada: POST } }),
    ).toBe(false);
    const revert = vi.fn();
    fc.props!.eventDrop({
      event: { start: new Date(), end: null, extendedProps: { camada: POST } },
      revert,
    });
    expect(revert).toHaveBeenCalled();
    expect(moverMock).not.toHaveBeenCalled();
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
