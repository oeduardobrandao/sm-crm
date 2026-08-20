import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { LayoutList } from 'lucide-react';
import {
  getWorkflowsByCliente,
  getWorkflowEtapas,
  getDeadlineInfo,
  getMembros,
  hasLaterApprovalEtapa,
  revertEtapa,
  approvePostsInternally,
  sendPostsToCliente,
  duplicateWorkflow,
  getWorkflowPostsCounts,
  getWorkflowApprovedPostsCounts,
  getWorkflowClearedClientePostsCounts,
  getWorkflowRevisaoInternaCounts,
  getWorkflowAwaitingClientePostsCounts,
  getConcludedWorkflowsByCliente,
  getWorkflowPosts,
  getWorkflowPostsWithProperties,
  updateWorkflowPost,
  getClientes,
  getWorkspaceSlug,
  getHubToken,
  getWorkflowTemplates,
  type Workflow,
  type WorkflowEtapa,
} from '@/store';
import { HistoryDrawer } from '@/pages/entregas/components/HistoryDrawer';
import { WorkflowCard } from '@/pages/entregas/components/WorkflowCard';
import { WorkflowDrawer } from '@/pages/entregas/components/WorkflowDrawer';
import {
  EditWorkflowModal,
  ForwardConfirmDialog,
  RevertConfirmDialog,
  ClientApprovalChoiceDialog,
} from '@/pages/entregas/components/WorkflowModals';
import type { BoardCard } from '@/pages/entregas/hooks/useEntregasData';
import { completeEtapaForAdvance, notifyRearmOutcome } from '@/pages/entregas/advanceEtapa';
import { getWorkflowCovers } from '@/services/postMedia';
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
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

interface WorkflowWithEtapas {
  workflow: Workflow;
  etapas: WorkflowEtapa[];
}

/**
 * "Entregas" tab: active workflow board, post delivery calendar, and
 * concluded-workflow history — ported verbatim from the pre-split
 * ClienteDetalhePage (see git history at d30adeea). This is the highest-risk
 * extraction in the cliente-detalhe tabs split: the approval/advance/re-arm
 * logic has real operational consequences, so every handler below preserves
 * the historical call shape exactly (`completeEtapaForAdvance`,
 * `notifyRearmOutcome`, `{ rearm: false }` on the "sem alterar posts" path,
 * and the full historical set of `invalidateQueries` calls).
 *
 * Query isolation: this tab only ever fires workflow/Entregas-domain queries
 * (`workflowsByCliente`, `membros`, the five posts-count queries,
 * `workflow-covers`, `concluded-by-cliente`, `concluded-summaries-cliente`,
 * plus `clientes` — lazily, only once the edit-workflow modal opens, since
 * that modal's client-reassign dropdown needs the full portfolio). It
 * deliberately never fetches Instagram (`igSummary`) data — that belongs to
 * the Redes sociais tab — so `BoardCard.clienteAvatarUrl` is always left
 * `undefined` here; `WorkflowCard` already falls back to a colored-initials
 * avatar when it's unset, so this is a graceful, contained trade-off rather
 * than a broken render.
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

  const [historyWorkflow, setHistoryWorkflow] = useState<Workflow | null>(null);
  const [drawerCard, setDrawerCard] = useState<BoardCard | null>(null);
  const [editCardModal, setEditCardModal] = useState<BoardCard | null>(null);
  const [forwardTarget, setForwardTarget] = useState<BoardCard | null>(null);
  const [revertTarget, setRevertTarget] = useState<BoardCard | null>(null);
  const [approvalChoiceCard, setApprovalChoiceCard] = useState<BoardCard | null>(null);
  const [recurringWfId, setRecurringWfId] = useState<number | null>(null);

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
    queryFn: async () => {
      return Promise.all(
        concludedWfs.map(async (workflow) => {
          const [etapas, posts] = await Promise.all([
            getWorkflowEtapas(workflow.id!),
            getWorkflowPosts(workflow.id!),
          ]);
          const firstStart = etapas.find((e) => e.iniciado_em)?.iniciado_em;
          const concludedEtapas = etapas.filter((e) => e.concluido_em);
          const lastEnd =
            concludedEtapas.length > 0
              ? concludedEtapas[concludedEtapas.length - 1].concluido_em
              : null;
          const totalDays =
            firstStart && lastEnd
              ? Math.round(
                  (new Date(lastEnd).getTime() - new Date(firstStart).getTime()) /
                    (1000 * 60 * 60 * 24),
                )
              : null;
          return { workflow, postCount: posts.length, totalDays, completedAt: lastEnd ?? null };
        }),
      );
    },
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
    Promise.all(
      activeWfs.map(async (w) => ({ workflow: w, etapas: await getWorkflowEtapas(w.id!) })),
    )
      .then(setWorkflowsWithEtapas)
      .catch(() => setWorkflowsWithEtapas([]));
  }, [clienteWorkflowsRaw]);

  const activeWorkflowIds = useMemo(
    () => workflowsWithEtapas.map((w) => w.workflow.id!),
    [workflowsWithEtapas],
  );

  const { data: postsCounts = new Map<number, number>() } = useQuery({
    queryKey: ['workflow-posts-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowPostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: approvedPostsCounts = new Map<number, number>() } = useQuery({
    queryKey: ['workflow-approved-posts-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowApprovedPostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: clearedClienteCounts = new Map<number, number>() } = useQuery({
    queryKey: ['workflow-cleared-cliente-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowClearedClientePostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: revisaoInternaCounts = new Map<number, number>() } = useQuery({
    queryKey: ['workflow-revisao-interna-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowRevisaoInternaCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: awaitingClienteCounts = new Map<number, number>() } = useQuery({
    queryKey: ['workflow-awaiting-cliente-counts', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowAwaitingClientePostsCounts(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });
  const { data: workflowCovers } = useQuery({
    queryKey: ['workflow-covers', activeWorkflowIds.join(',')],
    queryFn: () => getWorkflowCovers(activeWorkflowIds),
    enabled: activeWorkflowIds.length > 0,
  });

  const boardCards: BoardCard[] = useMemo(() => {
    if (!cliente) return [];
    const hubUrl =
      hubToken && workspaceSlug
        ? `${window.location.origin}/${workspaceSlug}/hub/${hubToken}`
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

  // Post calendar: fetch posts with scheduled_at for all active workflows
  const [postCalendarEvents, setPostCalendarEvents] = useState<PostCalendarEvent[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedPostDay, setSelectedPostDay] = useState<number | null>(new Date().getDate());
  const [postUpdating, setPostUpdating] = useState<number | null>(null);

  useEffect(() => {
    const activeWfs = (clienteWorkflowsRaw ?? []).filter((w) => w.status === 'ativo');
    if (activeWfs.length === 0) {
      setPostCalendarEvents([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      activeWfs.map(async (wf) => {
        const posts = await getWorkflowPostsWithProperties(wf.id!);
        return posts.map((p) => ({ ...p, _wfId: wf.id!, _wfTitle: wf.titulo }));
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const events: PostCalendarEvent[] = [];
        for (const posts of results) {
          for (const post of posts) {
            if (post.scheduled_at) {
              const m = post.scheduled_at.match(/^(\d{4})-(\d{2})-(\d{2})/);
              const parsed = m
                ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
                : new Date(post.scheduled_at);
              if (!isNaN(parsed.getTime())) {
                events.push({
                  postId: post.id!,
                  postTitle: post.titulo || t('detail.noTitle'),
                  workflowId: post._wfId,
                  workflowTitle: post._wfTitle,
                  date: parsed,
                  tipo: post.tipo,
                  status: post.status,
                });
              }
            }
          }
        }
        setPostCalendarEvents(events);
      })
      .catch(() => {
        if (!cancelled) setPostCalendarEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clienteWorkflowsRaw]);

  const refreshPostCalendar = () => {
    const activeWfs = (clienteWorkflowsRaw ?? []).filter((w) => w.status === 'ativo');
    if (activeWfs.length === 0) {
      setPostCalendarEvents([]);
      return;
    }
    Promise.all(
      activeWfs.map(async (wf) => {
        const posts = await getWorkflowPostsWithProperties(wf.id!);
        return posts.map((p) => ({ ...p, _wfId: wf.id!, _wfTitle: wf.titulo }));
      }),
    )
      .then((results) => {
        const events: PostCalendarEvent[] = [];
        for (const posts of results) {
          for (const post of posts) {
            if (post.scheduled_at) {
              const m = post.scheduled_at.match(/^(\d{4})-(\d{2})-(\d{2})/);
              const parsed = m
                ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
                : new Date(post.scheduled_at);
              if (!isNaN(parsed.getTime())) {
                events.push({
                  postId: post.id!,
                  postTitle: post.titulo || t('detail.noTitle'),
                  workflowId: post._wfId,
                  workflowTitle: post._wfTitle,
                  date: parsed,
                  tipo: post.tipo,
                  status: post.status,
                });
              }
            }
          }
        }
        setPostCalendarEvents(events);
      })
      .catch(() => {
        toast.error(t('detail.calendarUpdateError'));
      });
  };

  const handlePostStatusUpdate = async (postId: number, newStatus: 'agendado' | 'postado') => {
    setPostUpdating(postId);
    try {
      await updateWorkflowPost(postId, { status: newStatus });
      toast.success(
        newStatus === 'agendado' ? t('detail.postScheduled') : t('detail.postMarkedPosted'),
      );
      refreshPostCalendar();
    } catch {
      toast.error(t('detail.postStatusError'));
    } finally {
      setPostUpdating(null);
    }
  };

  const refreshCards = () => {
    queryClient.invalidateQueries({ queryKey: ['workflowsByCliente', clienteId] });
    queryClient.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-approved-posts-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-cleared-cliente-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-revisao-interna-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-awaiting-cliente-counts'] });
    queryClient.invalidateQueries({ queryKey: ['workflow-covers'] });
    queryClient.invalidateQueries({ queryKey: ['concluded-by-cliente', clienteId] });
    queryClient.invalidateQueries({ queryKey: ['concluded-summaries-cliente'] });
    refreshPostCalendar();
  };

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

  const handleForwardClick = (card: BoardCard) => setForwardTarget(card);

  const handleForwardConfirm = async () => {
    const card = forwardTarget;
    setForwardTarget(null);
    if (!card) return;

    const total = postsCounts.get(card.workflow.id!) ?? 0;
    // "Cleared" (approved / scheduled / posted / publish-failed), not just
    // aprovado_cliente — a workflow whose approved posts are already scheduled
    // should advance without prompting the approval dialog.
    const cleared = clearedClienteCounts.get(card.workflow.id!) ?? 0;
    const allCleared = total > 0 && cleared === total;

    if (card.etapa.tipo === 'aprovacao_cliente' && !allCleared) {
      setApprovalChoiceCard(card);
      return;
    }

    try {
      const result = await completeEtapaForAdvance(card.workflow.id!, card.etapa.id!);
      if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
        setRecurringWfId(card.workflow.id!);
      } else {
        refreshCards();
        toast.success(t('detail.stepCompleted'));
      }
      notifyRearmOutcome(result);
    } catch (err: unknown) {
      toast.error(t('detail.stepError', { error: (err as Error).message }));
    }
  };

  const handleApproveInternally = async () => {
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    if (!card) return;
    try {
      await approvePostsInternally(card.workflow.id!);
      const result = await completeEtapaForAdvance(card.workflow.id!, card.etapa.id!);
      if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
        setRecurringWfId(card.workflow.id!);
      } else {
        refreshCards();
        toast.success(t('detail.stepCompleted'));
      }
      notifyRearmOutcome(result);
    } catch (err: unknown) {
      toast.error(t('detail.stepError', { error: (err as Error).message }));
    }
  };

  const handleSendToPortal = async () => {
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    if (!card) return;
    try {
      await sendPostsToCliente(card.workflow.id!);
      toast.success(t('detail.sentToPortal'));
      refreshCards();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  };

  const handleAdvanceWithoutApproval = async () => {
    const card = approvalChoiceCard;
    setApprovalChoiceCard(null);
    if (!card) return;
    try {
      // Literal contract of this option: post statuses are left alone, so no re-arm.
      const { workflow: updatedWf } = await completeEtapaForAdvance(
        card.workflow.id!,
        card.etapa.id!,
        { rearm: false },
      );
      if (updatedWf.status === 'concluido' && card.workflow.recorrente) {
        setRecurringWfId(card.workflow.id!);
      } else {
        refreshCards();
        toast.success('Etapa avançada — status dos posts mantidos.');
      }
    } catch (err: unknown) {
      toast.error(t('detail.stepError', { error: (err as Error).message }));
    }
  };

  const handleRevertClick = (card: BoardCard) => setRevertTarget(card);

  const handleRevertConfirm = async () => {
    const card = revertTarget;
    setRevertTarget(null);
    if (!card) return;
    try {
      await revertEtapa(card.workflow.id!);
      refreshCards();
      toast.success(t('detail.stepReverted'));
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  };

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

  return (
    <>
      {boardCards.length === 0 ? (
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
        </div>
      ) : (
        <div id="sec-entregas" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
            {t('detail.activeDeliveries')}
          </h3>
          <ResponsiveCardRail className="cliente-deliveries-rail">
            {boardCards.map((card) => (
              <WorkflowCard
                key={card.workflow.id}
                card={card}
                onClick={() => setDrawerCard(card)}
                onEditClick={() => setEditCardModal(card)}
                onPostsClick={() => setDrawerCard(card)}
                onForwardClick={() => handleForwardClick(card)}
                onRevertClick={() => handleRevertClick(card)}
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

          <ClientePostCalendar
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
            onOpenCard={(workflowId) => {
              const card = boardCards.find((candidate) => candidate.workflow.id === workflowId);
              if (card) setDrawerCard(card);
            }}
          />
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

      {/* Recurring workflow confirm */}
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

      {historyWorkflow && (
        <HistoryDrawer
          workflow={historyWorkflow}
          clienteName={cliente?.nome}
          onClose={() => setHistoryWorkflow(null)}
        />
      )}

      {drawerCard && (
        <WorkflowDrawer
          card={drawerCard}
          membros={membros}
          onClose={() => setDrawerCard(null)}
          onRefresh={refreshCards}
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

      <ForwardConfirmDialog
        open={!!forwardTarget}
        workflowTitle={forwardTarget?.workflow.titulo ?? ''}
        nextEtapaName={
          forwardTarget
            ? (forwardTarget.allEtapas.find((e) => e.ordem === forwardTarget.etapaIdx + 1)?.nome ??
              '')
            : ''
        }
        onConfirm={handleForwardConfirm}
        onCancel={() => setForwardTarget(null)}
      />
      <RevertConfirmDialog
        open={!!revertTarget}
        workflowTitle={revertTarget?.workflow.titulo ?? ''}
        onConfirm={handleRevertConfirm}
        onCancel={() => setRevertTarget(null)}
      />
      <ClientApprovalChoiceDialog
        open={!!approvalChoiceCard}
        workflowTitle={approvalChoiceCard?.workflow.titulo ?? ''}
        willRearm={
          approvalChoiceCard
            ? hasLaterApprovalEtapa(approvalChoiceCard.allEtapas, approvalChoiceCard.etapa.id!)
            : false
        }
        onApproveInternally={handleApproveInternally}
        onSendToPortal={handleSendToPortal}
        onAdvanceWithoutChanges={handleAdvanceWithoutApproval}
        onCancel={() => setApprovalChoiceCard(null)}
      />
    </>
  );
}
