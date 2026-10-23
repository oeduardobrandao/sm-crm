# Blog automático Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily Claude Code Routine drafts blog posts into an Admin approval queue via the Admin MCP; approved posts are built into the static blog on Vercel.

**Architecture:** New `blog_posts` table (anon reads only `publicando`/`publicado`) + `blog-images` public bucket. `mcp-admin` gains `blog:*` tools for the Routine; `platform-admin` gains the Admin's review/publish actions, which fire a Vercel Deploy Hook. At build, `blog-sync` exports DB posts to gitignored files that the existing loaders, prerender, sitemap and llms.txt merge with the hand-written Markdown posts. Rendering pieces (figures, infographic, Fontes, feature CTA, safe links) live in `packages/ui/blog/` so the CRM page, the static mirror and the Admin preview share them.

**One deviation from the spec, on purpose:** spec §5 says one JSON per DB post. The plan writes two files per post (`<slug>.json` metadata + `<slug>.body.md` body) so the client can load metadata eagerly and bodies lazily, which the spec also requires. Same shared schema, same build-time behavior.

**Tech Stack:** React 19 + Vite, react-markdown 10 + remark-gfm, zod 3, Supabase Postgres/RLS/Storage, Deno edge functions, Vitest, Deno test, psql entitlement suites, Vercel.

**Spec:** `docs/superpowers/specs/2026-10-23-blog-automatico-design.md` (read it with this plan; mockups at https://claude.ai/artifact/AMR6Bwm2ZnZBHpb12FezZ1).

## Global Constraints

- All user-facing copy pt-BR, sentence case, **no em dashes** (`—`) in copy; never "aprovado pela Meta" ("API oficial" is fine).
- Limits copied from `blogFrontmatterSchema`: title 50–60, h1 10–120, description 120–160 chars; slug `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Categories: `comparativo`, `guia`, `noticia`, `tendencia`, `planejamento` → labels Comparativo, Guia, Notícia, Tendência, Planejamento.
- Statuses: `rascunho`, `ajuste_solicitado`, `publicando`, `publicado`, `rejeitado`, `despublicado`.
- Every post has ≥ 1 source. Every image has non-empty `credit` and `license`. Images only from our `blog-images` bucket.
- Automated posts: `author = 'equipe'`, byline "Equipe Mesaas", JSON-LD author `Organization`. File posts keep `BLOG_AUTHOR`.
- Feature keys (v1, public routes only): `aprovacao-de-post` → `/aprovacao-de-post`, `portal-do-cliente` → `/portal-do-cliente`, `agente-de-conteudo-ia` → `/agente-de-conteudo-ia`.
- Prerender import graph: **relative imports only** (no `@/`, no `@mesaas/ui` alias) in anything `scripts/seo/*` reaches.
- Public-page CSS goes in `apps/crm/style.css` or the blog's own `blog.css` (already public); never `app.css`.
- No raw HTML in Markdown (never add `rehype-raw`); every rendered `href` passes `sanitizeUrl`.
- Edge functions: `buildCorsHeaders(req)`, generic errors to clients, every outbound fetch has an `AbortSignal.timeout(...)`, state changes are conditional updates.
- Reading body serif stack: `Charter, 'Iowan Old Style', Georgia, serif`. No new web fonts.
- Infographic palette: ground `#f7f5f0`, ink `#12151a`, accent `#ffbf30`; dark: ground `#12151a`, ink `#e8eaf0`, same accent.
- Migration version prefix above main's tail at PR time (use `20261027000001`…; renumber before `gh pr create` if main moved).
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`.

## Review Focus

1. **Routine sends a link like `javascript:alert(1)` or `/\t/evil.com` in the body** → rendered as `#` everywhere (page, mirror, Admin preview). Test in Task 3.
2. **A DB post's slug equals a file post's slug** (`mesaas-vs-mlabs`) → `create_blog_draft` rejects it, and if one slipped into the DB the production build fails loudly instead of shadowing. Tests in Tasks 4 and 6.
3. **Editing a live post, then the Vercel build fails** → row stays `publicando`, `live_revision` unchanged, old page stays live; a 200 from the old deployment never flips it. Test in Task 7.
4. **Supabase unreachable during the Vercel production build** → build fails (non-zero exit), never ships a blog without its DB posts; in CI with placeholder env it skips and passes. Test in Task 4.
5. **Infographic JSON with a `fonte` index out of range, 0 items, or a non-numeric bar value** → rejected at draft time with a field-level message; never reaches the renderer. Tests in Tasks 2 and 6.

---

### Task 0: Spike: unattended Routine can call the Admin MCP (manual, Eduardo + agent)

No code. Gate for everything else.

- [ ] **Step 1:** Eduardo creates a throwaway Routine in Claude Code (his account) with the existing Admin MCP connector attached and the prompt "Call list_kb_articles and report how many articles exist." Schedule: once, a few minutes ahead.
- [ ] **Step 2:** Confirm in the Routine's run log that the tool call succeeded without anyone logged in, and in `audit_log` that an `mcp_admin.list_kb_articles` row appeared with `key_id` `oauth:…`.
- [ ] **Step 3:** If it fails, **stop** and report back; the spec's drafting path needs revisiting. If it passes, delete the throwaway Routine and continue.

---

### Task 1: Database: `blog_posts`, RLS, `blog-images` bucket

**Files:**
- Create: `supabase/migrations/20261027000001_blog_posts.sql`
- Create: `supabase/tests/entitlements/70_blog_posts.sql`

**Interfaces:**
- Produces: table `public.blog_posts` with columns exactly as the spec §1 table plus `live_revision int null`, `publish_attempt_at timestamptz null`, `revision int not null default 1`; bucket `blog-images` (public, `image/jpeg|png|webp|gif`, 10 MB).

- [ ] **Step 1: Write the entitlement suite** `70_blog_posts.sql` (follow the style of the neighbouring suites; call `et_grant_hosted_parity()` first). Assertions:
  - as `anon`: `select count(*) from blog_posts` returns only rows with status `publicando`/`publicado` (seed one row of each of the six statuses as postgres first; expect 2);
  - as `anon`: `insert`/`update`/`delete` raise `42501`;
  - as `authenticated`: `select count(*)` = 0 and writes raise `42501`;
  - check constraints: inserting `status = 'foo'`, `category = 'foo'`, `author = 'foo'`, or `sources = '[]'` fails (`23514`);
  - `slug` unique (`23505`).
- [ ] **Step 2:** Run `npm run test:db` (needs Docker; otherwise rely on CI and say so). Expected: FAIL (table missing).
- [ ] **Step 3: Write the migration.** Table with `check` constraints for status/category/author (`'equipe'`), `jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) >= 1`, `images` default `'[]'`, `checks` default `'{}'`, `updated_at` trigger (reuse the repo's existing `set_updated_at` helper if present). `enable row level security`; `revoke all on blog_posts from anon, authenticated` (name roles explicitly; `FROM PUBLIC` doesn't cover them); `grant select on blog_posts to anon`; policy `blog_posts_public_read for select to anon using (status in ('publicando','publicado'))`. Bucket insert mirroring `20260720000002_kb_images_bucket.sql` + limits from `20260908000003_kb_images_bucket_limits.sql`. Index on `(status, created_at desc)`.
- [ ] **Step 4:** Run `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(blog): blog_posts table, RLS and blog-images bucket`.

---

### Task 2: Shared blog model and its Deno mirror

**Files:**
- Modify: `apps/crm/src/content/blog.schema.ts`, `apps/crm/src/content/blog.ts` (`CATEGORY_LABEL`), `scripts/seo/generate-og-image.ts` (category map: import `CATEGORY_LABEL` relatively instead of duplicating)
- Create: `apps/crm/src/content/blog.features.ts`
- Create: `supabase/functions/_shared/blog-rules.ts`
- Create: `supabase/functions/_shared/blog-file-posts.ts`
- Test: `apps/crm/src/content/__tests__/blog.schema.test.ts` (extend), `apps/crm/src/content/__tests__/blog-rules-parity.test.ts` (new)

**Interfaces:**
- Produces (CRM, `blog.schema.ts`):
  - `BLOG_CATEGORIES = ['comparativo','guia','noticia','tendencia','planejamento'] as const`
  - `BLOG_LIMITS = { title: [50,60], h1: [10,120], description: [120,160] } as const` (the frontmatter schema reads these)
  - `blogSourceSchema = { title: string 1..200, publisher: string 1..120, url: http(s) url, published_at?: isoDate }`
  - `blogImageSchema = { key: /^[a-z0-9-]{1,40}$/, url: string, alt: 1..200, credit: 1..200, license: 1..120, source_url: http(s) url }`
  - `infograficoSchema` = discriminated union on `tipo`:
    - `barras`: `{ tipo, titulo 1..90, fonte: int ≥0, itens: [{ rotulo 1..60, valor: number ≥0, exibicao?: string ≤20 }] 2..8 }`
    - `numeros`: `{ tipo, titulo, fonte, itens: [{ valor: string 1..16, legenda 1..90 }] 2..4 }`
    - `etapas`: `{ tipo, titulo, itens: [{ rotulo 1..60 }] 3..6 }`
  - `dbPostSchema` (strict): `{ slug, status: 'publicando'|'publicado', category, title, h1, description, lede 1..300, date, updated?, author: 'equipe', cover: blogImageSchema.omit({key}) | null, images: blogImageSchema[], sources: blogSourceSchema[] ≥1, featureSlug: FeatureSlug | null, revision: int ≥1 }`
  - `BlogPost` gains optional `author?: 'equipe'`, `lede?`, `cover?`, `images?`, `sources?`, `featureSlug?`, `revision?`, and `body` becomes `body: string | null` (null = lazy DB body, see Task 4)
  - Exported types: `BlogSource`, `BlogImage`, `Infografico` (= `z.infer` of the three schemas above), `DbPost` (= `z.infer<typeof dbPostSchema>`)
  - `parseDbPost(meta: unknown, body: string | null): BlogPost` (throws `blog-db/<slug>: <issues>`)
  - `extractInfograficos(body: string): Array<{ index: number; value: unknown }>` (finds ```` ```infografico ```` fences, JSON-parses each)
  - `validateInfograficos(body: string, sourcesCount: number): string[]` (messages like `infografico[1].fonte: índice 3 fora de sources (0..1)`; empty = ok)
- Produces (`blog.features.ts`): `BLOG_FEATURES: Record<FeatureSlug, { titulo: string; frase: string; href: string }>`, `type FeatureSlug = 'aprovacao-de-post'|'portal-do-cliente'|'agente-de-conteudo-ia'`. Copy: write it from each page's hero in `content/paginas/*.ts` (no em dashes).
- Produces (Deno, `_shared/blog-rules.ts`): `BLOG_CATEGORIES`, `BLOG_LIMITS`, `BLOG_FEATURE_SLUGS`, `BLOG_STATUSES`, and zod (`npm:zod@3`) mirrors of `blogSourceSchema`, `blogImageSchema`, `infograficoSchema`, plus `validateInfograficos` with the same messages.
- Produces (`_shared/blog-file-posts.ts`): `BLOG_FILE_POSTS: ReadonlyArray<{ slug: string; title: string }>` for the six current posts.

- [ ] **Step 1: Failing tests** in `blog.schema.test.ts`:
  - `parsePost` accepts `category: noticia`; rejects `category: ia`;
  - `parseDbPost` round-trips a fixture with every field; rejects `sources: []`, an image with `credit: ''`, unknown `featureSlug`, and `status: 'rascunho'`;
  - `validateInfograficos` returns `[]` for a valid `barras`; returns a message containing `fonte` for `fonte: 3` with 2 sources; a message for `itens: []`; a message for `valor: "dez"` on `barras`; a message for invalid JSON inside the fence.
- [ ] **Step 2: Failing parity test** `blog-rules-parity.test.ts`: read `supabase/functions/_shared/blog-rules.ts` and `blog-file-posts.ts` as text (like the existing scope guard does) and assert: categories, limits, feature slugs and statuses equal the CRM constants; `BLOG_FILE_POSTS` slugs equal the `.md` filenames in `apps/crm/src/content/blog/` and titles equal their frontmatter `title`.
- [ ] **Step 3:** `npx vitest run apps/crm/src/content/__tests__/blog.schema.test.ts apps/crm/src/content/__tests__/blog-rules-parity.test.ts` → FAIL.
- [ ] **Step 4: Implement** the CRM side, then the Deno mirrors. `blog.schema.ts` stays relative-imports-only and gains a `./blog.features` import for `FeatureSlug`.
- [ ] **Step 5:** Same command → PASS. Also `npx vitest run apps/crm/src/content` (existing blog tests must stay green) and `npm run check:functions`.
- [ ] **Step 6: Commit** `feat(blog): shared post model, infographic schema, Deno mirror`.

---

### Task 3: Shared rendering pieces (`packages/ui/blog/`)

**Files:**
- Create: `packages/ui/blog/safe-href.ts`, `packages/ui/blog/markdown.tsx`, `packages/ui/blog/Infografico.tsx`, `packages/ui/blog/PostFigure.tsx`, `packages/ui/blog/Fontes.tsx`, `packages/ui/blog/FeatureCta.tsx`, `packages/ui/blog/blog-render.css`
- Modify: `apps/crm/src/content/blog.markdown.tsx` (becomes a re-export of `blogMarkdownComponents(post)` for compatibility)
- Test: `packages/ui/__tests__/blog-render.test.tsx`

**Interfaces:**
- Consumes: Task 2 types (`BlogPost`, `infograficoSchema` types), `BLOG_FEATURES`.
- Produces:
  - `safeHref(href: string | undefined): string`: same rules as `apps/crm/src/utils/security.ts` `sanitizeUrl` (copy the function with a comment pointing at the original and a test that both agree on a table of inputs; `packages/ui` can't import from `apps/crm`).
  - `blogMarkdownComponents(post: Pick<BlogPost,'images'>): Components`: `a` → `safeHref` + external `rel="nofollow noopener" target="_blank"`; `img` with `src="img:<key>"` → `<PostFigure>` from `post.images` (unknown key or non-`img:` src → render nothing); `blockquote` whose only child is one paragraph → `<blockquote className="blog-pullquote">`; `code` with `className="language-infografico"` → `<Infografico data=…/>` (invalid JSON → nothing; validation happened at draft time).
  - `<Infografico data={Infografico} sources={BlogSource[]} />`: `<figure className="blog-info blog-info--{tipo}">` with title, items as real text, and `<figcaption>Fonte: <a href=safeHref(source.url)>{publisher}</a></figcaption>` for `barras`/`numeros`. Bars: width = `valor / max * 100%`, label shows `exibicao ?? pt-BR formatted valor`.
  - `<PostFigure image={BlogImage} />`: `<figure><img loading="lazy" alt/><figcaption>Foto: {credit}, licença {license}. <a href=source_url>Fonte</a></figcaption></figure>`.
  - `<Fontes sources={BlogSource[]} />`: `<section className="blog-fontes"><h2>Fontes</h2><ol>…<a>{title}</a>, {publisher}{, date pt-BR}</ol></section>`.
  - `<FeatureCta slug={FeatureSlug} />`: dark block "No Mesaas" with `BLOG_FEATURES[slug]` and link "Conhecer o recurso".
  - `blog-render.css`: styles for `.blog-info*`, `.blog-pullquote`, `.blog-figure`, `.blog-fontes`, `.blog-feature-cta`, light + `[data-theme='dark']`, palette from Global Constraints, follows the mockup's Infografico and Main boards.
- All files use relative imports only (they're in the prerender graph).

- [ ] **Step 1: Failing tests** (`renderToStaticMarkup`):
  - `[x](javascript:alert(1))` → `href="#"`; `[x](/%09/evil.com)` → `href="#"`; `[x](https://a.com)` → has `rel="nofollow noopener"`; `[x](/precos)` → plain `href="/precos"`;
  - `![a](img:capa)` with matching image → output contains `Foto: Autor, licença CC BY 4.0`; `![a](https://x.com/a.png)` → no `<img>`;
  - single-paragraph blockquote → `class="blog-pullquote"`;
  - an `infografico` `barras` fence → contains each `rotulo` and the `Fonte:` caption linking the source; bar widths `100%` for the max item;
  - `<Fontes>` renders an `<ol>` with one `<li>` per source;
  - `safeHref` agrees with `sanitizeUrl` on a 10-row table (http, https, relative, `//evil`, `javascript:`, `data:`, tab-injected, `%0a`-injected, empty, `mailto:`).
- [ ] **Step 2:** `npx vitest run packages/ui/__tests__/blog-render.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** `blog.markdown.tsx` keeps exporting `MARKDOWN_COMPONENTS` as `blogMarkdownComponents({ images: [] })` so existing imports compile until Task 5 replaces them.
- [ ] **Step 4:** Same → PASS; `npx vitest run apps/crm/src/content` still green.
- [ ] **Step 5: Commit** `feat(blog): shared render pieces with safe links, figures, infographic`.

---

### Task 4: `blog-sync` and the merged loaders

**Files:**
- Create: `scripts/seo/blog-sync.ts`
- Modify: `scripts/seo/blog-fs.ts`, `apps/crm/src/content/blog.client.ts`, `package.json` (script `blog:sync`), `vercel.json` (`buildCommand` → `npm run blog:sync && npm run build && npm run prerender && npm run build:hub && npm run build:admin`), `.gitignore` (`apps/crm/src/content/blog-db/`)
- Test: `scripts/seo/__tests__/blog-sync.test.ts` (new; match where other `scripts/` tests live: `scripts/seo/*.test.*`), `apps/crm/src/content/__tests__/blog-content.test.ts` (extend)

**Interfaces:**
- Consumes: `parseDbPost`, `dbPostSchema`, `BLOG_FILE_POSTS` not needed here (collision is checked against the actual files).
- Produces:
  - `blog-sync.ts` exports `syncBlogPosts(opts: { url?: string; anonKey?: string; env: { VERCEL_ENV?: string }; fetchImpl?: typeof fetch; outDir?: string; fileSlugs: string[] }): Promise<{ written: number; skipped: boolean }>` and a CLI entry. Writes per post `blog-db/<slug>.json` (all `dbPostSchema` fields) and `blog-db/<slug>.body.md` (raw `body_md`); clears the dir first. Selects via PostgREST `GET /rest/v1/blog_posts?select=…&status=in.(publicando,publicado)` with `AbortSignal.timeout(15000)`.
  - Failure rules: `VERCEL_ENV === 'production'` and (missing URL/key, fetch error, non-2xx, a row failing `dbPostSchema`, or a slug in `fileSlugs`) → throw (CLI exits 1). Otherwise missing/placeholder URL (`!url || url.includes('placeholder')`) → `{ skipped: true }` with a log line; other errors outside production also throw except fetch failure, which logs and skips.
  - `blog-fs.ts` `loadPostsFromDisk()` returns file posts + DB posts (`parseDbPost(json, body)`, body read eagerly at build); throws on a duplicate slug across the two.
  - `blog.client.ts`: `BLOG_POSTS` = file posts (eager, as today) + DB posts from `import.meta.glob('./blog-db/*.json', { eager: true, import: 'default' })` with `body: null`; `loadPostBody(slug: string): Promise<string>` from `import.meta.glob('./blog-db/*.body.md', { query: '?raw', import: 'default' })` (lazy); file posts resolve their body immediately.

- [ ] **Step 1: Failing tests** for `syncBlogPosts` with a stub `fetchImpl` and a tmp `outDir`:
  - writes `x.json` + `x.body.md` for one valid row and returns `{ written: 1 }`;
  - production + fetch rejects → throws; non-production + fetch rejects → `{ skipped: true }`;
  - production + no URL → throws; CI-like placeholder URL, non-production → `{ skipped: true }`, no fetch call;
  - production + row slug in `fileSlugs` → throws mentioning the slug;
  - production + row with `sources: []` → throws mentioning `sources`;
  - re-run with zero rows removes stale files from the previous run.
- [ ] **Step 2:** Extend `blog-content.test.ts`: `loadPostsFromDisk` with a fixture `blog-db` dir (point via an exported `DB_DIR` override or a parameter) returns 7 posts and throws on a duplicate slug.
- [ ] **Step 3:** `npx vitest run scripts/seo apps/crm/src/content/__tests__/blog-content.test.ts` → FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5:** Same → PASS. Then the CI smoke locally: `VITE_SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_ANON_KEY=placeholder npm run blog:sync && npx vite build --config apps/crm/vite.config.ts && npm run prerender` → exits 0, "Prerendered … + 6 blog posts".
- [ ] **Step 6: Commit** `feat(blog): sync published DB posts into the static build`.

---

### Task 5: Post page refresh, static mirror parity, SEO

**Files:**
- Modify: `apps/crm/src/pages/blog/BlogPostPage.tsx`, `apps/crm/src/pages/blog/BlogIndexPage.tsx` (cards show cover thumb when present, category label), `apps/crm/src/pages/blog/blog.css`, `apps/crm/src/content/blog.seo.tsx`, `apps/crm/src/content/blog.ts` (`postOgImage(post)`, `postAuthor(post)`), `apps/crm/src/content/jsonld.ts` (`blogPostingJsonLd`), `scripts/seo/prerender.tsx` (rev meta)
- Test: `apps/crm/src/content/__tests__/blog.seo.test.tsx`, `apps/crm/src/content/__tests__/jsonld.test.ts`, `apps/crm/src/pages/blog/__tests__/BlogPostPage.test.tsx` (extend existing), `apps/crm/src/content/__tests__/blog-og.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 (`BlogPost` optional fields, `blogMarkdownComponents`, `PostFigure`, `Fontes`, `FeatureCta`, `loadPostBody`).
- Produces:
  - `postAuthor(post): { name: string; role: string; bio?: string; kind: 'person' | 'organization' }` → `equipe` → `{ name: 'Equipe Mesaas', role: 'Mesaas', kind: 'organization' }`, else `BLOG_AUTHOR`.
  - `postOgImage(post: BlogPost): string` (signature change from `slug`): `post.cover?.url ?? (post.author === 'equipe' ? DEFAULT_OG : ${SITE_URL}/og/blog/${slug}.png)`. Update every caller.
  - `blogPostingJsonLd`: `author` = `Organization` (`name: 'Equipe Mesaas'`, publisher url) for `equipe`; `image` = `postOgImage(post)`.
  - `renderBlogPostHtml(post, all)`: adds lede, cover `PostFigure`, `blogMarkdownComponents(post)`, `<Fontes>` when `sources?.length`, `<FeatureCta>` when `featureSlug`, author via `postAuthor`. Body must be non-null at build (Task 4 reads it eagerly); throw if null.
  - Prerender adds `<meta name="mesaas-blog-rev" content="{revision}">` to the head of each post with `revision` defined.
  - Page layout per the mockup's Main board: crumbs, category pill, H1, lede (serif), byline row, wide cover figure (max 1040px), serif body (max 680px, 1.22rem/1.75), Fontes, FeatureCta, "Continue lendo" grid (cover thumbs). DB posts render the header immediately and the body after `loadPostBody` resolves (skeleton lines meanwhile); a `loadPostBody` failure shows "Não foi possível carregar o artigo." with a "Tentar novamente" button.

- [ ] **Step 1: Failing tests:**
  - **Parity** (`blog.seo.test.tsx`): for a fixture DB post with a cover, an `img:` figure, one `barras` infographic, two sources and `featureSlug`, both `renderBlogPostHtml` and `renderToStaticMarkup(<BlogPostView post/>)` (body pre-resolved) contain: the lede, `Foto: …` credit for cover and inline image, every infographic `rotulo`, `Fontes` + both source titles, the feature `titulo`, and "Equipe Mesaas". Neither contains `—`.
  - `jsonld.test.ts`: equipe post → `author['@type'] === 'Organization'`, `image === cover.url`; file post unchanged.
  - `BlogPostPage.test.tsx`: DB post shows skeleton then body (mock `loadPostBody`); rejected load shows the retry copy; file post renders body synchronously as today.
  - `blog-og.test.ts`: existing assertions updated for `postOgImage(post)`; equipe without cover → default OG.
  - prerender: a unit test (or extend an existing prerender test) asserting the rev meta tag for a post with `revision: 3`.
- [ ] **Step 2:** `npx vitest run apps/crm/src/content apps/crm/src/pages/blog` → FAIL.
- [ ] **Step 3: Implement.** Import `packages/ui/blog/*` by relative path in `blog.seo.tsx`; the React page may use `@mesaas/ui/blog/...`. Import `blog-render.css` from `BlogPostPage.tsx` (public lazy route, so the CSS-split guard must stay green: run `npx vitest run apps/crm/src/__tests__/cssSplitBoundary.test.ts`).
- [ ] **Step 4:** Same tests → PASS; `npx vitest run apps/crm/src/__tests__/cssSplitBoundary.test.ts` → PASS.
- [ ] **Step 5: Browser check:** `npm run dev:env`, open `/blog/como-organizar-aprovacao-de-posts` (light + dark, 375px and 1280px): serif body, no horizontal scroll, no console errors. Then drop a fixture into `blog-db/` and check it renders cover, infographic, Fontes, CTA. Screenshot both.
- [ ] **Step 6: Commit** `feat(blog): editorial post page, mirror parity, org author and rev marker`.

---

### Task 6: MCP tools for the Routine

**Files:**
- Modify: `supabase/functions/_shared/mcp-admin-scopes.ts` (+`blog:read`, `blog:write`; read preset gains `blog:read`), `apps/crm/src/lib/mcp-scopes.ts`, `apps/admin/src/lib/mcp-admin-scopes.ts` (labels "Blog (leitura)", "Blog (escrita)"; drop the "esta não tem teste" comment), `supabase/functions/mcp-admin/tools.ts`, `supabase/functions/mcp-admin/images.ts`
- Create: `supabase/functions/mcp-admin/blog.ts`, `supabase/functions/mcp-admin/blog-checks.ts`
- Test: `supabase/functions/__tests__/mcp-admin-blog_test.ts`, `supabase/functions/__tests__/mcp-admin-auth_test.ts` (extend the sync guard to the Admin mirror)

**Interfaces:**
- Consumes: `_shared/blog-rules.ts`, `_shared/blog-file-posts.ts`, existing `fetchImageSafely` helpers in `images.ts`, `register()` in `tools.ts`, `mcp-admin-helpers.ts` test fakes.
- Produces (tools; descriptions in pt-BR and must state the limits):
  - `list_blog_posts` (`blog:read`) `{ status?: BlogStatus, since_days?: 1..365 }` → `{ posts: [{ id, slug, title, category, status, feature_slug, revision_note, rejection_reason, created_at }], file_posts: BLOG_FILE_POSTS, feature_slugs: BLOG_FEATURE_SLUGS }`.
  - `get_blog_post` (`blog:read`) `{ post_id: uuid }` → full row.
  - `create_blog_draft` (`blog:write`) `{ slug, category, title, h1, description, lede, body_md, cover_image?, images?, sources, feature_slug?, topic_reason }` → `{ id, checks }`. Validation errors throw `McpInputError` with one line per field, e.g. `title: 64 caracteres; precisa ter de 50 a 60.`
  - `update_blog_draft` (`blog:write`) `{ post_id, …same fields optional }`: only when status is `rascunho`/`ajuste_solicitado` (else `McpInputError('Só rascunhos podem ser editados pela rotina.')`); bumps `revision`; when coming from `ajuste_solicitado` → `rascunho`, `revised_after_note = true`, `revision_note = null`.
  - `upload_blog_image` (`blog:write`) `{ source_url, filename, mime_type, alt, credit, license, page_url }` → `{ url, width, height }` into `blog-images` under `drafts/<yyyy-mm>/`. Server-side fetch only (no signed-PUT mode).
  - `runBlogChecks(deps, post): Promise<BlogChecks>` in `blog-checks.ts`: `{ links: { ok: boolean; broken: string[] }, images: { ok, missing_license: string[] }, cover: boolean, copy: { em_dash: boolean; meta_endorsement: boolean }, similar_titles: string[] }`. Link checks: unique URLs from `sources` + body, max 20, `HEAD` then `GET` fallback, `AbortSignal.timeout(5000)` each, run in parallel with `Promise.allSettled`, SSRF-safe via the same resolver `images.ts` uses. Similar titles: normalized (lowercase, strip accents/punctuation) Jaccard ≥ 0.6 on word sets vs. DB posts (60 days) + `BLOG_FILE_POSTS`.
  - Rejects: slug present in DB or `BLOG_FILE_POSTS`; body with `<` + tag-like HTML (`/<[a-z!\/]/i`); `![…](…)` whose target isn't `img:<key>` of a provided image; link targets that aren't `http(s)`/relative; unknown `feature_slug`.
  - No approve/publish/delete tool exists.

- [ ] **Step 1: Failing Deno tests** (`mcp-admin-blog_test.ts`, using `mcp-admin-helpers.ts`):
  - without `blog:write`, `create_blog_draft` → `Permission denied: missing scope 'blog:write'`;
  - title of 64 chars → error text contains `title` and `50 a 60`;
  - slug `mesaas-vs-mlabs` → rejected (file-post collision);
  - `sources: []` → rejected; image with `license: ''` → rejected; `![x](https://a/b.png)` → rejected; raw `<script>` → rejected; infographic with `fonte` out of range → rejected with `infografico[0].fonte`;
  - valid draft → inserted with `status 'rascunho'`, `author 'equipe'`, `revision 1`, checks stored; audit row `mcp_admin.create_blog_draft`;
  - `update_blog_draft` on a `publicado` row → rejected; on `ajuste_solicitado` → `rascunho`, `revised_after_note true`, `revision 2`;
  - `runBlogChecks`: a link whose fetch hangs past the timeout lands in `broken` (stub fetch that never resolves + fake timers or short timeout injection); em dash in body → `copy.em_dash true`.
  - `mcp-admin-auth_test.ts`: guard asserts `apps/admin/src/lib/mcp-admin-scopes.ts` values equal `ADMIN_MCP_ALLOWED_SCOPES`.
- [ ] **Step 2:** `deno test --no-check supabase/functions/__tests__/mcp-admin-blog_test.ts supabase/functions/__tests__/mcp-admin-auth_test.ts` → FAIL.
- [ ] **Step 3: Implement.** Add `post_id` to `ID_KEYS` and `auditArgs` keys.
- [ ] **Step 4:** Same → PASS; `npm run check:functions` → PASS; `npx vitest run apps/crm/src/lib apps/admin/src/lib` (any scope UI tests) → PASS.
- [ ] **Step 5: Commit** `feat(mcp-admin): blog draft tools and automatic checks`.

---

### Task 7: Admin review and publish actions (`platform-admin`)

**Files:**
- Create: `supabase/functions/platform-admin/blog-posts.ts`, `supabase/functions/_shared/vercel-deploy-hook.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (cases), `supabase/functions/mcp-admin/blog.ts` (export the field validator so `update-blog-post` reuses it; or move it to `_shared/blog-validate.ts` if import direction requires)
- Test: `supabase/functions/__tests__/platform-admin-blog_test.ts`

**Interfaces:**
- Consumes: Task 6 validator, `runBlogChecks`, `insertAuditLog`.
- Produces (actions, all after the existing `platform_admins` check; handlers take `(svc, body, adminUserId, headers, deps)` with `deps = { fireHook(): Promise<boolean>; fetchLive(slug): Promise<string | null>; now(): Date }` for tests):
  - `list-blog-posts` `{ tab: 'aguardando'|'publicados'|'rejeitados' }` → rows (no `body_md`) + `last_draft_at`. Side effect: for each `publicando` row, `confirmLive`: fetch `https://www.mesaas.com.br/blog/<slug>` (timeout 5 s), parse `mesaas-blog-rev`; if equal to `revision` → `update … set status='publicado', live_revision=revision where id=$1 and status='publicando' and revision=$2`. Checks run in parallel, capped at 10 rows per call.
  - `get-blog-post` `{ id }` → full row.
  - `update-blog-post` `{ id, fields }` (Editar texto): allowed for `rascunho`, `ajuste_solicitado`, `publicado`, `publicando`; validates; bumps `revision`; reruns checks; if the row was `publicado`/`publicando` → sets `updated` (today São Paulo), status `publicando`, fires hook.
  - `approve-blog-post` `{ id, expected_revision }`: conditional update `where status in ('rascunho','ajuste_solicitado') and revision = expected_revision` → `publicando`, `date` = today São Paulo (keep existing `date` if already set), `approved_at/by`, `publish_attempt_at`; then `fireHook()`; on false → revert with a conditional update and return `502 { error: 'deploy_hook_failed' }`. No hook configured → `503 { error: 'publish_unavailable' }` before changing state.
  - `request-blog-changes` `{ id, note (1..1000) }` → `ajuste_solicitado`, `revision_note`.
  - `reject-blog-post` `{ id, reason? }` → `rejeitado`.
  - `unpublish-blog-post` `{ id }` (`publicado`/`publicando` only) → `despublicado`, fire hook. `republish-blog-post` `{ id }` (`despublicado` only) → `publicando`, fire hook.
  - `retry-blog-publish` `{ id }` (`publicando` only) → updates `publish_attempt_at`, fires hook.
  - `fireHook()` in `_shared/vercel-deploy-hook.ts`: `POST Deno.env.get('VERCEL_BLOG_DEPLOY_HOOK')`, `AbortSignal.timeout(8000)`, returns `res.ok`; `isDeployHookConfigured(): boolean`.
  - Every mutating action writes `insertAuditLog` (`action: 'blog.<verb>'`).
  - Errors: generic messages, details only in `console.error`.

- [ ] **Step 1: Failing Deno tests:**
  - approve with stale `expected_revision` → 409 and no hook call;
  - approve, hook returns false → status back to the prior value, 502;
  - approve, hook unset → 503, status unchanged;
  - list with a `publicando` row at revision 2: live page has rev 1 → stays `publicando`; live page has rev 2 → `publicado`, `live_revision 2`; `fetchLive` throws/times out → stays `publicando`, response still 200;
  - editing a `publicado` row → `publicando`, `revision` +1, `live_revision` unchanged, hook fired once;
  - unpublish then republish transitions; unpublish on `rascunho` → 409;
  - request changes with empty note → 400;
  - non-admin user → 403 (existing gate, one smoke test).
- [ ] **Step 2:** `deno test --no-check supabase/functions/__tests__/platform-admin-blog_test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Same → PASS; `npm run check:functions` → PASS.
- [ ] **Step 5: Commit** `feat(platform-admin): blog review and publish actions with revision-checked go-live`.

---

### Task 8: Admin "Blog" page

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (one function per Task 7 action), `apps/admin/src/lib/nav-items.ts` (`NavId` + item `blog`, label "Blog", icon `Newspaper`), `apps/admin/src/lib/routes.ts`, `apps/admin/src/router.tsx` (`blog`, `blog/:id`)
- Create: `apps/admin/src/pages/BlogPage.tsx`, `apps/admin/src/pages/blog/BlogList.tsx`, `apps/admin/src/pages/blog/BlogDetail.tsx`, `apps/admin/src/pages/blog/BlogEditor.tsx`, `apps/admin/src/pages/blog/blog-view.ts` (pure helpers), `apps/admin/src/pages/blog/BlogPreview.tsx`
- Test: `apps/admin/src/pages/__tests__/BlogPage.test.tsx`, `apps/admin/src/pages/blog/__tests__/blog-view.test.ts`

**Interfaces:**
- Consumes: Task 7 actions; `@mesaas/ui/blog/*` render pieces and `blog-render.css`; Task 2 types (import from `apps/crm` is not available to the Admin; define the row type in `blog-view.ts`).
- Produces (`blog-view.ts`):
  - `isStale(row, now): boolean` → `category === 'noticia' && status in (rascunho, ajuste_solicitado) && now - created_at > 3 days`.
  - `sortQueue(rows, now)`: non-stale first by `created_at` desc, stale last.
  - `chipsFor(row, now): Array<{ label: string; tone: 'success'|'warning'|'danger'|'neutral' }>`: `N fontes`, `Post da semana: recurso`, one red chip per failing check (`Link fora do ar`, `Imagem sem licença`, `Sem imagem de capa`, `Travessão no texto`, `Tema parecido com outro post`), `Reescrito após sua nota`, `Desatualizado`, `Publicando…`, and `Publicação demorando` when `publicando` and `now - publish_attempt_at > 30 min`.
  - `noRecentDraft(lastDraftAt, now): boolean` → > 36 h.
- UI per the mockup's FilaAdmin board: tabs Aguardando / Publicados / Rejeitados; list left, detail right (stacks on phone, like other Admin pages); detail toolbar: Rejeitar, Editar texto, Pedir ajuste, Aprovar e publicar (Publicados tab: Editar texto, Despublicar; Rejeitados: none; `despublicado` rows show "Publicar de novo"). Sidebar: checks, "Por que este tema", note textarea (Pedir ajuste disabled until non-empty). Confirm dialogs: "Publicar este post?" (lists failing checks if any), "Despublicar este post?", "Rejeitar este post?". Banner when `noRecentDraft`: "Nenhum rascunho novo desde {data}. Confira a rotina e o conector." `publish_unavailable` → toast "Publicação indisponível neste ambiente." Preview: `BlogPreview` renders lede, cover, body with `blogMarkdownComponents`, Fontes, FeatureCta, using `blog-render.css`.

- [ ] **Step 1: Failing unit tests** for `isStale`, `sortQueue`, `chipsFor` (each chip trigger), `noRecentDraft` (35 h false, 37 h true).
- [ ] **Step 2: Failing page tests** (mock `api.ts`): Aguardando renders rows with chips; clicking Aprovar opens the dialog listing a failing check, confirming calls `approveBlogPost(id, revision)`; Pedir ajuste is disabled with an empty note and calls `requestBlogChanges` with the note; Publicados shows Despublicar; the 36 h banner shows when `last_draft_at` is old; a `publish_unavailable` error shows the toast copy above.
- [ ] **Step 3:** `npx vitest run apps/admin/src/pages/__tests__/BlogPage.test.tsx apps/admin/src/pages/blog` → FAIL.
- [ ] **Step 4: Implement.** Editor: title/h1/description/lede inputs with live char counters showing the limits, Markdown `Textarea` for the body, and a preview toggle. Client-side checks are hints only; the server validates.
- [ ] **Step 5:** Same → PASS; `npx tsc -p apps/admin/tsconfig.json --noEmit` → clean.
- [ ] **Step 6: Browser check** with `npm run dev:admin` against a fake backend (stub `platform-admin` responses as in the memory notes on local Admin verification): queue, detail, dialogs, phone width 375px, dark mode. Screenshot.
- [ ] **Step 7: Commit** `feat(admin): blog approval queue`.

---

### Task 9: Routine brief, docs, rollout notes

**Files:**
- Create: `docs/routines/blog-diario.md`
- Modify: `CLAUDE.md` (env var `VERCEL_BLOG_DEPLOY_HOOK`; Gotchas: rollback rule, `blog-db/` is generated, `_shared/blog-file-posts.ts` must list new file posts, `blog:*` scopes = redeploy mcp-admin + mcp-oauth-consent + CRM + Admin)

**Interfaces:**
- Consumes: tool names and fields from Task 6, feature slugs from Task 2.

- [ ] **Step 1: Write `docs/routines/blog-diario.md`** in pt-BR, two parts:
  - **Brief** (pasted into the Routine), following spec §8 exactly: run order (rewrites → list 60 days → topic → feature rule → research → images → write → `create_blog_draft` with retry on validation errors, max 3 tries, then stop and report), sourcing rules, image sources (Wikimedia Commons with license, Unsplash, Pexels, official press kits for editorial use; always via `upload_blog_image`; no image → no cover), voice and length (800–1500 words), answer-first GEO structure, `infografico` fence format with one example per `tipo`, `img:<key>` syntax, copy rules (no em dash, Meta rule), and "never invent numbers, quotes, prices or dates".
  - **Setup checklist** for Eduardo: create the Routine (daily 06:00 America/Sao_Paulo, web access on), connect the Admin MCP connector ticking `blog:read` + `blog:write`, paste the brief, run once by hand, approve the first post end to end; caveats (research preview, per-account caps, Max automation credit, fallback needs non-interactive MCP auth that v1 doesn't have).
- [ ] **Step 2:** Update `CLAUDE.md` as listed. No em dashes in the new copy.
- [ ] **Step 3:** Full pre-push suite: `npm run lint && npm run format:check && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json && npm run test && npm run check:functions && npm run test:functions` → all green. (`ls node_modules/.deno` after the Deno runs; `npm ci` if it appeared.)
- [ ] **Step 4: Commit** `docs(blog): routine brief, setup checklist and gotchas`.

---

### Rollout (after review, before merge; human-confirmed steps)

1. `supabase db push` the migration to staging, then prod.
2. Deploy `mcp-admin`, `mcp-oauth-consent`, `platform-admin` to staging, then prod (`--use-api`; keep each function's existing `--no-verify-jwt` setting).
3. Create the Vercel Deploy Hook for `main` (production) and set `VERCEL_BLOG_DEPLOY_HOOK` on prod only.
4. Merge (deploys the frontend).
5. Eduardo re-authorizes the Admin MCP connector with `blog:*`, sets up the Routine (Task 9 checklist) and approves the first post; confirm it flips to `publicado` and appears in `/blog`, the sitemap and `llms.txt`.
