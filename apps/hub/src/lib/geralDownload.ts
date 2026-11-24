import type { HubPost, HubPostMedia } from '../types';
import { pad2 } from './pad2';
import { postDestinations } from './postView';

/**
 * Geral is never auto-published: once the client approves, the content is theirs to download
 * (spec 2026-09-29-platform-agnostic-posts-design.md, "Geral export"). Approved = every status
 * after the client's approval, including a failed social publication.
 */
const APPROVED: ReadonlySet<HubPost['status']> = new Set([
  'aprovado_cliente',
  'agendado',
  'postado',
  'falha_publicacao',
]);

export function canDownloadGeral(post: HubPost): boolean {
  return APPROVED.has(post.status) && postDestinations(post).includes('geral');
}

/**
 * The caption that goes in the zip as `legenda.txt`: the Geral one for a post with a Geral
 * destination, else the first platform caption that has text, in destination order.
 */
export function downloadCaption(post: HubPost): string {
  const byDestination = {
    geral: post.geral_caption,
    instagram: post.ig_caption,
    tiktok: post.tiktok_caption,
  } as const;
  const destinations = postDestinations(post);
  const ordered = destinations.includes('geral')
    ? (['geral'] as const)
    : destinations.filter((d): d is 'instagram' | 'tiktok' => d !== 'geral');
  for (const d of ordered) {
    const text = byDestination[d]?.trim();
    if (text) return text;
  }
  return '';
}

/** The media that can still be downloaded, in post order. */
export function downloadableMedia(post: HubPost): HubPostMedia[] {
  return (post.media ?? []).filter((m) => !m.media_lost_at && !!m.url);
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

function extension(m: HubPostMedia): string {
  return EXT_BY_MIME[m.mime_type] ?? m.mime_type.split('/')[1]?.split(/[;+]/)[0] ?? 'bin';
}

/** "01.jpg", "02.mp4": the Hub has no original file names, and the order is what matters. */
export function geralFileName(m: HubPostMedia, index: number): string {
  return `${pad2(index + 1)}.${extension(m)}`;
}

/** A file-system-safe name from the post title, for the zip. */
export function geralZipName(post: Pick<HubPost, 'id' | 'titulo'>): string {
  const slug = post.titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || `post-${post.id}`}.zip`;
}

function saveBlob(blob: Blob, filename: string) {
  const objUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Safari starts the download asynchronously: revoking right away cancels it.
    setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
  }
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * What happened to a download, so the button only reports what really happened.
 * - `saved`: the browser got a file download.
 * - `shared`: the phone's share sheet finished (Save Video, Save Image, Save to Files...).
 * - `cancelled`: the client closed the share sheet.
 * - `pending`: the files are downloaded but the share sheet could not open; another tap on
 *   the same button shares them at once.
 */
export type GeralDownloadOutcome = 'saved' | 'shared' | 'cancelled' | 'pending';

/**
 * iPhone and iPad get the share sheet: there a downloaded file lands in Files, and only the
 * sheet offers "Save Video" / "Save Image" to the camera roll. Android keeps the regular
 * download, which already reaches the gallery, and so does every desktop browser. iPadOS
 * reports a Mac user agent, so a Mac with touch points counts as an iPad.
 */
function prefersShareSheet(): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function canShareFiles(files: File[]): boolean {
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * A File for the share sheet. The bytes are copied on purpose: WebKit names a shared fetch()
 * blob after its URL path, even wrapped in `new File(...)`; only a copy keeps the name. The type
 * comes from the post, not the response: iOS offers "Save Video" / "Save Image" only for a video
 * or image type, and a proxy or CDN may answer with a generic one.
 */
async function toShareableFile(blob: Blob, m: HubPostMedia, index: number): Promise<File> {
  return new File([await blob.arrayBuffer()], geralFileName(m, index), {
    type: m.mime_type || blob.type || 'application/octet-stream',
  });
}

function errorName(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'name' in err ? String(err.name) : undefined;
}

/**
 * Files downloaded for a share sheet the browser refused to open. Only the last set, so at
 * most one post's worth of memory stays around.
 */
let pendingShare: { key: string; files: File[] } | null = null;

// By ids, not URLs: a refetch between the two taps may hand out new signed URLs.
function shareKey(post: HubPost, media: HubPostMedia[]): string {
  return `${post.id}:${media.map((m) => m.id).join(',')}`;
}

/**
 * Opens the share sheet with every file of the post, one item each (no zip: the camera roll
 * cannot open one), so the client can save them all to Photos at once. Returns null when the
 * browser cannot share these files, for the regular download.
 *
 * Safari only opens the sheet within a few seconds of a tap, so a video that takes longer to
 * download (most of them) gets NotAllowedError. The files are then kept and the caller asks for another tap,
 * which shares them without downloading again, inside the new tap's window.
 */
async function shareGeralFiles(
  post: HubPost,
  media: HubPostMedia[],
): Promise<GeralDownloadOutcome | null> {
  const key = shareKey(post, media);
  const files =
    pendingShare?.key === key
      ? pendingShare.files
      : await Promise.all(
          media.map(async (m, i) => toShareableFile(await fetchBlob(m.url!), m, i)),
        );
  pendingShare = null;
  if (!canShareFiles(files)) return null;

  try {
    await navigator.share({ files });
    return 'shared';
  } catch (err) {
    const name = errorName(err);
    // Kept on a closed sheet too, so trying again does not download everything again.
    if (name === 'AbortError') {
      pendingShare = { key, files };
      return 'cancelled';
    }
    if (name === 'NotAllowedError') {
      pendingShare = { key, files };
      return 'pending';
    }
    throw err;
  }
}

/**
 * Saves the Geral content. On a touch device that can share files it goes to the share sheet
 * (see shareGeralFiles). Otherwise through a blob, because `<a download>` is ignored on the
 * cross-origin media URL: one file goes out as is (the caption has its own copy button);
 * several go in a zip, in order, with `legenda.txt` when the post has a caption
 * (downloadCaption). Any post can be downloaded this way (PostDownloadButton); the approved Geral
 * footer (GeralDownload) is the same call.
 */
export async function downloadGeralContent(post: HubPost): Promise<GeralDownloadOutcome> {
  const media = downloadableMedia(post);
  if (media.length === 0) return 'saved';
  if (prefersShareSheet()) {
    const shared = await shareGeralFiles(post, media);
    if (shared) return shared;
  }
  if (media.length === 1) {
    saveBlob(await fetchBlob(media[0].url!), geralFileName(media[0], 0));
    return 'saved';
  }
  const [{ default: JSZip }, blobs] = await Promise.all([
    import('jszip'),
    Promise.all(media.map((m) => fetchBlob(m.url!))),
  ]);
  const zip = new JSZip();
  media.forEach((m, i) => zip.file(geralFileName(m, i), blobs[i]));
  const caption = downloadCaption(post);
  if (caption) zip.file('legenda.txt', caption);
  saveBlob(await zip.generateAsync({ type: 'blob' }), geralZipName(post));
  return 'saved';
}
