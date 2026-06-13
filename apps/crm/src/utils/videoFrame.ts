// apps/crm/src/utils/videoFrame.ts
// Captures video frames as JPEG thumbnails. Display-only artifacts (CRM/Hub
// posters) — Instagram publishing never reads them — so resolution is capped.
const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.85;
const LOAD_TIMEOUT_MS = 15_000;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: DOMHighResTimeStamp, metadata: unknown) => void) => number;
};

export function captureFrameFromElement(video: HTMLVideoElement): Promise<File> {
  return new Promise((resolve, reject) => {
    // 2 = HAVE_CURRENT_DATA: anything less and drawImage paints black.
    if (video.readyState < 2) {
      return reject(new Error('O vídeo ainda não carregou um frame'));
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return reject(new Error('Dimensões do vídeo indisponíveis'));
    const scale = Math.min(MAX_EDGE / Math.max(w, h), 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('Canvas indisponível'));
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      return reject(e instanceof Error ? e : new Error('Falha ao capturar o frame'));
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Falha ao gerar a miniatura'));
        resolve(new File([blob], 'thumb.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

export function extractVideoFrame(source: File | string, timeSeconds?: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const isFile = source instanceof File;
    const url = isFile ? URL.createObjectURL(source) : source;
    const video = document.createElement('video') as VideoWithFrameCallback;
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    if (!isFile) video.crossOrigin = 'anonymous';

    let settled = false;
    const cleanup = () => {
      if (isFile) URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(err instanceof Error ? err : new Error('Não foi possível ler o vídeo'));
    };
    const succeed = (file: File) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(file);
    };
    const timer = setTimeout(
      () => fail(new Error('Tempo esgotado ao ler o vídeo')),
      LOAD_TIMEOUT_MS,
    );

    video.onerror = () => fail(new Error('Não foi possível decodificar o vídeo'));

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = timeSeconds ?? Math.min(0.5, duration / 2);
      // seeked alone is not enough: some browsers still paint the previous
      // frame. requestVideoFrameCallback waits for actual frame presentation.
      video.onseeked = () => {
        video.onseeked = null;
        const capture = () => captureFrameFromElement(video).then(succeed, fail);
        if (typeof video.requestVideoFrameCallback === 'function') {
          video.requestVideoFrameCallback(capture);
        } else {
          requestAnimationFrame(capture);
        }
      };
      video.currentTime = target;
    };

    video.src = url;
  });
}
