import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import {
  X,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  MessagesSquare,
  Check,
  Flag,
  Lock,
} from 'lucide-react';
import {
  getWorkflowEtapas,
  getWorkflowPostsWithProperties,
  getPostApprovals,
  getMembros,
  getPostCommentThreads,
  getWorkflowEvents,
  getWorkspaceUsers,
  type Workflow,
  type WorkflowEtapa,
  type WorkflowPost,
  type PostApproval,
  type PostPropertyValue,
  type CommentThreadWithComments,
  type Membro,
} from '../../../store';
import { isGeralThread } from '@/store/comments';
import { Badge } from '@/components/ui/badge';
import { DiscussaoTimeline, type DiscussaoWorkspaceUser } from '../discussao/DiscussaoEquipe';
import { buildTimeline } from '../discussao/timeline';
import { computeDeadlineDate } from '../hooks/useEntregasData';
import { PostEditor } from './PostEditor';
import { PropertyPanel } from './PropertyPanel';
import PostCommentSummary from './PostCommentSummary';
import { WorkflowHistoryList } from './WorkflowHistoryView';
import { buildWorkflowTimeline } from './workflowTimeline';
import { TIPO_LABELS } from '../postLabels';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { PostStatusChip } from './PostStatusChip';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import './historyPage.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(getIntlLocale(), { day: '2-digit', month: 'short' });
}

function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString(getIntlLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

interface EtapaCompliance {
  etapa: WorkflowEtapa;
  daysUsed: number;
  deadline: Date;
  daysOverdue: number;
  assigneeName: string;
}

function computeCompliance(
  etapas: WorkflowEtapa[],
  membros: { id?: number; nome: string }[],
): EtapaCompliance[] {
  return etapas
    .filter((e) => e.status === 'concluido' && e.iniciado_em && e.concluido_em)
    .map((e) => {
      const deadline = computeDeadlineDate(e.iniciado_em!, e.prazo_dias, e.tipo_prazo);
      const daysUsed = daysBetween(e.iniciado_em!, e.concluido_em!);
      const concludedDate = new Date(e.concluido_em!);
      const daysOverdue =
        concludedDate > deadline
          ? Math.ceil((concludedDate.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
      const membro = e.responsavel_id
        ? membros.find((m) => m.id != null && m.id === e.responsavel_id)
        : undefined;
      return { etapa: e, daysUsed, deadline, daysOverdue, assigneeName: membro?.nome ?? '—' };
    });
}

interface HistoryDrawerProps {
  workflow: Workflow;
  clienteName?: string;
  onClose: () => void;
  /**
   * `drawer` (default): the right-hand panel over an overlay. `page`: a pushed screen
   * for phones, in the page flow under its own nav bar (Back = `onClose`). The caller
   * renders it in place of the page content and registers the history entry.
   */
  variant?: 'drawer' | 'page';
}

export function HistoryDrawer({
  workflow,
  clienteName,
  onClose,
  variant = 'drawer',
}: HistoryDrawerProps) {
  const { t } = useTranslation('workflows');
  const workflowId = workflow.id!;
  const [expandedPostId, setExpandedPostId] = useState<number | null>(null);

  const { data: etapas = [] } = useQuery({
    queryKey: ['history-etapas', workflowId],
    queryFn: () => getWorkflowEtapas(workflowId),
  });

  const { data: posts = [] } = useQuery({
    queryKey: ['history-posts', workflowId],
    queryFn: () => getWorkflowPostsWithProperties(workflowId),
  });

  const { data: membros = [] } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });

  // Same key as the fluxo drawer so the cache is shared; resolves authors without a membros row.
  const { data: workspaceUsers = [] } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
  });

  const postIds = posts.map((p) => p.id).filter(Boolean) as number[];
  const { data: approvals = [] } = useQuery({
    queryKey: ['history-approvals', postIds.join(',')],
    queryFn: () => getPostApprovals(postIds),
    enabled: postIds.length > 0,
  });

  const { data: commentThreads = [] } = useQuery({
    queryKey: ['history-comment-threads', postIds.join(',')],
    queryFn: () => getPostCommentThreads(postIds),
    enabled: postIds.length > 0,
  });

  const { data: events = [] } = useQuery({
    queryKey: ['workflow-events', workflowId],
    queryFn: () => getWorkflowEvents(workflowId),
  });
  const historyNodes = buildWorkflowTimeline(events);

  const compliance = computeCompliance(etapas, membros);
  const statusRegistry = useStatusRegistry();

  const firstStart = etapas.find((e) => e.iniciado_em)?.iniciado_em;
  const concludedEtapas = etapas.filter((e) => e.concluido_em);
  const lastEnd =
    concludedEtapas.length > 0 ? concludedEtapas[concludedEtapas.length - 1].concluido_em : null;
  const totalDays = firstStart && lastEnd ? daysBetween(firstStart, lastEnd) : null;

  const subtitle = (
    <>
      {clienteName || '—'}
      {lastEnd && <> &bull; {t('historyDrawer.concludedOn', { date: formatDateFull(lastEnd) })}</>}
    </>
  );
  const duration =
    totalDays !== null ? (
      <div className="history-duration">
        {t('historyDrawer.totalDuration', { count: totalDays })}
      </div>
    ) : null;

  const body = (
    <div className="drawer-body">
      <div style={{ marginBottom: '1.5rem' }}>
        <div className="history-section-title">{t('historyDrawer.stages')}</div>
        <div className="history-timeline">
          {compliance.map((c, i) => {
            const isLate = c.daysOverdue > 0;
            const mod = isLate ? 'late' : 'ok';
            return (
              <div key={c.etapa.id} className="history-step">
                <div className="history-step-track">
                  <div className={`history-step-icon history-step-icon--${mod}`}>
                    <Check className="h-3 w-3" />
                  </div>
                  {i < compliance.length - 1 && (
                    <div className={`history-step-line history-step-line--${mod}`} />
                  )}
                </div>
                <div className="history-step-body">
                  <div className="history-step-header">
                    <span className="history-step-name">{c.etapa.nome}</span>
                    <span className={`history-step-badge history-step-badge--${mod}`}>
                      {isLate
                        ? t('historyDrawer.daysLate', { n: c.daysOverdue })
                        : t('historyDrawer.onTime')}
                    </span>
                  </div>
                  <div className="history-step-detail">
                    {t('historyDrawer.stepDetail', {
                      assignee: c.assigneeName,
                      start: formatDateShort(c.etapa.iniciado_em!),
                      end: formatDateShort(c.etapa.concluido_em!),
                      count: c.daysUsed,
                      deadline: t(
                        c.etapa.tipo_prazo === 'uteis'
                          ? 'historyDrawer.deadlineUteis'
                          : 'historyDrawer.deadlineCorridos',
                        { n: c.etapa.prazo_dias },
                      ),
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="history-final-node">
            <div className="history-final-icon">
              <Flag className="h-3 w-3" />
            </div>
            <span>{t('historyDrawer.flowDone')}</span>
          </div>
        </div>
      </div>

      {historyNodes.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="history-section-title">{t('historyDrawer.history')}</div>
          <WorkflowHistoryList nodes={historyNodes} />
        </div>
      )}

      <div>
        <div className="history-section-title">
          {t('historyDrawer.postsCount', { n: posts.length })}
        </div>
        <div className="drawer-posts-list">
          {posts.map((post) => {
            const isExpanded = expandedPostId === post.id;
            const postApprovals = approvals.filter((a) => a.post_id === post.id);
            return (
              <div key={post.id} className={`drawer-post-item${isExpanded ? ' expanded' : ''}`}>
                <div
                  className="drawer-post-trigger"
                  onClick={() => setExpandedPostId(isExpanded ? null : post.id!)}
                >
                  <div className="drawer-post-trigger-left">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 drawer-post-chevron" />
                    ) : (
                      <ChevronRight className="h-4 w-4 drawer-post-chevron" />
                    )}
                    <span className="post-tipo-badge">{TIPO_LABELS[post.tipo]}</span>
                    <span className="drawer-post-titulo">
                      {post.titulo || t('shared.postUntitled')}
                    </span>
                  </div>
                  <div className="drawer-post-trigger-right">
                    <PostStatusChip post={post} registry={statusRegistry} />
                  </div>
                </div>

                {isExpanded && (
                  <div className="drawer-post-content">
                    {workflow.template_id != null && workflow.template_id !== 0 && (
                      <PropertyPanel
                        templateId={workflow.template_id}
                        postId={post.id!}
                        workflowId={workflowId}
                        propertyValues={
                          (post as WorkflowPost & { property_values?: PostPropertyValue[] })
                            .property_values ?? []
                        }
                        membros={membros}
                        readOnly
                      />
                    )}

                    <PostEditor
                      key={post.id}
                      initialContent={post.conteudo}
                      disabled
                      onUpdate={() => {}}
                      threads={commentThreads.filter((t) => t.post_id === post.id)}
                      membros={membros}
                    />

                    <HistoryDiscussao
                      threads={commentThreads.filter((t) => t.post_id === post.id)}
                      membros={membros}
                      workspaceUsers={workspaceUsers}
                    />

                    <PostCommentSummary
                      threads={commentThreads.filter((t) => t.post_id === post.id)}
                      membros={membros}
                      workspaceUsers={workspaceUsers}
                      onThreadClick={() => {}}
                      readOnly
                    />

                    {postApprovals.length > 0 && (
                      <div className="history-approval-thread">
                        <div className="history-thread-label">
                          <MessageSquare className="h-3.5 w-3.5" />{' '}
                          {t('historyDrawer.comments', { n: postApprovals.length })}
                        </div>
                        {postApprovals.map((a) => (
                          <ApprovalBubble key={a.id} approval={a} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (variant === 'page') {
    return (
      <div className="phone-history-page">
        <PhoneNavBar backLabel={t('actions.back')} onBack={onClose} />
        <header className="phone-kit phone-large-title phone-history-page__head">
          <h1 className="phone-large-title__title">{workflow.titulo}</h1>
          <p className="phone-large-title__subtitle">{subtitle}</p>
          {duration}
        </header>
        {body}
      </div>
    );
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel">
        <div className="drawer-header">
          <div className="drawer-header-info">
            <div className="drawer-header-title">{workflow.titulo}</div>
            <div className="drawer-header-subtitle">{subtitle}</div>
            {duration}
          </div>
          <button
            className="drawer-close-btn drawer-dismiss-btn"
            onClick={onClose}
            title={t('ui.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {body}
      </div>
    </>
  );
}

/**
 * The post's general team discussion, read-only: messages only, no composer, bell, chat
 * bridge, read marker or realtime. Passage threads stay in the PostCommentSummary below.
 */
function HistoryDiscussao({
  threads,
  membros,
  workspaceUsers,
}: {
  threads: CommentThreadWithComments[];
  membros: Membro[];
  workspaceUsers: DiscussaoWorkspaceUser[];
}) {
  const { t } = useTranslation('workflows');
  const items = useMemo(
    () =>
      buildTimeline({
        threads: threads.filter(isGeralThread),
        lastSeenCommentId: null,
        currentUserId: '',
        now: new Date(),
      }),
    [threads],
  );
  if (items.length === 0) return null;

  return (
    <section className="discussao" aria-label={t('historyDrawer.discussion')}>
      <div className="discussao-header">
        <MessagesSquare className="discussao-header-icon h-4 w-4" aria-hidden="true" />
        <h3 className="discussao-title">{t('historyDrawer.discussion')}</h3>
        <Badge variant="neutral" size="sm" className="discussao-badge">
          <Lock className="h-3 w-3" aria-hidden="true" />
          {t('historyDrawer.teamOnly')}
        </Badge>
      </div>
      <DiscussaoTimeline
        items={items}
        membros={membros}
        workspaceUsers={workspaceUsers}
        currentUserId=""
        onThreadClick={() => {}}
      />
    </section>
  );
}

function ApprovalBubble({ approval }: { approval: PostApproval }) {
  const { t } = useTranslation('workflows');
  const isTeam = approval.is_workspace_user;
  const actionLabel = isTeam
    ? t('historyDrawer.team')
    : approval.action === 'correcao'
      ? t('historyDrawer.changesRequested')
      : approval.action === 'aprovado'
        ? t('historyDrawer.approved')
        : t('historyDrawer.client');

  return (
    <div
      className={`approval-bubble${isTeam ? ' approval-bubble--team' : ' approval-bubble--client'}`}
    >
      <div className="approval-bubble-meta">
        <span className="approval-bubble-author">{actionLabel}</span>
        <span className="approval-bubble-date">
          {new Date(approval.created_at).toLocaleDateString(getIntlLocale(), {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      {approval.comentario && <p className="approval-bubble-text">{approval.comentario}</p>}
    </div>
  );
}
