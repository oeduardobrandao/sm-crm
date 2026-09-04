import { finalizeBriefingAudio, presignBriefingAudio } from '../api';
import type { BriefingAudioResponse } from '../types';
import { putToR2 } from './ideiaMedia';

export const AUDIO_MIME = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav'];
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 300;

const RECORDER_MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function normalizeAudioMime(raw: string): string | null {
  const base = raw.split(';')[0].trim().toLowerCase();
  return AUDIO_MIME.includes(base) ? base : null;
}

/** First MediaRecorder mime the browser supports (Chrome: webm/opus, Safari: mp4). */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return RECORDER_MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported(m));
}

/** Returns the normalized mime or throws a user-facing message. */
export function validateBriefingAudio(blob: Blob, mime: string): string {
  const normalized = normalizeAudioMime(mime);
  if (!normalized) throw new Error(`Formato de áudio não suportado: ${mime || 'desconhecido'}`);
  if (blob.size <= 0) throw new Error('Gravação vazia. Tente de novo.');
  if (blob.size > MAX_AUDIO_BYTES)
    throw new Error('Áudio maior que 15 MB. Grave um trecho mais curto.');
  return normalized;
}

export type UploadPhase = 'uploading' | 'transcribing';

export async function uploadBriefingAudio(args: {
  token: string;
  questionId: string;
  blob: Blob;
  mime: string;
  durationSeconds: number;
  onPhase?: (phase: UploadPhase) => void;
}): Promise<BriefingAudioResponse> {
  const { token, questionId, blob, durationSeconds, onPhase } = args;
  const mime = validateBriefingAudio(blob, args.mime);

  onPhase?.('uploading');
  const signed = await presignBriefingAudio(token, {
    question_id: questionId,
    mime_type: args.mime,
    size_bytes: blob.size,
  });
  await putToR2(signed.upload_url, blob, signed.mime_type || mime);

  onPhase?.('transcribing');
  return finalizeBriefingAudio(token, questionId, {
    r2_key: signed.r2_key,
    mime_type: signed.mime_type || mime,
    size_bytes: blob.size,
    duration_seconds: Math.max(1, Math.round(durationSeconds)),
  });
}
