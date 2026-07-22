/**
 * Client-side downscale for report splash uploads: max 1920px wide, JPEG q0.82.
 *
 * The report generator embeds the splash art as base64 inside every generated
 * report HTML, so the stored image has to stay modest. Never upscales.
 */
export async function downscaleImage(file: File, maxWidth = 1920, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))),
      'image/jpeg',
      quality,
    );
  });
}
