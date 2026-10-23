import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Download, MessageSquarePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { VideoPlayer } from '@mesaas/ui/VideoPlayer';
import { formatMoment } from '@mesaas/ui/mediaPins/geometry';
import { MediaUnavailable } from '@/components/MediaUnavailable';
import type { PostMedia } from '../../../store';
import type { MediaNote } from '@/store/mediaNotes';
import { downloadMedia } from '@/utils/downloadMedia';
import { CrmPinLayer } from './mediaNotes/CrmPinLayer';

export interface InternalNoteInput {
  linkId: number;
  tSeconds?: number;
  x?: number;
  y?: number;
  body: string;
}

interface PostMediaLightboxProps {
  media: PostMedia[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every note of the post: the pins of the item on screen are drawn over it. */
  notes?: MediaNote[];
  /** Enables "Nota interna": the team pins a note that never leaves the CRM. */
  onCreateInternalNote?: (input: InternalNoteInput) => Promise<void>;
}

interface Draft {
  x?: number;
  y?: number;
  t?: number;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function PostMediaLightbox({
  media,
  initialIndex,
  open,
  onOpenChange,
  notes,
  onCreateInternalNote,
}: PostMediaLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [downloading, setDownloading] = useState(false);

  // Internal note flow: idle -> placing (tap the media) -> composing (type and save).
  const [mode, setMode] = useState<'idle' | 'placing' | 'composing'>('idle');
  const [draft, setDraft] = useState<Draft>({});
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [videoTime, setVideoTime] = useState<number | null>(null);
  const [videoNatural, setVideoNatural] = useState<{ w: number; h: number } | null>(null);
  const [imageNatural, setImageNatural] = useState<{ id: number; w: number; h: number } | null>(
    null,
  );

  const resetNote = () => {
    setMode('idle');
    setDraft({});
    setNoteBody('');
  };

  // Reseed when open flips so clicking a different tile lands on its slide.
  useEffect(() => {
    if (open) setIndex(initialIndex);
    else resetNote();
  }, [open, initialIndex]);

  // A different slide is a different note target.
  useEffect(() => {
    resetNote();
    setVideoTime(null);
    setVideoNatural(null);
  }, [index]);

  // Playback position and size of the video on screen, for the pins and for placing.
  useEffect(() => {
    if (!videoEl) return;
    const sync = () => {
      setVideoTime(videoEl.currentTime);
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0)
        setVideoNatural({ w: videoEl.videoWidth, h: videoEl.videoHeight });
    };
    sync();
    const events = ['timeupdate', 'seeked', 'loadedmetadata'] as const;
    events.forEach((e) => videoEl.addEventListener(e, sync));
    return () => events.forEach((e) => videoEl.removeEventListener(e, sync));
  }, [videoEl]);

  const hasMultiple = media.length >= 2;

  const prev = () => setIndex((i) => (i - 1 + media.length) % media.length);
  const next = () => setIndex((i) => (i + 1) % media.length);

  // Arrow-key nav only; Esc is handled by Radix Dialog itself.
  useEffect(() => {
    if (!open || !hasMultiple) return;
    const onKey = (e: KeyboardEvent) => {
      // Arrows inside the note composer move the caret, not the slide.
      if (isTypingTarget(e.target) || mode !== 'idle') return;
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
  }, [open, hasMultiple, media.length, mode]);

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

  const canNote = !!onCreateInternalNote && !current.media_lost_at;
  const showPins = !current.media_lost_at && (notes !== undefined || !!onCreateInternalNote);
  const isVideo = current.kind === 'video';
  const natural = isVideo
    ? (videoNatural ??
      (current.width && current.height ? { w: current.width, h: current.height } : null))
    : imageNatural?.id === current.id
      ? { w: imageNatural.w, h: imageNatural.h }
      : current.width && current.height
        ? { w: current.width, h: current.height }
        : null;

  const startPlacing = () => {
    // On video the spot belongs to a moment: freeze it.
    if (isVideo) videoEl?.pause();
    setDraft({});
    setMode('placing');
  };
  const place = (point: { x: number; y: number }) => {
    setDraft({ ...point, ...(isVideo && videoEl ? { t: videoEl.currentTime } : {}) });
    setMode('composing');
  };
  const placeWithoutSpot = () => {
    setDraft(isVideo && videoEl ? { t: videoEl.currentTime } : {});
    setMode('composing');
  };
  const saveNote = async () => {
    const body = noteBody.trim();
    if (!body || !onCreateInternalNote || savingNote) return;
    setSavingNote(true);
    try {
      await onCreateInternalNote({
        linkId: current.id,
        ...(draft.t != null ? { tSeconds: draft.t } : {}),
        ...(draft.x != null && draft.y != null ? { x: draft.x, y: draft.y } : {}),
        body,
      });
      resetNote();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar a nota interna');
    } finally {
      setSavingNote(false);
    }
  };
  const composerTitle = isVideo
    ? draft.t != null
      ? `Nota interna em ${formatMoment(draft.t)}`
      : 'Nota interna no vídeo'
    : `Nota interna no slide ${index + 1}`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[9005] bg-black/90 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[9005] flex items-center justify-center focus:outline-none pointer-events-none"
        >
          <DialogPrimitive.Title className="sr-only">
            Pré-visualização de mídia
          </DialogPrimitive.Title>

          <div className="relative flex items-center justify-center max-h-[85vh] max-w-[90vw] touch-none pointer-events-auto">
            {current.media_lost_at ? (
              <MediaUnavailable size="full" className="max-h-[85vh] max-w-[90vw] aspect-square" />
            ) : current.kind === 'image' ? (
              <img
                src={current.url}
                alt={current.original_filename}
                crossOrigin="anonymous"
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onLoad={(e) =>
                  setImageNatural({
                    id: current.id,
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
                className="max-h-[85vh] max-w-[90vw] object-contain select-none"
                draggable={false}
              />
            ) : (
              <VideoPlayer
                key={current.id}
                hlsSrc={current.playback?.hls}
                src={current.url ?? ''}
                poster={current.thumbnail_url ?? undefined}
                crossOrigin="anonymous"
                controls
                onVideoElement={setVideoEl}
                className="max-h-[85vh] max-w-[90vw] object-contain"
              />
            )}
            {showPins && (
              <CrmPinLayer
                notes={notes ?? []}
                linkId={current.id}
                natural={natural}
                currentTime={isVideo ? videoTime : null}
                placing={mode === 'placing'}
                onPlace={place}
                draft={
                  mode === 'composing' && draft.x != null && draft.y != null
                    ? { x: draft.x, y: draft.y }
                    : null
                }
              />
            )}
          </div>

          {canNote && mode === 'idle' && (
            <button
              type="button"
              onClick={startPlacing}
              className="fixed top-[calc(1rem+env(safe-area-inset-top,0px))] left-4 h-10 px-3 rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 flex items-center gap-1.5 text-sm pointer-events-auto ring-1 ring-white/20"
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              Nota interna
            </button>
          )}

          {canNote && mode === 'placing' && (
            <div className="fixed bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-stone-900 shadow-lg pointer-events-auto">
              <span>
                {isVideo
                  ? 'Toque no quadro para marcar o ponto.'
                  : 'Toque na imagem para marcar o ponto.'}
              </span>
              <button
                type="button"
                className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-semibold hover:bg-stone-100"
                onClick={placeWithoutSpot}
              >
                {isVideo && videoEl
                  ? `Comentar em ${formatMoment(videoEl.currentTime)}`
                  : isVideo
                    ? 'Comentar o vídeo'
                    : 'Comentar o slide inteiro'}
              </button>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-xs text-stone-600 hover:bg-stone-100"
                onClick={resetNote}
              >
                Cancelar
              </button>
            </div>
          )}

          {canNote && mode === 'composing' && (
            <div
              role="group"
              aria-labelledby="lightbox-internal-note-title"
              className="fixed bottom-16 left-1/2 -translate-x-1/2 w-[min(28rem,92vw)] rounded-xl bg-white p-3 text-stone-900 shadow-lg pointer-events-auto"
            >
              <p id="lightbox-internal-note-title" className="mb-2 text-sm font-semibold">
                {composerTitle}
              </p>
              <textarea
                autoFocus
                aria-label="Nota interna"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                rows={3}
                placeholder="Só a equipe vê esta nota."
                // 16px: iOS Safari zooms the page on smaller inputs.
                className="w-full resize-none rounded-lg border border-stone-300 p-2 text-base"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
                  onClick={resetNote}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingNote || !noteBody.trim()}
                  className="rounded-lg bg-[#12151a] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => void saveNote()}
                >
                  Salvar nota interna
                </button>
              </div>
            </div>
          )}

          <DialogPrimitive.Close
            aria-label="Fechar"
            className="fixed top-[calc(1rem+env(safe-area-inset-top,0px))] right-4 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 flex items-center justify-center pointer-events-auto ring-1 ring-white/20"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>

          {/* Downloads the slide on screen, not the whole gallery — the zip lives on the
              gallery's own "Baixar todos". Guarded so a double-click can't fire twice. */}
          {current.url && (
            <button
              type="button"
              aria-label="Baixar"
              disabled={downloading}
              onClick={async () => {
                setDownloading(true);
                try {
                  await downloadMedia(current);
                } catch {
                  toast.error('Erro ao baixar arquivo');
                } finally {
                  setDownloading(false);
                }
              }}
              className="fixed top-[calc(1rem+env(safe-area-inset-top,0px))] right-16 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 flex items-center justify-center pointer-events-auto ring-1 ring-white/20 disabled:opacity-50"
            >
              <Download className="h-5 w-5" />
            </button>
          )}

          {hasMultiple && (
            <>
              <button
                type="button"
                aria-label="Anterior"
                onClick={prev}
                className="fixed left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 flex items-center justify-center pointer-events-auto ring-1 ring-white/20"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Próximo"
                onClick={next}
                className="fixed right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 flex items-center justify-center pointer-events-auto ring-1 ring-white/20"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <span className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/20 backdrop-blur-sm text-white text-xs px-2.5 py-1 tabular-nums pointer-events-auto ring-1 ring-white/20">
                {index + 1} / {media.length}
              </span>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
