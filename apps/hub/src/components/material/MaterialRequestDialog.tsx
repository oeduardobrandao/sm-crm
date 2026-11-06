import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, FolderUp, X } from 'lucide-react';
import type { PlatformId } from '@mesaas/platforms';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { useHub } from '../../HubContext';
import { postReferencesKey, usePostReferences } from '../../hooks/usePostReferences';
import { compactHubToken } from '../../lib/hubLinks';
import { getTipoLabel } from '../../lib/postView';
import { shortDate } from '../../lib/materialDates';
import { HUB_MATERIAL_KEY, hubPostsQuery } from '../../queries';
import { closeMaterialRequest, type HubMaterialRequest } from '../../services/materialRequests';
import { MAX_REFERENCES_PER_POST } from '../../services/postReferences';
import { PostHistoryPanel } from '../PostHistoryPanel';
import { StatusPill } from '../StatusPill';
import { usePlatformNames } from '../posts/PlatformCaptions';
import { referenceErrorCode, referenceErrorMessage } from '../posts/references/referenceErrors';
import { HubConfirmDialog } from '../ui/HubConfirmDialog';
import { HubDialog } from '../ui/HubDialog';
import { ReferenceViewer } from '../posts/references/ReferenceViewer';
import type { ReferenceItem } from '../../types/postReferences';
import { MaterialItemRow } from './MaterialItemRow';

interface MaterialRequestDialogProps {
  token: string;
  entry: HubMaterialRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The request left the open list while the dialog was up (auto-completed by an upload, closed
   * by the team or after `request_closed`). The host keeps the last entry; uploads stop here.
   */
  closed?: boolean;
  /** Off when opened from the post itself: "Ver post" would lead back to where the client is. */
  showViewPost?: boolean;
}

const KNOWN_PLATFORMS: readonly string[] = ['instagram', 'tiktok', 'geral'];

/** The items the team asked for on one post, each with its own "Enviar". */
export function MaterialRequestDialog({ open, ...props }: MaterialRequestDialogProps) {
  if (!open) return null;
  // Keyed by post: the upload queue and the tab state belong to one request.
  return <DialogBody key={props.entry.post_id} {...props} />;
}

type Tab = 'itens' | 'historico';

function DialogBody({
  token,
  entry,
  onOpenChange,
  closed = false,
  showViewPost = true,
}: Omit<MaterialRequestDialogProps, 'open'>) {
  const { t, i18n } = useTranslation('hubMaterial');
  const tRoot = useTranslation().t;
  const { t: tPosts } = useTranslation('hubPosts');
  const { workspace } = useHub();
  const qc = useQueryClient();
  const platformNames = usePlatformNames();
  const refs = usePostReferences(token, entry.post_id);
  const [tab, setTab] = useState<Tab>('itens');
  const [historyVisited, setHistoryVisited] = useState(false);
  const [historyDirty, setHistoryDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [viewerItem, setViewerItem] = useState<ReferenceItem | null>(null);
  // Unsaved note edits on item files, by reference id (same tracking as the Referências tab).
  const dirtyNotes = useRef(new Set<number>());
  const [notesDirty, setNotesDirty] = useState(false);
  const handleNoteDirty = useCallback((id: number, dirty: boolean) => {
    if (dirty) dirtyNotes.current.add(id);
    else dirtyNotes.current.delete(id);
    setNotesDirty(dirtyNotes.current.size > 0);
  }, []);
  const { data: postsData } = useQuery({
    ...hubPostsQuery(token),
    enabled: entry.client_visible,
  });

  useUnsavedWork(refs.uploadsInFlight || closing || historyDirty || notesDirty);

  const items = entry.request.items;
  const total = items.length;
  const filesFor = (itemId: number) =>
    refs.data
      ? refs.items.filter((r) => r.material_item_id === itemId)
      : (entry.files_by_item[itemId] ?? []);
  // The per-post list moves first (an upload lands there at once); the requests list follows
  // after the invalidation below. Before the list loads, trust the server's `done`.
  const isDone = (itemId: number, serverDone: boolean) =>
    refs.data ? filesFor(itemId).length > 0 : serverDone;
  const done = items.filter((i) => isDone(i.id, i.done)).length;
  const inFlight = refs.uploads.filter((u) => u.status === 'uploading').length;
  const atCap = refs.items.length + inFlight >= MAX_REFERENCES_PER_POST;

  const invalidateRequests = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [HUB_MATERIAL_KEY, token] });
  }, [qc, token]);
  // Removing an item's last file can reopen or change the request: reread it either way.
  const removeFile = useCallback(
    async (id: number) => {
      try {
        await refs.remove(id);
      } finally {
        invalidateRequests();
      }
    },
    [refs, invalidateRequests],
  );

  const requestClose = () => {
    if (closing) return;
    if (refs.uploadsInFlight && !window.confirm(t('dialogo.saindoComEnvio'))) return;
    if (
      (historyDirty || notesDirty) &&
      !window.confirm(
        tPosts('shared.discardCorrectionConfirm', 'Descartar as alterações não enviadas?'),
      )
    ) {
      return;
    }
    onOpenChange(false);
  };

  async function confirmClose() {
    setConfirming(false);
    setClosing(true);
    setCloseError(null);
    try {
      await closeMaterialRequest(token, entry.post_id);
      void qc.invalidateQueries({ queryKey: [HUB_MATERIAL_KEY, token] });
      void qc.invalidateQueries({ queryKey: postReferencesKey(entry.post_id) });
      toast(t('dialogo.avisada'));
      onOpenChange(false);
    } catch (err) {
      const code = referenceErrorCode(err);
      setCloseError(referenceErrorMessage(code, tPosts));
      if (code === 'request_closed' || code === 'not_found') invalidateRequests();
    } finally {
      setClosing(false);
    }
  }

  const date = shortDate(entry.scheduled_at, i18n.language);
  const platform =
    entry.platform && KNOWN_PLATFORMS.includes(entry.platform)
      ? platformNames([entry.platform as PlatformId])
      : null;
  const postHref = `/${workspace}/hub/${compactHubToken(token)}/postagens/${entry.post_id}`;
  const historyPost = postsData?.posts.find((p) => p.id === entry.post_id) ?? null;
  // Opened from the post itself, a client-visible post has nothing to put on the left.
  const hasLeftPane = !entry.client_visible || showViewPost;
  const tabs: Tab[] = entry.client_visible ? ['itens', 'historico'] : ['itens'];
  const viewPostLink = showViewPost && entry.client_visible && (
    <Link
      to={postHref}
      className="inline-flex items-center gap-1.5 text-[13px] font-semibold hub-txt underline-offset-2 hover:underline"
    >
      {t('dialogo.verPost')}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );

  return (
    <HubDialog open onRequestClose={requestClose} title={entry.titulo}>
      <div
        className={`hub-bg-card w-full h-full md:h-[min(720px,calc(100dvh-3rem))] md:rounded-[4px] overflow-hidden shadow-2xl flex ${hasLeftPane ? 'md:w-[min(1040px,calc(100vw-3rem))] md:grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]' : 'md:w-[min(560px,calc(100vw-3rem))]'}`}
      >
        {hasLeftPane && (
          <div className="hidden md:flex items-center justify-center p-10 hub-bg-soft">
            {entry.client_visible ? (
              viewPostLink
            ) : (
              <div className="flex max-w-[300px] flex-col items-center gap-3 text-center">
                <span
                  className="flex h-14 w-14 items-center justify-center rounded-full hub-bg-card hub-tx2"
                  style={{ boxShadow: 'inset 0 0 0 1px var(--hub-bd)' }}
                >
                  <FolderUp size={24} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="font-display text-[17px] hub-txt">{t('dialogo.emProducao')}</span>
                <span className="text-[13px] leading-[1.5] hub-tx2">
                  {t('dialogo.emProducaoTexto')}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto md:contents">
            <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b hub-border">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <h3 className="font-display text-[19px] md:text-[18px] leading-[1.15] hub-txt">
                  {entry.titulo}
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusPill tone="accent" semantic="wait">
                    {t('pill')}
                  </StatusPill>
                  <StatusPill tone="neutral">{getTipoLabel(tRoot, entry.tipo)}</StatusPill>
                  {platform && <StatusPill tone="neutral">{platform}</StatusPill>}
                  {date && <StatusPill tone="neutral">{date}</StatusPill>}
                </div>
                {viewPostLink && <span className="md:hidden">{viewPostLink}</span>}
              </div>
              <button
                type="button"
                onClick={requestClose}
                aria-label={t('dialogo.fechar')}
                className="flex h-9 w-9 md:h-8 md:w-8 shrink-0 items-center justify-center rounded-full hub-bg-soft hub-tx2"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="mx-4 mt-3.5 flex items-center justify-between gap-3">
              <span className="flex items-center gap-[7px] text-[13.5px] md:text-[13px] font-semibold hub-txt">
                <FolderUp size={15} aria-hidden="true" className="hidden md:block" />
                {total === 1 ? t('dialogo.precisa.um') : t('dialogo.precisa.varios', { n: total })}
              </span>
              <span className="text-[12.5px] md:text-[12px] font-semibold hub-tx2">
                {t('dialogo.enviados', { done, total })}
              </span>
            </div>
            <span
              role="progressbar"
              aria-label={t('progressoRotulo', { done, total })}
              aria-valuenow={done}
              aria-valuemin={0}
              aria-valuemax={total}
              className="mx-4 mt-2 block h-1 overflow-hidden rounded-full"
              style={{ background: 'var(--hub-soft)' }}
            >
              <span
                className="block h-full"
                style={{
                  width: total > 0 ? `${Math.round((done / total) * 100)}%` : '0%',
                  background: 'var(--hub-txt)',
                }}
              />
            </span>

            <div
              role="tablist"
              className="sticky top-0 z-10 hub-bg-card md:static mt-2 flex gap-5 px-4 border-b hub-border"
            >
              {tabs.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => {
                    if (key === 'historico') setHistoryVisited(true);
                    setTab(key);
                  }}
                  className={`py-2.5 text-[12px] font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === key ? 'hub-txt border-[var(--hub-txt)]' : 'hub-tx3 border-transparent'}`}
                >
                  {key === 'itens' ? (
                    <span className="inline-flex items-center gap-1.5">
                      {t('dialogo.abaItens')}
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full hub-bg-soft hub-tx2 text-[11px] leading-[18px] text-center tabular-nums">
                        {total}
                      </span>
                    </span>
                  ) : (
                    t('dialogo.abaHistorico')
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {/* `hidden` on a bare div: a display utility next to it would override it. */}
              <div hidden={tab !== 'itens'}>
                <div className="flex flex-col gap-3">
                  <ul className="flex flex-col overflow-hidden rounded-xl border hub-border">
                    {items.map((item) => (
                      <MaterialItemRow
                        key={item.id}
                        item={item}
                        files={filesFor(item.id)}
                        uploads={refs.uploads
                          .filter((u) => u.materialItemId === item.id)
                          // On a draft the handler's own gate says post_not_pending once the
                          // request closes; for an item that only ever means the same thing.
                          .map((u) =>
                            u.error === 'post_not_pending' ? { ...u, error: 'request_closed' } : u,
                          )}
                        done={isDone(item.id, item.done)}
                        refs={refs}
                        disabled={atCap || closed}
                        onAdded={invalidateRequests}
                        onOpenFile={setViewerItem}
                        onRemoveFile={removeFile}
                        onNoteDirtyChange={handleNoteDirty}
                        onOverlayChange={noop}
                      />
                    ))}
                  </ul>
                  {atCap && !closed && (
                    <p role="status" className="text-[12.5px] font-medium hub-txt">
                      {t('dialogo.limite10')}
                    </p>
                  )}
                  <p className="text-[12px] hub-tx3">{t('dialogo.limites')}</p>
                </div>
              </div>
              {entry.client_visible && historyVisited && (
                <div hidden={tab !== 'historico'}>
                  {historyPost ? (
                    <PostHistoryPanel
                      post={historyPost}
                      token={token}
                      approvals={postsData?.postApprovals ?? []}
                      onDirtyChange={setHistoryDirty}
                      references={refs.items}
                      embedded
                    />
                  ) : (
                    <div className="flex flex-col items-start gap-2 text-[13px] hub-tx2">
                      <p>{t('dialogo.historicoNoPost')}</p>
                      {showViewPost && (
                        <Link
                          to={postHref}
                          className="inline-flex items-center gap-1.5 font-semibold hub-txt hover:underline underline-offset-2"
                        >
                          {t('dialogo.verPost')}
                          <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3 px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-3 border-t hub-border hub-bg-soft">
            {closed ? (
              <>
                <p
                  role="status"
                  className="flex-1 text-center md:text-left text-[13px] font-semibold leading-[1.4] hub-txt"
                >
                  {done === total ? t('dialogo.tudoEnviado') : t('dialogo.encerrado')}
                </p>
                <button
                  type="button"
                  onClick={requestClose}
                  className="inline-flex items-center justify-center hub-btn-secondary rounded-[4px] px-4 min-h-[44px] text-[13px] font-semibold"
                >
                  {t('dialogo.fecharBotao')}
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-center md:text-left text-[12px] leading-[1.4] hub-tx2">
                  {total === 1 ? t('dialogo.rodape.um') : t('dialogo.rodape.varios', { n: total })}
                </span>
                {closeError && (
                  <p
                    role="alert"
                    className="text-[12.5px] font-medium text-rose-700 dark:text-rose-300"
                  >
                    {closeError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={done === 0 || closing}
                  className="inline-flex items-center justify-center gap-1.5 hub-btn-secondary rounded-[4px] px-4 min-h-[44px] text-[13px] font-semibold disabled:opacity-50"
                >
                  {t('dialogo.enviei')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <HubConfirmDialog
        open={confirming}
        title={t('dialogo.confirmarTitulo')}
        description={t('dialogo.confirmarDescricao', { done, total })}
        confirmLabel={t('dialogo.confirmar')}
        cancelLabel={t('dialogo.cancelar')}
        onConfirm={() => void confirmClose()}
        onCancel={() => setConfirming(false)}
      />
      {viewerItem && <ReferenceViewer item={viewerItem} onClose={() => setViewerItem(null)} />}
    </HubDialog>
  );
}

function noop() {}
