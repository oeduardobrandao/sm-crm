import { useCallback, useEffect, useRef, type MutableRefObject, type SyntheticEvent } from 'react';
import { isCompleted, reachedCompletion, resumePosition, type ProgressMap } from './playlist';

/** How often playback position is persisted while the video plays. */
export const SAVE_INTERVAL_MS = 10_000;

export type SaveProgress = (videoId: number, position: number, completed: boolean) => void;

type VideoEvent = SyntheticEvent<HTMLVideoElement>;

export interface PlaybackHandlers {
  onLoadedMetadata: (e: VideoEvent) => void;
  onTimeUpdate: (e: VideoEvent) => void;
  onPause: (e: VideoEvent) => void;
  onEnded: (e: VideoEvent) => void;
}

/** Progress persistence for ONE video's player, shared by the Central de Ajuda stage and the
 * onboarding guide card. The caller keys its player by video id, so every ref starts fresh per
 * video. `positionRef`/`resumeRef` are exposed so a retry can resume where playback failed. */
export function usePlaybackProgress(
  videoId: number,
  progress: ProgressMap,
  onSave: SaveProgress,
  onEnded?: () => void,
): {
  handlers: PlaybackHandlers;
  positionRef: MutableRefObject<number>;
  resumeRef: MutableRefObject<number | null>;
} {
  const saveRef = useRef(onSave);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    saveRef.current = onSave;
    endedRef.current = onEnded;
  });
  const positionRef = useRef(0);
  const lastSaveAtRef = useRef(0);
  const completedRef = useRef(isCompleted(progress, videoId));
  const resumeRef = useRef(resumePosition(progress, videoId));

  useEffect(() => {
    lastSaveAtRef.current = Date.now();
  }, []);

  const flush = useCallback(() => {
    if (positionRef.current > 0) saveRef.current(videoId, positionRef.current, false);
  }, [videoId]);

  // Save on tab close/navigation away and when the player unmounts.
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const handlers: PlaybackHandlers = {
    onLoadedMetadata: (e) => {
      const el = e.currentTarget;
      const resume = resumeRef.current;
      resumeRef.current = null;
      if (resume !== null && (!Number.isFinite(el.duration) || resume < el.duration - 1)) {
        el.currentTime = resume;
      }
    },
    onTimeUpdate: (e) => {
      const el = e.currentTarget;
      positionRef.current = el.currentTime;
      const now = Date.now();
      if (!completedRef.current && reachedCompletion(el.currentTime, el.duration)) {
        completedRef.current = true;
        lastSaveAtRef.current = now;
        saveRef.current(videoId, el.currentTime, true);
        return;
      }
      if (now - lastSaveAtRef.current >= SAVE_INTERVAL_MS) {
        lastSaveAtRef.current = now;
        saveRef.current(videoId, el.currentTime, false);
      }
    },
    onPause: (e) => {
      positionRef.current = e.currentTarget.currentTime;
      if (positionRef.current > 0) {
        lastSaveAtRef.current = Date.now();
        saveRef.current(videoId, positionRef.current, false);
      }
    },
    onEnded: (e) => {
      positionRef.current = e.currentTarget.currentTime;
      completedRef.current = true;
      saveRef.current(videoId, positionRef.current, true);
      endedRef.current?.();
    },
  };

  return { handlers, positionRef, resumeRef };
}
