/** A database post (as blog-sync writes it to blog-db/) with every optional
 * piece the renderers draw: cover, an `img:` figure, one `barras`
 * infographic, two sources and a feature CTA. Shared by the mirror parity
 * test and the post page tests. Not a test file: vitest only collects
 * `*.test.ts(x)`. */
import { parseDbPost, type BlogPost } from '../blog.schema';

export const DB_POST_META = {
  slug: 'aprovacao-por-link-reduz-retrabalho',
  status: 'publicado',
  category: 'tendencia',
  title: 'Aprovação por link: o que muda no retrabalho da agência',
  h1: 'Aprovação por link reduz o retrabalho da agência',
  description:
    'Levantamento com agências mostra quanto tempo a aprovação por link economiza frente ao WhatsApp, e como montar o fluxo sem perder o histórico.',
  lede: 'Agências que trocaram o WhatsApp por um link de aprovação aprovam posts em horas, não em dias. Separamos o que os dados mostram.',
  date: '2026-10-20',
  author: 'equipe',
  cover: {
    url: 'https://mesaas.supabase.co/storage/v1/object/public/blog-images/capa.jpg',
    alt: 'Mesa de trabalho com o calendário editorial aberto',
    credit: 'Ana Souza / Unsplash',
    license: 'Unsplash',
    source_url: 'https://unsplash.com/photos/capa',
  },
  images: [
    {
      key: 'revisao',
      url: 'https://mesaas.supabase.co/storage/v1/object/public/blog-images/revisao.jpg',
      alt: 'Pessoa revisando um post no celular',
      credit: 'Bruno Lima / Wikimedia Commons',
      license: 'CC BY 4.0',
      source_url: 'https://commons.wikimedia.org/wiki/File:Revisao.jpg',
    },
  ],
  sources: [
    {
      title: 'Pesquisa de mercado sobre agências de social media',
      publisher: 'Instituto Exemplo',
      url: 'https://exemplo.org/pesquisa',
      published_at: '2026-10-01',
    },
    {
      title: 'Guia oficial de aprovação de conteúdo',
      publisher: 'Portal Exemplo',
      url: 'https://exemplo.com.br/guia',
    },
  ],
  featureSlug: 'aprovacao-de-post',
  revision: 3,
  readingMinutes: 4,
};

export const DB_POST_BODY = [
  'Parágrafo de abertura com um [estudo citado](https://exemplo.org/pesquisa).',
  '',
  '![Pessoa revisando um post no celular](img:revisao)',
  '',
  '## Os números',
  '',
  '```infografico',
  JSON.stringify({
    tipo: 'barras',
    titulo: 'Tempo médio até a aprovação',
    fonte: 0,
    itens: [
      { rotulo: 'Aprovação pelo WhatsApp', valor: 48, exibicao: '48 h' },
      { rotulo: 'Aprovação por link', valor: 6, exibicao: '6 h' },
    ],
  }),
  '```',
  '',
  'Texto de fechamento do artigo.',
].join('\n');

/** Body pre-resolved, as the prerender loader produces it. */
export function dbPostWithBody(): BlogPost {
  return parseDbPost(DB_POST_META, DB_POST_BODY);
}

/** Body still to load, as the client loader produces it. */
export function dbPostLazy(): BlogPost {
  return parseDbPost(DB_POST_META, null);
}
