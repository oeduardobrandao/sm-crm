import { supabase } from '../lib/supabase';
import { generateImageThumbnail, generateBlurDataUrl, probeImage } from './postMedia';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export interface CrmIdeiaImage {
  id: number;
  file_id: number;
  url: string;
  thumbnail_url: string | null;
  blur_data_url: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
}

async function callFn<T>(method: 'GET' | 'POST' | 'DELETE', pathSuffix = '', body?: unknown, query?: Record<string, string>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const url = new URL(`${SUPABASE_URL}/functions/v1/ideia-media-manage${pathSuffix}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
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

function putToR2(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload falhou: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Erro de rede no upload'));
    xhr.send(file);
  });
}

export function validateIdeiaImage(file: File) {
  if (!IMAGE_MIME.includes(file.type)) throw new Error(`Tipo não suportado: ${file.type}`);
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Imagem maior que 25 MB');
}

export async function listIdeiaImages(ideiaId: string): Promise<CrmIdeiaImage[]> {
  const { images } = await callFn<{ images: CrmIdeiaImage[] }>('GET', '', undefined, { ideia_id: ideiaId });
  return images;
}

export async function uploadIdeiaImage(
  ideiaId: string, file: File, sortOrder?: number,
): Promise<CrmIdeiaImage> {
  validateIdeiaImage(file);
  const [{ width, height }, thumb, blur] = await Promise.all([
    probeImage(file),
    generateImageThumbnail(file),
    generateBlurDataUrl(file).catch(() => undefined),
  ]);

  const signed = await callFn<{
    upload_id: string; upload_url: string; r2_key: string;
    thumbnail_upload_url: string; thumbnail_r2_key: string;
  }>('POST', '/upload-url', {
    ideia_id: ideiaId, filename: file.name, mime_type: file.type, size_bytes: file.size,
    thumbnail: { mime_type: 'image/webp', size_bytes: thumb.size },
  });

  await Promise.all([putToR2(signed.upload_url, file), putToR2(signed.thumbnail_upload_url, thumb)]);

  return callFn<CrmIdeiaImage>('POST', `/${ideiaId}/files`, {
    r2_key: signed.r2_key,
    thumbnail_r2_key: signed.thumbnail_r2_key,
    mime_type: file.type,
    size_bytes: file.size,
    thumbnail_bytes: thumb.size,
    name: file.name,
    width, height, blur_data_url: blur, sort_order: sortOrder,
  });
}

export async function removeIdeiaImage(ideiaId: string, fileId: number): Promise<void> {
  await callFn('DELETE', `/${ideiaId}/files/${fileId}`);
}
