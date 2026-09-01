import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X,
  Plus,
  Trash2,
  Send,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  GripVertical,
  ImageIcon,
  Eye,
  EyeOff,
  Calendar as CalendarIcon,
  LayoutGrid,
  Maximize2,
  Minimize2,
  History,
  MoreVertical,
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getWorkflowPostsWithProperties,
  addWorkflowPost,
  updateWorkflowPost,
  removeWorkflowPost,
  reorderWorkflowPosts,
  sendPostsToCliente,
  getPostApprovals,
  getPostStatusEvents,
  replyToPostApproval,
  getPostCommentThreads,
  createCommentThread,
  addPostComment,
  updatePostComment,
  deletePostComment,
  resolveCommentThread,
  reopenCommentThread,
  deleteCommentThread,
  getWorkspaceUsers,
  getPostEditSuggestions,
  acceptEditSuggestion,
  rejectEditSuggestion,
  getClientePosts,
  syncMentions,
  detachPostsFromWorkflow,
  type WorkflowPost,
  type PostApproval,
  type PostStatusEvent,
  type Membro,
  type PostPropertyValue,
  type CommentThreadWithComments,
  type PostEditSuggestion,
  type ClientePost,
} from '../../../store';
import { extractMentionsFromDoc } from '@/components/mentions/mentionTokens';
import type { BoardCard } from '../hooks/useEntregasData';
import { shouldAutoCompleteApproval } from './autoComplete';
import { completeEtapaForAdvance, notifyRearmOutcome } from '../advanceEtapa';
import { PostTimelinePopover } from './PostTimelinePopover';
import { useAuth } from '@/context/AuthContext';
import { hasVideoMissingThumbnail } from './PostMediaGallery';
import { listPostMedia } from '../../../services/postMedia';
import { WorkflowCalendarView } from './WorkflowCalendarView';
import { WorkflowGridView } from './WorkflowGridView';
import { WorkflowHistoryView } from './WorkflowHistoryView';
import { CopyPostLinkButton } from '@/components/CopyPostLinkButton';
import {
  TIPO_LABELS,
  getPostPublishState,
  isVisibleToClient,
  VISIBILITY_BADGE_LABEL,
} from '../postLabels';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { statusChangeNeedsConfirm, statusKeyToPatch, type StatusKey } from '../statusRegistry';
import { PostStatusChip } from './PostStatusChip';
import { formatPostDate, formatPostDateFull } from '@/utils/postDate';
import { PostEditorBody } from './PostEditorBody';
import { useClienteSocialAccounts } from '@/hooks/useClienteSocialAccounts';
import { MovePostsToFluxoDialog } from './MovePostsToFluxoDialog';

/** Maps detach_posts_from_flow's identifier-style RPC errors (see
 *  supabase/migrations/20260830000004_post_detach_attach_rpcs.sql) to PT copy.
 *  `post_not_found` is the only identifier that can realistically surface here
 *  (a post selected in this very drawer got deleted from another tab/session
 *  between render and confirm) -- everything else (post_ids_required,
 *  workspace_not_found) can't happen from this call site, so they fall back
 *  to the generic message rather than getting their own copy. */
function getDetachErrorToast(err: unknown): string {
  const message =
    err && typeof err === 'object' && 'message' in err
      ? (err as { message?: unknown }).message
      : undefined;
  if (message === 'post_not_found') {
    return 'Um ou mais posts não foram encontrados.';
  }
  return 'Erro ao desmembrar posts';
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface WorkflowDrawerProps {
  card: BoardCard;
  membros: Membro[];
  onClose: () => void;
  onRefresh: () => void;
  initialPostId?: number;
  /** Opens another workflow's drawer (used after moving posts to a new or
   *  existing flow, so the user lands where the posts went). Optional: call
   *  sites without it just close this drawer. */
  onOpenWorkflow?: (workflowId: number) => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function WorkflowDrawer({
  card,
  membros,
  onClose,
  onRefresh,
  initialPostId,
  onOpenWorkflow,
}: WorkflowDrawerProps) {
  const workflowId = card.workflow.id!;
  const qc = useQueryClient();

  // Expanded post id (accordion). Seeded from initialPostId when opened from the
  // calendar; the call site keys the drawer by initialPostId so a new target remounts.
  const [expandedId, setExpandedId] = useState<number | null>(initialPostId ?? null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const [replyText, setReplyText] = useState<Record<number, string>>({});
  const [sendingReply, setSendingReply] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [pendingEditPost, setPendingEditPost] = useState<WorkflowPost | null>(null);
  const [pendingEditData, setPendingEditData] = useState<{
    json: Record<string, unknown>;
    plain: string;
  } | null>(null);
  const confirmedEditIds = useRef<Set<number>>(new Set());
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    id: number;
    newStatusKey: StatusKey;
  } | null>(null);
  const [pendingRejectSuggestionId, setPendingRejectSuggestionId] = useState<number | null>(null);
  const [editorVersions, setEditorVersions] = useState<Record<number, number>>({});
  const statusRegistry = useStatusRegistry();
  const [drawerView, setDrawerView] = useState<'posts' | 'calendar' | 'grid' | 'history'>('posts');
  const [isFullscreen, setIsFullscreen] = useState(
    () => localStorage.getItem('workflow-drawer-fullscreen') === '1',
  );

  // Desmembrar do fluxo: multi-select + confirm. `detachTarget` holds the ids
  // pending confirmation (set either from the selection bar's bulk action or
  // from a single post's kebab menu) -- the archive checkbox in the confirm
  // dialog only ever shows when that batch covers every post of this workflow.
  const [selectedPostIds, setSelectedPostIds] = useState<Set<number>>(new Set());
  const [detachTarget, setDetachTarget] = useState<number[] | null>(null);
  const [archiveEmptyFlow, setArchiveEmptyFlow] = useState(false);
  const [isDetaching, setIsDetaching] = useState(false);
  // Mover para outro fluxo: same two entry points as detach (selection bar +
  // per-post kebab); the dialog itself carries the destination choice.
  const [moveTarget, setMoveTarget] = useState<number[] | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ── Data queries ──────────────────────────────────────────────────────────

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['workflow-posts-with-props', workflowId],
    queryFn: () => getWorkflowPostsWithProperties(workflowId),
    // Poll while a post in this workflow is mid-publishing so the drawer flips
    // agendado → Publicando… → postado without a manual refresh.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((p) => getPostPublishState(p) === 'publicando') ? 15000 : false,
  });

  // Auto-complete the active client-approval etapa the moment the last post awaiting the
  // client gets approved while this drawer is open. Guarded on the awaiting → approved
  // transition (see shouldAutoCompleteApproval) so it never fires on open for a cycle that
  // was already approved.
  const prevPostsRef = useRef<WorkflowPost[] | null>(null);
  useEffect(() => {
    if (isLoading) return;
    const prev = prevPostsRef.current;
    prevPostsRef.current = posts;
    if (!shouldAutoCompleteApproval(prev, posts)) return;
    const approvalEtapa = card.allEtapas.find(
      (e) => e.tipo === 'aprovacao_cliente' && e.status === 'ativo',
    );
    if (!approvalEtapa) return;
    (async () => {
      try {
        const result = await completeEtapaForAdvance(workflowId, approvalEtapa.id!);
        toast.success('Todos os posts aprovados — etapa concluída!');
        qc.invalidateQueries({ queryKey: ['workflow-events', workflowId] });
        notifyRearmOutcome(result);
        onRefresh();
      } catch {
        /* silent, etapa completion is a bonus */
      }
    })();
    // card.allEtapas / workflowId / onRefresh are stable for an open drawer; re-running this
    // on their identity would risk a duplicate completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, isLoading]);

  // Drops any selected id that no longer belongs to this workflow's post list --
  // e.g. the post was removed (trash icon) or detached from another tab while
  // still checked here. Otherwise the selection bar's count would keep a ghost
  // entry no row exists for.
  useEffect(() => {
    setSelectedPostIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(posts.map((p) => p.id).filter((id): id is number => id != null));
      let changed = false;
      const next = new Set<number>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [posts]);

  // Local ordered list for optimistic DnD reordering
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const orderedPosts = localOrder
    ? (localOrder.map((id) => posts.find((p) => p.id === id)).filter(Boolean) as WorkflowPost[])
    : posts;

  const postIds = posts.map((p) => p.id).filter(Boolean) as number[];
  const { data: approvals = [] } = useQuery({
    queryKey: ['post-approvals', postIds.join(',')],
    queryFn: () => getPostApprovals(postIds),
    enabled: postIds.length > 0,
  });

  const { data: statusEvents = [] } = useQuery({
    queryKey: ['post-status-events', postIds.join(',')],
    queryFn: () => getPostStatusEvents(postIds),
    enabled: postIds.length > 0,
  });

  const { data: editSuggestions = [] } = useQuery({
    queryKey: ['post-edit-suggestions', postIds.join(',')],
    queryFn: () => getPostEditSuggestions(postIds),
    enabled: postIds.length > 0,
  });

  const { user, role } = useAuth();

  const { data: workspaceUsers = [] } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
  });

  const { data: commentThreads = [], refetch: refetchComments } = useQuery({
    queryKey: ['post-comment-threads', postIds.join(',')],
    queryFn: () => getPostCommentThreads(postIds),
    enabled: postIds.length > 0,
  });

  const clienteId = card.workflow.cliente_id;

  // Reuses the same ['clientePosts', clienteId] key as WorkflowCalendarView, so opening the
  // calendar first turns this into a cache hit instead of a new round trip. Feeds the
  // per-row scheduled-day markers in the date pickers below (see SortablePostItem).
  const { data: clientePosts = [] } = useQuery({
    queryKey: ['clientePosts', clienteId],
    queryFn: () => getClientePosts(clienteId),
    enabled: !!clienteId,
  });

  const { hasInstagramAccount, igAccountStatus, hasActiveTikTokAccount, ttAccountStatus } =
    useClienteSocialAccounts(clienteId);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const next = !prev;
      localStorage.setItem('workflow-drawer-fullscreen', next ? '1' : '0');
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    setLocalOrder(null);
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
    qc.invalidateQueries({ queryKey: ['post-approvals'] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
    qc.invalidateQueries({ queryKey: ['post-comment-threads'] });
    qc.invalidateQueries({ queryKey: ['post-edit-suggestions'] });
    qc.invalidateQueries({ queryKey: ['post-status-events'] });
    qc.invalidateQueries({ queryKey: ['workflow-events', workflowId] });
    // Field changes (incl. scheduled_at, tipo) must also refresh the day-dot markers other
    // rows' date pickers derive from this same client-wide query — see the ['clientePosts',
    // clienteId] useQuery above. WorkflowCalendarView's own reschedule path already
    // invalidates this key; this drawer is otherwise the only path that doesn't.
    qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
    // Desmembrar do fluxo changes a post's workflow_id -> NULL, which every
    // Publicações surface reads via ['active-posts'] (useActivePosts) --
    // without this the post keeps showing under its old workflow there until
    // an unrelated refetch happens to fire.
    qc.invalidateQueries({ queryKey: ['active-posts'] });
  }, [qc, workflowId, clienteId]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = orderedPosts.map((p) => p.id!);
      const oldIndex = ids.indexOf(active.id as number);
      const newIndex = ids.indexOf(over.id as number);
      const newIds = arrayMove(ids, oldIndex, newIndex);

      // Optimistic update
      setLocalOrder(newIds);

      try {
        await reorderWorkflowPosts(newIds.map((id, ordem) => ({ id, ordem })));
        qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
      } catch {
        toast.error('Erro ao reordenar posts');
        setLocalOrder(null);
      }
    },
    [orderedPosts, qc, workflowId],
  );

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleAddPost = async () => {
    try {
      const newPost = await addWorkflowPost({
        workflow_id: workflowId,
        titulo: `Post ${posts.length + 1}`,
        conteudo: null,
        conteudo_plain: '',
        tipo: 'feed',
        ordem: posts.length,
        status: 'rascunho',
        responsavel_id: null,
      });
      refresh();
      setExpandedId(newPost.id!);
    } catch {
      toast.error('Erro ao criar post');
    }
  };

  const handleDeletePost = (id: number) => setPendingDeleteId(id);

  const confirmDeletePost = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await removeWorkflowPost(id);
      if (expandedId === id) setExpandedId(null);
      refresh();
    } catch {
      toast.error('Erro ao remover post');
    }
  };

  const handleFieldChange = async (
    id: number,
    field: keyof WorkflowPost | 'status',
    value: unknown,
  ) => {
    if (field === 'status') {
      // The select emits a StatusKey (canonical status or 'custom:<uuid>').
      const key = value as StatusKey;
      const post = posts.find((p) => p.id === id);
      if (statusChangeNeedsConfirm(post, key, statusRegistry)) {
        setPendingStatusChange({ id, newStatusKey: key });
        return;
      }
      try {
        await updateWorkflowPost(id, statusKeyToPatch(key));
        refresh();
      } catch {
        toast.error('Erro ao atualizar post');
      }
      return;
    }
    try {
      await updateWorkflowPost(id, { [field]: value } as Partial<WorkflowPost>);
      refresh();
    } catch {
      toast.error('Erro ao atualizar post');
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!pendingStatusChange) return;
    const { id, newStatusKey } = pendingStatusChange;
    setPendingStatusChange(null);
    try {
      await updateWorkflowPost(id, statusKeyToPatch(newStatusKey));
      refresh();
    } catch {
      toast.error('Erro ao atualizar status');
    }
  };

  const scheduleContentSave = (
    post: WorkflowPost,
    json: Record<string, unknown>,
    plain: string,
  ) => {
    const id = post.id!;
    const isApproved = post.status === 'aprovado_interno' || post.status === 'aprovado_cliente';

    // If post is approved and not yet confirmed in this session, show confirmation dialog
    if (isApproved && !confirmedEditIds.current.has(id)) {
      setPendingEditPost(post);
      setPendingEditData({ json, plain });
      return;
    }

    setSavingIds((prev) => new Set(prev).add(id));
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(async () => {
      try {
        await updateWorkflowPost(id, { conteudo: json, conteudo_plain: plain });
        refresh();
      } catch {
        toast.error('Erro ao salvar conteúdo');
      } finally {
        setSavingIds((prev) => {
          const s = new Set(prev);
          s.delete(id);
          return s;
        });
      }
    }, 1500);
  };

  const handleConfirmEdit = async () => {
    if (!pendingEditPost || !pendingEditData) return;
    const id = pendingEditPost.id!;
    const editData = pendingEditData;
    setPendingEditPost(null);
    setPendingEditData(null);
    // The approval invalidation must land BEFORE the content save is armed:
    // saving new content on a still-approved post would defeat the confirm.
    try {
      await updateWorkflowPost(id, { status: 'revisao_interna' });
      refresh();
    } catch {
      toast.error('Não foi possível invalidar a aprovação. O conteúdo não foi salvo.');
      return;
    }
    confirmedEditIds.current.add(id);
    setSavingIds((prev) => new Set(prev).add(id));
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(async () => {
      try {
        await updateWorkflowPost(id, {
          conteudo: editData.json,
          conteudo_plain: editData.plain,
        });
        refresh();
      } catch {
        toast.error('Erro ao salvar conteúdo');
      } finally {
        setSavingIds((prev) => {
          const s = new Set(prev);
          s.delete(id);
          return s;
        });
      }
    }, 1500);
  };

  const handleCancelEdit = () => {
    setPendingEditPost(null);
    setPendingEditData(null);
    refresh();
  };

  const handleSendToCliente = async () => {
    const readyPosts = posts.filter((p) => p.status === 'aprovado_interno');
    if (readyPosts.length === 0) {
      toast.error('Nenhum post aprovado internamente para enviar.');
      return;
    }

    // Block sending if any ready post has a video without a thumbnail.
    const mediaByPost = await Promise.all(
      readyPosts.map(async (p) => ({ post: p, media: await listPostMedia(p.id!) })),
    );
    const blocked = mediaByPost.filter((m) => hasVideoMissingThumbnail(m.media));
    if (blocked.length > 0) {
      toast.error(
        `Há ${blocked.length} post(s) com vídeos sem thumbnail. Adicione uma thumbnail antes de enviar.`,
      );
      return;
    }

    setIsSending(true);
    try {
      await sendPostsToCliente(workflowId);
      toast.success(
        `${readyPosts.length} post${readyPosts.length > 1 ? 's' : ''} enviado${readyPosts.length > 1 ? 's' : ''} ao cliente!`,
      );
      refresh();
      onRefresh();
    } catch {
      toast.error('Erro ao enviar posts ao cliente');
    } finally {
      setIsSending(false);
    }
  };

  const handleReply = async (postId: number) => {
    const text = (replyText[postId] || '').trim();
    if (!text) return;
    setSendingReply(postId);
    try {
      await replyToPostApproval(postId, workflowId, text);
      setReplyText((prev) => ({ ...prev, [postId]: '' }));
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar resposta');
    } finally {
      setSendingReply(null);
    }
  };

  // ── Selection / desmembrar do fluxo ───────────────────────────────────────

  const toggleSelectPost = useCallback((id: number, checked: boolean) => {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectAllPosts = useCallback(() => {
    setSelectedPostIds(new Set(posts.map((p) => p.id!).filter((id) => id != null)));
  }, [posts]);

  const clearSelection = useCallback(() => setSelectedPostIds(new Set()), []);

  const openDetachConfirm = useCallback((ids: number[]) => {
    setArchiveEmptyFlow(false);
    setDetachTarget(ids);
  }, []);

  const handleConfirmDetach = async () => {
    if (!detachTarget) return;
    const ids = detachTarget;
    // Total selection: every post currently in this workflow is part of this
    // batch -- only then does archiving the now-empty flow make sense, so
    // only then does the confirm dialog even offer the checkbox.
    const isTotalSelection = ids.length === posts.length;
    const archive = isTotalSelection && archiveEmptyFlow;
    setIsDetaching(true);
    try {
      const result = await detachPostsFromWorkflow(ids, archive);
      const n = result.detached;
      toast.success(`${n} post${n === 1 ? '' : 's'} desmembrado${n === 1 ? '' : 's'}`);
      setSelectedPostIds(new Set());
      setDetachTarget(null);
      setArchiveEmptyFlow(false);
      if (archive) {
        // The flow itself got archived along with the last posts leaving it --
        // this drawer no longer has anything left to show, so close it instead
        // of refreshing its own (now pointless) queries.
        onRefresh();
        onClose();
      } else {
        refresh();
        onRefresh();
      }
    } catch (err) {
      toast.error(getDetachErrorToast(err));
    } finally {
      setIsDetaching(false);
    }
  };

  // Posts left for another flow (new or existing): this drawer's list just
  // shrank (or emptied), so refresh the board and land the user where the
  // posts went. Falls back to only closing when the call site can't open
  // another drawer.
  const handleMoved = useCallback(
    (targetWorkflowId: number) => {
      setSelectedPostIds(new Set());
      setMoveTarget(null);
      onRefresh();
      onClose();
      onOpenWorkflow?.(targetWorkflowId);
    },
    [onRefresh, onClose, onOpenWorkflow],
  );

  // ── Edit suggestion handlers ──────────────────────────────────────────────

  const handleAcceptSuggestion = useCallback(
    async (suggestion: PostEditSuggestion) => {
      try {
        await acceptEditSuggestion(suggestion.id);
        // accept_edit_suggestion writes workflow_posts.conteudo server-side,
        // bypassing updateWorkflowPost -- sync mentions here so @-mentions in
        // an accepted client suggestion still land in the mencoes ledger.
        // suggested_conteudo != null is required in addition to the
        // changed_fields check: caption-only Story suggestions (see
        // StoryPostCard) submit suggested_conteudo: null, and
        // upsert_edit_suggestion's IS DISTINCT FROM comparison still puts
        // 'conteudo' in changed_fields for that null-vs-existing-doc diff.
        // accept_edit_suggestion COALESCEs and keeps the stored conteudo
        // unchanged in that case, so syncing from the null doc here would
        // wrongly wipe every mention in the ledger for a post whose content
        // never actually changed.
        if (
          suggestion.changed_fields.includes('conteudo') &&
          suggestion.suggested_conteudo != null
        ) {
          const membroIds = extractMentionsFromDoc(suggestion.suggested_conteudo)
            .filter((ref) => ref.entityType === 'membro')
            .map((ref) => ref.id);
          await syncMentions('workflow_post', suggestion.post_id, membroIds);
        }
        setEditorVersions((prev) => ({
          ...prev,
          [suggestion.post_id]: (prev[suggestion.post_id] ?? 0) + 1,
        }));
        toast.success('Sugestão aceita!');
        refresh();
        onRefresh();
      } catch {
        toast.error('Erro ao aceitar sugestão');
      }
    },
    [refresh, onRefresh],
  );

  const handleRejectSuggestion = useCallback((id: number) => {
    setPendingRejectSuggestionId(id);
  }, []);

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

  // ── Comment thread handlers ───────────────────────────────────────────────

  const handleCreateComment = useCallback(
    async (postId: number, quotedText: string, comment: string) => {
      const thread = await createCommentThread(postId, quotedText, comment);
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

  // ── Stats ─────────────────────────────────────────────────────────────────

  const approvedCount = orderedPosts.filter((p) => p.status === 'aprovado_cliente').length;
  const clientFacingCount = orderedPosts.filter((p) =>
    ['enviado_cliente', 'aprovado_cliente', 'correcao_cliente'].includes(p.status),
  ).length;
  const readyToSend = orderedPosts.filter((p) => p.status === 'aprovado_interno').length;

  // The archive-empty-flow checkbox in the detach confirm dialog only shows when the
  // pending batch covers every post currently in this workflow.
  const isTotalDetachSelection = !!detachTarget && detachTarget.length === posts.length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay */}
      <div className="drawer-overlay" onClick={onClose} />

      {/* Panel */}
      <div className={`drawer-panel${isFullscreen ? ' fullscreen' : ''}`}>
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-header-info">
            <div className="drawer-header-title">{card.workflow.titulo}</div>
            <div className="drawer-header-subtitle">
              {card.cliente?.nome || '—'} &bull; Etapa: {card.etapa.nome}
            </div>
          </div>
          <div className="drawer-header-actions">
            {readyToSend > 0 && (
              <button
                className="drawer-send-btn"
                onClick={handleSendToCliente}
                disabled={isSending}
                title={`Enviar ${readyToSend} post${readyToSend > 1 ? 's' : ''} aprovados ao cliente`}
              >
                <Send className="h-3.5 w-3.5" />
                Enviar ao cliente ({readyToSend})
              </button>
            )}
            <div className="drawer-view-toggle" role="tablist">
              <button
                className={`drawer-calendar-btn${drawerView === 'posts' ? ' active' : ''}`}
                onClick={() => setDrawerView('posts')}
                title="Ver posts"
              >
                Posts
              </button>
              <button
                className={`drawer-calendar-btn${drawerView === 'grid' ? ' active' : ''}`}
                onClick={() => setDrawerView('grid')}
                title="Ver a grade do Instagram do cliente"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Grade
              </button>
              <button
                className={`drawer-calendar-btn${drawerView === 'calendar' ? ' active' : ''}`}
                onClick={() => setDrawerView('calendar')}
                title="Ver calendário do cliente"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                Calendário
              </button>
              <button
                className={`drawer-calendar-btn${drawerView === 'history' ? ' active' : ''}`}
                onClick={() => setDrawerView('history')}
                title="Ver histórico do fluxo"
              >
                <History className="h-3.5 w-3.5" />
                Histórico
              </button>
            </div>
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

        {/* Posts section */}
        <div className={`drawer-body${drawerView === 'calendar' ? ' drawer-body--calendar' : ''}`}>
          {drawerView === 'calendar' ? (
            <WorkflowCalendarView
              clienteId={clienteId}
              clienteNome={card.cliente?.nome || '—'}
              currentWorkflowId={workflowId}
              currentWorkflowTitulo={card.workflow.titulo}
              membros={membros}
              hubUrl={card.hubUrl}
              onOpenPost={(postId) => {
                setDrawerView('posts');
                setExpandedId(postId);
              }}
              onBack={() => setDrawerView('posts')}
            />
          ) : drawerView === 'grid' ? (
            <WorkflowGridView clienteId={clienteId} clienteNome={card.cliente?.nome || '—'} />
          ) : drawerView === 'history' ? (
            <WorkflowHistoryView workflowId={workflowId} />
          ) : (
            <>
              <div className="drawer-section-header">
                <span className="drawer-section-title">
                  Posts
                  {clientFacingCount > 0 && (
                    <span className="drawer-post-count">
                      {approvedCount} de {clientFacingCount} aprovados pelo cliente
                    </span>
                  )}
                </span>
                <button className="drawer-add-post-btn" onClick={handleAddPost}>
                  <Plus className="h-3.5 w-3.5" /> Novo Post
                </button>
              </div>

              {selectedPostIds.size > 0 && (
                <div className="drawer-selection-bar" data-testid="drawer-selection-bar">
                  <span className="drawer-selection-bar-count">
                    {selectedPostIds.size} selecionado{selectedPostIds.size === 1 ? '' : 's'}
                  </span>
                  <span aria-hidden="true">&middot;</span>
                  <button
                    type="button"
                    className="drawer-selection-bar-link"
                    onClick={selectAllPosts}
                  >
                    Selecionar todos
                  </button>
                  <div className="drawer-selection-bar-actions">
                    <button
                      type="button"
                      className="drawer-selection-bar-btn"
                      onClick={() => setMoveTarget(Array.from(selectedPostIds))}
                    >
                      Mover para outro fluxo
                    </button>
                    <button
                      type="button"
                      className="drawer-selection-bar-btn"
                      onClick={() => openDetachConfirm(Array.from(selectedPostIds))}
                    >
                      Desmembrar do fluxo
                    </button>
                    <button
                      type="button"
                      className="drawer-selection-bar-btn drawer-selection-bar-btn--ghost"
                      onClick={clearSelection}
                    >
                      Limpar
                    </button>
                  </div>
                </div>
              )}

              {isLoading ? (
                <div className="drawer-empty">Carregando...</div>
              ) : posts.length === 0 ? (
                <div className="drawer-empty">
                  Nenhum post ainda. Clique em "Novo Post" para começar.
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={orderedPosts.map((p) => p.id!)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="drawer-posts-list">
                      {orderedPosts.map((post) => (
                        <SortablePostItem
                          key={post.id}
                          post={post}
                          hubUrl={card.hubUrl}
                          templateId={card.workflow.template_id}
                          workflowId={workflowId}
                          clienteId={clienteId}
                          clientePosts={clientePosts}
                          isExpanded={expandedId === post.id}
                          isSaving={savingIds.has(post.id!)}
                          approvals={approvals.filter((a) => a.post_id === post.id)}
                          statusEvents={statusEvents.filter((e) => e.post_id === post.id)}
                          editSuggestion={
                            editSuggestions.find((s) => s.post_id === post.id) ?? null
                          }
                          membros={membros}
                          replyText={replyText[post.id!] || ''}
                          sendingReply={sendingReply === post.id}
                          commentThreads={commentThreads.filter((t) => t.post_id === post.id)}
                          currentUserId={user?.id}
                          currentUserRole={role}
                          workspaceUsers={workspaceUsers}
                          hasMedia={(post as any).has_media ?? false}
                          hasInstagramAccount={hasInstagramAccount}
                          igAccountStatus={igAccountStatus}
                          hasActiveTikTokAccount={hasActiveTikTokAccount}
                          ttAccountStatus={ttAccountStatus}
                          isSelected={selectedPostIds.has(post.id!)}
                          onSelectChange={(checked) => toggleSelectPost(post.id!, checked)}
                          onDetachRequest={() => openDetachConfirm([post.id!])}
                          onMoveRequest={() => setMoveTarget([post.id!])}
                          onToggle={() => setExpandedId(expandedId === post.id ? null : post.id!)}
                          onDelete={() => handleDeletePost(post.id!)}
                          onFieldChange={(field, value) =>
                            handleFieldChange(post.id!, field, value)
                          }
                          onContentUpdate={(json, plain) => scheduleContentSave(post, json, plain)}
                          onReplyChange={(text) =>
                            setReplyText((prev) => ({ ...prev, [post.id!]: text }))
                          }
                          onReplySend={() => handleReply(post.id!)}
                          onRefresh={refresh}
                          onCreateComment={handleCreateComment}
                          onReplyToComment={handleReplyToComment}
                          onResolveThread={handleResolveThread}
                          onReopenThread={handleReopenThread}
                          onEditComment={handleEditComment}
                          onDeleteComment={handleDeleteComment}
                          editorVersion={editorVersions[post.id!] ?? 0}
                          onAcceptSuggestion={handleAcceptSuggestion}
                          onRejectSuggestion={handleRejectSuggestion}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </>
          )}
        </div>
      </div>

      <AlertDialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover post?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O post e seu conteúdo serão excluídos
              permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDeleteId(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeletePost}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation dialog for editing approved posts */}
      <AlertDialog
        open={!!pendingEditPost}
        onOpenChange={(open) => {
          if (!open) handleCancelEdit();
        }}
      >
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

      {/* Confirmation dialog for changing status of approved posts */}
      <AlertDialog
        open={!!pendingStatusChange}
        onOpenChange={(open) => {
          if (!open) setPendingStatusChange(null);
        }}
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
        onOpenChange={(open) => {
          if (!open) setPendingRejectSuggestionId(null);
        }}
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

      {/* Confirmation dialog for desmembrar do fluxo (single post or bulk selection) */}
      <AlertDialog
        open={!!detachTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDetachTarget(null);
            setArchiveEmptyFlow(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desmembrar do fluxo?</AlertDialogTitle>
            <AlertDialogDescription>
              Os posts selecionados viram publicações avulsas de {card.cliente?.nome || '—'}. Eles
              continuam no quadro de Publicações e no portal do cliente, mas saem deste fluxo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isTotalDetachSelection && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="detach-archive-empty-flow"
                checked={archiveEmptyFlow}
                onCheckedChange={(checked) => setArchiveEmptyFlow(checked === true)}
                aria-label="Arquivar o fluxo depois de desmembrar"
              />
              <Label htmlFor="detach-archive-empty-flow">
                Arquivar o fluxo depois de desmembrar
              </Label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDetachTarget(null);
                setArchiveEmptyFlow(false);
              }}
              disabled={isDetaching}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDetach} disabled={isDetaching}>
              {isDetaching ? 'Desmembrando...' : 'Desmembrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MovePostsToFluxoDialog
        open={!!moveTarget}
        onClose={() => setMoveTarget(null)}
        postIds={moveTarget ?? []}
        sourceWorkflow={card.workflow}
        sourceEtapas={card.allEtapas}
        isTotalSelection={(moveTarget?.length ?? 0) === posts.length}
        onMoved={handleMoved}
      />
    </>
  );
}

// ── Sortable post row ─────────────────────────────────────────────────────────

interface SortablePostItemProps {
  post: WorkflowPost & { property_values?: PostPropertyValue[] };
  hubUrl?: string;
  templateId: number | null | undefined;
  workflowId: number;
  clienteId: number;
  clientePosts: ClientePost[];
  isExpanded: boolean;
  isSaving: boolean;
  approvals: PostApproval[];
  statusEvents: PostStatusEvent[];
  editSuggestion: PostEditSuggestion | null;
  membros: Membro[];
  replyText: string;
  sendingReply: boolean;
  commentThreads: CommentThreadWithComments[];
  currentUserId?: string;
  currentUserRole: 'owner' | 'admin' | 'agent';
  workspaceUsers: { id: string; nome: string; avatar_url: string }[];
  hasMedia: boolean;
  hasInstagramAccount: boolean;
  igAccountStatus: { revoked: boolean; expired: boolean; canPublish: boolean } | null;
  hasActiveTikTokAccount: boolean;
  ttAccountStatus: { revoked: boolean; expired: boolean } | null;
  isSelected: boolean;
  onSelectChange: (checked: boolean) => void;
  onDetachRequest: () => void;
  onMoveRequest: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onFieldChange: (field: keyof WorkflowPost, value: unknown) => void;
  onContentUpdate: (json: Record<string, unknown>, plain: string) => void;
  onReplyChange: (text: string) => void;
  onReplySend: () => void;
  onRefresh: () => void;
  onCreateComment: (postId: number, quotedText: string, comment: string) => Promise<number>;
  onReplyToComment: (threadId: number, content: string) => Promise<void>;
  onResolveThread: (threadId: number) => Promise<void>;
  onReopenThread: (threadId: number) => Promise<void>;
  onEditComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number, threadId: number) => Promise<void>;
  editorVersion: number;
  onAcceptSuggestion: (suggestion: PostEditSuggestion) => void;
  onRejectSuggestion: (id: number) => void;
}

function SortablePostItem({
  post,
  hubUrl,
  templateId,
  workflowId,
  clienteId,
  clientePosts,
  isExpanded,
  isSaving,
  approvals,
  statusEvents,
  editSuggestion,
  membros,
  replyText,
  sendingReply,
  commentThreads,
  currentUserId,
  currentUserRole,
  workspaceUsers,
  hasMedia,
  hasInstagramAccount,
  igAccountStatus,
  hasActiveTikTokAccount,
  ttAccountStatus,
  isSelected,
  onSelectChange,
  onDetachRequest,
  onMoveRequest,
  onToggle,
  onDelete,
  onFieldChange,
  onContentUpdate,
  onReplyChange,
  onReplySend,
  onRefresh,
  onCreateComment,
  onReplyToComment,
  onResolveThread,
  onReopenThread,
  onEditComment,
  onDeleteComment,
  editorVersion,
  onAcceptSuggestion,
  onRejectSuggestion,
}: SortablePostItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: post.id!,
  });

  const statusRegistry = useStatusRegistry();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isExternallyVisible = isVisibleToClient(post.status);

  // Publish date shown in the collapsed row: once a post is actually live the real
  // published_at wins, otherwise fall back to the scheduled "Data de postagem".
  const publishIso = post.published_at || post.scheduled_at || null;
  const isPublished = post.published_at != null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`drawer-post-item${isExpanded ? ' expanded' : ''}`}
    >
      {/* Accordion trigger */}
      <div className="drawer-post-trigger" onClick={onToggle}>
        <div className="drawer-post-trigger-left">
          <Checkbox
            className="drawer-post-select-checkbox"
            checked={isSelected}
            onCheckedChange={(checked) => onSelectChange(checked === true)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Selecionar ${post.titulo || 'post sem título'}`}
          />
          <span
            className="drawer-drag-handle"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </span>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 drawer-post-chevron" />
          ) : (
            <ChevronRight className="h-4 w-4 drawer-post-chevron" />
          )}
          <span className="post-tipo-badge">{TIPO_LABELS[post.tipo]}</span>
          <span
            className={`drawer-post-visibility${isExternallyVisible ? ' is-visible' : ''}`}
            title={
              isExternallyVisible ? VISIBILITY_BADGE_LABEL.visible : VISIBILITY_BADGE_LABEL.internal
            }
            aria-label={
              isExternallyVisible ? VISIBILITY_BADGE_LABEL.visible : VISIBILITY_BADGE_LABEL.internal
            }
          >
            {isExternallyVisible ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="drawer-post-titulo">{post.titulo || 'Post sem título'}</span>
          {hasMedia && (
            <span className="drawer-post-media-badge" title="Mídia anexada">
              <ImageIcon className="h-3.5 w-3.5" />
            </span>
          )}
          {editSuggestion && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800">
              Sugestão pendente
            </span>
          )}
          {commentThreads.length > 0 && (
            <span
              className="drawer-post-comment-badge"
              title={`${commentThreads.length} comentário${commentThreads.length > 1 ? 's' : ''}`}
            >
              <MessageSquare className="h-3 w-3" />
              {commentThreads.length}
            </span>
          )}
        </div>
        <div className="drawer-post-trigger-right" onClick={(e) => e.stopPropagation()}>
          {isSaving && <span className="drawer-saving-indicator">Salvando…</span>}
          <PostTimelinePopover post={post} events={statusEvents} approvals={approvals} />
          {publishIso ? (
            <span
              className="drawer-post-date"
              title={`${isPublished ? 'Publicado em' : 'Agendado para'} ${formatPostDateFull(publishIso)}`}
            >
              {formatPostDate(publishIso)}
            </span>
          ) : (
            <span className="drawer-post-date drawer-post-date--empty">A definir</span>
          )}
          <PostStatusChip post={post} registry={statusRegistry} />
          <CopyPostLinkButton hubUrl={hubUrl} postId={post.id!} />
          <button className="drawer-delete-btn" onClick={onDelete} title="Remover post">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="drawer-kebab-btn" title="Mais ações">
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onMoveRequest}>Mover para outro fluxo</DropdownMenuItem>
              <DropdownMenuItem onClick={onDetachRequest}>Desmembrar do fluxo</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Accordion content */}
      <PostEditorBody
        post={post}
        templateId={templateId}
        workflowId={workflowId}
        clienteId={clienteId}
        clientePosts={clientePosts}
        isExpanded={isExpanded}
        approvals={approvals}
        editSuggestion={editSuggestion}
        membros={membros}
        replyText={replyText}
        sendingReply={sendingReply}
        commentThreads={commentThreads}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        workspaceUsers={workspaceUsers}
        hasInstagramAccount={hasInstagramAccount}
        igAccountStatus={igAccountStatus}
        hasActiveTikTokAccount={hasActiveTikTokAccount}
        ttAccountStatus={ttAccountStatus}
        onFieldChange={onFieldChange}
        onContentUpdate={onContentUpdate}
        onReplyChange={onReplyChange}
        onReplySend={onReplySend}
        onRefresh={onRefresh}
        onCreateComment={onCreateComment}
        onReplyToComment={onReplyToComment}
        onResolveThread={onResolveThread}
        onReopenThread={onReopenThread}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        editorVersion={editorVersion}
        onAcceptSuggestion={onAcceptSuggestion}
        onRejectSuggestion={onRejectSuggestion}
      />
    </div>
  );
}
