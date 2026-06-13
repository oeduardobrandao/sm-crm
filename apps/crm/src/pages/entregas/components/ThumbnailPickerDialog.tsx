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
import { captureFrameFromElement } from '../../../utils/videoFrame';
import { updateVideoThumbnail } from '../../../services/postMedia';
import type { PostMedia } from '../../../store';

interface ThumbnailPickerDialogProps {
  /** Video link to edit, or null when closed. Pass the freshest object you
   * have (signed URLs expire in ~15min) — the gallery derives it from the
   * live query cache at open time. */
  media: PostMedia | null;
  onClose: () => void;
  /** Called after a successful save, before closing. The gallery uses this to
   * invalidate ['post-media', postId] and ['workflow-covers']. */
  onUpdated: () => void;
}

export function ThumbnailPickerDialog({ media, onClose, onUpdated }: ThumbnailPickerDialogProps) {
  const { t } = useTranslation('posts');
  const { t: tc } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pending, setPending] = useState<File | null>(null);
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
    setPendingUrl(null);
    setSaving(false);
  }, [media?.id]);

  function choosePending(file: File) {
    setPending(file);
    setPendingUrl(URL.createObjectURL(file));
  }

  async function handleCapture() {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.pause();
      choosePending(await captureFrameFromElement(video));
    } catch {
      toast.error(t('thumbnailEditor.captureError'));
    }
  }

  async function handleSave() {
    if (!media || !pending) return;
    setSaving(true);
    try {
      await updateVideoThumbnail(media.id, pending);
      toast.success(t('thumbnailEditor.updated'));
      onUpdated();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
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
      <DialogContent className="max-w-lg z-[9005]" overlayClassName="z-[9005]">
        <DialogHeader>
          <DialogTitle>{t('thumbnailEditor.title')}</DialogTitle>
          <DialogDescription>{t('thumbnailEditor.disclaimer')}</DialogDescription>
        </DialogHeader>
        {media && (
          <div className="space-y-3">
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
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) choosePending(f);
                    e.target.value = '';
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
                    className="w-full aspect-video object-cover rounded-lg ring-1 ring-stone-200/80"
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
                    className="w-full aspect-video object-cover rounded-lg ring-2 ring-[#eab308]"
                  />
                  <figcaption className="mt-1 text-[11px] font-semibold text-stone-700">
                    {t('thumbnailEditor.preview')}
                  </figcaption>
                </figure>
              )}
            </div>
          </div>
        )}
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
