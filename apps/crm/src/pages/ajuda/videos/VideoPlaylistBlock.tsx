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
  /** First play of each video; used to record a Central de Ajuda view. */
  onFirstPlay?: (videoId: number) => void;
}

export function VideoPlaylistBlock({
  series,
  progress,
  onSaveProgress,
  requestedSlug = null,
  collapsible = false,
  onVideoChange,
  onFirstPlay,
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

  // Keeps the shown video in sync with the URL slug when it changes from OUTSIDE this component
  // (e.g. a Link to another /ajuda/video/:slug). Internal navigation (rail click, "next video")
  // also ends up changing the URL via onVideoChange -> navigate(replace), but by the time that
  // reaches back down here as a new `requestedSlug`, `resolved.video.slug` already matches it, so
  // this no-ops. Deps are ONLY [requestedSlug] on purpose: right after an internal `select()`,
  // there is a render where `resolved.video.slug` is the new video but `requestedSlug` (URL) is
  // still the old one. If `resolved`/`selection` were in the deps, the effect would re-run on
  // that render, see the mismatch, and revert the selection we just made with pickInitial(old
  // slug) before the URL catches up.
  useEffect(() => {
    if (!requestedSlug || resolved?.video.slug === requestedSlug) return;
    const picked = pickInitial(series, progress, requestedSlug);
    if (picked) {
      setSelection(picked);
      setAutoPlay(false); // external navigation never autoplays, same as the initial mount
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSlug]);

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
        onFirstPlay={onFirstPlay}
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
