import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Lock,
  X,
} from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import type { CorrectionReason, HubPost, InstagramProfile, PostApproval } from '../../types';
import { submitApproval } from '../../api';
import { useEditSuggestion } from '../../hooks/useEditSuggestion';
import { computePostNavigation, usePostNavigation } from '../../hooks/usePostNavigation';
import { usePostAdvance, type ConfirmFlash, type SlideDir } from '../../hooks/usePostAdvance';
import {
  deriveCaption,
  getPostPublishState,
  getTipoLabel,
  hasDistinctPostText,
  isInProduction,
  pickPostCardKind,
} from '../../lib/postView';
import { sanitizeExternalUrl } from '../../lib/security';
import { HubDialog } from '../ui/HubDialog';
import { formatDate, PlatformBadge } from '../PostCard';
import { PostHistoryPanel } from '../PostHistoryPanel';
import { PostMediaLightbox } from '../PostMediaLightbox';
import { RichTextContent } from '../RichTextContent';
import { SharePostButton } from '../SharePostButton';
import { StatusTag } from './StatusTag';
import { PostMediaPane } from './PostMediaPane';
import { InProductionNotice } from './InProductionNotice';
import {
  CorrectionPanel,
  RejectedSuggestionNotice,
  SuggestionPendingNotice,
  type SuggestionView,
} from './CorrectionPanel';

interface PostDetailDialogProps {
  posts: HubPost[];
  currentId: number | null;
  token: string;
  approvals: PostApproval[];
  instagramProfile: InstagramProfile | null;
  workspaceName?: string;
  isAutoPublish: (post: HubPost) => boolean;
  onNavigate: (postId: number | null) => void;
  /** Accessible name of the "not available" fallback; defaults to the Postagens title. */
  fallbackTitle?: string;
  onApprovalSubmitted: () => void;
}

/**
 * The dialog chrome (scrim, focus trap, title) is mounted once per open and survives every
 * post-to-post move; only the cards inside are keyed by post id. During a move the outgoing
 * card stays mounted as an inert ghost (same key, same slot element, so React keeps its
 * instance: tabs, panel and badge stay exactly as they were) while the incoming card
 * mounts beside it. See usePostAdvance for the phases and timings.
 */
export function PostDetailDialog(props: PostDetailDialogProps) {
  const { posts, currentId, onNavigate, onApprovalSubmitted } = props;
  const { t } = useTranslation('hubPosts');
  const nav = usePostNavigation(posts, currentId);
  const { phase, confirm, advance, cancelHold } = usePostAdvance({
    posts,
    currentId,
    onNavigate,
    onApprovalSubmitted,
  });
  // The current card's close handler (guard + lightbox check), reached from the chrome.
  const closeRef = useRef<() => void>(() => onNavigate(null));

  // The held card renders from the snapshot taken when the action was sent, so a list
  // refetch mid-hold (on Aprovações the post leaves the list) cannot pull it away.
  const held = phase.name === 'confirming' && phase.post.id === currentId ? phase : null;
  // The router commits navigate() in a transition lane: for one frame the phase can already
  // be 'advancing' while currentId still points at the outgoing post. Keep that card badged
  // and on its snapshot through the frame instead of flashing the idle state.
  const stillFrom = phase.name === 'advancing' && phase.from.id === currentId ? phase : null;
  const ghost = phase.name === 'advancing' && phase.to === currentId ? phase : null;

  const shownPosts = held ? held.posts : stillFrom ? stillFrom.fromPosts : posts;
  const shownNav = useMemo(
    () => (held || stillFrom ? computePostNavigation(shownPosts, currentId) : nav),
    [held, stillFrom, shownPosts, currentId, nav],
  );
  const shown = held?.post ?? stillFrom?.from ?? nav.current;
  const ghostNav = useMemo(
    () => (ghost ? computePostNavigation(ghost.fromPosts, ghost.from.id) : null),
    [ghost],
  );

  if (currentId === null) return null;

  if (!shown) {
    return (
      // Accessible title deliberately differs from the visible message below: HubDialog
      // renders `title` twice more (sr-only Dialog.Title + Dialog.Description), and jsdom
      // doesn't apply the `.sr-only` CSS that would hide those from a getByText query, so
      // reusing the exact same string for both would make it ambiguous.
      <HubDialog
        open
        onRequestClose={() => onNavigate(null)}
        title={props.fallbackTitle ?? t('postagens.title', 'Postagens')}
      >
        <div className="hub-bg-card rounded-[4px] w-[min(420px,calc(100vw-2rem))] p-6 text-center space-y-4">
          <p className="text-[14px] hub-tx2">
            {t('posts.notAvailable', 'Esta postagem não está disponível.')}
          </p>
          <button
            type="button"
            onClick={() => onNavigate(null)}
            className="hub-btn-secondary rounded-[4px] px-4 py-2 text-[13px] font-semibold"
          >
            {t('shared.fechar', 'Fechar')}
          </button>
        </div>
      </HubDialog>
    );
  }

  return (
    <HubDialog open onRequestClose={() => closeRef.current()} title={shown.titulo}>
      {/* The stage clips the slide on phones (full-screen cards, no horizontal scroll) and
          stays open on md+ where the prev/next buttons sit outside the card. */}
      <div
        data-testid="hub-post-stage"
        className="relative w-full h-full md:h-auto md:w-auto flex items-center justify-center overflow-hidden md:overflow-visible"
      >
        {ghost && ghostNav && (
          <CardSlot key={ghost.from.id} ghost>
            <PostDetailContent
              {...props}
              post={ghost.from}
              posts={ghost.fromPosts}
              nav={ghostNav}
              flash={ghost.flash}
              locked
              ghost
              exit={ghost.dir}
              enter={null}
              closeRef={closeRef}
              onAdvance={advance}
              onConfirmed={confirm}
              onCancelHold={cancelHold}
            />
          </CardSlot>
        )}
        <CardSlot key={shown.id}>
          <PostDetailContent
            {...props}
            post={shown}
            posts={shownPosts}
            nav={shownNav}
            flash={held?.flash ?? stillFrom?.flash ?? null}
            locked={held !== null}
            ghost={false}
            exit={null}
            enter={ghost ? ghost.dir : null}
            closeRef={closeRef}
            onAdvance={advance}
            onConfirmed={confirm}
            onCancelHold={cancelHold}
          />
        </CardSlot>
      </div>
    </HubDialog>
  );
}

/**
 * One element type for both the live and the outgoing card, so a card that turns into the
 * ghost keeps its React instance (same key, same parent, same tag). The ghost sits under
 * the live card in DOM order, so the live one paints on top, and is inert + hidden from
 * assistive tech: nothing in it is focusable, clickable or announced.
 */
function CardSlot({ ghost = false, children }: { ghost?: boolean; children: ReactNode }) {
  return (
    <div
      data-testid={ghost ? 'hub-post-card-ghost' : 'hub-post-card-slot'}
      aria-hidden={ghost || undefined}
      inert={ghost || undefined}
      className={
        ghost
          ? 'absolute inset-0 flex items-center justify-center pointer-events-none'
          : 'relative w-full h-full md:h-auto md:w-auto flex items-center justify-center'
      }
    >
      {children}
    </div>
  );
}

type ContentProps = PostDetailDialogProps & {
  post: HubPost;
  nav: ReturnType<typeof usePostNavigation>;
  /** Confirmation badge for THIS post (it belongs to the post that was acted on). */
  flash: ConfirmFlash | null;
  /** Confirmation hold in progress: actions and navigation are frozen, closing is not. */
  locked: boolean;
  /** Outgoing card: rendered for the exit animation only. No chrome, no listeners. */
  ghost: boolean;
  /** Direction this card enters from (captured while it is the target) / leaves toward. */
  enter: SlideDir | null;
  exit: SlideDir | null;
  closeRef: RefObject<() => void>;
  onAdvance: (from: HubPost, to: number, dir: SlideDir) => void;
  onConfirmed: (post: HubPost, flash: ConfirmFlash, next: HubPost | null) => void;
  onCancelHold: () => void;
};

function PostDetailContent({
  posts,
  post,
  nav,
  token,
  approvals,
  isAutoPublish,
  onNavigate,
  onApprovalSubmitted,
  flash,
  locked,
  ghost,
  enter,
  exit,
  closeRef,
  onAdvance,
  onConfirmed,
  onCancelHold,
}: ContentProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const dateLang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const kind = pickPostCardKind(post);
  const isPending = post.status === 'enviado_cliente';
  const inProduction = isInProduction(post);
  // Media layouts show only the caption; the full text gets its own read-only tab.
  const showPostTextTab = kind !== 'text' && hasDistinctPostText(post);
  const tabKeys = showPostTextTab
    ? (['content', 'postText', 'history'] as const)
    : (['content', 'history'] as const);
  const [tab, setTab] = useState<'content' | 'postText' | 'history'>('content');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelDirty, setPanelDirty] = useState(false);
  const [contentDirty, setContentDirty] = useState(false);
  // Footer element the panel portals Salvar edição into, in place of Aprovar.
  const [saveSlot, setSaveSlot] = useState<HTMLDivElement | null>(null);
  const [historyDirty, setHistoryDirty] = useState(false);
  // Lazy first visit, then kept mounted (hidden) so a typed comment, the loaded data and
  // open diffs survive a tab flip, and flipping does not refetch hub-post-history.
  const [historyVisited, setHistoryVisited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const edit = useEditSuggestion({ token, post, onSaved: onApprovalSubmitted });
  const {
    dirty,
    saveFailed,
    discardFailedSave,
    approvalBlocked,
    saveState,
    draftConteudo,
    draftIgCaption,
  } = edit;
  // Unsent-edit lock for navigation controls: while a save is queued/in flight, and
  // through the confirmation hold after an action.
  const navLocked = submitting || locked || (dirty && !saveFailed);
  // A pending suggestion is never written to the post itself (it lives in
  // post_edit_suggestions until the team accepts it), so `post.*` stays the original and
  // the reading view can switch between the two.
  const suggestion = isPending ? post.pending_suggestion : null;
  const [suggestionView, setSuggestionView] = useState<SuggestionView>('suggestion');
  const showOriginal = suggestion !== null && suggestionView === 'original';
  const caption = showOriginal
    ? deriveCaption(post, post.ig_caption)
    : deriveCaption(post, edit.isEditable ? draftIgCaption : post.ig_caption);
  const bodyConteudo = showOriginal ? post.conteudo : draftConteudo;
  const bodyPlain = showOriginal
    ? post.conteudo_plain
    : (suggestion?.suggested_conteudo_plain ?? post.conteudo_plain);
  const textCaption = showOriginal ? post.ig_caption : (draftIgCaption ?? post.ig_caption);
  const showPanel = panelOpen && isPending;
  // Once the client edits the text/caption (or a save is queued, in flight or failed), the
  // footer's primary action becomes Salvar edição: Aprovar is blocked until the edit is
  // saved anyway, and the in-panel button sat at the bottom of a long scroll.
  const showSaveInFooter = showPanel && !edit.hasPendingSuggestion && (contentDirty || dirty);

  useUnsavedWork(panelDirty || historyDirty || submitting);

  const handleDirtyChange = useCallback((d: boolean) => setPanelDirty(d), []);
  const handleContentDirtyChange = useCallback((d: boolean) => setContentDirty(d), []);
  const handleHistoryDirtyChange = useCallback((d: boolean) => setHistoryDirty(d), []);

  // Navigation/close guard. Blocked while a save is queued or in flight (`dirty` without
  // `saveFailed`): leaving would drop it. A SETTLED failure must not lock the client in,
  // so it (like any other unsent input) only asks for confirmation, and confirming forgets
  // the failure. One confirm total, even when both a failure and unsent input exist.
  const guard = useCallback((): boolean => {
    if (submitting) return false;
    if (dirty && !saveFailed) return false;
    if (!saveFailed && !panelDirty && !historyDirty) return true;
    if (
      !window.confirm(t('shared.discardCorrectionConfirm', 'Descartar as alterações não enviadas?'))
    )
      return false;
    if (saveFailed) discardFailedSave();
    return true;
  }, [dirty, saveFailed, discardFailedSave, submitting, panelDirty, historyDirty, t]);

  const go = useCallback(
    (target: HubPost | null) => {
      if (!target || locked || !guard()) return;
      onAdvance(post, target.id, posts.indexOf(target) < nav.index ? 'prev' : 'next');
      onNavigate(target.id);
    },
    [guard, locked, onAdvance, onNavigate, post, posts, nav.index],
  );
  // Closing is allowed during the confirmation hold: the client explicitly wants out, so
  // the pending advance is dropped and the list refresh it owed happens right away.
  const close = useCallback(() => {
    // Radix reports Esc / scrim clicks even when the lightbox (portalled to body,
    // above us) is what the user is dismissing: let the lightbox handle those.
    if (lightboxIdx !== null) return;
    if (!guard()) return;
    onCancelHold();
    onNavigate(null);
  }, [guard, onCancelHold, onNavigate, lightboxIdx]);

  useEffect(() => {
    if (ghost) return;
    closeRef.current = close;
  }, [close, closeRef, ghost]);

  useEffect(() => {
    if (ghost) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable))
        return;
      if (lightboxIdx !== null) return;
      if (e.key === 'ArrowLeft') go(nav.prev);
      if (e.key === 'ArrowRight') go(nav.next);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, nav.prev, nav.next, lightboxIdx, ghost]);

  // The slide-in direction is captured when the card enters and its class kept for the
  // card's lifetime: removing it exactly when the phase ends could cut the last frames of
  // the animation. Updated (not reset) so a ghost that becomes live again mid-slide (prev
  // right after next) enters from the new side instead of popping back in place.
  const [enteredFrom, setEnteredFrom] = useState(enter);
  if (enter && enter !== enteredFrom) setEnteredFrom(enter);
  const cardRef = useRef<HTMLDivElement>(null);
  // A card that slid in takes focus (the outgoing one just went inert), so keyboard users
  // land on the new post. The first open is left to the dialog's own initial focus.
  useEffect(() => {
    if (!ghost && enteredFrom) cardRef.current?.focus({ preventScroll: true });
  }, [ghost, enteredFrom]);

  async function submit(
    action: 'aprovado' | 'correcao',
    comentario = '',
    motivo: CorrectionReason | null = null,
  ) {
    if (submitting || locked) return;
    // The card is about to leave: an unsent comment typed in the Histórico tab would go with it.
    if (
      historyDirty &&
      !window.confirm(t('shared.discardCorrectionConfirm', 'Descartar as alterações não enviadas?'))
    )
      return;
    setSubmitting(true);
    setError(null);
    try {
      let res: { scheduled?: boolean } | undefined;
      if (action === 'correcao')
        res = await submitApproval(token, post.id, 'correcao', comentario, motivo ?? undefined);
      else res = await submitApproval(token, post.id, 'aprovado', undefined);
      setPanelDirty(false);
      // From here the hold, the move and the list refresh belong to usePostAdvance. The
      // target is chosen now, before any refetch shifts the list, and re-checked at hold end.
      onConfirmed(
        post,
        action === 'correcao'
          ? 'correctionSent'
          : res?.scheduled
            ? 'approvedScheduled'
            : 'approved',
        nav.nextPending,
      );
    } catch {
      setError(t('posts.submitError', 'Não foi possível enviar. Tente novamente.'));
    } finally {
      setSubmitting(false);
    }
  }

  function closePanel() {
    if (!guard()) return;
    setPanelOpen(false);
    setPanelDirty(false);
  }

  const chips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusTag status={getPostPublishState(post)} size="md" />
      <span className="rounded-full hub-bg-soft hub-tx2 text-[12px] px-2 py-0.5">
        {kind === 'story'
          ? t('posts.storyFrames', 'Story · {{count}}', { count: post.media.length })
          : kind === 'text'
            ? `${getTipoLabel(t, post.tipo)} · ${t('posts.noMedia', 'Sem mídia')}`
            : post.media.length > 1
              ? `${getTipoLabel(t, post.tipo)} · ${t('posts.slides', '{{count}} slides', { count: post.media.length })}`
              : getTipoLabel(t, post.tipo)}
      </span>
      <PlatformBadge platform={post.platform} />
      {post.ig_trial_strategy && (
        <span
          className="rounded-full border text-[12px] px-2 py-0.5"
          style={{ color: 'var(--hub-acc)', borderColor: 'var(--hub-acc)' }}
        >
          {t('shared.reelDeTeste', 'Reel de teste')}
        </span>
      )}
      <span className="rounded-full hub-bg-soft hub-tx2 text-[12px] px-2 py-0.5">
        {formatDate(post.scheduled_at, dateLang)}
      </span>
      {post.workflow_titulo && (
        <span className="rounded-full hub-bg-soft hub-tx2 text-[12px] px-2 py-0.5">
          {post.workflow_titulo}
        </span>
      )}
    </div>
  );

  const autocleanedLink = post.media_autocleaned_at
    ? post.instagram_permalink
      ? { href: post.instagram_permalink, label: t('shared.viewOnInstagram', 'Ver no Instagram') }
      : post.tiktok_post_url
        ? { href: post.tiktok_post_url, label: t('shared.viewOnTikTok', 'Ver no TikTok') }
        : null
    : null;

  const readingBody =
    kind === 'text' ? (
      <div className="space-y-4">
        {post.media_autocleaned_at && (
          <div className="hub-bg-soft rounded-[4px] px-4 py-5 flex flex-col items-center gap-2 text-center">
            <ImageOff size={20} className="hub-tx3 opacity-60" aria-hidden="true" />
            <span className="text-[12.5px] font-medium hub-tx2">
              {t('textCard.mediaRemoved', 'Mídia removida para liberar espaço')}
            </span>
            {autocleanedLink && (
              <a
                href={sanitizeExternalUrl(autocleanedLink.href)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-semibold"
                style={{ color: 'var(--hub-acc)' }}
              >
                {autocleanedLink.label}
              </a>
            )}
          </div>
        )}
        {bodyConteudo ? (
          // Keyed by version: RichTextContent only reads `content` on mount.
          <RichTextContent
            key={showOriginal ? 'original' : 'suggestion'}
            content={bodyConteudo}
            className="font-display text-[16px] leading-[1.55] hub-txt"
            editable={false}
            fallbackText={bodyPlain}
          />
        ) : (
          <p className="font-display text-[16px] leading-[1.55] hub-txt whitespace-pre-wrap">
            {bodyPlain}
          </p>
        )}
        {textCaption && (
          <div className="border-t hub-border pt-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] hub-tx3 mb-1">
              {t('textCard.instagramCaptionLabel', 'Legenda do Instagram')}
            </p>
            <p className="text-[13px] hub-tx2 leading-relaxed whitespace-pre-wrap">{textCaption}</p>
          </div>
        )}
      </div>
    ) : (
      <p className="text-[14px] hub-txt leading-[1.55] whitespace-pre-wrap">{caption}</p>
    );

  const autoPublishNote = isPending && isAutoPublish(post) && (
    <p className="text-[12px] hub-tx3 mt-4">
      {post.scheduled_at
        ? t(
            'instagramCard.autoPublishScheduled',
            'Ao aprovar, este post será publicado automaticamente no Instagram em {{date}}.',
            {
              date: new Date(post.scheduled_at).toLocaleDateString(dateLang, {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              }),
            },
          )
        : t(
            'instagramCard.autoPublishUnscheduled',
            'Ao aprovar, este post será agendado para publicação automática no Instagram.',
          )}
    </p>
  );

  // One pair only (jsdom ignores responsive classes, so a mobile + desktop pair
  // would double every getByRole). Absolute inside the relative wrapper: on the
  // dialog's edges at mid-height on phones, outside the card on md+.
  const navButton = (dir: 'prev' | 'next') => {
    const target = dir === 'prev' ? nav.prev : nav.next;
    return (
      <button
        type="button"
        aria-label={
          dir === 'prev' ? t('posts.previous', 'Post anterior') : t('posts.next', 'Próximo post')
        }
        disabled={!target || navLocked}
        onClick={() => go(target)}
        className={`absolute z-30 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-[#222] flex items-center justify-center shadow disabled:opacity-30 disabled:cursor-default ${
          dir === 'prev' ? 'left-2 md:-left-14' : 'right-2 md:-right-14'
        }`}
      >
        {dir === 'prev' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>
    );
  };

  const singleColumn = kind === 'text';
  // Reels and stories are 9:16: on md+ the media column is sized to the card height so the
  // frame fits edge to edge instead of sitting in a wider pane with black side bars.
  const reelColumn = post.tipo === 'reels' || post.tipo === 'stories';

  const flashText =
    flash === 'approved'
      ? t('shared.postApproved', 'Post aprovado!')
      : flash === 'approvedScheduled'
        ? t('instagramCard.postApprovedAndScheduled', 'Post aprovado e agendado para publicação!')
        : flash === 'correctionSent'
          ? t('shared.correctionSent', 'Correção enviada!')
          : null;

  // The ghost only ever plays its exit; a live card keeps the enter class it mounted with.
  const slideClass = exit
    ? `hub-card-exit-${exit}`
    : enteredFrom
      ? `hub-card-enter-${enteredFrom}`
      : '';

  return (
    <>
      {!ghost && navButton('prev')}
      {!ghost && navButton('next')}
      <div
        ref={cardRef}
        tabIndex={-1}
        role="group"
        aria-label={post.titulo}
        data-slide={exit ? 'exit' : enteredFrom ? 'enter' : undefined}
        className={`hub-bg-card md:rounded-[4px] overflow-hidden flex flex-col md:grid w-full h-full md:h-[min(92vh,820px)] outline-none ${slideClass} ${
          singleColumn
            ? 'md:w-[min(560px,calc(100vw-7rem))] md:grid-cols-[minmax(0,1fr)]'
            : reelColumn
              ? 'md:w-[min(1040px,calc(100vw-7rem))] md:grid-cols-[auto_minmax(0,1fr)]'
              : 'md:w-[min(1040px,calc(100vw-7rem))] md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]'
        }`}
      >
        {!singleColumn && (
          <div
            className={`relative h-[55svh] md:h-full min-h-0 shrink-0 ${
              reelColumn ? 'md:w-[calc(min(92vh,820px)*9/16)]' : ''
            }`}
          >
            <span className="absolute top-3 left-3 z-20 rounded-full bg-black/45 text-white text-[12px] px-2 py-0.5">
              {t('posts.counter', '{{current}} de {{total}}', {
                current: nav.index + 1,
                total: posts.length,
              })}
            </span>
            <PostMediaPane post={post} onOpenLightbox={setLightboxIdx} priority />
          </div>
        )}

        <div className="flex flex-col min-h-0 flex-1">
          {flashText && (
            <p
              role="status"
              className="flex items-center gap-2 px-4 py-2 text-[12.5px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-b border-emerald-200/60 dark:border-emerald-800/40"
            >
              <CheckCircle size={14} aria-hidden="true" /> {flashText}
            </p>
          )}
          {/* On phones the header, tabs and body share ONE scroll region so the strip and
              the action footer below always stay inside the card, whatever the title and
              chip rows cost. On md+ `contents` dissolves the wrapper and the three stay
              direct column items, exactly as before. */}
          <div className="flex-1 min-h-0 overflow-y-auto md:contents">
            <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b hub-border">
              <div className="flex-1 min-w-0 space-y-2">
                <h3 className="font-display text-[18px] leading-[1.15] hub-txt">{post.titulo}</h3>
                {chips}
                {singleColumn && (
                  <span className="text-[12px] hub-tx3">
                    {t('posts.counter', '{{current}} de {{total}}', {
                      current: nav.index + 1,
                      total: posts.length,
                    })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <SharePostButton postId={post.id} />
                <button
                  type="button"
                  onClick={close}
                  aria-label={t('posts.closeDialog', 'Fechar postagem')}
                  className="w-8 h-8 rounded-full hub-bg-soft hub-tx2 flex items-center justify-center"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div
              role="tablist"
              className="sticky top-0 z-10 hub-bg-card md:static flex gap-5 px-4 border-b hub-border overflow-x-auto"
            >
              {tabKeys.map((key) => (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={tab === key}
                  onClick={() => {
                    if (key === 'history') setHistoryVisited(true);
                    setTab(key);
                  }}
                  className={`py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${tab === key ? 'hub-txt border-[var(--hub-txt)]' : 'hub-tx3 border-transparent'}`}
                >
                  {key === 'history'
                    ? t('posts.tabHistory', 'Histórico e comentários')
                    : key === 'postText'
                      ? t('posts.tabPostText', 'Texto do post')
                      : kind === 'text'
                        ? t('posts.tabText', 'Texto')
                        : t('posts.tabCaption', 'Legenda')}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              {historyVisited && (
                <div hidden={tab !== 'history'}>
                  <PostHistoryPanel
                    post={post}
                    token={token}
                    approvals={approvals}
                    onCommentSent={onApprovalSubmitted}
                    onDirtyChange={handleHistoryDirtyChange}
                    embedded
                  />
                </div>
              )}
              {showPostTextTab && tab === 'postText' && (
                <div className="space-y-4">
                  {bodyConteudo ? (
                    <RichTextContent
                      key={showOriginal ? 'original-posttext' : 'suggestion-posttext'}
                      content={bodyConteudo}
                      className="font-display text-[16px] leading-[1.55] hub-txt"
                      editable={false}
                      fallbackText={bodyPlain}
                    />
                  ) : (
                    <p className="font-display text-[16px] leading-[1.55] hub-txt whitespace-pre-wrap">
                      {bodyPlain}
                    </p>
                  )}
                  {textCaption && (
                    <div className="border-t hub-border pt-3">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] hub-tx3 mb-1">
                        {t('textCard.instagramCaptionLabel', 'Legenda do Instagram')}
                      </p>
                      <p className="text-[13px] hub-tx2 leading-relaxed whitespace-pre-wrap">
                        {textCaption}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div hidden={tab !== 'content'}>
                {showPanel ? (
                  <CorrectionPanel
                    key={post.id}
                    post={post}
                    edit={edit}
                    submitting={submitting || locked}
                    onSubmitCorrection={(c, m) => submit('correcao', c, m)}
                    onDirtyChange={handleDirtyChange}
                    onContentDirtyChange={handleContentDirtyChange}
                    saveSlot={saveSlot}
                  />
                ) : (
                  <>
                    {isPending && edit.hasPendingSuggestion && (
                      <div className="mb-3">
                        <SuggestionPendingNotice
                          changedFields={suggestion?.changed_fields}
                          view={suggestionView}
                          onViewChange={suggestion ? setSuggestionView : undefined}
                        />
                      </div>
                    )}
                    {isPending && edit.wasRejected && <RejectedSuggestionNotice />}
                    <InProductionNotice post={post} />
                    {readingBody}
                    {autoPublishNote}
                  </>
                )}
              </div>
            </div>
          </div>

          {(isPending ||
            inProduction ||
            (post.status === 'postado' && post.instagram_permalink)) && (
            <div className="px-4 py-3 border-t hub-border hub-bg-soft shrink-0 space-y-2">
              {error && (
                <p className="text-[12px] text-rose-700 bg-rose-50 dark:bg-rose-950/50 dark:text-rose-300 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              {isPending ? (
                <div className="flex gap-2">
                  {showPanel ? (
                    <button
                      type="button"
                      onClick={closePanel}
                      disabled={dirty && !saveFailed}
                      className="flex-1 rounded-[4px] border hub-border py-2.5 min-h-[44px] text-[13px] font-semibold hub-tx2 disabled:opacity-50"
                    >
                      {t('shared.fechar', 'Fechar')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setTab('content');
                        setPanelOpen(true);
                      }}
                      disabled={submitting || locked || edit.hasPendingSuggestion}
                      className="flex-1 flex items-center justify-center gap-1.5 hub-btn-secondary rounded-[4px] py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50"
                    >
                      <AlertCircle size={15} /> {t('posts.correct', 'Corrigir')}
                    </button>
                  )}
                  {showSaveInFooter ? (
                    <div
                      ref={setSaveSlot}
                      data-testid="hub-post-save-slot"
                      className="flex-1 flex"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => submit('aprovado')}
                      disabled={submitting || locked || approvalBlocked || dirty || panelDirty}
                      className="flex-1 flex items-center justify-center gap-1.5 hub-btn-primary rounded-[4px] py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50"
                    >
                      <CheckCircle size={15} />{' '}
                      {saveState === 'saving'
                        ? t('shared.saving', 'Salvando...')
                        : t('shared.aprovar', 'Aprovar')}
                    </button>
                  )}
                </div>
              ) : post.status === 'postado' && post.instagram_permalink ? (
                // The status already sits in the header chips; only the permalink lives here.
                <div className="flex items-center justify-end">
                  <a
                    href={sanitizeExternalUrl(post.instagram_permalink)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] font-semibold"
                    style={{ color: 'var(--hub-acc)' }}
                  >
                    {t('shared.viewOnInstagram', 'Ver no Instagram')}
                  </a>
                </div>
              ) : inProduction ? (
                <p className="flex items-center justify-center gap-1.5 text-[12.5px] hub-tx3">
                  <Lock size={14} aria-hidden="true" />
                  {t('production.footer', 'Em produção: nada para aprovar agora')}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {!ghost && lightboxIdx !== null && post.media.length > 0 && (
        <PostMediaLightbox
          media={post.media}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onStaleUrl={onApprovalSubmitted}
        />
      )}
    </>
  );
}
