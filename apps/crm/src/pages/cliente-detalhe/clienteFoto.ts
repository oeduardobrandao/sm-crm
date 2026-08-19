/**
 * Client-side resize for a manually-uploaded client photo: a square, side
 * `min(width, height, maxSize)`, output as PNG. Mirrors
 * WorkspaceTab.handleLogoUpload's resize exactly for consistency — this
 * stretches non-square sources to fit the square rather than cropping, and
 * never upscales past the source's own shorter side.
 */
export async function resizeClientePhoto(file: File, maxSize = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = Math.min(bitmap.width, bitmap.height, maxSize);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Falha ao processar a imagem');
    ctx.drawImage(bitmap, 0, 0, size, size);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))),
        'image/png',
      );
    });
  } finally {
    bitmap.close?.();
  }
}
