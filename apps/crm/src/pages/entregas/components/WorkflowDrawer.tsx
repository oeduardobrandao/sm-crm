import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Plus, Trash2, Send, ChevronDown, ChevronRight, MessageSquare, GripVertical } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getWorkflowPostsWithProperties,
  addWorkflowPost, updateWorkflowPost, removeWorkflowPost,
  reorderWorkflowPosts, sendPostsToCliente, getPostApprovals, replyToPostApproval,
  completeEtapa,
  getPostCommentThreads, createCommentThread, addPostComment, updatePostComment,
  deletePostComment, resolveCommentThread, reopenCommentThread, deleteCommentThread,
  type WorkflowPost, type PostApproval, type Membro, type PostPropertyValue,
  type CommentThreadWithComments,
} from '../../../store';
import type { BoardCard } from '../hooks/useEntregasData';
import { PostEditor } from './PostEditor';
import { PropertyPanel } from './PropertyPanel';
import PostCommentSummary from './PostCommentSummary';
import { useAuth } from '@/context/AuthContext';
import { PostMediaGallery, hasVideoMissingThumbnail } from './PostMediaGallery';
import { listPostMedia } from '../../../services/postMedia';

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<WorkflowPost['tipo'], string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};

const STATUS_LABELS: Record<WorkflowPost['status'], string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Em revisão',
  aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente',
  aprovado_cliente: 'Aprovado pelo cliente',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  postado: 'Postado',
  falha_publicacao: 'Falha na publicação',
};

const STATUS_CLASS: Record<WorkflowPost['status'], string> = {
  rascunho: 'post-status--rascunho',
  revisao_interna: 'post-status--revisao',
  aprovado_interno: 'post-status--aprovado-interno',
  enviado_cliente: 'post-status--enviado',
  aprovado_cliente: 'post-status--aprovado-cliente',
  correcao_cliente: 'post-status--correcao',
  agendado: 'post-status--agendado',
  postado: 'post-status--postado',
  falha_publicacao: 'status-danger',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface WorkflowDrawerProps {
  card: BoardCard;
  membros: Membro[];
  onClose: () => void;
  onRefresh: () => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function WorkflowDrawer({ card, membros, onClose, onRefresh }: WorkflowDrawerProps) {
  const workflowId = card.workflow.id!;
  const qc = useQueryClient();

  // Expanded post id (accordion)
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const [replyText, setReplyText] = useState<Record<number, string>>({});
  const [sendingReply, setSendingReply] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [pendingEditPost, setPendingEditPost] = useState<WorkflowPost | null>(null);
  const [pendingEditData, setPendingEditData] = useState<{ json: Record<string, unknown>; plain: string } | null>(null);
  const confirmedEditIds = useRef<Set<number>>(new Set());
  const [pendingStatusChange, setPendingStatusChange] = useState<{ id: number; newStatus: string } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ── Data queries ──────────────────────────────────────────────────────────

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['workflow-posts-with-props', workflowId],
    queryFn: () => getWorkflowPostsWithProperties(workflowId),
  });

  // Local ordered list for optimistic DnD reordering
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const orderedPosts = localOrder
    ? localOrder.map(id => posts.find(p => p.id === id)).filter(Boolean) as WorkflowPost[]
    : posts;

  const postIds = posts.map(p => p.id).filter(Boolean) as number[];
  const { data: approvals = [] } = useQuery({
    queryKey: ['post-approvals', postIds.join(',')],
    queryFn: () => getPostApprovals(postIds),
    enabled: postIds.length > 0,
  });

  const { user, role } = useAuth();

  const { data: commentThreads = [], refetch: refetchComments } = useQuery({
    queryKey: ['post-comment-threads', postIds.join(',')],
    queryFn: () => getPostCommentThreads(postIds),
    enabled: postIds.length > 0,
  });

  const refresh = useCallback(() => {
    setLocalOrder(null);
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
    qc.invalidateQueries({ queryKey: ['post-approvals'] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
    qc.invalidateQueries({ queryKey: ['post-comment-threads'] });
  }, [qc, workflowId]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = orderedPosts.map(p => p.id!);
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
  }, [orderedPosts, qc, workflowId]);

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
    } catch { toast.error('Erro ao criar post'); }
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
    } catch { toast.error('Erro ao remover post'); }
  };

  const handleFieldChange = async (id: number, field: keyof WorkflowPost, value: unknown) => {
    if (field === 'status') {
      const post = posts.find(p => p.id === id);
      const isApproved = post?.status === 'aprovado_interno' || post?.status === 'aprovado_cliente';
      if (isApproved) {
        setPendingStatusChange({ id, newStatus: value as string });
        return;
      }
    }
    try {
      await updateWorkflowPost(id, { [field]: value } as Partial<WorkflowPost>);
      refresh();
    } catch { toast.error('Erro ao atualizar post'); }
  };

  const handleConfirmStatusChange = async () => {
    if (!pendingStatusChange) return;
    const { id, newStatus } = pendingStatusChange;
    setPendingStatusChange(null);
    try {
      await updateWorkflowPost(id, { status: newStatus as WorkflowPost['status'] });
      refresh();
    } catch { toast.error('Erro ao atualizar status'); }
  };

  const scheduleContentSave = (
    post: WorkflowPost,
    json: Record<string, unknown>,
    plain: string
  ) => {
    const id = post.id!;
    const isApproved = post.status === 'aprovado_interno' || post.status === 'aprovado_cliente';

    // If post is approved and not yet confirmed in this session, show confirmation dialog
    if (isApproved && !confirmedEditIds.current.has(id)) {
      setPendingEditPost(post);
      setPendingEditData({ json, plain });
      return;
    }

    setSavingIds(prev => new Set(prev).add(id));
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(async () => {
      try {
        await updateWorkflowPost(id, { conteudo: json, conteudo_plain: plain });
        refresh();
      } catch { toast.error('Erro ao salvar conteúdo'); }
      finally {
        setSavingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      }
    }, 1500);
  };

  const handleConfirmEdit = () => {
    if (!pendingEditPost || !pendingEditData) return;
    const id = pendingEditPost.id!;
    confirmedEditIds.current.add(id);
    updateWorkflowPost(id, { status: 'revisao_interna' }).then(() => refresh());
    setSavingIds(prev => new Set(prev).add(id));
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(async () => {
      try {
        await updateWorkflowPost(id, { conteudo: pendingEditData.json, conteudo_plain: pendingEditData.plain });
        refresh();
      } catch { toast.error('Erro ao salvar conteúdo'); }
      finally {
        setSavingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      }
    }, 1500);
    setPendingEditPost(null);
    setPendingEditData(null);
  };

  const handleCancelEdit = () => {
    setPendingEditPost(null);
    setPendingEditData(null);
    refresh();
  };

  const handleSendToCliente = async () => {
    const readyPosts = posts.filter(p => p.status === 'aprovado_interno');
    if (readyPosts.length === 0) {
      toast.error('Nenhum post aprovado internamente para enviar.');
      return;
    }

    // Block sending if any ready post has a video without a thumbnail.
    const mediaByPost = await Promise.all(
      readyPosts.map(async (p) => ({ post: p, media: await listPostMedia(p.id!) }))
    );
    const blocked = mediaByPost.filter((m) => hasVideoMissingThumbnail(m.media));
    if (blocked.length > 0) {
      toast.error(`Há ${blocked.length} post(s) com vídeos sem thumbnail. Adicione uma thumbnail antes de enviar.`);
      return;
    }

    setIsSending(true);
    try {
      await sendPostsToCliente(workflowId);
      toast.success(`${readyPosts.length} post${readyPosts.length > 1 ? 's' : ''} enviado${readyPosts.length > 1 ? 's' : ''} ao cliente!`);
      refresh();
      onRefresh();
    } catch { toast.error('Erro ao enviar posts ao cliente'); }
    finally { setIsSending(false); }
  };

  const checkAutoComplete = async (freshPosts: WorkflowPost[]) => {
    const sent = freshPosts.filter(p =>
      p.status === 'enviado_cliente' || p.status === 'correcao_cliente'
    );
    if (sent.length === 0) return;
    const allApproved = sent.every(p => p.status === 'aprovado_cliente');
    if (!allApproved) return;

    const approvalEtapa = card.allEtapas.find(
      e => e.tipo === 'aprovacao_cliente' && e.status === 'ativo'
    );
    if (!approvalEtapa) return;

    try {
      await completeEtapa(workflowId, approvalEtapa.id!);
      toast.success('Todos os posts aprovados — etapa concluída!');
      onRefresh();
    } catch { /* silent, etapa completion is a bonus */ }
  };

  const handleReply = async (postId: number) => {
    const text = (replyText[postId] || '').trim();
    if (!text) return;
    setSendingReply(postId);
    try {
      await replyToPostApproval(postId, workflowId, text);
      setReplyText(prev => ({ ...prev, [postId]: '' }));
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar resposta');
    } finally {
      setSendingReply(null);
    }
  };

  // ── Comment thread handlers ───────────────────────────────────────────────

  const handleCreateComment = useCallback(async (postId: number, quotedText: string, comment: string) => {
    const thread = await createCommentThread(postId, quotedText, comment);
    await refetchComments();
    return thread.id;
  }, [refetchComments]);

  const handleReplyToComment = useCallback(async (threadId: number, content: string) => {
    await addPostComment(threadId, content);
    await refetchComments();
  }, [refetchComments]);

  const handleResolveThread = useCallback(async (threadId: number) => {
    await resolveCommentThread(threadId);
    await refetchComments();
  }, [refetchComments]);

  const handleReopenThread = useCallback(async (threadId: number) => {
    await reopenCommentThread(threadId);
    await refetchComments();
  }, [refetchComments]);

  const handleEditComment = useCallback(async (commentId: number, content: string) => {
    await updatePostComment(commentId, content);
    await refetchComments();
  }, [refetchComments]);

  const handleDeleteComment = useCallback(async (commentId: number, threadId: number) => {
    const thread = commentThreads.find(t => t.id === threadId);
    if (thread && thread.post_comments.length <= 1) {
      await deleteCommentThread(threadId);
    } else {
      await deletePostComment(commentId);
    }
    await refetchComments();
  }, [refetchComments, commentThreads]);

  // ── Stats ─────────────────────────────────────────────────────────────────

  const approvedCount = orderedPosts.filter(p => p.status === 'aprovado_cliente').length;
  const readyToSend = orderedPosts.filter(p => p.status === 'aprovado_interno').length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay */}
      <div className="drawer-overlay" onClick={onClose} />

      {/* Panel */}
      <div className="drawer-panel">
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
            <button className="drawer-close-btn" onClick={onClose} title="Fechar">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Posts section */}
        <div className="drawer-body">
          <div className="drawer-section-header">
            <span className="drawer-section-title">
              Posts
              {posts.length > 0 && (
                <span className="drawer-post-count">
                  {approvedCount}/{posts.length} aprovados
                </span>
              )}
            </span>
            <button className="drawer-add-post-btn" onClick={handleAddPost}>
              <Plus className="h-3.5 w-3.5" /> Novo Post
            </button>
          </div>

          {isLoading ? (
            <div className="drawer-empty">Carregando...</div>
          ) : posts.length === 0 ? (
            <div className="drawer-empty">
              Nenhum post ainda. Clique em "Novo Post" para começar.
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedPosts.map(p => p.id!)} strategy={verticalListSortingStrategy}>
                <div className="drawer-posts-list">
                  {orderedPosts.map(post => (
                    <SortablePostItem
                      key={post.id}
                      post={post}
                      templateId={card.workflow.template_id}
                      workflowId={workflowId}
                      isExpanded={expandedId === post.id}
                      isSaving={savingIds.has(post.id!)}
                      approvals={approvals.filter(a => a.post_id === post.id)}
                      membros={membros}
                      replyText={replyText[post.id!] || ''}
                      sendingReply={sendingReply === post.id}
                      commentThreads={commentThreads.filter(t => t.post_id === post.id)}
                      currentUserId={user?.id}
                      currentUserRole={role}
                      onToggle={() => setExpandedId(expandedId === post.id ? null : post.id!)}
                      onDelete={() => handleDeletePost(post.id!)}
                      onFieldChange={(field, value) => handleFieldChange(post.id!, field, value)}
                      onContentUpdate={(json, plain) => scheduleContentSave(post, json, plain)}
                      onReplyChange={text => setReplyText(prev => ({ ...prev, [post.id!]: text }))}
                      onReplySend={() => handleReply(post.id!)}
                      onCreateComment={handleCreateComment}
                      onReplyToComment={handleReplyToComment}
                      onResolveThread={handleResolveThread}
                      onReopenThread={handleReopenThread}
                      onEditComment={handleEditComment}
                      onDeleteComment={handleDeleteComment}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={open => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover post?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O post e seu conteúdo serão excluídos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDeleteId(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeletePost}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation dialog for editing approved posts */}
      <AlertDialog open={!!pendingEditPost} onOpenChange={open => { if (!open) handleCancelEdit(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post aprovado</AlertDialogTitle>
            <AlertDialogDescription>
              Este post foi aprovado. Editá-lo vai invalidar a aprovação e resetar o status para "Em revisão". Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelEdit}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmEdit}>Confirmar edição</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation dialog for changing status of approved posts */}
      <AlertDialog open={!!pendingStatusChange} onOpenChange={open => { if (!open) setPendingStatusChange(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post aprovado</AlertDialogTitle>
            <AlertDialogDescription>
              Este post foi aprovado. Alterar o status vai invalidar a aprovação. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingStatusChange(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmStatusChange}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Sortable post row ─────────────────────────────────────────────────────────

interface SortablePostItemProps {
  post: WorkflowPost & { property_values?: PostPropertyValue[] };
  templateId: number | null | undefined;
  workflowId: number;
  isExpanded: boolean;
  isSaving: boolean;
  approvals: PostApproval[];
  membros: Membro[];
  replyText: string;
  sendingReply: boolean;
  commentThreads: CommentThreadWithComments[];
  currentUserId?: string;
  currentUserRole: 'owner' | 'admin' | 'agent';
  onToggle: () => void;
  onDelete: () => void;
  onFieldChange: (field: keyof WorkflowPost, value: unknown) => void;
  onContentUpdate: (json: Record<string, unknown>, plain: string) => void;
  onReplyChange: (text: string) => void;
  onReplySend: () => void;
  onCreateComment: (postId: number, quotedText: string, comment: string) => Promise<number>;
  onReplyToComment: (threadId: number, content: string) => Promise<void>;
  onResolveThread: (threadId: number) => Promise<void>;
  onReopenThread: (threadId: number) => Promise<void>;
  onEditComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number, threadId: number) => Promise<void>;
}

function SortablePostItem({
  post, templateId, workflowId, isExpanded, isSaving, approvals, membros,
  replyText, sendingReply,
  commentThreads, currentUserId, currentUserRole,
  onToggle, onDelete, onFieldChange, onContentUpdate, onReplyChange, onReplySend,
  onCreateComment, onReplyToComment, onResolveThread, onReopenThread, onEditComment, onDeleteComment,
}: SortablePostItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: post.id! });

  // Local state for title to avoid input lag / letter-replacement from the
  // round-trip through updateWorkflowPost + refresh on every keystroke.
  const [tituloLocal, setTituloLocal] = useState(post.titulo ?? '');
  const tituloDirty = useRef(false);
  // Hold the latest onFieldChange in a ref so the debounce effect below does
  // not re-run (and reset its timer) every time the parent re-renders with a
  // fresh inline callback — which would otherwise drop the save if the parent
  // re-renders within 400 ms of the last keystroke.
  const onFieldChangeRef = useRef(onFieldChange);
  useEffect(() => { onFieldChangeRef.current = onFieldChange; }, [onFieldChange]);
  useEffect(() => {
    if (!tituloDirty.current) setTituloLocal(post.titulo ?? '');
  }, [post.titulo]);
  useEffect(() => {
    if (!tituloDirty.current) return;
    const t = setTimeout(() => {
      onFieldChangeRef.current('titulo', tituloLocal);
      tituloDirty.current = false;
    }, 400);
    return () => clearTimeout(t);
  }, [tituloLocal]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isReadonly = post.status === 'enviado_cliente' || post.status === 'aprovado_cliente';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`drawer-post-item${isExpanded ? ' expanded' : ''}`}
    >
      {/* Accordion trigger */}
      <div className="drawer-post-trigger" onClick={onToggle}>
        <div className="drawer-post-trigger-left">
          <span
            className="drawer-drag-handle"
            {...attributes}
            {...listeners}
            onClick={e => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </span>
          {isExpanded
            ? <ChevronDown className="h-4 w-4 drawer-post-chevron" />
            : <ChevronRight className="h-4 w-4 drawer-post-chevron" />
          }
          <span className="post-tipo-badge">{TIPO_LABELS[post.tipo]}</span>
          <span className="drawer-post-titulo">{post.titulo || 'Post sem título'}</span>
        </div>
        <div className="drawer-post-trigger-right" onClick={e => e.stopPropagation()}>
          {isSaving && <span className="drawer-saving-indicator">Salvando…</span>}
          <span className={`post-status-chip ${STATUS_CLASS[post.status]}`}>
            {STATUS_LABELS[post.status]}
          </span>
          <button className="drawer-delete-btn" onClick={onDelete} title="Remover post">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Accordion content */}
      {isExpanded && (
        <div className="drawer-post-content">
          <div className="drawer-post-meta-row">
            <div className="drawer-post-field">
              <label>Título</label>
              <input
                className="drawer-input"
                value={tituloLocal}
                onChange={e => { tituloDirty.current = true; setTituloLocal(e.target.value); }}
                onBlur={() => { if (tituloDirty.current) { onFieldChange('titulo', tituloLocal); tituloDirty.current = false; } }}
                placeholder="Título do post"
              />
            </div>
            <div className="drawer-post-field">
              <label>Tipo</label>
              <select
                className="drawer-select"
                value={post.tipo}
                onChange={e => onFieldChange('tipo', e.target.value)}
              >
                {(['feed', 'reels', 'stories', 'carrossel'] as const).map(t => (
                  <option key={t} value={t}>{TIPO_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="drawer-post-field">
              <label>Status</label>
              <select
                className="drawer-select"
                value={post.status}
                onChange={e => onFieldChange('status', e.target.value)}
              >
                {(Object.keys(STATUS_LABELS) as WorkflowPost['status'][]).map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            {membros.length > 0 && (
              <div className="drawer-post-field">
                <label>Responsável</label>
                <select
                  className="drawer-select"
                  value={post.responsavel_id ?? ''}
                  onChange={e => onFieldChange('responsavel_id', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Sem responsável</option>
                  {membros.map(m => (
                    <option key={m.id} value={m.id}>{m.nome}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="drawer-post-field">
              <label>Data de postagem</label>
              <input
                className="drawer-input"
                type="date"
                value={post.scheduled_at ? post.scheduled_at.slice(0, 10) : ''}
                onChange={e => onFieldChange('scheduled_at', e.target.value || null)}
              />
            </div>
          </div>

          {isReadonly && (
            <div className="drawer-readonly-notice">
              Este post foi enviado ao cliente e não pode ser editado.
              Altere o status para editar novamente.
            </div>
          )}
          {/* Custom properties — shown when template has properties defined */}
          {templateId != null && templateId !== 0 && (
            <PropertyPanel
              templateId={templateId}
              postId={post.id!}
              workflowId={workflowId}
              propertyValues={post.property_values ?? []}
              membros={membros}
            />
          )}

          <PostMediaGallery postId={post.id!} disabled={isReadonly} />

          <PostEditor
            key={post.id}
            initialContent={post.conteudo}
            disabled={isReadonly}
            onUpdate={onContentUpdate}
            threads={commentThreads}
            membros={membros}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            onCreateComment={(qt, c) => onCreateComment(post.id!, qt, c)}
            onReplyToComment={onReplyToComment}
            onResolveThread={onResolveThread}
            onReopenThread={onReopenThread}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
          />

          <PostCommentSummary
            threads={commentThreads}
            membros={membros}
            onThreadClick={() => {}}
          />

          {approvals.length > 0 && (
            <div className="drawer-approval-thread">
              <div className="drawer-thread-label">
                <MessageSquare className="h-3.5 w-3.5" /> Comentários
              </div>
              {approvals.map(a => (
                <PostApprovalBubble key={a.id} approval={a} />
              ))}
            </div>
          )}

          <div className="drawer-reply-row">
            <input
              className="drawer-input"
              placeholder="Responder ao cliente…"
              value={replyText}
              onChange={e => onReplyChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onReplySend(); }
              }}
            />
            <button
              className="drawer-reply-btn"
              disabled={sendingReply || !replyText.trim()}
              onClick={onReplySend}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-component ────────────────────────────────────────────────────────────

function PostApprovalBubble({ approval }: { approval: PostApproval }) {
  const isTeam = approval.is_workspace_user;
  const actionLabel = isTeam
    ? 'Equipe'
    : approval.action === 'correcao'
    ? 'Correção solicitada'
    : approval.action === 'aprovado'
    ? 'Aprovado'
    : 'Cliente';

  return (
    <div className={`approval-bubble${isTeam ? ' approval-bubble--team' : ' approval-bubble--client'}`}>
      <div className="approval-bubble-meta">
        <span className="approval-bubble-author">{actionLabel}</span>
        <span className="approval-bubble-date">
          {new Date(approval.created_at).toLocaleDateString('pt-BR', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
        </span>
      </div>
      {approval.comentario && (
        <p className="approval-bubble-text">{approval.comentario}</p>
      )}
    </div>
  );
}
