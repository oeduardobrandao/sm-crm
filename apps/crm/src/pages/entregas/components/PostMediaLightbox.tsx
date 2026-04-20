import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { PostMedia } from '../../../store';

interface PostMediaLightboxProps {
  media: PostMedia[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PostMediaLightbox({
  media,
  initialIndex,
  open,
  onOpenChange,
}: PostMediaLightboxProps) {
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  const hasMultiple = media.length >= 2;

  const prev = () =>
    setIndex((i) => (i - 1 + media.length) % media.length);
  const next = () =>
    setIndex((i) => (i + 1) % media.length);

  useEffect(() => {
    if (!open || !hasMultiple) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hasMultiple, media.length]);

  const startX = useRef<number | null>(null);
  const handlePointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
  };
  const handlePointerUp = (e: React.PointerEvent) => {
    const start = startX.current;
    startX.current = null;
    if (start == null || !hasMultiple) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) < 50) return;
    if (dx < 0) next();
    else prev();
  };

  if (media.length === 0) return null;
  const current = media[index];
  if (!current) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex items-center justify-center focus:outline-none pointer-events-none"
        >
          <DialogPrimitive.Title className="sr-only">
            Pré-visualização de mídia
          </DialogPrimitive.Title>

          <div className="flex items-center justify-center max-h-[85vh] max-w-[90vw] touch-none pointer-events-auto">
            {current.kind === 'image' ? (
              <img
                src={current.url}
                alt={current.original_filename}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                className="max-h-[85vh] max-w-[90vw] object-contain select-none"
                draggable={false}
              />
            ) : (
              <video
                key={current.id}
                src={current.url ?? undefined}
                poster={current.thumbnail_url ?? undefined}
                controls
                className="max-h-[85vh] max-w-[90vw] object-contain"
              />
            )}
          </div>

          <DialogPrimitive.Close
            aria-label="Fechar"
            className="fixed top-4 right-4 w-10 h-10 rounded-full bg-stone-900/85 text-white hover:bg-stone-900 flex items-center justify-center pointer-events-auto"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>

          {hasMultiple && (
            <>
              <button
                type="button"
                aria-label="Anterior"
                onClick={prev}
                className="fixed left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-stone-900/85 text-white hover:bg-stone-900 flex items-center justify-center pointer-events-auto"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Próximo"
                onClick={next}
                className="fixed right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-stone-900/85 text-white hover:bg-stone-900 flex items-center justify-center pointer-events-auto"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <span className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-stone-900/85 text-white text-xs px-2.5 py-1 tabular-nums pointer-events-auto">
                {index + 1} / {media.length}
              </span>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
