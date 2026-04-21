// apps/crm/src/services/postMedia.ts
import { supabase } from '../lib/supabase';
import type { PostMedia } from '../store';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_SIZE = 400 * 1024 * 1024;
const MAX_CONCURRENT = 3;

export type UploadProgress = { loaded: number; total: number };

async function callFn<T>(
  name: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  query?: Record<string, string>,
  pathSuffix = '',
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const url = new URL(`${SUPABASE_URL}/functions/v1/${name}${pathSuffix}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function validateFile(file: File, kind: 'image' | 'video') {
  const allowed = kind === 'image' ? IMAGE_MIME : VIDEO_MIME;
  if (!allowed.includes(file.type)) throw new Error(`Tipo de arquivo não suportado: ${file.type}`);
  if (file.size <= 0 || file.size > MAX_SIZE) throw new Error('Arquivo maior que 400 MB');
}

export function detectKind(file: File): 'image' | 'video' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  throw new Error(`Tipo não suportado: ${file.type}`);
}

const THUMB_SIZE = 128;

function generateImageThumbnail(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(THUMB_SIZE / img.naturalWidth, THUMB_SIZE / img.naturalHeight, 1);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Thumbnail generation failed'));
          resolve(new File([blob], 'thumb.webp', { type: 'image/webp' }));
        },
        'image/webp',
        0.7,
      );
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function probeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function probeVideo(file: File): Promise<{ width: number; height: number; duration_seconds: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: vid.videoWidth, height: vid.videoHeight, duration_seconds: Math.round(vid.duration) });
    };
    vid.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    vid.src = url;
  });
}

function putWithProgress(url: string, file: File, onProgress?: (p: UploadProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

export async function listPostMedia(postId: number): Promise<PostMedia[]> {
  const { media } = await callFn<{ media: PostMedia[] }>('post-media-manage', 'GET', undefined, { post_id: String(postId) });
  return media;
}

export async function getWorkflowCovers(workflowIds: number[]): Promise<Map<number, PostMedia[]>> {
  if (workflowIds.length === 0) return new Map();
  const { covers } = await callFn<{ covers: { workflow_id: number; media: PostMedia | PostMedia[] }[] }>(
    'post-media-manage', 'GET', undefined, { workflow_ids: workflowIds.join(',') }
  );
  return new Map(covers.map((c) => [c.workflow_id, Array.isArray(c.media) ? c.media : [c.media]]));
}

export async function uploadPostMedia(args: {
  postId: number;
  file: File;
  thumbnail?: File; // required for video
  onProgress?: (p: UploadProgress) => void;
}): Promise<PostMedia> {
  const { postId, file, thumbnail, onProgress } = args;
  const kind = detectKind(file);
  validateFile(file, kind);

  let width: number | undefined;
  let height: number | undefined;
  let duration_seconds: number | undefined;
  let thumbFile: File | undefined = thumbnail;
  if (kind === 'image') {
    ({ width, height } = await probeImage(file));
    thumbFile = await generateImageThumbnail(file);
  } else {
    if (!thumbnail) throw new Error('Vídeos exigem uma thumbnail');
    validateFile(thumbnail, 'image');
    ({ width, height, duration_seconds } = await probeVideo(file));
  }

  const signed = await callFn<{
    media_id: string; upload_url: string; r2_key: string;
    thumbnail_upload_url?: string; thumbnail_r2_key?: string;
  }>('post-media-upload-url', 'POST', {
    post_id: postId,
    filename: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    kind,
    thumbnail: thumbFile ? { mime_type: thumbFile.type, size_bytes: thumbFile.size } : undefined,
  });

  const uploads: Promise<void>[] = [putWithProgress(signed.upload_url, file, onProgress)];
  if (thumbFile && signed.thumbnail_upload_url) {
    uploads.push(putWithProgress(signed.thumbnail_upload_url, thumbFile));
  }
  await Promise.all(uploads);

  return callFn<PostMedia>('post-media-finalize', 'POST', {
    post_id: postId,
    media_id: signed.media_id,
    r2_key: signed.r2_key,
    thumbnail_r2_key: signed.thumbnail_r2_key,
    kind,
    mime_type: file.type,
    size_bytes: file.size,
    original_filename: file.name,
    width, height, duration_seconds,
  });
}

export async function deletePostMedia(id: number): Promise<void> {
  await callFn(`post-media-manage`, 'DELETE', undefined, undefined, `/${id}`);
}

export async function setPostMediaCover(id: number): Promise<PostMedia> {
  return callFn<PostMedia>(`post-media-manage`, 'PATCH', { is_cover: true }, undefined, `/${id}`);
}

export async function reorderPostMedia(id: number, sort_order: number): Promise<PostMedia> {
  return callFn<PostMedia>(`post-media-manage`, 'PATCH', { sort_order }, undefined, `/${id}`);
}

// Parallelism cap helper for multi-file uploads
export async function uploadMany<T>(items: T[], fn: (t: T) => Promise<void>, concurrency = MAX_CONCURRENT) {
  const queue = items.slice();
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item) await fn(item);
      }
    })());
  }
  await Promise.all(workers);
}
