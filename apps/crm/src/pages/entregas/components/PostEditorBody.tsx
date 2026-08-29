import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquare, Send } from 'lucide-react';
import {
  type WorkflowPost,
  type PostApproval,
  type Membro,
  type PostPropertyValue,
  type CommentThreadWithComments,
  type PostEditSuggestion,
  type ClientePost,
} from '../../../store';
import { PostEditor } from './PostEditor';
import { PropertyPanel } from './PropertyPanel';
import PostCommentSummary from './PostCommentSummary';
import { PostMediaGallery } from './PostMediaGallery';
import {
  uploadInlineImage,
  extractR2Keys,
  injectSignedUrls,
  resolveInlineImageUrls,
} from '@/services/inlineImage';
import { listPostMedia } from '../../../services/postMedia';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { InstagramCaptionField } from './InstagramCaptionField';
import { PlatformSelector } from './PlatformSelector';
import { TikTokSettingsPanel } from './TikTokSettingsPanel';
import { ScheduleButton } from './ScheduleButton';
import { PostAutomationSection } from './PostAutomationSection';
import { PublishErrorBlock } from './PublishErrorBlock';
import { shouldShowPublishErrorBlock } from './publishErrorBlockVisibility';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { DiffView } from './DiffView';
import { ReadOnlyTipTap } from './ReadOnlyTipTap';
import { computeWordDiff } from '@/utils/textDiff';
import { computeTipTapDiff } from '@/utils/tiptapDiff';
import {
  TIPO_LABELS,
  getStatusAutomationHint,
  isVisibleToClient,
  buildTipoDayMarkers,
  TIPO_LEGEND,
  VISIBILITY_OPTION_SUFFIX,
} from '../postLabels';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { groupOptionsByOwner } from '../statusRegistry';

// ── Props ─────────────────────────────────────────────────────────────────────
//
// PostEditorBody renders the expanded content of a single post row: the meta
// fields (título/tipo/plataforma/status/responsável/data), custom properties,
// media gallery, the TipTap editor (or the pending edit-suggestion diff),
// caption, TikTok settings, the schedule action, automations, and the
// comment/approval threads. It owns every piece of state that belongs to
// *this post's editor* -- debounced título, resolved inline-image content,
// TikTok completeness flags -- so a later standalone drawer (posts without a
// workflow) can mount this component directly, wiring the callbacks to its
// own mutations instead of a WorkflowDrawer.
//
// `workflowId` is only forwarded to PropertyPanel (custom properties are
// scoped to a workflow's template today); a caller without a real workflow
// would need to resolve what PropertyPanel expects for that case separately --
// this component makes no assumption about it beyond passing the id through.
//
// Everything NOT about editing a single post -- drag-and-drop, the accordion
// trigger row (badges, status chip, timeline popover, delete), and any
// drawer-wide state (the post list itself, its query invalidation, confirm
// dialogs) -- stays with the caller and reaches this component only through
// props/callbacks.
//
// `isExpanded` gates the media-preflight query and the render (this component
// still mounts for every post row, matching SortablePostItem's own lifecycle,
// so per-post local state -- e.g. an in-flight debounced título save --
// survives a collapse/expand cycle exactly as it did before this component
// existed).
export interface PostEditorBodyProps {
  post: WorkflowPost & { property_values?: PostPropertyValue[] };
  templateId: number | null | undefined;
  workflowId: number;
  clienteId: number;
  clientePosts: ClientePost[];
  isExpanded: boolean;
  approvals: PostApproval[];
  editSuggestion: PostEditSuggestion | null;
  membros: Membro[];
  replyText: string;
  sendingReply: boolean;
  commentThreads: CommentThreadWithComments[];
  currentUserId?: string;
  currentUserRole: 'owner' | 'admin' | 'agent';
  workspaceUsers: { id: string; nome: string; avatar_url: string }[];
  hasInstagramAccount: boolean;
  igAccountStatus: { revoked: boolean; expired: boolean; canPublish: boolean } | null;
  hasActiveTikTokAccount: boolean;
  ttAccountStatus: { revoked: boolean; expired: boolean } | null;
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

export function PostEditorBody({
  post,
  templateId,
  workflowId,
  clienteId,
  clientePosts,
  isExpanded,
  approvals,
  editSuggestion,
  membros,
  replyText,
  sendingReply,
  commentThreads,
  currentUserId,
  currentUserRole,
  workspaceUsers,
  hasInstagramAccount,
  igAccountStatus,
  hasActiveTikTokAccount,
  ttAccountStatus,
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
}: PostEditorBodyProps) {
  // Per-row scheduled-day dots for this post's date picker: same client-wide post list for
  // every row (stable identity from the TanStack cache), each row excludes only its own post
  // so it never warns about itself.
  const dayMarkers = useMemo(
    () => buildTipoDayMarkers(clientePosts, { excludePostId: post.id ?? undefined }),
    [clientePosts, post.id],
  );

  const { features } = useWorkspaceLimits();
  const statusRegistry = useStatusRegistry();

  // Shares the ['post-media', post.id] cache key with PostMediaGallery below, so this is a
  // cache hit whenever the gallery already loaded it. Feeds ScheduleButton's client-side
  // media preflight (size/format/aspect-ratio) once the post is expanded.
  const { data: postMedia } = useQuery({
    queryKey: ['post-media', post.id],
    queryFn: () => listPostMedia(post.id!),
    staleTime: 5 * 60 * 1000,
    enabled: isExpanded && !!post.id,
  });

  // TikTok settings completeness/test-mode-banner seam (Task C3), held here rather than
  // inside ScheduleButton because TikTokSettingsPanel and ScheduleButton are siblings —
  // this component instance is scoped to a single post row, so per-post-id keying is
  // implicit. Reset on collapse (isExpanded -> false below) so a fresh open always
  // re-requires the ephemeral music-usage confirmation, matching TikTokSettingsPanel's
  // documented "re-confirm every open" contract instead of silently trusting a stale value.
  const [tiktokSettingsComplete, setTiktokSettingsComplete] = useState(false);
  const [tiktokTestModeBanner, setTiktokTestModeBanner] = useState(false);
  useEffect(() => {
    if (!isExpanded) {
      setTiktokSettingsComplete(false);
      setTiktokTestModeBanner(false);
    }
  }, [isExpanded]);

  // Local state for title to avoid input lag / letter-replacement from the
  // round-trip through updateWorkflowPost + refresh on every keystroke.
  const [tituloLocal, setTituloLocal] = useState(post.titulo ?? '');
  const tituloDirty = useRef(false);
  // Hold the latest onFieldChange in a ref so the debounce effect below does
  // not re-run (and reset its timer) every time the parent re-renders with a
  // fresh inline callback — which would otherwise drop the save if the parent
  // re-renders within 400 ms of the last keystroke.
  const onFieldChangeRef = useRef(onFieldChange);
  useEffect(() => {
    onFieldChangeRef.current = onFieldChange;
  }, [onFieldChange]);
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

  const [resolvedContent, setResolvedContent] = useState<Record<string, unknown> | null>(
    post.conteudo,
  );

  useEffect(() => {
    if (!post.conteudo) {
      setResolvedContent(null);
      return;
    }
    const keys = extractR2Keys(post.conteudo);
    if (keys.length === 0) {
      setResolvedContent(post.conteudo);
      return;
    }
    let cancelled = false;
    resolveInlineImageUrls(keys)
      .then((urlMap) => {
        if (!cancelled) setResolvedContent(injectSignedUrls(post.conteudo!, urlMap));
      })
      .catch(() => {
        if (!cancelled) setResolvedContent(post.conteudo);
      });
    return () => {
      cancelled = true;
    };
  }, [post.conteudo]);

  const [resolvedSuggestion, setResolvedSuggestion] = useState<Record<string, unknown> | null>(
    editSuggestion?.suggested_conteudo ?? null,
  );

  useEffect(() => {
    if (!editSuggestion?.suggested_conteudo) {
      setResolvedSuggestion(null);
      return;
    }
    const keys = extractR2Keys(editSuggestion.suggested_conteudo);
    if (keys.length === 0) {
      setResolvedSuggestion(editSuggestion.suggested_conteudo);
      return;
    }
    let cancelled = false;
    resolveInlineImageUrls(keys)
      .then((urlMap) => {
        if (!cancelled)
          setResolvedSuggestion(injectSignedUrls(editSuggestion.suggested_conteudo!, urlMap));
      })
      .catch(() => {
        if (!cancelled) setResolvedSuggestion(editSuggestion.suggested_conteudo);
      });
    return () => {
      cancelled = true;
    };
  }, [editSuggestion?.suggested_conteudo]);

  if (!isExpanded) return null;

  const isExternallyVisible = isVisibleToClient(post.status);
  const isScheduleLocked = post.status === 'agendado';
  const isStoryPost = post.tipo === 'stories';
  // One sentence on what the system will do to this post without being asked;
  // null for the statuses that just sit there waiting on a person.
  const statusAutomationHint = getStatusAutomationHint(post);

  return (
    <div className="drawer-post-content">
      <div className="drawer-post-meta-row">
        <div className="drawer-post-field">
          <label>Título</label>
          <input
            className="drawer-input"
            value={tituloLocal}
            onChange={(e) => {
              tituloDirty.current = true;
              setTituloLocal(e.target.value);
            }}
            onBlur={() => {
              if (tituloDirty.current) {
                onFieldChange('titulo', tituloLocal);
                tituloDirty.current = false;
              }
            }}
            placeholder="Título do post"
          />
        </div>
        <div className="drawer-post-field">
          <label>Tipo</label>
          <select
            className="drawer-select"
            value={post.tipo}
            onChange={(e) => onFieldChange('tipo', e.target.value)}
          >
            {(['feed', 'reels', 'stories', 'carrossel'] as const).map((t) => (
              <option key={t} value={t}>
                {TIPO_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <PlatformSelector
          value={post.platform ?? 'instagram'}
          tipo={post.tipo}
          tiktokFeatureEnabled={features?.feature_tiktok === true}
          hasActiveTikTokAccount={hasActiveTikTokAccount}
          onChange={(platform) => onFieldChange('platform', platform)}
        />
        <div className="drawer-post-field">
          <label>Status</label>
          <select
            className="drawer-select"
            value={statusRegistry.resolve(post).key}
            onChange={(e) => onFieldChange('status', e.target.value)}
          >
            {groupOptionsByOwner(statusRegistry.options).map((group) => (
              <optgroup key={group.owner} label={group.label}>
                {group.options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.kind === 'custom' ? `· ${o.label}` : o.label}
                    {' — '}
                    {isVisibleToClient(o.canonical)
                      ? VISIBILITY_OPTION_SUFFIX.visible
                      : VISIBILITY_OPTION_SUFFIX.internal}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {membros.length > 0 && (
          <div className="drawer-post-field">
            <label>Responsável</label>
            <select
              className="drawer-select"
              value={post.responsavel_id ?? ''}
              onChange={(e) =>
                onFieldChange('responsavel_id', e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Sem responsável</option>
              {membros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="drawer-post-field">
          <label>Data de postagem</label>
          <DateTimePicker
            value={post.scheduled_at ? new Date(post.scheduled_at) : undefined}
            onChange={(date) => onFieldChange('scheduled_at', date?.toISOString() ?? null)}
            disabled={isScheduleLocked}
            futureOnly
            className="w-full"
            dayMarkers={dayMarkers}
            dayMarkerLegend={TIPO_LEGEND}
          />
        </div>
      </div>

      {statusAutomationHint && <p className="drawer-status-hint">{statusAutomationHint}</p>}

      {shouldShowPublishErrorBlock(post) && (
        <PublishErrorBlock post={post} clienteId={clienteId} onStatusChange={onRefresh} />
      )}

      {isExternallyVisible && (
        <div className="drawer-external-warning">
          {isScheduleLocked
            ? '⚠ Este post está agendado para publicação. Data e legenda do Instagram estão travadas — cancele o agendamento para editá-las.'
            : '⚠ Este post já está visível no portal do cliente. Alterações serão refletidas imediatamente.'}
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

      <PostMediaGallery
        postId={post.id!}
        mediaAutocleanedAt={post.media_autocleaned_at}
        instagramPermalink={post.instagram_permalink}
        tiktokPostUrl={post.tiktok_post_url}
      />

      {editSuggestion ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-200/60 bg-amber-50">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-[13px] font-semibold text-amber-900">Sugestão do cliente</span>
              <span className="text-[11px] text-amber-600">
                {new Date(editSuggestion.updated_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onRejectSuggestion(editSuggestion.id)}
                className="px-3 py-1 text-[12px] font-medium rounded border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 transition-colors"
              >
                Rejeitar
              </button>
              <button
                onClick={() => onAcceptSuggestion(editSuggestion)}
                className="px-3 py-1 text-[12px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                Aceitar
              </button>
            </div>
          </div>
          <div className="px-4 py-3 space-y-3">
            {editSuggestion.changed_fields.includes('conteudo') &&
              resolvedContent &&
              resolvedSuggestion && (
                <ReadOnlyTipTap content={computeTipTapDiff(resolvedContent, resolvedSuggestion)} />
              )}
            {editSuggestion.changed_fields.includes('ig_caption') && (
              <div className="border-t border-amber-200/60 pt-3">
                <p className="text-[11px] font-medium text-stone-500 mb-1.5">
                  Legenda do Instagram
                </p>
                <DiffView
                  segments={computeWordDiff(
                    post.ig_caption ?? '',
                    editSuggestion.suggested_ig_caption ?? '',
                  )}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <PostEditor
          key={`${post.id}-v${editorVersion}`}
          initialContent={resolvedContent}
          onUpdate={onContentUpdate}
          onUploadInlineImage={
            post.id
              ? async (file) => {
                  try {
                    return await uploadInlineImage(file);
                  } catch (err) {
                    toast.error(
                      err instanceof Error && err.message === 'quota_exceeded'
                        ? 'Limite de armazenamento atingido'
                        : 'Falha ao enviar imagem',
                    );
                    throw err;
                  }
                }
              : undefined
          }
          threads={commentThreads}
          membros={membros}
          workspaceUsers={workspaceUsers}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onCreateComment={(qt, c) => onCreateComment(post.id!, qt, c)}
          onReplyToComment={onReplyToComment}
          onResolveThread={onResolveThread}
          onReopenThread={onReopenThread}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
        />
      )}

      {isStoryPost ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
          Stories: uma ou mais mídias (cada uma vira um segmento), sem legenda, formato vertical
          9:16.
        </p>
      ) : hasInstagramAccount ? (
        <InstagramCaptionField
          value={post.ig_caption ?? ''}
          onChange={(val) => onFieldChange('ig_caption', val)}
          disabled={isScheduleLocked}
          lockedMessage="Cancelar agendamento para editar"
        />
      ) : null}

      {/* TikTok settings panel (Task C2) — audit-mandated creator_info compliance UI.
          Mounted whenever this post targets TikTok, mirroring PlatformSelector's own
          tipo==='stories' guard (TikTok has no Stories API, so platform can never be
          'tiktok'/'both' on a stories post — PlatformSelector self-heals that case).
          `onCompletenessChange`/`showTestModeBanner` wire into the sibling ScheduleButton
          below via the local state declared above (Task C3). */}
      {(post.platform === 'tiktok' || post.platform === 'both') && (
        <TikTokSettingsPanel
          clientId={clienteId}
          post={post}
          onFieldChange={onFieldChange}
          onCompletenessChange={setTiktokSettingsComplete}
          showTestModeBanner={tiktokTestModeBanner}
        />
      )}

      <ScheduleButton
        post={post}
        media={postMedia}
        hasInstagramAccount={hasInstagramAccount}
        igAccountStatus={igAccountStatus}
        ttAccountStatus={ttAccountStatus}
        tiktokSettingsComplete={tiktokSettingsComplete}
        onTikTokUnaudited={() => setTiktokTestModeBanner(true)}
        onStatusChange={onRefresh}
      />

      {/* Self-gating: renders nothing without the plan feature, an Instagram
          account, or on a post comments can never reach (stories, TikTok-only). */}
      <PostAutomationSection
        post={post}
        clienteId={clienteId}
        currentUserRole={currentUserRole}
        hasInstagramAccount={hasInstagramAccount}
      />

      <PostCommentSummary
        threads={commentThreads}
        membros={membros}
        workspaceUsers={workspaceUsers}
        onThreadClick={() => {}}
      />

      {approvals.length > 0 && (
        <div className="drawer-approval-thread">
          <div className="drawer-thread-label">
            <MessageSquare className="h-3.5 w-3.5" /> Comentários
          </div>
          {approvals.map((a) => (
            <PostApprovalBubble key={a.id} approval={a} />
          ))}
        </div>
      )}

      <div className="drawer-reply-row">
        <input
          className="drawer-input"
          placeholder="Responder ao cliente…"
          value={replyText}
          onChange={(e) => onReplyChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onReplySend();
            }
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
    <div
      className={`approval-bubble${isTeam ? ' approval-bubble--team' : ' approval-bubble--client'}`}
    >
      <div className="approval-bubble-meta">
        <span className="approval-bubble-author">{actionLabel}</span>
        <span className="approval-bubble-date">
          {new Date(approval.created_at).toLocaleDateString('pt-BR', {
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
