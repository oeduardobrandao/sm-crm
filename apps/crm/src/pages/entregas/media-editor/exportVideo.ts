import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { videoArguments, type Adjustment } from './geometry';
import { adjustedFilename } from './render';

class VideoExportError extends Error {}

/** Each export owns its worker and virtual filesystem; cancellation releases both. */
export async function exportVideo(
  file: File,
  adjustment: Adjustment,
  width: number,
  height: number,
  duration: number,
  maxBytes: number,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<File> {
  signal.throwIfAborted();
  const ffmpeg = new FFmpeg();
  const abort = () => ffmpeg.terminate();
  signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(
    () => {
      timedOut = true;
      abort();
    },
    30 * 60 * 1000,
  );
  ffmpeg.on('progress', ({ progress }) =>
    onProgress(Math.max(0, Math.min(99, Math.floor(progress * 100)))),
  );
  try {
    await ffmpeg.load({ coreURL, wasmURL });
    signal.throwIfAborted();
    await ffmpeg.writeFile('input', new Uint8Array(await file.arrayBuffer()));
    signal.throwIfAborted();
    const code = await ffmpeg.exec(videoArguments(adjustment, width, height, duration, maxBytes));
    if (code !== 0) throw new VideoExportError('Falha ao processar o vídeo. Tente novamente.');
    signal.throwIfAborted();
    const output = await ffmpeg.readFile('output.mp4');
    if (typeof output === 'string' || !output.byteLength)
      throw new VideoExportError('O vídeo processado está vazio.');
    if (output.byteLength > maxBytes)
      throw new VideoExportError('O vídeo ajustado ainda excede o limite de tamanho.');
    onProgress(100);
    return new File([new Uint8Array(output)], adjustedFilename(file.name, 'video'), {
      type: 'video/mp4',
    });
  } catch (error) {
    signal.throwIfAborted();
    if (timedOut)
      throw new Error(
        'O processamento demorou demais. Tente um vídeo menor ou outro enquadramento.',
      );
    if (error instanceof VideoExportError) throw error;
    throw new Error('Não foi possível processar este vídeo neste navegador. Tente novamente.');
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    ffmpeg.terminate();
  }
}
