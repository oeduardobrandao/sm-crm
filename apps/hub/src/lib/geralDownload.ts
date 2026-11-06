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
    URL.revokeObjectURL(objUrl);
  }
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * Saves the Geral content. Through a blob, because `<a download>` is ignored on the cross-origin
 * media URL. One file goes out as is (the caption has its own copy button); several go in a zip,
 * in order, with `legenda.txt` when the Geral caption is not empty.
 */
export async function downloadGeralContent(post: HubPost): Promise<void> {
  const media = downloadableMedia(post);
  if (media.length === 0) return;
  if (media.length === 1) {
    saveBlob(await fetchBlob(media[0].url!), geralFileName(media[0], 0));
    return;
  }
  const [{ default: JSZip }, blobs] = await Promise.all([
    import('jszip'),
    Promise.all(media.map((m) => fetchBlob(m.url!))),
  ]);
  const zip = new JSZip();
  media.forEach((m, i) => zip.file(geralFileName(m, i), blobs[i]));
  const caption = post.geral_caption?.trim();
  if (caption) zip.file('legenda.txt', caption);
  saveBlob(await zip.generateAsync({ type: 'blob' }), geralZipName(post));
}
