import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { validateAudioBlob, type UploadPhase } from '@mesaas/ui/audio/validation';
import { supabase } from '../lib/supabase';
import { putToR2 } from './ideiaMedia';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export interface CrmIdeiaAudio {
  url: string;
  mime: string;
  duration_seconds: number | null;
  transcription_status: 'pending' | 'done' | 'failed' | null;
  recorded_at: string | null;
}

export interface CrmIdeiaAudioView {
  audio: CrmIdeiaAudio | null;
  transcript: string | null;
}

export interface CrmIdeiaAudioResponse {
  ok: boolean;
  transcript: string | null;
  audio: CrmIdeiaAudio | null;
}

async function callFn<T>(
  method: 'GET' | 'POST' | 'DELETE',
  pathSuffix: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
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

export function fetchIdeiaAudio(ideiaId: string): Promise<CrmIdeiaAudioView> {
  return callFn<CrmIdeiaAudioView>('GET', '/audio', undefined, { ideia_id: ideiaId });
}

/** Holds the unsaved-work registry for the whole upload: a silent version swap must not abort it. */
export function uploadIdeiaAudio(
  ...args: Parameters<typeof uploadIdeiaAudioUnguarded>
): ReturnType<typeof uploadIdeiaAudioUnguarded> {
  return trackUnsavedWork(uploadIdeiaAudioUnguarded(...args));
}

async function uploadIdeiaAudioUnguarded(args: {
  ideiaId: string;
  blob: Blob;
  mime: string;
  durationSeconds: number;
  onPhase?: (phase: UploadPhase) => void;
}): Promise<CrmIdeiaAudioResponse> {
  const { ideiaId, blob, durationSeconds, onPhase } = args;
  const mime = validateAudioBlob(blob, args.mime);

  onPhase?.('uploading');
  const signed = await callFn<{ upload_url: string; r2_key: string; mime_type: string }>(
    'POST',
    '/audio-upload-url',
    { ideia_id: ideiaId, mime_type: args.mime, size_bytes: blob.size },
  );
  await putToR2(signed.upload_url, blob, signed.mime_type || mime);

  onPhase?.('transcribing');
  return callFn<CrmIdeiaAudioResponse>('POST', `/${ideiaId}/audio`, {
    r2_key: signed.r2_key,
    mime_type: signed.mime_type || mime,
    size_bytes: blob.size,
    duration_seconds: Math.max(1, Math.round(durationSeconds)),
  });
}

export function retryIdeiaTranscription(ideiaId: string): Promise<CrmIdeiaAudioResponse> {
  return callFn<CrmIdeiaAudioResponse>('POST', `/${ideiaId}/audio/transcribe`);
}

export async function deleteIdeiaAudio(ideiaId: string): Promise<void> {
  await callFn('DELETE', `/${ideiaId}/audio`);
}
