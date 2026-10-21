import { getPlacement, type Adjustment } from './geometry';

export function drawAdjustment(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  a: Adjustment,
) {
  const { width, height } = a;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = a.color;
  ctx.fillRect(0, 0, width, height);
  if (a.mode === 'fit' && a.background === 'blur') {
    const bg = getPlacement(sw, sh, width, height, 'crop', 1.08, 0.5, 0.5);
    ctx.filter = 'blur(20px)';
    ctx.drawImage(source, bg.x, bg.y, bg.width, bg.height);
    ctx.filter = 'none';
  }
  const p = getPlacement(sw, sh, width, height, a.mode, a.zoom, a.x, a.y);
  ctx.drawImage(source, p.x, p.y, p.width, p.height);
  ctx.restore();
}

export async function jpegFromCanvas(
  canvas: HTMLCanvasElement,
  name: string,
  maxBytes = 8 * 1024 * 1024,
): Promise<File> {
  for (const quality of [0.94, 0.86, 0.76, 0.64]) {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar a imagem.'))),
        'image/jpeg',
        quality,
      ),
    );
    if (blob.size <= maxBytes) return new File([blob], name, { type: 'image/jpeg' });
  }
  throw new Error('A imagem ajustada ainda excede 8 MB. Tente outro enquadramento.');
}

export function adjustedFilename(name: string, kind: 'image' | 'video') {
  return `${name.replace(/\.[^.]+$/, '')}-ajustado.${kind === 'image' ? 'jpg' : 'mp4'}`;
}
