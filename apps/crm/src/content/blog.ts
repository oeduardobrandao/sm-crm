/** Post-domain helpers. Pure and loader-agnostic — relative imports only, so
 * both the client bundle and the prerender script can use them. */
import { DEFAULT_OG_IMAGE, SITE_URL, type RouteMeta } from './site-meta';
import type { BlogPost } from './blog.schema';
import { formatIsoDatePtBR } from '../../../../packages/ui/blog/format';

export const BLOG_INDEX_PATH = '/blog';

/** Reader-facing name of each category. Lives here because both renderings of
 * an article — the static mirror and the React page — must show the same one. */
export const CATEGORY_LABEL: Record<BlogPost['category'], string> = {
  comparativo: 'Comparativo',
  guia: 'Guia',
  noticia: 'Notícia',
  tendencia: 'Tendência',
  planejamento: 'Planejamento',
};

export const BLOG_AUTHOR = {
  name: 'Eduardo Brandão',
  role: 'Fundador do Mesaas',
  bio: 'Fundador do Mesaas. Construiu o produto dentro de uma agência de social media, resolvendo na prática o caos de planilhas, grupos de WhatsApp e aprovações perdidas.',
  url: 'https://www.instagram.com/mesaas.com.br/',
} as const;

/** Byline of the database posts the blog Routine writes (`author: 'equipe'`). */
export const BLOG_TEAM_AUTHOR = {
  name: 'Equipe Mesaas',
  role: 'Mesaas',
} as const;

export interface PostAuthor {
  name: string;
  role: string;
  bio?: string;
  kind: 'person' | 'organization';
}

/** Who signs a post: the team (an Organization in JSON-LD) or, for the
 * hand-written file posts, the founder. */
export function postAuthor(post: BlogPost): PostAuthor {
  if (post.author === 'equipe') return { ...BLOG_TEAM_AUTHOR, kind: 'organization' };
  return { name: BLOG_AUTHOR.name, role: BLOG_AUTHOR.role, bio: BLOG_AUTHOR.bio, kind: 'person' };
}

/** The standfirst under the H1. File posts have no `lede`, so their meta
 * description doubles as one (as it always has). */
export function postLede(post: BlogPost): string {
  return post.lede ?? post.description;
}

/** Newest first; ties broken by slug so the order is deterministic. */
export function sortPosts(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) =>
    a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1,
  );
}

export function postPath(post: BlogPost): string {
  return `${BLOG_INDEX_PATH}/${post.slug}`;
}

/** File posts have a generated, committed OG image; DB posts can't (that's a
 * manual Playwright step), so they share their cover photo, or the site-wide
 * image when they have none. */
export function postOgImage(post: BlogPost): string {
  if (post.cover?.url) return post.cover.url;
  if (post.author === 'equipe') return DEFAULT_OG_IMAGE;
  return `${SITE_URL}/og/blog/${post.slug}.png`;
}

/** Thumbnail for post cards: the cover, else the file post's OG image, else
 * none (the card draws a plain tile). Root-relative for our own files. */
export function postThumb(post: BlogPost): string | null {
  if (post.cover?.url) return post.cover.url;
  if (post.author === 'equipe') return null;
  return `/og/blog/${post.slug}.png`;
}

export function blogPostRouteMeta(post: BlogPost): RouteMeta {
  return {
    path: postPath(post),
    file: `blog/${post.slug}.html`,
    title: post.title,
    description: post.description,
    lastmod: post.updated,
    ogImage: postOgImage(post),
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

/** `YYYY-MM-DD` as "21 de outubro de 2026" (shared with the render pieces). */
export const formatPostDate = formatIsoDatePtBR;
