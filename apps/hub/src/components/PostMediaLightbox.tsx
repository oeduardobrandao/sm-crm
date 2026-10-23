import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { VideoPlayer } from '@mesaas/ui/VideoPlayer';
import { formatMoment } from '@mesaas/ui/mediaPins/geometry';
import type { HubMediaNote, HubPostMedia } from '../types';
import { MediaUnavailable } from './MediaUnavailable';
import { MediaPinLayer } from './posts/mediaNotes/MediaPinLayer';
import { MediaNoteComposer } from './posts/mediaNotes/MediaNoteComposer';

/** Px at the bottom of a video that the native controls keep for themselves. */
const CONTROLS_INSET_PX = 56;
/** Above the lightbox (z-[9005]) so the composer opened from it is not buried. */
const COMPOSER_LAYER = 'z-[9010]';

/**
 * A <video> with only max-width/max-height renders at its intrinsic resolution, and HLS
 * starts on a low rendition, so a vertical Reel opened at ~240x430 CSS px. Give it the
 * largest box that fits 90vw x 85vh at the stored aspect ratio; without stored dimensions
 * fill that box and let object-contain letterbox.
 */
function videoBoxStyle(m: HubPostMedia, maxVh = 85): React.CSSProperties {
  if (m.width && m.height) {
    return {
      width: `min(90vw, calc(${maxVh}vh * ${m.width} / ${m.height}))`,
      aspectRatio: `${m.width} / ${m.height}`,
    };
  }
  return { width: '90vw', height: `${maxVh}vh` };
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

interface NoteInput {
  link_id: number;
  t_seconds?: number;
  x?: number;
  y?: number;
  body: string;
}

/** What the open composer is about: a video moment, optionally with a spot. */
interface ComposerTarget {
  /** The item the note was started on: it keeps that link whatever the lightbox shows later. */
  linkId: number;
  t: number;
  point: { x: number; y: number } | null;
}

interface PostMediaLightboxProps {
  media: HubPostMedia[];
  initialIndex: number;
  onClose: () => void;
  /** Called on media load error (e.g. 403 from expired presigned URL) so parent can refetch. */
  onStaleUrl?: () => void;
  /** The post's media notes. Without it the lightbox shows no note UI at all. */
  notes?: HubMediaNote[];
  /** May the client add notes (post visible and not back in production). */
  canWrite?: boolean;
  onCreateNote?: (input: NoteInput) => Promise<void>;
  /** Seconds to seek the opening item to once its metadata is loaded. */
  initialSeek?: number;
  /** Reports the note composer opening/closing so the outer dialog stands down. */
  onOverlayChange?: (open: boolean) => void;
}

export function PostMediaLightbox({
  media,
  initialIndex,
  onClose,
  onStaleUrl,
  notes,
  canWrite = false,
  onCreateNote,
  initialSeek,
  onOverlayChange,
}: PostMediaLightboxProps) {
  const { t } = useTranslation('hubPostCard');
  const { t: tn } = useTranslation('hubPosts');
  const [idx, setIdx] = useState(initialIndex);
  const current = media[idx];
  const showNotes = notes !== undefined;
  const canCreate = showNotes && canWrite && !!onCreateNote;

  // The mounted <video> (VideoPlayer re-reports it when it recreates the element) and its clock.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  // Same element, for code that drives playback (the state value is read-only to React).
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    setVideoEl(el);
  }, []);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  // Placing a spot on a video is a mode the client turns on: otherwise the capture layer would
  // cover the frame and a tap meant for play would open the composer.
  const [markingSpot, setMarkingSpot] = useState(false);
  const composerOpenRef = useRef(false);
  composerOpenRef.current = composer !== null;
  const seekRef = useRef<number | undefined>(initialSeek);

  // Only notes mode reads the clock: the plain lightbox must not re-render on every timeupdate.
  useEffect(() => {
    if (!videoEl || !showNotes) {
      setTime(0);
      setDuration(0);
      return;
    }
    const sync = () => {
      setTime(videoEl.currentTime || 0);
      setDuration(Number.isFinite(videoEl.duration) ? videoEl.duration : 0);
    };
    sync();
    const events = ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked'];
    for (const e of events) videoEl.addEventListener(e, sync);
    return () => {
      for (const e of events) videoEl.removeEventListener(e, sync);
    };
  }, [videoEl, showNotes]);

  // initialSeek belongs to the item the lightbox opened on, not to wherever the user swipes.
  const seekTargetId = media[initialIndex]?.id;
  useEffect(() => {
    const el = videoRef.current;
    if (seekRef.current === undefined) return;
    // Swiped away before the seek happened: it is no longer meant for anything.
    if (current?.id !== seekTargetId) {
      seekRef.current = undefined;
      return;
    }
    if (!videoEl || !el) return;
    const apply = () => {
      if (seekRef.current === undefined) return;
      el.currentTime = seekRef.current;
      seekRef.current = undefined;
      setTime(el.currentTime || 0);
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener('loadedmetadata', apply, { once: true });
    return () => el.removeEventListener('loadedmetadata', apply);
  }, [videoEl, current?.id, seekTargetId]);

  function startMoment(point: { x: number; y: number } | null) {
    if (!current) return;
    videoRef.current?.pause();
    // The live clock (the label is throttled to timeupdate): the stored moment and the composer
    // title both come from this one read.
    const live = videoRef.current?.currentTime ?? time;
    setMarkingSpot(false);
    setPending(point);
    setComposer({ linkId: current.id, t: Math.round(live * 100) / 100, point });
  }
  function closeComposer() {
    setComposer(null);
    setPending(null);
  }
  function toggleMarkingSpot() {
    if (!markingSpot) videoRef.current?.pause();
    setMarkingSpot(!markingSpot);
  }
  async function submitNote(body: string) {
    if (!composer || !onCreateNote) return;
    await onCreateNote({
      link_id: composer.linkId,
      t_seconds: composer.t,
      ...(composer.point ? { x: composer.point.x, y: composer.point.y } : {}),
      body,
    });
    closeComposer();
  }

  const prev = useCallback(
    () => setIdx((i) => (i - 1 + media.length) % media.length),
    [media.length],
  );
  const next = useCallback(() => setIdx((i) => (i + 1) % media.length), [media.length]);
  // The mode belongs to the item it was turned on for.
  useEffect(() => {
    setMarkingSpot(false);
  }, [current?.id]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Preload adjacent images so navigation feels instant
  useEffect(() => {
    const toPreload = [(idx + 1) % media.length, (idx - 1 + media.length) % media.length];
    for (const i of toPreload) {
      if (i === idx) continue;
      const m = media[i];
      if (m?.kind === 'image' && m.url) {
        const img = new Image();
        img.src = m.url;
      }
    }
  }, [idx, media]);

  // Keys that arrived while the note composer was open. The composer's Radix dialog takes
  // Escape in the capture phase and React may flush its close before the bubble listener
  // runs, so "is the composer open" is sampled BEFORE Radix sees the key. (Not
  // `defaultPrevented`: the outer HubDialog preventDefaults Escape too, and the lightbox must
  // still close on it.) The set and the handlers live in refs so that the flush, which can hand
  // us a new `onClose` and re-render the parent, never swaps the listener (and the set) out
  // between the capture and bubble phases of the same key.
  const claimedByComposer = useRef(new WeakSet<Event>());
  const keyHandlers = useRef({ onClose, prev, next });
  keyHandlers.current = { onClose, prev, next };
  useEffect(() => {
    const onKeyCapture = (e: KeyboardEvent) => {
      if (composerOpenRef.current) claimedByComposer.current.add(e);
    };
    const onKey = (e: KeyboardEvent) => {
      if (claimedByComposer.current.has(e)) return;
      if (e.key === 'Escape') {
        keyHandlers.current.onClose();
        return;
      }
      // Arrows belong to the caret while typing.
      if (isEditable(e.target)) return;
      if (e.key === 'ArrowLeft') keyHandlers.current.prev();
      if (e.key === 'ArrowRight') keyHandlers.current.next();
    };
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Touch swipe: horizontal swipe > 50px advances; vertical-dominant gestures are ignored
  // so scrolling/pinching inside videos still works.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) next();
    else prev();
  };

  if (!current) return null;

  const noteMarkers =
    showNotes && current.kind === 'video'
      ? notes.filter(
          (n) =>
            n.link_id === current.id &&
            !n.is_previous_version &&
            n.t_seconds !== null &&
            duration > 0,
        )
      : [];
  const momentLabel = formatMoment(time);

  const videoNode = (
    <VideoPlayer
      key={current.id}
      hlsSrc={current.playback?.hls}
      src={current.url ?? ''}
      poster={current.thumbnail_url ?? undefined}
      controls
      preload="auto"
      onFatalError={() => onStaleUrl?.()}
      onVideoElement={onVideoElement}
      className={
        showNotes
          ? 'w-full h-full object-contain bg-black'
          : 'max-h-[85vh] max-w-[90vw] object-contain bg-black'
      }
      style={showNotes ? undefined : videoBoxStyle(current)}
    />
  );

  return createPortal(
    <>
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-[9005] pointer-events-auto flex items-center justify-center bg-black/90"
        onClick={onClose}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label={t('common:actions.close', 'Fechar')}
          className="fixed top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-colors ring-1 ring-white/20"
        >
          <X className="h-5 w-5" />
        </button>

        {media.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
              aria-label={t('lightbox.previous', 'Anterior')}
              className="fixed left-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-colors ring-1 ring-white/20"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
              aria-label={t('lightbox.next', 'Próxima')}
              className="fixed right-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-colors ring-1 ring-white/20"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        <div
          className="flex items-center justify-center max-h-[85vh] max-w-[90vw] touch-none"
          onClick={(e) => e.stopPropagation()}
        >
          {current.media_lost_at ? (
            <MediaUnavailable size="full" className="max-h-[85vh] max-w-[90vw] aspect-square" />
          ) : current.kind === 'image' ? (
            showNotes ? (
              // The wrapper hugs the rendered image, so the layer's box IS the picture.
              <div className="relative">
                <img
                  src={current.url ?? ''}
                  alt=""
                  draggable={false}
                  onError={() => onStaleUrl?.()}
                  className="block max-h-[85vh] max-w-[90vw] object-contain select-none"
                />
                <MediaPinLayer
                  notes={notes}
                  linkId={current.id}
                  naturalWidth={null}
                  naturalHeight={null}
                  placing={false}
                  pending={null}
                  onPlace={() => undefined}
                />
              </div>
            ) : (
              <img
                src={current.url ?? ''}
                alt=""
                draggable={false}
                onError={() => onStaleUrl?.()}
                className="max-h-[85vh] max-w-[90vw] object-contain select-none"
              />
            )
          ) : showNotes ? (
            <div
              className="flex flex-col gap-2"
              style={{ width: videoBoxStyle(current, 72).width }}
            >
              <div
                className="relative"
                style={{
                  aspectRatio: videoBoxStyle(current, 72).aspectRatio,
                  height: videoBoxStyle(current, 72).height,
                }}
              >
                {videoNode}
                <MediaPinLayer
                  notes={notes}
                  linkId={current.id}
                  currentTime={time}
                  naturalWidth={current.width}
                  naturalHeight={current.height}
                  placing={canCreate && markingSpot && composer === null}
                  pending={pending}
                  controlsInset={CONTROLS_INSET_PX}
                  onPlace={(p) => startMoment(p)}
                />
              </div>
              {duration > 0 && (
                <div className="relative h-6 w-full">
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/25" />
                  {noteMarkers.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      aria-label={tn('mediaNotes.marker', { time: formatMoment(n.t_seconds ?? 0) })}
                      onClick={() => {
                        if (!videoEl) return;
                        videoEl.currentTime = n.t_seconds ?? 0;
                        setTime(videoEl.currentTime || 0);
                      }}
                      style={{
                        left: `${Math.min(100, Math.max(0, ((n.t_seconds ?? 0) / duration) * 100))}%`,
                      }}
                      className="absolute top-0 flex h-6 w-6 -translate-x-1/2 items-center justify-center"
                    >
                      <span
                        className={`block h-3 w-[3px] rounded-full ${
                          n.status === 'open' ? 'bg-amber-300' : 'bg-white/45'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              )}
              {canCreate && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    aria-pressed={markingSpot}
                    onClick={toggleMarkingSpot}
                    className="rounded-full bg-white/90 px-4 min-h-[44px] text-[13px] font-semibold text-neutral-900 aria-pressed:bg-neutral-900 aria-pressed:text-white aria-pressed:ring-1 aria-pressed:ring-white/60"
                  >
                    {tn('mediaNotes.markSpot')}
                  </button>
                  <button
                    type="button"
                    onClick={() => startMoment(null)}
                    className="rounded-full bg-white/90 px-4 min-h-[44px] text-[13px] font-semibold text-neutral-900"
                  >
                    {tn('mediaNotes.commentAtMoment', { time: momentLabel })}
                  </button>
                </div>
              )}
            </div>
          ) : (
            videoNode
          )}
        </div>

        {media.length > 1 && (
          <span className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/20 backdrop-blur-sm text-white text-xs px-2.5 py-1 tabular-nums ring-1 ring-white/20">
            {idx + 1} / {media.length}
          </span>
        )}
      </div>
      {/* A sibling of the dialog div, not a child: React events cross portals along the React
        tree, so inside it every click in the composer would reach the backdrop's onClose. */}
      {canCreate && (
        <MediaNoteComposer
          open={composer !== null}
          title={
            composer
              ? composer.point
                ? tn('mediaNotes.composerMomentPoint', { time: formatMoment(composer.t) })
                : tn('mediaNotes.composerMoment', { time: formatMoment(composer.t) })
              : ''
          }
          onSubmit={submitNote}
          onCancel={closeComposer}
          onOverlayChange={(open) => onOverlayChange?.(open)}
          layerClassName={COMPOSER_LAYER}
        />
      )}
    </>,
    document.body,
  );
}
