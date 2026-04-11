import { useEffect, useState, useCallback } from 'react';
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose]);

  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Fechar"
        className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <X className="h-5 w-5" />
      </button>

      {media.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); prev(); }}
            aria-label="Anterior"
            className="absolute left-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); next(); }}
            aria-label="Próxima"
            className="absolute right-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      <div
        className="relative max-h-[90vh] max-w-[90vw] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {current.kind === 'image' ? (
          <img
            src={current.url}
            alt=""
            onError={() => onStaleUrl?.()}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          />
        ) : (
          <video
            src={current.url}
            poster={current.thumbnail_url ?? undefined}
            controls
            onError={() => onStaleUrl?.()}
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
          />
        )}
      </div>

      {media.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white">
          {idx + 1} / {media.length}
        </div>
      )}
    </div>
  );
}
