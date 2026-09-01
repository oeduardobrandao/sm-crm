// apps/crm/src/services/automationMedia.ts
// Upload da mídia do cartão de DM: presign -> PUT -> finalize (HEAD + quota).
// Contrato do handler (supabase/functions/automation-media/handler.ts):
// presign devolve a key TMP (automation-media-tmp/...); finalize recebe essa
// mesma key tmp e devolve dm_media com a key FINAL (automation-media/...) já
// verificada -- é a key final que a automação salva, nunca a tmp.
import { supabase } from '@/lib/supabase';
import type { DmMedia } from '../store/instagramAutomations';
import { probeImage, putWithProgress, type UploadProgress } from './postMedia';

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif'];

async function callFn<T>(name: string, path: string, body: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export function validateAutomationMediaFile(file: File): string | null {
  if (!ALLOWED_MIME.includes(file.type)) return 'form.mediaInvalidType';
  if (file.size > MAX_MEDIA_BYTES) return 'form.mediaTooLarge';
  return null;
}

export async function uploadAutomationMedia(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<DmMedia> {
  const probe = await probeImage(file).catch(() => null);
  const signed = await callFn<{ upload_url: string; key: string }>('automation-media', 'presign', {
    mime_type: file.type,
    size_bytes: file.size,
  });
  await putWithProgress(signed.upload_url, file, onProgress);
  const { dm_media } = await callFn<{ dm_media: DmMedia }>('automation-media', 'finalize', {
    key: signed.key,
    mime_type: file.type,
    size_bytes: file.size,
    width: probe?.width,
    height: probe?.height,
  });
  return dm_media;
}

export async function deleteAutomationMedia(media: DmMedia): Promise<void> {
  await callFn<{ ok: boolean }>('automation-media', 'delete', { key: media.key });
}

export async function signAutomationMediaView(key: string): Promise<string> {
  const { url } = await callFn<{ url: string }>('automation-media', 'sign-view', { key });
  return url;
}
