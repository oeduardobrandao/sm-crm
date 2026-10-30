import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MediaUnavailable } from '@/components/MediaUnavailable';
import { captureFrameFromElement } from '@mesaas/ui/video/frame';
import { encodeImageAsJpeg } from '../../../utils/imageJpeg';
import { updateVideoThumbnail } from '../../../services/postMedia';
import type { PostMedia } from '../../../store';
import { BottomSheet } from '@/components/mobile';
import { mediaPreviewAspect, videoCoverDescription, videoCoverState } from '../videoCover';

interface ThumbnailPickerDialogProps {
  /** Video link to edit, or null when closed. Pass the freshest object you
   * have (signed URLs expire in ~15min) — the gallery derives it from the
   * live query cache at open time. */
  media: PostMedia | null;
  onClose: () => void;
  /** Called after a successful save, before closing. The gallery uses this to
   * invalidate ['post-media', postId] and ['workflow-covers']. */
  onUpdated: () => void;
  /** `phone`: a bottom sheet (C0bMiniatura mockup) with Cancelar / Salvar in its header. */
  layout?: 'default' | 'phone';
}

export function ThumbnailPickerDialog({
  media,
  onClose,
  onUpdated,
  layout = 'default',
}: ThumbnailPickerDialogProps) {
  const { t } = useTranslation('posts');
  const { t: tc } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  // The moment the pending thumbnail was captured from (TikTok's cover); null for an
  // uploaded image, which TikTok can't use as a cover.
  const [pendingFrameMs, setPendingFrameMs] = useState<number | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    };
  }, [pendingUrl]);

  // Reset choice when the dialog opens for a different video.
  useEffect(() => {
    setPending(null);
    setPendingFrameMs(null);
    setPendingUrl(null);
    setSaving(false);
  }, [media?.id]);

  function choosePending(file: File, frameMs: number | null) {
    setPending(file);
    setPendingFrameMs(frameMs);
    setPendingUrl(URL.createObjectURL(file));
  }

  async function handleCapture() {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.pause();
      const frameMs = Math.max(0, Math.round(video.currentTime * 1000));
      choosePending(await captureFrameFromElement(video), frameMs);
    } catch {
      toast.error(t('thumbnailEditor.captureError'));
    }
  }

  async function handleSave() {
    if (!media || !pending) return;
    setSaving(true);
    try {
      await updateVideoThumbnail(media.id, pending, pendingFrameMs);
      toast.success(t('thumbnailEditor.updated'));
      onUpdated();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const aspect = media ? mediaPreviewAspect(media) : 1;
  const previewAspect = String(aspect);
  // Portrait previews are sized by height, landscape ones by the column width.
  const previewSize = aspect < 1 ? 'h-40 w-auto max-w-full' : 'w-full';
  const body = (
    <>
      {media && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground" data-testid="video-cover-current">
            {t('videoCover.current', {
              description: videoCoverDescription(videoCoverState(media)),
            })}
          </p>
          {media.media_lost_at ? (
            <MediaUnavailable size="full" className="w-full aspect-video rounded-xl" />
          ) : (
            <video
              ref={videoRef}
              src={media.url ?? undefined}
              poster={media.thumbnail_url ?? undefined}
              crossOrigin="anonymous"
              controls
              muted
              playsInline
              className="w-full max-h-64 rounded-xl bg-black"
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCapture}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-900 text-white text-[11px] font-semibold hover:bg-stone-700"
            >
              {t('thumbnailEditor.useFrame')}
            </button>
            <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-100 text-stone-700 text-[11px] font-semibold cursor-pointer hover:bg-stone-200">
              {t('thumbnailEditor.uploadImage')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    choosePending(await encodeImageAsJpeg(f), null);
                  } catch {
                    toast.error(t('thumbnailEditor.imageError'));
                  }
                }}
              />
            </label>
          </div>
          <div className="flex gap-3">
            {media.thumbnail_url && (
              <figure className="flex-1 min-w-0">
                <img
                  src={media.thumbnail_url}
                  alt={t('thumbnailEditor.current')}
                  style={{ aspectRatio: previewAspect }}
                  className={`${previewSize} object-cover rounded-lg ring-1 ring-stone-200/80`}
                />
                <figcaption className="mt-1 text-[11px] text-stone-500">
                  {t('thumbnailEditor.current')}
                </figcaption>
              </figure>
            )}
            {pendingUrl && (
              <figure className="flex-1 min-w-0">
                <img
                  src={pendingUrl}
                  alt={t('thumbnailEditor.preview')}
                  style={{ aspectRatio: previewAspect }}
                  className={`${previewSize} object-cover rounded-lg ring-2 ring-[#eab308]`}
                />
                <figcaption className="mt-1 text-[11px] font-semibold text-stone-700">
                  {t('thumbnailEditor.preview')}
                </figcaption>
              </figure>
            )}
          </div>
        </div>
      )}
      {media && (pendingUrl || media.thumbnail_url) && (
        <div className="rounded-lg border p-3">
          <p className="mb-2 text-xs font-semibold">{t('thumbnailEditor.instagramPreview')}</p>
          <div className="flex items-start gap-4">
            <figure className="w-20">
              <img
                src={pendingUrl ?? media.thumbnail_url ?? undefined}
                alt={t('thumbnailEditor.reelCoverAlt')}
                className="aspect-[9/16] w-full rounded-md object-cover"
              />
              <figcaption className="mt-1 text-[11px] text-muted-foreground">
                {t('thumbnailEditor.reelCaption')}
              </figcaption>
            </figure>
            <figure className="w-20">
              <img
                src={pendingUrl ?? media.thumbnail_url ?? undefined}
                alt={t('thumbnailEditor.feedCropAlt')}
                className="aspect-square w-full rounded-md object-cover"
              />
              <figcaption className="mt-1 text-[11px] text-muted-foreground">
                {t('thumbnailEditor.feedCaption')}
              </figcaption>
            </figure>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t('thumbnailEditor.centerCropHint')}
          </p>
        </div>
      )}
    </>
  );

  if (layout === 'phone') {
    return (
      <BottomSheet
        open={media !== null}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={t('thumbnailEditor.title')}
        description={t('thumbnailEditor.disclaimer')}
        headerLeading={
          <button type="button" className="phone-sheet-text-button" onClick={onClose}>
            {tc('actions.cancel')}
          </button>
        }
        headerTrailing={
          <button
            type="button"
            className="phone-sheet-text-button phone-sheet-text-button--primary"
            disabled={!pending || saving}
            onClick={handleSave}
          >
            {saving ? t('thumbnailEditor.saving') : 'Salvar'}
          </button>
        }
      >
        <p className="phone-sheet-note">{t('thumbnailEditor.disclaimer')}</p>
        <div className="phone-thumbnail-body">{body}</div>
      </BottomSheet>
    );
  }

  return (
    <Dialog
      open={media !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {/* z-[9005] keeps the dialog above the WorkflowDrawer (panel z-index 9001),
          matching the PostMediaLightbox convention. */}
      <DialogContent className="max-w-lg overflow-y-auto z-[9005]" overlayClassName="z-[9005]">
        <DialogHeader>
          <DialogTitle>{t('thumbnailEditor.title')}</DialogTitle>
          <DialogDescription>{t('thumbnailEditor.disclaimer')}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-stone-600 hover:bg-stone-100"
          >
            {tc('actions.cancel')}
          </button>
          <button
            type="button"
            disabled={!pending || saving}
            onClick={handleSave}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {saving ? t('thumbnailEditor.saving') : t('thumbnailEditor.save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
