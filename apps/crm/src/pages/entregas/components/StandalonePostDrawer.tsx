import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  X,
  Trash2,
  CopyPlus,
  Link2,
  Maximize2,
  Minimize2,
  CircleDashed,
  Route,
  ArrowLeft,
  Check,
  RotateCcw,
  CircleOff,
  Calendar as CalendarIcon,
  FileText,
  ChevronLeft,
} from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import {
  getStandalonePost,
  getPostApprovals,
  getPostStatusEvents,
  getPostProcessEvents,
  getPostCommentThreads,
  getPostEditSuggestions,
  getWorkspaceUsers,
  getClientePosts,
  updateWorkflowPost,
  removeWorkflowPost,
  replyToPostApproval,
  createCommentThread,
  saveIgCaption,
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
  getVigentePostProcess,
  resolvePostProcessRascunhoBanner,
  type Membro,
  type PostEditSuggestion,
  type WorkflowPost,
  type CaptionAnchorPatch,
  type CommentAnchor,
} from '../../../store';
import { isGeralThread } from '@/store/comments';
import { supabase } from '@/lib/supabase';
import { buildUsableTokenMap } from '@/lib/hubTokenMap';
import { extractMentionsFromDoc } from '@/components/mentions/mentionTokens';
import { useAuth } from '@/context/AuthContext';
import { useClienteSocialAccounts } from '@/hooks/useClienteSocialAccounts';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { statusChangeNeedsConfirm, statusKeyToPatch, type StatusKey } from '../statusRegistry';
import { CopyPostLinkButton } from '@/components/CopyPostLinkButton';
import { CopyLinkButton } from '@/components/CopyLinkButton';
import { PostEditorBody } from './PostEditorBody';
// By path, not through the store barrel: the drawer test harnesses mock '@/store'.
import {
  getMediaNotes,
  mediaNotesKey,
  replyToMediaNote,
  setMediaNoteStatus,
} from '@/store/mediaNotes';
import type { MediaNotesBinding } from './mediaNotes/ClientConversation';
import { OpenNotesBadge } from './mediaNotes/OpenNotesBadge';
import { PostTimelinePopover } from './PostTimelinePopover';
import { WorkflowCalendarView } from './WorkflowCalendarView';
import { AttachToFluxoDialog } from './AttachToFluxoDialog';
import { ApplyProcessDialog } from './ApplyProcessDialog';
import { DuplicateDialog, type DuplicateTarget } from './DuplicateDialog';
import { usePostProcessCommands } from '../hooks/usePostProcessCommands';
import { postRascunhoBanner } from '../approvalExit';
import { RascunhoBanner } from './RascunhoBanner';
import { getPostProcessErrorToast, isStaleStateError } from '../postProcessErrors';
import {
  canConcluir,
  forwardLabelFor,
  previousStepOf,
  type ProcessTarget,
} from '../postProcessCommands';
import { copyAppLink } from '@/lib/copyAppLink';
import { buildHubPostLink, compactHubToken } from '@/lib/hubLinks';
import { PhoneIconButton } from '@/components/mobile';
import { useIsPhoneEditor } from './postEditorPhone/useIsPhoneEditor';
import { PhoneEditorScreen } from './postEditorPhone/PhoneEditorScreen';
import type { PhoneMenuAction } from './postEditorPhone/types';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface StandalonePostDrawerProps {
  postId: number;
  /** `&discussao=1` deep link: scroll to the post's team discussion and focus the composer
   *  (phone: open Comentários on Equipe, no keyboard). A counter: a new value asks again
   *  without a remount; 0/undefined = no request. */
  focusRequest?: number;
  /** Fires once `focusRequest` has been applied, so the host stops asking. */
  onDiscussaoFocused?: () => void;
  membros: Membro[];
  onClose: () => void;
  onRefresh: () => void;
  /** Fires once the post is attached to a fluxo -- the caller (EntregasPage)
   *  is expected to close this drawer and open the WorkflowDrawer at the
   *  same post. */
  onAttached: (workflowId: number, postId: number) => void;
  /** Fires once a process template is applied to this avulso (Task 12) -- the
   *  caller is expected to reveal the post's new "Individual" card on the
   *  Fluxos board (revealPostProcesses). */
  onProcessApplied?: (postId: number) => void;
  /** Depois de "Duplicar post": o toast oferece "Abrir" com o id da cópia. */
  onDuplicated?: (newPostId: number) => void;
}

/** The editor's shape while the post loads: the meta row of fields, then the content area. */
function PostEditorSkeleton() {
  return (
    <SkeletonStatus>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-w-0 flex-[1_1_140px] flex-col gap-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-48 w-full" />
        </div>
        <Skeleton className="h-28 w-full" />
      </div>
    </SkeletonStatus>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

/** The home for a post avulso (fora de um fluxo): same drawer shell as
 *  WorkflowDrawer, but scoped to a single post -- sem as abas Grade/Histórico do
 *  fluxo, com a aba Calendário do cliente e uma ação extra "Vincular a um
 *  fluxo". Keyed by postId at every call site, so a new target always remounts
 *  fresh. */
export function StandalonePostDrawer({
  postId,
  focusRequest,
  onDiscussaoFocused,
  membros,
  onClose,
  onRefresh,
  onAttached,
  onProcessApplied,
  onDuplicated,
}: StandalonePostDrawerProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isPhoneEditor = useIsPhoneEditor();

  const { data: post, isLoading } = useQuery({
    queryKey: ['standalone-post', postId],
    queryFn: () => getStandalonePost(postId),
  });

  // Processo individual vigente (spec §5.4). Sempre consultado (a flag só gate
  // criação, PO 2026-09-11): `null` = avulso sem processo.
  const { features } = useWorkspaceLimits();
  const postProcessesEnabled = features?.feature_post_processes === true;
  const { data: postProcess = null } = useQuery({
    queryKey: ['post-process', postId],
    queryFn: () => getVigentePostProcess(postId),
  });
  const activeStepName =
    postProcess?.estado === 'ativo'
      ? (postProcess.steps.find((s) => s.estado === 'ativo')?.nome ??
        postProcess.steps.find((s) => s.ordem === postProcess.etapa_atual)?.nome ??
        null)
      : null;

  const clienteId = post?.cliente_id ?? null;

  const { data: approvals = [] } = useQuery({
    queryKey: ['post-approvals', String(postId)],
    queryFn: () => getPostApprovals([postId]),
  });

  const { data: mediaNotes = [] } = useQuery({
    queryKey: mediaNotesKey([postId]),
    queryFn: () => getMediaNotes([postId]),
  });

  const { data: editSuggestions = [] } = useQuery({
    queryKey: ['post-edit-suggestions', String(postId)],
    queryFn: () => getPostEditSuggestions([postId]),
  });
  const editSuggestion = editSuggestions.find((s) => s.post_id === postId) ?? null;

  // Feeds both PostTimelinePopover (status timeline in the header) and
  // PostVersionHistorySheet's status-anchor interleave (via PostEditorBody
  // below) -- both invalidated together by refresh() below.
  const { data: statusEvents = [] } = useQuery({
    queryKey: ['post-status-events', String(postId)],
    queryFn: () => getPostStatusEvents([postId]),
  });

  const { data: processEvents = [] } = useQuery({
    queryKey: ['post-process-events', String(postId)],
    queryFn: () => getPostProcessEvents([postId]),
  });

  const { user, role, can } = useAuth();
  // Was `currentUserRole === 'owner' || 'admin'` inside PostAutomationSection
  // -- AGENT_ROLE_PRESET.automacoes is 'editar' (lib/permissions.ts), so a
  // legacy agent already gets full write on instagram_comment_automations
  // everywhere else; only this drawer shortcut denied it.
  const canManageAutomations = can('automacoes', 'editar') === true;
  const canDuplicate = can('entregas', 'editar') === true;
  const [duplicateTarget, setDuplicateTarget] = useState<DuplicateTarget | null>(null);

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
      ? `${window.location.origin}/${workspaceSlug}/hub/${compactHubToken(hubToken)}`
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

  /** Mesmo par de abas do drawer de fluxo, reduzido ao que faz sentido para um
   *  post sozinho: o editor e o calendário do cliente. */
  const [drawerView, setDrawerView] = useState<'post' | 'calendar'>('post');
  // A `&discussao=1` link while the Calendário tab is showing: back to the post, whose
  // discussion then scrolls into view and takes focus.
  useEffect(() => {
    if (focusRequest) setDrawerView('post');
  }, [focusRequest]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['standalone-post', postId] });
    qc.invalidateQueries({ queryKey: ['active-posts'] });
    qc.invalidateQueries({ queryKey: ['post-approvals'] });
    qc.invalidateQueries({ queryKey: ['post-status-events'] });
    qc.invalidateQueries({ queryKey: ['post-content-versions'] });
    qc.invalidateQueries({ queryKey: ['post-comment-threads'] });
    qc.invalidateQueries({ queryKey: ['post-edit-suggestions'] });
    qc.invalidateQueries({ queryKey: ['post-process', postId] });
    qc.invalidateQueries({ queryKey: ['post-processes'] });
    qc.invalidateQueries({ queryKey: ['post-process-events'] });
    if (clienteId != null) qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
  }, [qc, postId, clienteId]);

  // ── Comandos do processo individual (Avançar/Voltar/Concluir/Reabrir/Remover) ──

  const commands = usePostProcessCommands({
    onRefresh: () => {
      refresh();
      onRefresh();
    },
  });
  const target: ProcessTarget | null =
    post && postProcess
      ? {
          process: postProcess,
          post: {
            id: post.id!,
            titulo: post.titulo,
            status: post.status,
            cliente_id: post.cliente_id,
          },
        }
      : null;

  // ── Aviso de rascunho (post aprovado numa etapa padrão antes de outra aprovação) ──

  const rascunhoBanner =
    post && postProcess
      ? postRascunhoBanner({
          steps: postProcess.steps,
          estado: postProcess.estado,
          postStatus: post.status,
          dispensadoEm: postProcess.aviso_rascunho_dispensado_em,
        })
      : ({ show: false } as const);
  // Escondido na hora (otimista) para o aviso não piscar até o refetch; volta
  // se a RPC falhar.
  const [hiddenBannerCiclo, setHiddenBannerCiclo] = useState<string | null>(null);
  const [bannerBusy, setBannerBusy] = useState(false);
  // Ref além do estado: dois cliques no mesmo tick ainda veem `bannerBusy` velho.
  const bannerBusyRef = useRef(false);
  const showRascunhoBanner = rascunhoBanner.show && rascunhoBanner.ciclo !== hiddenBannerCiclo;

  const resolveRascunhoBanner = async (reset: boolean) => {
    if (!rascunhoBanner.show || !postProcess || bannerBusyRef.current) return;
    // O ciclo vai para a RPC exatamente como veio (a comparação é em microssegundos).
    const ciclo = rascunhoBanner.ciclo;
    bannerBusyRef.current = true;
    setBannerBusy(true);
    setHiddenBannerCiclo(ciclo);
    try {
      await resolvePostProcessRascunhoBanner(postProcess.id, ciclo, reset);
      if (reset) toast.success('O post voltou para rascunho.');
      qc.invalidateQueries({ queryKey: ['post-process', postId] });
      qc.invalidateQueries({ queryKey: ['standalone-post', postId] });
      onRefresh();
    } catch (err) {
      setHiddenBannerCiclo(null);
      toast.error(
        getPostProcessErrorToast(
          err,
          reset ? 'Erro ao voltar o post para rascunho' : 'Erro ao dispensar o aviso',
        ),
      );
      if (isStaleStateError(err)) {
        refresh();
        onRefresh();
      }
    } finally {
      bannerBusyRef.current = false;
      setBannerBusy(false);
    }
  };

  const rascunhoBannerEl = showRascunhoBanner ? (
    <RascunhoBanner
      count={1}
      entityKind="post"
      busy={bannerBusy}
      onReset={() => void resolveRascunhoBanner(true)}
      onDismiss={() => void resolveRascunhoBanner(false)}
    />
  ) : null;

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
      return true;
    } catch {
      toast.error('Erro ao atualizar post');
      return false;
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
  useUnsavedWork(isSaving);
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
        // The version on screen: the client may have saved a newer one since.
        await acceptEditSuggestion(suggestion.id, suggestion.updated_at);
        if (
          suggestion.changed_fields.includes('conteudo') &&
          suggestion.suggested_conteudo != null
        ) {
          const membroIds = extractMentionsFromDoc(suggestion.suggested_conteudo)
            .filter((ref) => ref.entityType === 'membro')
            .map((ref) => ref.id);
          await syncMentions('workflow_post', suggestion.post_id, membroIds);
        }
        // Wait for the post query to actually land the accepted content before
        // bumping editorVersion (which remounts <PostEditor> via its key prop).
        // PostEditor's TipTap instance is only ever hydrated once, at mount --
        // remounting while ['standalone-post'] is still serving the stale
        // pre-suggestion doc hydrates the editor with that stale doc, and the
        // next autosave (even a non-user content-normalization update) writes
        // it back over the suggestion we just accepted.
        await qc.invalidateQueries({ queryKey: ['standalone-post', postId] });
        setEditorVersion((v) => v + 1);
        toast.success('Sugestão aceita!');
        refresh();
        onRefresh();
      } catch (err) {
        // PostgrestError is a plain object, not an Error instance.
        if (String((err as { message?: unknown })?.message ?? '').includes('suggestion_changed')) {
          toast.error('A sugestão foi atualizada pelo cliente. Revise a nova versão.');
          refresh();
          return;
        }
        toast.error('Erro ao aceitar sugestão');
      }
    },
    [refresh, onRefresh, qc, postId],
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
    async (targetPostId: number, quotedText: string, comment: string, anchor?: CommentAnchor) => {
      const thread = await createCommentThread(targetPostId, quotedText, comment, anchor);
      await refetchComments();
      return thread.id;
    },
    [refetchComments],
  );

  const handleSaveCaption = useCallback(
    async (targetPostId: number, text: string, anchors: CaptionAnchorPatch[]) => {
      try {
        await saveIgCaption(targetPostId, text, anchors);
      } catch (err) {
        toast.error('Erro ao atualizar post');
        throw err;
      }
      await refetchComments(); // threads first, then the post (see WorkflowDrawer)
      refresh();
    },
    [refresh, refetchComments],
  );

  const handleReplyToComment = useCallback(
    async (threadId: number, content: string) => {
      const postId = commentThreads.find((t) => t.id === threadId)?.post_id;
      if (postId === undefined) throw new Error(`Comment thread ${threadId} not found`);
      await addPostComment(postId, threadId, content);
      await refetchComments();
    },
    [refetchComments, commentThreads],
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
      // The post's general thread is permanent (the database rejects deleting it): even
      // with a single message left, only the comment goes.
      if (thread && !isGeralThread(thread) && thread.post_comments.length <= 1) {
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

  const refreshMediaNotes = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['media-notes'] }),
      qc.invalidateQueries({ queryKey: ['post-approvals'] }),
    ]);
  };

  const mediaNotesBinding: MediaNotesBinding = {
    notes: mediaNotes,
    clientName: post?.cliente_nome,
    onChanged: refreshMediaNotes,
    onReply: async (noteId, body) => {
      await replyToMediaNote(noteId, body);
      await refreshMediaNotes();
    },
    onStatus: async (noteIds, status) => {
      await setMediaNoteStatus(noteIds, status);
      await refreshMediaNotes();
    },
  };

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

  const dialogs = (
    <>
      {post && clienteId != null && (
        <AttachToFluxoDialog
          open={attachOpen}
          onClose={() => setAttachOpen(false)}
          postId={postId}
          clienteId={clienteId}
          onAttached={onAttached}
          process={postProcess}
        />
      )}
      {post && (
        <ApplyProcessDialog
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          post={{ id: postId, titulo: post.titulo, cliente_id: post.cliente_id }}
          membros={membros}
          onApplied={() => {
            refresh();
            onRefresh();
            onProcessApplied?.(postId);
          }}
        />
      )}
      {commands.dialogs}

      <DuplicateDialog
        target={duplicateTarget}
        onClose={() => setDuplicateTarget(null)}
        onDuplicated={(newId) => {
          refresh();
          onRefresh();
          toast.success(
            'Post duplicado',
            onDuplicated
              ? { action: { label: 'Abrir', onClick: () => onDuplicated(newId) } }
              : undefined,
          );
        }}
      />

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

  // ── Phone (C4): this drawer IS the pushed editor screen. EntregasPage's drawer entry
  // already covers the layer, so the screen pushes no entry of its own. ──
  if (isPhoneEditor) {
    const phoneMenuActions: PhoneMenuAction[] = [];
    if (post && target && target.process.estado === 'ativo') {
      if (previousStepOf(target.process)) {
        phoneMenuActions.push({
          label: 'Voltar etapa',
          disabled: commands.busy,
          onSelect: () => commands.voltar(target),
        });
      }
      phoneMenuActions.push({
        label: forwardLabelFor(target.process),
        disabled: commands.busy,
        onSelect: () =>
          canConcluir(target.process) ? commands.concluir(target) : commands.avancar(target),
      });
    }
    if (post && target && target.process.estado === 'concluido') {
      phoneMenuActions.push({
        label: 'Reabrir processo',
        disabled: commands.busy,
        onSelect: () => commands.reabrir(target),
      });
    }
    if (post && target) {
      phoneMenuActions.push({
        label: 'Remover processo',
        disabled: commands.busy,
        onSelect: () => commands.remover(target),
      });
    }
    if (post && !postProcess && postProcessesEnabled) {
      phoneMenuActions.push({ label: 'Aplicar processo', onSelect: () => setApplyOpen(true) });
    }
    if (post) {
      phoneMenuActions.push({ label: 'Vincular a um fluxo', onSelect: () => setAttachOpen(true) });
    }
    if (clienteId != null) {
      phoneMenuActions.push({
        label: 'Ver calendário do cliente',
        onSelect: () => setDrawerView('calendar'),
      });
    }
    if (hubUrl) {
      phoneMenuActions.push({
        label: 'Copiar link da postagem',
        immediate: true,
        onSelect: () => {
          navigator.clipboard.writeText(buildHubPostLink(hubUrl, postId)).then(
            () => toast.success('Link copiado!'),
            () => toast.error('Não foi possível copiar o link.'),
          );
        },
      });
    }
    phoneMenuActions.push({
      label: 'Copiar link',
      immediate: true,
      onSelect: () => void copyAppLink(`/entregas?post=${postId}`),
    });
    if (canDuplicate && post) {
      phoneMenuActions.push({
        label: 'Duplicar',
        // Com um save de conteúdo pendente ou em voo a cópia sairia sem a edição.
        disabled: isSaving,
        onSelect: () => setDuplicateTarget({ kind: 'post', postId, status: post.status }),
      });
    }
    phoneMenuActions.push({
      label: 'Excluir post',
      destructive: true,
      onSelect: () => setPendingDelete(true),
    });

    const backOnly = (title: string, body: React.ReactNode, onBack: () => void = onClose) => (
      <div className="phone-editor">
        <div className="phone-editor__scroll">
          <header className="phone-editor-header">
            <div className="phone-editor-header__bar">
              <PhoneIconButton label="Voltar" onClick={onBack}>
                <ChevronLeft aria-hidden="true" />
              </PhoneIconButton>
            </div>
            <h1 className="phone-editor-header__title">{title}</h1>
          </header>
          {body}
        </div>
      </div>
    );

    return (
      <>
        <PhoneEditorScreen open onClose={onClose} label="Editor do post" historyEntry={false}>
          {isLoading ? (
            backOnly('Carregando post…', <PostEditorSkeleton />)
          ) : !post ? (
            backOnly(
              'Post não encontrado',
              <div className="drawer-empty">Este post não existe mais.</div>,
            )
          ) : drawerView === 'calendar' && clienteId != null ? (
            backOnly(
              'Calendário do cliente',
              <WorkflowCalendarView
                clienteId={clienteId}
                clienteNome={post.cliente_nome || '—'}
                currentWorkflowId={null}
                membros={membros}
                hubUrl={hubUrl}
                onBack={() => setDrawerView('post')}
                onPostsChanged={refresh}
                onOpenPost={(id) => {
                  if (id === postId) setDrawerView('post');
                  else navigate(`/entregas?post=${id}`);
                }}
              />,
              () => setDrawerView('post'),
            )
          ) : (
            <PostEditorBody
              layout="phone"
              phone={{
                onBack: onClose,
                subtitle: `${post.cliente_nome || '—'} · ${
                  postProcess
                    ? `Individual · ${activeStepName ?? 'Processo concluído'}`
                    : postProcessesEnabled
                      ? 'Avulso · Sem processo'
                      : 'Avulso'
                }`,
                clientName: post.cliente_nome,
                saving: isSaving,
                menuActions: phoneMenuActions,
                processEvents,
                banner: rascunhoBannerEl,
              }}
              post={post}
              templateId={undefined}
              workflowId={null}
              postProcess={postProcess}
              clienteId={post.cliente_id}
              clientePosts={clientePosts}
              isExpanded
              approvals={approvals}
              mediaNotes={mediaNotesBinding}
              statusEvents={statusEvents}
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
              onSaveCaption={handleSaveCaption}
              onReplyToComment={handleReplyToComment}
              onResolveThread={handleResolveThread}
              onReopenThread={handleReopenThread}
              onEditComment={handleEditComment}
              onDeleteComment={handleDeleteComment}
              editorVersion={editorVersion}
              onAcceptSuggestion={handleAcceptSuggestion}
              onRejectSuggestion={handleRejectSuggestion}
              focusRequest={focusRequest}
              onDiscussaoFocused={onDiscussaoFocused}
              onProcessAvancar={
                target
                  ? () =>
                      canConcluir(target.process)
                        ? commands.concluir(target)
                        : commands.avancar(target)
                  : undefined
              }
            />
          )}
        </PhoneEditorScreen>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />

      <div className={`drawer-panel${isFullscreen ? ' fullscreen' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-header-info">
            <div className="drawer-header-title">
              {isLoading ? (
                <Skeleton className="h-5 w-48 max-w-full" aria-hidden="true" />
              ) : post ? (
                post.titulo || 'Post sem título'
              ) : (
                'Post não encontrado'
              )}
            </div>
            {post && (
              <div className="drawer-header-subtitle">
                {post.cliente_nome || '—'} &bull;{' '}
                {postProcess ? (
                  <span className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual">
                    <Route size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                    Individual · {activeStepName ?? 'Processo concluído'}
                  </span>
                ) : (
                  <span className="post-fluxo-tag post-fluxo-tag--avulso">
                    <CircleDashed size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                    {postProcessesEnabled ? 'Avulso · Sem processo' : 'Avulso'}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="drawer-header-actions">
            {post && (
              <>
                {target && target.process.estado === 'ativo' && (
                  <>
                    {previousStepOf(target.process) && (
                      <button
                        className="drawer-add-post-btn"
                        aria-label="Voltar etapa"
                        onClick={() => commands.voltar(target)}
                        disabled={commands.busy}
                      >
                        <ArrowLeft className="h-3.5 w-3.5" /> Voltar etapa
                      </button>
                    )}
                    <button
                      className="drawer-add-post-btn"
                      aria-label={forwardLabelFor(target.process)}
                      onClick={() =>
                        canConcluir(target.process)
                          ? commands.concluir(target)
                          : commands.avancar(target)
                      }
                      disabled={commands.busy}
                    >
                      <Check className="h-3.5 w-3.5" /> {forwardLabelFor(target.process)}
                    </button>
                  </>
                )}
                {target && target.process.estado === 'concluido' && (
                  <button
                    className="drawer-add-post-btn"
                    aria-label="Reabrir processo"
                    onClick={() => commands.reabrir(target)}
                    disabled={commands.busy}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reabrir processo
                  </button>
                )}
                {target && (
                  <button
                    className="drawer-add-post-btn"
                    aria-label="Remover processo"
                    onClick={() => commands.remover(target)}
                    disabled={commands.busy}
                  >
                    <CircleOff className="h-3.5 w-3.5" /> Remover processo
                  </button>
                )}
                {!postProcess && postProcessesEnabled && (
                  <button
                    className="drawer-add-post-btn"
                    aria-label="Aplicar processo"
                    onClick={() => setApplyOpen(true)}
                  >
                    <Route className="h-3.5 w-3.5" /> Aplicar processo
                  </button>
                )}
                <button className="drawer-add-post-btn" onClick={() => setAttachOpen(true)}>
                  <Link2 className="h-3.5 w-3.5" /> Vincular a um fluxo
                </button>
                {clienteId != null && (
                  <div className="drawer-view-toggle" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={drawerView === 'post'}
                      className={`drawer-calendar-btn${drawerView === 'post' ? ' active' : ''}`}
                      onClick={() => setDrawerView('post')}
                      title="Ver o post"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Post
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={drawerView === 'calendar'}
                      className={`drawer-calendar-btn${drawerView === 'calendar' ? ' active' : ''}`}
                      onClick={() => setDrawerView('calendar')}
                      title="Ver calendário do cliente"
                    >
                      <CalendarIcon className="h-3.5 w-3.5" />
                      Calendário
                    </button>
                  </div>
                )}
                <PostTimelinePopover
                  post={post}
                  events={statusEvents}
                  approvals={approvals}
                  processEvents={processEvents}
                />
                <OpenNotesBadge approvals={approvals} notes={mediaNotes} />
                <CopyPostLinkButton hubUrl={hubUrl} postId={postId} />
                <CopyLinkButton path={`/entregas?post=${postId}`} label="Copiar link do post" />
                {canDuplicate && post && (
                  <button
                    className="drawer-delete-btn"
                    onClick={() =>
                      setDuplicateTarget({ kind: 'post', postId, status: post.status })
                    }
                    // Com um save de conteúdo pendente ou em voo a cópia sairia sem a edição.
                    disabled={isSaving}
                    title="Duplicar post"
                    aria-label="Duplicar post"
                  >
                    <CopyPlus className="h-3.5 w-3.5" />
                  </button>
                )}
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
          </div>
          <button className="drawer-close-btn drawer-dismiss-btn" onClick={onClose} title="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={`drawer-body${drawerView === 'calendar' ? ' drawer-body--calendar' : ''}`}>
          {isLoading ? (
            <PostEditorSkeleton />
          ) : !post ? (
            <div className="drawer-empty">Este post não existe mais.</div>
          ) : drawerView === 'calendar' && clienteId != null ? (
            <WorkflowCalendarView
              clienteId={clienteId}
              clienteNome={post.cliente_nome || '—'}
              currentWorkflowId={null}
              membros={membros}
              hubUrl={hubUrl}
              onBack={() => setDrawerView('post')}
              onPostsChanged={refresh}
              onOpenPost={(id) => {
                // Este post volta para o editor ao lado; qualquer outro passa pelo
                // deep link universal, que o EntregasPage resolve no drawer certo.
                if (id === postId) setDrawerView('post');
                else navigate(`/entregas?post=${id}`);
              }}
            />
          ) : (
            <>
              {rascunhoBannerEl}
              <PostEditorBody
                post={post}
                templateId={undefined}
                workflowId={null}
                postProcess={postProcess}
                clienteId={post.cliente_id}
                clientePosts={clientePosts}
                isExpanded
                approvals={approvals}
                mediaNotes={mediaNotesBinding}
                statusEvents={statusEvents}
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
                onSaveCaption={handleSaveCaption}
                onReplyToComment={handleReplyToComment}
                onResolveThread={handleResolveThread}
                onReopenThread={handleReopenThread}
                onEditComment={handleEditComment}
                onDeleteComment={handleDeleteComment}
                editorVersion={editorVersion}
                onAcceptSuggestion={handleAcceptSuggestion}
                onRejectSuggestion={handleRejectSuggestion}
                focusRequest={focusRequest}
                onDiscussaoFocused={onDiscussaoFocused}
                onProcessAvancar={
                  target
                    ? () =>
                        canConcluir(target.process)
                          ? commands.concluir(target)
                          : commands.avancar(target)
                    : undefined
                }
              />
            </>
          )}
          {isSaving && <span className="drawer-saving-indicator">Salvando…</span>}
        </div>
      </div>

      {dialogs}
    </>
  );
}
