import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { validateAudioBlob, type UploadPhase } from '@mesaas/ui/audio/validation';
import { finalizeIdeiaAudio, presignIdeiaAudio } from '../api';
import type { IdeiaAudioResponse } from '../types';
import { putToR2 } from './ideiaMedia';

/** Holds the unsaved-work registry for the whole upload: a silent version swap must not abort it. */
export function uploadIdeiaAudio(
  ...args: Parameters<typeof uploadIdeiaAudioUnguarded>
): ReturnType<typeof uploadIdeiaAudioUnguarded> {
  return trackUnsavedWork(uploadIdeiaAudioUnguarded(...args));
}

async function uploadIdeiaAudioUnguarded(args: {
  token: string;
  ideiaId: string;
  blob: Blob;
  mime: string;
  durationSeconds: number;
  onPhase?: (phase: UploadPhase) => void;
}): Promise<IdeiaAudioResponse> {
  const { token, ideiaId, blob, durationSeconds, onPhase } = args;
  const mime = validateAudioBlob(blob, args.mime);

  onPhase?.('uploading');
  const signed = await presignIdeiaAudio(token, {
    ideia_id: ideiaId,
    mime_type: args.mime,
    size_bytes: blob.size,
  });
  await putToR2(signed.upload_url, blob, signed.mime_type || mime);

  onPhase?.('transcribing');
  return finalizeIdeiaAudio(token, ideiaId, {
    r2_key: signed.r2_key,
    mime_type: signed.mime_type || mime,
    size_bytes: blob.size,
    duration_seconds: Math.max(1, Math.round(durationSeconds)),
  });
}
