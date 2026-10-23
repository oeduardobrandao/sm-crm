import { formatIsoDatePtBR } from './format';
import type { BlogSource } from './model';
import { safeHref } from './safe-href';

/** The "Fontes" list closing every post, rendered from `sources` (never from
 * the body). Nothing when the list is empty. */
export function Fontes({ sources }: { sources: BlogSource[] }) {
  if (sources.length === 0) return null;
  return (
    <section className="blog-fontes">
      <h2>Fontes</h2>
      <ol>
        {sources.map((source, i) => (
          <li key={i}>
            <a href={safeHref(source.url)} rel="nofollow noopener" target="_blank">
              {source.title}
            </a>
            , {source.publisher}
            {source.published_at ? `, ${formatIsoDatePtBR(source.published_at)}` : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
