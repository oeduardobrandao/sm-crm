import { supabase } from './core';

export interface KbVideoArticleRef {
  slug: string;
  title: string;
}

export interface KbVideo {
  id: number;
  series_id: string;
  title: string;
  slug: string;
  description: string | null;
  display_order: number;
  duration_seconds: number | null;
  hls_url: string;
  thumbnail_url: string | null;
  /** Null when there is no related article, or when it went back to draft (hidden by RLS). */
  article: KbVideoArticleRef | null;
}

export interface KbVideoSeries {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  display_order: number;
  videos: KbVideo[];
}

export interface KbVideoProgress {
  video_id: number;
  position_seconds: number;
  completed_at: string | null;
}

// RLS decides visibility: only published series, and inside them only published + ready videos.
const SERIES_SELECT =
  'id,title,slug,description,display_order,' +
  'videos:kb_videos(id,series_id,title,slug,description,display_order,duration_seconds,hls_url,thumbnail_url,' +
  'article:kb_articles!article_id(slug,title))';

/** Published series with at least one visible video, each with its videos in display order.
 * A published series whose videos are all draft or still processing is dropped here, so no
 * consumer ever sees an empty series. */
export async function getPublishedVideoSeries(): Promise<KbVideoSeries[]> {
  const { data, error } = await supabase
    .from('kb_video_series')
    .select(SERIES_SELECT)
    .order('display_order');
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<Omit<KbVideoSeries, 'videos'> & { videos: KbVideo[] | null }>
  )
    .map((s) => ({
      ...s,
      videos: [...(s.videos ?? [])].sort(
        (a, b) => a.display_order - b.display_order || a.id - b.id,
      ),
    }))
    .filter((s) => s.videos.length > 0);
}

export async function getMyVideoProgress(): Promise<KbVideoProgress[]> {
  const { data, error } = await supabase
    .from('kb_video_progress')
    .select('video_id,position_seconds,completed_at');
  if (error) throw error;
  return (data ?? []) as KbVideoProgress[];
}

export async function saveVideoProgress(
  videoId: number,
  positionSeconds: number,
  completed: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('save_kb_video_progress', {
    p_video_id: videoId,
    p_position: positionSeconds,
    p_completed: completed,
  });
  if (error) throw error;
}
