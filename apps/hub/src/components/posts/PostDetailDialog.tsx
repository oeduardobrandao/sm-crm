import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import type { CorrectionReason, HubPost, InstagramProfile, PostApproval } from '../../types';
import { submitApproval } from '../../api';
import { useEditSuggestion } from '../../hooks/useEditSuggestion';
import { usePostNavigation } from '../../hooks/usePostNavigation';
import {
  deriveCaption,
  getPostCover,
  getPostPublishState,
  getTipoLabel,
  pickPostCardKind,
} from '../../lib/postView';
import { sanitizeExternalUrl } from '../../lib/security';
import { HubDialog } from '../ui/HubDialog';
import { formatDate, PlatformBadge } from '../PostCard';
import { PostHistoryPanel } from '../PostHistoryPanel';
import { PostMediaLightbox } from '../PostMediaLightbox';
import { RichTextContent } from '../RichTextContent';
import { SharePostButton } from '../SharePostButton';
import { MediaUnavailable } from '../MediaUnavailable';
import { StatusTag } from './StatusTag';
import { PostMediaPane } from './PostMediaPane';
import {
  CorrectionPanel,
  RejectedSuggestionNotice,
  SuggestionPendingNotice,
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
  onApprovalSubmitted: () => void;
}

type Flash = 'approved' | 'approvedScheduled' | 'correctionSent';

export function PostDetailDialog(props: PostDetailDialogProps) {
  const { posts, currentId, onNavigate } = props;
  const { t } = useTranslation('hubPosts');
  const nav = usePostNavigation(posts, currentId);
  const open = currentId !== null;
  // The flash outlives the per-post content (which remounts via key on auto-advance):
  // the Hub has no toast library, so the confirmation rides along to the next post.
  // Stored as an object with a fresh id per call so firing the same kind twice inside
  // 3 s (approve A, then B) is a new state value and restarts the clear timer.
  const [flashState, setFlashState] = useState<{ kind: Flash; id: number } | null>(null);
  const flashSeq = useRef(0);
  const flash = flashState?.kind ?? null;
  const onFlash = useCallback((kind: Flash) => {
    flashSeq.current += 1;
    setFlashState({ kind, id: flashSeq.current });
  }, []);
  useEffect(() => {
    if (!flashState) return;
    const id = window.setTimeout(() => setFlashState(null), 3000);
    return () => window.clearTimeout(id);
  }, [flashState]);
  useEffect(() => {
    if (!open) setFlashState(null);
  }, [open]);

  if (open && !nav.current) {
    return (
      // Accessible title deliberately differs from the visible message below: HubDialog
      // renders `title` twice more (sr-only Dialog.Title + Dialog.Description), and jsdom
      // doesn't apply the `.sr-only` CSS that would hide those from a getByText query, so
      // reusing the exact same string for both would make it ambiguous.
      <HubDialog
        open
        onRequestClose={() => onNavigate(null)}
        title={t('postagens.title', 'Postagens')}
      >
        <div className="hub-bg-card rounded-[4px] w-[min(420px,calc(100vw-2rem))] p-6 text-center space-y-4">
          <p className="text-[14px] hub-tx2">
            {t('posts.notAvailable', 'Esta postagem não está disponível.')}
          </p>
          <button
            type="button"
            onClick={() => onNavigate(null)}
            className="hub-btn-secondary rounded-[var(--hub-r-ctl)] px-4 py-2 text-[13px] font-semibold"
          >
            {t('shared.fechar', 'Fechar')}
          </button>
        </div>
      </HubDialog>
    );
  }

  if (!nav.current) return null;
  // key={post.id}: every piece of per-post state (edit hook, panel, tabs, lightbox) resets on navigation.
  return (
    <PostDetailContent
      key={nav.current.id}
      {...props}
      post={nav.current}
      nav={nav}
      flash={flash}
      onFlash={onFlash}
    />
  );
}

type ContentProps = PostDetailDialogProps & {
  post: HubPost;
  nav: ReturnType<typeof usePostNavigation>;
  flash: Flash | null;
  onFlash: (f: Flash) => void;
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
  onFlash,
}: ContentProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const dateLang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const kind = pickPostCardKind(post);
  const isPending = post.status === 'enviado_cliente';
  const [tab, setTab] = useState<'content' | 'history'>('content');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelDirty, setPanelDirty] = useState(false);
  const [historyDirty, setHistoryDirty] = useState(false);
  // Lazy first visit, then kept mounted (hidden) so a typed comment, the loaded data and
  // open diffs survive a tab flip, and flipping does not refetch hub-post-history.
  const [historyVisited, setHistoryVisited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const stripRef = useRef<HTMLUListElement>(null);

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
  // Unsent-edit lock for navigation controls: only while a save is queued/in flight.
  const navLocked = submitting || (dirty && !saveFailed);
  const caption = deriveCaption(post, edit.isEditable ? draftIgCaption : post.ig_caption);
  const showPanel = panelOpen && isPending;

  useUnsavedWork(panelDirty || historyDirty || submitting);

  const handleDirtyChange = useCallback((d: boolean) => setPanelDirty(d), []);
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
      if (!target || !guard()) return;
      onNavigate(target.id);
    },
    [guard, onNavigate],
  );
  const close = useCallback(() => {
    // Radix reports Esc / scrim clicks even when the lightbox (portalled to body,
    // above us) is what the user is dismissing: let the lightbox handle those.
    if (lightboxIdx !== null) return;
    if (guard()) onNavigate(null);
  }, [guard, onNavigate, lightboxIdx]);

  useEffect(() => {
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
  }, [go, nav.prev, nav.next, lightboxIdx]);

  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>('[data-current="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [post.id]);

  async function submit(
    action: 'aprovado' | 'correcao',
    comentario = '',
    motivo: CorrectionReason | null = null,
  ) {
    setSubmitting(true);
    setError(null);
    try {
      let res: { scheduled?: boolean } | undefined;
      if (action === 'correcao')
        res = await submitApproval(token, post.id, 'correcao', comentario, motivo ?? undefined);
      else res = await submitApproval(token, post.id, 'aprovado', undefined);
      // Snapshot BEFORE invalidation: on Aprovações the post leaves the list and indices shift.
      const next = nav.nextPending;
      setPanelDirty(false);
      onFlash(
        action === 'correcao'
          ? 'correctionSent'
          : res?.scheduled
            ? 'approvedScheduled'
            : 'approved',
      );
      onNavigate(next?.id ?? null);
      onApprovalSubmitted();
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
      <span className="rounded-full hub-bg-soft hub-tx2 text-[11px] px-2 py-0.5">
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
          className="rounded-full border text-[11px] px-2 py-0.5"
          style={{ color: 'var(--hub-acc)', borderColor: 'var(--hub-acc)' }}
        >
          {t('shared.reelDeTeste', 'Reel de teste')}
        </span>
      )}
      <span className="rounded-full hub-bg-soft hub-tx2 text-[11px] px-2 py-0.5">
        {formatDate(post.scheduled_at, dateLang)}
      </span>
      {post.workflow_titulo && (
        <span className="rounded-full hub-bg-soft hub-tx2 text-[11px] px-2 py-0.5">
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
        {draftConteudo ? (
          <RichTextContent
            content={draftConteudo}
            className="font-display text-[16px] leading-[1.55] hub-txt"
            editable={false}
            fallbackText={post.conteudo_plain}
          />
        ) : (
          <p className="font-display text-[16px] leading-[1.55] hub-txt whitespace-pre-wrap">
            {post.conteudo_plain}
          </p>
        )}
        {(draftIgCaption || post.ig_caption) && (
          <div className="border-t hub-border pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.06em] hub-tx3 mb-1">
              {t('textCard.instagramCaptionLabel', 'Legenda do Instagram')}
            </p>
            <p className="text-[13px] hub-tx2 leading-relaxed whitespace-pre-wrap">
              {draftIgCaption ?? post.ig_caption}
            </p>
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

  const flashText =
    flash === 'approved'
      ? t('shared.postApproved', 'Post aprovado!')
      : flash === 'approvedScheduled'
        ? t('instagramCard.postApprovedAndScheduled', 'Post aprovado e agendado para publicação!')
        : flash === 'correctionSent'
          ? t('shared.correctionSent', 'Correção enviada!')
          : null;

  return (
    <HubDialog open onRequestClose={close} title={post.titulo}>
      <div className="relative w-full h-full md:h-auto md:w-auto flex items-center justify-center">
        {navButton('prev')}
        {navButton('next')}
        <div
          className={`hub-bg-card md:rounded-[4px] overflow-hidden flex flex-col md:grid w-full h-full md:h-[min(92vh,820px)] ${
            singleColumn
              ? 'md:w-[min(560px,calc(100vw-7rem))] md:grid-cols-[minmax(0,1fr)]'
              : 'md:w-[min(1040px,calc(100vw-7rem))] md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]'
          }`}
        >
          {!singleColumn && (
            <div className="relative h-[55vh] md:h-full min-h-0">
              <span className="absolute top-3 left-3 z-20 rounded-full bg-black/45 text-white text-[11px] px-2 py-0.5">
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
            <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b hub-border">
              <div className="flex-1 min-w-0 space-y-2">
                <h3 className="font-display text-[18px] leading-[1.15] hub-txt">{post.titulo}</h3>
                {chips}
                {singleColumn && (
                  <span className="text-[11px] hub-tx3">
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

            <div role="tablist" className="flex gap-5 px-4 border-b hub-border">
              {(['content', 'history'] as const).map((key) => (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={tab === key}
                  onClick={() => {
                    if (key === 'history') setHistoryVisited(true);
                    setTab(key);
                  }}
                  className={`py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors ${tab === key ? 'hub-txt border-[var(--hub-txt)]' : 'hub-tx3 border-transparent'}`}
                >
                  {key === 'history'
                    ? t('posts.tabHistory', 'Histórico e comentários')
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
              {tab === 'history' ? null : showPanel ? (
                <CorrectionPanel
                  key={post.id}
                  post={post}
                  edit={edit}
                  submitting={submitting}
                  onSubmitCorrection={(c, m) => submit('correcao', c, m)}
                  onDirtyChange={handleDirtyChange}
                />
              ) : (
                <>
                  {isPending && edit.hasPendingSuggestion && (
                    <div className="mb-3">
                      <SuggestionPendingNotice />
                    </div>
                  )}
                  {isPending && edit.wasRejected && <RejectedSuggestionNotice />}
                  {readingBody}
                  {autoPublishNote}
                </>
              )}
            </div>

            <ul
              ref={stripRef}
              aria-label={t('posts.stripLabel', 'Outros posts')}
              className="flex gap-1.5 px-4 py-2 border-t hub-border overflow-x-auto shrink-0"
            >
              {posts.map((p) => {
                const cover = getPostCover(p);
                const src = cover?.kind === 'video' ? cover.thumbnail_url : cover?.url;
                const isCurrent = p.id === post.id;
                return (
                  <li key={p.id} data-current={isCurrent ? 'true' : undefined} className="shrink-0">
                    <button
                      type="button"
                      aria-label={t('posts.goToPost', 'Ir para {{title}}', { title: p.titulo })}
                      aria-current={isCurrent ? 'true' : undefined}
                      disabled={navLocked}
                      onClick={() => (isCurrent ? undefined : go(p))}
                      className={`block w-[30px] h-[38px] rounded-[2px] overflow-hidden ${isCurrent ? 'ring-2 ring-[var(--hub-txt)] ring-offset-1 ring-offset-[var(--hub-card)]' : 'opacity-60 hover:opacity-100'}`}
                    >
                      {cover && !cover.media_lost_at && src ? (
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      ) : cover ? (
                        <MediaUnavailable size="compact" />
                      ) : (
                        <span className="block w-full h-full hub-bg-soft border hub-border" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {(isPending || (post.status === 'postado' && post.instagram_permalink)) && (
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
                        className="flex-1 rounded-[var(--hub-r-ctl)] border hub-border py-2.5 min-h-[44px] text-[13px] font-semibold hub-tx2 disabled:opacity-50"
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
                        disabled={submitting || edit.hasPendingSuggestion}
                        className="flex-1 flex items-center justify-center gap-1.5 hub-btn-secondary rounded-[var(--hub-r-ctl)] py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50"
                      >
                        <AlertCircle size={15} /> {t('posts.correct', 'Corrigir')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => submit('aprovado')}
                      disabled={submitting || approvalBlocked || dirty || panelDirty}
                      className="flex-1 flex items-center justify-center gap-1.5 hub-btn-primary rounded-[var(--hub-r-ctl)] py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50"
                    >
                      <CheckCircle size={15} />{' '}
                      {saveState === 'saving'
                        ? t('shared.saving', 'Salvando...')
                        : t('shared.aprovar', 'Aprovar')}
                    </button>
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
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {lightboxIdx !== null && post.media.length > 0 && (
        <PostMediaLightbox
          media={post.media}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onStaleUrl={onApprovalSubmitted}
        />
      )}
    </HubDialog>
  );
}
