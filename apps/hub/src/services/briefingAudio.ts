import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { validateAudioBlob, type UploadPhase } from '@mesaas/ui/audio/validation';
import { finalizeBriefingAudio, presignBriefingAudio } from '../api';
import type { BriefingAudioResponse } from '../types';
import { putToR2 } from './ideiaMedia';

export {
  AUDIO_MIME,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  describeAudioError,
  normalizeAudioMime,
  pickRecorderMime,
} from '@mesaas/ui/audio/validation';
export type { UploadPhase } from '@mesaas/ui/audio/validation';
export const validateBriefingAudio = validateAudioBlob;

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
  const mime = validateAudioBlob(blob, args.mime);

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
