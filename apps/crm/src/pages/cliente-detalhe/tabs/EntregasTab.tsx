import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, LayoutList } from 'lucide-react';
import {
  getWorkflowsByCliente,
  getWorkflowEtapasByWorkflowIds,
  getDeadlineInfo,
  getMembros,
  duplicateWorkflow,
  getWorkflowPostStats,
  getConcludedWorkflowsByCliente,
  getConcludedWorkflowSummaries,
  getClientePosts,
  updateWorkflowPost,
  getClientes,
  getWorkspaceSlug,
  getHubToken,
  getWorkflowTemplates,
  getVigentePostProcessesByCliente,
  type Workflow,
  type WorkflowEtapa,
} from '@/store';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { HistoryDrawer } from '@/pages/entregas/components/HistoryDrawer';
import { WorkflowCard } from '@/pages/entregas/components/WorkflowCard';
import { WorkflowDrawer } from '@/pages/entregas/components/WorkflowDrawer';
import { PostProcessCard } from '@/pages/entregas/components/PostProcessCard';
import { StandalonePostDrawer } from '@/pages/entregas/components/StandalonePostDrawer';
import {
  EditWorkflowModal,
  RecurringWorkflowDialog,
} from '@/pages/entregas/components/WorkflowModals';
import { PostProcessCardMenu, WorkflowCardMenu } from '@/pages/entregas/phone/cardMenus';
import {
  PhonePostProcessCard,
  PhoneWorkflowCard,
  type WorkflowCardCounts,
} from '@/pages/entregas/phone/PhoneBoardCards';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useOverlayHistoryEntry } from '@/hooks/useOverlayHistoryEntry';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import type { BoardCard } from '@/pages/entregas/hooks/useEntregasData';
import { toPostEntity, type PostEntity } from '@/pages/entregas/boardEntity';
import {
  canConcluir,
  forwardLabelFor,
  previousStepOf,
  type ProcessTarget,
} from '@/pages/entregas/postProcessCommands';
import { usePostProcessCommands } from '@/pages/entregas/hooks/usePostProcessCommands';
import { useWorkflowStageCommands } from '@/pages/entregas/hooks/useWorkflowStageCommands';
import { getWorkflowCovers, getPostCovers } from '@/services/postMedia';
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
import { ResponsiveCardRail } from '../ResponsiveCardRail';
import { ClientePostCalendar, type PostCalendarEvent } from '../components/ClientePostCalendar';
import { ClientePostCalendarPhone } from '../components/ClientePostCalendarPhone';
import { PhoneEmptyCard } from '../phone/PhoneRows';
import { useClientePhoneHeader } from '../phone/ClientePhoneChrome';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';
import { compactHubToken } from '@/lib/hubLinks';

interface WorkflowWithEtapas {
  workflow: Workflow;
  etapas: WorkflowEtapa[];
}

/** Mesma projeção de PostEntity -> ProcessTarget do quadro de Fluxos
 *  (views/KanbanView.tsx's targetOf) -- comando e drag chamam o MESMO alvo lá;
 *  aqui não há drag, só o botão, mas o alvo precisa ser idêntico. */
function targetOf(p: PostEntity): ProcessTarget {
  return {
    process: p.process,
    post: {
      id: p.process.post_id,
      titulo: p.titulo,
      status: p.process.post.status,
      cliente_id: p.process.post.cliente_id,
    },
  };
}

/**
 * Left/right "there's more" affordances for a horizontally-scrolling rail
 * (.cliente-deliveries-rail--carousel, style.css). The right arrow shows
 * while the rail overflows and hasn't been scrolled to its end; the left
 * arrow only appears once the user has actually scrolled right, so at rest
 * (scrollLeft === 0) there's nothing to go "back" to yet.
 */
function RailScrollArrows({ railRef }: { railRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation('clients');
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const update = () => {
      setCanLeft(el.scrollLeft > 4);
      setCanRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [railRef]);

  return (
    <>
      {canLeft && (
        <button
          type="button"
          className="cliente-rail-arrow cliente-rail-arrow--left"
          aria-label={t('detail.railPrevious')}
          onClick={() => railRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {canRight && (
        <button
          type="button"
          className="cliente-rail-arrow cliente-rail-arrow--right"
          aria-label={t('detail.railNext')}
          onClick={() => railRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </>
  );
}

const EMPTY_COUNTS: Map<number, number> = new Map();

/**
 * "Entregas" tab: active workflow board, post delivery calendar, and
 * concluded-workflow history — ported verbatim from the pre-split
 * ClienteDetalhePage (see git history at d30adeea). The fluxo stage chain
 * (ForwardConfirm, the approval-exit dialog with its atomic
 * `advanceWorkflowFromApproval`, RevertConfirm, the batch auto-schedule nudge)
 * is the shared `useWorkflowStageCommands`, the same one the Fluxos board
 * uses; this tab only supplies `refreshCards` (the full historical set of
 * `invalidateQueries` calls) and its own recurring-cycle dialog.
 *
 * Query isolation: this tab only ever fires workflow/Entregas-domain queries
 * (`workflowsByCliente`, `membros`, the five posts-count queries,
 * `workflow-covers`, `concluded-by-cliente`, `concluded-summaries-cliente`,
 * plus `clientes` — lazily, only once the edit-workflow modal opens, since
 * that modal's client-reassign dropdown needs the full portfolio). Individual
 * posts (post_processes, spec 2026-09-10) share the same domain and follow
 * the same gate as the Fluxos board (`feature_post_processes`): only the
 * client's ACTIVE processes render as cards here (`post-processes-cliente`,
 * `post-covers-cliente`) — concluded ones stay out of "Histórico de entregas"
 * for now, since there is no post-process equivalent of HistoryDrawer yet. It
 * deliberately never fetches Instagram (`igSummary`) data — that belongs to
 * the Redes sociais tab — so `BoardCard.clienteAvatarUrl` is always left
 * `undefined` here; `WorkflowCard` then shows the client's uploaded
 * `foto_url`, or the colored initials without one, so this is a graceful,
 * contained trade-off rather than a broken render.
 *
 * `BoardCard.hubUrl` is the one narrow exception: it IS fetched here (via
 * `['workspace-slug']` and `['hub-token', clienteId]`, mirroring the
 * pre-split ClienteDetalhePage at d30adeea), because it powers a real
 * existing feature — WorkflowCard's "Abrir Hub do cliente" link and
 * WorkflowDrawer's copy-post-link button — not a Hub-domain content fetch.
 * Leaving it `undefined` would silently regress that feature, which is why
 * this one field breaks the otherwise-strict isolation above.
 */
export default function EntregasTab() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('clients');
  const { t: tc } = useTranslation();
  const dateLocale = i18n.language === 'en' ? 'en-US' : 'pt-BR';

  const isPhone = !useIsDesktop(768);
  const fluxosRailRef = useRef<HTMLDivElement>(null);
  const postsRailRef = useRef<HTMLDivElement>(null);

  const [historyWorkflow, setHistoryWorkflow] = useState<Workflow | null>(null);
  const [drawerCard, setDrawerCard] = useState<BoardCard | null>(null);
  const [drawerInitialPostId, setDrawerInitialPostId] = useState<number | undefined>(undefined);
  const [standalonePostId, setStandalonePostId] = useState<number | null>(null);
  const [editCardModal, setEditCardModal] = useState<BoardCard | null>(null);
  const [recurringWfId, setRecurringWfId] = useState<number | null>(null);
  // Aviso de agendamento automático em lote (spec 2026-09-17, peça 2):
  // schedulingEnabled é o gate incondicional (feature_post_scheduling);
  // tiktokEnabled é o gate ADICIONAL só para post tiktok/both (decisão 5 da
  // spec), aplicado por post DENTRO do AutoScheduleBatchDialog (do hook
  // useWorkflowStageCommands).
  const { features } = useWorkspaceLimits();
  const schedulingEnabled = features?.feature_post_scheduling === true;
  const tiktokEnabled = features?.feature_tiktok === true;
  const postProcessesEnabled = features?.feature_post_processes === true;

  const { data: clienteWorkflowsRaw } = useQuery({
    queryKey: ['workflowsByCliente', clienteId],
    queryFn: () => getWorkflowsByCliente(clienteId),
    enabled: !isNaN(clienteId),
  });

  const { data: membros = [] } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['workflow-templates'],
    queryFn: getWorkflowTemplates,
  });

  const { data: concludedWfs = [] } = useQuery({
    queryKey: ['concluded-by-cliente', clienteId],
    queryFn: () => getConcludedWorkflowsByCliente(clienteId),
    enabled: !isNaN(clienteId),
  });

  const { data: concludedSummaries = [] } = useQuery({
    queryKey: ['concluded-summaries-cliente', concludedWfs.map((w) => w.id).join(',')],
    queryFn: () => getConcludedWorkflowSummaries(concludedWfs),
    enabled: concludedWfs.length > 0,
  });

  // Full client portfolio, needed only by EditWorkflowModal's reassign-client
  // dropdown — fetched lazily (only while that modal is open) so opening this
  // tab never pulls the whole portfolio up front.
  const { data: clientesPortfolio } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
    enabled: editCardModal !== null,
  });

  // Narrow, deliberate exception to per-tab query isolation: BoardCard.hubUrl
  // powers a real existing feature (WorkflowCard's "Abrir Hub do cliente"
  // link and WorkflowDrawer's copy-post-link button), so it's fetched here
  // even though it technically touches the Hub domain. Only the token and
  // workspace slug are fetched — no briefing/pages/ideias content, which
  // would violate isolation. Mirrors the pre-split ClienteDetalhePage
  // (d30adeea) and HubClienteTab's `getWorkspaceSlug` usage.
  const { data: workspaceSlug } = useQuery({
    queryKey: ['workspace-slug'],
    queryFn: getWorkspaceSlug,
  });
  const { data: hubTokenData } = useQuery({
    queryKey: ['hub-token', clienteId],
    queryFn: () => getHubToken(clienteId),
    enabled: !isNaN(clienteId),
  });
  const hubToken = hubTokenData?.is_active ? hubTokenData.token : undefined;

  const [workflowsWithEtapas, setWorkflowsWithEtapas] = useState<WorkflowWithEtapas[]>([]);
  useEffect(() => {
    const activeWfs = (clienteWorkflowsRaw ?? []).filter((w) => w.status === 'ativo');
    if (activeWfs.length === 0) {
      setWorkflowsWithEtapas([]);
      return;
    }
    getWorkflowEtapasByWorkflowIds(activeWfs.map((w) => w.id!))
      .then((byWorkflow) =>
        setWorkflowsWithEtapas(
          activeWfs.map((w) => ({ workflow: w, etapas: byWorkflow.get(w.id!) ?? [] })),
        ),
      )
      .catch(() => setWorkflowsWithEtapas([]));
  }, [clienteWorkflowsRaw]);

  const activeWorkflowIds = useMemo(
    () => workflowsWithEtapas.map((w) => w.workflow.id!),
    [workflowsWithEtapas],
  );

  // Same query (key and fetch) as the Entregas board in useEntregasData.
  const { data: postStats } = useQuery({
    queryKey: ['workflow-posts-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowPostStats(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const postsCounts = postStats?.total ?? EMPTY_COUNTS;
  const approvedPostsCounts = postStats?.aprovadoCliente ?? EMPTY_COUNTS;
  const clearedClienteCounts = postStats?.clearedCliente ?? EMPTY_COUNTS;
  const revisaoInternaCounts = postStats?.revisaoInterna ?? EMPTY_COUNTS;
  const awaitingClienteCounts = postStats?.enviadoCliente ?? EMPTY_COUNTS;
  const { data: workflowCovers } = useQuery({
    queryKey: ['workflow-covers', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowCovers(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });

  // Posts individuais (post_processes) deste cliente -- gated pela mesma flag
  // que o quadro de Fluxos (feature_post_processes). "Vigente" inclui
  // ativo+concluido; só os ativos entram no rail abaixo, os concluídos ficam
  // de fora por ora (não há um equivalente de HistoryDrawer para processo
  // individual ainda).
  const { data: postProcesses = [] } = useQuery({
    queryKey: ['post-processes-cliente', clienteId],
    queryFn: () => getVigentePostProcessesByCliente(clienteId),
    enabled: !isNaN(clienteId) && postProcessesEnabled,
  });
  const activePostProcesses = useMemo(
    () => postProcesses.filter((p) => p.estado === 'ativo'),
    [postProcesses],
  );
  const activeProcessPostIds = useMemo(
    () => activePostProcesses.map((p) => p.post_id),
    [activePostProcesses],
  );
  const { data: postCovers } = useQuery({
    queryKey: ['post-covers-cliente', activeProcessPostIds.join(',')],
    queryFn: () => getPostCovers(activeProcessPostIds),
    enabled: activeProcessPostIds.length > 0,
  });

  const postEntities: PostEntity[] = useMemo(() => {
    if (!cliente) return [];
    return activePostProcesses
      .map((process) => toPostEntity(process, { clientes: [cliente], membros, covers: postCovers }))
      .filter((e): e is PostEntity => e !== null);
  }, [activePostProcesses, cliente, membros, postCovers]);

  const boardCards: BoardCard[] = useMemo(() => {
    if (!cliente) return [];
    const hubUrl =
      hubToken && workspaceSlug
        ? `${window.location.origin}/${workspaceSlug}/hub/${compactHubToken(hubToken)}`
        : undefined;
    return workflowsWithEtapas
      .map(({ workflow, etapas }) => {
        const activeEtapa = etapas.find((e) => e.status === 'ativo');
        if (!activeEtapa) return null;
        const membro = activeEtapa.responsavel_id
          ? membros.find((m) => m.id === activeEtapa.responsavel_id)
          : undefined;
        return {
          workflow,
          etapa: activeEtapa,
          cliente,
          membro,
          deadline: getDeadlineInfo(activeEtapa),
          totalEtapas: etapas.length,
          etapaIdx: activeEtapa.ordem,
          allEtapas: etapas,
          postCovers: workflowCovers?.get(workflow.id!),
          // Instagram avatar deliberately unavailable here — see module doc.
          // hubUrl IS fetched (narrow exception, see the queries above).
          clienteAvatarUrl: undefined,
          hubUrl,
        } satisfies BoardCard;
      })
      .filter(Boolean) as BoardCard[];
  }, [workflowsWithEtapas, cliente, membros, workflowCovers, hubToken, workspaceSlug]);

  // Post calendar: every scheduled post of the client's active workflows PLUS
  // its posts avulsos (getClientePosts merges both). Same ['clientePosts',
  // clienteId] key as WorkflowDrawer / StandalonePostDrawer, so a reschedule
  // inside either drawer refreshes the calendar too.
  const { data: clientePosts = [] } = useQuery({
    queryKey: ['clientePosts', clienteId],
    queryFn: () => getClientePosts(clienteId),
    enabled: !isNaN(clienteId),
  });
  const postCalendarEvents = useMemo(() => {
    const events: PostCalendarEvent[] = [];
    for (const post of clientePosts) {
      if (!post.scheduled_at) continue;
      const m = post.scheduled_at.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const parsed = m
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
        : new Date(post.scheduled_at);
      if (isNaN(parsed.getTime())) continue;
      events.push({
        postId: post.id,
        postTitle: post.titulo || t('detail.noTitle'),
        workflowId: post.workflow_id,
        workflowTitle: post.workflow_titulo,
        date: parsed,
        tipo: post.tipo,
        status: post.status,
      });
    }
    return events;
  }, [clientePosts, t]);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedPostDay, setSelectedPostDay] = useState<number | null>(new Date().getDate());
  const [postUpdating, setPostUpdating] = useState<number | null>(null);

  const refreshPostCalendar = () => {
    queryClient.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
  };

  const handlePostStatusUpdate = async (postId: number, newStatus: 'agendado' | 'postado') => {
    setPostUpdating(postId);
    try {
      await updateWorkflowPost(postId, { status: newStatus });
      toast.success(
        newStatus === 'agendado' ? t('detail.postScheduled') : t('detail.postMarkedPosted'),
      );
      // refreshCards, not just the calendar: a post avulso with an active
      // process renders its status on the PostProcessCard
      // (['post-processes-cliente']), and a fluxo post's status feeds the
      // workflow card counts.
      refreshCards();
    } catch {
      toast.error(t('detail.postStatusError'));
    } finally {
      setPostUpdating(null);
    }
  };

  const refreshCards = () => {
    queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
    queryClient.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-covers'] });
    queryClient.invalidateQueries({ queryKey: ['concluded-by-cliente', clienteId] });
    queryClient.invalidateQueries({ queryKey: ['concluded-summaries-cliente'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-events'] });
    queryClient.invalidateQueries({ queryKey: ['post-processes-cliente', clienteId] });
    queryClient.invalidateQueries({ queryKey: ['post-covers-cliente'] });
    refreshPostCalendar();
  };

  const postProcessCommands = usePostProcessCommands({ onRefresh: refreshCards });
  // No move hooks: like the list views, the tab just waits for the refetch.
  const stageCommands = useWorkflowStageCommands({
    onRefresh: refreshCards,
    onRecurring: setRecurringWfId,
    postsCounts,
    clearedClienteCounts,
    schedulingEnabled,
    tiktokEnabled,
    recurringWfId,
  });

  // Phones: the concluded fluxo's history is a pushed screen (in place of the tab, under
  // its own nav bar) and the two drawers are full-screen; each gets a history entry so
  // Back (the iOS edge swipe included) closes it instead of leaving the client. Same
  // single-boolean entry for both drawers as EntregasPage. Desktop is unchanged.
  const historyFaceOpen = isPhone && historyWorkflow !== null;
  useOverlayHistoryEntry(historyFaceOpen, () => setHistoryWorkflow(null));
  useOverlayHistoryEntry(isPhone && (drawerCard !== null || standalonePostId !== null), () => {
    setDrawerCard(null);
    setDrawerInitialPostId(undefined);
    setStandalonePostId(null);
  });
  useClientePhoneHeader({ hideNavBar: historyFaceOpen });

  const countsFor = (workflowId: number): WorkflowCardCounts => ({
    postsCount: postsCounts.get(workflowId) ?? 0,
    approvedPostsCount: approvedPostsCounts.get(workflowId) ?? 0,
    clearedClienteCount: clearedClienteCounts.get(workflowId) ?? 0,
    revisaoInternaCount: revisaoInternaCounts.get(workflowId) ?? 0,
    awaitingClienteCount: awaitingClienteCounts.get(workflowId) ?? 0,
  });

  useEffect(() => {
    if (drawerCard) {
      const updated = boardCards.find((c) => c.workflow.id === drawerCard.workflow.id);
      if (updated) setDrawerCard(updated);
      else setDrawerCard(null);
    }
    if (editCardModal) {
      const updated = boardCards.find((c) => c.workflow.id === editCardModal.workflow.id);
      if (!updated) setEditCardModal(null);
    }
  }, [boardCards]);

  const handleRecurringConfirm = async () => {
    if (!recurringWfId) return;
    try {
      await duplicateWorkflow(recurringWfId);
      queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
      toast.success(t('detail.newCycleCreated'));
    } catch {
      toast.error(t('detail.newCycleError'));
    }
    setRecurringWfId(null);
  };

  const handlePostEntityClick = (entity: PostEntity) => {
    setDrawerCard(null);
    setDrawerInitialPostId(undefined);
    setStandalonePostId(entity.process.post_id);
  };

  const handlePostAttached = (workflowId: number, postId: number) => {
    setStandalonePostId(null);
    // AttachToFluxoDialog only invalidates ['post-processes'] (the Fluxos-board
    // key), never this tab's ['post-processes-cliente', clienteId] -- without
    // this, the now-encerrado process stays rendered as a stale active card.
    refreshCards();
    const card = boardCards.find((c) => c.workflow.id === workflowId);
    if (!card) return;
    setDrawerInitialPostId(postId);
    setDrawerCard(card);
  };

  // Rendered in both branches below: a client whose only scheduled posts are
  // avulsos without a process has no board cards, and the calendar must still show.
  const PostCalendar = isPhone ? ClientePostCalendarPhone : ClientePostCalendar;
  const postCalendar = (
    <PostCalendar
      events={postCalendarEvents}
      calendarMonth={calendarMonth}
      onMonthChange={(d) => {
        setCalendarMonth(d);
        setSelectedPostDay(null);
      }}
      selectedPostDay={selectedPostDay}
      onSelectDay={(day) => setSelectedPostDay(day)}
      postUpdating={postUpdating}
      onPostStatusUpdate={handlePostStatusUpdate}
      onOpenPost={(postId, workflowId) => {
        if (workflowId == null) {
          setDrawerCard(null);
          setDrawerInitialPostId(undefined);
          setStandalonePostId(postId);
          return;
        }
        const card = boardCards.find((candidate) => candidate.workflow.id === workflowId);
        if (!card) return;
        setStandalonePostId(null);
        setDrawerInitialPostId(postId);
        setDrawerCard(card);
      }}
    />
  );

  const openWorkflow = (card: BoardCard) => {
    setStandalonePostId(null);
    setDrawerInitialPostId(undefined);
    setDrawerCard(card);
  };
  const forwardPostEntity = (entity: PostEntity) =>
    canConcluir(entity.process)
      ? postProcessCommands.concluir(targetOf(entity))
      : postProcessCommands.avancar(targetOf(entity));

  const phoneContent = historyFaceOpen ? (
    <HistoryDrawer
      variant="page"
      workflow={historyWorkflow!}
      clienteName={cliente?.nome}
      onClose={() => setHistoryWorkflow(null)}
    />
  ) : (
    <div id="sec-entregas" className="phone-cli-ent">
      {boardCards.length === 0 && postEntities.length === 0 && (
        <section className="phone-cli-ent__section" aria-label={t('detail.activeDeliveries')}>
          <h2 className="phone-group__header">{t('detail.activeDeliveries')}</h2>
          <PhoneEmptyCard
            title={t('detail.noActiveDeliveries')}
            hint={t('detail.noActiveDeliveriesHint')}
          />
        </section>
      )}
      {boardCards.length > 0 && (
        <section className="phone-cli-ent__section" aria-labelledby="cli-ent-fluxos">
          <h2 id="cli-ent-fluxos" className="phone-group__header">
            {t('detail.fluxos')}
          </h2>
          <ul className="phone-cli-ent__cards">
            {boardCards.map((card) => (
              <li key={card.workflow.id}>
                <WorkflowCardMenu
                  card={card}
                  membros={membros}
                  onRefresh={refreshCards}
                  onOpenPosts={() => openWorkflow(card)}
                  onEdit={() => setEditCardModal(card)}
                  onForward={() => stageCommands.forward(card)}
                  onRevert={() => stageCommands.revert(card)}
                  preview={
                    <PhoneWorkflowCard card={card} counts={countsFor(card.workflow.id!)} preview />
                  }
                >
                  {({ triggerProps }) => (
                    <PhoneWorkflowCard
                      card={card}
                      counts={countsFor(card.workflow.id!)}
                      onOpen={() => openWorkflow(card)}
                      onForward={() => stageCommands.forward(card)}
                      triggerProps={triggerProps}
                    />
                  )}
                </WorkflowCardMenu>
              </li>
            ))}
          </ul>
        </section>
      )}
      {postEntities.length > 0 && (
        <section className="phone-cli-ent__section" aria-labelledby="cli-ent-posts">
          <h2 id="cli-ent-posts" className="phone-group__header">
            {t('detail.individualPosts')}
          </h2>
          <ul className="phone-cli-ent__cards">
            {postEntities.map((entity) => (
              <li key={entity.id}>
                <PostProcessCardMenu
                  entity={entity}
                  onOpen={() => handlePostEntityClick(entity)}
                  onForward={() => forwardPostEntity(entity)}
                  forwardLabel={forwardLabelFor(entity.process)}
                  canRevert={previousStepOf(entity.process) != null}
                  onRevert={() => postProcessCommands.voltar(targetOf(entity))}
                  onRemoveProcess={() => postProcessCommands.remover(targetOf(entity))}
                  preview={<PhonePostProcessCard entity={entity} preview />}
                >
                  {({ triggerProps }) => (
                    <PhonePostProcessCard
                      entity={entity}
                      onOpen={() => handlePostEntityClick(entity)}
                      onForward={() => forwardPostEntity(entity)}
                      forwardLabel={forwardLabelFor(entity.process)}
                      triggerProps={triggerProps}
                    />
                  )}
                </PostProcessCardMenu>
              </li>
            ))}
          </ul>
        </section>
      )}

      {postCalendar}

      {concludedSummaries.length > 0 && (
        <GroupedList
          header={t('detail.deliveryHistory')}
          className="phone-cli-wrap"
          aria-label={t('detail.deliveryHistory')}
        >
          {concludedSummaries.map((s) => (
            <Cell
              key={s.workflow.id}
              label={s.workflow.titulo}
              subtitle={[
                t('detail.postCount', { count: s.postCount }),
                s.totalDays !== null ? t('detail.dayCount', { count: s.totalDays }) : null,
                s.completedAt
                  ? `${t('detail.concluded')} ${new Date(s.completedAt).toLocaleDateString(
                      dateLocale,
                      { day: '2-digit', month: 'short' },
                    )}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              onClick={() => setHistoryWorkflow(s.workflow)}
            />
          ))}
        </GroupedList>
      )}
    </div>
  );

  return (
    <>
      {isPhone ? (
        phoneContent
      ) : boardCards.length === 0 && postEntities.length === 0 ? (
        <div id="sec-entregas" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
            {t('detail.activeDeliveries')}
          </h3>
          <div
            style={{
              textAlign: 'center',
              padding: '2rem 1rem',
              color: 'var(--text-muted)',
              border: '1px dashed var(--border-color)',
              borderRadius: '12px',
            }}
          >
            <LayoutList className="h-8 w-8" style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.9rem' }}>{t('detail.noActiveDeliveries')}</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {t('detail.noActiveDeliveriesHint')}
            </p>
          </div>
          {postCalendar}
        </div>
      ) : (
        <div id="sec-entregas" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
            {t('detail.activeDeliveries')}
          </h3>
          {boardCards.length > 0 && (
            <div style={{ marginBottom: postEntities.length > 0 ? '1.5rem' : 0 }}>
              <h4
                className="text-sm font-semibold tracking-tight mb-2 text-foreground"
                style={{ opacity: 0.7 }}
              >
                {t('detail.fluxos')}
              </h4>
              <div style={{ position: 'relative' }}>
                <ResponsiveCardRail
                  ref={fluxosRailRef}
                  className="cliente-deliveries-rail cliente-deliveries-rail--carousel"
                >
                  {boardCards.map((card) => (
                    <WorkflowCard
                      key={card.workflow.id}
                      card={card}
                      onClick={() => {
                        setDrawerInitialPostId(undefined);
                        setDrawerCard(card);
                      }}
                      onEditClick={() => setEditCardModal(card)}
                      onPostsClick={() => {
                        setDrawerInitialPostId(undefined);
                        setDrawerCard(card);
                      }}
                      onForwardClick={() => stageCommands.forward(card)}
                      onRevertClick={() => stageCommands.revert(card)}
                      onRefresh={refreshCards}
                      membros={membros}
                      postsCount={postsCounts.get(card.workflow.id!) ?? 0}
                      approvedPostsCount={approvedPostsCounts.get(card.workflow.id!) ?? 0}
                      clearedClienteCount={clearedClienteCounts.get(card.workflow.id!) ?? 0}
                      revisaoInternaCount={revisaoInternaCounts.get(card.workflow.id!) ?? 0}
                      awaitingClienteCount={awaitingClienteCounts.get(card.workflow.id!) ?? 0}
                    />
                  ))}
                </ResponsiveCardRail>
                <RailScrollArrows railRef={fluxosRailRef} />
              </div>
            </div>
          )}
          {postEntities.length > 0 && (
            <div>
              <h4
                className="text-sm font-semibold tracking-tight mb-2 text-foreground"
                style={{ opacity: 0.7 }}
              >
                {t('detail.individualPosts')}
              </h4>
              <div style={{ position: 'relative' }}>
                <ResponsiveCardRail
                  ref={postsRailRef}
                  className="cliente-deliveries-rail cliente-deliveries-rail--carousel cliente-individual-posts-rail"
                >
                  {postEntities.map((entity) => (
                    <PostProcessCard
                      key={entity.id}
                      entity={entity}
                      onClick={() => handlePostEntityClick(entity)}
                      onForwardClick={() =>
                        canConcluir(entity.process)
                          ? postProcessCommands.concluir(targetOf(entity))
                          : postProcessCommands.avancar(targetOf(entity))
                      }
                      onRevertClick={() => postProcessCommands.voltar(targetOf(entity))}
                      canRevert={previousStepOf(entity.process) != null}
                      forwardLabel={forwardLabelFor(entity.process)}
                    />
                  ))}
                </ResponsiveCardRail>
                <RailScrollArrows railRef={postsRailRef} />
              </div>
            </div>
          )}

          {postCalendar}
        </div>
      )}

      {concludedSummaries.length > 0 && (
        <div id="sec-historico" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
            {t('detail.deliveryHistory')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {concludedSummaries.map((s) => (
              <div
                key={s.workflow.id}
                className="concluded-wf-row"
                onClick={() => setHistoryWorkflow(s.workflow)}
              >
                <div>
                  <div className="concluded-wf-title">{s.workflow.titulo}</div>
                  <div className="concluded-wf-meta">
                    {t('detail.postCount', { count: s.postCount })}
                    {s.totalDays !== null && (
                      <> &bull; {t('detail.dayCount', { count: s.totalDays })}</>
                    )}
                    {s.completedAt && (
                      <>
                        {' '}
                        &bull; {t('detail.concluded')}{' '}
                        {new Date(s.completedAt).toLocaleDateString(dateLocale, {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>→</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recurring workflow confirm. Phones: the kit confirm sheet (RecurringWorkflowDialog's
          phone branch); desktop keeps this dialog and its own copy. */}
      {isPhone ? (
        <RecurringWorkflowDialog
          open={recurringWfId !== null}
          onConfirm={() => void handleRecurringConfirm()}
          onCancel={() => {
            setRecurringWfId(null);
            queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
          }}
        />
      ) : (
        <AlertDialog
          open={recurringWfId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setRecurringWfId(null);
              queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('detail.workflowCompleted')}</AlertDialogTitle>
              <AlertDialogDescription>{t('detail.workflowRecurring')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setRecurringWfId(null);
                  queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
                }}
              >
                {tc('actions.no')}
              </AlertDialogCancel>
              <AlertDialogAction onClick={handleRecurringConfirm}>
                {t('detail.createNewCycle')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {historyWorkflow && !isPhone && (
        <HistoryDrawer
          workflow={historyWorkflow}
          clienteName={cliente?.nome}
          onClose={() => setHistoryWorkflow(null)}
        />
      )}

      {drawerCard && (
        <WorkflowDrawer
          key={`${drawerCard.workflow.id}-${drawerInitialPostId ?? ''}`}
          card={drawerCard}
          membros={membros}
          initialPostId={drawerInitialPostId}
          onClose={() => setDrawerCard(null)}
          onRefresh={refreshCards}
        />
      )}

      {standalonePostId != null && (
        <StandalonePostDrawer
          key={standalonePostId}
          postId={standalonePostId}
          membros={membros}
          onClose={() => setStandalonePostId(null)}
          onRefresh={refreshCards}
          onAttached={handlePostAttached}
        />
      )}

      {editCardModal && (
        <EditWorkflowModal
          card={editCardModal}
          membros={membros}
          clientes={clientesPortfolio ?? []}
          templates={templates}
          onClose={() => setEditCardModal(null)}
          onSaved={refreshCards}
          onDeleted={() => {
            setEditCardModal(null);
            refreshCards();
          }}
          onOpenPosts={() => {
            setDrawerCard(editCardModal);
            setEditCardModal(null);
          }}
        />
      )}

      {stageCommands.dialogs}
      {postProcessCommands.dialogs}
    </>
  );
}
