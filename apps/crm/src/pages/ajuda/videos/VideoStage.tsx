import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { VideoPlayer } from '@mesaas/ui/VideoPlayer';
import { Button } from '@/components/ui/button';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import { NextUpOverlay } from './NextUpOverlay';
import { nextInSeries, type ProgressMap } from './playlist';
import { usePlaybackProgress } from './usePlaybackProgress';

interface VideoStageProps {
  video: KbVideo;
  series: KbVideoSeries;
  progress: ProgressMap;
  autoPlay: boolean;
  onSaveProgress: (videoId: number, position: number, completed: boolean) => void;
  onPlayNext: (next: KbVideo) => void;
}

/** Player + metadata for ONE video. The parent keys it by video id, so every ref below starts
 * fresh per video. */
export function VideoStage({
  video,
  series,
  progress,
  autoPlay,
  onSaveProgress,
  onPlayNext,
}: VideoStageProps) {
  const [endState, setEndState] = useState<'playing' | 'next' | 'done'>('playing');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const next = nextInSeries(series, video.id);
  const { handlers, positionRef, resumeRef } = usePlaybackProgress(
    video.id,
    progress,
    onSaveProgress,
    () => setEndState(next ? 'next' : 'done'),
  );

  return (
    <div className="min-w-0 space-y-3">
      <div className="relative aspect-video w-full max-w-full overflow-hidden rounded-2xl bg-black">
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
                // Resumes the retry where playback actually failed, instead of restarting at 0.
                // the hook's onLoadedMetadata handler consumes resumeRef.current once the new attempt loads.
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
            autoPlay={autoPlay || attempt > 0}
            className="h-full w-full"
            {...handlers}
            onFatalError={() => setFailed(true)}
          />
        )}
        {endState === 'next' && next && (
          <NextUpOverlay
            title={next.title}
            onGo={() => onPlayNext(next)}
            onCancel={() => setEndState('playing')}
          />
        )}
        {endState === 'done' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center text-white">
            <p className="text-[1.05rem] font-semibold">Série concluída</p>
            <Button
              size="sm"
              variant="outline"
              className="text-foreground"
              onClick={() => {
                setEndState('playing');
                setAttempt((a) => a + 1);
              }}
            >
              Assistir de novo
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-[0.72rem] font-semibold uppercase tracking-wider text-[var(--text-light)]">
          {series.title}
        </p>
        <h2 className="text-[1.15rem] font-bold text-[var(--text-main)] font-[var(--font-heading)]">
          {video.title}
        </h2>
        {video.article && (
          <Link
            to={`/ajuda/${video.article.slug}`}
            className="inline-flex items-center gap-1.5 text-[0.82rem] font-medium text-[var(--text-main)] underline-offset-4 hover:underline"
          >
            <FileText className="h-3.5 w-3.5" />
            Ler artigo
          </Link>
        )}
        {video.description && (
          <p className="max-w-[65ch] text-[0.85rem] leading-relaxed text-[var(--text-light)]">
            {video.description}
          </p>
        )}
      </div>
    </div>
  );
}
