import { formatNumberPtBR } from './format';
import { infograficoSchema, type BlogSource, type Infografico as InfograficoData } from './model';
import { safeHref } from './safe-href';

/** One infographic, drawn as HTML so every number stays real text crawlers
 * can quote. Re-validates its input: a fence inside a blockquote or list
 * escapes the draft-time scanner, so whatever reaches here is untrusted.
 * Invalid data, or a `fonte` that points past `sources`, renders nothing
 * (a statistic without its source is worse than no statistic). */
export function Infografico({ data, sources }: { data: unknown; sources: BlogSource[] }) {
  const parsed = infograficoSchema.safeParse(data);
  if (!parsed.success) return null;
  const info = parsed.data;
  const source = info.tipo === 'etapas' ? undefined : sources[info.fonte];
  if (info.tipo !== 'etapas' && !source) return null;

  return (
    <figure className={`blog-info blog-info--${info.tipo}`}>
      <div className="blog-info__head">
        <p className="blog-info__title">{info.titulo}</p>
      </div>
      {info.tipo === 'barras' && <Barras itens={info.itens} />}
      {info.tipo === 'numeros' && (
        <dl className="blog-info__numbers">
          {info.itens.map((item, i) => (
            <div key={i} className="blog-info__number">
              <dt>{item.valor}</dt>
              <dd>{item.legenda}</dd>
            </div>
          ))}
        </dl>
      )}
      {info.tipo === 'etapas' && (
        <ol className="blog-info__steps">
          {info.itens.map((item, i) => (
            <li key={i} className="blog-info__step">
              <span className="blog-info__step-n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="blog-info__step-label">{item.rotulo}</span>
            </li>
          ))}
        </ol>
      )}
      <figcaption className="blog-info__caption">
        {source ? (
          <>
            Fonte:{' '}
            <a href={safeHref(source.url)} rel="nofollow noopener" target="_blank">
              {source.publisher}
            </a>
          </>
        ) : (
          'Infográfico: Mesaas'
        )}
      </figcaption>
    </figure>
  );
}

type Barra = Extract<InfograficoData, { tipo: 'barras' }>['itens'][number];

function Barras({ itens }: { itens: Barra[] }) {
  const max = Math.max(...itens.map((item) => item.valor));
  const top = itens.findIndex((item) => item.valor === max);
  return (
    <ul className="blog-info__bars">
      {itens.map((item, i) => {
        const pct = max > 0 ? Math.round((item.valor / max) * 100) : 0;
        return (
          <li key={i} className="blog-info__bar">
            <span className="blog-info__bar-label">
              <span>{item.rotulo}</span>
              <span className="blog-info__bar-value">
                {item.exibicao ?? formatNumberPtBR(item.valor)}
              </span>
            </span>
            <span className="blog-info__track" aria-hidden="true">
              <span
                className={
                  max > 0 && i === top ? 'blog-info__fill blog-info__fill--top' : 'blog-info__fill'
                }
                style={{ width: `${pct}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
