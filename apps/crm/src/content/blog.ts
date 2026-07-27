/** Post-domain helpers. Pure and loader-agnostic — relative imports only, so
 * both the client bundle and the prerender script can use them. */
import { SITE_URL, type RouteMeta } from './site-meta';
import type { BlogPost } from './blog.schema';

export const BLOG_INDEX_PATH = '/blog';

/** Reader-facing name of each category. Lives here because both renderings of
 * an article — the static mirror and the React page — must show the same one. */
export const CATEGORY_LABEL: Record<BlogPost['category'], string> = {
  comparativo: 'Comparativo',
  guia: 'Guia',
};

export const BLOG_AUTHOR = {
  name: 'Eduardo Brandão',
  role: 'Fundador do Mesaas',
  bio: 'Fundador do Mesaas. Construiu o produto dentro de uma agência de social media, resolvendo na prática o caos de planilhas, grupos de WhatsApp e aprovações perdidas.',
  url: 'https://www.instagram.com/mesaas.com.br/',
} as const;

/** Newest first; ties broken by slug so the order is deterministic. */
export function sortPosts(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) =>
    a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1,
  );
}

export function postPath(post: BlogPost): string {
  return `${BLOG_INDEX_PATH}/${post.slug}`;
}

export function postOgImage(slug: string): string {
  return `${SITE_URL}/og/blog/${slug}.png`;
}

export function blogPostRouteMeta(post: BlogPost): RouteMeta {
  return {
    path: postPath(post),
    file: `blog/${post.slug}.html`,
    title: post.title,
    description: post.description,
    lastmod: post.updated,
    ogImage: postOgImage(post.slug),
    ogType: 'article',
  };
}

/** Same category first, then the newest of the rest. */
export function relatedPosts(post: BlogPost, all: BlogPost[], limit = 3): BlogPost[] {
  const others = sortPosts(all).filter((p) => p.slug !== post.slug);
  const sameCategory = others.filter((p) => p.category === post.category);
  const rest = others.filter((p) => p.category !== post.category);
  return [...sameCategory, ...rest].slice(0, limit);
}

export function formatPostDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(y, m - 1, d));
}
