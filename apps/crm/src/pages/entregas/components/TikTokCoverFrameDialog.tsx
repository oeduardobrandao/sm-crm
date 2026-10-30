import { useEffect, useRef, useState } from 'react';
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
import { BottomSheet } from '@/components/mobile';
import type { PostMedia } from '../../../store';

/** TikTok's own default cover frame when `video_cover_timestamp_ms` is omitted. */
export const TIKTOK_DEFAULT_COVER_MS = 1000;

/** `m:ss.s` for a cover timestamp in milliseconds. */
export function formatCoverTimestamp(ms: number): string {
  const totalTenths = Math.floor(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

/** The playhead as a timestamp TikTok accepts: an integer strictly inside the video. */
export function coverMsFromPlayhead(currentTime: number, duration: number): number {
  const ms = Math.max(0, Math.round(currentTime * 1000));
  if (!Number.isFinite(duration) || duration <= 0) return ms;
  return Math.min(ms, Math.max(0, Math.floor(duration * 1000) - 1));
}

interface TikTokCoverFrameDialogProps {
  /** Video to pick from, or null when closed. */
  media: PostMedia | null;
  /** Saved `video_cover_timestamp_ms`; undefined when TikTok's default applies. */
  valueMs: number | undefined;
  onClose: () => void;
  /** A timestamp in ms, or `undefined` to go back to TikTok's default frame. */
  onSave: (ms: number | undefined) => void;
  layout?: 'default' | 'phone';
}

/**
 * Frame picker for the TikTok cover. Same flow as ThumbnailPickerDialog (scrub the video,
 * use the current frame), but TikTok's API only takes a frame offset, not an image
 * (`post_info.video_cover_timestamp_ms`), so this saves the playhead position into
 * tiktok_settings instead of uploading a capture. No custom-image upload for that reason.
 */
export function TikTokCoverFrameDialog({
  media,
  valueMs,
  onClose,
  onSave,
  layout = 'default',
}: TikTokCoverFrameDialogProps) {
  const { t } = useTranslation('posts');
  const { t: tc } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playheadMs, setPlayheadMs] = useState(valueMs ?? TIKTOK_DEFAULT_COVER_MS);

  useEffect(() => {
    setPlayheadMs(valueMs ?? TIKTOK_DEFAULT_COVER_MS);
  }, [media?.id, valueMs]);

  function readPlayhead() {
    const video = videoRef.current;
    if (!video) return;
    setPlayheadMs(coverMsFromPlayhead(video.currentTime, video.duration));
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime =
      coverMsFromPlayhead((valueMs ?? TIKTOK_DEFAULT_COVER_MS) / 1000, video.duration) / 1000;
  }

  function handleUseFrame() {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    onSave(coverMsFromPlayhead(video.currentTime, video.duration));
    onClose();
  }

  function handleUseDefault() {
    onSave(undefined);
    onClose();
  }

  const lost = !!media?.media_lost_at;

  const body = media && (
    <div className="space-y-3">
      {lost ? (
        <MediaUnavailable size="full" className="w-full aspect-[9/16] max-h-80 rounded-xl" />
      ) : (
        <video
          ref={videoRef}
          src={media.url ?? undefined}
          poster={media.thumbnail_url ?? undefined}
          controls
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={readPlayhead}
          onSeeked={readPlayhead}
          className="w-full max-h-80 rounded-xl bg-black"
        />
      )}
      <p className="text-[11px] text-muted-foreground">
        {t('tiktokCover.playhead', { time: formatCoverTimestamp(playheadMs) })}
      </p>
    </div>
  );

  const useDefaultButton = (
    <button
      type="button"
      onClick={handleUseDefault}
      disabled={valueMs === undefined}
      className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50"
    >
      {t('tiktokCover.useDefault')}
    </button>
  );

  if (layout === 'phone') {
    return (
      <BottomSheet
        open={media !== null}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={t('tiktokCover.title')}
        description={t('tiktokCover.disclaimer')}
        headerLeading={
          <button type="button" className="phone-sheet-text-button" onClick={onClose}>
            {tc('actions.cancel')}
          </button>
        }
        headerTrailing={
          <button
            type="button"
            className="phone-sheet-text-button phone-sheet-text-button--primary"
            disabled={lost}
            onClick={handleUseFrame}
          >
            {t('tiktokCover.useFrame')}
          </button>
        }
      >
        <p className="phone-sheet-note">{t('tiktokCover.disclaimer')}</p>
        <div className="phone-thumbnail-body">
          {body}
          <div className="mt-3">{useDefaultButton}</div>
        </div>
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
          matching ThumbnailPickerDialog. */}
      <DialogContent className="max-w-lg overflow-y-auto z-[9005]" overlayClassName="z-[9005]">
        <DialogHeader>
          <DialogTitle>{t('tiktokCover.title')}</DialogTitle>
          <DialogDescription>{t('tiktokCover.disclaimer')}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter className="sm:justify-between">
          {useDefaultButton}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-stone-600 hover:bg-stone-100"
            >
              {tc('actions.cancel')}
            </button>
            <button
              type="button"
              disabled={lost}
              onClick={handleUseFrame}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50"
            >
              {t('tiktokCover.useFrame')}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
