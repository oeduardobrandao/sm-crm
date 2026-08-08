import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, LayoutGrid, Info, BarChart2, Calendar, List, Columns, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/context/AuthContext';
import { startEntregasTour, tourStorageKey } from './tour/entregasTour';
import { useEntregasData, type BoardCard } from './hooks/useEntregasData';
import { EntregasFilters, type FilterState, type StatusFilter } from './components/EntregasFilters';
import {
  EditWorkflowModal,
  TemplatesModal,
  RecurringWorkflowDialog,
} from './components/WorkflowModals';
import { NewWorkflowWizard } from './wizard/NewWorkflowWizard';
import { KanbanView } from './views/KanbanView';
import { ChartView } from './views/ChartView';
import { CalendarView } from './views/CalendarView';
import { ListView } from './views/ListView';
import { PostsKanbanView } from './views/PostsKanbanView';
import { PostsListView } from './views/PostsListView';
import { ConcludedView } from './views/ConcludedView';
import { WorkflowDrawer } from './components/WorkflowDrawer';
import { ModeToggle, type EntregasMode } from './components/ModeToggle';
import { VistasTabs } from './components/VistasTabs';
import { useActivePosts } from './hooks/useActivePosts';
import { matchesEtapaPrazo } from './etapaPrazo';
import { parseEntregasQuery, serializeEntregasQuery, type ActiveView } from './viewQuery';
import { postMatchesStatusFilter } from './statusRegistry';
import { duplicateWorkflow } from '../../store';
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
  // Parsed exactly once: the URL is only an INPUT at mount time; afterwards the
  // page state is the source of truth and the sync effect below writes it back.
  const initialQuery = useRef(parseEntregasQuery(searchParams)).current;

  const [activeView, setActiveView] = useState<ActiveView>(initialQuery.view);
  const [filters, setFilters] = useState<FilterState>(initialQuery.filters);
  const [listSort, setListSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({
    column: 'titulo',
    direction: 'asc',
  });
  const [newWorkflowOpen, setNewWorkflowOpen] = useState(false);
  // Template preselected by the board's quick-add button; null = normal wizard.
  const [quickAddTemplateId, setQuickAddTemplateId] = useState<number | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editCard, setEditCard] = useState<BoardCard | null>(null);
  const [drawerCard, setDrawerCard] = useState<BoardCard | null>(null);
  const [recurringWfId, setRecurringWfId] = useState<number | null>(null);
  const modeFor = (view: ActiveView): EntregasMode =>
    initialQuery.view === view ? initialQuery.mode : 'entregas';
  const [kanbanMode, setKanbanMode] = useState<EntregasMode>(() => modeFor('kanban'));
  const [calendarMode, setCalendarMode] = useState<EntregasMode>(() => modeFor('calendar'));
  const [listMode, setListMode] = useState<EntregasMode>(() => modeFor('list'));
  const [drawerInitialPostId, setDrawerInitialPostId] = useState<number | null>(null);
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
  const { profile } = useAuth();
  const contaId = profile?.conta_id ?? 'unknown';
  const [tourDone, setTourDone] = useState(
    () => localStorage.getItem(tourStorageKey(contaId)) === 'true',
  );
  const [replayActive, setReplayActive] = useState(false);

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

  // Auto-start once on the first visit that shows the example board.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (isLoading || autoStarted.current || tourDone || !showExample) return;
    autoStarted.current = true;
    launchTour();
  }, [isLoading, tourDone, showExample, launchTour]);

  const handleReplay = () => {
    setReplayActive(true); // forces the example board back if the board is empty
    launchTour(); // replay does NOT clear localStorage; completing again just re-sets the flag
  };

  // Auto-open drawer when navigated with ?drawer=<workflowId>, optionally expanding a
  // single post with &post=<postId> (how a linked post in /mensagens is reached).
  // State, not a ref: GlobalSearchTrigger is mounted globally and can fire a deep link while
  // the user is already on /entregas. `cards` keeps its identity across that navigation, so a
  // resolver keyed only on `cards` would never re-run and the link would silently do nothing.
  // Storing the pending target in state re-triggers the resolver below on every new link.
  const [pendingDeepLink, setPendingDeepLink] = useState<{
    workflowId: number;
    postId: number | null;
  } | null>(null);
  const drawerParam = searchParams.get('drawer');
  const postParam = searchParams.get('post');
  useEffect(() => {
    if (!drawerParam) return;
    const parsed = parseInt(drawerParam, 10);
    if (!isNaN(parsed)) {
      const parsedPost = postParam ? parseInt(postParam, 10) : NaN;
      setPendingDeepLink({ workflowId: parsed, postId: isNaN(parsedPost) ? null : parsedPost });
      // Drop only the transient params — the rest of the query is the shareable view state
      // and must survive. On mount the sync effect below runs in the same commit and wins;
      // this removal is what covers a navigation that leaves `currentQuery` unchanged.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('drawer');
          next.delete('post');
          return next;
        },
        { replace: true },
      );
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

  useEffect(() => {
    if (pendingDeepLink === null || cards.length === 0) return;
    const match = cards.find((c) => c.workflow.id === pendingDeepLink.workflowId);
    // An unmatched target is kept, not dropped: `cards` arrives asynchronously, so a link
    // that lands before the board has loaded resolves on a later pass.
    if (match) {
      setPendingDeepLink(null);
      setDrawerInitialPostId(pendingDeepLink.postId);
      setDrawerCard(match);
    }
  }, [cards, pendingDeepLink]);

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
    setDrawerInitialPostId(null);
    setDrawerCard(card);
  };
  const handlePostClick = (workflowId: number, postId: number) => {
    const card = cardsByWorkflowId.get(workflowId);
    if (!card) return;
    setDrawerInitialPostId(postId);
    setDrawerCard(card);
  };
  // Fluxo tag in the posts list: opens the whole workflow card, not a single post.
  const handleFluxoClick = (workflowId: number) => {
    const card = cardsByWorkflowId.get(workflowId);
    if (!card) return;
    handleCardClick(card);
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
    let ps = activePosts;
    if (filters.filterSearch) {
      const q = filters.filterSearch.toLowerCase();
      ps = ps.filter((p) => p.titulo.toLowerCase().includes(q));
    }
    if (filters.filterClientes.length)
      ps = ps.filter((p) => p.cliente_id != null && filters.filterClientes.includes(p.cliente_id));
    // "Responsável" here means the CURRENT ETAPA's responsible — the same
    // dimension the posts views display — not the post-level responsavel_id.
    if (filters.filterMembros.length)
      ps = ps.filter((p) => {
        const respId = cardsByWorkflowId.get(p.workflow_id)?.etapa.responsavel_id;
        return respId != null && filters.filterMembros.includes(respId);
      });
    // A post "is in" its workflow's current etapa.
    if (filters.filterEtapas.length)
      ps = ps.filter((p) => {
        const etapaNome = cardsByWorkflowId.get(p.workflow_id)?.etapa.nome;
        return etapaNome != null && filters.filterEtapas.includes(etapaNome);
      });
    if (filters.filterTipos.length) ps = ps.filter((p) => filters.filterTipos.includes(p.tipo));
    if (filters.filterPostStatus.length)
      ps = ps.filter((p) => postMatchesStatusFilter(p, filters.filterPostStatus));
    ps = ps.filter((p) =>
      matchesEtapaPrazo(
        cardsByWorkflowId.get(p.workflow_id),
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
          <Button data-tour="novo-fluxo-btn" onClick={() => setNewWorkflowOpen(true)}>
            <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Novo Fluxo
          </Button>
        </div>
      </header>

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
      {editCard && (
        <EditWorkflowModal
          card={editCard}
          membros={membros}
          clientes={clientes}
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
      <RecurringWorkflowDialog
        open={!!recurringWfId}
        onConfirm={handleRecurringConfirm}
        onCancel={() => setRecurringWfId(null)}
      />
    </div>
  );
}
