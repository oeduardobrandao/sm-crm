import { useState, useRef, useEffect, useMemo } from 'react';
import { Expand } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { Eye, History, Loader2 } from 'lucide-react';
import {
  type WorkflowPost,
  type PostApproval,
  type PostStatusEvent,
  type Membro,
  type PostPropertyValue,
  type CommentThreadWithComments,
  type PostEditSuggestion,
  type ClientePost,
  type PostProcess,
  type CaptionAnchorPatch,
  type CommentAnchor,
} from '../../../store';
// By path, not through the store barrel: the drawer test harnesses mock '@/store'.
import { isGeralThread } from '@/store/comments';
import { PostEditor, type PostEditorHandle } from './PostEditor';
import { PropertyPanel } from './PropertyPanel';
import { PostProductionSection } from './PostProductionSection';
import { DiscussaoEquipe } from '../discussao/DiscussaoEquipe';
import { DiscutirNoChat } from '../discussao/DiscutirNoChat';
import { useDiscussao } from '../discussao/useDiscussao';
import { Badge } from '@/components/ui/badge';
import { PostMediaGallery } from './PostMediaGallery';
import { PostClientReferences } from './references/PostClientReferences';
import { ReferenceViewerDialog } from './references/ReferenceViewerDialog';
import { ReferenceChips } from './references/ReferenceChips';
import { usePostReferences } from './references/usePostReferences';
// By path, not through the '../../../store' barrel: the drawer test harnesses mock '@/store'.
import type { ReferenceItem } from '@/store/postReferences';
import {
  uploadInlineImage,
  extractR2Keys,
  injectSignedUrls,
  resolveInlineImageUrls,
  stripSignedUrls,
} from '@/services/inlineImage';
import { listPostMedia } from '../../../services/postMedia';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { PostOrigemLinha } from '../linha/PostOrigemLinha';
import { InstagramCaptionField, type InstagramCaptionFieldHandle } from './InstagramCaptionField';
import { PlatformSelector } from './PlatformSelector';
import { TikTokSettingsPanel } from './TikTokSettingsPanel';
import type { TikTokReadiness } from '../tiktokComposerRules';
import { TrialReelPanel } from './TrialReelPanel';
import { InstagramCollaboratorsField } from './InstagramCollaboratorsField';
import {
  ScheduleButton,
  PlatformStatusRow,
  PublishNowConfirmDialog,
  useScheduleActions,
} from './ScheduleButton';
import { PostAutomationSection } from './PostAutomationSection';
import { PublishErrorBlock } from './PublishErrorBlock';
import { shouldShowPublishErrorBlock } from './publishErrorBlockVisibility';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { SuggestTimeButton } from './SuggestTimeButton';
import { useAcceptSuggestionFlow } from './AcceptSuggestionDialog';
import { SuggestionFieldDiff, TeamOnlyFooter, visibleSuggestionStates } from './SuggestionReview';
import {
  suggestionFieldStates,
  teamOnlyChangedFields,
  type SuggestionField,
} from '../editSuggestionFields';
import {
  getStatusAutomationHint,
  isVisibleToClient,
  buildTipoDayMarkers,
  TIPO_LEGEND,
  VISIBILITY_OPTION_SUFFIX,
} from '../postLabels';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { groupOptionsByOwner } from '../statusRegistry';
import { targetsInstagram as isInstagramPost } from '../platformTargets';
import { PostVersionHistorySheet } from './PostVersionHistorySheet';
import { PLATFORM_DEFS, type PlatformId } from '@mesaas/platforms';
import { usePostDestinations } from '../hooks/usePostDestinations';
import { DestinationToggles } from './DestinationToggles';
import { TipoToggle } from './TipoToggle';
import { DestinationCaptionTabs } from './DestinationCaptionTabs';
import type { DestinationCaptionFieldHandle } from './DestinationCaptionField';
import {
  destinationToggleOptions,
  resolveDestinationState,
  seedCaptionFor,
} from '../postDestinations';
import { BottomSheet, Cell, GroupedList } from '@/components/mobile';
import { DestinationStatusPill } from './DestinationStatusPill';
import { PhoneEditorHeader } from './postEditorPhone/PhoneEditorHeader';
import { PhoneEditorTabs, type PhoneEditorTab } from './postEditorPhone/PhoneEditorTabs';
import { PhoneBottomBar, formatPhoneDateTime } from './postEditorPhone/PhoneBottomBar';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { PhonePublishChecklist } from './postEditorPhone/PhonePublishChecklist';
import { PhoneTextScreen } from './postEditorPhone/PhoneTextScreen';
import { PhoneComments } from './postEditorPhone/PhoneComments';
import { ClientConversation, type MediaNotesBinding } from './mediaNotes/ClientConversation';
import { OpenNotesBadge } from './mediaNotes/OpenNotesBadge';
// By path, not through the store barrel: the drawer test harnesses mock '@/store'.
import type { MediaNote } from '@/store/mediaNotes';
import { PhoneSuggestionSheet, PhoneTimelineSheet } from './postEditorPhone/PhoneSheets';
import type { PhoneEditorChrome, PhoneMenuAction } from './postEditorPhone/types';

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
// scoped to a workflow's template today) and is `number | null` so a post
// avulso (no workflow) can pass `null` -- the StandalonePostDrawer (Task 14)
// always pairs that with `templateId: undefined`, which already keeps
// PropertyPanel from rendering at all (see the guard below), so `null` here
// is never actually read.
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
// Stable fallback so the per-bubble filter below never sees a new array identity while the
// references query is disabled (collapsed row) or still loading.
const EMPTY_REFERENCES: ReferenceItem[] = [];
const EMPTY_MEDIA_NOTES: MediaNote[] = [];
const noopAsync = async () => {};

export interface PostEditorBodyProps {
  post: WorkflowPost & { property_values?: PostPropertyValue[] };
  templateId: number | null | undefined;
  workflowId: number | null;
  /** Processo individual vigente do post (spec §5.4). `undefined` = não se
   *  aplica (drawer de fluxo); `null` = avulso sem processo. Só o
   *  StandalonePostDrawer preenche, independentemente da flag do plano. */
  postProcess?: PostProcess | null;
  clienteId: number;
  clientePosts: ClientePost[];
  isExpanded: boolean;
  approvals: PostApproval[];
  /** Client notes pinned to the media (feedback em mídia), with their handlers. Absent:
   *  the conversation shows approvals only. */
  mediaNotes?: MediaNotesBinding;
  statusEvents: PostStatusEvent[];
  editSuggestion: PostEditSuggestion | null;
  membros: Membro[];
  replyText: string;
  sendingReply: boolean;
  commentThreads: CommentThreadWithComments[];
  currentUserId?: string;
  currentUserRole: 'owner' | 'admin' | 'agent';
  /** `can('automacoes', 'editar') === true` -- computed by the caller
   * (WorkflowDrawer/StandalonePostDrawer), threaded down to
   * PostAutomationSection. See its own prop doc for why this replaced a
   * `currentUserRole === 'owner' || 'admin'` check. */
  canManageAutomations: boolean;
  workspaceUsers: { id: string; nome: string; avatar_url: string }[];
  hasInstagramAccount: boolean;
  igAccountStatus: { revoked: boolean; expired: boolean; canPublish: boolean } | null;
  hasActiveTikTokAccount: boolean;
  ttAccountStatus: { revoked: boolean; expired: boolean } | null;
  /** Pode devolver a promise da gravação; `false` = falhou (a fila de colaboradores usa). */
  onFieldChange: (field: keyof WorkflowPost, value: unknown) => void | Promise<unknown>;
  onContentUpdate: (json: Record<string, unknown>, plain: string) => void;
  onReplyChange: (text: string) => void;
  onReplySend: () => void;
  onRefresh: () => void;
  onCreateComment: (
    postId: number,
    quotedText: string,
    comment: string,
    anchor?: CommentAnchor,
  ) => Promise<number>;
  onSaveCaption: (postId: number, text: string, anchors: CaptionAnchorPatch[]) => Promise<void>;
  onReplyToComment: (threadId: number, content: string) => Promise<void>;
  onResolveThread: (threadId: number) => Promise<void>;
  onReopenThread: (threadId: number) => Promise<void>;
  onEditComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number, threadId: number) => Promise<void>;
  editorVersion: number;
  onAcceptSuggestion: (suggestion: PostEditSuggestion, fields: SuggestionField[]) => void;
  onRejectSuggestion: (id: number) => void;
  /** Avançar etapa do processo individual, para a dica da seção de produção. */
  onProcessAvancar?: () => void;
  /**
   * `phone` (below 768px): the pushed full-screen editor with Conteúdo / Detalhes /
   * Publicar / Comentários tabs (D21), laid out over the same components and callbacks.
   * Requires `phone`. Default: the inline desktop body, unchanged.
   */
  layout?: 'desktop' | 'phone';
  /** Header, host menu actions and host-level commands for the phone layout. */
  phone?: PhoneEditorChrome;
  /**
   * `&discussao=1` deep link, set only for the post the link names. Desktop: scroll to the
   * team discussion and focus its composer. Phone: open Comentários on Equipe, without
   * focusing (no keyboard). A counter: acts on mount and whenever it changes to a new
   * non-zero value (a link to the already-open post), so no remount is needed;
   * `onDiscussaoFocused` then tells the host it was applied.
   */
  focusRequest?: number;
  onDiscussaoFocused?: () => void;
}

export function PostEditorBody({
  post,
  templateId,
  workflowId,
  postProcess,
  clienteId,
  clientePosts,
  isExpanded,
  approvals,
  mediaNotes,
  statusEvents,
  editSuggestion,
  membros,
  replyText,
  sendingReply,
  commentThreads,
  currentUserId,
  currentUserRole,
  canManageAutomations,
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
  onSaveCaption,
  onReplyToComment,
  onResolveThread,
  onReopenThread,
  onEditComment,
  onDeleteComment,
  editorVersion,
  onAcceptSuggestion,
  onRejectSuggestion,
  onProcessAvancar,
  layout = 'desktop',
  phone,
  focusRequest,
  onDiscussaoFocused,
}: PostEditorBodyProps) {
  const { t } = useTranslation('postEditor');
  const isPhone = layout === 'phone' && phone != null;
  // Per-row scheduled-day dots for this post's date picker: same client-wide post list for
  // every row (stable identity from the TanStack cache), each row excludes only its own post
  // so it never warns about itself.
  const dayMarkers = useMemo(
    () => buildTipoDayMarkers(clientePosts, { excludePostId: post.id ?? undefined }),
    [clientePosts, post.id],
  );

  const { features } = useWorkspaceLimits();
  const statusRegistry = useStatusRegistry();
  // Once per post row, shared by the desktop section and the phone tab. Every row mounts
  // this component, so it only subscribes and fetches while the post is expanded.
  // Hosts already pass this post's threads; filter anyway, since a foreign comment id would
  // make post_discussao_marcar_lido raise and widen the realtime filter.
  const postThreads = useMemo(
    () => commentThreads.filter((t) => t.post_id === post.id),
    [commentThreads, post.id],
  );
  const discussao = useDiscussao({
    postId: post.id ?? 0,
    threads: postThreads,
    currentUserId: currentUserId ?? '',
    enabled: isExpanded && post.id != null && !!currentUserId,
  });
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  // Plataformas por fluxo (P2), dark atrás de feature_multiplatform. Desligada ou
  // carregando = a árvore de hoje: PlatformSelector, uma legenda do Instagram só com
  // conta conectada, painel do TikTok com a própria legenda.
  const multiplatform = features?.feature_multiplatform === true;
  const destinations = usePostDestinations(post, multiplatform && isExpanded, onRefresh);
  const [captionTab, setCaptionTab] = useState<PlatformId | null>(null);
  const tiktokCaptionRef = useRef<DestinationCaptionFieldHandle>(null);
  const geralCaptionRef = useRef<DestinationCaptionFieldHandle>(null);

  // Shares the ['post-media', post.id] cache key with PostMediaGallery below, so this is a
  // cache hit whenever the gallery already loaded it. Feeds ScheduleButton's client-side
  // media preflight (size/format/aspect-ratio) once the post is expanded.
  const { data: postMedia, isError: postMediaError } = useQuery({
    queryKey: ['post-media', post.id],
    queryFn: () => listPostMedia(post.id!),
    staleTime: 5 * 60 * 1000,
    enabled: isExpanded && !!post.id,
  });

  // Client references (Hub). One fetch per post feeds the section under the media gallery and
  // the chips on the client's correction bubbles; same expand gate as the media query above.
  const { data: references = EMPTY_REFERENCES } = usePostReferences(post.id, isExpanded);
  // One viewer for both entry points (tile "Abrir" and bubble chips).
  const [viewingReference, setViewingReference] = useState<ReferenceItem | null>(null);

  // TikTok readiness/test-mode-banner seam, held here rather than inside ScheduleButton
  // because TikTokSettingsPanel and ScheduleButton are siblings — this component instance
  // is scoped to a single post row, so per-post-id keying is implicit. The panel reports
  // readiness (spec 2026-10-08-tiktok-audit-readiness A0: complete + blocking reason). Reset
  // on collapse (isExpanded -> false below) so a reopen re-fetches creator_info and
  // re-derives readiness instead of silently trusting a stale value.
  const [tiktokReadiness, setTiktokReadiness] = useState<TikTokReadiness>({ complete: false });
  const [tiktokTestModeBanner, setTiktokTestModeBanner] = useState(false);
  useEffect(() => {
    if (!isExpanded) {
      setTiktokReadiness({ complete: false });
      setTiktokTestModeBanner(false);
    }
  }, [isExpanded]);

  // Local state for title to avoid input lag / letter-replacement from the
  // round-trip through updateWorkflowPost + refresh on every keystroke.
  const [tituloLocal, setTituloLocal] = useState(post.titulo ?? '');
  const captionRef = useRef<InstagramCaptionFieldHandle>(null);
  // The Roteiro editor (phone or desktop, never both): "Ver no texto" on a passage thread.
  const contentEditorRef = useRef<PostEditorHandle>(null);
  // Campo de colaboradores: "Editar colaboradores" (bloco de erro) foca o input; sem input
  // (travado ou com 3 chips) rola até o campo.
  const collaboratorsInputRef = useRef<HTMLInputElement>(null);
  const collaboratorsBoxRef = useRef<HTMLDivElement>(null);
  const tituloDirty = useRef(false);
  // Hold the latest onFieldChange in a ref so the debounce effect below does
  // not re-run (and reset its timer) every time the parent re-renders with a
  // fresh inline callback — which would otherwise drop the save if the parent
  // re-renders within 400 ms of the last keystroke.
  const onFieldChangeRef = useRef(onFieldChange);
  useEffect(() => {
    onFieldChangeRef.current = onFieldChange;
  }, [onFieldChange]);
  // Colaboradores: lista local otimista e gravações em fila. O post só volta com a lista
  // nova depois do PATCH + refresh; sem isso, dois @ adicionados em sequência partiam da
  // mesma lista antiga e o segundo apagava o primeiro. Enquanto há gravação pendente, o
  // valor do servidor não sobrescreve o local. O reel de teste usa a mesma fila: os dois
  // campos se excluem no banco, e PATCHes fora de ordem fariam o CHECK recusar um deles.
  const [collaborators, setCollaboratorsLocal] = useState<string[]>(post.ig_collaborators ?? []);
  const serverCollaborators = useRef<string[]>(post.ig_collaborators ?? []);
  const fieldWritesPending = useRef(0);
  const fieldWriteQueue = useRef<Promise<unknown>>(Promise.resolve());
  const collaboratorsWriteFailed = useRef(false);
  useEffect(() => {
    serverCollaborators.current = post.ig_collaborators ?? [];
    if (fieldWritesPending.current === 0) setCollaboratorsLocal(serverCollaborators.current);
  }, [post.ig_collaborators]);
  const queueFieldWrite = (field: keyof WorkflowPost, value: unknown) => {
    // Os drawers resolvem `false` quando o PATCH falha (já avisaram com toast).
    const write = () =>
      // Executor roda já (idle = gravação síncrona) e transforma throw em rejeição.
      new Promise<unknown>((resolve) => resolve(onFieldChangeRef.current(field, value))).then(
        (ok) => {
          if (ok === false && field === 'ig_collaborators') collaboratorsWriteFailed.current = true;
        },
      );
    const idle = fieldWritesPending.current === 0;
    fieldWritesPending.current += 1;
    const chain = (idle ? write() : fieldWriteQueue.current.then(write))
      .catch(() => undefined)
      .finally(() => {
        fieldWritesPending.current -= 1;
        // Gravação recusada: sem refresh o post não muda, então volta ao valor salvo.
        if (fieldWritesPending.current === 0 && collaboratorsWriteFailed.current) {
          collaboratorsWriteFailed.current = false;
          setCollaboratorsLocal(serverCollaborators.current);
        }
      });
    fieldWriteQueue.current = chain;
    // Troca silenciosa de versão espera a fila; Agendar/Publicar também (flushFieldWrites).
    void trackUnsavedWork(chain);
  };
  const setCollaborators = (next: string[]) => {
    setCollaboratorsLocal(next);
    queueFieldWrite('ig_collaborators', next);
  };
  const flushFieldWrites = () => fieldWriteQueue.current;
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
  // Phone: Back unmounts this body (the pushed editor closes). A título typed in the last
  // 400ms would otherwise be dropped with the debounce timer.
  const tituloLocalRef = useRef(tituloLocal);
  tituloLocalRef.current = tituloLocal;
  const isPhoneRef = useRef(isPhone);
  isPhoneRef.current = isPhone;
  useEffect(
    () => () => {
      if (isPhoneRef.current && tituloDirty.current) {
        tituloDirty.current = false;
        onFieldChangeRef.current('titulo', tituloLocalRef.current);
      }
    },
    [],
  );

  // `resolvedContent` must track post.conteudo synchronously (same render, not one tick
  // later via an effect): when a client's edit suggestion is accepted, the diff card swaps
  // to <PostEditor> by remounting it (new key), and PostEditor freezes whatever content it's
  // handed at that exact mount -- it never re-syncs later. A useState-seeded-then-effect-
  // updated value lags the first render after post.conteudo changes, so a remount landing in
  // that render (as the accept-suggestion swap does) would freeze on the pre-suggestion doc
  // even though post.conteudo had already updated. Only the R2 signed-URL resolution is
  // genuinely async; the common case (no inline images) resolves in the same render.
  const contentR2Keys = useMemo(
    () => (post.conteudo ? extractR2Keys(post.conteudo) : []),
    [post.conteudo],
  );
  const [resolvedAsyncContent, setResolvedAsyncContent] = useState<{
    forContent: Record<string, unknown>;
    content: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    if (!post.conteudo || contentR2Keys.length === 0) return;
    let cancelled = false;
    const forContent = post.conteudo;
    resolveInlineImageUrls(contentR2Keys)
      .then((urlMap) => {
        if (!cancelled)
          setResolvedAsyncContent({ forContent, content: injectSignedUrls(forContent, urlMap) });
      })
      .catch(() => {
        if (!cancelled) setResolvedAsyncContent({ forContent, content: forContent });
      });
    return () => {
      cancelled = true;
    };
  }, [post.conteudo, contentR2Keys]);

  const resolvedContent = !post.conteudo
    ? null
    : resolvedAsyncContent && resolvedAsyncContent.forContent === post.conteudo
      ? resolvedAsyncContent.content
      : post.conteudo;

  // Mirrors the query-await fix above one level down: <PostEditor> freezes whatever
  // `initialContent` it's handed at mount and never re-syncs, so a mount landing before
  // `resolvedAsyncContent` catches up would freeze on raw (unsigned) R2 image refs --
  // permanently broken inline images, not just for the accept-suggestion flow but for
  // any post whose first render lands before signing resolves. Once a given editor key
  // has actually mounted, this ref latches it open -- later post.conteudo changes (e.g.
  // an autosave-triggered refetch) must NOT re-hide an already-mounted, actively-edited
  // <PostEditor>; only a genuinely new key (a real remount) re-checks readiness.
  const editorKey = `${post.id}-v${editorVersion}`;
  const mountedEditorKeyRef = useRef<string | null>(null);
  const contentReadyForMount =
    contentR2Keys.length === 0 ||
    (resolvedAsyncContent !== null && resolvedAsyncContent.forContent === post.conteudo);
  const canMountEditor = mountedEditorKeyRef.current === editorKey || contentReadyForMount;
  if (canMountEditor) {
    mountedEditorKeyRef.current = editorKey;
  }

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

  // ── Phone layout state (hooks run on every layout; only the phone branch reads them) ──
  const [phoneTab, setPhoneTab] = useState<PhoneEditorTab>(
    isPhone && focusRequest ? 'comentarios' : 'conteudo',
  );
  // The phone has nothing to scroll or focus: the Comentários tab (and the Equipe pill in
  // PhoneComments) is the whole deep link, so it is handled as soon as it is applied. The
  // initial tab above covers the mount; this covers a new link while the editor is open.
  const onDiscussaoFocusedRef = useRef(onDiscussaoFocused);
  onDiscussaoFocusedRef.current = onDiscussaoFocused;
  useEffect(() => {
    if (!isPhone || !focusRequest) return;
    setPhoneTab('comentarios');
    onDiscussaoFocusedRef.current?.();
  }, [isPhone, focusRequest]);
  // The conversation's anchor chips ask the media gallery to open that item. A nonce makes
  // a second click on the same chip open it again after the lightbox was closed.
  const [mediaFocus, setMediaFocus] = useState<{ linkId: number; nonce: number } | null>(null);
  const conversationNotes: MediaNotesBinding | undefined = mediaNotes && {
    ...mediaNotes,
    onSelectMedia: (linkId) => {
      setMediaFocus((prev) => ({ linkId, nonce: (prev?.nonce ?? 0) + 1 }));
      mediaNotes.onSelectMedia?.(linkId);
    },
  };
  const [roteiroOpen, setRoteiroOpen] = useState(false);
  const [captionScreenOpen, setCaptionScreenOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const acceptFlow = useAcceptSuggestionFlow(post, onAcceptSuggestion);
  const suggestionStates = editSuggestion ? suggestionFieldStates(post, editSuggestion) : [];
  const teamOnlyFields = editSuggestion ? teamOnlyChangedFields(post, editSuggestion) : [];
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  // One schedule/publish state per phone editor, shared by the bottom bar and the
  // "Antes de agendar" checklist (desktop keeps its own inside ScheduleButton).
  const scheduleActions = useScheduleActions({
    post,
    media: postMedia,
    hasInstagramAccount,
    igAccountStatus,
    ttAccountStatus,
    tiktokSettingsComplete: tiktokReadiness.complete,
    tiktokIncompleteReason: tiktokReadiness.reason,
    onTikTokUnaudited: () => setTiktokTestModeBanner(true),
    onStatusChange: onRefresh,
    explainMissingInstagramAccount: multiplatform,
    beforeServerAction: flushFieldWrites,
  });

  if (!isExpanded) return null;

  const isExternallyVisible = isVisibleToClient(post.status);
  const isScheduleLocked = post.status === 'agendado';
  const isStoryPost = post.tipo === 'stories';
  // One sentence on what the system will do to this post without being asked;
  // null for the statuses that just sit there waiting on a person.
  const statusAutomationHint = getStatusAutomationHint(post);

  const targets = destinations.targets ?? [];
  const currentPlatforms = targets.map((t) => t.platform);
  const publishedPlatforms = targets
    .filter((t) => resolveDestinationState(post, t) === 'publicado')
    .map((t) => t.platform);
  const destinationLockReason =
    post.status === 'agendado'
      ? t('shared.cancelScheduleToEdit')
      : post.status === 'postado'
        ? t('postEditorBody.postAlreadyPublished')
        : null;

  const showCollaborators =
    hasInstagramAccount && post.tipo !== 'stories' && isInstagramPost(post.platform);
  // Mudança de tipo/plataforma que torna colaboradores impossíveis: o trigger do banco
  // zera a lista; aqui o editor acompanha e avisa (só quando havia alguém na lista).
  const clearCollaboratorsFor = (change: { tipo?: WorkflowPost['tipo']; platform?: string }) => {
    if (collaborators.length === 0) return;
    if (change.tipo === 'stories') {
      setCollaborators([]);
      toast.info(t('postEditorBody.collaboratorsClearedStories'));
    } else if (change.platform === 'tiktok') {
      setCollaborators([]);
      toast.info(t('postEditorBody.collaboratorsClearedNotInstagram'));
    }
  };
  const focusCollaborators = () =>
    requestAnimationFrame(() => {
      const input = collaboratorsInputRef.current;
      if (input && !input.disabled) input.focus();
      else collaboratorsBoxRef.current?.scrollIntoView({ block: 'center' });
    });
  const collaboratorsField = (idPrefix: string, className?: string) => (
    <div ref={collaboratorsBoxRef} className={className}>
      <InstagramCollaboratorsField
        value={collaborators}
        onChange={setCollaborators}
        locked={isScheduleLocked}
        trialOn={!!post.ig_trial_strategy}
        refused={
          post.status === 'falha_publicacao' && post.publish_error_code === 'COLLABORATOR_INVALID'
            ? (post.ig_collaborators_refused ?? [])
            : []
        }
        inputRef={collaboratorsInputRef}
        idPrefix={idPrefix}
      />
    </div>
  );

  const handleDestinationToggle = (platform: PlatformId, on: boolean) => {
    const ownCaption =
      platform === 'instagram'
        ? post.ig_caption
        : platform === 'tiktok'
          ? post.tiktok_caption
          : null;
    // Destino que já tem legenda própria (ex.: Instagram tirado e religado) não recebe cópia.
    const seed =
      on && !ownCaption?.trim()
        ? seedCaptionFor(
            platform,
            currentPlatforms,
            {
              instagram: captionRef.current?.getText() ?? post.ig_caption ?? null,
              tiktok: tiktokCaptionRef.current?.getText() ?? post.tiktok_caption ?? null,
              geral:
                geralCaptionRef.current?.getText() ??
                targets.find((t) => t.platform === 'geral')?.caption ??
                null,
            },
            post.tipo,
          )
        : null;
    if (seed && seed.cut > 0) {
      toast.info(
        t('postEditorBody.captionTrimmed', {
          cut: seed.cut,
          platform: PLATFORM_DEFS[platform].label,
        }),
      );
    }
    if (!on && platform === 'geral') {
      // A legenda do Geral mora só na linha de post_targets: tirar o destino a apaga.
      // Pega o texto agora (inclui rascunho ainda não salvo) para oferecer Desfazer.
      const lost =
        geralCaptionRef.current?.getText() ??
        targets.find((t) => t.platform === 'geral')?.caption ??
        '';
      destinations.toggle.mutate(
        { platform, on, seedCaption: null },
        {
          onSuccess: () => {
            if (!lost.trim()) return;
            toast(t('postEditorBody.geralRemoved'), {
              duration: 8000,
              action: {
                label: t('postEditorBody.undo'),
                onClick: () => {
                  destinations.toggle.mutate({ platform: 'geral', on: true, seedCaption: lost });
                  setCaptionTab('geral');
                },
              },
            });
          },
        },
      );
      return;
    }
    if (!on && platform === 'instagram' && collaborators.length > 0) {
      // O banco zera ig_collaborators quando o post deixa de ir para o Instagram; o
      // onSettled do hook recarrega o post, então o editor larga os chips velhos.
      destinations.toggle.mutate(
        { platform, on, seedCaption: null },
        { onSuccess: () => toast.info(t('postEditorBody.collaboratorsClearedNotInstagram')) },
      );
      return;
    }
    destinations.toggle.mutate({ platform, on, seedCaption: seed?.caption ?? null });
    if (on) setCaptionTab(platform);
  };

  const storiesNote = (
    <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
      {t('postEditorBody.storiesNote')}
    </p>
  );
  const instagramCaptionField = (frameless: boolean) => (
    <InstagramCaptionField
      key={post.id}
      frameless={frameless}
      ref={captionRef}
      value={post.ig_caption ?? ''}
      threads={commentThreads}
      disabled={isScheduleLocked}
      lockedMessage={t('shared.cancelScheduleToEdit')}
      onSave={(text, anchors) => onSaveCaption(post.id!, text, anchors)}
      comments={
        currentUserId
          ? {
              membros,
              workspaceUsers,
              currentUserId,
              onCreateThread: (quotedText, comment, anchor) =>
                onCreateComment(post.id!, quotedText, comment, anchor),
              onReply: onReplyToComment,
              onResolve: onResolveThread,
              onReopen: onReopenThread,
              onEditComment,
              onDeleteComment,
            }
          : undefined
      }
    />
  );
  const tiktokSettingsPanel = (hideCaption: boolean) => (
    <TikTokSettingsPanel
      clientId={clienteId}
      post={post}
      onFieldChange={onFieldChange}
      onReadinessChange={setTiktokReadiness}
      media={postMedia}
      mediaError={postMediaError}
      showTestModeBanner={tiktokTestModeBanner}
      hideCaption={hideCaption}
    />
  );

  // ── Phone layout (below 768px): same pieces, four tabs, its own screen ──────────
  if (isPhone && phone) {
    const statusOption = statusRegistry.resolve(post);
    // The general thread never counts as a passage comment; its unread messages feed the tab.
    const activeThreads = commentThreads.filter((t) => t.status === 'active' && !isGeralThread(t));
    const captionThreadCount = activeThreads.filter((t) => t.field === 'ig_caption').length;
    const openClientNotes = (conversationNotes?.notes ?? EMPTY_MEDIA_NOTES).filter(
      (n) => n.visibility === 'client' && n.status === 'open',
    ).length;
    const commentCount = discussao.naoLidas + approvals.length + openClientNotes;
    const paragraphs = (post.conteudo_plain ?? '').split(/\n+/).filter((l) => l.trim()).length;
    const roteiroSummary = editSuggestion
      ? t('postEditorBody.suggestionPending')
      : paragraphs === 0
        ? t('postEditorBody.empty')
        : t('postEditorBody.paragraphs', { count: paragraphs });
    const postsToTikTok = multiplatform
      ? currentPlatforms.includes('tiktok')
      : post.platform === 'tiktok' || post.platform === 'both';

    // Host actions first, the editor's own before the destructive ones (Excluir last).
    const editorActions: PhoneMenuAction[] = [
      ...(post.id != null
        ? [{ label: t('shared.versionHistory'), onSelect: () => setVersionHistoryOpen(true) }]
        : []),
      { label: t('shared.postHistory'), onSelect: () => setTimelineOpen(true) },
    ];
    const firstDestructive = phone.menuActions.findIndex((a) => a.destructive);
    const menuActions =
      firstDestructive < 0
        ? [...phone.menuActions, ...editorActions]
        : [
            ...phone.menuActions.slice(0, firstDestructive),
            ...editorActions,
            ...phone.menuActions.slice(firstDestructive),
          ];

    const openThreadFromList = (threadId: number) => {
      const thread = commentThreads.find((t) => t.id === threadId);
      if (thread?.field === 'conteudo') {
        setPhoneTab('conteudo');
        // The Roteiro editor lives in its full-screen text screen (mounted, hidden while
        // closed); open it, then focus once it is laid out. A pending edit suggestion
        // replaces the editor, so there is nothing to focus then.
        if (editSuggestion) return;
        setRoteiroOpen(true);
        requestAnimationFrame(() => contentEditorRef.current?.focusThread(threadId));
        return;
      }
      if (thread?.field !== 'ig_caption') return;
      if (multiplatform && !currentPlatforms.includes('instagram')) {
        toast.info(t('postEditorBody.enableInstagramToSeeComment'));
        return;
      }
      setPhoneTab('conteudo');
      if (multiplatform) setCaptionTab('instagram');
      // The pane and the caption tab are revealed this frame; the popover places itself
      // from the text's rects, so focus after they're visible.
      requestAnimationFrame(() => captionRef.current?.focusThread(threadId));
    };

    const captionBlock = multiplatform ? (
      <DestinationCaptionTabs
        post={post}
        targets={targets}
        loading={destinations.isLoading}
        error={destinations.isError}
        onRetry={destinations.refetch}
        activeTab={captionTab}
        onActiveTabChange={setCaptionTab}
        locked={isScheduleLocked}
        instagramCaption={isStoryPost ? storiesNote : instagramCaptionField(true)}
        // TikTok settings live in Publicar on phones; the caption stays here.
        tiktokSettings={null}
        tiktokFieldRef={tiktokCaptionRef}
        geralFieldRef={geralCaptionRef}
        onSaveCaption={destinations.saveCaption}
      />
    ) : isStoryPost ? (
      storiesNote
    ) : hasInstagramAccount ? (
      instagramCaptionField(false)
    ) : null;

    const phoneEditor = editSuggestion ? null : !canMountEditor ? (
      <div className="phone-editor-loading">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('shared.loadingContent')}
      </div>
    ) : (
      <PostEditor
        ref={contentEditorRef}
        key={editorKey}
        variant="phone"
        initialContent={resolvedContent}
        onUpdate={(json, plain) => onContentUpdate(stripSignedUrls(json), plain)}
        onUploadInlineImage={
          post.id
            ? async (file) => {
                try {
                  return await uploadInlineImage(file);
                } catch (err) {
                  toast.error(
                    err instanceof Error && err.message === 'quota_exceeded'
                      ? t('shared.storageLimitReached')
                      : t('shared.imageUploadFailed'),
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
    );

    const conteudoPane = (
      <>
        {isExternallyVisible && (
          <p className="phone-editor-notice">
            {isScheduleLocked
              ? t('postEditorBody.scheduledLockedNotice')
              : t('postEditorBody.visibleToClientNotice')}
          </p>
        )}
        <div className="phone-editor-card">
          <PostMediaGallery
            variant="phone"
            postId={post.id!}
            forStories={isStoryPost}
            targetsInstagram={isInstagramPost(post.platform)}
            adjustmentDisabled={
              post.status === 'agendado' ||
              post.status === 'postado' ||
              !!post.published_at ||
              !!post.instagram_media_id ||
              !!post.instagram_container_id ||
              ['initiated', 'processing', 'published'].includes(post.tiktok_publish_status ?? '')
            }
            mediaAutocleanedAt={post.media_autocleaned_at}
            instagramPermalink={post.instagram_permalink}
            tiktokPostUrl={post.tiktok_post_url}
            notes={conversationNotes?.notes}
            onNotesChanged={conversationNotes?.onChanged}
            openLinkRequest={mediaFocus}
            noteAuthors={{ clientName: conversationNotes?.clientName, membros, workspaceUsers }}
          />
        </div>

        {captionBlock && (
          <section className="phone-editor-section" aria-label={t('shared.caption')}>
            <div className="phone-editor-section__head">
              <h2 className="phone-editor-section__title">{t('shared.caption')}</h2>
              {post.id != null && (
                <button
                  type="button"
                  className="phone-editor-link"
                  onClick={() => setVersionHistoryOpen(true)}
                >
                  {t('postEditorBody.versions')}
                </button>
              )}
              <button
                type="button"
                className="phone-editor-link"
                aria-label={t('postEditorBody.editCaptionFullscreen')}
                onClick={() => setCaptionScreenOpen(true)}
              >
                <Expand aria-hidden="true" />
              </button>
            </div>
            <PhoneTextScreen
              open={captionScreenOpen}
              onOpenChange={setCaptionScreenOpen}
              title={t('shared.caption')}
            >
              <div className="phone-editor-card phone-editor-card--caption">{captionBlock}</div>
            </PhoneTextScreen>
            {captionThreadCount > 0 && (
              <p className="phone-editor-footnote">
                {t('postEditorBody.captionComments', { count: captionThreadCount })}
              </p>
            )}
          </section>
        )}

        <GroupedList aria-label={t('postEditorBody.scriptAndReferences')}>
          <Cell
            label={t('shared.scriptAndBrief')}
            value={roteiroSummary}
            chevron
            onClick={() => (editSuggestion ? setSuggestionOpen(true) : setRoteiroOpen(true))}
          />
          {references.length > 0 && (
            <Cell
              label={t('shared.clientReferences')}
              value={String(references.length)}
              chevron
              onClick={() => setReferencesOpen(true)}
            />
          )}
        </GroupedList>
        <PhoneTextScreen
          open={roteiroOpen}
          onOpenChange={setRoteiroOpen}
          title={t('shared.scriptAndBrief')}
          hiddenWhenClosed
        >
          {phoneEditor}
        </PhoneTextScreen>
      </>
    );

    const detalhesPane = (
      <>
        {statusAutomationHint && <p className="phone-editor-notice">{statusAutomationHint}</p>}
        <PostOrigemLinha postId={post.id} />
        <GroupedList aria-label={t('postEditorBody.postDetails')}>
          <li className="phone-cell phone-field">
            <label className="phone-field__label" htmlFor={`phone-titulo-${post.id}`}>
              {t('shared.title')}
            </label>
            <input
              id={`phone-titulo-${post.id}`}
              className="phone-field__input"
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
              placeholder={t('shared.postTitlePlaceholder')}
            />
          </li>
          <li className="phone-cell phone-field">
            <TipoToggle
              value={post.tipo}
              lockedReason={isScheduleLocked ? t('shared.cancelScheduleToEdit') : null}
              onChange={(v) => {
                onFieldChange('tipo', v);
                if (v !== 'reels' && post.ig_trial_strategy) {
                  onFieldChange('ig_trial_strategy', null);
                }
                clearCollaboratorsFor({ tipo: v });
              }}
            />
          </li>
          <li className="phone-cell phone-field">
            {multiplatform ? (
              <DestinationToggles
                options={destinationToggleOptions({
                  boardPlatforms: destinations.boardPlatforms ?? [],
                  current: currentPlatforms,
                  published: publishedPlatforms,
                  tipo: post.tipo,
                  tiktokFeatureEnabled: features?.feature_tiktok === true,
                  hasActiveTikTokAccount,
                  isExpress: post.is_express === true,
                })}
                lockedReason={destinationLockReason}
                pending={destinations.toggle.isPending || destinations.isLoading}
                onToggle={handleDestinationToggle}
              />
            ) : (
              <PlatformSelector
                value={post.platform ?? 'instagram'}
                tipo={post.tipo}
                tiktokFeatureEnabled={features?.feature_tiktok === true}
                hasActiveTikTokAccount={hasActiveTikTokAccount}
                disabled={isScheduleLocked}
                isExpress={post.is_express === true}
                onChange={(platform) => {
                  onFieldChange('platform', platform);
                  if (platform === 'tiktok' && post.ig_trial_strategy) {
                    onFieldChange('ig_trial_strategy', null);
                  }
                  clearCollaboratorsFor({ platform });
                }}
              />
            )}
          </li>
          <Cell
            label={t('shared.status')}
            value={statusOption.label}
            subtitle={
              isVisibleToClient(statusOption.canonical)
                ? VISIBILITY_OPTION_SUFFIX.visible
                : VISIBILITY_OPTION_SUFFIX.internal
            }
            chevron
            onClick={() => setStatusSheetOpen(true)}
          />
          {membros.length > 0 && (
            <li className="phone-cell phone-field phone-field--inline">
              <label className="phone-field__label" htmlFor={`phone-resp-${post.id}`}>
                {t('shared.postOwner')}
              </label>
              <select
                id={`phone-resp-${post.id}`}
                className="phone-field__select"
                value={post.responsavel_id ?? ''}
                onChange={(e) =>
                  onFieldChange('responsavel_id', e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">{t('shared.noOwner')}</option>
                {membros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </li>
          )}
          <li className="phone-cell phone-field">
            <div className="phone-field__head">
              <span className="phone-field__label">{t('shared.postDate')}</span>
              {hasInstagramAccount && (
                <SuggestTimeButton
                  clientId={clienteId}
                  value={post.scheduled_at ? new Date(post.scheduled_at) : undefined}
                  onPick={(date) => onFieldChange('scheduled_at', date.toISOString())}
                  disabled={isScheduleLocked}
                />
              )}
            </div>
            <DateTimePicker
              value={post.scheduled_at ? new Date(post.scheduled_at) : undefined}
              onChange={(date) => onFieldChange('scheduled_at', date?.toISOString() ?? null)}
              disabled={isScheduleLocked}
              futureOnly
              className="w-full"
              dayMarkers={dayMarkers}
              dayMarkerLegend={TIPO_LEGEND}
            />
          </li>
        </GroupedList>

        {templateId != null && templateId !== 0 && workflowId != null && (
          <div className="phone-editor-card">
            <PropertyPanel
              templateId={templateId}
              postId={post.id!}
              workflowId={workflowId}
              propertyValues={post.property_values ?? []}
              membros={membros}
            />
          </div>
        )}

        {postProcess && workflowId == null && (
          <div className="phone-editor-card">
            <PostProductionSection
              process={postProcess}
              postId={post.id!}
              membros={membros}
              postStatus={post.status}
              onAvancar={onProcessAvancar}
            />
          </div>
        )}

        <GroupedList aria-label={t('postEditorBody.history')}>
          <Cell label={t('shared.postHistory')} chevron onClick={() => setTimelineOpen(true)} />
          {post.id != null && (
            <Cell
              label={t('shared.versionHistory')}
              chevron
              onClick={() => setVersionHistoryOpen(true)}
            />
          )}
          {phone.autoSchedule && (
            <Cell
              label={t('postEditorBody.awaitingAutoSchedule')}
              subtitle={
                phone.autoSchedule.needsDate
                  ? t('postEditorBody.setFutureDate')
                  : t('postEditorBody.scheduleApprovedNow')
              }
              chevron
              onClick={phone.autoSchedule.onClick}
            />
          )}
        </GroupedList>
      </>
    );

    const publicarPane = (
      <>
        {shouldShowPublishErrorBlock(post) && (
          <PublishErrorBlock
            post={post}
            clienteId={clienteId}
            onStatusChange={onRefresh}
            onEditCollaborators={() => {
              setPhoneTab('publicar');
              focusCollaborators();
            }}
          />
        )}
        {post.status === 'falha_publicacao' &&
          (post.platform === 'tiktok' || post.platform === 'both') &&
          post.tiktok_publish_error && (
            <p className="phone-editor-notice phone-editor-notice--danger">
              {post.tiktok_publish_error}
            </p>
          )}

        <PhonePublishChecklist post={post} media={postMedia} actions={scheduleActions} />

        {postsToTikTok && (
          <section className="phone-editor-section" aria-label="TikTok">
            <h2 className="phone-group__header">TikTok</h2>
            <div className="phone-editor-card">{tiktokSettingsPanel(multiplatform)}</div>
          </section>
        )}

        {showCollaborators && (
          <section className="phone-editor-section" aria-label="Instagram">
            <h2 className="phone-group__header">Instagram</h2>
            <div className="phone-editor-card flex flex-col gap-4">
              {collaboratorsField(`phone-collab-${post.id}`)}
              <TrialReelPanel
                post={post}
                media={postMedia ?? []}
                disabled={isScheduleLocked}
                collaboratorsCount={collaborators.length}
                onFieldChange={queueFieldWrite}
              />
            </div>
          </section>
        )}

        <div className="phone-editor-automation">
          <PostAutomationSection
            post={post}
            clienteId={clienteId}
            canManage={canManageAutomations}
            hasInstagramAccount={hasInstagramAccount}
          />
        </div>

        {multiplatform && targets.length > 0 && (
          <GroupedList header={t('postEditorBody.destinations')} headerAs="h3">
            {targets.map((t) => (
              <Cell
                key={t.platform}
                label={PLATFORM_DEFS[t.platform].label}
                accessory={
                  <DestinationStatusPill
                    platform={t.platform}
                    state={resolveDestinationState(post, t)}
                    showIcon={false}
                  />
                }
              />
            ))}
          </GroupedList>
        )}
        {!multiplatform && <PlatformStatusRow post={post} />}

        {post.status === 'agendado' && post.scheduled_at && (
          <GroupedList header={t('postEditorBody.publishing')} headerAs="h3">
            <Cell
              label={t('postEditorBody.dateAndTime')}
              value={formatPhoneDateTime(post.scheduled_at)}
            />
          </GroupedList>
        )}
      </>
    );

    const comentariosPane = (
      <PhoneComments
        postId={post.id ?? 0}
        currentUserId={currentUserId ?? ''}
        discussao={discussao}
        chatBridge={
          post.id != null ? (
            <DiscutirNoChat
              variant="sheet"
              post={{ id: post.id, titulo: post.titulo, workflowId: post.workflow_id ?? null }}
            />
          ) : null
        }
        approvals={approvals}
        notes={conversationNotes?.notes ?? EMPTY_MEDIA_NOTES}
        media={postMedia ?? []}
        onNoteReply={conversationNotes?.onReply ?? noopAsync}
        onNoteStatus={conversationNotes?.onStatus ?? noopAsync}
        onSelectMedia={conversationNotes?.onSelectMedia}
        references={references}
        onOpenReference={setViewingReference}
        clientName={conversationNotes?.clientName ?? phone.clientName}
        replyText={replyText}
        sendingReply={sendingReply}
        onReplyChange={onReplyChange}
        onReplySend={onReplySend}
        threads={postThreads}
        membros={membros}
        workspaceUsers={workspaceUsers}
        onThreadClick={openThreadFromList}
        suggestion={
          editSuggestion
            ? { when: editSuggestion.updated_at, onOpen: () => setSuggestionOpen(true) }
            : null
        }
        active={phoneTab === 'comentarios'}
        focusRequest={focusRequest}
      />
    );

    return (
      <div className="phone-editor">
        <div className="phone-editor__scroll">
          <PhoneEditorHeader
            post={post}
            registry={statusRegistry}
            subtitle={phone.subtitle}
            saving={phone.saving}
            menuActions={menuActions}
            onBack={phone.onBack}
            onStatusChange={(key) => onFieldChange('status', key)}
            statusOpen={statusSheetOpen}
            onStatusOpenChange={setStatusSheetOpen}
            extra={
              <OpenNotesBadge
                approvals={approvals}
                notes={conversationNotes?.notes ?? EMPTY_MEDIA_NOTES}
              />
            }
          />
          {phone.banner}
          <PhoneEditorTabs
            value={phoneTab}
            onChange={setPhoneTab}
            commentCount={commentCount}
            panes={{
              conteudo: conteudoPane,
              detalhes: detalhesPane,
              publicar: publicarPane,
              comentarios: comentariosPane,
            }}
          />
          {phoneTab !== 'comentarios' && (
            <PhoneBottomBar
              post={post}
              actions={scheduleActions}
              sendToClient={phone.sendToClient}
            />
          )}
        </div>

        <PublishNowConfirmDialog actions={scheduleActions} />

        {post.id != null && (
          <PostVersionHistorySheet
            layout="phone"
            postId={post.id}
            open={versionHistoryOpen}
            onOpenChange={setVersionHistoryOpen}
            statusEvents={statusEvents}
            approvals={approvals}
          />
        )}
        <PhoneTimelineSheet
          open={timelineOpen}
          onOpenChange={setTimelineOpen}
          post={post}
          statusEvents={statusEvents}
          approvals={approvals}
          processEvents={phone.processEvents}
        />
        <PhoneSuggestionSheet
          open={suggestionOpen}
          onOpenChange={setSuggestionOpen}
          suggestion={editSuggestion}
          post={post}
          clientName={phone.clientName}
          resolvedContent={resolvedContent}
          resolvedSuggestion={resolvedSuggestion}
          onAccept={onAcceptSuggestion}
          onReject={onRejectSuggestion}
        />
        {post.id != null && (
          <BottomSheet
            open={referencesOpen && references.length > 0}
            onOpenChange={setReferencesOpen}
            title={t('shared.clientReferences')}
            detents={['medium', 'large']}
          >
            <PostClientReferences
              postId={post.id}
              references={references}
              onOpen={setViewingReference}
            />
          </BottomSheet>
        )}
        <ReferenceViewerDialog item={viewingReference} onClose={() => setViewingReference(null)} />
      </div>
    );
  }

  return (
    <div className="drawer-post-content">
      <PostOrigemLinha postId={post.id} />
      <div className="drawer-post-meta-row">
        <div className="drawer-post-field">
          <label>{t('shared.title')}</label>
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
            placeholder={t('shared.postTitlePlaceholder')}
          />
        </div>
        {/* Locked while agendado: the publish cron builds the Instagram container up
            to 1h before scheduled_at, so a tipo/platform change after that leaves a
            container in the old format — the publish phase then posts the wrong thing. */}
        <TipoToggle
          value={post.tipo}
          lockedReason={isScheduleLocked ? t('shared.cancelScheduleToEdit') : null}
          onChange={(v) => {
            onFieldChange('tipo', v);
            if (v !== 'reels' && post.ig_trial_strategy) {
              onFieldChange('ig_trial_strategy', null);
            }
            clearCollaboratorsFor({ tipo: v });
          }}
        />
        {multiplatform ? (
          <DestinationToggles
            options={destinationToggleOptions({
              boardPlatforms: destinations.boardPlatforms ?? [],
              current: currentPlatforms,
              published: publishedPlatforms,
              tipo: post.tipo,
              tiktokFeatureEnabled: features?.feature_tiktok === true,
              hasActiveTikTokAccount,
              isExpress: post.is_express === true,
            })}
            lockedReason={destinationLockReason}
            pending={destinations.toggle.isPending || destinations.isLoading}
            onToggle={handleDestinationToggle}
          />
        ) : (
          <PlatformSelector
            value={post.platform ?? 'instagram'}
            tipo={post.tipo}
            tiktokFeatureEnabled={features?.feature_tiktok === true}
            hasActiveTikTokAccount={hasActiveTikTokAccount}
            disabled={isScheduleLocked}
            isExpress={post.is_express === true}
            onChange={(platform) => {
              onFieldChange('platform', platform);
              if (platform === 'tiktok' && post.ig_trial_strategy) {
                onFieldChange('ig_trial_strategy', null);
              }
              clearCollaboratorsFor({ platform });
            }}
          />
        )}
        <div className="drawer-post-field">
          <label>{t('shared.status')}</label>
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
            <label>{t('shared.postOwner')}</label>
            <select
              className="drawer-select"
              value={post.responsavel_id ?? ''}
              onChange={(e) =>
                onFieldChange('responsavel_id', e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">{t('shared.noOwner')}</option>
              {membros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="drawer-post-field">
          <div className="drawer-post-field-head">
            <label>{t('shared.postDate')}</label>
            {hasInstagramAccount && (
              <SuggestTimeButton
                clientId={clienteId}
                value={post.scheduled_at ? new Date(post.scheduled_at) : undefined}
                onPick={(date) => onFieldChange('scheduled_at', date.toISOString())}
                disabled={isScheduleLocked}
              />
            )}
          </div>
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
        <PublishErrorBlock
          post={post}
          clienteId={clienteId}
          onStatusChange={onRefresh}
          onEditCollaborators={() => {
            if (multiplatform) setCaptionTab('instagram');
            focusCollaborators();
          }}
        />
      )}

      {isExternallyVisible && (
        <div className="drawer-external-warning">
          {isScheduleLocked
            ? `⚠ ${t('postEditorBody.scheduledLockedNotice')}`
            : `⚠ ${t('postEditorBody.visibleToClientNotice')}`}
        </div>
      )}
      {/* Custom properties — shown when template has properties defined. A post avulso
          (StandalonePostDrawer) has no workflowId either, and always passes
          templateId: undefined, so this guard already keeps the two conditions together. */}
      {templateId != null && templateId !== 0 && workflowId != null && (
        <PropertyPanel
          templateId={templateId}
          postId={post.id!}
          workflowId={workflowId}
          propertyValues={post.property_values ?? []}
          membros={membros}
        />
      )}

      {postProcess && workflowId == null && (
        <PostProductionSection
          process={postProcess}
          postId={post.id!}
          membros={membros}
          postStatus={post.status}
          onAvancar={onProcessAvancar}
        />
      )}

      <PostMediaGallery
        postId={post.id!}
        forStories={isStoryPost}
        targetsInstagram={isInstagramPost(post.platform)}
        adjustmentDisabled={
          post.status === 'agendado' ||
          post.status === 'postado' ||
          !!post.published_at ||
          !!post.instagram_media_id ||
          !!post.instagram_container_id ||
          ['initiated', 'processing', 'published'].includes(post.tiktok_publish_status ?? '')
        }
        mediaAutocleanedAt={post.media_autocleaned_at}
        instagramPermalink={post.instagram_permalink}
        tiktokPostUrl={post.tiktok_post_url}
        notes={conversationNotes?.notes}
        onNotesChanged={conversationNotes?.onChanged}
        openLinkRequest={mediaFocus}
        noteAuthors={{ clientName: conversationNotes?.clientName, membros, workspaceUsers }}
      />

      {post.id != null && (
        <PostClientReferences
          postId={post.id}
          references={references}
          onOpen={setViewingReference}
        />
      )}

      {post.id != null && (
        <div className="flex justify-end">
          <button
            onClick={() => setVersionHistoryOpen(true)}
            className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <History className="h-3.5 w-3.5" /> {t('shared.versionHistory')}
          </button>
        </div>
      )}

      {editSuggestion ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-200/60 bg-amber-50">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-[13px] font-semibold text-amber-900">
                {t('shared.clientSuggestion')}
              </span>
              <span className="text-[11px] text-amber-600">
                {new Date(editSuggestion.updated_at).toLocaleDateString(getIntlLocale(), {
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
                {t('shared.reject')}
              </button>
              <button
                onClick={() => acceptFlow.request(editSuggestion)}
                className="px-3 py-1 text-[12px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                {suggestionStates.some((st) => st.conflict)
                  ? t('suggestionReview.acceptReview')
                  : t('shared.accept')}
              </button>
            </div>
          </div>
          <div className="px-4 py-3 space-y-3">
            {visibleSuggestionStates(suggestionStates, resolvedContent, resolvedSuggestion).map(
              (st, i) => (
                <div
                  key={st.field}
                  className={i > 0 ? 'border-t border-amber-200/60 pt-3' : undefined}
                >
                  <SuggestionFieldDiff
                    field={st.field}
                    state={st}
                    post={post}
                    suggestion={editSuggestion}
                    resolvedContent={resolvedContent}
                    resolvedSuggestion={resolvedSuggestion}
                    label={
                      <p className="text-[11px] font-medium text-stone-500">
                        {st.field === 'texto'
                          ? t('suggestionReview.postText')
                          : t('shared.igCaption')}
                      </p>
                    }
                  />
                </div>
              ),
            )}
          </div>
          {teamOnlyFields.length > 0 && (
            <TeamOnlyFooter
              teamOnly={teamOnlyFields}
              className="rounded-none border-t border-amber-200/60 bg-amber-50 px-4 py-2.5"
            />
          )}
          {acceptFlow.dialog}
        </div>
      ) : !canMountEditor ? (
        <div
          className="flex items-center justify-center gap-2 py-10 text-[13px]"
          style={{ color: 'var(--text-light)' }}
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('shared.loadingContent')}
        </div>
      ) : (
        <PostEditor
          ref={contentEditorRef}
          key={editorKey}
          initialContent={resolvedContent}
          onUpdate={(json, plain) => onContentUpdate(stripSignedUrls(json), plain)}
          onUploadInlineImage={
            post.id
              ? async (file) => {
                  try {
                    return await uploadInlineImage(file);
                  } catch (err) {
                    toast.error(
                      err instanceof Error && err.message === 'quota_exceeded'
                        ? t('shared.storageLimitReached')
                        : t('shared.imageUploadFailed'),
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

      {multiplatform ? (
        <DestinationCaptionTabs
          post={post}
          targets={targets}
          loading={destinations.isLoading}
          error={destinations.isError}
          onRetry={destinations.refetch}
          activeTab={captionTab}
          onActiveTabChange={setCaptionTab}
          locked={isScheduleLocked}
          instagramCaption={
            isStoryPost ? (
              storiesNote
            ) : (
              <>
                {instagramCaptionField(true)}
                {showCollaborators && collaboratorsField(`collab-${post.id}`, 'mt-3')}
              </>
            )
          }
          tiktokSettings={tiktokSettingsPanel(true)}
          tiktokFieldRef={tiktokCaptionRef}
          geralFieldRef={geralCaptionRef}
          onSaveCaption={destinations.saveCaption}
        />
      ) : isStoryPost ? (
        storiesNote
      ) : hasInstagramAccount ? (
        instagramCaptionField(false)
      ) : null}

      {!multiplatform && showCollaborators && collaboratorsField(`collab-${post.id}`)}

      {hasInstagramAccount && (
        <TrialReelPanel
          post={post}
          media={postMedia ?? []}
          disabled={isScheduleLocked}
          collaboratorsCount={collaborators.length}
          onFieldChange={queueFieldWrite}
        />
      )}

      {/* TikTok settings panel (Task C2) — audit-mandated creator_info compliance UI.
          Flag-OFF only (with feature_multiplatform it lives inside the TikTok caption tab,
          caption hidden). Mounted whenever this post targets TikTok, mirroring PlatformSelector's own
          tipo==='stories' guard (TikTok has no Stories API, so platform can never be
          'tiktok'/'both' on a stories post — PlatformSelector self-heals that case).
          `onReadinessChange`/`showTestModeBanner` wire into the sibling ScheduleButton
          below via the local state declared above. */}
      {!multiplatform &&
        (post.platform === 'tiktok' || post.platform === 'both') &&
        tiktokSettingsPanel(false)}

      <ScheduleButton
        post={post}
        media={postMedia}
        hasInstagramAccount={hasInstagramAccount}
        igAccountStatus={igAccountStatus}
        ttAccountStatus={ttAccountStatus}
        tiktokSettingsComplete={tiktokReadiness.complete}
        tiktokIncompleteReason={tiktokReadiness.reason}
        onTikTokUnaudited={() => setTiktokTestModeBanner(true)}
        onStatusChange={onRefresh}
        explainMissingInstagramAccount={multiplatform}
        beforeServerAction={flushFieldWrites}
      />

      {/* Self-gating: renders nothing without the plan feature, an Instagram
          account, or on a post comments can never reach (stories, TikTok-only). */}
      <PostAutomationSection
        post={post}
        clienteId={clienteId}
        canManage={canManageAutomations}
        hasInstagramAccount={hasInstagramAccount}
      />

      {currentUserId && post.id != null && (
        <DiscussaoEquipe
          discussao={discussao}
          threads={postThreads}
          membros={membros}
          workspaceUsers={workspaceUsers}
          currentUserId={currentUserId}
          focusRequest={focusRequest}
          onFocusHandled={onDiscussaoFocused}
          chatBridge={
            <DiscutirNoChat
              variant="popover"
              post={{ id: post.id, titulo: post.titulo, workflowId: post.workflow_id ?? null }}
            />
          }
          onThreadClick={(threadId) => {
            const thread = commentThreads.find((t) => t.id === threadId);
            if (thread?.field === 'conteudo') {
              contentEditorRef.current?.focusThread(threadId);
              return;
            }
            if (thread?.field !== 'ig_caption') return;
            if (multiplatform) {
              if (!currentPlatforms.includes('instagram')) {
                toast.info(t('postEditorBody.enableInstagramToSeeComment'));
                return;
              }
              setCaptionTab('instagram');
              // A aba do Instagram pode estar escondida (forceMount + hidden) e o popover
              // se posiciona pelos retângulos do texto: foca depois de revelar a aba.
              requestAnimationFrame(() => captionRef.current?.focusThread(threadId));
              return;
            }
            captionRef.current?.focusThread(threadId);
          }}
        />
      )}

      <ClientConversation
        approvals={approvals}
        notes={conversationNotes?.notes ?? EMPTY_MEDIA_NOTES}
        media={postMedia ?? []}
        workspaceUsers={workspaceUsers}
        membros={membros}
        clientName={conversationNotes?.clientName}
        replyText={replyText}
        sendingReply={sendingReply}
        onReplyChange={onReplyChange}
        onReplySend={onReplySend}
        onNoteReply={conversationNotes?.onReply ?? noopAsync}
        onNoteStatus={conversationNotes?.onStatus ?? noopAsync}
        onSelectMedia={conversationNotes?.onSelectMedia}
        headerId={`cliente-conversa-${post.id}`}
        header={
          <div className="drawer-client-thread-header">
            <Eye className="drawer-client-thread-icon h-3.5 w-3.5" aria-hidden="true" />
            <h3 id={`cliente-conversa-${post.id}`} className="drawer-client-thread-title">
              {t('postEditorBody.clientConversation')}
            </h3>
            <Badge variant="info" size="sm">
              {t('postEditorBody.clientSees')}
            </Badge>
          </div>
        }
        renderApproval={(a) => (
          <PostApprovalBubble
            approval={a}
            references={references.filter((r) => r.post_approval_id === a.id)}
            onOpenReference={setViewingReference}
          />
        )}
      />

      {post.id != null && (
        <PostVersionHistorySheet
          postId={post.id}
          open={versionHistoryOpen}
          onOpenChange={setVersionHistoryOpen}
          statusEvents={statusEvents}
          approvals={approvals}
        />
      )}

      <ReferenceViewerDialog item={viewingReference} onClose={() => setViewingReference(null)} />
    </div>
  );
}

// ── Sub-component ────────────────────────────────────────────────────────────

function PostApprovalBubble({
  approval,
  references,
  onOpenReference,
}: {
  approval: PostApproval;
  /** References the client attached to this correction (post_references.post_approval_id). */
  references: ReferenceItem[];
  onOpenReference: (item: ReferenceItem) => void;
}) {
  const { t } = useTranslation('postEditor');
  const isTeam = approval.is_workspace_user;
  const actionLabel = isTeam
    ? t('postApprovalBubble.team')
    : approval.action === 'correcao'
      ? t('postApprovalBubble.correctionRequested')
      : approval.action === 'aprovado'
        ? t('postApprovalBubble.approved')
        : t('postApprovalBubble.client');

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
      <ReferenceChips references={references} onOpen={onOpenReference} />
    </div>
  );
}
