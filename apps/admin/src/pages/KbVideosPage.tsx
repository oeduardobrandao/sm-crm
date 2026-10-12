import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film } from 'lucide-react';
import { toast } from 'sonner';
import {
  listKbVideos,
  listKbVideoSeries,
  refreshKbVideo,
  reorderKbVideos,
  upsertKbVideo,
  type KbVideo,
  type KbVideoSeries,
} from '../lib/api';
import { useKbViewStats } from '../lib/kb-view-stats';
import {
  bulkResultMessage,
  runBulk,
  toggleGroup,
  toggleOne,
  visibleSelection,
  type PublishStatus,
} from '../lib/kb-bulk';
import {
  groupBySeries,
  KB_VIDEO_SERIES_KEY,
  KB_VIDEOS_KEY,
  needsAutoRefresh,
  reorderedItems,
} from '../lib/kb-video-status';
import { cn } from '../lib/utils';
import { useIsPhone } from '../hooks/useIsPhone';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { KbBulkBar } from '../components/KbBulkBar';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { SeriesDialog } from './kb-videos/SeriesDialog';
import { KbVideosDesktop } from './kb-videos/KbVideosDesktop';
import { KbVideosPhone } from './kb-videos/KbVideosPhone';

const PENDING_POLL_MS = 10_000;
const AUTO_REFRESH_RETRY_MS = 60_000;

export default function KbVideosPage() {
  const isPhone = useIsPhone();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ series: KbVideoSeries | null } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  const seriesQuery = useQuery({ queryKey: KB_VIDEO_SERIES_KEY, queryFn: listKbVideoSeries });
  const videosQuery = useQuery({
    queryKey: KB_VIDEOS_KEY,
    queryFn: listKbVideos,
    refetchInterval: (query) =>
      query.state.data?.videos.some((v) => v.stream_status === 'pending' && v.stream_uid)
        ? PENDING_POLL_MS
        : false,
  });
  const viewStats = useKbViewStats();

  // refresh-kb-video for each stale pending row, at most once a minute per row while the list
  // is open: covers a missed webhook (Stream may still say inprogress on the first try) and
  // uploads abandoned past their expiry. Keyed on dataUpdatedAt, not data: a poll that returns
  // identical rows keeps the same data reference under structural sharing.
  const lastRefreshAt = useRef(new Map<number, number>());
  useEffect(() => {
    const now = Date.now();
    for (const v of videosQuery.data?.videos ?? []) {
      if (!needsAutoRefresh(v, now)) continue;
      const last = lastRefreshAt.current.get(v.id);
      if (last !== undefined && now - last < AUTO_REFRESH_RETRY_MS) continue;
      lastRefreshAt.current.set(v.id, now);
      refreshKbVideo(v.id)
        .then(() => qc.invalidateQueries({ queryKey: KB_VIDEOS_KEY }))
        .catch(() => undefined);
    }
  }, [videosQuery.data, videosQuery.dataUpdatedAt, qc]);

  const reorderMut = useMutation({
    mutationFn: (items: Array<{ id: number; display_order: number }>) => reorderKbVideos(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: KB_VIDEOS_KEY }),
    onError: () => toast.error('Não foi possível reordenar.'),
  });

  // Publishing still goes through upsert-kb-video one row at a time, so a video that isn't ready
  // yet is refused by the server and counted as a failure instead of going live broken.
  const bulkMut = useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: PublishStatus }) =>
      runBulk(ids, (id) => upsertKbVideo({ video_id: id, status })),
    onSuccess: (result, { status }) => {
      const message = bulkResultMessage(status, result);
      if (result.failed > 0 && status === 'published') {
        toast.error(`${message} Só vídeos com o arquivo pronto podem ser publicados.`);
      } else if (result.failed > 0) toast.error(message);
      else toast.success(message);
      setSelected(new Set());
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KB_VIDEOS_KEY }),
  });

  const groups = useMemo(
    () => groupBySeries(seriesQuery.data?.series ?? [], videosQuery.data?.videos ?? []),
    [seriesQuery.data, videosQuery.data],
  );

  const move = (list: KbVideo[], index: number, delta: -1 | 1) => {
    if (reorderMut.isPending) return;
    const items = reorderedItems(list, index, delta);
    if (items) reorderMut.mutate(items);
  };

  const actionable = visibleSelection(
    selected,
    groups.flatMap((g) => g.videos.map((v) => v.id)),
  );

  const toggleSelectMode = () => {
    setSelectMode((on) => !on);
    setSelected(new Set());
  };

  const isLoading = seriesQuery.isLoading || videosQuery.isLoading;
  const isError = seriesQuery.isError || videosQuery.isError;

  const statusBody = isLoading ? (
    <Card className="p-5">
      <div className="flex flex-col gap-3 py-4">
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
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
  ) : null;

  const View = isPhone ? KbVideosPhone : KbVideosDesktop;

  return (
    // Desktop: room under the last row so the floating bulk bar never covers it. The phone
    // bar leaves its own in-flow spacer.
    <div className={cn(!isPhone && actionable.length > 0 && 'pb-20')}>
      <View
        groups={groups}
        statusBody={statusBody}
        statsFor={(id) => viewStats.data?.videos[String(id)]}
        statsLoading={viewStats.isLoading}
        statsFailed={viewStats.isError}
        selectMode={selectMode}
        onToggleSelectMode={toggleSelectMode}
        selected={selected}
        onToggleOne={(id) => setSelected((prev) => toggleOne(prev, id))}
        onToggleGroup={(ids) => setSelected((prev) => toggleGroup(prev, ids))}
        onMove={move}
        reorderPending={reorderMut.isPending}
        onNewSeries={() => setDialog({ series: null })}
        onEditSeries={(series) => setDialog({ series })}
      />

      <KbBulkBar
        count={actionable.length}
        pending={bulkMut.isPending}
        onSetStatus={(status) => bulkMut.mutate({ ids: actionable, status })}
        onClear={() => setSelected(new Set())}
      />

      {dialog && <SeriesDialog series={dialog.series} onClose={() => setDialog(null)} />}
    </div>
  );
}
