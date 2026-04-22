import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { HubPostMedia } from '../types';

interface PostMediaLightboxProps {
  media: HubPostMedia[];
  initialIndex: number;
  onClose: () => void;
  /** Called on media load error (e.g. 403 from expired presigned URL) so parent can refetch. */
  onStaleUrl?: () => void;
}

export function PostMediaLightbox({ media, initialIndex, onClose, onStaleUrl }: PostMediaLightboxProps) {
  const [idx, setIdx] = useState(initialIndex);
  const current = media[idx];

  const prev = useCallback(() => setIdx((i) => (i - 1 + media.length) % media.length), [media.length]);
  const next = useCallback(() => setIdx((i) => (i + 1) % media.length), [media.length]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Preload adjacent images so navigation feels instant
  useEffect(() => {
    const toPreload = [
      (idx + 1) % media.length,
      (idx - 1 + media.length) % media.length,
    ];
    for (const i of toPreload) {
      if (i === idx) continue;
      const m = media[i];
      if (m?.kind === 'image' && m.url) {
        const img = new Image();
        img.src = m.url;
      }
    }
  }, [idx, media]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose]);

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
    if (dx < 0) next(); else prev();
  };

  if (!current) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9005] flex items-center justify-center bg-black/90"
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Fechar"
        className="fixed top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-colors ring-1 ring-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      {media.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); prev(); }}
            aria-label="Anterior"
            className="fixed left-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 transition-colors ring-1 ring-white/20"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); next(); }}
            aria-label="Próxima"
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
        {current.kind === 'image' ? (
          <img
            src={current.url}
            alt=""
            draggable={false}
            onError={() => onStaleUrl?.()}
            className="max-h-[85vh] max-w-[90vw] object-contain select-none"
          />
        ) : (
          <video
            key={current.id}
            src={current.url}
            poster={current.thumbnail_url ?? undefined}
            controls
            onError={() => onStaleUrl?.()}
            className="max-h-[85vh] max-w-[90vw] object-contain"
          />
        )}
      </div>

      {media.length > 1 && (
        <span className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/20 backdrop-blur-sm text-white text-xs px-2.5 py-1 tabular-nums ring-1 ring-white/20">
          {idx + 1} / {media.length}
        </span>
      )}
    </div>,
    document.body,
  );
}
