import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Save, Trash2, Upload, X } from 'lucide-react';
import {
  deleteKbVideo,
  getKbVideo,
  listKbArticles,
  listKbVideoSeries,
  refreshKbVideo,
  upsertKbVideo,
  type AdminApiError,
  type KbVideo,
} from '../lib/api';
import {
  formatDuration,
  KB_VIDEO_SERIES_KEY,
  KB_VIDEOS_KEY,
  kbVideoKey,
  processingBadge,
} from '../lib/kb-video-status';
import { kbVideoEditPath, kbVideosPath } from '../lib/routes';
import { slugify } from '../lib/slugify';
import { uploadKbVideo, validateVideoFile } from '../lib/stream-upload';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';

const FIELD =
  'w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm focus:outline-none focus:border-primary';
const LABEL = 'block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5';
const RESERVED_SLUGS = ['novo', 'editar', 'video'];
const PENDING_POLL_MS = 10_000;

export default function KbVideoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const parsedId = id ? parseInt(id, 10) : NaN;
  const isEdit = !!id;
  const videoId = Number.isNaN(parsedId) ? null : parsedId;

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [articleId, setArticleId] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [progress, setProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracks which video id's fields have already been loaded into the form, so a later
  // background refetch (the 10s pending-poll settling processing per decision A) updates the
  // processing/status UI without clobbering an in-progress, unsaved edit. Only a genuinely
  // different video (a fresh load, or navigating from "new" to the created id) re-hydrates.
  const hydratedVideoIdRef = useRef<number | null>(null);

  // A pending video may have finished processing on Stream's side without the webhook ever
  // reaching us (missed delivery, cold start, etc). Rather than trust the DB row forever, every
  // fetch while pending also asks Stream directly via refreshKbVideo, so polling here actually
  // settles processing instead of showing "Processando" indefinitely. Skipped while this page has
  // an upload in flight (abortRef set) so we don't race the upload's own status transitions.
  const videoQuery = useQuery({
    queryKey: kbVideoKey(videoId),
    queryFn: async () => {
      const result = await getKbVideo(videoId!);
      const v = result.video;
      if (v.stream_status === 'pending' && v.stream_uid && !abortRef.current) {
        try {
          return await refreshKbVideo(videoId!);
        } catch {
          return result;
        }
      }
      return result;
    },
    enabled: videoId !== null,
    refetchInterval: (query) => {
      const v = query.state.data?.video;
      return v && v.stream_status === 'pending' && v.stream_uid && !abortRef.current
        ? PENDING_POLL_MS
        : false;
    },
  });
  const video = videoQuery.data?.video;

  const { data: seriesData } = useQuery({
    queryKey: KB_VIDEO_SERIES_KEY,
    queryFn: listKbVideoSeries,
  });
  const { data: articlesData } = useQuery({
    queryKey: ['admin', 'kb-articles', 'published', ''],
    queryFn: () => listKbArticles({ status: 'published' }),
  });

  useEffect(() => {
    if (!video || hydratedVideoIdRef.current === video.id) return;
    hydratedVideoIdRef.current = video.id;
    setTitle(video.title);
    setSlug(video.slug);
    setDescription(video.description ?? '');
    setSeriesId(video.series_id);
    setArticleId(video.article_id ?? '');
    setDisplayOrder(String(video.display_order));
    setStatus(video.status);
  }, [video]);

  useEffect(() => {
    if (!isEdit && title) setSlug(slugify(title));
  }, [title, isEdit]);

  useEffect(() => {
    if (!isEdit && !seriesId && seriesData?.series[0]) setSeriesId(seriesData.series[0].id);
  }, [isEdit, seriesId, seriesData]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KB_VIDEOS_KEY });
    qc.invalidateQueries({ queryKey: kbVideoKey(videoId) });
  };

  const saveMut = useMutation({
    mutationFn: () =>
      upsertKbVideo({
        ...(video ? { video_id: video.id } : {}),
        title,
        slug,
        description: description || null,
        series_id: seriesId,
        article_id: articleId || null,
        display_order: Math.max(0, parseInt(displayOrder, 10) || 0),
        status,
      }),
    onSuccess: (data) => {
      invalidate();
      toast.success(isEdit ? 'Vídeo atualizado' : 'Vídeo criado. Agora envie o arquivo.');
      if (!isEdit && data.video) navigate(kbVideoEditPath(data.video.id), { replace: true });
    },
    onError: (err: AdminApiError) =>
      toast.error(
        err.status === 409
          ? 'Já existe um vídeo com esse slug.'
          : 'Não foi possível salvar o vídeo.',
      ),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteKbVideo(video!.id),
    onSuccess: () => {
      invalidate();
      toast.success('Vídeo excluído');
      navigate(kbVideosPath(), { replace: true });
    },
    onError: () => toast.error('Não foi possível excluir o vídeo.'),
  });

  const handleFile = async (file: File) => {
    if (!video) return;
    const problem = validateVideoFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    try {
      await uploadKbVideo(video.id, file, { onProgress: setProgress, signal: controller.signal });
      toast.success('Vídeo enviado. O processamento leva alguns minutos.');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') toast('Envio cancelado');
      else toast.error('Não foi possível enviar o vídeo. Tente novamente.');
    } finally {
      abortRef.current = null;
      setProgress(null);
      invalidate();
    }
  };

  const slugError =
    slug &&
    (RESERVED_SLUGS.includes(slug)
      ? 'Slug reservado'
      : !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
        ? 'Apenas letras minúsculas, números e hifens'
        : null);

  // The ready+HLS requirement only gates a TRANSITION into "Publicado". A video that is already
  // published stays publishable even while a replacement file is mid-processing (stream_status
  // pending): the site keeps serving the last-published HLS asset until the new one is ready.
  const savedStatus: KbVideo['status'] = video?.status ?? 'draft';
  const isReady = !!video && video.stream_status === 'ready' && !!video.hls_url;
  const publishLocked = savedStatus !== 'published' && !isReady;
  const uploading = progress !== null;

  if (isEdit && videoId === null) {
    return <p className="py-8 text-sm text-dim-foreground">Vídeo não encontrado.</p>;
  }
  if (isEdit && videoQuery.isLoading) {
    return <p className="py-8 text-sm text-dim-foreground">Carregando…</p>;
  }
  if (isEdit && !video) {
    return <p className="py-8 text-sm text-dim-foreground">Vídeo não encontrado.</p>;
  }

  const badge = video ? processingBadge(video) : null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => navigate(kbVideosPath())}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Vídeos
        </button>
        <div className="flex gap-2">
          {video && (
            <Button
              variant="outline"
              size="sm"
              disabled={deleteMut.isPending || uploading}
              onClick={() => {
                if (confirm('Excluir este vídeo? O arquivo também é removido do Stream.'))
                  deleteMut.mutate();
              }}
            >
              <Trash2 size={14} /> Excluir
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !title || !slug || !seriesId || !!slugError}
          >
            <Save size={14} /> {saveMut.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>

      <h1 className="mb-6 text-2xl font-semibold">{isEdit ? 'Editar vídeo' : 'Novo vídeo'}</h1>

      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="video-title" className={LABEL}>
            Título
          </label>
          <input
            id="video-title"
            className={FIELD}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="video-slug" className={LABEL}>
            Slug
          </label>
          <input
            id="video-slug"
            className={FIELD}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          {slugError && <p className="mt-1 text-xs text-destructive">{slugError}</p>}
        </div>
        <div>
          <label htmlFor="video-description" className={LABEL}>
            Descrição
          </label>
          <textarea
            id="video-description"
            className={FIELD}
            rows={3}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="video-series" className={LABEL}>
              Série
            </label>
            <select
              id="video-series"
              className={FIELD}
              value={seriesId}
              onChange={(e) => setSeriesId(e.target.value)}
            >
              {(seriesData?.series ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="video-article" className={LABEL}>
              Artigo relacionado
            </label>
            <select
              id="video-article"
              className={FIELD}
              value={articleId}
              onChange={(e) => setArticleId(e.target.value)}
            >
              <option value="">Nenhum</option>
              {(articlesData?.articles ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="video-order" className={LABEL}>
              Ordem
            </label>
            <input
              id="video-order"
              type="number"
              min={0}
              max={10000}
              className={FIELD}
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="video-status" className={LABEL}>
              Status
            </label>
            <select
              id="video-status"
              className={FIELD}
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
            >
              <option value="draft">Rascunho</option>
              <option value="published" disabled={publishLocked}>
                Publicado
              </option>
            </select>
            {publishLocked && (
              <p className="mt-1 text-xs text-muted-foreground">
                Só é possível publicar depois que o vídeo terminar de processar.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border p-4">
          <p className={LABEL}>Arquivo</p>
          {!video ? (
            <p className="text-sm text-muted-foreground">Salve o vídeo para enviar o arquivo.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {video.thumbnail_url && (
                  <img
                    src={video.thumbnail_url}
                    alt=""
                    className="aspect-video w-32 rounded-md object-cover"
                  />
                )}
                {badge && (
                  <Badge variant={badge.variant} size="sm">
                    {uploading ? `Enviando ${Math.round((progress ?? 0) * 100)}%` : badge.label}
                  </Badge>
                )}
                {video.duration_seconds != null && (
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatDuration(video.duration_seconds)}
                  </span>
                )}
              </div>
              {uploading && (
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                  />
                </div>
              )}
              <input
                ref={fileInputRef}
                id="video-file"
                aria-label="Arquivo de vídeo"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = '';
                }}
              />
              <div className="flex gap-2">
                {uploading ? (
                  <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
                    <X size={14} /> Cancelar envio
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    {videoQuery.isFetching ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Upload size={14} />
                    )}
                    {video.stream_uid ? 'Substituir arquivo' : 'Enviar arquivo'}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">MP4 ou MOV, até 200 MB e 15 minutos.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
