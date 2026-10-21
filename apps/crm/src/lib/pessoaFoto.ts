/**
 * Team-member photo processing. Phone photos (4032×3024, several MB) are reduced in the
 * browser before upload, so the input limit is generous and only the output is small.
 */
export const MAX_PESSOA_FOTO_BYTES = 10 * 1024 * 1024;

/**
 * Center square crop, side `min(width, height, maxSize)`, JPEG quality 0.85. Unlike
 * `resizeClientePhoto` this never stretches a non-square source: the shorter side wins
 * and the longer one is trimmed equally on both ends. Never upscales.
 */
export async function cropPessoaPhoto(file: File, maxSize = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = Math.floor((bitmap.width - side) / 2);
    const sy = Math.floor((bitmap.height - side) / 2);
    const out = Math.min(side, maxSize);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Falha ao processar a imagem');
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))),
        'image/jpeg',
        0.85,
      );
    });
  } finally {
    bitmap.close?.();
  }
}
