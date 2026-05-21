import { supabase } from './core';

export interface KbArticle {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: Record<string, unknown> | null;
  content_plain: string;
  cover_image_url: string | null;
  category: string;
  tags: string[];
  status: 'draft' | 'published';
  display_order: number;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KbContextLink {
  id: string;
  route_pattern: string;
  article_id: string;
  label: string | null;
  display_order: number;
  article?: KbArticle;
}

export async function getPublishedArticles(): Promise<KbArticle[]> {
  const { data, error } = await supabase
    .from('kb_articles')
    .select('*')
    .eq('status', 'published')
    .order('display_order');
  if (error) throw error;
  return (data ?? []) as KbArticle[];
}

export async function getArticleBySlug(slug: string): Promise<KbArticle | null> {
  const { data, error } = await supabase
    .from('kb_articles')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data as KbArticle | null;
}

export async function getContextLinksForRoute(route: string): Promise<KbContextLink[]> {
  const { data, error } = await supabase
    .from('kb_context_links')
    .select('*, article:kb_articles!article_id(*)')
    .eq('route_pattern', route)
    .order('display_order');
  if (error) throw error;

  return ((data ?? []) as (KbContextLink & { article: KbArticle | null })[])
    .filter(link => link.article && link.article.status === 'published')
    .map(link => ({
      id: link.id,
      route_pattern: link.route_pattern,
      article_id: link.article_id,
      label: link.label,
      display_order: link.display_order,
      article: link.article ?? undefined,
    }));
}
