import type { ReactNode } from 'react';
import type { KbVideo, KbVideoSeries, KbViewStatsEntry } from '../../lib/api';

export interface KbVideoGroup {
  series: KbVideoSeries;
  videos: KbVideo[];
}

/** What KbVideosPage hands to the phone and desktop views. Data and handlers only. */
export interface KbVideosViewProps {
  groups: KbVideoGroup[];
  /** Loading, error or empty state to show in place of the series list; null when ready. */
  statusBody: ReactNode;
  statsFor: (videoId: number) => KbViewStatsEntry | undefined;
  statsLoading: boolean;
  statsFailed: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  selected: ReadonlySet<number>;
  onToggleOne: (id: number) => void;
  onToggleGroup: (ids: number[]) => void;
  onMove: (list: KbVideo[], index: number, delta: -1 | 1) => void;
  reorderPending: boolean;
  onNewSeries: () => void;
  onEditSeries: (series: KbVideoSeries) => void;
}

/** "Enviar vídeo" from a series opens the editor with that series preselected. */
export function newVideoInSeriesPath(base: string, seriesId: string): string {
  return `${base}?series=${encodeURIComponent(seriesId)}`;
}
