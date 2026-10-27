import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { captureEvent } from '@/lib/analytics';
import { planDownscale, type DownscaleSupport } from '../media-editor/downscalePlan';
import { oversizeOnly, probeWithTimeout, videoMaxBytes } from '../media-editor/oversize';
import { DownscaleOfferDialog, type DownscaleOfferItem } from './DownscaleOfferDialog';

/** Mirror of MAX_VIDEO_SIZE in services/postMedia (validateFile's client cap). */
const CLIENT_CAP_BYTES = 2 * 1024 * 1024 * 1024;

export type UploadItem = { file: File; uid: string; sortOrder: number };
export type UploadOutcome = 'ok' | 'deferred' | 'error';
type Decision = 'reduce' | 'original' | 'dismiss';
type HeldItem = UploadItem & { offer: DownscaleOfferItem };

/** Stats a held-back batch adds to the gallery's single "Upload concluído" decision. */
export type HeldStats = { attempted: number; deferred: number; hasError: boolean };

interface Deps {
  forStories: boolean;
  /** Same per-file path as the immediate batch: thumbnail, manual-thumbnail fallback, upload. */
  upload: (item: UploadItem) => Promise<UploadOutcome>;
  /** Shows / updates a queue row as "Convertendo… N%"; null removes it. */
  setConverting: (item: UploadItem, pct: number | null) => void;
}

const mb = (bytes: number) => Math.round(bytes / 1048576);

/**
 * Oversized-video offer at file selection (spec "UX" A): probes the picked videos, holds back
 * those that only break the width/size limit, asks once for the whole held-back set, then
 * converts and uploads them one at a time.
 */
export function useDownscaleOffer({ forStories, upload, setConverting }: Deps) {
  const { t } = useTranslation('posts');
  const [items, setItems] = useState<DownscaleOfferItem[] | null>(null);
  const resolver = useRef<((d: Decision) => void) | null>(null);
  const support = useRef(new Map<string, DownscaleSupport>());
  const abort = useRef<AbortController | null>(null);

  // Unmounting mid-offer must not leave handleFiles waiting forever, nor a conversion running.
  useEffect(
    () => () => {
      resolver.current?.('dismiss');
      abort.current?.abort();
    },
    [],
  );

  function decide(d: Decision) {
    const resolve = resolver.current;
    resolver.current = null;
    setItems(null);
    resolve?.(d);
  }

  /** Splits a selection into files to upload now and oversize-only videos to hold back. */
  async function split(
    all: UploadItem[],
    existingCount: number,
  ): Promise<{ immediate: UploadItem[]; held: HeldItem[] }> {
    const isCarousel = !forStories && existingCount + all.length > 1;
    const probes = await Promise.all(
      all.map((it) => (it.file.type.startsWith('video/') ? probeWithTimeout(it.file) : null)),
    );
    const immediate: UploadItem[] = [];
    const held: HeldItem[] = [];
    all.forEach((it, i) => {
      const probe = probes[i];
      if (!probe) return void immediate.push(it);
      const { file } = it;
      const { eligible, reasons } = oversizeOnly(
        {
          id: i,
          kind: 'video',
          mime_type: file.type,
          size_bytes: file.size,
          width: probe.width,
          height: probe.height,
          duration_seconds: probe.duration_seconds,
        },
        { forStories, isCarousel },
      );
      if (!eligible) return void immediate.push(it);
      const plan = planDownscale(
        {
          width: probe.width,
          height: probe.height,
          sizeBytes: file.size,
          durationSeconds: probe.duration_seconds,
        },
        { maxBytes: videoMaxBytes(forStories) },
      );
      const overClientCap = file.size > CLIENT_CAP_BYTES;
      // Can be neither reduced nor sent: decided before the dialog, never offered.
      if (overClientCap && !plan) {
        toast.error(t('mediaGallery.downscale.convertFailedNoFallback', { name: file.name }));
        return;
      }
      held.push({
        ...it,
        offer: {
          key: it.uid,
          name: file.name,
          width: probe.width,
          height: probe.height,
          sizeBytes: file.size,
          plan,
          reasons,
          support: null,
          overClientCap,
        },
      });
    });
    return { immediate, held };
  }

  function ask(held: HeldItem[]): Promise<Decision> {
    support.current = new Map();
    setItems(held.map((h) => h.offer));
    const patch = (key: string, s: DownscaleSupport) => {
      support.current.set(key, s);
      setItems((prev) => prev?.map((o) => (o.key === key ? { ...o, support: s } : o)) ?? prev);
    };
    for (const h of held) {
      const plan = h.offer.plan;
      // Too long for the budget: nothing to inspect. A non-'none' placeholder keeps the
      // dialog from also printing the "browser can't reduce" note; plan === null already
      // stops the conversion.
      if (!plan) {
        patch(h.uid, { engine: 'webcodecs', hdr: false });
        continue;
      }
      void import('../media-editor/downscaleVideo')
        .then(({ inspectForDownscale }) => inspectForDownscale(h.file, plan))
        .catch((): DownscaleSupport => ({ engine: 'none', hdr: false }))
        .then((s) => patch(h.uid, s));
    }
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }

  async function processOne(h: HeldItem, decision: Decision): Promise<UploadOutcome | 'skipped'> {
    const { file, offer } = h;
    const skip = (message: string) => {
      toast.error(message);
      return 'skipped' as const;
    };
    const noFallback = () =>
      t('mediaGallery.downscale.convertFailedNoFallback', { name: file.name });
    const plan = offer.plan;
    const engine = support.current.get(h.uid)?.engine ?? 'none';
    if (decision === 'original' || !plan || engine === 'none') {
      if (offer.overClientCap)
        return skip(
          decision === 'original'
            ? `${file.name}: ${t('mediaGallery.downscale.overClientCap')}`
            : noFallback(),
        );
      return upload(h);
    }

    const startedAt = Date.now();
    const base = {
      source: 'upload',
      input_w: offer.width,
      input_h: offer.height,
      input_mb: mb(file.size),
      duration_s: plan.durationSeconds,
    };
    const ctl = new AbortController();
    abort.current = ctl;
    setConverting(h, 0);
    try {
      const { downscaleVideo } = await import('../media-editor/downscaleVideo');
      const result = await downscaleVideo(file, plan, {
        forStories,
        signal: ctl.signal,
        onProgress: (pct) => setConverting(h, pct),
      });
      captureEvent('video_downscaled', {
        ...base,
        engine: result.engine,
        hdr: result.hdr,
        output_w: result.width,
        output_h: result.height,
        output_mb: mb(result.file.size),
        outcome: 'ok',
        ms: Date.now() - startedAt,
      });
      return upload({ ...h, file: result.file });
    } catch (e) {
      const cancelled = ctl.signal.aborted;
      captureEvent('video_downscaled', {
        ...base,
        engine,
        outcome: cancelled
          ? 'cancelled'
          : e instanceof Error && e.name === 'EngineUnavailable'
            ? 'unsupported'
            : 'error',
        ms: Date.now() - startedAt,
      });
      if (cancelled) {
        setConverting(h, null);
        return 'skipped';
      }
      if (offer.overClientCap) {
        setConverting(h, null);
        return skip(noFallback());
      }
      toast.error(t('mediaGallery.downscale.convertFailed', { name: file.name }));
      return upload(h);
    } finally {
      if (abort.current === ctl) abort.current = null;
    }
  }

  /** Asks about the held-back files, then converts/uploads them one at a time. */
  async function resolveHeld(held: HeldItem[]): Promise<HeldStats> {
    const stats: HeldStats = { attempted: 0, deferred: 0, hasError: false };
    if (held.length === 0) return stats;
    const decision = await ask(held);
    if (decision === 'dismiss') return stats;
    for (const h of held) {
      const outcome = await trackUnsavedWork(processOne(h, decision));
      if (outcome === 'skipped') continue;
      stats.attempted++;
      if (outcome === 'deferred') stats.deferred++;
      if (outcome === 'error') stats.hasError = true;
    }
    return stats;
  }

  const dialog = (
    <DownscaleOfferDialog
      open={items !== null}
      items={items ?? []}
      onReduce={() => decide('reduce')}
      onSendOriginal={() => decide('original')}
      onDismiss={() => decide('dismiss')}
    />
  );

  return { split, resolveHeld, dialog };
}
