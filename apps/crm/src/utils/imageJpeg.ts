// apps/crm/src/utils/imageJpeg.ts
// Re-encodes an image File to JPEG, capping the longest edge. Used to normalize
// custom thumbnail uploads so they are valid Instagram Reel covers (cover_url
// reliably accepts JPEG only). Always run — even on JPEG input — so the size cap
// always applies. Re-encoding drops alpha; covers are opaque, so that's fine.
const DEFAULT_MAX_EDGE = 1920;
const DEFAULT_QUALITY = 0.85;

export function encodeImageAsJpeg(
  file: File,
  maxEdge = DEFAULT_MAX_EDGE,
  quality = DEFAULT_QUALITY,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // Browsers honor EXIF orientation by default (image-orientation: from-image),
    // so a rotated phone photo draws upright and naturalWidth/Height are oriented.
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return reject(new Error('Imagem inválida'));
      const scale = Math.min(maxEdge / Math.max(w, h), 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas indisponível'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Falha ao processar a imagem'));
          resolve(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e instanceof Error ? e : new Error('Falha ao carregar a imagem'));
    };
    img.src = url;
  });
}
