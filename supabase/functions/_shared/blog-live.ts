// What counts as a post that is live on /blog: a blog_posts row in a live status, plus the
// hand-written file posts (always live, no database hit). Shared by the public view counter
// and the Search Console sync so both agree on which slugs they may record.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { BLOG_FILE_POSTS } from "./blog-file-posts.ts";

export const BLOG_LIVE_STATUSES = ["publicado", "publicando"] as const;
export const BLOG_SLUG_RE = /^[a-z0-9-]{1,120}$/;

export async function isLiveBlogSlug(db: SupabaseClient, slug: string): Promise<boolean> {
  if (!BLOG_SLUG_RE.test(slug)) return false;
  if (BLOG_FILE_POSTS.some((p) => p.slug === slug)) return true;
  const { data, error } = await db
    .from("blog_posts")
    .select("slug")
    .in("status", [...BLOG_LIVE_STATUSES])
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Every live slug with its publish date (null when the row has none), database rows first. */
export async function liveBlogSlugs(db: SupabaseClient): Promise<Array<{ slug: string; date: string | null }>> {
  const { data, error } = await db
    .from("blog_posts")
    .select("slug, date")
    .in("status", [...BLOG_LIVE_STATUSES]);
  if (error) throw error;
  const rows = ((data ?? []) as Array<{ slug: string; date: string | null }>).map((r) => ({
    slug: r.slug,
    date: r.date ?? null,
  }));
  const taken = new Set(rows.map((r) => r.slug));
  for (const p of BLOG_FILE_POSTS) {
    if (!taken.has(p.slug)) rows.push({ slug: p.slug, date: p.date });
  }
  return rows;
}
