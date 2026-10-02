// Validação e redução no navegador das imagens do bloco de relatório (spec
// 2026-10-02, "Envio"). Diferente de reportSplash.downscaleImage, que sempre
// achata em JPEG sobre fundo fixo: aqui PNG mantém transparência.
export const REPORT_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const REPORT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 2400;
const JPEG_QUALITY = 0.85;

export function validateReportImage(file: File): string | null {
  if (!(REPORT_IMAGE_MIMES as readonly string[]).includes(file.type)) {
    return 'Formato não suportado. Use JPG, PNG ou WebP.';
  }
  if (file.size > REPORT_IMAGE_MAX_BYTES) {
    // Arredonda para cima na primeira casa: 10,04 MB vira "10,1", nunca "10"
    // (que leria igual ao limite). Inteiros saem sem casa decimal.
    const mb = Math.ceil((file.size / (1024 * 1024)) * 10) / 10;
    const label = mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    return `Esta imagem tem ${label} MB. O limite é 10 MB.`;
  }
  return null;
}

export function scaledSize(
  w: number,
  h: number,
  max = MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

export async function prepareReportImage(
  file: File,
): Promise<{ file: File; width: number; height: number }> {
  // from-image aplica a rotação EXIF (fotos de celular): o desenho sai de pé e
  // width/height já são os da imagem de pé. Navegadores anteriores ao valor
  // 'from-image' (Chrome < 112, Firefox < 111, Safari 15) rejeitam o enum; neles
  // o padrão sem opção já respeita o EXIF.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
    createImageBitmap(file),
  );
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    if (width === bitmap.width && height === bitmap.height) return { file, width, height };
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Falha ao processar a imagem');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const isPng = file.type === 'image/png';
    const type = isPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))),
        type,
        isPng ? undefined : JPEG_QUALITY,
      ),
    );
    const name = isPng ? file.name : file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg';
    return { file: new File([blob], name, { type }), width, height };
  } finally {
    bitmap.close?.();
  }
}
