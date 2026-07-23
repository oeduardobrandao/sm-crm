/**
 * Backdrop painted behind the image before it is flattened to JPEG.
 *
 * Must match `.cover-art`'s background in the report template
 * (supabase/functions/_shared/report-template/template-string.ts). The output is
 * always JPEG, which has no alpha, so a transparent PNG has to be composited
 * onto *something*; against the report's dark cover a white fill turned every
 * cut-out logo into a glaring white block. Painting the cover's own colour lets
 * a transparent upload read as if it had no background at all.
 */
const COVER_BACKDROP = '#26221F';

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
    // Flatten transparency onto the report cover's own backdrop before drawing.
    ctx.fillStyle = COVER_BACKDROP;
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
