import { trackUnsavedWork } from '@mesaas/app-lifecycle';
import { cancelKbVideoUpload, createKbVideoUpload, type KbVideo } from './api';

export const KB_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
/** Direct uploads are single POSTs; a 200 MB file on a slow uplink can take a while. */
const UPLOAD_TIMEOUT_MS = 30 * 60_000;

export function validateVideoFile(file: File): string | null {
  if (!file.type.startsWith('video/')) return 'O arquivo precisa ser um vídeo.';
  if (file.size > KB_VIDEO_MAX_BYTES) return 'O vídeo precisa ter até 200 MB.';
  return null;
}

/** POSTs the file to a Stream direct-upload URL as multipart field "file". */
export function postToStream(
  uploadURL: string,
  file: File,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Envio cancelado.', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    xhr.open('POST', uploadURL);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('Network error during upload'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Envio cancelado.', 'AbortError'));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new DOMException('O envio demorou demais. Tente novamente.', 'TimeoutError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

/** Reserves a Stream upload for the video, sends the file, and releases the reservation on any
 * failure (cancel included) so the row never sits in "Processando" for bytes that never came.
 * Held in the unsaved-work registry so a silent deploy swap can't abort it. */
export function uploadKbVideo(
  videoId: number,
  file: File,
  opts: { onProgress?: (ratio: number) => void; signal?: AbortSignal } = {},
): Promise<KbVideo> {
  return trackUnsavedWork(
    (async () => {
      const { uploadURL, video } = await createKbVideoUpload(videoId);
      try {
        await postToStream(uploadURL, file, opts.onProgress, opts.signal);
      } catch (err) {
        if (video.stream_uid)
          await cancelKbVideoUpload(videoId, video.stream_uid).catch(() => undefined);
        throw err;
      }
      return video;
    })(),
  );
}
