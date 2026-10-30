import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { extractVideoFrameWithTime } from '@mesaas/ui/video/frame';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { captureEvent } from '@/lib/analytics';
import type { PostMedia } from '@/store';
import { replacePostMedia } from '@/services/mediaAdjustment';
import { fetchWithRetry } from '@/utils/fetchWithRetry';
import { encodeImageAsJpeg } from '@/utils/imageJpeg';
import { planDownscale } from '../media-editor/downscalePlan';
import { videoMaxBytes } from '../media-editor/oversize';
import { fetchMediaFile } from '../media-editor/fetchMediaFile';

type Stage = 'download' | 'convert' | 'save';
const STAGES: Stage[] = ['download', 'convert', 'save'];

interface Props {
  media: PostMedia | null;
  forStories: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/** The replacement keeps the current thumbnail (and so its TikTok cover frame); only when
 * that can't be fetched is a new frame taken from the downscaled video. */
async function thumbnailFor(
  media: PostMedia,
  output: File,
  signal: AbortSignal,
): Promise<{ file: File; frameMs: number | null }> {
  const url = media.thumbnail_url;
  try {
    if (!url) throw new Error('no thumbnail');
    const res = await fetchWithRetry(url, { signal });
    const blob = await res.blob();
    const file = await encodeImageAsJpeg(
      new File([blob], 'cover', { type: blob.type || 'image/jpeg' }),
    );
    return { file, frameMs: media.thumbnail_frame_ms ?? null };
  } catch {
    signal.throwIfAborted();
    const frame = await extractVideoFrameWithTime(output);
    return { file: frame.file, frameMs: Math.round(frame.timeSeconds * 1000) };
  }
}

export function DownscaleMediaDialog({ media, forStories, onOpenChange, onDone }: Props) {
  const { t } = useTranslation('posts');
  const [stage, setStage] = useState<Stage>('download');
  const [pct, setPct] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const callbacks = useRef({ onOpenChange, onDone });
  callbacks.current = { onOpenChange, onDone };

  const plan =
    media?.width && media.height && media.duration_seconds
      ? planDownscale(
          {
            width: media.width,
            height: media.height,
            sizeBytes: media.size_bytes,
            durationSeconds: media.duration_seconds,
          },
          { maxBytes: videoMaxBytes(forStories) },
        )
      : null;

  useEffect(() => {
    if (!media) return;
    const ctl = new AbortController();
    controller.current = ctl;
    const startedAt = Date.now();
    setStage('download');
    setPct(0);
    const base = {
      source: 'warning',
      input_w: media.width,
      input_h: media.height,
      input_mb: Math.round(media.size_bytes / 1048576),
      duration_s: media.duration_seconds,
    };
    const report = (outcome: string, extra: Record<string, unknown> = {}) =>
      captureEvent('video_downscaled', {
        ...base,
        ...extra,
        outcome,
        ms: Date.now() - startedAt,
      });
    let saveAttempted = false;
    let timedOut = false;

    void trackUnsavedWork(
      (async () => {
        if (!plan || !media.url) {
          report('unsupported');
          toast.error(
            t('mediaGallery.downscale.convertFailedNoFallback', { name: media.original_filename }),
          );
          callbacks.current.onOpenChange(false);
          return;
        }
        let result: Awaited<
          ReturnType<(typeof import('../media-editor/downscaleVideo'))['downscaleVideo']>
        >;
        let output: File;
        try {
          const timer = setTimeout(() => {
            timedOut = true;
            ctl.abort();
          }, 120_000);
          let file: File;
          try {
            file = await fetchMediaFile(
              media.url,
              media.original_filename,
              media.mime_type,
              ctl.signal,
              setPct,
            );
          } finally {
            clearTimeout(timer);
          }
          ctl.signal.throwIfAborted();
          setStage('convert');
          setPct(0);
          const { downscaleVideo } = await import('../media-editor/downscaleVideo');
          ctl.signal.throwIfAborted();
          result = await downscaleVideo(file, plan, {
            forStories,
            signal: ctl.signal,
            onProgress: setPct,
          });
          output = result.file;
          ctl.signal.throwIfAborted();
        } catch (e) {
          if (!timedOut && (ctl.signal.aborted || isAbort(e))) {
            report('cancelled');
            return;
          }
          report(e instanceof Error && e.name === 'EngineUnavailable' ? 'unsupported' : 'error');
          toast.error(
            t('mediaGallery.downscale.convertFailedNoFallback', { name: media.original_filename }),
          );
          callbacks.current.onOpenChange(false);
          return;
        }
        const extra = {
          engine: result.engine,
          hdr: result.hdr,
          output_w: result.width,
          output_h: result.height,
          output_mb: Math.round(output.size / 1048576),
        };
        try {
          const thumbnail = await thumbnailFor(media, output, ctl.signal);
          ctl.signal.throwIfAborted();
          setStage('save');
          setPct(0);
          saveAttempted = true;
          await replacePostMedia(
            media,
            output,
            thumbnail.file,
            (p) => {
              if (!ctl.signal.aborted) setPct(Math.round((p.loaded / p.total) * 100));
            },
            ctl.signal,
            thumbnail.frameMs,
          );
          report('ok', extra);
          toast.success(t('mediaGallery.downscale.done', { w: result.width, h: result.height }));
          callbacks.current.onDone();
          callbacks.current.onOpenChange(false);
        } catch (e) {
          // The server may have received the replace before we aborted: reconcile.
          if (saveAttempted) callbacks.current.onDone();
          if (ctl.signal.aborted || isAbort(e)) {
            report('cancelled', extra);
            return;
          }
          report('error', extra);
          toast.error(t('mediaGallery.downscale.replaceOrphan'));
          callbacks.current.onOpenChange(false);
        }
      })(),
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media?.id, forStories]);

  if (!media) return <></>;
  const saving = stage === 'save';
  const stageLabel: Record<Stage, string> = {
    download: t('mediaGallery.downscale.stageDownload'),
    convert: t('mediaGallery.downscale.stageConvert'),
    save: t('mediaGallery.downscale.stageSave'),
  };
  const current = STAGES.indexOf(stage);

  function requestClose() {
    if (saving) return;
    controller.current?.abort();
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent confirmClose className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('mediaGallery.downscale.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {media.original_filename} · {media.width}×{media.height}
            {plan ? ` → ${plan.width}×${plan.height}` : ''}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {STAGES.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s} className="space-y-2">
                <div
                  className={`flex items-center gap-2 text-sm ${active ? 'font-semibold' : 'text-muted-foreground'}`}
                >
                  {done ? (
                    <Check size={16} aria-hidden />
                  ) : active ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                  ) : (
                    <Circle size={16} aria-hidden />
                  )}
                  <span>{stageLabel[s]}</span>
                  {active && <span className="ml-auto tabular-nums">{pct}%</span>}
                </div>
                {active && <Progress value={pct} aria-label={stageLabel[s]} />}
              </li>
            );
          })}
        </ul>
        {!saving && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={requestClose}
              className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              {t('mediaGallery.downscale.cancel')}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
