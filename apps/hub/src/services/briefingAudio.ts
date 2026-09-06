import { trackUnsavedWork } from '@mesaas/app-lifecycle';
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

const QUOTA_MESSAGE =
  'O espaço de armazenamento do plano acabou. Fale com a agência para liberar espaço.';
const GENERIC_UPLOAD_FAILURE_MESSAGE = 'O envio do áudio falhou. Tente de novo.';
const GENERIC_UNAVAILABLE_MESSAGE = 'Não foi possível concluir agora. Tente de novo em instantes.';

/** Backend codes that all mean "the upload/object ended up in a bad state". */
const GENERIC_UPLOAD_FAILURE_CODES = new Set([
  'size mismatch',
  'content-type mismatch',
  'object not found',
  'invalid r2_key',
  'invalid_key',
  'invalid_bytes',
  'size_bytes out of range',
]);

/**
 * Maps a raw error (often a backend code or an `HTTP <status>` string from
 * `api.ts`'s post/del helpers) to a Portuguese, client-facing message. Falls
 * back to the caller-provided message for anything unrecognized.
 */
export function describeAudioError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (!raw) return fallback;

  if (raw === 'quota_exceeded') return QUOTA_MESSAGE;
  if (raw === 'question_not_found' || raw === 'Pergunta não encontrada.') {
    return 'Esta pergunta não está mais disponível. Recarregue a página.';
  }
  if (raw === 'Áudio não encontrado.') return 'O áudio não foi encontrado. Grave de novo.';
  if (raw === 'unsupported file type') return 'Formato de áudio não suportado neste navegador.';
  if (GENERIC_UPLOAD_FAILURE_CODES.has(raw)) return GENERIC_UPLOAD_FAILURE_MESSAGE;
  if (raw.startsWith('Muitas tentativas')) return raw;

  const uploadFalhouMatch = /^Upload falhou: (\d+)$/.exec(raw);
  if (uploadFalhouMatch) {
    return uploadFalhouMatch[1] === '413' ? QUOTA_MESSAGE : GENERIC_UPLOAD_FAILURE_MESSAGE;
  }
  if (/^HTTP 5\d{2}$/.test(raw) || raw === 'internal error') return GENERIC_UNAVAILABLE_MESSAGE;

  // Already Portuguese (thrown by validateBriefingAudio/uploadBriefingAudio,
  // or another backend message we don't special-case above) — keep as is.
  const looksPortuguese = /[À-ÿ]/.test(raw) || /^[A-ZÀ-Ý][a-zà-ÿ]+ (de|no|não|vazia)/.test(raw);
  if (looksPortuguese) return raw;

  return fallback;
}

export type UploadPhase = 'uploading' | 'transcribing';

/** Holds the unsaved-work registry for the whole upload: a silent version swap must not abort it. */
export function uploadBriefingAudio(
  ...args: Parameters<typeof uploadBriefingAudioUnguarded>
): ReturnType<typeof uploadBriefingAudioUnguarded> {
  return trackUnsavedWork(uploadBriefingAudioUnguarded(...args));
}

async function uploadBriefingAudioUnguarded(args: {
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
