import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HubMediaNote, HubPost } from '../../types';
import { openCountByLink } from '../../lib/mediaNotes';
import { OptimizedImage } from '../OptimizedImage';
import { VideoPrewarm } from '../VideoPrewarm';
import { MediaUnavailable } from '../MediaUnavailable';
import { MediaPinLayer } from './mediaNotes/MediaPinLayer';
import {
  resolveTarget,
  applyEdgeResistance,
  crossedDragThreshold,
} from '../../lib/carouselGesture';

const SNAP_MS = 260;
const NO_NOTES: HubMediaNote[] = [];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

interface PostMediaPaneProps {
  post: HubPost;
  onOpenLightbox: (index: number) => void;
  priority?: boolean;
  /** The post's media notes (the layer scopes them to the current slide). */
  notes?: HubMediaNote[];
  /** Pin placement mode: slides stop opening the lightbox and image slides take taps as pins. */
  placing?: boolean;
  /** The spot being commented on, shown as "+" on the current slide. */
  pending?: { x: number; y: number } | null;
  onPlace?: (linkId: number, p: { x: number; y: number }) => void;
  currentIndexChange?: (index: number) => void;
  /** Move to this media link. A fresh `seq` re-triggers even for the same link. */
  jumpTo?: { linkId: number; seq: number } | null;
}

/**
 * The media half of the detail dialog: a finger-following carousel for
 * feed/reels/carrossel, story frames with tap zones for stories. Keyboard
 * arrows are deliberately NOT bound here: in the dialog they move between posts.
 */
export function PostMediaPane({
  post,
  onOpenLightbox,
  priority,
  notes = NO_NOTES,
  placing = false,
  pending = null,
  onPlace,
  currentIndexChange,
  jumpTo = null,
}: PostMediaPaneProps) {
  const { t } = useTranslation('hubPosts');
  const media = post.media ?? [];
  const isStory = post.tipo === 'stories';
  const [current, setCurrent] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastT: 0,
    width: 0,
    velocity: 0,
    active: false,
    decided: false,
  });
  const suppressClickRef = useRef(false);
  const prewarmVideoUrl = media.find((mm) => mm.kind === 'video')?.url ?? null;
  const reduceMotion = prefersReducedMotion();

  const openByLink = useMemo(() => openCountByLink(notes), [notes]);
  const currentMedia = media[current];
  // Pins live on image slides only: video notes are made in the lightbox.
  const pinMedia =
    currentMedia?.kind === 'image' && !currentMedia.media_lost_at ? currentMedia : null;
  const placingHere = placing && pinMedia !== null;
  const currentOpen = currentMedia ? (openByLink.get(currentMedia.id) ?? 0) : 0;

  const indexChangeRef = useRef(currentIndexChange);
  indexChangeRef.current = currentIndexChange;
  useEffect(() => {
    indexChangeRef.current?.(current);
  }, [current]);

  useEffect(() => {
    if (!jumpTo) return;
    const index = media.findIndex((mm) => mm.id === jumpTo.linkId);
    if (index >= 0) {
      setCurrent(index);
      setDragOffset(0);
      setIsDragging(false);
    }
    // media identity changes on every refetch; a jump is keyed by seq only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.seq]);

  const pinLayer = pinMedia && !isDragging && dragOffset === 0 && (
    <div className="absolute inset-0 z-[15] pointer-events-none">
      <MediaPinLayer
        notes={notes}
        linkId={pinMedia.id}
        naturalWidth={pinMedia.width}
        naturalHeight={pinMedia.height}
        placing={placingHere}
        pending={pending}
        onPlace={(p) => onPlace?.(pinMedia.id, p)}
      />
    </div>
  );

  const openBadge = currentOpen > 0 && (
    <span
      data-testid="slide-open-badge"
      className="absolute bottom-3 left-3 z-20 rounded-full bg-black/55 text-white text-[12px] px-2 py-0.5"
    >
      {t('mediaNotes.openCount', { count: currentOpen })}
    </span>
  );

  function goTo(target: number) {
    setCurrent(Math.max(0, Math.min(media.length - 1, target)));
    setDragOffset(0);
    setIsDragging(false);
  }

  function onPointerDown(e: React.PointerEvent) {
    suppressClickRef.current = false;
    if (media.length <= 1) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastT: e.timeStamp,
      width: viewportRef.current?.clientWidth ?? 0,
      velocity: 0,
      active: true,
      decided: false,
    };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.decided) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        d.active = false;
        return;
      }
      if (!crossedDragThreshold(dx, dy)) return;
      d.decided = true;
      setIsDragging(true);
      viewportRef.current?.setPointerCapture?.(e.pointerId);
    }
    d.velocity = (e.clientX - d.lastX) / Math.max(1, e.timeStamp - d.lastT);
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    setDragOffset(applyEdgeResistance(dx, current, media.length));
  }
  function endPointer(e: React.PointerEvent, cancelled: boolean) {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    d.active = false;
    if (!d.decided) {
      setDragOffset(0);
      setIsDragging(false);
      return;
    }
    suppressClickRef.current = true;
    if (cancelled) {
      goTo(current);
      return;
    }
    goTo(
      resolveTarget({
        currentIndex: current,
        count: media.length,
        deltaX: e.clientX - d.startX,
        width: d.width,
        velocity: d.velocity,
      }),
    );
  }
  function openAt(index: number) {
    if (placing) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpenLightbox(index);
  }

  const counter = media.length > 1 && (
    <span className="absolute top-3 right-3 z-20 rounded-full bg-black/45 text-white text-[12px] px-2 py-0.5 tabular-nums">
      {current + 1} / {media.length}
    </span>
  );

  const renderItem = (mm: HubPost['media'][number], i: number, sizes: string) =>
    mm.media_lost_at ? (
      <MediaUnavailable size="full" />
    ) : mm.kind === 'image' ? (
      <OptimizedImage
        src={mm.url ?? ''}
        alt=""
        width={mm.width ?? undefined}
        height={mm.height ?? undefined}
        blurDataURL={mm.blur_data_url ?? undefined}
        sizes={sizes}
        priority={priority && i === 0}
        className="w-full h-full object-contain pointer-events-none"
      />
    ) : (
      <>
        <img
          src={mm.thumbnail_url ?? ''}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="w-full h-full object-contain pointer-events-none"
        />
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-14 h-14 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      </>
    );

  if (isStory) {
    return (
      <div className="relative w-full h-full bg-[#111] flex items-center justify-center">
        <VideoPrewarm src={prewarmVideoUrl} />
        <div className="relative h-full max-h-full aspect-[9/16] overflow-hidden">
          {currentMedia && (
            <button
              type="button"
              onClick={() => openAt(current)}
              aria-label={t('instagramCard.openMediaAriaLabel', 'Abrir mídia {{index}}', {
                index: current + 1,
              })}
              className="absolute inset-0 w-full h-full"
            >
              {renderItem(currentMedia, current, '(min-width: 768px) 40vw, 100vw')}
            </button>
          )}
          <div className="absolute top-2 left-2 right-2 z-20 flex gap-[3px]">
            {media.map((_, i) => (
              <div key={i} className="flex-1 h-[2px] rounded-full bg-white/30 overflow-hidden">
                <div
                  className={`h-full rounded-full bg-white ${i <= current ? 'w-full' : 'w-0'}`}
                />
              </div>
            ))}
          </div>
          {media.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => goTo(current - 1)}
                disabled={placing}
                className="absolute left-0 top-0 w-1/3 h-full z-10"
                aria-label={t('storyCard.prevAriaLabel', 'Anterior')}
              />
              <button
                type="button"
                onClick={() => (current >= media.length - 1 ? openAt(current) : goTo(current + 1))}
                disabled={placing}
                className="absolute right-0 top-0 w-1/3 h-full z-10"
                aria-label={t('storyCard.nextAriaLabel', 'Próximo')}
              />
            </>
          )}
          {pinLayer}
          {openBadge}
          {counter}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className="relative w-full h-full bg-[#111] overflow-hidden group/pane"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
    >
      <VideoPrewarm src={prewarmVideoUrl} />
      <div
        className="flex h-full"
        style={{
          transform: `translateX(calc(${-current * 100}% + ${dragOffset}px))`,
          transition: isDragging || reduceMotion ? 'none' : `transform ${SNAP_MS}ms ease-out`,
        }}
      >
        {media.map((mm, i) => (
          <button
            key={mm.id}
            type="button"
            aria-label={t('instagramCard.openMediaAriaLabel', 'Abrir mídia {{index}}', {
              index: i + 1,
            })}
            onClick={() => openAt(i)}
            draggable={false}
            className="relative flex-none w-full h-full flex items-center justify-center"
          >
            {renderItem(mm, i, '(min-width: 768px) 55vw, 100vw')}
          </button>
        ))}
      </div>
      {media.length > 1 && current > 0 && (
        <button
          type="button"
          onClick={() => goTo(current - 1)}
          aria-label={t('instagramCard.prevSlideAriaLabel', 'Slide anterior')}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/85 text-[#222] flex items-center justify-center shadow"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      {media.length > 1 && current < media.length - 1 && (
        <button
          type="button"
          onClick={() => goTo(current + 1)}
          aria-label={t('instagramCard.nextSlideAriaLabel', 'Próximo slide')}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/85 text-[#222] flex items-center justify-center shadow"
        >
          <ChevronRight size={18} />
        </button>
      )}
      {pinLayer}
      {media.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 z-20 flex justify-center gap-1.5">
          {media.map((mm, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === current ? 'w-4' : 'w-1.5'} ${
                openByLink.has(mm.id) ? 'bg-amber-300' : i === current ? 'bg-white' : 'bg-white/45'
              }`}
            />
          ))}
        </div>
      )}
      {openBadge}
      {counter}
    </div>
  );
}
