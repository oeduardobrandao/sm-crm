import { Skeleton } from '@/components/ui/skeleton';
import { VideoPlaylistBlock } from './VideoPlaylistBlock';
import { useKbVideoSeries, useVideoProgress } from './useKbVideos';

/** Top of /ajuda. Waits for BOTH queries so the first selection sees the user's progress, keeps
 * the block's height while loading, and renders nothing when there is no visible series (or the
 * query failed: articles still work). */
export function VideoPlaylistHero({ requestedSlug }: { requestedSlug: string | null }) {
  const { data: series = [], isLoading, isError } = useKbVideoSeries();
  const { progress, save, isLoading: progressLoading } = useVideoProgress();

  if (isLoading || progressLoading) {
    return <Skeleton aria-hidden className="h-[clamp(220px,32vw,420px)] w-full rounded-2xl" />;
  }
  if (isError || series.length === 0) return null;

  return (
    <VideoPlaylistBlock
      series={series}
      progress={progress}
      onSaveProgress={save}
      requestedSlug={requestedSlug}
      collapsible
    />
  );
}
