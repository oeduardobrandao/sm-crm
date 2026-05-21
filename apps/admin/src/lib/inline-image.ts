import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const MAX_INLINE_SIZE = 10 * 1024 * 1024;
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

async function callFn<T>(
  name: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
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

function probeImage(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export function validateInlineImage(file: File) {
  if (!IMAGE_MIME.includes(file.type)) throw new Error(`Unsupported image type: ${file.type}`);
  if (file.size > MAX_INLINE_SIZE) throw new Error('Image exceeds 10 MB');
}

export interface InlineImageResult {
  r2Key: string;
  src: string;
  width: number;
  height: number;
}

export async function uploadInlineImage(file: File): Promise<InlineImageResult> {
  validateInlineImage(file);

  const { width, height } = await probeImage(file);

  const signed = await callFn<{
    file_id: string; upload_url: string; r2_key: string;
    thumbnail_upload_url?: string; thumbnail_r2_key?: string;
  }>('file-upload-url', 'POST', {
    filename: file.name || 'pasted-image.png',
    mime_type: file.type,
    size_bytes: file.size,
  });

  await fetch(signed.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  }).then((res) => {
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  });

  const result = await callFn<{ url: string }>('file-upload-finalize', 'POST', {
    file_id: signed.file_id,
    r2_key: signed.r2_key,
    kind: 'image',
    mime_type: file.type,
    size_bytes: file.size,
    name: file.name || 'pasted-image.png',
    width,
    height,
  });

  return { r2Key: signed.r2_key, src: result.url, width, height };
}

export async function resolveInlineImageUrls(
  r2Keys: string[],
): Promise<Record<string, string>> {
  if (r2Keys.length === 0) return {};
  const { urls } = await callFn<{ urls: Record<string, string> }>('sign-r2-urls', 'POST', { keys: r2Keys });
  return urls;
}

export function extractR2Keys(content: Record<string, unknown> | null): string[] {
  if (!content) return [];
  const keys: string[] = [];
  function walk(node: any) {
    if (node?.type === 'inlineImage' && node.attrs?.r2Key) {
      keys.push(node.attrs.r2Key);
    }
    if (Array.isArray(node?.content)) node.content.forEach(walk);
  }
  walk(content);
  return keys;
}

export function injectSignedUrls(
  content: Record<string, unknown>,
  urlMap: Record<string, string>,
): Record<string, unknown> {
  function walk(node: any): any {
    if (node?.type === 'inlineImage' && node.attrs?.r2Key && urlMap[node.attrs.r2Key]) {
      return { ...node, attrs: { ...node.attrs, src: urlMap[node.attrs.r2Key] } };
    }
    if (Array.isArray(node?.content)) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  }
  return walk(content);
}
