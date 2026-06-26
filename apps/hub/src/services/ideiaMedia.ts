import { presignIdeiaImage, finalizeIdeiaImage } from '../api';
import type { IdeiaImage } from '../types';

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function validateIdeiaImage(file: File) {
  if (!IMAGE_MIME.includes(file.type)) {
    throw new Error(`Tipo de arquivo não suportado: ${file.type}`);
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error('Imagem maior que 25 MB');
  }
}

const THUMB_SIZE = 256;
const BLUR_SIZE = 16;

function probeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function generateThumbnail(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(THUMB_SIZE / img.naturalWidth, THUMB_SIZE / img.naturalHeight, 1);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => blob
          ? resolve(new File([blob], 'thumb.webp', { type: 'image/webp' }))
          : reject(new Error('thumbnail failed')),
        'image/webp', 0.7,
      );
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function generateBlur(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = img.naturalWidth / img.naturalHeight;
      const w = ratio >= 1 ? BLUR_SIZE : Math.round(BLUR_SIZE * ratio);
      const h = ratio >= 1 ? Math.round(BLUR_SIZE / ratio) : BLUR_SIZE;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/webp', 0.2));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
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

export async function uploadIdeiaImage(args: {
  token: string;
  ideiaId: string;
  file: File;
  sortOrder?: number;
}): Promise<IdeiaImage> {
  const { token, ideiaId, file, sortOrder } = args;
  validateIdeiaImage(file);

  const [{ width, height }, thumb, blur] = await Promise.all([
    probeImage(file),
    generateThumbnail(file),
    generateBlur(file).catch(() => undefined),
  ]);

  const signed = await presignIdeiaImage(token, {
    ideia_id: ideiaId,
    filename: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    thumbnail: { mime_type: 'image/webp', size_bytes: thumb.size },
  });

  await Promise.all([
    putToR2(signed.upload_url, file),
    putToR2(signed.thumbnail_upload_url, thumb),
  ]);

  return finalizeIdeiaImage(token, ideiaId, {
    r2_key: signed.r2_key,
    thumbnail_r2_key: signed.thumbnail_r2_key,
    mime_type: file.type,
    size_bytes: file.size,
    thumbnail_bytes: thumb.size,
    name: file.name,
    width,
    height,
    blur_data_url: blur,
    sort_order: sortOrder,
  });
}
