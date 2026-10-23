import type { BlogImage } from './model';
import { safeHref } from './safe-href';

/** A body image with its mandatory credit line. `image.url` comes from our own
 * `blog-images` bucket (validated at draft time), so only the credit link goes
 * through `safeHref`. */
export function PostFigure({ image }: { image: BlogImage }) {
  return (
    <figure className="blog-figure">
      <img src={image.url} alt={image.alt} loading="lazy" decoding="async" />
      <figcaption>
        Foto: {image.credit}, licença {image.license}.{' '}
        <a href={safeHref(image.source_url)} rel="nofollow noopener" target="_blank">
          Fonte
        </a>
      </figcaption>
    </figure>
  );
}
