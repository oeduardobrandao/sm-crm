import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMyVideoProgress,
  getPublishedVideoSeries,
  saveVideoProgress,
  type KbVideoProgress,
} from '@/store/kbVideos';
import { mergeProgress, toProgressMap, type ProgressMap } from './playlist';

export const KB_VIDEO_SERIES_KEY = ['kb-video-series'] as const;
export const KB_VIDEO_PROGRESS_KEY = ['kb-video-progress'] as const;

export function useKbVideoSeries() {
  return useQuery({
    queryKey: KB_VIDEO_SERIES_KEY,
    queryFn: getPublishedVideoSeries,
    staleTime: 5 * 60_000,
  });
}

export function useVideoProgress(): {
  progress: ProgressMap;
  save: (videoId: number, position: number, completed: boolean) => void;
  isLoading: boolean;
} {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KB_VIDEO_PROGRESS_KEY, queryFn: getMyVideoProgress });
  const progress = useMemo(() => toProgressMap(query.data ?? []), [query.data]);

  // Fire-and-forget: a failed save never interrupts the video nor shows a toast (spec). The
  // optimistic cache write keeps the rail's checkmarks in step with what the user just watched.
  // Cancel any in-flight fetch before writing the cache so it doesn't overwrite the optimistic
  // row when it resolves.
  const save = useCallback(
    (videoId: number, position: number, completed: boolean) => {
      void qc.cancelQueries({ queryKey: KB_VIDEO_PROGRESS_KEY });
      qc.setQueryData<KbVideoProgress[]>(KB_VIDEO_PROGRESS_KEY, (old = []) =>
        mergeProgress(old, videoId, position, completed, new Date().toISOString()),
      );
      saveVideoProgress(videoId, position, completed)
        .then(() => {
          void qc.invalidateQueries({ queryKey: KB_VIDEO_PROGRESS_KEY });
        })
        .catch((err) => {
          console.error('[kb-video-progress] save failed', err);
          void qc.invalidateQueries({ queryKey: KB_VIDEO_PROGRESS_KEY });
        });
    },
    [qc],
  );

  return { progress, save, isLoading: query.isLoading };
}
