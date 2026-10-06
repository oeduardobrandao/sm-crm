import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type FullCalendar from '@fullcalendar/react';
import type { DatesSetArg } from '@fullcalendar/core';
import { addHours, startOfHour } from 'date-fns';
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
import { filtrarPorPessoas, toEventInput } from './agendaLogic';
import AgendaView, { tituloDoPeriodo, type AgendaViewType } from './AgendaView';
import AgendaSidebar, {
  FILTRO_PADRAO,
  idsDoFiltro,
  type AgendaFiltro,
  type AgendaPessoa,
} from './AgendaSidebar';
import { EventoFormDialog } from './EventoFormDialog';
import { EventoPopover } from './EventoPopover';
import { useAgendaMutations } from './useAgendaMutations';

const FILTRO_KEY = 'agenda-filtro';
const NAO_ENCONTRADO = 'Este evento não existe mais ou você não tem acesso.';
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

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

interface WorkspaceUserRow {
  user_id: string;
  profiles: { id: string; nome: string | null; avatar_url: string | null } | null;
}

type FormState =
  | { modo: 'criar'; inicial: { inicio: Date; fim: Date; diaInteiro: boolean } }
  | { modo: 'editar'; ocorrencia: AgendaOcorrencia };

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
  const { user } = useAuth();
  const meuId = user?.id ?? null;
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
  const [sheetAberto, setSheetAberto] = useState(false);
  const { mover, dialog } = useAgendaMutations();

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
        id: r.user_id,
        nome: r.profiles?.nome || 'Sem nome',
        avatarUrl: r.profiles?.avatar_url ?? null,
      })),
    [roster],
  );

  const eventos = useMemo(
    () =>
      filtrarPorPessoas(ocorrencias, idsDoFiltro(filtro, meuId, pessoas)).map((o) =>
        toEventInput(o, meuId ?? ''),
      ),
    [ocorrencias, filtro, meuId, pessoas],
  );

  function mudarFiltro(f: AgendaFiltro) {
    setFiltro(f);
    gravarFiltro(f);
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
    setSheetAberto(false);
    setForm({ modo: 'criar', inicial: { inicio: i, fim: f, diaInteiro } });
  }

  function fecharForm() {
    setForm(null);
    calRef.current?.getApi().unselect();
  }

  const abrirPopover = useCallback((o: AgendaOcorrencia, anchorEl: HTMLElement) => {
    setPopover({ id: o.ocorrencia_id, snapshot: o, anchorEl });
  }, []);

  /** The chip FullCalendar currently shows for an occurrence, else the tab. */
  const resolverAnchor = useCallback(
    (id: number): HTMLElement | null =>
      containerRef.current?.querySelector<HTMLElement>(`[data-ocorrencia-id="${id}"]`) ??
      containerRef.current,
    [],
  );

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
      onCriar={() => abrirCriar()}
    />
  );

  return (
    <div className="agenda" ref={containerRef}>
      {sidebarEmSheet ? (
        <>
          <div className="agenda-barra">
            {!isMobile && (
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
          onSelect={(inicio, fim, diaInteiro) => abrirCriar(inicio, fim, diaInteiro)}
          onEventClick={abrirPopover}
          onMover={mover}
        />
      </div>

      {/* Portaled: CalendarioPage wraps the tab in .animate-up, whose transform
          would make it the containing block of a position: fixed child. */}
      {isMobile &&
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

      {form?.modo === 'criar' && (
        <EventoFormDialog
          open
          onOpenChange={(o) => !o && fecharForm()}
          modo="criar"
          inicial={form.inicial}
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
