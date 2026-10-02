import type { BlockProps } from '../BlockRenderer';
import { frameWidth, imageAspect, readImageConfig } from '../image';

// Sem loading="lazy": a página de print espera img.decode() de todas as
// imagens antes de liberar o Gotenberg (RelatorioPrintPage.tsx).
export function ImageBlock({ block }: BlockProps) {
  const cfg = readImageConfig(block.config);
  if (!cfg.src) return null;
  const aspect = imageAspect(cfg);
  return (
    <figure className="rb-image" style={{ width: frameWidth(aspect) }}>
      <img
        src={cfg.src}
        alt={cfg.alt}
        decoding="async"
        className={cfg.fit === 'contain' ? 'rb-image-contain' : undefined}
        style={{
          aspectRatio: String(aspect),
          objectFit: cfg.fit,
          objectPosition: `${cfg.focal.x * 100}% ${cfg.focal.y * 100}%`,
        }}
      />
      {cfg.caption ? <figcaption>{cfg.caption}</figcaption> : null}
    </figure>
  );
}
