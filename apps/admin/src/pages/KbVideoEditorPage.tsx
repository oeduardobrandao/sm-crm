import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
  KB_VIDEO_SERIES_KEY,
  KB_VIDEOS_KEY,
  kbVideoKey,
  processingBadge,
} from '../lib/kb-video-status';
import { kbVideoEditPath, kbVideosPath } from '../lib/routes';
import { slugify } from '../lib/slugify';
import { uploadKbVideo, validateVideoFile } from '../lib/stream-upload';
import { useIsPhone } from '../hooks/useIsPhone';
import { slugProblem } from './kb-videos/fields';
import type { EditorValues } from './kb-videos/editor-view';
import { KbVideoEditorDesktop } from './kb-videos/KbVideoEditorDesktop';
import { KbVideoEditorPhone } from './kb-videos/KbVideoEditorPhone';
const PENDING_POLL_MS = 10_000;

export default function KbVideoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  // Só dígitos: parseInt sozinho aceitaria "12abc" como 12 e abriria outro vídeo.
  const parsedId = id && /^[1-9][0-9]*$/.test(id) ? parseInt(id, 10) : NaN;
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

  // "Enviar vídeo" on a series opens a new video with that series preselected (?series=<id>).
  const requestedSeries = searchParams.get('series');
  useEffect(() => {
    if (isEdit || seriesId || !seriesData?.series.length) return;
    const requested = seriesData.series.find((s) => s.id === requestedSeries);
    setSeriesId((requested ?? seriesData.series[0]).id);
  }, [isEdit, seriesId, seriesData, requestedSeries]);

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

  const slugError = slugProblem(slug);

  // The ready+HLS requirement only gates a TRANSITION into "Publicado". A video that is already
  // published stays publishable even while a replacement file is mid-processing (stream_status
  // pending): create-kb-video-upload deletes the old Stream uid and nulls hls_url right away, so
  // the published video is hidden from the site while the new file processes, and it reappears
  // automatically once the refresh marks it ready again. A cancelled or expired replacement
  // leaves it hidden until the next upload.
  const savedStatus: KbVideo['status'] = video?.status ?? 'draft';
  const isReady = !!video && video.stream_status === 'ready' && !!video.hls_url;
  const publishLocked = savedStatus !== 'published' && !isReady;

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

  const values: EditorValues = {
    title,
    slug,
    description,
    seriesId,
    articleId,
    displayOrder,
    status,
  };
  const onChange = (patch: Partial<EditorValues>) => {
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.slug !== undefined) setSlug(patch.slug);
    if (patch.description !== undefined) setDescription(patch.description);
    if (patch.seriesId !== undefined) setSeriesId(patch.seriesId);
    if (patch.articleId !== undefined) setArticleId(patch.articleId);
    if (patch.displayOrder !== undefined) setDisplayOrder(patch.displayOrder);
    if (patch.status !== undefined) setStatus(patch.status);
  };

  const View = isPhone ? KbVideoEditorPhone : KbVideoEditorDesktop;
  return (
    <View
      isEdit={isEdit}
      video={video}
      values={values}
      onChange={onChange}
      seriesOptions={(seriesData?.series ?? []).map((s) => ({ id: s.id, title: s.title }))}
      articleOptions={(articlesData?.articles ?? []).map((a) => ({ id: a.id, title: a.title }))}
      slugError={slugError}
      publishLocked={publishLocked}
      badge={badge}
      progress={progress}
      fileInputRef={fileInputRef}
      onFile={handleFile}
      onCancelUpload={() => abortRef.current?.abort()}
      fetching={videoQuery.isFetching}
      onSave={() => saveMut.mutate()}
      saving={saveMut.isPending}
      saveDisabled={!title || !slug || !seriesId || !!slugError}
      onDelete={() => {
        if (confirm('Excluir este vídeo? O arquivo também é removido do Stream.'))
          deleteMut.mutate();
      }}
      deleting={deleteMut.isPending}
    />
  );
}
