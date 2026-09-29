import { CheckCircle2, Circle, PlayCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { KbVideoSeries } from '@/store/kbVideos';
import { completedCount, formatDuration, isCompleted, type ProgressMap } from './playlist';

interface VideoRailProps {
  series: KbVideoSeries[];
  currentSeries: KbVideoSeries;
  currentVideoId: number;
  progress: ProgressMap;
  onSelectSeries: (seriesId: string) => void;
  onSelectVideo: (videoId: number) => void;
}

export function VideoRail({
  series,
  currentSeries,
  currentVideoId,
  progress,
  onSelectSeries,
  onSelectVideo,
}: VideoRailProps) {
  const done = completedCount(currentSeries, progress);
  const total = currentSeries.videos.length;

  return (
    <div className="flex min-w-0 flex-col gap-3 self-start rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="flex items-center justify-between gap-3">
        {series.length > 1 ? (
          <Select value={currentSeries.id} onValueChange={onSelectSeries}>
            <SelectTrigger aria-label="Série de vídeos" className="h-9 min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {series.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="min-w-0 truncate text-[0.95rem] font-semibold text-[var(--text-main)]">
            {currentSeries.title}
          </p>
        )}
        <span className="shrink-0 text-[0.78rem] tabular-nums text-[var(--text-light)]">
          {done} de {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Progresso da série"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 overflow-hidden rounded-full bg-[var(--border-color)]"
      >
        <div
          className="h-full rounded-full bg-[var(--primary-color)] transition-[width]"
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>
      <ol className="flex flex-col gap-0.5">
        {currentSeries.videos.map((video, index) => {
          const isCurrent = video.id === currentVideoId;
          const completed = isCompleted(progress, video.id);
          const Icon = isCurrent ? PlayCircle : completed ? CheckCircle2 : Circle;
          return (
            <li key={video.id}>
              <button
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => onSelectVideo(video.id)}
                className={cn(
                  'grid w-full grid-cols-[18px_20px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 text-left text-[0.82rem] transition-colors',
                  isCurrent
                    ? 'bg-[rgba(var(--primary-rgb),0.14)] font-semibold text-[var(--text-main)]'
                    : 'text-[var(--text-light)] hover:bg-[var(--surface-hover)]',
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    'h-4 w-4',
                    isCurrent
                      ? 'text-[var(--text-main)]'
                      : completed
                        ? 'text-[var(--success)]'
                        : 'opacity-50',
                  )}
                />
                <span className="tabular-nums">{index + 1}</span>
                <span className="truncate">{video.title}</span>
                <span className="tabular-nums text-[0.75rem]">
                  {formatDuration(video.duration_seconds)}
                </span>
                {completed && <span className="sr-only">(assistido)</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
