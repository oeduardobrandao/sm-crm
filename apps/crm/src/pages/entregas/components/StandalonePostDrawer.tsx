import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Trash2, Link2, Maximize2, Minimize2, CircleDashed } from 'lucide-react';
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
import {
  getStandalonePost,
  getPostApprovals,
  getPostStatusEvents,
  getPostCommentThreads,
  getPostEditSuggestions,
  getWorkspaceUsers,
  getClientePosts,
  updateWorkflowPost,
  removeWorkflowPost,
  replyToPostApproval,
  createCommentThread,
  addPostComment,
  updatePostComment,
  deletePostComment,
  resolveCommentThread,
  reopenCommentThread,
  deleteCommentThread,
  acceptEditSuggestion,
  rejectEditSuggestion,
  syncMentions,
  getWorkspaceSlug,
  type Membro,
  type PostEditSuggestion,
  type WorkflowPost,
} from '../../../store';
import { supabase } from '@/lib/supabase';
import { buildUsableTokenMap } from '@/lib/hubTokenMap';
import { extractMentionsFromDoc } from '@/components/mentions/mentionTokens';
import { useAuth } from '@/context/AuthContext';
import { useClienteSocialAccounts } from '@/hooks/useClienteSocialAccounts';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { statusChangeNeedsConfirm, statusKeyToPatch, type StatusKey } from '../statusRegistry';
import { CopyPostLinkButton } from '@/components/CopyPostLinkButton';
import { PostEditorBody } from './PostEditorBody';
import { AttachToFluxoDialog } from './AttachToFluxoDialog';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface StandalonePostDrawerProps {
  postId: number;
  membros: Membro[];
  onClose: () => void;
  onRefresh: () => void;
  /** Fires once the post is attached to a fluxo -- the caller (EntregasPage)
   *  is expected to close this drawer and open the WorkflowDrawer at the
   *  same post. */
  onAttached: (workflowId: number, postId: number) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

/** The home for a post avulso (fora de um fluxo): same drawer shell as
 *  WorkflowDrawer, but scoped to a single post with no fluxo tabs (calendar/
 *  grade/histórico) and an extra "Vincular a um fluxo" action. Keyed by
 *  postId at every call site, so a new target always remounts fresh. */
export function StandalonePostDrawer({
  postId,
  membros,
  onClose,
  onRefresh,
  onAttached,
}: StandalonePostDrawerProps) {
  const qc = useQueryClient();

  const { data: post, isLoading } = useQuery({
    queryKey: ['standalone-post', postId],
    queryFn: () => getStandalonePost(postId),
  });

  const clienteId = post?.cliente_id ?? null;

  const { data: approvals = [] } = useQuery({
    queryKey: ['post-approvals', String(postId)],
    queryFn: () => getPostApprovals([postId]),
  });

  const { data: editSuggestions = [] } = useQuery({
    queryKey: ['post-edit-suggestions', String(postId)],
    queryFn: () => getPostEditSuggestions([postId]),
  });
  const editSuggestion = editSuggestions.find((s) => s.post_id === postId) ?? null;

  // Fetched (and invalidated by refresh() below) for parity with WorkflowDrawer's own
  // query set even though this single-post shell has no timeline popover to show it in --
  // any other open surface caching ['post-status-events', ...] for this post still needs
  // to see this drawer's status changes.
  useQuery({
    queryKey: ['post-status-events', String(postId)],
    queryFn: () => getPostStatusEvents([postId]),
  });

  const { user, role, can } = useAuth();
  // Was `currentUserRole === 'owner' || 'admin'` inside PostAutomationSection
  // -- AGENT_ROLE_PRESET.automacoes is 'editar' (lib/permissions.ts), so a
  // legacy agent already gets full write on instagram_comment_automations
  // everywhere else; only this drawer shortcut denied it.
  const canManageAutomations = can('automacoes', 'editar') === true;

  const { data: workspaceUsers = [] } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
  });

  const { data: commentThreads = [], refetch: refetchComments } = useQuery({
    queryKey: ['post-comment-threads', String(postId)],
    queryFn: () => getPostCommentThreads([postId]),
  });

  // Reuses the same ['clientePosts', clienteId] key as WorkflowDrawer/WorkflowCalendarView,
  // so this is a cache hit whenever either already loaded it. Feeds the date picker's
  // per-row scheduled-day markers inside PostEditorBody.
  const { data: clientePosts = [] } = useQuery({
    queryKey: ['clientePosts', clienteId],
    queryFn: () => getClientePosts(clienteId!),
    enabled: clienteId != null,
  });

  const { hasInstagramAccount, igAccountStatus, hasActiveTikTokAccount, ttAccountStatus } =
    useClienteSocialAccounts(clienteId ?? 0);

  const statusRegistry = useStatusRegistry();

  // ── hubUrl resolution (mirrors useEntregasData's own slug + token lookup, ~291-302,
  // but scoped to this single cliente instead of a batch). ─────────────────────────
  const { data: workspaceSlug } = useQuery({
    queryKey: ['workspace-slug'],
    queryFn: getWorkspaceSlug,
  });
  const { data: hubToken } = useQuery({
    queryKey: ['hub-token', clienteId],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_hub_tokens')
        .select('cliente_id, token, expires_at, is_active')
        .eq('cliente_id', clienteId!)
        .eq('is_active', true);
      return buildUsableTokenMap(data ?? [], new Date().toISOString()).get(clienteId!) ?? null;
    },
    enabled: clienteId != null,
  });
  const hubUrl =
    hubToken && workspaceSlug
      ? `${window.location.origin}/${workspaceSlug}/hub/${hubToken}`
      : undefined;

  const [isFullscreen, setIsFullscreen] = useState(
    () => localStorage.getItem('workflow-drawer-fullscreen') === '1',
  );
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const next = !prev;
      localStorage.setItem('workflow-drawer-fullscreen', next ? '1' : '0');
      return next;
    });
  }, []);

  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['standalone-post', postId] });
    qc.invalidateQueries({ queryKey: ['active-posts'] });
    qc.invalidateQueries({ queryKey: ['post-approvals'] });
    qc.invalidateQueries({ queryKey: ['post-status-events'] });
    qc.invalidateQueries({ queryKey: ['post-comment-threads'] });
    qc.invalidateQueries({ queryKey: ['post-edit-suggestions'] });
    if (clienteId != null) qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
  }, [qc, postId, clienteId]);

  // ── Field change / status confirm ────────────────────────────────────────────

  const [pendingStatusChange, setPendingStatusChange] = useState<StatusKey | null>(null);

  const handleFieldChange = async (field: keyof WorkflowPost, value: unknown) => {
    if (field === 'status') {
      const key = value as StatusKey;
      if (statusChangeNeedsConfirm(post, key, statusRegistry)) {
        setPendingStatusChange(key);
        return;
      }
      try {
        await updateWorkflowPost(postId, statusKeyToPatch(key));
        refresh();
      } catch {
        toast.error('Erro ao atualizar post');
      }
      return;
    }
    try {
      await updateWorkflowPost(postId, { [field]: value } as Partial<WorkflowPost>);
      refresh();
    } catch {
      toast.error('Erro ao atualizar post');
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!pendingStatusChange) return;
    const key = pendingStatusChange;
    setPendingStatusChange(null);
    try {
      await updateWorkflowPost(postId, statusKeyToPatch(key));
      refresh();
    } catch {
      toast.error('Erro ao atualizar status');
    }
  };

  // ── Content autosave (debounced, cloned from WorkflowDrawer's scheduleContentSave) ──

  const [isSaving, setIsSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmedEditRef = useRef(false);
  const [pendingEditData, setPendingEditData] = useState<{
    json: Record<string, unknown>;
    plain: string;
  } | null>(null);

  const scheduleContentSave = (json: Record<string, unknown>, plain: string) => {
    if (!post) return;
    const isApproved = post.status === 'aprovado_interno' || post.status === 'aprovado_cliente';

    if (isApproved && !confirmedEditRef.current) {
      setPendingEditData({ json, plain });
      return;
    }

    setIsSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await updateWorkflowPost(postId, { conteudo: json, conteudo_plain: plain });
        refresh();
      } catch {
        toast.error('Erro ao salvar conteúdo');
      } finally {
        setIsSaving(false);
      }
    }, 1500);
  };

  const handleConfirmEdit = async () => {
    if (!pendingEditData) return;
    const editData = pendingEditData;
    setPendingEditData(null);
    // The approval invalidation must land BEFORE the content save is armed:
    // saving new content on a still-approved post would defeat the confirm.
    try {
      await updateWorkflowPost(postId, { status: 'revisao_interna' });
      refresh();
    } catch {
      toast.error('Não foi possível invalidar a aprovação. O conteúdo não foi salvo.');
      return;
    }
    confirmedEditRef.current = true;
    setIsSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await updateWorkflowPost(postId, {
          conteudo: editData.json,
          conteudo_plain: editData.plain,
        });
        refresh();
      } catch {
        toast.error('Erro ao salvar conteúdo');
      } finally {
        setIsSaving(false);
      }
    }, 1500);
  };

  const handleCancelEdit = () => {
    setPendingEditData(null);
    refresh();
  };

  // ── Edit suggestions ──────────────────────────────────────────────────────────

  const [editorVersion, setEditorVersion] = useState(0);

  const handleAcceptSuggestion = useCallback(
    async (suggestion: PostEditSuggestion) => {
      try {
        await acceptEditSuggestion(suggestion.id);
        if (
          suggestion.changed_fields.includes('conteudo') &&
          suggestion.suggested_conteudo != null
        ) {
          const membroIds = extractMentionsFromDoc(suggestion.suggested_conteudo)
            .filter((ref) => ref.entityType === 'membro')
            .map((ref) => ref.id);
          await syncMentions('workflow_post', suggestion.post_id, membroIds);
        }
        setEditorVersion((v) => v + 1);
        toast.success('Sugestão aceita!');
        refresh();
        onRefresh();
      } catch {
        toast.error('Erro ao aceitar sugestão');
      }
    },
    [refresh, onRefresh],
  );

  const [pendingRejectSuggestionId, setPendingRejectSuggestionId] = useState<number | null>(null);
  const handleRejectSuggestion = useCallback((id: number) => setPendingRejectSuggestionId(id), []);
  const confirmRejectSuggestion = useCallback(async () => {
    if (!pendingRejectSuggestionId) return;
    const id = pendingRejectSuggestionId;
    setPendingRejectSuggestionId(null);
    try {
      await rejectEditSuggestion(id);
      toast.success('Sugestão rejeitada');
      refresh();
    } catch {
      toast.error('Erro ao rejeitar sugestão');
    }
  }, [pendingRejectSuggestionId, refresh]);

  // ── Comment threads ───────────────────────────────────────────────────────────

  const handleCreateComment = useCallback(
    async (targetPostId: number, quotedText: string, comment: string) => {
      const thread = await createCommentThread(targetPostId, quotedText, comment);
      await refetchComments();
      return thread.id;
    },
    [refetchComments],
  );

  const handleReplyToComment = useCallback(
    async (threadId: number, content: string) => {
      await addPostComment(threadId, content);
      await refetchComments();
    },
    [refetchComments],
  );

  const handleResolveThread = useCallback(
    async (threadId: number) => {
      await resolveCommentThread(threadId);
      await refetchComments();
    },
    [refetchComments],
  );

  const handleReopenThread = useCallback(
    async (threadId: number) => {
      await reopenCommentThread(threadId);
      await refetchComments();
    },
    [refetchComments],
  );

  const handleEditComment = useCallback(
    async (commentId: number, content: string) => {
      await updatePostComment(commentId, content);
      await refetchComments();
    },
    [refetchComments],
  );

  const handleDeleteComment = useCallback(
    async (commentId: number, threadId: number) => {
      const thread = commentThreads.find((t) => t.id === threadId);
      if (thread && thread.post_comments.length <= 1) {
        await deleteCommentThread(threadId);
      } else {
        await deletePostComment(commentId);
      }
      await refetchComments();
    },
    [refetchComments, commentThreads],
  );

  // ── Reply to client ───────────────────────────────────────────────────────────

  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const handleReplySend = async () => {
    const text = replyText.trim();
    if (!text) return;
    setSendingReply(true);
    try {
      // Post avulso: no workflow context to pass (see replyToPostApproval's doc comment --
      // post_approvals keys on post_id alone, so null here behaves the same as a real id).
      await replyToPostApproval(postId, null, text);
      setReplyText('');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar resposta');
    } finally {
      setSendingReply(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────

  const confirmDeletePost = async () => {
    setPendingDelete(false);
    try {
      await removeWorkflowPost(postId);
      qc.invalidateQueries({ queryKey: ['active-posts'] });
      if (clienteId != null) qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
      onRefresh();
      onClose();
    } catch {
      toast.error('Erro ao remover post');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />

      <div className={`drawer-panel${isFullscreen ? ' fullscreen' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-header-info">
            <div className="drawer-header-title">
              {isLoading
                ? 'Carregando…'
                : post
                  ? post.titulo || 'Post sem título'
                  : 'Post não encontrado'}
            </div>
            {post && (
              <div className="drawer-header-subtitle">
                {post.cliente_nome || '—'} &bull;{' '}
                <span className="post-fluxo-tag post-fluxo-tag--avulso">
                  <CircleDashed size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                  Avulso
                </span>
              </div>
            )}
          </div>
          <div className="drawer-header-actions">
            {post && (
              <>
                <button className="drawer-add-post-btn" onClick={() => setAttachOpen(true)}>
                  <Link2 className="h-3.5 w-3.5" /> Vincular a um fluxo
                </button>
                <CopyPostLinkButton hubUrl={hubUrl} postId={postId} />
                <button
                  className="drawer-delete-btn"
                  onClick={() => setPendingDelete(true)}
                  title="Remover post"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              className="drawer-close-btn drawer-fullscreen-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Recolher' : 'Expandir'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button className="drawer-close-btn" onClick={onClose} title="Fechar">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="drawer-body">
          {isLoading ? (
            <div className="drawer-empty">Carregando...</div>
          ) : !post ? (
            <div className="drawer-empty">Este post não existe mais.</div>
          ) : (
            <PostEditorBody
              post={post}
              templateId={undefined}
              workflowId={null}
              clienteId={post.cliente_id}
              clientePosts={clientePosts}
              isExpanded
              approvals={approvals}
              editSuggestion={editSuggestion}
              membros={membros}
              replyText={replyText}
              sendingReply={sendingReply}
              commentThreads={commentThreads}
              currentUserId={user?.id}
              currentUserRole={role}
              canManageAutomations={canManageAutomations}
              workspaceUsers={workspaceUsers}
              hasInstagramAccount={hasInstagramAccount}
              igAccountStatus={igAccountStatus}
              hasActiveTikTokAccount={hasActiveTikTokAccount}
              ttAccountStatus={ttAccountStatus}
              onFieldChange={handleFieldChange}
              onContentUpdate={scheduleContentSave}
              onReplyChange={setReplyText}
              onReplySend={handleReplySend}
              onRefresh={refresh}
              onCreateComment={handleCreateComment}
              onReplyToComment={handleReplyToComment}
              onResolveThread={handleResolveThread}
              onReopenThread={handleReopenThread}
              onEditComment={handleEditComment}
              onDeleteComment={handleDeleteComment}
              editorVersion={editorVersion}
              onAcceptSuggestion={handleAcceptSuggestion}
              onRejectSuggestion={handleRejectSuggestion}
            />
          )}
          {isSaving && <span className="drawer-saving-indicator">Salvando…</span>}
        </div>
      </div>

      {post && clienteId != null && (
        <AttachToFluxoDialog
          open={attachOpen}
          onClose={() => setAttachOpen(false)}
          postId={postId}
          clienteId={clienteId}
          onAttached={onAttached}
        />
      )}

      <AlertDialog open={pendingDelete} onOpenChange={(open) => !open && setPendingDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover post?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O post e seu conteúdo serão excluídos
              permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDelete(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeletePost}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingEditData} onOpenChange={(open) => !open && handleCancelEdit()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post aprovado</AlertDialogTitle>
            <AlertDialogDescription>
              Este post foi aprovado. Editá-lo vai invalidar a aprovação e resetar o status para "Em
              revisão". Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelEdit}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmEdit}>Confirmar edição</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingStatusChange}
        onOpenChange={(open) => !open && setPendingStatusChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post aprovado</AlertDialogTitle>
            <AlertDialogDescription>
              Este post foi aprovado. Alterar o status vai invalidar a aprovação. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingStatusChange(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmStatusChange}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingRejectSuggestionId}
        onOpenChange={(open) => !open && setPendingRejectSuggestionId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rejeitar sugestão?</AlertDialogTitle>
            <AlertDialogDescription>
              A sugestão do cliente será rejeitada e ele será notificado. O conteúdo original do
              post será mantido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingRejectSuggestionId(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmRejectSuggestion}>Rejeitar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
