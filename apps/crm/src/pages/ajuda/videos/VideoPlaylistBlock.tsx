import { useEffect, useRef, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import {
  allCompleted,
  firstUnwatched,
  pickInitial,
  resolveSelection,
  type PlaylistSelection,
  type ProgressMap,
} from './playlist';
import { VideoRail } from './VideoRail';
import { VideoStage } from './VideoStage';

export interface VideoPlaylistBlockProps {
  /** Only series with at least one visible video (getPublishedVideoSeries guarantees it). */
  series: KbVideoSeries[];
  progress: ProgressMap;
  onSaveProgress: (videoId: number, position: number, completed: boolean) => void;
  requestedSlug?: string | null;
  /** Hero on /ajuda: shrink to a slim bar when everything was already watched. */
  collapsible?: boolean;
  onVideoChange?: (video: KbVideo) => void;
}

export function VideoPlaylistBlock({
  series,
  progress,
  onSaveProgress,
  requestedSlug = null,
  collapsible = false,
  onVideoChange,
}: VideoPlaylistBlockProps) {
  const [selection, setSelection] = useState<PlaylistSelection | null>(() =>
    pickInitial(series, progress, requestedSlug),
  );
  // Decided once at mount: finishing the last video mid-session must not collapse the player.
  const [collapsed, setCollapsed] = useState(
    () => collapsible && !requestedSlug && allCompleted(series, progress),
  );
  const [autoPlay, setAutoPlay] = useState(false);

  const resolved =
    resolveSelection(series, selection) ??
    resolveSelection(series, pickInitial(series, progress, null));

  const onVideoChangeRef = useRef(onVideoChange);
  useEffect(() => {
    onVideoChangeRef.current = onVideoChange;
  });
  const currentVideo = resolved?.video ?? null;
  useEffect(() => {
    if (currentVideo) onVideoChangeRef.current?.(currentVideo);
  }, [currentVideo]);

  if (!resolved) return null;

  const select = (seriesId: string, videoId: number, play: boolean) => {
    setSelection({ seriesId, videoId });
    setAutoPlay(play);
  };

  if (collapsed) {
    return (
      <section
        aria-label="Tutoriais em vídeo"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] px-5 py-3.5"
      >
        <div className="flex items-center gap-3">
          <PlayCircle aria-hidden className="h-5 w-5 text-[var(--text-light)]" />
          <div>
            <p className="text-[0.9rem] font-semibold text-[var(--text-main)]">
              Tutoriais em vídeo
            </p>
            <p className="text-[0.78rem] text-[var(--text-light)]">
              Você já assistiu todos os vídeos.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCollapsed(false)}>
          Rever
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-label="Tutoriais em vídeo"
      className="grid gap-5 min-[901px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"
    >
      <VideoStage
        key={resolved.video.id}
        video={resolved.video}
        series={resolved.series}
        progress={progress}
        autoPlay={autoPlay}
        onSaveProgress={onSaveProgress}
        onPlayNext={(next) => select(resolved.series.id, next.id, true)}
      />
      <VideoRail
        series={series}
        currentSeries={resolved.series}
        currentVideoId={resolved.video.id}
        progress={progress}
        onSelectSeries={(seriesId) => {
          const target = series.find((s) => s.id === seriesId);
          if (!target) return;
          const video = firstUnwatched(target, progress) ?? target.videos[0];
          if (video) select(target.id, video.id, false);
        }}
        onSelectVideo={(videoId) => select(resolved.series.id, videoId, false)}
      />
    </section>
  );
}
