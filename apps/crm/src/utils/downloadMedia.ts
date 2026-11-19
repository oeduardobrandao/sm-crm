import { i18n } from '@mesaas/i18n';
import { toast } from 'sonner';
import { isNativeApp } from '../native/platform';
import { getMesaasNative, hasMesaasNativeMethod } from '../native/mesaasNative';
import { fetchWithRetry } from './fetchWithRetry';
import type { PostMedia } from '../store';

export type DownloadableMedia = Pick<PostMedia, 'url' | 'original_filename'>;

/**
 * What happened to a download, so callers only claim success when something was saved.
 * - `saved`: the browser got a file download.
 * - `shared`: the iOS app's share sheet finished (Save Image, Save to Files...).
 * - `cancelled`: the user closed the share sheet.
 * - `pending`: the file is downloaded but the share sheet could not open; a toast asks
 *   for another tap, which shares it at once.
 */
export type DownloadOutcome = 'saved' | 'shared' | 'cancelled' | 'pending';

/**
 * Saves one media file under its original name.
 *
 * On the web it goes through a blob rather than `<a download href={url}>` because the
 * `download` attribute is ignored for cross-origin urls — the browser would navigate to
 * the image instead of saving it. That makes this path depend on the media proxy's CORS
 * headers.
 *
 * In the iOS app a blob link does nothing: Capacitor's navigation handler cancels the
 * `blob:` navigation and WKWebView has no download UI. There the file goes to the share
 * sheet instead: downloaded natively when the app binary can (shareNatively), else
 * through the web view (shareInApp).
 */
export async function downloadMedia(media: DownloadableMedia): Promise<DownloadOutcome> {
  if (!media.url) throw new Error('Mídia sem URL para download');
  const url = media.url;

  const native = await shareNatively([{ url, filename: media.original_filename }]);
  if (native) return native;

  const shared = await shareInApp(url, async () => [
    await toShareableFile(await fetchBlob(url), media.original_filename),
  ]);
  if (shared) return shared;
  // A blob link is a silent no-op in the app: fail loudly instead of claiming success.
  if (isNativeApp()) throw new Error('Compartilhamento indisponível neste aparelho');

  saveBlob(await fetchBlob(url), media.original_filename);
  return 'saved';
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetchWithRetry(url, { cache: 'no-store' });
  return res.blob();
}

/** Hands a blob to the browser as a file download through a temporary link. */
export function saveBlob(blob: Blob, filename: string): void {
  const objUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

/**
 * A File for the share sheet. The bytes are copied on purpose: WebKit names a shared
 * fetch() blob after its URL path ("_dashboard_abc"), even wrapped in `new File(...)`;
 * only a copy keeps `filename`.
 */
export async function toShareableFile(blob: Blob, filename: string): Promise<File> {
  return new File([await blob.arrayBuffer()], filename, {
    type: blob.type || 'application/octet-stream',
  });
}

/**
 * In an app binary that has it, the native side downloads the files to disk and opens
 * the share sheet, so the page never holds the bytes (a Reel is ~180 MB) and there is
 * no tap window to miss. Returns null when this binary can't, for the web view path.
 */
export async function shareNatively(
  files: { url: string; filename: string }[],
): Promise<DownloadOutcome | null> {
  const plugin = getMesaasNative();
  if (!plugin || files.length === 0 || !hasMesaasNativeMethod('shareFiles')) return null;
  const { completed } = await plugin.shareFiles({ files });
  return completed ? 'shared' : 'cancelled';
}

function errorName(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'name' in err ? String(err.name) : undefined;
}

/**
 * Files downloaded for a share sheet that WebKit refused to open. Only the last set, so
 * at most one download's worth of memory stays around.
 */
let pending: { key: string; files: File[] } | null = null;

/**
 * In the iOS app, opens the share sheet with the files `load` downloads. It offers
 * "Save Image" / "Save Video" (with NSPhotoLibraryAddUsageDescription in Info.plist)
 * and "Save to Files". Returns null outside the app, or when the web view can't share
 * them, so the caller falls back to a regular download.
 *
 * WebKit only opens the sheet shortly after a tap (a few seconds), so a slow download
 * gets NotAllowedError. The files are then kept under `key` and a toast asks for another
 * tap on the same button: that call skips the download and shares inside the new tap.
 * A toast action button would not do, as the open lightbox (a Radix modal) blocks
 * pointer events outside it, the toaster included.
 */
export async function shareInApp(
  key: string,
  load: () => Promise<File[]>,
): Promise<DownloadOutcome | null> {
  if (!isNativeApp()) return null;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return null;
  }

  const files = pending?.key === key ? pending.files : await load();
  pending = null;
  if (files.length === 0 || !canShare(files)) return null;

  try {
    await navigator.share({ files });
    return 'shared';
  } catch (err) {
    const name = errorName(err);
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') {
      pending = { key, files };
      toast(i18n.t('posts:mediaGallery.fileReady', { count: files.length }));
      return 'pending';
    }
    throw err;
  }
}

function canShare(files: File[]): boolean {
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}
