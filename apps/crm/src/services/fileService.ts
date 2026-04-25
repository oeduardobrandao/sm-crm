// apps/crm/src/services/fileService.ts
import { supabase } from '../lib/supabase';
import type { Folder, FileRecord, FolderContents, FolderInfo, PostFileLink } from '../pages/arquivos/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

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

// ─── FOLDER OPERATIONS ─────────────────────────────────────────

export async function getFolderContents(parentId: number | null): Promise<FolderContents> {
  const query: Record<string, string> = parentId ? { parent_id: String(parentId) } : {};
  return callFn<FolderContents>('file-manage', 'GET', undefined, query, '/folders');
}

export async function createFolder(name: string, parentId: number | null): Promise<Folder> {
  return callFn<Folder>('file-manage', 'POST', { name, parent_id: parentId }, undefined, '/folders');
}

export async function renameFolder(folderId: number, name: string): Promise<Folder> {
  return callFn<Folder>('file-manage', 'PATCH', { name }, undefined, `/folders/${folderId}`);
}

export async function moveFolder(folderId: number, newParentId: number | null): Promise<Folder> {
  return callFn<Folder>('file-manage', 'PATCH', { parent_id: newParentId }, undefined, `/folders/${folderId}`);
}

export async function deleteFolder(folderId: number): Promise<void> {
  await callFn('file-manage', 'DELETE', undefined, undefined, `/folders/${folderId}`);
}

export async function getFolderInfo(folderId: number): Promise<FolderInfo> {
  return callFn<FolderInfo>('file-manage', 'GET', undefined, undefined, `/folders/${folderId}`);
}

// ─── FILE OPERATIONS ────────────────────────────────────────────

export async function uploadFile(args: {
  file: File;
  folderId: number | null;
  thumbnail?: File;
  onProgress?: (p: UploadProgress) => void;
  postId?: number;
}): Promise<FileRecord> {
  const { file, folderId, thumbnail, onProgress, postId } = args;

  const signed = await callFn<{
    file_id: string; upload_url: string; r2_key: string; kind: string;
    thumbnail_upload_url?: string; thumbnail_r2_key?: string;
  }>('file-upload-url', 'POST', {
    folder_id: folderId,
    filename: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    thumbnail: thumbnail ? { mime_type: thumbnail.type, size_bytes: thumbnail.size } : undefined,
  });

  const uploads: Promise<void>[] = [putWithProgress(signed.upload_url, file, onProgress)];
  if (thumbnail && signed.thumbnail_upload_url) {
    uploads.push(putWithProgress(signed.thumbnail_upload_url, thumbnail));
  }
  await Promise.all(uploads);

  let width: number | undefined;
  let height: number | undefined;
  let duration_seconds: number | undefined;
  let blur_data_url: string | undefined;

  if (signed.kind === 'image') {
    const dims = await probeImage(file);
    width = dims.width;
    height = dims.height;
    blur_data_url = await generateBlurDataUrl(file).catch(() => undefined);
  } else if (signed.kind === 'video') {
    const dims = await probeVideo(file);
    width = dims.width;
    height = dims.height;
    duration_seconds = dims.duration_seconds;
  }

  return callFn<FileRecord>('file-upload-finalize', 'POST', {
    file_id: signed.file_id,
    r2_key: signed.r2_key,
    thumbnail_r2_key: signed.thumbnail_r2_key,
    kind: signed.kind,
    mime_type: file.type,
    size_bytes: file.size,
    name: file.name,
    folder_id: folderId,
    width, height, duration_seconds, blur_data_url,
    post_id: postId,
  });
}

export async function renameFile(fileId: number, name: string): Promise<FileRecord> {
  return callFn<FileRecord>('file-manage', 'PATCH', { name }, undefined, `/files/${fileId}`);
}

export async function moveFile(fileId: number, folderId: number | null): Promise<FileRecord> {
  return callFn<FileRecord>('file-manage', 'PATCH', { folder_id: folderId }, undefined, `/files/${fileId}`);
}

export async function deleteFile(fileId: number): Promise<void> {
  await callFn('file-manage', 'DELETE', undefined, undefined, `/files/${fileId}`);
}

// ─── LINK OPERATIONS ────────────────────────────────────────────

export async function linkFileToPost(fileId: number, postId: number): Promise<PostFileLink> {
  return callFn<PostFileLink>('file-manage', 'POST', { file_id: fileId, post_id: postId }, undefined, '/links');
}

export async function unlinkFileFromPost(linkId: number): Promise<void> {
  await callFn('file-manage', 'DELETE', undefined, undefined, `/links/${linkId}`);
}

export async function getPostLinks(postId: number) {
  return callFn<{ links: (PostFileLink & { files: FileRecord })[] }>(
    'file-manage', 'GET', undefined, { post_id: String(postId) }, '/links'
  );
}

// ─── MEDIA HELPERS (reused from postMedia.ts) ───────────────────

function probeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function probeVideo(file: File): Promise<{ width: number; height: number; duration_seconds: number }> {
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

const BLUR_SIZE = 16;
function generateBlurDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const ratio = img.naturalWidth / img.naturalHeight;
        const w = ratio >= 1 ? BLUR_SIZE : Math.round(BLUR_SIZE * ratio);
        const h = ratio >= 1 ? Math.round(BLUR_SIZE / ratio) : BLUR_SIZE;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/webp', 0.2));
      } catch (e) { reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
