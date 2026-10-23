import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from '../../../apps/crm/src/utils/security';
import { BLOG_FEATURES } from '../blog/features';
import { FeatureCta } from '../blog/FeatureCta';
import { Fontes } from '../blog/Fontes';
import { Infografico } from '../blog/Infografico';
import { BlogMarkdown, blogUrlTransform } from '../blog/markdown';
import type { BlogImage, BlogSource } from '../blog/model';
import { safeHref } from '../blog/safe-href';

const SOURCES: BlogSource[] = [
  {
    title: 'Relatório anual',
    publisher: 'Instituto X',
    url: 'https://instituto.example/relatorio',
    published_at: '2026-10-21',
  },
  { title: 'Documentação', publisher: 'Empresa Y', url: 'https://y.example/docs' },
];

const IMAGES: BlogImage[] = [
  {
    key: 'capa',
    url: 'https://cdn.example/blog-images/capa.jpg',
    alt: 'Mesa de trabalho',
    credit: 'Autor',
    license: 'CC BY 4.0',
    source_url: 'https://commons.example/capa',
  },
];

function md(body: string, post: { images?: BlogImage[]; sources?: BlogSource[] } = {}): string {
  return renderToStaticMarkup(<BlogMarkdown post={post} body={body} />);
}

function fence(value: unknown): string {
  return '```infografico\n' + JSON.stringify(value, null, 2) + '\n```';
}

describe('links', () => {
  it('neutraliza javascript:', () => {
    expect(md('[x](javascript:alert(1))')).toContain('href="#"');
  });

  it('neutraliza tab-injected protocol-relative', () => {
    expect(md('[x](/%09/evil.com)')).toContain('href="#"');
  });

  it('externo ganha rel nofollow noopener e nova aba', () => {
    const html = md('[x](https://a.com)');
    expect(html).toContain('href="https://a.com"');
    expect(html).toContain('rel="nofollow noopener"');
    expect(html).toContain('target="_blank"');
  });

  it('interno fica simples', () => {
    const html = md('[x](/precos)');
    expect(html).toContain('href="/precos"');
    expect(html).not.toContain('rel=');
    expect(html).not.toContain('node=');
  });
});

describe('imagens', () => {
  it('img:<key> vira figura com crédito, fora de <p>', () => {
    const html = md('![a](img:capa)', { images: IMAGES });
    expect(html).toContain('Foto: Autor, licença CC BY 4.0');
    expect(html).toContain('src="https://cdn.example/blog-images/capa.jpg"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt="Mesa de trabalho"');
    expect(html).toContain('href="https://commons.example/capa"');
    expect(html).not.toMatch(/<p>\s*<figure/);
  });

  it('chave desconhecida não renderiza nada', () => {
    expect(md('![a](img:outra)', { images: IMAGES })).not.toContain('<img');
  });

  it('URL externa não renderiza <img>', () => {
    expect(md('![a](https://x.com/a.png)', { images: IMAGES })).not.toContain('<img');
  });

  it('blogUrlTransform preserva img: só no src', () => {
    expect(blogUrlTransform('img:capa', 'src')).toBe('img:capa');
    expect(blogUrlTransform('img:capa', 'href')).toBe('');
    expect(blogUrlTransform('javascript:alert(1)', 'src')).toBe('');
  });
});

describe('pull quote', () => {
  it('blockquote com um parágrafo vira blog-pullquote', () => {
    expect(md('> A IA escreve o rascunho.')).toContain('class="blog-pullquote"');
  });

  it('blockquote com dois parágrafos fica normal', () => {
    const html = md('> um\n>\n> dois');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('blog-pullquote');
  });
});

describe('infográfico', () => {
  const barras = {
    tipo: 'barras',
    titulo: 'Onde a agência perde horas',
    fonte: 1,
    itens: [
      { rotulo: 'Aprovação', valor: 40 },
      { rotulo: 'Legendas', valor: 20, exibicao: '20 h' },
      { rotulo: 'Relatórios', valor: 1234.5 },
    ],
  };

  it('barras: rótulos, fonte e largura proporcional', () => {
    const html = md(fence(barras), { sources: SOURCES });
    for (const item of barras.itens) expect(html).toContain(item.rotulo);
    expect(html).toContain('blog-info--barras');
    expect(html).toContain('Fonte:');
    expect(html).toContain('href="https://y.example/docs"');
    expect(html).toContain('Empresa Y');
    expect(html).toContain('width:100%');
    expect(html).toContain('20 h');
    expect(html).toContain('1.234,5');
    expect(html).not.toContain('<pre');
  });

  it('numeros e etapas', () => {
    const numeros = md(
      fence({
        tipo: 'numeros',
        titulo: 'Em números',
        fonte: 0,
        itens: [
          { valor: '62%', legenda: 'do tempo fora da criação' },
          { valor: '3 dias', legenda: 'de ciclo de aprovação' },
        ],
      }),
      { sources: SOURCES },
    );
    expect(numeros).toContain('62%');
    expect(numeros).toContain('Instituto X');
    const etapas = md(
      fence({
        tipo: 'etapas',
        titulo: 'Fluxo',
        itens: [{ rotulo: 'Pauta' }, { rotulo: 'Rascunho' }, { rotulo: 'Aprovação' }],
      }),
    );
    expect(etapas).toContain('blog-info--etapas');
    expect(etapas).toContain('Rascunho');
    expect(etapas).not.toContain('Fonte:');
  });

  it('JSON inválido, schema inválido ou fonte fora do intervalo não renderiza nada', () => {
    expect(md('```infografico\n{nope\n```')).not.toContain('blog-info');
    expect(md(fence({ ...barras, itens: [] }), { sources: SOURCES })).not.toContain('blog-info');
    expect(md(fence({ ...barras, fonte: 5 }), { sources: SOURCES })).not.toContain('blog-info');
  });

  it('todos os valores zero não geram NaN', () => {
    const html = renderToStaticMarkup(
      <Infografico
        data={{
          tipo: 'barras',
          titulo: 'Zero',
          fonte: 0,
          itens: [
            { rotulo: 'a', valor: 0 },
            { rotulo: 'b', valor: 0 },
          ],
        }}
        sources={SOURCES}
      />,
    );
    expect(html).not.toContain('NaN');
  });

  it('outros blocos de código continuam <pre>', () => {
    expect(md('```js\nconst a = 1;\n```')).toContain('<pre>');
  });
});

describe('Fontes', () => {
  it('um <li> por fonte, com data pt-BR quando existe', () => {
    const html = renderToStaticMarkup(<Fontes sources={SOURCES} />);
    expect(html).toContain('<h2>Fontes</h2>');
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain('21 de outubro de 2026');
    expect(html).toContain('href="https://instituto.example/relatorio"');
  });

  it('sem fontes, nada', () => {
    expect(renderToStaticMarkup(<Fontes sources={[]} />)).toBe('');
  });
});

describe('FeatureCta', () => {
  it('bloco No Mesaas com link para o recurso', () => {
    const feature = BLOG_FEATURES['portal-do-cliente'];
    const html = renderToStaticMarkup(<FeatureCta feature={feature} />);
    expect(html).toContain('No Mesaas');
    expect(html).toContain(feature.titulo);
    expect(html).toContain('href="/portal-do-cliente"');
    expect(html).toContain('Conhecer o recurso');
  });
});

describe('safeHref agrees with sanitizeUrl', () => {
  const table = [
    'http://a.com/x',
    'https://a.com/x',
    '/precos',
    '//evil.com',
    'javascript:alert(1)',
    'data:text/html,hi',
    '/\t/evil.com',
    '/%0a/evil.com',
    '',
    'mailto:oi@a.com',
  ];
  it.each(table)('%j', (input) => {
    expect(safeHref(input)).toBe(sanitizeUrl(input));
  });
});
