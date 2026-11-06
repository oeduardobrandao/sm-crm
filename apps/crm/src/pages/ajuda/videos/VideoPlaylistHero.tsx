import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import type { KbVideo } from '@/store/kbVideos';
import { VideoPlaylistBlock } from './VideoPlaylistBlock';
import { useKbVideoSeries, useVideoProgress } from './useKbVideos';
import { recordKbViewSafely } from '../useRecordKbView';

/** Top of /ajuda. Waits for BOTH queries so the first selection sees the user's progress, keeps
 * the block's height while loading, and renders nothing when there is no visible series (or the
 * query failed: articles still work). */
export function VideoPlaylistHero({ requestedSlug }: { requestedSlug: string | null }) {
  const { data: series = [], isLoading, isError } = useKbVideoSeries();
  const { progress, save, isLoading: progressLoading } = useVideoProgress();
  const [, setSearchParams] = useSearchParams();
  const firstChange = useRef(true);

  // Keep ?video= on the shown video so the address can be copied and shared. The block's first
  // pick on a plain /ajuda (first unwatched video) leaves the URL alone; every later switch, and
  // a ?video= that resolved to another video, writes it. replace: switching videos adds no history.
  const handleVideoChange = (video: KbVideo) => {
    const first = firstChange.current;
    firstChange.current = false;
    if (first && !requestedSlug) return;
    setSearchParams(
      (prev) => {
        if (prev.get('video') === video.slug) return prev;
        const next = new URLSearchParams(prev);
        next.set('video', video.slug);
        return next;
      },
      { replace: true },
    );
  };

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
      onVideoChange={handleVideoChange}
      onFirstPlay={(videoId) => recordKbViewSafely({ videoId })}
    />
  );
}
