import { useEffect } from 'react';
import { recordKbView, type KbViewTarget } from '@/store/kbViews';

/** Fire-and-forget: a failed record never toasts nor affects reading (spec). */
export function recordKbViewSafely(target: KbViewTarget): void {
  recordKbView(target).catch((err) => console.debug('[kb-view] record failed', err));
}

/** Records one view per published article id shown. The server dedupes repeats within 30
 * minutes, which also absorbs StrictMode's double effect in dev. */
export function useRecordArticleView(
  article: { id: string; status: string } | null | undefined,
): void {
  const id = article?.id;
  const published = article?.status === 'published';
  useEffect(() => {
    if (id && published) recordKbViewSafely({ articleId: id });
  }, [id, published]);
}
