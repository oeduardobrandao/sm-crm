import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type FullCalendar from '@fullcalendar/react';
import type { DatesSetArg, EventInput } from '@fullcalendar/core';
import { addHours, format, startOfHour } from 'date-fns';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/context/AuthContext';
import {
  AGENDA_QUERY_KEY,
  getAgendaOcorrencia,
  listAgenda,
  type AgendaOcorrencia,
} from '../../../store/agenda';
import { getWorkspaceUsers } from '../../../store/workspace';
import { parseDateOnly } from '../../tarefas/tarefasLogic';
import { TIPO_COR, filtrarPorPessoas, toEventInput } from './agendaLogic';
import AgendaView, { tituloDoPeriodo, type AgendaViewType } from './AgendaView';
import AgendaSidebar, {
  FILTRO_PADRAO,
  idsDoFiltro,
  type AgendaFiltro,
  type AgendaPessoa,
} from './AgendaSidebar';
import { EventoFormDialog } from './EventoFormDialog';
import { FeedAgendaDialog } from './FeedAgendaDialog';
import { EventoPopover } from './EventoPopover';
import { EventoRapidoCard, type RascunhoEvento } from './EventoRapidoCard';
import { valoresIniciaisCriar, type EventoFormValues } from './eventoFormSchema';
import { useAgendaMutations } from './useAgendaMutations';
import { gravarCamadas, lerCamadas } from '../camadas/camadasStorage';
import { CamadaPopover } from '../camadas/CamadaPopover';
import {
  CAMADAS_FINANCEIRAS,
  ORDEM_AGENDA,
  type CamadaItem,
  type CamadasAtivas,
} from '../camadas/tipos';
import { toCamadaEventInput } from '../camadas/toCamadaEventInput';
import { useCamadas } from '../camadas/useCamadas';
import { useConfirmarPagamento } from '../camadas/useConfirmarPagamento';
import {
  DEFAULT_NICHE_KEY,
  NICHE_CALENDARS,
  readStoredNicheKey,
  writeStoredNicheKey,
} from '../nicheCalendars/registry';

const FILTRO_KEY = 'agenda-filtro';
const NAO_ENCONTRADO = 'Este evento não existe mais ou você não tem acesso.';
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Event id of the quick-create draft chip (also its data-ocorrencia-id). */
const RASCUNHO_ID = 'rascunho';

/** max-width queries on purpose: the test setup stubs matchMedia with
 *  `matches: false`, which then means "desktop". */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

function lerFiltro(): AgendaFiltro {
  try {
    const raw = localStorage.getItem(FILTRO_KEY);
    if (!raw) return FILTRO_PADRAO;
    const v = JSON.parse(raw) as Partial<AgendaFiltro>;
    return {
      modo: v.modo === 'minha' ? 'minha' : 'equipe',
      ocultos: Array.isArray(v.ocultos) ? v.ocultos.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return FILTRO_PADRAO;
  }
}

function gravarFiltro(f: AgendaFiltro) {
  try {
    localStorage.setItem(FILTRO_KEY, JSON.stringify(f));
  } catch {
    // Private mode / blocked storage: the filter just isn't remembered.
  }
}

/** Row shape returned by getWorkspaceUsers() (already flattened: id = auth uid). */
interface WorkspaceUserRow {
  id: string;
  nome: string | null;
  avatar_url: string | null;
}

interface Intervalo {
  inicio: Date;
  /** Exclusive for all-day ranges (FullCalendar). */
  fim: Date;
  diaInteiro: boolean;
}

type FormState =
  | { modo: 'criar'; inicial: Intervalo; rascunho?: Partial<EventoFormValues> }
  | { modo: 'editar'; ocorrencia: AgendaOcorrencia };

const mesmoRascunho = (a: RascunhoEvento, b: RascunhoEvento) =>
  a.inicio.getTime() === b.inicio.getTime() &&
  a.fim.getTime() === b.fim.getTime() &&
  a.diaInteiro === b.diaInteiro &&
  a.titulo === b.titulo &&
  a.tipo === b.tipo;

/** The draft as a grid chip, styled like toEventInput's. Not editable: the card
 *  moves it. No extendedProps.ocorrencia (eventClick ignores it). */
function rascunhoEventInput(r: RascunhoEvento): EventInput {
  const cor = TIPO_COR[r.tipo];
  return {
    id: RASCUNHO_ID,
    title: r.titulo.trim() || '(Sem título)',
    start: r.inicio,
    end: r.fim,
    allDay: r.diaInteiro,
    editable: false,
    classNames: ['agenda-ev', 'agenda-ev--rascunho'],
    backgroundColor: `${cor}24`,
    borderColor: cor,
    textColor: 'var(--text-main)',
    extendedProps: { rascunho: 1, ordem: ORDEM_AGENDA },
  };
}

interface Periodo {
  start: Date;
  end: Date;
  view: AgendaViewType;
  titulo: string;
  currentStart: Date;
  currentEnd: Date;
}

const inicioDaOcorrencia = (o: AgendaOcorrencia) =>
  o.dia_inteiro ? parseDateOnly(o.data_inicio_local) : new Date(o.inicio);

export default function AgendaTab() {
  const { user, can, canSeeFinancials } = useAuth();
  const meuId = user?.id ?? null;
  // View-only roles never see the create entry points ('unknown' = still resolving).
  const podeCriar = can('calendario', 'editar') === true;
  const isMobile = useMediaQuery('(max-width: 767px)');
  const sidebarEmSheet = useMediaQuery('(max-width: 1100px)');
  const [searchParams, setSearchParams] = useSearchParams();

  const calRef = useRef<FullCalendar | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const [dataSelecionada, setDataSelecionada] = useState(() => new Date());
  const [filtro, setFiltro] = useState<AgendaFiltro>(lerFiltro);
  // Only the id is the source of truth: the occurrence is re-read from the
  // current query data (the snapshot covers rows outside the loaded range) and
  // the anchor is re-resolved when FullCalendar replaces the chip.
  const [popover, setPopover] = useState<{
    id: number;
    snapshot: AgendaOcorrencia;
    anchorEl: HTMLElement;
  } | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  // Quick create (desktop): the selection as a draft chip plus the card next to it.
  // `rascunhoInicial` seeds the card; `rascunho` follows what the card has typed;
  // `selecao` keys the card so every new selection remounts it.
  const [rascunho, setRascunho] = useState<RascunhoEvento | null>(null);
  const [rascunhoInicial, setRascunhoInicial] = useState<Intervalo | null>(null);
  const [selecao, setSelecao] = useState(0);
  const selecaoRef = useRef(0);
  const [anchorRascunho, setAnchorRascunho] = useState<HTMLElement | null>(null);
  const [sheetAberto, setSheetAberto] = useState(false);
  const [feedAberto, setFeedAberto] = useState(false);
  const { mover, dialog } = useAgendaMutations();
  // Read-only layers (spec §1): toggles and niche are per browser.
  const [camadasAtivas, setCamadasAtivas] = useState<CamadasAtivas>(lerCamadas);
  const [nichoKey, setNichoKey] = useState(() =>
    readStoredNicheKey(
      NICHE_CALENDARS.map((n) => n.key),
      DEFAULT_NICHE_KEY,
    ),
  );
  // Same shape as `popover`: the item is re-read from the current layer data.
  const [camadaPopover, setCamadaPopover] = useState<{
    id: string;
    snapshot: CamadaItem;
    anchorEl: HTMLElement;
  } | null>(null);
  const { pedirConfirmacao, dialog: confirmarPagamentoDialog } = useConfirmarPagamento(
    canSeeFinancials ?? 'unknown',
  );
  const itensCamadas = useCamadas(periodo, camadasAtivas, canSeeFinancials, nichoKey);

  const { data: ocorrencias = [], isFetching } = useQuery({
    queryKey: [AGENDA_QUERY_KEY, periodo?.start.toISOString(), periodo?.end.toISOString()],
    queryFn: () => listAgenda(periodo!.start, periodo!.end),
    enabled: periodo !== null,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const { data: roster = [] } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
  });
  const pessoas = useMemo<AgendaPessoa[]>(
    () =>
      (roster as WorkspaceUserRow[]).map((r) => ({
        id: r.id,
        nome: r.nome || 'Sem nome',
        avatarUrl: r.avatar_url ?? null,
      })),
    [roster],
  );

  const eventosDasOcorrencias = useMemo<EventInput[]>(
    () =>
      filtrarPorPessoas(ocorrencias, idsDoFiltro(filtro, meuId, pessoas)).map((o) => {
        const ev = toEventInput(o, meuId ?? '');
        // `ordem` leads eventOrder: Agenda events before every layer item.
        return { ...ev, extendedProps: { ...ev.extendedProps, ordem: ORDEM_AGENDA } };
      }),
    [ocorrencias, filtro, meuId, pessoas],
  );
  // The people filter applies to Agenda events only (spec §1.5).
  const eventosDasCamadas = useMemo<EventInput[]>(
    () => itensCamadas.map(toCamadaEventInput),
    [itensCamadas],
  );
  const rascunhoVisivel = rascunho && !isMobile ? rascunho : null;
  const eventos = useMemo(
    () =>
      rascunhoVisivel
        ? [...eventosDasOcorrencias, ...eventosDasCamadas, rascunhoEventInput(rascunhoVisivel)]
        : [...eventosDasOcorrencias, ...eventosDasCamadas],
    [eventosDasOcorrencias, eventosDasCamadas, rascunhoVisivel],
  );

  function mudarFiltro(f: AgendaFiltro) {
    setFiltro(f);
    gravarFiltro(f);
  }

  function mudarCamadas(a: CamadasAtivas) {
    setCamadasAtivas(a);
    gravarCamadas(a);
  }

  function mudarNicho(key: string) {
    setNichoKey(key);
    writeStoredNicheKey(key);
  }

  const onDatesSet = useCallback((arg: DatesSetArg) => {
    const view = arg.view.type as AgendaViewType;
    const { currentStart, currentEnd } = arg.view;
    setPeriodo((prev) =>
      prev &&
      prev.start.getTime() === arg.start.getTime() &&
      prev.end.getTime() === arg.end.getTime() &&
      prev.view === view
        ? prev
        : {
            start: arg.start,
            end: arg.end,
            view,
            currentStart,
            currentEnd,
            titulo: tituloDoPeriodo(view, currentStart, currentEnd),
          },
    );
    setDataSelecionada((sel) => {
      if (sel >= currentStart && sel < currentEnd) return sel;
      const hoje = new Date();
      return hoje >= currentStart && hoje < currentEnd ? hoje : currentStart;
    });
  }, []);

  function abrirCriar(inicio?: Date, fim?: Date, diaInteiro = false) {
    const i = inicio ?? addHours(startOfHour(new Date()), 1);
    const f = fim ?? addHours(i, 1);
    setPopover(null);
    setCamadaPopover(null);
    setSheetAberto(false);
    descartarRascunho();
    setForm({ modo: 'criar', inicial: { inicio: i, fim: f, diaInteiro } });
  }

  function descartarRascunho() {
    setRascunho(null);
    setRascunhoInicial(null);
    setAnchorRascunho(null);
  }

  /** Close from card `n` only: a save that resolves after the user already
   *  picked another slot must not wipe the newer draft. */
  function descartarRascunhoDe(n: number) {
    if (n === selecaoRef.current) descartarRascunho();
  }

  /** A plain click selects one 30-min slot; like Google, it starts a 1 h event. */
  function fimDoClique(inicio: Date, fim: Date, diaInteiro: boolean): Date {
    return !diaInteiro && fim.getTime() - inicio.getTime() <= 30 * 60_000
      ? addHours(inicio, 1)
      : fim;
  }

  /** Desktop slot select: drop a draft chip there and open the quick card. */
  function abrirRascunho(inicio: Date, fim: Date, diaInteiro: boolean) {
    // The draft chip replaces FullCalendar's selection mirror.
    calRef.current?.getApi().unselect();
    setPopover(null);
    setCamadaPopover(null);
    selecaoRef.current += 1;
    setSelecao(selecaoRef.current);
    setAnchorRascunho(null);
    setRascunhoInicial({ inicio, fim, diaInteiro });
    setRascunho({
      inicio,
      fim,
      diaInteiro,
      titulo: '',
      tipo: valoresIniciaisCriar({ inicio, fim, diaInteiro }).tipo,
    });
  }

  // Stable and a no-op when nothing changed, so the card's effect cannot loop.
  const atualizarRascunho = useCallback((r: RascunhoEvento) => {
    setRascunho((prev) => (prev === null || mesmoRascunho(prev, r) ? prev : r));
  }, []);

  function abrirMaisOpcoes(valores: EventoFormValues) {
    const atual = rascunho ?? rascunhoInicial;
    descartarRascunho();
    if (!atual) return;
    setForm({
      modo: 'criar',
      inicial: { inicio: atual.inicio, fim: atual.fim, diaInteiro: atual.diaInteiro },
      rascunho: valores,
    });
  }

  function fecharForm() {
    setForm(null);
    calRef.current?.getApi().unselect();
  }

  const abrirPopover = useCallback((o: AgendaOcorrencia, anchorEl: HTMLElement) => {
    setRascunho(null);
    setRascunhoInicial(null);
    setAnchorRascunho(null);
    setCamadaPopover(null);
    setPopover({ id: o.ocorrencia_id, snapshot: o, anchorEl });
  }, []);

  const abrirCamada = useCallback((item: CamadaItem, anchorEl: HTMLElement) => {
    setRascunho(null);
    setRascunhoInicial(null);
    setAnchorRascunho(null);
    setPopover(null);
    setCamadaPopover({ id: item.id, snapshot: item, anchorEl });
  }, []);

  /** The chip FullCalendar currently shows for an event id, if mounted. */
  const chipDoEvento = useCallback(
    (id: number | string): HTMLElement | null =>
      containerRef.current?.querySelector<HTMLElement>(`[data-ocorrencia-id="${id}"]`) ?? null,
    [],
  );

  /** The chip FullCalendar currently shows for an occurrence, else the tab. */
  const resolverAnchor = useCallback(
    (id: number): HTMLElement | null => chipDoEvento(id) ?? containerRef.current,
    [chipDoEvento],
  );

  /** The draft chip, else the selected day's cell (never the whole tab). */
  const resolverAnchorRascunho = useCallback(
    (r: RascunhoEvento): HTMLElement | null => {
      const chip = chipDoEvento(RASCUNHO_ID);
      if (chip) return chip;
      const dia = format(r.inicio, 'yyyy-MM-dd');
      const seletores = [
        `.fc-timegrid-col[data-date="${dia}"]`,
        `.fc-daygrid-day[data-date="${dia}"]`,
      ];
      if (r.diaInteiro) seletores.reverse();
      for (const sel of seletores) {
        const cel = containerRef.current?.querySelector<HTMLElement>(sel);
        if (cel) return cel;
      }
      return null;
    },
    [chipDoEvento],
  );

  // FullCalendar mounts the draft chip after this render and re-creates it when
  // the draft changes (title, time), so (re)resolve the anchor once it is there.
  useEffect(() => {
    if (!rascunhoVisivel) return;
    const raf = requestAnimationFrame(() => {
      const novo = resolverAnchorRascunho(rascunhoVisivel);
      setAnchorRascunho((atual) => {
        if (atual?.isConnected && (atual === novo || novo === null)) return atual;
        return novo ?? atual;
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [rascunhoVisivel, eventos, resolverAnchorRascunho]);

  const itemDoCamadaPopover = camadaPopover
    ? (itensCamadas.find((i) => i.id === camadaPopover.id) ?? camadaPopover.snapshot)
    : null;
  const anchorDoCamadaPopover = camadaPopover
    ? camadaPopover.anchorEl.isConnected
      ? camadaPopover.anchorEl
      : (chipDoEvento(`camada:${camadaPopover.id}`) ?? containerRef.current)
    : null;

  // Same as the event popover below: swap a detached chip for the new one.
  useEffect(() => {
    if (!camadaPopover) return;
    const raf = requestAnimationFrame(() => {
      if (camadaPopover.anchorEl.isConnected) return;
      const novo = chipDoEvento(`camada:${camadaPopover.id}`);
      if (novo) {
        setCamadaPopover((p) => (p && p.id === camadaPopover.id ? { ...p, anchorEl: novo } : p));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [camadaPopover, eventos, chipDoEvento]);

  // Losing financial access mid-session closes an open receivables/payments popover.
  useEffect(() => {
    if (canSeeFinancials === true) return;
    setCamadaPopover((p) => (p && CAMADAS_FINANCEIRAS.has(p.snapshot.camada) ? null : p));
  }, [canSeeFinancials]);

  const ocorrenciaDoPopover = popover
    ? (ocorrencias.find((o) => o.ocorrencia_id === popover.id) ?? popover.snapshot)
    : null;
  const anchorDoPopover = popover
    ? popover.anchorEl.isConnected
      ? popover.anchorEl
      : resolverAnchor(popover.id)
    : null;

  // After a refetch FullCalendar re-renders the chips (on its own schedule), so
  // the stored element can end up detached: swap it for the new chip.
  useEffect(() => {
    if (!popover) return;
    const raf = requestAnimationFrame(() => {
      if (popover.anchorEl.isConnected) return;
      const novo = resolverAnchor(popover.id);
      if (novo) setPopover((p) => (p && p.id === popover.id ? { ...p, anchorEl: novo } : p));
    });
    return () => cancelAnimationFrame(raf);
  }, [popover, eventos, resolverAnchor]);

  // ---- Deep link: ?evento=<ocorrencia_id> opens it, ?data=yyyy-mm-dd positions --------
  const eventoParam = searchParams.get('evento');
  const dataParam = searchParams.get('data');
  const [pendente, setPendente] = useState<AgendaOcorrencia | null>(null);

  // React Router recreates setSearchParams on every param change: keep it in a
  // ref so the deep-link effect depends on the id alone.
  const setSearchParamsRef = useRef(setSearchParams);
  useEffect(() => {
    setSearchParamsRef.current = setSearchParams;
  }, [setSearchParams]);
  const removerEventoParam = useCallback(() => {
    setSearchParamsRef.current(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('evento');
        return next;
      },
      { replace: true },
    );
  }, []);

  useEffect(() => {
    if (eventoParam === null) return;
    const removerParam = removerEventoParam;
    const id = parseInt(eventoParam, 10);
    if (isNaN(id)) {
      removerParam();
      return;
    }
    let ativo = true;
    getAgendaOcorrencia(id)
      .catch(() => null)
      .then((o) => {
        if (!ativo) return;
        if (!o) {
          toast(NAO_ENCONTRADO);
          removerParam();
          return;
        }
        calRef.current?.getApi().gotoDate(inicioDaOcorrencia(o));
        setPendente(o);
      });
    return () => {
      ativo = false;
    };
  }, [eventoParam, removerEventoParam]);

  useEffect(() => {
    if (!dataParam || !DATA_RE.test(dataParam)) return;
    const d = parseDateOnly(dataParam);
    if (!isNaN(d.getTime())) calRef.current?.getApi().gotoDate(d);
  }, [dataParam]);

  // Anchor the deep-linked popover to its chip once the grid has moved to it and
  // loaded that period, falling back to the calendar card (the occurrence may be
  // filtered out of view, or the grid may never report the period).
  useEffect(() => {
    if (!pendente) return;
    const abrir = () => {
      const anchor = resolverAnchor(pendente.ocorrencia_id);
      if (anchor) abrirPopover(pendente, anchor);
      setPendente(null);
      // Consumed: a tab switch and back (or a reload) must not reopen it.
      removerEventoParam();
    };
    const alvo = inicioDaOcorrencia(pendente);
    const pronto = periodo !== null && alvo >= periodo.start && alvo < periodo.end && !isFetching;
    if (pronto) {
      const raf = requestAnimationFrame(abrir);
      return () => cancelAnimationFrame(raf);
    }
    const t = setTimeout(abrir, 1500);
    return () => clearTimeout(t);
  }, [pendente, periodo, isFetching, resolverAnchor, abrirPopover, removerEventoParam]);

  // Desktop -> phone resize: the phone toggle has no "Semana", so leave that view.
  useEffect(() => {
    if (isMobile && periodo?.view === 'timeGridWeek') {
      calRef.current?.getApi().changeView('listWeek');
    }
  }, [isMobile, periodo?.view]);

  // Phones have no quick card: a desktop -> phone resize drops the draft.
  useEffect(() => {
    if (!isMobile) return;
    setRascunho(null);
    setRascunhoInicial(null);
    setAnchorRascunho(null);
  }, [isMobile]);

  const sidebar = (
    <AgendaSidebar
      meuId={meuId}
      pessoas={pessoas}
      filtro={filtro}
      onFiltroChange={mudarFiltro}
      dataSelecionada={dataSelecionada}
      onDataChange={(d) => {
        setDataSelecionada(d);
        calRef.current?.getApi().gotoDate(d);
        setSheetAberto(false);
      }}
      onCriar={podeCriar ? () => abrirCriar() : undefined}
      onSincronizar={() => {
        // On mobile the sidebar lives in a modal Sheet: close it first so two
        // modal layers never fight over focus.
        setSheetAberto(false);
        setFeedAberto(true);
      }}
      camadas={{
        ativas: camadasAtivas,
        onChange: mudarCamadas,
        canSeeFinancials,
        nichoKey,
        onNichoChange: mudarNicho,
      }}
    />
  );

  return (
    <div className="agenda" ref={containerRef}>
      {sidebarEmSheet ? (
        <>
          <div className="agenda-barra">
            {!isMobile && podeCriar && (
              <Button type="button" onClick={() => abrirCriar()}>
                <Plus aria-hidden="true" />
                Criar evento
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setSheetAberto(true)}>
              <SlidersHorizontal aria-hidden="true" />
              Pessoas e filtros
            </Button>
          </div>
          <Sheet open={sheetAberto} onOpenChange={setSheetAberto}>
            <SheetContent side="left" className="agenda-sheet" aria-describedby={undefined}>
              <SheetHeader>
                <SheetTitle>Pessoas e filtros</SheetTitle>
              </SheetHeader>
              {sidebar}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <aside className="agenda-aside" aria-label="Pessoas e filtros">
          {sidebar}
        </aside>
      )}

      <div className="agenda-main">
        <AgendaView
          calRef={calRef}
          isMobile={isMobile}
          view={periodo?.view ?? (isMobile ? 'listWeek' : 'timeGridWeek')}
          titulo={periodo?.titulo ?? ''}
          eventos={eventos}
          onDatesSet={onDatesSet}
          onSelect={
            podeCriar
              ? (inicio, fim, diaInteiro) => {
                  const f = fimDoClique(inicio, fim, diaInteiro);
                  if (isMobile) abrirCriar(inicio, f, diaInteiro);
                  else abrirRascunho(inicio, f, diaInteiro);
                }
              : undefined
          }
          onEventClick={abrirPopover}
          onCamadaClick={abrirCamada}
          onMover={mover}
        />
      </div>

      {/* Portaled: CalendarioPage wraps the tab in .animate-up, whose transform
          would make it the containing block of a position: fixed child. */}
      {isMobile &&
        podeCriar &&
        createPortal(
          <button
            type="button"
            className="agenda-fab"
            aria-label="Criar evento"
            onClick={() => abrirCriar()}
          >
            <Plus size={26} aria-hidden="true" />
          </button>,
          document.body,
        )}

      {ocorrenciaDoPopover && anchorDoPopover && (
        <EventoPopover
          ocorrencia={ocorrenciaDoPopover}
          anchor={anchorDoPopover}
          onClose={() => setPopover(null)}
          onEditar={(o) => {
            setPopover(null);
            setForm({ modo: 'editar', ocorrencia: o });
          }}
        />
      )}
      {dialog}

      {itemDoCamadaPopover && anchorDoCamadaPopover && (
        <CamadaPopover
          item={itemDoCamadaPopover}
          anchor={anchorDoCamadaPopover}
          onClose={() => setCamadaPopover(null)}
          onConfirmar={pedirConfirmacao}
          canSeeFinancials={canSeeFinancials}
        />
      )}
      {confirmarPagamentoDialog}

      {rascunhoVisivel && rascunhoInicial && anchorRascunho && (
        <EventoRapidoCard
          key={selecao}
          inicial={rascunhoInicial}
          anchor={anchorRascunho}
          onRascunhoChange={atualizarRascunho}
          onClose={() => descartarRascunhoDe(selecao)}
          onMaisOpcoes={abrirMaisOpcoes}
        />
      )}

      <FeedAgendaDialog open={feedAberto} onOpenChange={setFeedAberto} />

      {form?.modo === 'criar' && (
        <EventoFormDialog
          open
          onOpenChange={(o) => !o && fecharForm()}
          modo="criar"
          inicial={form.inicial}
          rascunho={form.rascunho}
        />
      )}
      {form?.modo === 'editar' && (
        <EventoFormDialog
          open
          onOpenChange={(o) => !o && fecharForm()}
          modo="editar"
          ocorrencia={form.ocorrencia}
        />
      )}
    </div>
  );
}
