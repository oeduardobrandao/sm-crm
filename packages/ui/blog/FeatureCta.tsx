import type { BlogFeature } from './features';
import { safeHref } from './safe-href';

/** The dark "No Mesaas" block after the body. Takes the feature's data (look
 * it up in BLOG_FEATURES) so the component stays dumb. */
export function FeatureCta({ feature }: { feature: BlogFeature }) {
  return (
    <aside className="blog-feature-cta">
      <div className="blog-feature-cta__text">
        <p className="blog-feature-cta__eyebrow">No Mesaas</p>
        <p className="blog-feature-cta__title">{feature.titulo}</p>
        <p className="blog-feature-cta__frase">{feature.frase}</p>
      </div>
      <a className="blog-feature-cta__link" href={safeHref(feature.href)}>
        Conhecer o recurso
      </a>
    </aside>
  );
}
