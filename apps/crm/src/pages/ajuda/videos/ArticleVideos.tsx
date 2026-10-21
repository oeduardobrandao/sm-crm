import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListVideo } from 'lucide-react';
import { VideoPlayer } from '@mesaas/ui/VideoPlayer';
import { Button } from '@/components/ui/button';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import { formatDuration, videosForArticle, type ProgressMap } from './playlist';
import { useKbVideoSeries, useVideoProgress } from './useKbVideos';
import { usePlaybackProgress, type SaveProgress } from './usePlaybackProgress';
import { recordKbViewSafely } from '../useRecordKbView';

/** Tutorials linked to this article (kb_videos.article_id), played inline at the top of the
 * article. Renders nothing while loading, on error, or when no visible video points here. */
export function ArticleVideos({ articleSlug }: { articleSlug: string }) {
  const { data: series = [] } = useKbVideoSeries();
  const { progress, save, isLoading: progressLoading } = useVideoProgress();
  const videos = useMemo(() => videosForArticle(series, articleSlug), [series, articleSlug]);

  // The saved position seeds the player once, at mount: render only after progress arrived.
  if (videos.length === 0 || progressLoading) return null;

  return (
    <div className="mb-8 space-y-6">
      {videos.map((video) => (
        <ArticleVideo
          key={video.id}
          video={video}
          series={series.find((s) => s.id === video.series_id) ?? null}
          progress={progress}
          onSave={save}
        />
      ))}
    </div>
  );
}

function ArticleVideo({
  video,
  series,
  progress,
  onSave,
}: {
  video: KbVideo;
  series: KbVideoSeries | null;
  progress: ProgressMap;
  onSave: SaveProgress;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { handlers, positionRef, resumeRef } = usePlaybackProgress(video.id, progress, onSave);
  // Survives a retry (the player remounts by `attempt`, this component does not).
  const playedRef = useRef(false);
  const duration = formatDuration(video.duration_seconds);

  const handlePlay = () => {
    if (playedRef.current) return;
    playedRef.current = true;
    recordKbViewSafely({ videoId: video.id });
  };

  return (
    <section aria-label={`Vídeo: ${video.title}`} className="space-y-2.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
        {failed ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white"
          >
            <p className="text-[0.9rem]">Não foi possível carregar este vídeo.</p>
            <Button
              size="sm"
              variant="outline"
              className="text-foreground"
              onClick={() => {
                resumeRef.current =
                  positionRef.current > 0 ? positionRef.current : resumeRef.current;
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            >
              Tentar novamente
            </Button>
          </div>
        ) : (
          <VideoPlayer
            key={attempt}
            hlsSrc={video.hls_url}
            src={video.hls_url}
            poster={video.thumbnail_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            autoPlay={attempt > 0}
            className="h-full w-full"
            {...handlers}
            onPlay={handlePlay}
            onFatalError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[0.82rem]">
        <p className="min-w-0 text-[var(--text-light)]">
          <span className="font-semibold text-[var(--text-main)]">{video.title}</span>
          {duration && <span className="tabular-nums"> · {duration}</span>}
        </p>
        {series && (
          <Link
            to={`/ajuda/video/${video.slug}`}
            className="inline-flex items-center gap-1.5 font-medium text-[var(--text-main)] underline-offset-4 hover:underline"
          >
            <ListVideo className="h-3.5 w-3.5" />
            Ver a série {series.title}
          </Link>
        )}
      </div>
    </section>
  );
}
