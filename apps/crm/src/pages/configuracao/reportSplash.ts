/**
 * Client-side downscale for report splash uploads: max 1920px wide, 1080px
 * tall, JPEG q0.82.
 *
 * The report generator embeds the splash art as base64 inside every generated
 * report HTML, so the stored image has to stay modest. Never upscales.
 */
export async function downscaleImage(
  file: File,
  maxWidth = 1920,
  quality = 0.82,
  maxHeight = 1080,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Falha ao processar a imagem');
    // Flatten transparency to white before drawing: the output is always
    // JPEG, which has no alpha channel, so an un-filled canvas would
    // composite against the browser's black default instead.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))),
        'image/jpeg',
        quality,
      );
    });
  } finally {
    bitmap.close?.();
  }
}
