import { fetchWithRetry } from './fetchWithRetry';
import type { PostMedia } from '../store';

export type DownloadableMedia = Pick<PostMedia, 'url' | 'original_filename'>;

/**
 * Saves one media file under its original name.
 *
 * Goes through a blob rather than `<a download href={url}>` because the
 * `download` attribute is ignored for cross-origin urls — the browser would
 * navigate to the image instead of saving it. That makes this path depend on
 * the media proxy's CORS headers.
 */
export async function downloadMedia(media: DownloadableMedia): Promise<void> {
  if (!media.url) throw new Error('Mídia sem URL para download');

  const res = await fetchWithRetry(media.url, { cache: 'no-store' });
  const objUrl = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = media.original_filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}
