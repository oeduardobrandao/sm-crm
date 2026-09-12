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
  Search,
  Route,
  CircleDashed,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/context/AuthContext';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { useEntitlements } from '@/hooks/useEntitlements';
import { startEntregasTour, tourStorageKey } from './tour/entregasTour';
import { shouldAutoStartTour } from './tour/tourGating';
import { shouldShowExample } from './tour/exampleGate';
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
import { SemProcessoSection } from './components/SemProcessoSection';
import { ApplyProcessDialog } from './components/ApplyProcessDialog';
import { ModeToggle, type EntregasMode } from './components/ModeToggle';
import { EntidadeToggle } from './components/EntidadeToggle';
import { VistasTabs } from './components/VistasTabs';
import { useActivePosts } from './hooks/useActivePosts';
import { selectSemProcessoPosts, productionFiltersActive, SEM_PROCESSO_LIMIT } from './semProcesso';
import { useOpenParam } from '../../hooks/useOpenParam';
import { matchesEtapaPrazo } from './etapaPrazo';
import { matchesPostEntityFilters } from './entityFilters';
import { filtersToReveal } from './revealFilters';
import type { PostEntity } from './boardEntity';
import {
  parseEntregasQuery,
  serializeEntregasQuery,
  type ActiveView,
  type EntidadeFilter,
} from './viewQuery';
import { postMatchesStatusFilter } from './statusRegistry';
import {
  loadLastMode,
  persistLastMode,
  loadBoardColumnSorts,
  persistBoardColumnSort,
  loadLastEntidade,
  persistLastEntidade,
  hasLastMode,
} from './entregasPrefs';
import type { BoardColumnSort } from './postsBoardOrder';
import {
  duplicateWorkflow,
  getStandalonePost,
  getDeadlineInfo,
  removeWorkflow,
  removeWorkflowPost,
  type ActivePost,
  type Workflow,
  type WorkflowEtapa,
} from '../../store';
import { captureEvent } from '@/lib/analytics';

const VIEW_TABS: { id: ActiveView; label: string; icon: React.ReactNode }[] = [
  { id: 'kanban', label: 'Kanban', icon: <Columns className="h-4 w-4" /> },
  { id: 'chart', label: 'Visão geral', icon: <BarChart2 className="h-4 w-4" /> },
  { id: 'calendar', label: 'Calendário', icon: <Calendar className="h-4 w-4" /> },
  { id: 'list', label: 'Lista', icon: <List className="h-4 w-4" /> },
  { id: 'concluded', label: 'Concluídas', icon: <Archive className="h-4 w-4" /> },
];

const EMPTY_POST_ENTITIES: PostEntity[] = [];
const EMPTY_CARDS: BoardCard[] = [];
const EMPTY_ETAPA_MAP: Map<number, string> = new Map();

export default function EntregasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Frozen at mount, same as initialQuery below: the sync effect eventually writes
  // `mode` back into the URL for a non-default mode, so reading this as a plain
  // (non-ref) value would flip once that happens and re-seed from the URL forever.
  const hadModeParam = useRef(searchParams.has('mode')).current;
  const hadEntidadeParam = useRef(searchParams.has('entidade')).current;
  // Parsed exactly once: the URL is only an INPUT at mount time; afterwards the
  // page state is the source of truth and the sync effect below writes it back.
  const initialQuery = useRef(parseEntregasQuery(searchParams)).current;

  // contaId is needed by the mode-seeding below, so useAuth is read up front
  // (its own state, tourDone/explainerOpen, is still set up further down).
  const { profile } = useAuth();
  const contaId = profile?.conta_id ?? 'unknown';

  // Processos individuais de produção (spec 2026-09-10). Ships dark.
  const { features } = useWorkspaceLimits();
  // Duas verdades (spec §11, PO 2026-09-11): `postProcessesEnabled` é a flag do
  // plano e gate SÓ criação (Aplicar processo, Manter etapas, seção Sem
  // processo). `postProcessesVisible` (hook) = flag OU processo existente, e
  // gate tudo que é exibição e operação de processos existentes.
  const postProcessesEnabled = features?.feature_post_processes === true;

  const { isAtLimit } = useEntitlements();

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
  // Confirmações do kebab dos cards do quadro de Fluxos (spec §4): excluir
  // fluxo e excluir post. "Encerrar processo" NÃO passa por aqui -- o kebab
  // chama commands.remover do usePostProcessCommands direto no KanbanView,
  // que já tem o diálogo, o tratamento de revisão obsoleta e a invalidação.
  const [deleteWorkflowTarget, setDeleteWorkflowTarget] = useState<BoardCard | null>(null);
  const [deletePostTarget, setDeletePostTarget] = useState<PostEntity | null>(null);
  // One page-wide mode: flipping Fluxos/Publicações persists across Kanban,
  // Calendário and Lista. An explicit ?mode= in the URL wins; with no ?mode=
  // param, it seeds from the conta's last-used mode.
  const [mode, setMode] = useState<EntregasMode>(() =>
    hadModeParam ? initialQuery.mode : loadLastMode(contaId),
  );
  // Filtro de entidade do quadro de Fluxos (spec §4.1). URL vence a preferência
  // local; sem as duas, quem já usou Entregas neste navegador começa em Fluxos e
  // quem nunca usou começa em Todos. Só é consumido através de effectiveEntidade.
  const [entidade, setEntidade] = useState<EntidadeFilter>(() => {
    if (hadEntidadeParam) return initialQuery.entidade;
    return loadLastEntidade(contaId) ?? (hasLastMode(contaId) ? 'fluxos' : 'todos');
  });
  const [drawerInitialPostId, setDrawerInitialPostId] = useState<number | null>(null);
  // Post avulso (fora de fluxo) currently open in the standalone slot below.
  const [standalonePostId, setStandalonePostId] = useState<number | null>(null);
  const [newAvulsoOpen, setNewAvulsoOpen] = useState(false);
  // Template pré-vinculado quando NewAvulsoDialog é aberto a partir do "+ Novo ▾"
  // da coluna (spec §3, item "Post individual"). null = fluxo normal do "Post
  // avulso" do dropdown de cabeçalho, sem template.
  const [avulsoTemplateId, setAvulsoTemplateId] = useState<number | null>(null);
  // Post avulso alvo do diálogo "Aplicar processo" (Task 12), aberto a partir
  // de um card da seção Sem processo.
  const [applyTarget, setApplyTarget] = useState<ActivePost | null>(null);
  // Mesmo diálogo, aberto pelo NewAvulsoDialog quando o template pré-vinculado
  // tem modo_prazo != 'padrao' (exige input extra que o quick-add não coleta).
  const [manualApplyPost, setManualApplyPost] = useState<{
    id: number;
    titulo: string | null;
    cliente_id: number | null;
    templateId: number;
  } | null>(null);
  // ApplyProcessDialog chama onApplied() e DEPOIS onClose() no sucesso (outros
  // dois call sites dependem dessa ordem) -- sem esta flag, o fallback de
  // onClose (abrir Publicações) roda também depois de aplicar com sucesso e
  // sobrescreve o revealPostProcesses (Fluxos) que acabou de rodar.
  const manualApplyAppliedRef = useRef(false);
  // Desmembrar mantendo etapas / aplicar processo: aguarda a entidade aparecer
  // em `postEntities` (não filtrado) depois do refresh disparado por
  // revealPostProcesses, para então limpar filtros e abrir o drawer (spec §4.1).
  const [pendingReveal, setPendingReveal] = useState<{
    postIds: number[];
    openDrawer: boolean;
  } | null>(null);
  // Per-column sort mode for the Publicações board, remembered per conta.
  const [boardColumnSorts, setBoardColumnSorts] = useState<
    Partial<Record<string, BoardColumnSort>>
  >(() => loadBoardColumnSorts(contaId));
  const handleBoardColumnSortChange = useCallback(
    (columnKey: string, sort: BoardColumnSort) => {
      setBoardColumnSorts((prev) => ({ ...prev, [columnKey]: sort }));
      persistBoardColumnSort(contaId, columnKey, sort);
    },
    [contaId],
  );
  const {
    clientes,
    membros,
    templates,
    cards,
    postEntities,
    processByPostId,
    activePostProcessCount,
    postProcessesVisible,
    activeWorkflows,
    postsCounts,
    approvedPostsCounts,
    clearedClienteCounts,
    revisaoInternaCounts,
    awaitingClienteCounts,
    postResponsaveis,
    isLoading,
    isFetching,
    refresh,
  } = useEntregasData({ postProcessesEnabled });

  const templatesAtLimit = isAtLimit('max_workflow_templates', templates.length);

  // Sem processos visíveis (flag desligada E nenhum processo vigente): o quadro
  // é sempre o de fluxos, a URL não ganha ?entidade= e nenhuma chave nova entra
  // no localStorage.
  const effectiveEntidade: EntidadeFilter = postProcessesVisible ? entidade : 'fluxos';

  // Same inline pattern as NotFoundPage: an app route, not one of the
  // manifest-driven public pages usePageMeta covers, so nothing else would set
  // the tab title and it would keep whatever the previous route left behind.
  useEffect(() => {
    document.title = 'Entregas | Mesaas';
  }, []);

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
  // temporarily during a replay. A board emptied by filters (but with real cards) shows the
  // plain "Nenhuma entrega" message instead — hence the unfiltered count, not filteredCards.
  // activeBoardCount is the single place to extend when the board gains new card kinds.
  const activeBoardCount = activeWorkflows.length + activePostProcessCount;
  const showExample = shouldShowExample({ activeBoardCount, tourDone, replayActive });

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
        postProcesses: postProcessesVisible,
      }),
    );
  }, [markTourDone, postProcessesVisible]);

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
    /** Chegou aqui porque o `?drawer=` não casou com nenhum card. Se o post ainda
     *  estiver em um fluxo, não devolver ao resolvedor de cards (evita loop). */
    fromDrawerFallback?: boolean;
    /** Verdadeiro quando o alvo veio de um link real (`?drawer=`/`?post=`), direto ou
     *  via handoff do resolvedor de post. `onOpenWorkflow` ("mover posts para outro
     *  fluxo", abaixo) reaproveita este mesmo estado só para esperar o card do fluxo
     *  novo aparecer após o refetch -- sem esse marcador, o card ainda inexistente
     *  seria lido como "fluxo não encontrado" e a espera seria cancelada cedo demais. */
    fromUrl?: boolean;
    /** Definido junto com `fromDrawerFallback`: o `workflow_id` que já falhou no
     *  quadro. Se o post continuar apontando para ESTE fluxo na segunda consulta,
     *  é terminal -- mas se ele foi movido para outro fluxo (recurso "mover posts
     *  para outro fluxo"), vale mais uma tentativa nesse fluxo novo. */
    failedWorkflowId?: number;
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
        setPendingDeepLink({
          workflowId: parsed,
          postId: isNaN(parsedPost) ? null : parsedPost,
          fromUrl: true,
        });
        consumeParams();
      }
    } else if (postParam) {
      // `?post=` alone, no `?drawer=`: could be a post avulso (no workflow) or an
      // attached post reached through the universal `?post=` form -- resolved
      // asynchronously below via getStandalonePost.
      const parsedPost = parseInt(postParam, 10);
      if (!isNaN(parsedPost)) {
        setPendingDeepLink({ workflowId: null, postId: parsedPost, fromUrl: true });
        consumeParams();
      }
    }
  }, [drawerParam, postParam, setSearchParams]);

  // Keep the URL in sync with the shareable view state (view + mode + filters),
  // so any Entregas screen can be shared or bookmarked as-is.
  const activeMode: EntregasMode =
    activeView === 'kanban' || activeView === 'calendar' || activeView === 'list'
      ? mode
      : 'entregas';
  const currentQuery = serializeEntregasQuery({
    view: activeView,
    mode: activeMode,
    entidade:
      activeMode === 'entregas' && (activeView === 'kanban' || activeView === 'list')
        ? effectiveEntidade
        : 'fluxos',
    filters,
  });
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
    if (!postProcessesVisible) return;
    if ((activeView === 'kanban' || activeView === 'list') && activeMode === 'entregas') {
      persistLastEntidade(contaId, effectiveEntidade);
    }
  }, [postProcessesVisible, activeView, activeMode, effectiveEntidade, contaId]);

  useEffect(() => {
    if (pendingDeepLink === null || pendingDeepLink.workflowId == null) return;
    const { workflowId, postId, fromUrl } = pendingDeepLink;
    const match = cards.find((c) => c.workflow.id === workflowId);
    if (match) {
      setPendingDeepLink(null);
      setStandalonePostId(null);
      setDrawerInitialPostId(postId);
      setDrawerCard(match);
      return;
    }
    // `onOpenWorkflow` (mover posts, abaixo) reaproveita este mesmo estado para
    // esperar o card do fluxo recém-criado aparecer após o refetch -- sem
    // `fromUrl`, essa espera é legítima e deve continuar indefinidamente.
    if (!fromUrl) return;
    // `cards` chega assíncrono: só decidir que o fluxo não existe com a lista
    // final -- nem carregando, nem em refetch em background (isLoading fica
    // false com cache stale, e `cards` ainda reflete o snapshot antigo).
    if (isLoading || isFetching) return;
    if (pendingDeepLink.fromDrawerFallback) {
      // Segunda tentativa (o post apontou para outro fluxo e ele também não está
      // no quadro): parar aqui.
      toast.error('Este post está em um fluxo que não aparece mais no quadro.');
      setPendingDeepLink(null);
      return;
    }
    // Fluxo concluído, arquivado, excluído, ou post desmembrado depois que o
    // link foi compartilhado. Com post no link, o post é o que interessa.
    if (postId != null) {
      setPendingDeepLink({
        workflowId: null,
        postId,
        fromUrl: true,
        fromDrawerFallback: true,
        failedWorkflowId: workflowId,
      });
      return;
    }
    toast.error('Fluxo não encontrado');
    setPendingDeepLink(null);
  }, [cards, isLoading, isFetching, pendingDeepLink]);

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
        } else if (
          pendingDeepLink.fromDrawerFallback &&
          post.workflow_id === pendingDeepLink.failedWorkflowId
        ) {
          // O post continua no fluxo que já não casou com o quadro: parar aqui.
          toast.error('Este post está em um fluxo que não aparece mais no quadro.');
          setPendingDeepLink(null);
        } else {
          // Reanexado (e.g. re-attached since the link was shared) ou movido para
          // outro fluxo -- hand off to the card-lookup resolver above for one more
          // attempt. `fromUrl: true`: this state only exists because the original
          // target came from `?drawer=`/`?post=`. `fromDrawerFallback` segue
          // marcado (quando já vinha marcado) para que essa tentativa seja a
          // última -- evita loop se o post for movido de novo para outro fluxo
          // que também não está no quadro.
          setPendingDeepLink({
            workflowId: post.workflow_id,
            postId,
            fromUrl: true,
            fromDrawerFallback: pendingDeepLink.fromDrawerFallback,
            failedWorkflowId: pendingDeepLink.failedWorkflowId,
          });
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
    for (const e of postEntities) names.add(e.etapaNome);
    return Array.from(names);
  }, [cards, postEntities]);

  // Resolve a post's workflow back to its board card (O(1)) for drawer opening.
  // Built from the UNFILTERED cards so a filtered-out workflow's post is still openable.
  const cardsByWorkflowId = useMemo(() => new Map(cards.map((c) => [c.workflow.id!, c])), [cards]);

  // Builds a BoardCard for a flow the board has not refetched yet (one just
  // created by "mover para outro fluxo"), mirroring useEntregasData's builder.
  // Covers/avatar/hubUrl are omitted -- they arrive with the background refresh.
  const buildProvisionalCard = (seed: {
    workflow: Workflow;
    etapas: WorkflowEtapa[];
  }): BoardCard | null => {
    if (seed.workflow.status !== 'ativo' || seed.etapas.length === 0) return null;
    const etapas = [...seed.etapas].sort((a, b) => a.ordem - b.ordem);
    const activeEtapa = etapas.find((e) => e.status === 'ativo') ?? etapas[0];
    return {
      workflow: seed.workflow,
      etapa: activeEtapa,
      cliente: clientes.find((c) => c.id === seed.workflow.cliente_id),
      membro: activeEtapa.responsavel_id
        ? membros.find((m) => m.id === activeEtapa.responsavel_id)
        : undefined,
      deadline: getDeadlineInfo(activeEtapa),
      totalEtapas: etapas.length,
      etapaIdx: activeEtapa.ordem,
      allEtapas: etapas,
    };
  };
  const openableWorkflowIds = useMemo(() => new Set(cards.map((c) => c.workflow.id!)), [cards]);

  const handleCardClick = (card: BoardCard) => {
    setStandalonePostId(null);
    setDrawerInitialPostId(null);
    setDrawerCard(card);
  };
  // Card de post individual: abre o drawer do post (StandalonePostDrawer), que
  // mostra a seção de produção. Mesmo slot exclusivo dos demais drawers.
  const handlePostEntityClick = (entity: PostEntity) => {
    setDrawerCard(null);
    setDrawerInitialPostId(null);
    setStandalonePostId(entity.process.post_id);
  };
  // Kebab do card de fluxo (spec §4): mesma RPC que EditWorkflowModal usa,
  // só que sem passar pelo modal — confirmação própria no card.
  const confirmDeleteWorkflow = async () => {
    const card = deleteWorkflowTarget;
    if (!card) return;
    setDeleteWorkflowTarget(null);
    try {
      await removeWorkflow(card.workflow.id!);
      toast.success('Fluxo excluído!');
      refresh();
    } catch {
      toast.error('Erro ao excluir fluxo');
    }
  };
  // "Excluir post" no kebab: mesma RPC que StandalonePostDrawer usa no botão
  // de excluir do drawer.
  const confirmDeletePost = async () => {
    const entity = deletePostTarget;
    if (!entity) return;
    setDeletePostTarget(null);
    try {
      await removeWorkflowPost(entity.process.post_id);
      toast.success('Post excluído.');
      refresh();
    } catch {
      toast.error('Erro ao excluir post');
    }
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
  const handleAvulsoCreated = (postId: number) => {
    const targetView: ActiveView =
      activeView === 'kanban' || activeView === 'list' ? activeView : 'kanban';
    if (targetView !== activeView) setActiveView(targetView);
    setMode('publicacoes');
    setDrawerCard(null);
    setDrawerInitialPostId(null);
    setStandalonePostId(postId);
  };

  // A saved view is just a serialized query string; applying one replays it over
  // the live state (only the target view's mode is touched).
  const applySavedView = (query: string) => {
    const parsed = parseEntregasQuery(new URLSearchParams(query));
    setActiveView(parsed.view);
    if (parsed.view === 'kanban' || parsed.view === 'calendar' || parsed.view === 'list') {
      setMode(parsed.mode);
      setEntidade(parsed.entidade);
    }
    setFilters(parsed.filters);
  };

  // Publicações mode (Kanban/Lista): every post of every active workflow, fetched
  // only while one of those modes is actually visible. The "Sem processo"
  // section of the Fluxos board (spec §4.3) reads the same cache, so it turns
  // the query on too; the 15 s poll stays conditioned on a post being published.
  const postsMode =
    (activeView === 'kanban' && mode === 'publicacoes') ||
    (activeView === 'list' && mode === 'publicacoes');
  const semProcessoMode =
    postProcessesEnabled &&
    activeView === 'kanban' &&
    mode === 'entregas' &&
    effectiveEntidade !== 'fluxos';
  const { posts: activePosts, isLoading: activePostsLoading } = useActivePosts(
    postsMode || semProcessoMode,
  );
  const semProcessoPosts = useMemo(
    () =>
      semProcessoMode
        ? selectSemProcessoPosts(activePosts, (id) => processByPostId.has(id), filters)
        : [],
    [semProcessoMode, activePosts, processByPostId, filters],
  );

  // The busca input (on the VistasTabs row) and the filter pills show together:
  // hidden on Concluídas and on the Publicações calendar, where they don't apply.
  const showFilters =
    activeView !== 'concluded' && !(activeView === 'calendar' && mode === 'publicacoes');

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

  // Mirrors exactly the fields filteredPosts reads above -- a post-mode filter
  // this omits would silently show "Ajuste os filtros" instead of the create-avulso
  // empty state (or vice versa) despite `posts` really being filtered by it.
  const postsFiltersActive =
    !!filters.filterSearch ||
    filters.filterClientes.length > 0 ||
    filters.filterMembros.length > 0 ||
    filters.filterEtapas.length > 0 ||
    filters.filterTipos.length > 0 ||
    filters.filterPostStatus.length > 0 ||
    filters.filterPrazo.length > 0 ||
    !!filters.filterPrazoFrom ||
    !!filters.filterPrazoTo;

  // Apply filters. Memoized on purpose: the Visão geral derives every chart
  // dataset from this array, and a fresh identity on each render re-animates
  // all of them (and re-runs their builders) on any unrelated state change.
  const filteredCards = useMemo(() => {
    let out = cards;
    if (filters.filterSearch) {
      const q = filters.filterSearch.toLowerCase();
      out = out.filter((c) => c.workflow.titulo.toLowerCase().includes(q));
    }
    // Every dropdown filter is multi-select: empty means "no filter", otherwise
    // a card matches if it hits ANY of the selected values.
    if (filters.filterClientes.length)
      out = out.filter(
        (c) =>
          c.workflow.cliente_id != null && filters.filterClientes.includes(c.workflow.cliente_id),
      );
    if (filters.filterMembros.length)
      out = out.filter(
        (c) =>
          c.etapa.responsavel_id != null && filters.filterMembros.includes(c.etapa.responsavel_id),
      );
    if (filters.filterPostResponsaveis.length)
      out = out.filter((c) => {
        const responsaveis = postResponsaveis.get(c.workflow.id!);
        return responsaveis?.some((r) => filters.filterPostResponsaveis.includes(r)) ?? false;
      });
    if (filters.filterEtapas.length)
      out = out.filter((c) => filters.filterEtapas.includes(c.etapa.nome));
    if (filters.filterTemplates.length)
      out = out.filter(
        (c) =>
          c.workflow.template_id != null &&
          filters.filterTemplates.includes(c.workflow.template_id),
      );
    if (filters.filterStatus.length)
      out = out.filter((c) => {
        const status: StatusFilter = c.deadline.estourado
          ? 'atrasado'
          : c.deadline.urgente
            ? 'urgente'
            : 'em_dia';
        return filters.filterStatus.includes(status);
      });
    // Prazo da etapa: the same matcher the posts pipeline uses. Without it the
    // Visão geral's "Vencem hoje" KPI and "Idade dos atrasos" buckets would
    // patch the filter state and leave the board untouched.
    if (filters.filterPrazo.length || filters.filterPrazoFrom || filters.filterPrazoTo)
      out = out.filter((c) =>
        matchesEtapaPrazo(c, filters.filterPrazo, filters.filterPrazoFrom, filters.filterPrazoTo),
      );
    return out;
  }, [cards, filters, postResponsaveis]);

  // Posts individuais passam pelos MESMOS filtros do modo Fluxos (entityFilters
  // espelha a cadeia acima campo a campo). O filtro de entidade só decide o
  // que o Kanban e a Lista recebem; Calendário e Gráfico seguem lendo
  // filteredCards (spec §4.1: "não afeta ... o gráfico").
  const filteredPostEntities = useMemo(
    () =>
      postEntities.length === 0
        ? EMPTY_POST_ENTITIES
        : postEntities.filter((e) => matchesPostEntityFilters(e, filters)),
    [postEntities, filters],
  );
  const visibleCards = effectiveEntidade === 'posts' ? EMPTY_CARDS : filteredCards;
  const visiblePostEntities =
    effectiveEntidade === 'fluxos' ? EMPTY_POST_ENTITIES : filteredPostEntities;

  // Publicações (Kanban/Lista): "Individual · <etapa>" no card de um avulso
  // com processo ativo (spec §4.4). Vazio e estável com a flag desligada.
  const processEtapaByPostId = useMemo(() => {
    if (postEntities.length === 0) return EMPTY_ETAPA_MAP;
    return new Map(postEntities.map((e) => [e.process.post_id, e.etapaNome]));
  }, [postEntities]);

  // Spec §4.1: desmembrar mantendo etapas / aplicar processo abrem Fluxos em
  // Kanban, selecionam Todos e revelam o card, removendo só os filtros que o
  // esconderiam, com aviso. Um post abre o drawer; vários só revelam.
  const revealPostProcesses = useCallback(
    (postIds: number[]) => {
      setDrawerCard(null);
      setDrawerInitialPostId(null);
      setActiveView('kanban');
      setMode('entregas');
      setEntidade('todos');
      refresh();
      setPendingReveal({ postIds, openDrawer: postIds.length === 1 });
    },
    [refresh],
  );

  // O refetch disparado por refresh() pode ainda não ter virado isFetching na
  // primeira renderização após o clique: só desistir depois de ter VISTO o
  // fetch acontecer uma vez desde o início da revelação.
  const sawFetchingRef = useRef(false);
  useEffect(() => {
    if (!pendingReveal) {
      sawFetchingRef.current = false;
      return;
    }
    if (isFetching) sawFetchingRef.current = true;
    const found = postEntities.filter((e) => pendingReveal.postIds.includes(e.process.post_id));
    if (found.length < pendingReveal.postIds.length) {
      if (isLoading || isFetching || !sawFetchingRef.current) return;
      toast.error('O post não apareceu no quadro. Recarregue a página.');
      setPendingReveal(null);
      return;
    }
    const { filters: next, cleared } = filtersToReveal(found, filters);
    if (cleared.length) {
      setFilters(next);
      toast.info('Filtros removidos para mostrar o post no quadro.');
    }
    if (pendingReveal.openDrawer) setStandalonePostId(pendingReveal.postIds[0]);
    setPendingReveal(null);
  }, [pendingReveal, postEntities, isLoading, isFetching, filters]);

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
            {activeView === 'kanban' && mode === 'entregas' && (
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
          {/* Deliberately unfiltered: the Visão geral's KPIs are the filtered
              read of the same numbers, and the two disagreeing looks like a bug
              unless the header says which one it is. */}
          <p data-tooltip="Totais gerais, sem filtros" data-tooltip-dir="right">
            fluxos ativos: {activeWorkflows.length}
            {postProcessesVisible && <> · posts individuais: {activePostProcessCount}</>}
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
                <Route aria-hidden="true" /> Novo fluxo
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setAvulsoTemplateId(null);
                  setNewAvulsoOpen(true);
                }}
              >
                <CircleDashed aria-hidden="true" /> Post avulso
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {explainerOpen && (
        <ComoFuncionaPanel
          onDismiss={dismissExplainer}
          postProcessesEnabled={postProcessesVisible}
        />
      )}

      <VistasTabs
        contaId={contaId}
        currentQuery={currentQuery}
        onApply={applySavedView}
        trailing={
          showFilters ? (
            <div className="relative w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-50" />
              <Input
                placeholder={postsMode ? 'Buscar post...' : 'Buscar fluxo...'}
                value={filters.filterSearch}
                onChange={(e) => setFilters({ ...filters, filterSearch: e.target.value })}
                className="!rounded-full !text-xs h-8 pl-8 pr-4 mb-0 w-full"
              />
            </div>
          ) : undefined
        }
      />

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
          role="tablist"
          aria-label="Modos de visualização"
          style={{
            display: 'flex',
            gap: '0.25rem',
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
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
              type="button"
              role="tab"
              aria-selected={activeView === tab.id}
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

        {(activeView === 'kanban' || activeView === 'list' || activeView === 'calendar') && (
          <ModeToggle mode={mode} onModeChange={setMode} />
        )}

        {postProcessesVisible &&
          (activeView === 'kanban' || activeView === 'list') &&
          mode === 'entregas' && (
            <EntidadeToggle value={effectiveEntidade} onChange={setEntidade} />
          )}

        {showFilters && (
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
        (mode === 'entregas' ? (
          <>
            <KanbanView
              contaId={contaId}
              cards={visibleCards}
              allCards={cards}
              postEntities={visiblePostEntities}
              allPostEntities={postEntities}
              postProcessesEnabled={postProcessesVisible}
              onPostClick={handlePostEntityClick}
              onCardClick={handleCardClick}
              onEditClick={setEditCard}
              onPostsClick={handleCardClick}
              onRefresh={refresh}
              onRecurring={setRecurringWfId}
              onDeleteWorkflowClick={setDeleteWorkflowTarget}
              onDeletePostClick={setDeletePostTarget}
              onAddWorkflow={(templateId) => {
                setQuickAddTemplateId(templateId);
                setNewWorkflowOpen(true);
              }}
              onCreateTemplate={() => setTemplatesOpen(true)}
              createTemplateDisabled={templatesAtLimit}
              // Criar processo individual é CRIAÇÃO: gate na flag do plano
              // (`postProcessesEnabled`), não em `postProcessesVisible` — ver o
              // comentário das "duas verdades" no topo. Sem a flag o próprio
              // apply_post_process levanta feature_disabled.
              onAddPostIndividual={
                postProcessesEnabled
                  ? (templateId) => {
                      setAvulsoTemplateId(templateId);
                      setNewAvulsoOpen(true);
                    }
                  : undefined
              }
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
            {semProcessoMode && (
              <SemProcessoSection
                posts={semProcessoPosts.slice(0, SEM_PROCESSO_LIMIT)}
                total={semProcessoPosts.length}
                productionFiltersActive={productionFiltersActive(filters)}
                onPostClick={handlePostClick}
                onApplyProcess={setApplyTarget}
                onVerTodos={() => setMode('publicacoes')}
              />
            )}
          </>
        ) : (
          <PostsKanbanView
            posts={filteredPosts}
            isLoading={activePostsLoading}
            openableWorkflowIds={openableWorkflowIds}
            onPostClick={handlePostClick}
            cardsByWorkflowId={cardsByWorkflowId}
            filtersActive={postsFiltersActive}
            onCreateAvulso={() => {
              setAvulsoTemplateId(null);
              setNewAvulsoOpen(true);
            }}
            columnSorts={boardColumnSorts}
            onColumnSortChange={handleBoardColumnSortChange}
            processEtapaByPostId={processEtapaByPostId}
          />
        ))}
      {activeView === 'chart' && (
        <ChartView
          cards={filteredCards}
          totalCards={cards.length}
          filters={filters}
          onFiltersChange={setFilters}
          onCardClick={handleCardClick}
          onGoToView={setActiveView}
          postProcessesEnabled={postProcessesVisible}
          onGoToKanban={() => {
            setActiveView('kanban');
            setEntidade('todos');
            setMode('entregas');
          }}
        />
      )}
      {activeView === 'calendar' && (
        <CalendarView
          cards={filteredCards}
          onCardClick={handleCardClick}
          mode={mode}
          openableWorkflowIds={openableWorkflowIds}
          onPostClick={handlePostClick}
          postProcessesEnabled={postProcessesVisible}
          onGoToKanban={() => {
            setActiveView('kanban');
            setEntidade('todos');
            setMode('entregas');
          }}
        />
      )}
      {activeView === 'list' &&
        (mode === 'entregas' ? (
          <ListView
            cards={visibleCards}
            postEntities={visiblePostEntities}
            onPostClick={handlePostEntityClick}
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
            filtersActive={postsFiltersActive}
            onCreateAvulso={() => {
              setAvulsoTemplateId(null);
              setNewAvulsoOpen(true);
            }}
            processEtapaByPostId={processEtapaByPostId}
          />
        ))}
      {activeView === 'concluded' && (
        <ConcludedView
          onOpenPost={(postId) => {
            setDrawerCard(null);
            setDrawerInitialPostId(null);
            setStandalonePostId(postId);
          }}
        />
      )}

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
          onClose={() => {
            setNewAvulsoOpen(false);
            setAvulsoTemplateId(null);
          }}
          clientes={clientes}
          templates={templates}
          templateId={avulsoTemplateId ?? undefined}
          onCreated={(post) => handleAvulsoCreated(post.id!)}
          onProcessApplied={(post) => revealPostProcesses([post.id!])}
          onNeedsManualApply={(post, template) => {
            setManualApplyPost({
              id: post.id!,
              titulo: post.titulo,
              cliente_id: post.cliente_id,
              templateId: template.id!,
            });
          }}
        />
      )}
      <AlertDialog
        open={!!deleteWorkflowTarget}
        onOpenChange={(open) => !open && setDeleteWorkflowTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir fluxo?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteWorkflowTarget?.workflow.titulo}&quot; e suas etapas serão excluídos
              permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteWorkflowTarget(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteWorkflow}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!deletePostTarget}
        onOpenChange={(open) => !open && setDeletePostTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir post?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deletePostTarget?.titulo}&quot; será excluído permanentemente. Esta ação não
              pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletePostTarget(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeletePost}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          onDetachedKeepingProcess={revealPostProcesses}
          onOpenWorkflow={(workflowId, seed) => {
            // Posts just moved to another flow: land the user there NOW when
            // possible. An existing target already has a board card; a freshly
            // created flow rides in via `seed` (the RPC returns its row +
            // etapas), from which a provisional card opens the drawer without
            // waiting for the workflows + all-active-etapas refetch cascade
            // (the latter re-keys on the active-id list, refetching etapas for
            // EVERY active flow). Covers/hubUrl arrive with the background
            // refresh, same as any card. Fallback: the pending-deep-link
            // resolver, which holds the target until its card exists. Not a
            // URL navigation: the query-sync effect would fight over ?drawer=.
            setDrawerCard(null);
            setDrawerInitialPostId(null);
            setStandalonePostId(null);
            const existing = cardsByWorkflowId.get(workflowId);
            if (existing) {
              setDrawerCard(existing);
              return;
            }
            const seededCard = seed ? buildProvisionalCard(seed) : null;
            if (seededCard) {
              setDrawerCard(seededCard);
              return;
            }
            setPendingDeepLink({ workflowId, postId: null });
          }}
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
          onProcessApplied={(id) => revealPostProcesses([id])}
        />
      )}
      {applyTarget && (
        <ApplyProcessDialog
          open
          onClose={() => setApplyTarget(null)}
          post={{
            id: applyTarget.id,
            titulo: applyTarget.titulo,
            cliente_id: applyTarget.cliente_id,
          }}
          membros={membros}
          onApplied={(r) => {
            setApplyTarget(null);
            revealPostProcesses([r.post_id]);
          }}
        />
      )}
      {manualApplyPost && (
        // Post individual criado via "+ Novo ▾" da coluna, mas o template
        // pré-vinculado tem modo_prazo != 'padrao' (spec §3): NewAvulsoDialog
        // já criou o post e repassa aqui em vez de tentar aplicar sozinho.
        <ApplyProcessDialog
          open
          onClose={() => {
            // onApplied já rodou (sucesso): não sobrescrever o
            // revealPostProcesses com o fallback de cancelamento abaixo.
            if (manualApplyAppliedRef.current) {
              manualApplyAppliedRef.current = false;
              return;
            }
            // Cancelou sem aplicar: o post avulso já existe sem processo --
            // fechar só o estado o faria sumir do quadro de Fluxos (não tem
            // processo nem card). Mesmo fallback do fluxo normal do
            // NewAvulsoDialog (handleAvulsoCreated).
            const postId = manualApplyPost.id;
            setManualApplyPost(null);
            handleAvulsoCreated(postId);
          }}
          post={manualApplyPost}
          initialTemplateId={manualApplyPost.templateId}
          membros={membros}
          onApplied={(r) => {
            manualApplyAppliedRef.current = true;
            setManualApplyPost(null);
            revealPostProcesses([r.post_id]);
          }}
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
