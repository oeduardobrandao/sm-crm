import { describe, expect, it } from 'vitest';
import type { KbVideo, KbVideoSeries } from '@/store/kbVideos';
import {
  allCompleted,
  completedCount,
  filterVideos,
  formatDuration,
  mergeProgress,
  nextInSeries,
  nextSeriesWithUnwatched,
  pickInitial,
  reachedCompletion,
  resolveSelection,
  resumePosition,
  toProgressMap,
  videosForArticle,
} from '../playlist';

function v(id: number, seriesId: string, title = `Vídeo ${id}`): KbVideo {
  return {
    id,
    series_id: seriesId,
    title,
    slug: `video-${id}`,
    description: null,
    display_order: id,
    duration_seconds: 60,
    hls_url: `https://h/${id}.m3u8`,
    thumbnail_url: null,
    article: null,
  };
}

const series: KbVideoSeries[] = [
  {
    id: 's1',
    title: 'Primeiros passos',
    slug: 'pp',
    description: null,
    display_order: 1,
    videos: [v(1, 's1', 'Primeiro acesso'), v(2, 's1', 'Relatório mensal')],
  },
  {
    id: 's2',
    title: 'Relatórios',
    slug: 'rel',
    description: null,
    display_order: 2,
    videos: [v(3, 's2')],
  },
];
const done = (id: number) => ({
  video_id: id,
  position_seconds: 60,
  completed_at: '2026-09-28T10:00:00Z',
});

describe('pickInitial', () => {
  it('starts at the first unwatched video of the first unfinished series', () => {
    expect(pickInitial(series, toProgressMap([]))).toEqual({ seriesId: 's1', videoId: 1 });
    expect(pickInitial(series, toProgressMap([done(1)]))).toEqual({ seriesId: 's1', videoId: 2 });
    expect(pickInitial(series, toProgressMap([done(1), done(2)]))).toEqual({
      seriesId: 's2',
      videoId: 3,
    });
  });
  it('honours a requested slug first', () => {
    expect(pickInitial(series, toProgressMap([]), 'video-3')).toEqual({
      seriesId: 's2',
      videoId: 3,
    });
  });
  it('falls back to the first video when everything was watched, and to null with no series', () => {
    expect(pickInitial(series, toProgressMap([done(1), done(2), done(3)]))).toEqual({
      seriesId: 's1',
      videoId: 1,
    });
    expect(pickInitial([], toProgressMap([]))).toBeNull();
  });
});

describe('completion', () => {
  it('counts completed videos per series and across all series', () => {
    const p = toProgressMap([done(1)]);
    expect(completedCount(series[0], p)).toBe(1);
    expect(allCompleted(series, p)).toBe(false);
    expect(allCompleted(series, toProgressMap([done(1), done(2), done(3)]))).toBe(true);
  });
  it('an empty list is never "all completed"', () => {
    expect(allCompleted([], toProgressMap([]))).toBe(false);
  });
  it('reaches completion at 90% of a known duration', () => {
    expect(reachedCompletion(89, 100)).toBe(false);
    expect(reachedCompletion(90, 100)).toBe(true);
    expect(reachedCompletion(10, NaN)).toBe(false);
    expect(reachedCompletion(10, 0)).toBe(false);
  });
});

describe('navigation', () => {
  it('resolves a selection and finds the next video in the same series', () => {
    expect(resolveSelection(series, { seriesId: 's1', videoId: 2 })?.video.id).toBe(2);
    expect(resolveSelection(series, { seriesId: 's1', videoId: 99 })).toBeNull();
    expect(nextInSeries(series[0], 1)?.id).toBe(2);
    expect(nextInSeries(series[0], 2)).toBeNull();
  });
});

describe('progress', () => {
  it('resumes only an unfinished video with a saved position', () => {
    expect(
      resumePosition(toProgressMap([{ video_id: 1, position_seconds: 20, completed_at: null }]), 1),
    ).toBe(20);
    expect(resumePosition(toProgressMap([done(1)]), 1)).toBeNull();
    expect(resumePosition(toProgressMap([]), 1)).toBeNull();
  });
  it('merges a save optimistically without ever clearing completed_at', () => {
    const rows = mergeProgress([done(1)], 1, 5, false, '2026-09-28T12:00:00Z');
    expect(rows).toEqual([
      { video_id: 1, position_seconds: 5, completed_at: '2026-09-28T10:00:00Z' },
    ]);
    const added = mergeProgress([], 2, 54, true, '2026-09-28T12:00:00Z');
    expect(added).toEqual([
      { video_id: 2, position_seconds: 54, completed_at: '2026-09-28T12:00:00Z' },
    ]);
  });
});

describe('formatDuration', () => {
  it('formats m:ss', () => {
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(null)).toBe('');
  });
});

describe('filterVideos', () => {
  it('matches titles ignoring accents and reports the series', () => {
    const hits = filterVideos(series, 'relatorio');
    expect(hits.map((h) => h.video.id)).toEqual([2]);
    expect(hits[0].seriesTitle).toBe('Primeiros passos');
    expect(filterVideos(series, '  ')).toEqual([]);
  });
});

describe('nextSeriesWithUnwatched', () => {
  it('hands off to the next series that still has something to watch', () => {
    expect(nextSeriesWithUnwatched(series, 's1', toProgressMap([]))?.id).toBe('s2');
  });

  it('never offers the current series and skips fully watched ones', () => {
    expect(nextSeriesWithUnwatched(series, 's2', toProgressMap([]))?.id).toBe('s1');
    expect(nextSeriesWithUnwatched(series, 's1', toProgressMap([done(3)]))).toBeNull();
  });
});

describe('videosForArticle', () => {
  it('returns the videos linked to the article across series', () => {
    const linked: KbVideoSeries[] = [
      { ...series[0], videos: [{ ...v(1, 's1'), article: { slug: 'relatorios', title: 'R' } }] },
      { ...series[1], videos: [{ ...v(3, 's2'), article: { slug: 'relatorios', title: 'R' } }] },
    ];
    expect(videosForArticle(linked, 'relatorios').map((x) => x.id)).toEqual([1, 3]);
    expect(videosForArticle(linked, 'outro')).toEqual([]);
  });
});
