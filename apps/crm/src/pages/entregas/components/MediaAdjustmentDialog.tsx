import { useEffect, useRef, useState } from 'react';
import { Crop, Maximize, RotateCcw, Play, Pause, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PostMedia } from '@/store';
import { replacePostMedia } from '@/services/mediaAdjustment';
import { probeImage, probeVideo } from '@/services/postMedia';
import { validateMedia, STORY_VIDEO_MAX_BYTES, VIDEO_MAX_BYTES } from '../instagramLimits';
import { getPlacement, getPresets, type Adjustment } from '../media-editor/geometry';
import { adjustedFilename, drawAdjustment, jpegFromCanvas } from '../media-editor/render';

interface Props {
  media: PostMedia;
  forStories: boolean;
  onClose: () => void;
  onUpdated: () => void;
}
const primary =
  'rounded-lg bg-[#12151a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40';
const option = 'rounded-lg border px-3 py-2 text-sm transition-colors';
const selected =
  'border-amber-400 bg-amber-50 text-stone-900 dark:bg-amber-900/30 dark:text-amber-100';

export function MediaAdjustmentDialog({ media, forStories, onClose, onUpdated }: Props) {
  const video = media.kind === 'video';
  const presets = getPresets(media.kind, forStories);
  const initial = (): Adjustment => ({
    ...presets[video || forStories ? 0 : 1],
    mode: 'crop',
    zoom: 1,
    x: 0.5,
    y: 0.5,
    background: 'blur',
    color: '#12151a',
  });
  const [adjustment, setAdjustment] = useState<Adjustment>(initial);
  const [source, setSource] = useState<{ file: File; url: string } | null>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
    duration: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<'exporting' | 'saving' | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const operation = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const drag = useRef<{ x: number; y: number; ax: number; ay: number } | null>(null);
  const maxBytes = video ? (forStories ? STORY_VIDEO_MAX_BYTES : VIDEO_MAX_BYTES) : 8 * 1024 * 1024;

  useEffect(() => {
    const controller = new AbortController();
    let objectURL: string | undefined;
    let disposed = false;
    setError('');
    setSource(null);
    setDimensions(null);
    const timer = setTimeout(() => controller.abort(), 120_000);
    void (async () => {
      try {
        if (!media.url) throw new Error('Não foi possível carregar esta mídia.');
        const response = await fetch(media.url, { signal: controller.signal });
        if (!response.ok)
          throw new Error(
            'Não foi possível carregar esta mídia. Feche e abra o editor para tentar novamente.',
          );
        const blob = await response.blob();
        controller.signal.throwIfAborted();
        const file = new File([blob], media.original_filename, {
          type: blob.type || media.mime_type,
        });
        objectURL = URL.createObjectURL(file);
        if (!disposed) setSource({ file, url: objectURL });
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error && e.name !== 'AbortError'
              ? e.message
              : 'O carregamento demorou demais. Tente novamente.',
          );
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [media.url, media.original_filename, media.mime_type, attempt]);

  useEffect(
    () => () => {
      operation.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!dimensions) return;
    let frame = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const element = video ? videoRef.current : imageRef.current;
      const ctx = canvas?.getContext('2d', { colorSpace: 'srgb' });
      if (ctx && element)
        drawAdjustment(ctx, element, dimensions.width, dimensions.height, adjustment);
      if (video && playing) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [dimensions, adjustment, video, playing, time]);

  function close() {
    if (stage === 'saving') return;
    operation.current?.abort();
    onClose();
  }

  async function apply() {
    if (!source || !dimensions || !canvasRef.current || busy.current) return;
    busy.current = true;
    const controller = new AbortController();
    operation.current = controller;
    videoRef.current?.pause();
    setStage('exporting');
    setProgress(0);
    setError('');
    let attemptedSave = false;
    try {
      let output: File;
      let thumbnail: File | undefined;
      if (video) {
        if (dimensions.duration < 3 || dimensions.duration > (forStories ? 60 : 900)) {
          throw new Error(
            `A duração deve ser de 3 segundos a ${forStories ? '60 segundos' : '15 minutos'}. O ajuste de proporção não altera a duração.`,
          );
        }
        thumbnail = await jpegFromCanvas(canvasRef.current, 'cover.jpg');
        const { exportVideo } = await import('../media-editor/exportVideo');
        controller.signal.throwIfAborted();
        output = await exportVideo(
          source.file,
          adjustment,
          dimensions.width,
          dimensions.height,
          dimensions.duration,
          maxBytes,
          controller.signal,
          setProgress,
        );
      } else {
        output = await jpegFromCanvas(
          canvasRef.current,
          adjustedFilename(source.file.name, 'image'),
        );
      }
      controller.signal.throwIfAborted();
      const probe = video ? await probeVideo(output) : await probeImage(output);
      const issues = validateMedia(
        [
          {
            id: media.id,
            kind: media.kind,
            mime_type: output.type,
            size_bytes: output.size,
            width: probe.width,
            height: probe.height,
            duration_seconds:
              'duration_seconds' in probe && typeof probe.duration_seconds === 'number'
                ? probe.duration_seconds
                : null,
          },
        ],
        { forStories },
      );
      if (issues.length) throw new Error(issues.map((i) => i.message).join(' '));
      controller.signal.throwIfAborted();
      setStage('saving');
      setProgress(0);
      attemptedSave = true;
      await replacePostMedia(
        media,
        output,
        thumbnail,
        (p) => {
          if (!controller.signal.aborted) setProgress(Math.round((p.loaded / p.total) * 100));
        },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      toast.success('Proporção ajustada. O original foi preservado em Arquivos.');
      onUpdated();
      onClose();
    } catch (e) {
      // HTTP cancellation cannot undo a transaction already received by the server.
      // Reconcile the cache even when navigating away during an uncertain save.
      if (attemptedSave) onUpdated();
      if (!controller.signal.aborted) {
        setError(
          e instanceof Error ? e.message : 'Não foi possível aplicar o ajuste. Tente novamente.',
        );
      }
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setStage(null);
    }
  }

  const durationInvalid =
    video &&
    dimensions &&
    (dimensions.duration < 3 || dimensions.duration > (forStories ? 60 : 900));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="max-w-4xl w-[calc(100%-2rem)] max-h-[92dvh] overflow-y-auto p-0 z-[9021]"
        overlayClassName="z-[9020]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle>Ajustar proporção</DialogTitle>
          <DialogDescription className="break-all">
            {media.original_filename} · {video ? 'Vídeo' : 'Imagem'}
          </DialogDescription>
          <p className="text-xs text-muted-foreground">
            Instagram · {forStories ? 'Stories' : video ? 'Reel' : 'Feed / Carrossel'}
          </p>
        </DialogHeader>
        <div className="grid gap-5 px-6 pb-5 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0">
            <div className="flex min-h-64 items-center justify-center rounded-xl bg-[#12151a] p-3">
              {!dimensions && (
                <div className="p-6 text-center text-sm text-white/70">
                  {error ? (
                    'Prévia indisponível'
                  ) : (
                    <>
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      Carregando mídia…
                    </>
                  )}
                </div>
              )}
              <div
                className={dimensions ? 'relative' : 'hidden'}
                style={{ width: '100%', maxWidth: (420 * adjustment.width) / adjustment.height }}
              >
                <canvas
                  ref={canvasRef}
                  width={adjustment.width}
                  height={adjustment.height}
                  className="block w-full touch-none rounded-sm outline-none focus:ring-2 focus:ring-amber-400"
                  tabIndex={0}
                  role="img"
                  aria-label="Prévia do ajuste. Arraste ou use as setas para reposicionar."
                  onPointerDown={(e) => {
                    if (stage || adjustment.mode !== 'crop') return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = {
                      x: e.clientX,
                      y: e.clientY,
                      ax: adjustment.x,
                      ay: adjustment.y,
                    };
                  }}
                  onPointerMove={(e) => {
                    if (!drag.current || !dimensions || stage) return;
                    const p = getPlacement(
                      dimensions.width,
                      dimensions.height,
                      adjustment.width,
                      adjustment.height,
                      adjustment.mode,
                      adjustment.zoom,
                      0,
                      0,
                    );
                    const scale = adjustment.width / e.currentTarget.getBoundingClientRect().width;
                    const x =
                      p.width > adjustment.width
                        ? drag.current.ax -
                          ((e.clientX - drag.current.x) * scale) / (p.width - adjustment.width)
                        : 0.5;
                    const y =
                      p.height > adjustment.height
                        ? drag.current.ay -
                          ((e.clientY - drag.current.y) * scale) / (p.height - adjustment.height)
                        : 0.5;
                    setAdjustment((a) => ({
                      ...a,
                      x: Math.max(0, Math.min(1, x)),
                      y: Math.max(0, Math.min(1, y)),
                    }));
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                  onKeyDown={(e) => {
                    if (
                      stage ||
                      adjustment.mode !== 'crop' ||
                      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
                    )
                      return;
                    e.preventDefault();
                    setAdjustment((a) => ({
                      ...a,
                      x: Math.max(
                        0,
                        Math.min(
                          1,
                          a.x + (e.key === 'ArrowLeft' ? 0.02 : e.key === 'ArrowRight' ? -0.02 : 0),
                        ),
                      ),
                      y: Math.max(
                        0,
                        Math.min(
                          1,
                          a.y + (e.key === 'ArrowUp' ? 0.02 : e.key === 'ArrowDown' ? -0.02 : 0),
                        ),
                      ),
                    }));
                  }}
                />
                {adjustment.mode === 'crop' && (
                  <div
                    className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 border border-white/80"
                    aria-hidden="true"
                  >
                    {Array.from({ length: 9 }, (_, i) => (
                      <div key={i} className="border border-white/25" />
                    ))}
                  </div>
                )}
              </div>
            </div>
            {source &&
              (video ? (
                <video
                  ref={videoRef}
                  src={source.url}
                  className="hidden"
                  preload="auto"
                  muted
                  playsInline
                  onLoadedData={(e) => {
                    const v = e.currentTarget;
                    setDimensions({
                      width: v.videoWidth,
                      height: v.videoHeight,
                      duration: v.duration,
                    });
                  }}
                  onError={() => setError('Não foi possível ler o vídeo neste navegador.')}
                  onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                  onSeeked={(e) => setTime(e.currentTarget.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                />
              ) : (
                <img
                  ref={imageRef}
                  src={source.url}
                  alt=""
                  className="hidden"
                  onLoad={(e) =>
                    setDimensions({
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                      duration: 0,
                    })
                  }
                  onError={() => setError('Não foi possível ler a imagem.')}
                />
              ))}
            {video && dimensions && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={!!stage}
                  aria-label={playing ? 'Pausar vídeo' : 'Reproduzir vídeo'}
                  onClick={() => {
                    if (playing) videoRef.current?.pause();
                    else
                      void videoRef.current
                        ?.play()
                        .catch(() => setError('Não foi possível reproduzir o vídeo.'));
                  }}
                  className="rounded-lg p-2 hover:bg-muted"
                >
                  {playing ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <input
                  type="range"
                  aria-label="Posição do vídeo"
                  min={0}
                  max={dimensions.duration || 1}
                  step={0.1}
                  value={time}
                  disabled={!!stage}
                  onChange={(e) => {
                    if (videoRef.current) videoRef.current.currentTime = Number(e.target.value);
                  }}
                  className="min-w-0 flex-1 accent-amber-400"
                />
                <span className="text-xs text-muted-foreground">
                  {Math.floor(time)} / {Math.floor(dimensions.duration)} s
                </span>
              </div>
            )}
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {adjustment.mode === 'crop'
                ? 'Arraste ou use as setas para reposicionar'
                : 'Todo o conteúdo será mantido, sem distorção'}
            </p>
          </div>
          <fieldset disabled={!!stage} className="min-w-0 space-y-5">
            <div>
              <p className="mb-2 text-sm font-semibold">Proporção</p>
              <div className="grid grid-cols-2 gap-2">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={adjustment.width === p.width && adjustment.height === p.height}
                    onClick={() => setAdjustment((a) => ({ ...a, ...p, x: 0.5, y: 0.5, zoom: 1 }))}
                    className={`${option} ${adjustment.width === p.width && adjustment.height === p.height ? selected : 'border-border hover:bg-muted'}`}
                  >
                    <span className="block font-semibold">{p.label}</span>
                    <span className="text-[10px]">
                      {p.width} × {p.height}
                    </span>
                  </button>
                ))}
              </div>
              {(video || forStories) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Formato recomendado. Outras proporções aceitas não impedem a publicação.
                </p>
              )}
            </div>
            <div>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {(['crop', 'fit'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={adjustment.mode === mode}
                    onClick={() => setAdjustment((a) => ({ ...a, mode }))}
                    className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm ${adjustment.mode === mode ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                  >
                    {mode === 'crop' ? <Crop size={14} /> : <Maximize size={14} />}
                    {mode === 'crop' ? 'Recortar' : 'Encaixar'}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {adjustment.mode === 'crop'
                  ? 'Preenche o quadro cortando as bordas.'
                  : 'Mantém o conteúdo inteiro e preenche o fundo.'}
              </p>
            </div>
            {adjustment.mode === 'crop' ? (
              <label className="block text-sm font-semibold">
                Zoom{' '}
                <span className="float-right font-normal">
                  {Math.round(adjustment.zoom * 100)}%
                </span>
                <input
                  type="range"
                  aria-label="Zoom"
                  min={1}
                  max={3}
                  step={0.01}
                  value={adjustment.zoom}
                  onChange={(e) => setAdjustment((a) => ({ ...a, zoom: Number(e.target.value) }))}
                  className="mt-3 w-full accent-amber-400"
                />
              </label>
            ) : (
              <div>
                <p className="mb-2 text-sm font-semibold">Fundo</p>
                <div className="flex gap-2">
                  {(['blur', 'solid'] as const).map((bg) => (
                    <button
                      key={bg}
                      type="button"
                      aria-pressed={adjustment.background === bg}
                      onClick={() => setAdjustment((a) => ({ ...a, background: bg }))}
                      className={`${option} ${adjustment.background === bg ? selected : 'border-border'}`}
                    >
                      {bg === 'blur' ? 'Desfocado' : 'Cor sólida'}
                    </button>
                  ))}
                </div>
                {adjustment.background === 'solid' && (
                  <label className="mt-3 flex items-center gap-2 text-xs">
                    <input
                      aria-label="Cor do fundo"
                      type="color"
                      value={adjustment.color}
                      onChange={(e) => setAdjustment((a) => ({ ...a, color: e.target.value }))}
                    />
                    Cor do fundo
                  </label>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setAdjustment(initial())}
              className="flex items-center gap-1.5 text-xs text-muted-foreground underline"
            >
              <RotateCcw size={13} />
              Redefinir
            </button>
            <div className="border-t pt-4 text-xs leading-6 text-muted-foreground">
              <p>
                Saída: {adjustment.width} × {adjustment.height} px
              </p>
              <p>{video ? 'MP4 · H.264 / AAC' : 'JPEG · sRGB'}</p>
              <p>Tamanho máximo: {maxBytes / 1024 / 1024} MB</p>
              {video && <p>Duração: 3 s–{forStories ? '60 s' : '15 min'}</p>}
            </div>
          </fieldset>
        </div>
        {(error || durationInvalid) && (
          <div
            role="alert"
            className="mx-6 mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {error ||
              'A duração está fora do permitido. O ajuste de proporção não altera a duração do vídeo.'}
            {!source && (
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="ml-2 underline"
              >
                Tentar novamente
              </button>
            )}
          </div>
        )}
        {stage && (
          <div role="status" className="mx-6 mb-4 text-sm">
            <div className="mb-2 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              {stage === 'saving'
                ? 'Salvando mídia'
                : video
                  ? 'Processando vídeo'
                  : 'Processando imagem'}
              … {progress}%
            </div>
            <progress className="h-1.5 w-full accent-amber-400" max={100} value={progress} />
            <p className="mt-1 text-xs text-muted-foreground">
              {stage === 'saving'
                ? 'Aguarde a confirmação do salvamento.'
                : 'Mantenha esta janela aberta até concluir.'}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-6 py-4">
          <p className="text-xs text-muted-foreground">O original será preservado em Arquivos.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              disabled={stage === 'saving'}
              className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40"
            >
              {stage === 'exporting' ? 'Cancelar processamento' : 'Cancelar'}
            </button>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={!dimensions || !!stage || !!durationInvalid}
              className={primary}
            >
              Aplicar ajuste
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
