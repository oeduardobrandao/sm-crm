# Blog automático: posts diários com aprovação no Admin

Date: 2026-10-23 · Status: design, awaiting approval
Mockups: https://claude.ai/artifact/AMR6Bwm2ZnZBHpb12FezZ1 (post page, infographic style, Admin queue)

## Intent

Improve GEO (being cited by AI assistants) and organic search for Mesaas by publishing one useful,
timely blog post per day for the ICP: Brazilian social media managers and copywriters. Topics:
new AI models and how to use them in agency work, platform/format trends, how to handle hot
topics as they come up, planning (e.g. next year's calendar), practical guides.

Drafting is automated; publishing is not. Eduardo approves every post in the Admin, mostly as
a safety net so nothing wrong or embarrassing goes live.

Drafting runs as a **Claude Code Routine** on Eduardo's Claude Max account (first-party Claude
Code, so subscription usage is compliant; no Console API key and no LLM call from Mesaas servers).

## Goals

- One draft per day lands in an Admin queue, without anyone touching it.
- Posts look like a polished editorial blog (Medium-like): cover photo, serif reading body,
  pull quotes, inline infographics, linked sources.
- Real, openly licensed photos with credit; generated infographics in one tasteful house style.
- Every news claim links its source. A "Fontes" list closes every post.
- Once a week, one post pulls the reader into a specific Mesaas feature.
- Approved posts are fully static, prerendered HTML (same as today), in the sitemap and llms.txt.
- Eduardo can approve, reject, edit the text himself, or leave a note for the Routine to rewrite.

## Non-goals

- No LLM integration inside Mesaas (no API key, no edge function calling a model).
- No AI image generation of photos or infographics (models garble text and numbers).
- No auto-publish, ever. No scheduling of approved posts for a later date (v1 publishes on approve).
- No English or other languages.
- No comments, newsletter, or social auto-posting of the blog.

## Anti-goals (failure even if it "works")

- Invented stats, quotes, or facts; a number without a source.
- Copyrighted news photos used without a license.
- Posts that read like ads every day. Only the weekly feature post sells.
- Copy rule violations: em dashes in copy, "aprovado pela Meta" (only "API oficial").
- Repetitive topics, or the same feature pitched twice in a row.
- Breaking the static, hydration-stable public pages or the existing six posts' URLs.

## Decided by Eduardo

- Routine on his Max plan (not a Console API key).
- Approval queue inside the Admin app (not GitHub PRs).
- Both "Editar texto" (edit in place) and "Pedir ajuste" (note, Routine rewrites).
- Byline for automated posts: **"Equipe Mesaas"**.
- Medium-like visuals; real publicly available images; generated infographics with good taste;
  linked sources; one feature-driving post per week.

## Architecture

```
Routine (daily, 06:00 America/Sao_Paulo, Eduardo's claude.ai account)
  ├─ web search / fetch: news + sources + licensed images
  └─ Admin MCP connector (OAuth, platform admin) ──> mcp-admin edge function
                                                      ├─ blog_posts (Postgres)
                                                      └─ blog-images (public storage bucket)
Admin app "Blog" page ── platform-admin edge function ── approve ──> Vercel Deploy Hook
Vercel build: blog-sync (fetch published posts) → vite build → prerender (static HTML)
```

### 1. Data model (migration)

Table `blog_posts` (my call on exact columns; builder may refine):

| column | notes |
|---|---|
| `id` uuid pk | |
| `slug` text unique | lowercase-hyphen, validated; must not collide with a file post's slug |
| `status` text | `rascunho` · `ajuste_solicitado` · `publicando` · `publicado` · `rejeitado` |
| `category` text | see Categories below |
| `title`, `h1`, `description` | same limits as `blogFrontmatterSchema` (title 50–60, h1 10–120, description 120–160) |
| `lede` text | the standfirst under the H1 |
| `body_md` text | Markdown body (rules in §4) |
| `cover_image` jsonb | `{url, alt, credit, license, source_url}`; nullable (draft flagged "sem imagem") |
| `images` jsonb | array of `{key, url, alt, credit, license, source_url}` referenced from the body |
| `sources` jsonb | array of `{title, publisher, url, published_at?}`, min 1 for `noticia`/`tendencia` |
| `feature_slug` text null | set on the weekly feature post (key into the feature list, §7) |
| `topic_reason` text | "Por que este tema", shown in the Admin sidebar |
| `checks` jsonb | server-computed checklist results (§3) |
| `revision_note` text null | Eduardo's "Pedir ajuste" note |
| `revised_after_note` bool | shows the "Reescrito após sua nota" chip |
| `rejection_reason` text null | |
| `author` text | `equipe` for automated posts |
| `date`, `updated` date | `date` set on approve; `updated` on later edits |
| `created_at`, `updated_at`, `approved_at`, `approved_by` | |

RLS: no access for `authenticated`. **Public `anon` SELECT only where `status in ('publicando','publicado')`**,
because the Vercel build reads with the anon key (no service-role key in Vercel's env). Writes
only via service role from `mcp-admin` and `platform-admin`, which check `platform_admins`.
Remember the hosted-parity GRANT pattern (`et_grant_hosted_parity`) if an entitlement suite
touches it.

Storage: new public bucket `blog-images`, mirroring `kb-images` (`mcp-admin/images.ts`), with
the same SSRF-safe `source_url` server-side fetch. External image URLs are never rendered; only
our bucket.

Migration version: above main's tail at PR time (currently `20261025…`; an open PR uses
`20261026…`). Renumber before `gh pr create` if needed.

### 2. MCP surface (mcp-admin)

New scopes `blog:read`, `blog:write` in `_shared/mcp-admin-scopes.ts` and the CRM mirror
`apps/crm/src/lib/mcp-scopes.ts`. Changing scopes = redeploy `mcp-admin` + `mcp-oauth-consent`
+ the CRM, and Eduardo re-authorizes the connector with the new scopes ticked.

Tools:
- `list_blog_posts({status?, since_days?})`: slug, title, category, status, feature_slug,
  revision_note, rejection_reason, created_at, plus the valid `feature_slug` keys. The Routine uses
  this for dedup (last 60 days, all statuses, including the 6 file posts' slugs/titles), for
  pending notes, and for feature rotation.
- `get_blog_post({id})`: full post, for rewrites.
- `create_blog_draft({...})`: validates every field server-side (limits, slug, category,
  sources required by category, every image `credit`+`license` non-empty, body rules in §4,
  infographic blocks parse, known `feature_slug`). On failure returns a field-by-field error
  **including the limits** so the Routine can fix and retry. On success runs the checks (§3) and
  returns them.
- `update_blog_draft({id, ...})`: only for `rascunho`/`ajuste_solicitado`. After a note, sets
  status back to `rascunho`, `revised_after_note = true`, clears `revision_note`.
- `upload_blog_image({source_url, filename, mime_type, alt, credit, license, page_url})`:
  server fetches the image, stores in `blog-images`, returns the public URL.
- No tool approves, publishes or deletes. Audit every call (`insertAuditLog`, as the existing tools do).

Zod limits must match `apps/crm/src/content/blog.schema.ts`. Deno cannot import that file
directly as-is (bare `zod`), so keep a mirrored constant set and a parity test (builder's call
on the mechanism).

### 3. Automatic checks (server-side, stored in `checks`)

Run on create/update, shown in the Admin sidebar:
- Every source URL and in-body external link answers (SSRF-safe fetch, short timeout).
- Every image has credit + license; cover present (else "sem imagem").
- Title/description lengths (always pass after validation, shown for confidence).
- No em dash (`—`) in title/h1/description/lede/body; no "aprovado pela Meta".
- Slug/title not similar to any post (file or DB) in the last 60 days (simple normalized-title
  check; the Routine does the semantic dedup).

Failing checks don't block saving; they show as red chips in the queue ("1 imagem sem licença").
Approve stays possible but the confirm dialog lists the failing checks.

### 4. Post content format

- Markdown body rendered by the existing `react-markdown` path (`blog.markdown.tsx`, shared by
  the static mirror and the React page). **No raw HTML passthrough** (never add `rehype-raw`);
  links pass `sanitizeUrl`; external links keep `rel="nofollow noopener"`.
- Images in the body: `![alt](img:<key>)`, resolved from `images` into a `<figure>` with the
  credit line ("Foto: autor / fonte, licença X"). Plain external image URLs are rejected at draft time.
- Pull quote: a blockquote whose only child is a paragraph renders as the large centered pull
  quote (mockup). My call; builder may choose a marker instead.
- Infographic: a fenced block ` ```infografico ` with JSON, validated by zod at draft time.
  v1 kinds: `barras` (labeled horizontal bars with values), `numeros` (2–4 big numbers with
  captions), `etapas` (3–6 numbered steps). Every kind has `titulo` and, for `barras`/`numeros`,
  a required `fonte` (index into `sources`). Rendered as HTML (not an image) by one shared
  component in the house style: warm off-white `#f7f5f0`, ink `#12151a`, one yellow accent
  `#ffbf30`, SF Pro Display, generous type, no gradients, no 3D, no decorative icons. Numbers
  stay real text, which AI crawlers can read and quote. Light and dark variants.
- "Fontes" section rendered from `sources` at the end of every post (not written in the body).
- Weekly feature CTA: when `feature_slug` is set, render the dark "No Mesaas" block (mockup)
  after the body, with the feature's headline, one sentence, and a link to its page. Content per
  feature comes from a code-side map (§7), not from the Routine, so the pitch is always accurate.
- Byline "Equipe Mesaas" for `author = equipe` (the 6 existing posts keep Eduardo); JSON-LD
  `author` becomes an `Organization` for these.
- Visual refresh of the post page per the mockup (serif reading body via a system stack
  `Charter, 'Iowan Old Style', Georgia, serif`, no web font, so the landing's perf work isn't
  undone; wide cover; drop cap optional). Applies to all posts, file and DB. Hydration-stable,
  CSS stays in `style.css` (blog is public, see the CSS split rules).

Categories: add `noticia`, `tendencia`, `planejamento` to the existing `comparativo`, `guia`
(labels Notícia, Tendência, Planejamento). AI is a topic, not a category. Update
`BLOG_CATEGORIES`, `CATEGORY_LABEL`, the duplicate map in `generate-og-image.ts`, and tests.

### 5. Build pipeline

The six existing posts **stay as files** in `apps/crm/src/content/blog/` (my call: it keeps
hand-written posts in git and lets CI build without a database). DB posts are merged in at build:

1. New `scripts/seo/blog-sync.ts` runs first in the build. It fetches `publicando`/`publicado`
   posts from Supabase with `VITE_SUPABASE_URL` + anon key and writes them as `.md` files
   (frontmatter + body, images/sources/infographics serialized) into a **gitignored**
   `apps/crm/src/content/blog/_db/`. Both loaders read `blog/**/*.md` (`blog.client.ts` glob and
   `blog-fs.ts`), so prerender, sitemap, llms.txt, related posts and the React pages pick them up
   unchanged. Extend the frontmatter schema for the new fields (author, lede, cover, feature, etc.).
2. Failure modes: on Vercel production (`VERCEL_ENV=production`) a fetch error **fails the build**
   (never silently drop published posts). Elsewhere (CI `landing-prerender-smoke`, local) a missing
   or placeholder URL skips the sync with a log line; zero DB posts is fine there because the six
   file posts keep `blog-fs`'s non-empty guard satisfied.
3. Slug collision between a file post and a DB post fails the build.
4. `vercel.json` `buildCommand` becomes `npm run blog:sync && npm run build && …` (prerender is
   already after build).
5. OG image: per-post Playwright generation can't run for DB posts (it's a manual commit step).
   For DB posts, `og:image` is the cover photo (bucket URL); if none, the default OG image. My call.

### 6. Admin app

New nav item and route "Blog" (`apps/admin`), pattern of the KB pages:
- **Tabs**: Aguardando (rascunho + ajuste_solicitado + publicando), Publicados, Rejeitados.
- **List** (left): cover thumb, created time, category, title, chips: `N fontes`,
  `Post da semana: recurso`, failing checks in red, `Reescrito após sua nota`, `Desatualizado`
  (a `noticia` draft older than 3 days; computed, sorts it to the bottom), `Publicando…`.
- **Detail** (right): rendered preview using the same rendering components as the public page
  (and a full-screen preview), sidebar with checks, "Por que este tema", and the note field.
- **Actions**: Aprovar e publicar (confirm dialog; lists failing checks if any), Pedir ajuste
  (requires the note), Editar texto (Markdown editor for title/h1/description/lede/body, with the
  same validation; reuse the KB editor where it fits), Rejeitar (optional reason).
  Copy pt-BR, sentence case, no em dashes. Phone layout like the other Admin pages.
- Admin actions go through `platform-admin` (new actions), which verifies platform admin.

### 7. Publish flow and feature list

Approve → status `publicando`, `date` = today (São Paulo), `approved_at/by` → `platform-admin`
POSTs the **Vercel Deploy Hook** (`VERCEL_BLOG_DEPLOY_HOOK`, Supabase secret, document in
CLAUDE.md). Hook failure: status back to `rascunho` and an error toast.

Becoming `publicado`: when the Admin lists `publicando` posts, `platform-admin` checks
`https://www.mesaas.com.br/blog/<slug>` for 200 and flips the status. After 30 minutes still
`publicando`, the chip turns into "Publicação demorando: verifique o deploy na Vercel" with a
"Tentar de novo" (re-fires the hook). Editing an already published post sets `updated` and
re-fires the hook.

Approving deploys `main` as it is right then, same as any deploy. Acceptable.

Feature list (for the CTA block and the Routine's rotation): a code-side map in
`apps/crm/src/content/` keyed by `feature_slug` (aprovacao, hub-do-cliente, relatorios,
agendamento, briefing, agenda, ...; builder fills from existing funnel pages in `paginas/`), each
with headline, one sentence and target URL. The Deno side needs the same keys (mirror + parity
test, like the schema limits).

### 8. The Routine (deliverable in the repo)

`docs/routines/blog-diario.md`: the full brief pasted into the Routine, versioned in git. It covers:
- Run order: (1) rewrite any `ajuste_solicitado` drafts first, following the note; (2) list the
  last 60 days of posts + pending queue; (3) pick today's topic (news within ~72h preferred,
  otherwise evergreen planning/guide), never repeating; (4) feature post if no non-rejected
  feature post was created in the last 7 days, rotating `feature_slug` away from the last one;
  (5) research, (6) images, (7) write, (8) `create_blog_draft`, fix and retry on validation errors.
- Sources: primary sources first (official announcements, docs), reputable press next. Every
  factual claim about news links its source inline; every number in an infographic cites one.
  Never invent stats, quotes, prices, dates. If unconfirmed, say so or leave it out.
- Images: only Wikimedia Commons (with stated license), Unsplash, Pexels, and official press kits
  that allow editorial use. Credit + license + page URL required. No image found → no cover; never a risky one.
- Voice: pt-BR, calm, practical, for agency professionals; concrete "como usar amanhã" sections;
  800–1500 words; SEO title/description limits; no em dashes; "API oficial" yes, "aprovado pela
  Meta" no; feature posts stay useful even without the CTA.
- Answer-first structure for GEO: a direct answer in the first paragraph, descriptive H2s phrased
  like the questions people ask, short definitional sentences that are easy to quote.

**Human setup checklist** (in the same doc): create the Routine in Claude Code on Eduardo's
account, daily 06:00 America/Sao_Paulo, with web access; add the Admin MCP connector (OAuth as a
platform admin, tick `blog:read` + `blog:write`); paste the brief; run once manually and approve a
post end to end. Caveats: Routines are a research preview, owned by one personal account, with
per-account run caps, and they spend the Max plan's automation credit. If Routines go away, the
fallback is a Console API key + scheduled GitHub Action calling the same MCP tools.

## Rollout

1. Migration (table, RLS, bucket) on staging, then prod.
2. Deploy `mcp-admin`, `mcp-oauth-consent`, `platform-admin` to staging, then prod. Set
   `VERCEL_BLOG_DEPLOY_HOOK` per environment (unset on staging: approve then shows "Publicação
   indisponível neste ambiente").
3. Merge (frontend: blog rendering, Admin page, build sync). Merge deploys the frontend at once,
   so steps 1 and 2 go first.
4. Re-authorize the Admin MCP connector with the new scopes; set up the Routine; dry run.

## Testing

- Vitest: schema (new categories, fields, limits), infographic zod + rendering, `img:` resolution,
  pull quote, Fontes, feature CTA, byline/JSON-LD, sync serializer round trip (DB row → .md →
  `parsePost`), collision and failure modes of `blog-sync`, Admin page states and actions.
- Deno: MCP tools (validation errors carry limits, scope gating, no approve tool, audit), checks,
  platform-admin actions (approve → hook, publicando → publicado).
- Entitlements/psql: anon can read only `publicando`/`publicado`; authenticated reads nothing.
- Browser: a published DB post renders identically in the static HTML and after hydration;
  `landing-prerender-smoke` still passes with placeholder env.

## Left to the builder

Exact column types and indexes; the Deno/Vite parity mechanism; whether the Admin preview
imports the CRM rendering components directly or through `packages/`; the editor component; the
link-check implementation details and timeouts; how `blog-sync` serializes structured fields into
frontmatter (the current reader is one-line `key: value`, so JSON-in-a-line or a sidecar `.json`
is fine).

## My calls, for Eduardo to check

- The six existing posts stay as files with Eduardo's byline; only automated posts live in the DB.
- No "escrito com IA" disclosure line on posts (byline "Equipe Mesaas" only).
- Cover photo doubles as the OG image for automated posts.
- News drafts go "Desatualizado" after 3 days; evergreen never.
- Daily run at 06:00 São Paulo; one draft per day; rewrites of noted drafts come first.
- Infographics rendered as HTML in a fixed house style, never as generated images.
- Failing checks warn but don't block approval.
- The post-page visual refresh applies to the six existing posts too.
