// Leitura tolerante do config do bloco image (spec 2026-10-02). O validador
// estrito mora em _shared/report-docs/layout.ts; aqui qualquer valor fora do
// contrato cai no padrão, como os outros widgets fazem na leitura.
import { IMAGE_FITS, IMAGE_FOCAL_STEPS, IMAGE_RATIOS } from './types';
import type { ImageFit, ImageRatio } from './types';

export const IMAGE_MAX_HEIGHT_PX = 560;
const FALLBACK_ASPECT = 1.5;

const RATIO_VALUE: Record<Exclude<ImageRatio, 'original'>, number> = {
  '16:9': 16 / 9,
  '3:2': 3 / 2,
  '4:3': 4 / 3,
  '1:1': 1,
  '4:5': 4 / 5,
  '3:4': 3 / 4,
  '2:3': 2 / 3,
  '9:16': 9 / 16,
};

export interface ImageConfig {
  fileId: number | null;
  width: number | null;
  height: number | null;
  ratio: ImageRatio;
  fit: ImageFit;
  focal: { x: number; y: number };
  caption: string;
  alt: string;
  src: string | null;
}

const posInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
const step = (v: unknown): number =>
  (IMAGE_FOCAL_STEPS as readonly unknown[]).includes(v) ? (v as number) : 0.5;

export function isRenderableSrc(src: unknown): src is string {
  return typeof src === 'string' && (src.startsWith('https:') || src.startsWith('blob:'));
}

export function readImageConfig(config: Record<string, unknown> | undefined): ImageConfig {
  const c = config ?? {};
  const focal =
    typeof c.focal === 'object' && c.focal !== null ? (c.focal as Record<string, unknown>) : {};
  return {
    fileId: posInt(c.file_id),
    width: posInt(c.width),
    height: posInt(c.height),
    ratio: (IMAGE_RATIOS as readonly unknown[]).includes(c.ratio)
      ? (c.ratio as ImageRatio)
      : 'original',
    fit: (IMAGE_FITS as readonly unknown[]).includes(c.fit) ? (c.fit as ImageFit) : 'cover',
    focal: { x: step(focal.x), y: step(focal.y) },
    caption: typeof c.caption === 'string' ? c.caption : '',
    alt: typeof c.alt === 'string' ? c.alt : '',
    src: isRenderableSrc(c.src) ? c.src : null,
  };
}

export function ratioValue(ratio: Exclude<ImageRatio, 'original'>): number {
  return RATIO_VALUE[ratio];
}

export function imageAspect(cfg: ImageConfig): number {
  if (cfg.ratio !== 'original') return RATIO_VALUE[cfg.ratio];
  return cfg.width && cfg.height ? cfg.width / cfg.height : FALLBACK_ASPECT;
}

/** Largura do quadro que mantém a altura <= 560px (vertical não vira um poste). */
export function frameWidth(aspect: number): string {
  return `min(100%, ${Math.round(IMAGE_MAX_HEIGHT_PX * aspect)}px)`;
}

export function orientationOf(cfg: ImageConfig): 'horizontal' | 'vertical' {
  return imageAspect(cfg) < 1 ? 'vertical' : 'horizontal';
}
