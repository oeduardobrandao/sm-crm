import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Plus,
  LayoutGrid,
  Info,
  BarChart2,
  Calendar,
  List,
  Columns,
  Archive,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/context/AuthContext';
import { startEntregasTour, tourStorageKey } from './tour/entregasTour';
import { shouldAutoStartTour } from './tour/tourGating';
import { ComoFuncionaPanel, explainerStorageKey } from './components/ComoFuncionaPanel';
import { useEntregasData, type BoardCard } from './hooks/useEntregasData';
import { EntregasFilters, type FilterState, type StatusFilter } from './components/EntregasFilters';
import {
  EditWorkflowModal,
  TemplatesModal,
  RecurringWorkflowDialog,
} from './components/WorkflowModals';
import { NewWorkflowWizard } from './wizard/NewWorkflowWizard';
import { NewAvulsoDialog } from './components/NewAvulsoDialog';
import { KanbanView } from './views/KanbanView';
import { ChartView } from './views/ChartView';
import { CalendarView } from './views/CalendarView';
import { ListView } from './views/ListView';
import { PostsKanbanView } from './views/PostsKanbanView';
import { PostsListView } from './views/PostsListView';
import { ConcludedView } from './views/ConcludedView';
import { WorkflowDrawer } from './components/WorkflowDrawer';
import { StandalonePostDrawer } from './components/StandalonePostDrawer';
import { ModeToggle, type EntregasMode } from './components/ModeToggle';
import { VistasTabs } from './components/VistasTabs';
import { useActivePosts } from './hooks/useActivePosts';
import { useOpenParam } from '../../hooks/useOpenParam';
import { matchesEtapaPrazo } from './etapaPrazo';
import { parseEntregasQuery, serializeEntregasQuery, type ActiveView } from './viewQuery';
import { postMatchesStatusFilter } from './statusRegistry';
import { loadLastMode, persistLastMode } from './entregasPrefs';
import {
  duplicateWorkflow,
  getStandalonePost,
  type ActivePost,
  type WorkflowPost,
} from '../../store';
import { captureEvent } from '@/lib/analytics';

const VIEW_TABS: { id: ActiveView; label: string; icon: React.ReactNode }[] = [
  { id: 'kanban', label: 'Kanban', icon: <Columns className="h-4 w-4" /> },
  { id: 'chart', label: 'Gráfico', icon: <BarChart2 className="h-4 w-4" /> },
  { id: 'calendar', label: 'Calendário', icon: <Calendar className="h-4 w-4" /> },
  { id: 'list', label: 'Lista', icon: <List className="h-4 w-4" /> },
  { id: 'concluded', label: 'Concluídas', icon: <Archive className="h-4 w-4" /> },
];

export default function EntregasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Frozen at mount, same as initialQuery below: the sync effect eventually writes
  // `mode` back into the URL for a non-default mode, so reading this as a plain
  // (non-ref) value would flip once that happens and re-seed from the URL forever.
  const hadModeParam = useRef(searchParams.has('mode')).current;
  // Parsed exactly once: the URL is only an INPUT at mount time; afterwards the
  // page state is the source of truth and the sync effect below writes it back.
  const initialQuery = useRef(parseEntregasQuery(searchParams)).current;

  // contaId is needed by the mode-seeding below, so useAuth is read up front
  // (its own state, tourDone/explainerOpen, is still set up further down).
  const { profile } = useAuth();
  const contaId = profile?.conta_id ?? 'unknown';

  const [activeView, setActiveView] = useState<ActiveView>(initialQuery.view);
  const [filters, setFilters] = useState<FilterState>(initialQuery.filters);
  const [listSort, setListSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({
    column: 'titulo',
    direction: 'asc',
  });
  const [newWorkflowOpen, setNewWorkflowOpen] = useState(false);
  // Deep link do guia de primeiros passos: ?novo-fluxo=1 abre o wizard direto.
  useOpenParam('novo-fluxo', () => setNewWorkflowOpen(true));
  // Template preselected by the board's quick-add button; null = normal wizard.
  const [quickAddTemplateId, setQuickAddTemplateId] = useState<number | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editCard, setEditCard] = useState<BoardCard | null>(null);
  const [drawerCard, setDrawerCard] = useState<BoardCard | null>(null);
  const [recurringWfId, setRecurringWfId] = useState<number | null>(null);
  const modeFor = (view: ActiveView): EntregasMode =>
    initialQuery.view === view ? initialQuery.mode : 'entregas';
  // An explicit ?mode= in the URL always wins (only for the view it names --
  // the other two views still default to 'entregas', same as before). With no
  // ?mode= param at all, every view seeds from the conta's last-used mode
  // instead of hardcoding 'entregas'.
  const [kanbanMode, setKanbanMode] = useState<EntregasMode>(() =>
    hadModeParam ? modeFor('kanban') : loadLastMode(contaId),
  );
  const [calendarMode, setCalendarMode] = useState<EntregasMode>(() =>
    hadModeParam ? modeFor('calendar') : loadLastMode(contaId),
  );
  const [listMode, setListMode] = useState<EntregasMode>(() =>
    hadModeParam ? modeFor('list') : loadLastMode(contaId),
  );
  const [drawerInitialPostId, setDrawerInitialPostId] = useState<number | null>(null);
  // Post avulso (fora de fluxo) currently open in the standalone slot below.
  const [standalonePostId, setStandalonePostId] = useState<number | null>(null);
  const [newAvulsoOpen, setNewAvulsoOpen] = useState(false);
  const {
    clientes,
    membros,
    templates,
    cards,
    activeWorkflows,
    postsCounts,
    approvedPostsCounts,
    clearedClienteCounts,
    revisaoInternaCounts,
    awaitingClienteCounts,
    postResponsaveis,
    isLoading,
    refresh,
  } = useEntregasData();

  // --- Onboarding tour + example board ---------------------------------------------------------
  // The persistence key is per-conta. `tourDone` is read once at mount from the current conta's
  // key; it is not recomputed if `contaId` changes within the same mount.
  const [tourDone, setTourDone] = useState(
    () => localStorage.getItem(tourStorageKey(contaId)) === 'true',
  );
  const [replayActive, setReplayActive] = useState(false);

  // The "Como funciona" panel. Open by default and dismissed per conta — unlike the
  // tour it does not wait for an empty board, because the model it explains is
  // exactly as opaque on a full one.
  const [explainerOpen, setExplainerOpen] = useState(
    () => localStorage.getItem(explainerStorageKey(contaId)) !== 'true',
  );

  const dismissExplainer = useCallback(() => {
    localStorage.setItem(explainerStorageKey(contaId), 'true');
    setExplainerOpen(false);
    captureEvent('entregas_explainer_dismissed');
  }, [contaId]);

  const reopenExplainer = useCallback(() => {
    setExplainerOpen(true);
    captureEvent('entregas_explainer_reopened');
  }, []);

  // One impression per mount that actually renders the panel.
  const explainerSeen = useRef(false);
  useEffect(() => {
    if (!explainerOpen || explainerSeen.current) return;
    explainerSeen.current = true;
    captureEvent('entregas_explainer_shown');
  }, [explainerOpen]);

  // The example board stands in for a real board on an empty first visit, and comes back
  // temporarily during a replay. A board emptied by filters (but with real workflows) shows the
  // plain "Nenhuma entrega" message instead — hence the activeWorkflows guard, not filteredCards.
  const showExample = activeWorkflows.length === 0 && (!tourDone || replayActive);

  const markTourDone = useCallback(() => {
    localStorage.setItem(tourStorageKey(contaId), 'true');
    setTourDone(true);
    setReplayActive(false);
  }, [contaId]);

  const launchTour = useCallback(() => {
    captureEvent('entregas_tour_started');
    // rAF: the data-tour anchors must be painted before driver.js queries for them.
    requestAnimationFrame(() =>
      startEntregasTour({
        onComplete: () => {
          captureEvent('entregas_tour_completed');
          markTourDone();
        },
        onDismiss: (step) => {
          captureEvent('entregas_tour_dismissed', { step });
          markTourDone();
        },
      }),
    );
  }, [markTourDone]);

  // Auto-start once on the first visit that shows the example board. Suppressed while the
  // new-workflow wizard is open (?novo-fluxo=1 deep link) so the two onboarding overlays
  // never stack. Reads the URL param directly (not just newWorkflowOpen state) because on a
  // warm TanStack Query cache this effect and useOpenParam's setNewWorkflowOpen(true) can fire
  // in the same effects flush, and this effect would otherwise still see the stale `false`.
  const autoStarted = useRef(false);
  const wizardOpenForTour = newWorkflowOpen || searchParams.get('novo-fluxo') === '1';
  useEffect(() => {
    if (
      !shouldAutoStartTour({
        isLoading,
        alreadyStarted: autoStarted.current,
        tourDone,
        showExample,
        wizardOpen: wizardOpenForTour,
      })
    )
      return;
    autoStarted.current = true;
    launchTour();
  }, [isLoading, tourDone, showExample, wizardOpenForTour, launchTour]);

  const handleReplay = () => {
    setReplayActive(true); // forces the example board back if the board is empty
    launchTour(); // replay does NOT clear localStorage; completing again just re-sets the flag
  };

  // Auto-open drawer when navigated with ?drawer=<workflowId>, optionally expanding a
  // single post with &post=<postId> (how a linked post in /mensagens is reached).
  // `workflowId: null` means the link arrived as `?post=<id>` alone (the universal
  // post deep-link form used by mentions, PostChip, todayAgenda etc.) -- which
  // post's workflow to actually match is only known after resolving it below.
  // State, not a ref: GlobalSearchTrigger is mounted globally and can fire a deep link while
  // the user is already on /entregas. `cards` keeps its identity across that navigation, so a
  // resolver keyed only on `cards` would never re-run and the link would silently do nothing.
  // Storing the pending target in state re-triggers the resolver below on every new link.
  const [pendingDeepLink, setPendingDeepLink] = useState<{
    workflowId: number | null;
    postId: number | null;
  } | null>(null);
  const drawerParam = searchParams.get('drawer');
  const postParam = searchParams.get('post');
  useEffect(() => {
    // Drop only the transient params — the rest of the query is the shareable view state
    // and must survive. On mount the sync effect below runs in the same commit and wins;
    // this removal is what covers a navigation that leaves `currentQuery` unchanged.
    const consumeParams = () =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('drawer');
          next.delete('post');
          return next;
        },
        { replace: true },
      );
    if (drawerParam) {
      const parsed = parseInt(drawerParam, 10);
      if (!isNaN(parsed)) {
        const parsedPost = postParam ? parseInt(postParam, 10) : NaN;
        setPendingDeepLink({ workflowId: parsed, postId: isNaN(parsedPost) ? null : parsedPost });
        consumeParams();
      }
    } else if (postParam) {
      // `?post=` alone, no `?drawer=`: could be a post avulso (no workflow) or an
      // attached post reached through the universal `?post=` form -- resolved
      // asynchronously below via getStandalonePost.
      const parsedPost = parseInt(postParam, 10);
      if (!isNaN(parsedPost)) {
        setPendingDeepLink({ workflowId: null, postId: parsedPost });
        consumeParams();
      }
    }
  }, [drawerParam, postParam, setSearchParams]);

  // Keep the URL in sync with the shareable view state (view + mode + filters),
  // so any Entregas screen can be shared or bookmarked as-is.
  const activeMode: EntregasMode =
    activeView === 'kanban'
      ? kanbanMode
      : activeView === 'calendar'
        ? calendarMode
        : activeView === 'list'
          ? listMode
          : 'entregas';
  const currentQuery = serializeEntregasQuery({ view: activeView, mode: activeMode, filters });
  useEffect(() => {
    // `currentQuery` alone — the transient ?drawer=/?post= params are deliberately dropped.
    // They were previously carried over from `prev`, but `prev` is the render-time snapshot,
    // which still holds them even after the drawer effect above ran in the same commit. That
    // re-added them on every sync and pinned them in the URL, so every reload of a shared or
    // bookmarked link re-opened the drawer. The refs above already hold what was consumed.
    setSearchParams(new URLSearchParams(currentQuery), { replace: true });
  }, [currentQuery, setSearchParams]);

  // Remembers the last mode the user actively left one of these three views in,
  // per conta -- read back by the `hadModeParam` seeds above on the next visit
  // with no explicit ?mode= in the URL.
  useEffect(() => {
    if (activeView === 'kanban' || activeView === 'list' || activeView === 'calendar') {
      persistLastMode(contaId, activeMode);
    }
  }, [activeView, activeMode, contaId]);

  useEffect(() => {
    if (pendingDeepLink === null || pendingDeepLink.workflowId == null || cards.length === 0)
      return;
    const { workflowId, postId } = pendingDeepLink;
    const match = cards.find((c) => c.workflow.id === workflowId);
    // An unmatched target is kept, not dropped: `cards` arrives asynchronously, so a link
    // that lands before the board has loaded resolves on a later pass.
    if (match) {
      setPendingDeepLink(null);
      setStandalonePostId(null);
      setDrawerInitialPostId(postId);
      setDrawerCard(match);
    }
  }, [cards, pendingDeepLink]);

  // Resolves a `?post=` deep link that arrived with no `?drawer=` (workflowId
  // still null above): looks the post up directly since only its own row says
  // whether it is a post avulso or attached to a workflow.
  useEffect(() => {
    if (pendingDeepLink === null || pendingDeepLink.workflowId != null) return;
    const postId = pendingDeepLink.postId;
    if (postId == null) {
      setPendingDeepLink(null);
      return;
    }
    let cancelled = false;
    getStandalonePost(postId)
      .then((post) => {
        if (cancelled) return;
        if (!post) {
          toast.error('Post não encontrado');
          setPendingDeepLink(null);
          return;
        }
        if (post.workflow_id == null) {
          // Post avulso: open the standalone slot, closing any open WorkflowDrawer
          // so only one drawer is ever visible at a time.
          setDrawerCard(null);
          setDrawerInitialPostId(null);
          setStandalonePostId(post.id!);
          setPendingDeepLink(null);
        } else {
          // Attached after all (e.g. re-attached since the link was shared) --
          // hand off to the card-lookup resolver above.
          setPendingDeepLink({ workflowId: post.workflow_id, postId });
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error('Post não encontrado');
          setPendingDeepLink(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pendingDeepLink]);

  // Derive unique active etapa names for the filter dropdown
  const etapaNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of cards) names.add(c.etapa.nome);
    return Array.from(names);
  }, [cards]);

  // Resolve a post's workflow back to its board card (O(1)) for drawer opening.
  // Built from the UNFILTERED cards so a filtered-out workflow's post is still openable.
  const cardsByWorkflowId = useMemo(() => new Map(cards.map((c) => [c.workflow.id!, c])), [cards]);
  const openableWorkflowIds = useMemo(() => new Set(cards.map((c) => c.workflow.id!)), [cards]);

  const handleCardClick = (card: BoardCard) => {
    setStandalonePostId(null);
    setDrawerInitialPostId(null);
    setDrawerCard(card);
  };
  // Object-based click contract shared by the four post-list views (Kanban/Lista/
  // Calendário/PublicacoesPanel): a post avulso has no workflow card to open, so it
  // always goes to the standalone slot instead -- avulsos are always "openable".
  const handlePostClick = (post: ActivePost) => {
    if (post.workflow_id == null) {
      setDrawerCard(null);
      setDrawerInitialPostId(null);
      setStandalonePostId(post.id);
      return;
    }
    const card = cardsByWorkflowId.get(post.workflow_id);
    if (!card) return;
    setStandalonePostId(null);
    setDrawerInitialPostId(post.id);
    setDrawerCard(card);
  };
  // Fluxo tag in the posts list: opens the whole workflow card, not a single post.
  const handleFluxoClick = (workflowId: number) => {
    const card = cardsByWorkflowId.get(workflowId);
    if (!card) return;
    handleCardClick(card);
  };

  // StandalonePostDrawer's AttachToFluxoDialog just moved this post into an active
  // workflow: close the standalone slot and open that workflow's WorkflowDrawer with
  // this exact post expanded, same target-lookup as handlePostClick's attached branch.
  const handlePostAttached = (workflowId: number, postId: number) => {
    setStandalonePostId(null);
    const card = cardsByWorkflowId.get(workflowId);
    if (!card) return;
    setDrawerInitialPostId(postId);
    setDrawerCard(card);
  };

  // NewAvulsoDialog submit flow: switch into a Publicações-capable view (kanban
  // stays as-is if already kanban/list; anything else -- chart/calendar/concluded --
  // switches to kanban), put that view's mode in Publicações, and open the new
  // post in the standalone slot.
  const handleAvulsoCreated = (post: WorkflowPost) => {
    const targetView: ActiveView =
      activeView === 'kanban' || activeView === 'list' ? activeView : 'kanban';
    if (targetView !== activeView) setActiveView(targetView);
    if (targetView === 'kanban') setKanbanMode('publicacoes');
    else setListMode('publicacoes');
    setDrawerCard(null);
    setDrawerInitialPostId(null);
    setStandalonePostId(post.id!);
  };

  // A saved view is just a serialized query string; applying one replays it over
  // the live state (only the target view's mode is touched).
  const applySavedView = (query: string) => {
    const parsed = parseEntregasQuery(new URLSearchParams(query));
    setActiveView(parsed.view);
    if (parsed.view === 'kanban') setKanbanMode(parsed.mode);
    if (parsed.view === 'calendar') setCalendarMode(parsed.mode);
    if (parsed.view === 'list') setListMode(parsed.mode);
    setFilters(parsed.filters);
  };

  // Publicações mode (Kanban/Lista): every post of every active workflow, fetched
  // only while one of those modes is actually visible.
  const postsMode =
    (activeView === 'kanban' && kanbanMode === 'publicacoes') ||
    (activeView === 'list' && listMode === 'publicacoes');
  const { posts: activePosts, isLoading: activePostsLoading } = useActivePosts(postsMode);

  // Posts-mode filtering: only busca / cliente / responsável do post apply; the
  // workflow-shaped filters (status, membros, etapas, templates) are not read here
  // but stay in state so flipping back to Entregas restores them.
  const filteredPosts = useMemo(() => {
    // A post avulso has no workflow_id to look up -- undefined here means the same
    // "no card" state matchesEtapaPrazo and the membro/etapa filters below already
    // treat as "excluded while that filter is active".
    const cardOfPost = (p: ActivePost) =>
      p.workflow_id != null ? cardsByWorkflowId.get(p.workflow_id) : undefined;
    let ps = activePosts;
    if (filters.filterSearch) {
      const q = filters.filterSearch.toLowerCase();
      ps = ps.filter((p) => p.titulo.toLowerCase().includes(q));
    }
    if (filters.filterClientes.length)
      ps = ps.filter((p) => p.cliente_id != null && filters.filterClientes.includes(p.cliente_id));
    // "Responsável" here means the CURRENT ETAPA's responsible for a wired post --
    // the same dimension the posts views display. A post avulso has no etapa, so
    // it falls back to its own post-level responsavel_id instead of being excluded
    // outright whenever this filter is active.
    if (filters.filterMembros.length)
      ps = ps.filter((p) => {
        const respId =
          p.workflow_id != null ? cardOfPost(p)?.etapa.responsavel_id : p.responsavel_id;
        return respId != null && filters.filterMembros.includes(respId);
      });
    // A post "is in" its workflow's current etapa -- a post avulso has none, so
    // this filter (like prazo below) excludes it whenever it is active.
    if (filters.filterEtapas.length)
      ps = ps.filter((p) => {
        const etapaNome = cardOfPost(p)?.etapa.nome;
        return etapaNome != null && filters.filterEtapas.includes(etapaNome);
      });
    if (filters.filterTipos.length) ps = ps.filter((p) => filters.filterTipos.includes(p.tipo));
    if (filters.filterPostStatus.length)
      ps = ps.filter((p) => postMatchesStatusFilter(p, filters.filterPostStatus));
    // Same exclusion as filterEtapas above: matchesEtapaPrazo returns false for an
    // undefined card (post avulso) whenever a prazo preset/range is active, and
    // true unconditionally when the filter itself is empty.
    ps = ps.filter((p) =>
      matchesEtapaPrazo(
        cardOfPost(p),
        filters.filterPrazo,
        filters.filterPrazoFrom,
        filters.filterPrazoTo,
      ),
    );
    return ps;
  }, [
    activePosts,
    cardsByWorkflowId,
    filters.filterSearch,
    filters.filterClientes,
    filters.filterMembros,
    filters.filterEtapas,
    filters.filterTipos,
    filters.filterPostStatus,
    filters.filterPrazo,
    filters.filterPrazoFrom,
    filters.filterPrazoTo,
  ]);

  // Apply filters
  let filteredCards = cards;
  if (filters.filterSearch) {
    const q = filters.filterSearch.toLowerCase();
    filteredCards = filteredCards.filter((c) => c.workflow.titulo.toLowerCase().includes(q));
  }
  // Every dropdown filter is multi-select: empty means "no filter", otherwise
  // a card matches if it hits ANY of the selected values.
  if (filters.filterClientes.length)
    filteredCards = filteredCards.filter(
      (c) =>
        c.workflow.cliente_id != null && filters.filterClientes.includes(c.workflow.cliente_id),
    );
  if (filters.filterMembros.length)
    filteredCards = filteredCards.filter(
      (c) =>
        c.etapa.responsavel_id != null && filters.filterMembros.includes(c.etapa.responsavel_id),
    );
  if (filters.filterPostResponsaveis.length)
    filteredCards = filteredCards.filter((c) => {
      const responsaveis = postResponsaveis.get(c.workflow.id!);
      return responsaveis?.some((r) => filters.filterPostResponsaveis.includes(r)) ?? false;
    });
  if (filters.filterEtapas.length)
    filteredCards = filteredCards.filter((c) => filters.filterEtapas.includes(c.etapa.nome));
  if (filters.filterTemplates.length)
    filteredCards = filteredCards.filter(
      (c) =>
        c.workflow.template_id != null && filters.filterTemplates.includes(c.workflow.template_id),
    );
  if (filters.filterStatus.length)
    filteredCards = filteredCards.filter((c) => {
      const status: StatusFilter = c.deadline.estourado
        ? 'atrasado'
        : c.deadline.urgente
          ? 'urgente'
          : 'em_dia';
      return filters.filterStatus.includes(status);
    });

  const overdue = cards.filter((c) => c.deadline.estourado).length;
  const urgent = cards.filter((c) => c.deadline.urgente && !c.deadline.estourado).length;

  const handleRecurringConfirm = async () => {
    if (!recurringWfId) return;
    try {
      await duplicateWorkflow(recurringWfId);
      toast.success('Novo ciclo criado!');
    } catch {
      toast.error('Erro ao criar ciclo');
    }
    setRecurringWfId(null);
    refresh();
  };

  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}
      >
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h1>Entregas</h1>
            <span
              data-tooltip="Acompanhe o andamento das entregas e fluxos ativos."
              data-tooltip-dir="right"
              style={{ display: 'flex' }}
            >
              <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
            </span>
            {/* Only on the kanban view in Entregas mode — the tour's data-tour anchors live
                there, so a click elsewhere (other views, or the Publicações board) would fire
                a "started" event and hit startEntregasTour's zero-anchor early return with no
                visible tour. */}
            {!explainerOpen && (
              <button type="button" onClick={reopenExplainer} className="entregas-explainer-reopen">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                Como funciona
              </button>
            )}
            {activeView === 'kanban' && kanbanMode === 'entregas' && (
              <button
                type="button"
                onClick={handleReplay}
                style={{
                  fontSize: '0.72rem',
                  color: 'var(--text-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Ver tour novamente
              </button>
            )}
          </div>
          <p>
            fluxos ativos: {activeWorkflows.length}
            {overdue > 0 && (
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                {' '}
                • {overdue} atrasado{overdue > 1 ? 's' : ''}
              </span>
            )}
            {urgent > 0 && (
              <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
                {' '}
                • {urgent} urgente{urgent > 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>
        <div className="header-actions">
          <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
            <LayoutGrid className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Templates
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-tour="novo-fluxo-btn">
                <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Novo
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setNewWorkflowOpen(true)}>
                Novo fluxo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNewAvulsoOpen(true)}>
                Post avulso
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {explainerOpen && <ComoFuncionaPanel onDismiss={dismissExplainer} />}

      <VistasTabs contaId={contaId} currentQuery={currentQuery} onApply={applySavedView} />

      {/* One toolbar row: orientation (view + mode) on the left, filters on the
          right. Wraps on narrow viewports instead of stacking five control rows. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '0.25rem',
            background: 'var(--surface-2)',
            padding: '0.25rem',
            borderRadius: '8px',
            overflowX: 'auto',
            width: 'fit-content',
            maxWidth: '100%',
          }}
          className="animate-up no-scrollbar"
        >
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.4rem 0.9rem',
                borderRadius: '6px',
                border: 'none',
                background: activeView === tab.id ? 'var(--cta-bg)' : 'transparent',
                color: activeView === tab.id ? 'var(--cta-fg)' : 'var(--text-secondary)',
                fontSize: '0.8rem',
                fontWeight: activeView === tab.id ? 600 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {(activeView === 'kanban' || activeView === 'list') && (
          <ModeToggle
            mode={activeView === 'kanban' ? kanbanMode : listMode}
            onModeChange={activeView === 'kanban' ? setKanbanMode : setListMode}
          />
        )}

        {activeView !== 'concluded' &&
          !(activeView === 'calendar' && calendarMode === 'publicacoes') && (
            <EntregasFilters
              filters={filters}
              onChange={setFilters}
              clientes={clientes}
              membros={membros}
              templates={templates}
              etapaNames={etapaNames}
              mode={postsMode ? 'posts' : 'entregas'}
            />
          )}
      </div>

      {activeView === 'kanban' &&
        (kanbanMode === 'entregas' ? (
          <KanbanView
            cards={filteredCards}
            onCardClick={handleCardClick}
            onEditClick={setEditCard}
            onPostsClick={handleCardClick}
            onRefresh={refresh}
            onRecurring={setRecurringWfId}
            onAddWorkflow={(templateId) => {
              setQuickAddTemplateId(templateId);
              setNewWorkflowOpen(true);
            }}
            membros={membros}
            templates={templates}
            postsCounts={postsCounts}
            approvedPostsCounts={approvedPostsCounts}
            clearedClienteCounts={clearedClienteCounts}
            revisaoInternaCounts={revisaoInternaCounts}
            awaitingClienteCounts={awaitingClienteCounts}
            showExample={showExample}
            onDismissExample={() => {
              captureEvent('entregas_tour_dismissed', { step: -1 });
              markTourDone();
            }}
          />
        ) : (
          <PostsKanbanView
            posts={filteredPosts}
            isLoading={activePostsLoading}
            openableWorkflowIds={openableWorkflowIds}
            onPostClick={handlePostClick}
            cardsByWorkflowId={cardsByWorkflowId}
          />
        ))}
      {activeView === 'chart' && <ChartView cards={filteredCards} />}
      {activeView === 'calendar' && (
        <CalendarView
          cards={filteredCards}
          onCardClick={handleCardClick}
          mode={calendarMode}
          onModeChange={setCalendarMode}
          openableWorkflowIds={openableWorkflowIds}
          onPostClick={handlePostClick}
        />
      )}
      {activeView === 'list' &&
        (listMode === 'entregas' ? (
          <ListView
            cards={filteredCards}
            sort={listSort}
            onSortChange={setListSort}
            onCardClick={handleCardClick}
          />
        ) : (
          <PostsListView
            posts={filteredPosts}
            isLoading={activePostsLoading}
            openableWorkflowIds={openableWorkflowIds}
            onPostClick={handlePostClick}
            onFluxoClick={handleFluxoClick}
            cardsByWorkflowId={cardsByWorkflowId}
          />
        ))}
      {activeView === 'concluded' && <ConcludedView />}

      {newWorkflowOpen && (
        <NewWorkflowWizard
          open={newWorkflowOpen}
          onClose={() => {
            setNewWorkflowOpen(false);
            setQuickAddTemplateId(null);
          }}
          initialTemplateId={quickAddTemplateId ?? undefined}
          clientes={clientes}
          membros={membros}
          templates={templates}
          onCreated={() => {
            captureEvent('workflow_created');
            refresh();
          }}
        />
      )}
      {newAvulsoOpen && (
        <NewAvulsoDialog
          open={newAvulsoOpen}
          onClose={() => setNewAvulsoOpen(false)}
          clientes={clientes}
          onCreated={handleAvulsoCreated}
        />
      )}
      {editCard && (
        <EditWorkflowModal
          card={editCard}
          membros={membros}
          clientes={clientes}
          templates={templates}
          onClose={() => setEditCard(null)}
          onSaved={refresh}
          onDeleted={refresh}
          onOpenPosts={() => {
            handleCardClick(editCard);
            setEditCard(null);
          }}
        />
      )}
      {templatesOpen && (
        <TemplatesModal
          open={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
          templates={templates}
          membros={membros}
          onRefresh={refresh}
        />
      )}
      {drawerCard && (
        <WorkflowDrawer
          key={`${drawerCard.workflow.id}:${drawerInitialPostId ?? ''}`}
          card={drawerCard}
          initialPostId={drawerInitialPostId ?? undefined}
          membros={membros}
          onClose={() => {
            setDrawerCard(null);
            setDrawerInitialPostId(null);
          }}
          onRefresh={refresh}
        />
      )}
      {standalonePostId != null && (
        <StandalonePostDrawer
          key={standalonePostId}
          postId={standalonePostId}
          membros={membros}
          onClose={() => setStandalonePostId(null)}
          onRefresh={refresh}
          onAttached={handlePostAttached}
        />
      )}
      <RecurringWorkflowDialog
        open={!!recurringWfId}
        onConfirm={handleRecurringConfirm}
        onCancel={() => setRecurringWfId(null)}
      />
    </div>
  );
}
