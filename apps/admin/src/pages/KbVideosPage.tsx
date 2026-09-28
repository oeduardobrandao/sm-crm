import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Film, FolderPlus, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  listKbVideos,
  listKbVideoSeries,
  refreshKbVideo,
  reorderKbVideos,
  type KbVideo,
  type KbVideoSeries,
} from '../lib/api';
import {
  formatDuration,
  groupBySeries,
  KB_VIDEO_SERIES_KEY,
  KB_VIDEOS_KEY,
  needsAutoRefresh,
  processingBadge,
  publishBadge,
  reorderedItems,
} from '../lib/kb-video-status';
import { kbVideoEditPath, kbVideoNewPath } from '../lib/routes';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { RowLink } from '../components/RowLink';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { SeriesDialog } from './kb-videos/SeriesDialog';

const PENDING_POLL_MS = 10_000;

export default function KbVideosPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ series: KbVideoSeries | null } | null>(null);

  const seriesQuery = useQuery({ queryKey: KB_VIDEO_SERIES_KEY, queryFn: listKbVideoSeries });
  const videosQuery = useQuery({
    queryKey: KB_VIDEOS_KEY,
    queryFn: listKbVideos,
    refetchInterval: (query) =>
      query.state.data?.videos.some((v) => v.stream_status === 'pending' && v.stream_uid)
        ? PENDING_POLL_MS
        : false,
  });

  // One refresh-kb-video per stale pending row per page load: covers a missed webhook and
  // uploads abandoned past their expiry.
  const refreshed = useRef(new Set<number>());
  useEffect(() => {
    const now = Date.now();
    for (const v of videosQuery.data?.videos ?? []) {
      if (!needsAutoRefresh(v, now) || refreshed.current.has(v.id)) continue;
      refreshed.current.add(v.id);
      refreshKbVideo(v.id)
        .then(() => qc.invalidateQueries({ queryKey: KB_VIDEOS_KEY }))
        .catch(() => undefined);
    }
  }, [videosQuery.data, qc]);

  const reorderMut = useMutation({
    mutationFn: (items: Array<{ id: number; display_order: number }>) => reorderKbVideos(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: KB_VIDEOS_KEY }),
    onError: () => toast.error('Não foi possível reordenar.'),
  });

  const groups = useMemo(
    () => groupBySeries(seriesQuery.data?.series ?? [], videosQuery.data?.videos ?? []),
    [seriesQuery.data, videosQuery.data],
  );

  const move = (list: KbVideo[], index: number, delta: -1 | 1) => {
    const items = reorderedItems(list, index, delta);
    if (items) reorderMut.mutate(items);
  };

  const isLoading = seriesQuery.isLoading || videosQuery.isLoading;
  const isError = seriesQuery.isError || videosQuery.isError;

  return (
    <div>
      <PageHeader
        title="Vídeos tutoriais"
        description="Playlist da Central de Ajuda do CRM"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDialog({ series: null })}>
              <FolderPlus />
              Nova série
            </Button>
            <Button asChild>
              <Link to={kbVideoNewPath()}>
                <Plus />
                Novo vídeo
              </Link>
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <Card className="p-5">
          <div className="flex flex-col gap-3 py-4">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-64" />
          </div>
        </Card>
      ) : isError ? (
        <Card className="p-5">
          <ErrorState
            message="Não foi possível carregar os vídeos."
            onRetry={() => {
              seriesQuery.refetch();
              videosQuery.refetch();
            }}
          />
        </Card>
      ) : groups.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={Film}
            title="Nenhuma série ainda"
            description="Crie uma série para agrupar os vídeos da playlist."
            action={
              <Button variant="outline" size="sm" onClick={() => setDialog({ series: null })}>
                Nova série
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(({ series, videos }) => {
            const sBadge = publishBadge(series.status);
            return (
              <Card key={series.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{series.title}</h2>
                    <Badge variant={sBadge.variant} size="sm">
                      {sBadge.label}
                    </Badge>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ series })}>
                    <Pencil size={14} />
                    Editar série
                  </Button>
                </div>
                {videos.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">Nenhum vídeo nesta série.</p>
                ) : (
                  videos.map((v, index) => {
                    const pBadge = publishBadge(v.status);
                    const sb = processingBadge(v);
                    const to = kbVideoEditPath(v.id);
                    return (
                      <div
                        key={v.id}
                        onClick={() => navigate(to)}
                        className={cn(
                          '-mx-5 grid cursor-pointer grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 px-5 py-3 transition-colors last:border-b-0 hover:bg-secondary/30',
                          v.status === 'draft' && 'opacity-70',
                        )}
                      >
                        <div className="aspect-video w-16 overflow-hidden rounded-md bg-secondary">
                          {v.thumbnail_url && (
                            <img
                              src={v.thumbnail_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <RowLink to={to} className="block truncate text-sm">
                            {v.title}
                          </RowLink>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="tabular-nums">
                              {formatDuration(v.duration_seconds)}
                            </span>
                            <Badge variant={pBadge.variant} size="sm">
                              {pBadge.label}
                            </Badge>
                            <Badge variant={sb.variant} size="sm">
                              {sb.label}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Mover ${v.title} para cima`}
                            disabled={index === 0 || reorderMut.isPending}
                            onClick={() => move(videos, index, -1)}
                          >
                            <ArrowUp size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Mover ${v.title} para baixo`}
                            disabled={index === videos.length - 1 || reorderMut.isPending}
                            onClick={() => move(videos, index, 1)}
                          >
                            <ArrowDown size={14} />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </Card>
            );
          })}
        </div>
      )}

      {dialog && <SeriesDialog series={dialog.series} onClose={() => setDialog(null)} />}
    </div>
  );
}
