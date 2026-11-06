/** Build step: pulls published blog posts from the database into
 * apps/crm/src/content/blog-db/ so the static build can bake them in.
 *
 * Runs before `vite build` (vercel.json buildCommand). The anon key is enough:
 * RLS only lets anon read publicando/publicado rows and the column grant hides
 * the internal ones. In production every failure aborts the deploy, because
 * a silent skip would publish a blog index and sitemap missing live posts. */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPostSchema, readingMinutes } from '../../apps/crm/src/content/blog.schema';

export const BLOG_DB_DIR = 'apps/crm/src/content/blog-db';

const COLUMNS =
  'id,slug,status,category,title,h1,description,lede,body_md,cover_image,images,sources,feature_slug,author,date,updated,revision';

export interface SyncOptions {
  url?: string;
  anonKey?: string;
  env: { VERCEL_ENV?: string };
  fetchImpl?: typeof fetch;
  outDir?: string;
  fileSlugs: string[];
}

interface Row {
  slug?: string;
  body_md?: string | null;
  cover_image?: unknown;
  feature_slug?: unknown;
  updated?: string | null;
  date?: string | null;
  [k: string]: unknown;
}

function clearDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

export async function syncBlogPosts(
  opts: SyncOptions,
): Promise<{ written: number; skipped: boolean }> {
  const prod = opts.env.VERCEL_ENV === 'production';
  const outDir = opts.outDir ?? BLOG_DB_DIR;
  const doFetch = opts.fetchImpl ?? fetch;
  const { url, anonKey } = opts;

  if (!url || !anonKey || url.includes('placeholder')) {
    if (prod) {
      throw new Error(
        'blog-sync: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing or placeholder in production; refusing to deploy a blog without its database posts',
      );
    }
    console.log('blog-sync: no Supabase credentials, skipping database posts');
    mkdirSync(outDir, { recursive: true });
    return { written: 0, skipped: true };
  }

  let rows: Row[];
  try {
    const res = await doFetch(
      `${url.replace(/\/$/, '')}/rest/v1/blog_posts?select=${COLUMNS}&status=in.(publicando,publicado)`,
      {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = (await res.json()) as Row[];
    if (!Array.isArray(rows)) throw new Error('unexpected response shape');
  } catch (err) {
    if (prod) {
      throw new Error(`blog-sync: could not fetch posts (${(err as Error).message})`, {
        cause: err,
      });
    }
    console.warn(`blog-sync: fetch failed (${(err as Error).message}), skipping database posts`);
    mkdirSync(outDir, { recursive: true });
    return { written: 0, skipped: true };
  }

  const out: { slug: string; meta: unknown; body: string }[] = [];
  for (const row of rows) {
    if (!row.date) {
      const msg = `blog-sync: row "${row.slug}" has no date`;
      if (prod) throw new Error(msg);
      console.warn(`${msg}, skipping`);
      continue;
    }
    if (typeof row.slug === 'string' && opts.fileSlugs.includes(row.slug)) {
      throw new Error(
        `blog-sync: o slug "${row.slug}" existe como post em arquivo (apps/crm/src/content/blog/) e como post do banco. Despublique o post do banco no Admin (/admin/blog) ou renomeie o arquivo, e rode o deploy de novo.`,
      );
    }
    const body = row.body_md ?? '';
    const parsed = dbPostSchema.safeParse({
      slug: row.slug,
      status: row.status,
      category: row.category,
      title: row.title,
      h1: row.h1,
      description: row.description,
      lede: row.lede,
      date: row.date,
      ...(row.updated ? { updated: row.updated } : {}),
      author: row.author,
      cover: row.cover_image ?? null,
      images: row.images,
      sources: row.sources,
      featureSlug: row.feature_slug ?? null,
      revision: row.revision,
      readingMinutes: readingMinutes(body),
    });
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(
        `blog-sync: post do blog "${row.slug}" inválido no banco (${issues}). Despublique ou edite o post no Admin (/admin/blog) e rode o deploy de novo.`,
      );
    }
    out.push({ slug: parsed.data.slug, meta: parsed.data, body });
  }

  clearDir(outDir);
  for (const { slug, meta, body } of out) {
    writeFileSync(join(outDir, `${slug}.json`), `${JSON.stringify(meta, null, 2)}\n`);
    writeFileSync(join(outDir, `${slug}.body.md`), body);
  }
  console.log(`blog-sync: wrote ${out.length} database post(s)`);
  return { written: out.length, skipped: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fileSlugs = readdirSync('apps/crm/src/content/blog')
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
  syncBlogPosts({
    url: process.env.VITE_SUPABASE_URL,
    anonKey: process.env.VITE_SUPABASE_ANON_KEY,
    env: process.env,
    fileSlugs,
  }).catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
