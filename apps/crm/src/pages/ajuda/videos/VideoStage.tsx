import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { VideoPlayer } from '@mesaas/ui/VideoPlayer';
import { Button } from '@/components/ui/button';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import { NextUpOverlay } from './NextUpOverlay';
import {
  isCompleted,
  nextInSeries,
  reachedCompletion,
  resumePosition,
  type ProgressMap,
} from './playlist';

/** How often playback position is persisted while the video plays. */
const SAVE_INTERVAL_MS = 10_000;

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

  const saveRef = useRef(onSaveProgress);
  useEffect(() => {
    saveRef.current = onSaveProgress;
  });
  const positionRef = useRef(0);
  const lastSaveAtRef = useRef(0);
  const completedRef = useRef(isCompleted(progress, video.id));
  const resumeRef = useRef(resumePosition(progress, video.id));

  useEffect(() => {
    lastSaveAtRef.current = Date.now();
  }, []);

  const flush = useCallback(() => {
    if (positionRef.current > 0) saveRef.current(video.id, positionRef.current, false);
  }, [video.id]);

  // Save on tab close/navigation away and when this stage unmounts (video switch, leaving /ajuda).
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const next = nextInSeries(series, video.id);

  const handleLoadedMetadata = (e: SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    const resume = resumeRef.current;
    resumeRef.current = null;
    if (resume !== null && (!Number.isFinite(el.duration) || resume < el.duration - 1)) {
      el.currentTime = resume;
    }
  };

  const handleTimeUpdate = (e: SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    positionRef.current = el.currentTime;
    const now = Date.now();
    if (!completedRef.current && reachedCompletion(el.currentTime, el.duration)) {
      completedRef.current = true;
      lastSaveAtRef.current = now;
      saveRef.current(video.id, el.currentTime, true);
      return;
    }
    if (now - lastSaveAtRef.current >= SAVE_INTERVAL_MS) {
      lastSaveAtRef.current = now;
      saveRef.current(video.id, el.currentTime, false);
    }
  };

  const handlePause = (e: SyntheticEvent<HTMLVideoElement>) => {
    positionRef.current = e.currentTarget.currentTime;
    if (positionRef.current > 0) {
      lastSaveAtRef.current = Date.now();
      saveRef.current(video.id, positionRef.current, false);
    }
  };

  const handleEnded = (e: SyntheticEvent<HTMLVideoElement>) => {
    positionRef.current = e.currentTarget.currentTime;
    completedRef.current = true;
    saveRef.current(video.id, positionRef.current, true);
    setEndState(next ? 'next' : 'done');
  };

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
                // handleLoadedMetadata consumes resumeRef.current once the new attempt loads.
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
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPause={handlePause}
            onEnded={handleEnded}
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
