import { createElement, type ReactNode } from 'react';
import { formatNumberPtBR } from './format';
import {
  infograficoSchema,
  parseSvg,
  type BlogSource,
  type Infografico as InfograficoData,
  type SvgNode,
} from './model';
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
  const cited = 'fonte' in info ? info.fonte : undefined;
  const source = cited === undefined ? undefined : sources[cited];
  if (cited !== undefined && !source) return null;
  const drawing = info.tipo === 'svg' ? parseSvg(info.svg) : undefined;
  if (drawing && 'error' in drawing) return null;

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
      {info.tipo === 'svg' && drawing && 'node' in drawing && (
        <div className="blog-info__svg">{renderSvg(drawing.node, info.alt)}</div>
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

const REACT_ATTR: Record<string, string> = {
  'stop-color': 'stopColor',
  'stroke-width': 'strokeWidth',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'fill-opacity': 'fillOpacity',
  'stroke-opacity': 'strokeOpacity',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'text-anchor': 'textAnchor',
  'dominant-baseline': 'dominantBaseline',
};

/** Builds elements from the tree `parseSvg` already vetted; no markup string
 * ever reaches the DOM. */
function renderSvg(node: SvgNode, alt: string, key: number | string = 0): ReactNode {
  const props: Record<string, string | number> = { key };
  for (const [name, value] of Object.entries(node.attrs)) props[REACT_ATTR[name] ?? name] = value;
  if (node.tag === 'svg') {
    props.role = 'img';
    props['aria-label'] = alt;
  }
  return createElement(
    node.tag,
    props,
    ...node.children.map((child, i) =>
      typeof child === 'string' ? child : renderSvg(child, alt, i),
    ),
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
