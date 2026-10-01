import { supabase } from './core';

export type KbViewTarget = { articleId: string } | { videoId: number };

/** Records one view for the current user. Visibility, 30-minute dedupe and the platform-admin
 * rule all live in the record_kb_view RPC; callers fire and forget. */
export async function recordKbView(target: KbViewTarget): Promise<void> {
  const params =
    'articleId' in target ? { p_article_id: target.articleId } : { p_video_id: target.videoId };
  const { error } = await supabase.rpc('record_kb_view', params);
  if (error) throw error;
}
