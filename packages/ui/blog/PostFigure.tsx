import type { BlogImage } from './model';
import { safeHref } from './safe-href';

/** A body image (or the post's cover) with its mandatory credit line.
 * `image.url` comes from our own `blog-images` bucket (validated at draft
 * time), so only the credit link goes through `safeHref`. `priority` is for
 * the cover, the page's largest paint: load it now instead of lazily. */
export function PostFigure({
  image,
  priority = false,
}: {
  image: Omit<BlogImage, 'key'>;
  priority?: boolean;
}) {
  return (
    <figure className="blog-figure">
      <img
        src={image.url}
        alt={image.alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        {...(priority ? { fetchPriority: 'high' as const } : {})}
      />
      <figcaption>
        Foto: {image.credit}, licença {image.license}.{' '}
        <a href={safeHref(image.source_url)} rel="nofollow noopener" target="_blank">
          Fonte
        </a>
      </figcaption>
    </figure>
  );
}
