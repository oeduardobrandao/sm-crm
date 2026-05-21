# Knowledge Base / Help Center (Central de Ajuda)

## Context

New CRM users struggle to discover how features work. Twelve friction points were already identified (see `2026-05-11-contextual-help-system-design.md`), but beyond inline tooltips, users need a browsable collection of step-by-step guides covering each major feature. The goal is a platform-level help center — authored by the platform admin, visible to all CRM users across all workspaces — so agency teams can self-serve instead of reaching out for support.

## Decisions

- **Audience:** CRM users (agency team members), not Hub/client users
- **Authoring:** Platform-level only — platform admins create content via the existing `platform-admin` edge function; all workspaces see the same articles
- **Editor:** TipTap-based WYSIWYG (reusing PostEditor infrastructure), supporting rich text, inline images (R2), YouTube embeds, Loom/Arcade iframes, and GIFs
- **Routes:** `/ajuda` (list), `/ajuda/:slug` (reader), `/ajuda/novo` (create), `/ajuda/:slug/editar` (edit)
- **Contextual help:** Dynamic — admin maps articles to CRM routes via `kb_context_links` table, rendered by a `ContextHelpLinks` component on each page
- **Admin identification:** Reuses existing `platform_admins` table and `verify-admin` action

---

## Database Schema

### Table: `kb_articles`

Platform-level (no `conta_id` scoping).

```sql
CREATE TABLE IF NOT EXISTS kb_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  excerpt text,
  content jsonb,
  content_plain text NOT NULL DEFAULT '',
  cover_image_url text,
  category text NOT NULL,
  tags text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  display_order integer NOT NULL DEFAULT 0,
  author_id uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kb_articles_status_check CHECK (status IN ('draft', 'published')),
  CONSTRAINT kb_articles_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE INDEX IF NOT EXISTS kb_articles_category ON kb_articles (category);
CREATE INDEX IF NOT EXISTS kb_articles_status ON kb_articles (status);
CREATE INDEX IF NOT EXISTS kb_articles_display_order ON kb_articles (display_order);
CREATE INDEX IF NOT EXISTS kb_articles_search ON kb_articles USING gin (
  to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(content_plain, ''))
);
```

Category values (validated in the edge function, not as a DB constraint, for easier future additions):
- `primeiros-passos`, `clientes`, `equipe`, `entregas-e-fluxos`, `hub-do-cliente`, `instagram-e-analytics`, `post-express`, `financeiro`

Auto-update trigger for `updated_at`:

```sql
CREATE OR REPLACE FUNCTION update_kb_articles_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER kb_articles_updated_at
  BEFORE UPDATE ON kb_articles
  FOR EACH ROW EXECUTE FUNCTION update_kb_articles_updated_at();
```

RLS:

```sql
ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read published articles"
  ON kb_articles FOR SELECT TO authenticated
  USING (status = 'published');
```

Admin writes go through the `platform-admin` edge function using the service role client (bypasses RLS), same as `global_banners`.

### Table: `kb_context_links`

Maps CRM route paths to relevant articles for contextual help.

```sql
CREATE TABLE IF NOT EXISTS kb_context_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_pattern text NOT NULL,
  article_id uuid NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  label text,
  display_order integer NOT NULL DEFAULT 0,
  UNIQUE (route_pattern, article_id)
);

ALTER TABLE kb_context_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read context links"
  ON kb_context_links FOR SELECT TO authenticated
  USING (true);
```

### Migration

File: `supabase/migrations/20260519000001_knowledge_base.sql`

Also enables RLS on `platform_admins` (not done in original migration) and adds a self-check policy:

```sql
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can check own admin status"
  ON platform_admins FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```

Reserved slug values: The DB constraint allows "novo" and "editar" as slugs. The edge function's `create-kb-article` and `update-kb-article` handlers must reject these values explicitly.

---

## Backend: platform-admin Edge Function

New actions added to `supabase/functions/platform-admin/index.ts`, following the banner handler pattern:

| Action | Body params | Description |
|--------|-------------|-------------|
| `list-kb-articles` | `{ category?, status? }` | List all articles including drafts. Optionally filter by category/status. |
| `create-kb-article` | `{ title, slug, content, content_plain, excerpt?, cover_image_url?, category, tags?, status?, display_order? }` | Create article. Sets `author_id` to caller's admin ID. Validates slug uniqueness. |
| `update-kb-article` | `{ article_id, ...fields }` | Update any fields. Generates `updated_at` automatically. |
| `delete-kb-article` | `{ article_id }` | Hard delete. Cascades `kb_context_links`. |
| `upsert-kb-context-link` | `{ route_pattern, article_id, label?, display_order? }` | Create or update by `(route_pattern, article_id)` unique pair. |
| `delete-kb-context-link` | `{ link_id }` | Remove a mapping. |

These follow the exact structure of `handleCreateBanner`, `handleUpdateBanner`, `handleDeleteBanner`, and `handleListBanners`.

---

## Store Module

### `apps/crm/src/store/kb.ts`

Read-only functions for regular CRM users (direct Supabase client, subject to RLS):

```typescript
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
```

Functions:
- `getPublishedArticles(): Promise<KbArticle[]>` — `SELECT * FROM kb_articles WHERE status='published' ORDER BY display_order`
- `getArticleBySlug(slug: string): Promise<KbArticle | null>` — single article by slug
- `getContextLinksForRoute(route: string): Promise<KbContextLink[]>` — context links for a route pattern, joined with published articles

### `apps/crm/src/services/kbAdmin.ts`

Admin write operations via `platform-admin` edge function:

```typescript
async function callPlatformAdmin<T>(action: string, body: Record<string, unknown>): Promise<T>
```

Functions:
- `listAllKbArticles(filters?)` — includes drafts (admin only)
- `createKbArticle(article)` — create
- `updateKbArticle(articleId, fields)` — update
- `deleteKbArticle(articleId)` — delete
- `upsertKbContextLink(link)` — create/update context mapping
- `deleteKbContextLink(linkId)` — remove context mapping

### `apps/crm/src/hooks/useIsPlatformAdmin.ts`

Uses the existing `verify-admin` action:

```typescript
export function useIsPlatformAdmin(): { isAdmin: boolean; isLoading: boolean } {
  // calls platform-admin edge function with action: 'verify-admin'
  // staleTime: 10 minutes (result rarely changes)
}
```

Add `export * from './kb';` to `apps/crm/src/store/index.ts`.

---

## Routes & Navigation

### Routes (in `apps/crm/src/App.tsx`)

```typescript
const AjudaPage = lazy(() => import('./pages/ajuda/AjudaPage'));
const ArtigoPage = lazy(() => import('./pages/ajuda/ArtigoPage'));
const ArtigoEditorPage = lazy(() => import('./pages/ajuda/ArtigoEditorPage'));
```

Inside the `AppLayout` protected route group:
- `<Route path="/ajuda" element={<AjudaPage />} />`
- `<Route path="/ajuda/novo" element={<ArtigoEditorPage />} />`
- `<Route path="/ajuda/:slug/editar" element={<ArtigoEditorPage />} />`
- `<Route path="/ajuda/:slug" element={<ArtigoPage />} />`

Order matters: `/ajuda/novo` must come before `/ajuda/:slug`.

Not gated by role or feature flag — all authenticated users can access `/ajuda`.

### Navigation (in `apps/crm/src/components/layout/nav-data.ts`)

Add to the `config` group (bottom section), first item:

```typescript
{ id: 'ajuda', route: '/ajuda', label: 'Ajuda', labelKey: 'nav.ajuda', icon: 'ph-question' }
```

Visible to all roles (the `config` group is not filtered by `getNavGroups()`).

### i18n

Add `nav.ajuda` key to locale files:
- PT: `"Ajuda"`
- EN: `"Help"`

---

## Page Components

### `AjudaPage` — Article List

**File:** `apps/crm/src/pages/ajuda/AjudaPage.tsx`

Layout:
1. Page header: "Central de Ajuda" title + "Novo Artigo" button (visible only if `useIsPlatformAdmin()`)
2. Search bar: text input, client-side filter on `title` and `content_plain`
3. Category filter: horizontal scrollable chips — "Todos" + 8 categories
4. Article grid: responsive card grid (`auto-fill, minmax(320px, 1fr)`, gap `1.5rem`)
5. Each `ArticleCard`: cover image (or category-colored placeholder), title, excerpt, category badge, reading time estimate (calculated as `Math.ceil(content_plain.split(/\s+/).length / 200)` minutes)

Data fetching:
- Regular users: `useQuery({ queryKey: ['kb-articles'], queryFn: getPublishedArticles })`
- Platform admins: `useQuery({ queryKey: ['kb-articles-all'], queryFn: () => listAllKbArticles() })` — shows draft articles with a "Rascunho" badge

### `ArtigoPage` — Article Reader

**File:** `apps/crm/src/pages/ajuda/ArtigoPage.tsx`

Layout:
1. Back link to `/ajuda`
2. Cover image (full-width, rounded)
3. Article header: title, category badge, published date
4. Table of contents sidebar (desktop only): extracted from `heading` nodes in TipTap JSON, sticky position
5. Article body: read-only TipTap rendering via `useEditor({ editable: false, extensions, content })`
6. "Editar" button (platform admin only)
7. Related articles: other published articles in the same category

R2 image resolution: uses existing `extractR2Keys()` + `resolveInlineImageUrls()` + `injectSignedUrls()` from `services/inlineImage.ts`.

### `ArtigoEditorPage` — Admin Editor

**File:** `apps/crm/src/pages/ajuda/ArtigoEditorPage.tsx`

Access: checks `useIsPlatformAdmin()`. If not admin, redirects to `/ajuda` with toast.

Form (react-hook-form + zod):
- Title (text input, required)
- Slug (auto-generated from title via `slugify()`, editable, regex-validated, must not be "novo" or "editar")
- Category (select dropdown, 8 options)
- Tags (comma-separated input)
- Excerpt (textarea, max 200 chars)
- Cover image (upload via R2 presigned flow)
- Status (draft/published toggle)
- Display order (number input)

Content editor: `ArticleEditor` component (see below).

Save: calls `createKbArticle()` or `updateKbArticle()`.
Delete: calls `deleteKbArticle()` with confirmation dialog.

### `ArticleEditor` — TipTap Editor Component

**File:** `apps/crm/src/pages/ajuda/components/ArticleEditor.tsx`

Same setup as `PostEditor` but:
- Removes: `CommentHighlight` extension, comment-related props and UI
- Adds: YouTube extension (`@tiptap/extension-youtube`), `IframeExtension` (custom)
- Toolbar: bold, italic, underline, link, lists, colors, highlight, callout, image upload, YouTube embed, iframe embed
- Placeholder: "Escreva o conteudo do artigo..."

Props:
- `initialContent: Record<string, unknown> | null`
- `onUpdate: (json: Record<string, unknown>, plain: string) => void`
- `disabled?: boolean`
- `onUploadInlineImage?: InlineImageUploadFn`

---

## TipTap Extensions

### New dependency

`@tiptap/extension-youtube` — YouTube embed support. Install: `npm install @tiptap/extension-youtube`.

### Custom: `IframeExtension`

**File:** `apps/crm/src/pages/ajuda/components/IframeExtension.ts`

A TipTap Node extension for embedding Loom, Arcade, and similar services:
- Attributes: `src` (validated URL), `width` (default `100%`), `height` (default `400px`)
- Domain whitelist: `loom.com`, `arcade.software`, `youtube.com`
- Renders as sandboxed `<iframe>` with `allow="autoplay; fullscreen"`
- Toolbar button opens a URL input popover (same pattern as link popover in PostEditor)

---

## Contextual Help Components

### `ArticleLink`

**File:** `apps/crm/src/components/help/ArticleLink.tsx`

Small reusable link component:
- Props: `slug: string`, `label?: string` (defaults to "Saiba mais")
- Renders: `<Link to={/ajuda/${slug}}>` with a BookOpen icon + label text
- Styled as a small text link with primary color

### `ContextHelpLinks`

**File:** `apps/crm/src/components/help/ContextHelpLinks.tsx`

Route-aware component that renders relevant article links:
- Uses `useLocation().pathname` to query `getContextLinksForRoute()`
- Renders a small list of `ArticleLink` components
- Can be placed in page headers or as a floating help section
- Returns null when no articles match the current route

Integration: Add `<ContextHelpLinks />` to key pages — dashboard, clientes, equipe, entregas, post-express, analytics, configuracao.

### Admin UI for context links

In `ArtigoEditorPage`, below the article form, add a "Paginas relacionadas" section where the admin can add/remove route mappings for the current article. Uses a simple list with add/remove buttons and a select dropdown of CRM routes.

---

## Pre-Built Article Topics

Authored through the editor UI after deployment:

| # | Title | Category | Slug |
|---|-------|----------|------|
| 1 | Guia rapido: seu primeiro dia no Mesaas | primeiros-passos | guia-primeiro-dia |
| 2 | Como adicionar um cliente | clientes | como-adicionar-cliente |
| 3 | Como adicionar membros a equipe | equipe | como-adicionar-membros |
| 4 | Como convidar usuarios para o workspace | equipe | como-convidar-usuarios |
| 5 | Como criar um fluxo de entregas | entregas-e-fluxos | como-criar-fluxo |
| 6 | Como usar o Hub do Cliente | hub-do-cliente | como-usar-hub |
| 7 | Como agendar posts no Post Express | post-express | como-agendar-posts |
| 8 | Como usar o preview e funcoes do Instagram | instagram-e-analytics | como-usar-instagram |

---

## File Structure

### New files

```
supabase/migrations/20260519000001_knowledge_base.sql

apps/crm/src/store/kb.ts
apps/crm/src/services/kbAdmin.ts
apps/crm/src/hooks/useIsPlatformAdmin.ts

apps/crm/src/pages/ajuda/
  AjudaPage.tsx                              -- article list
  ArtigoPage.tsx                             -- article reader
  ArtigoEditorPage.tsx                       -- admin editor
  components/
    ArticleEditor.tsx                        -- TipTap editor for articles
    ArticleCard.tsx                          -- card for list grid
    TableOfContents.tsx                      -- TOC sidebar for reader
    IframeExtension.ts                       -- custom TipTap node for Loom/Arcade
    CategoryFilter.tsx                       -- horizontal category chips
    ContextLinkManager.tsx                   -- admin UI for mapping articles to routes

apps/crm/src/components/help/
  ArticleLink.tsx                            -- reusable contextual link
  ContextHelpLinks.tsx                       -- route-aware contextual help
```

### Modified files

```
apps/crm/src/App.tsx                         -- add 4 routes
apps/crm/src/components/layout/nav-data.ts   -- add nav item
apps/crm/src/store/index.ts                  -- barrel export kb.ts
supabase/functions/platform-admin/index.ts    -- add 6 KB actions
i18n locale files (pt, en)                   -- add nav.ajuda key
```

---

## Verification

1. **Migration:** `npx supabase db push --linked` succeeds. Verify tables exist, constraints work (invalid slug, duplicate slug, invalid status).
2. **Edge function:** Deploy `platform-admin`. Test `create-kb-article` and `list-kb-articles` via the CRM. Verify non-admin gets 403.
3. **Admin check:** Log in as platform admin — verify "Novo Artigo" button visible. Log in as regular user — verify button hidden.
4. **Article creation:** Navigate to `/ajuda/novo`. Create an article with rich text, inline image, YouTube embed, callout. Save as draft, then publish.
5. **Article list:** Navigate to `/ajuda`. Published articles appear. Drafts hidden for non-admins. Category filter works. Search works.
6. **Article reader:** Click an article. Full content renders — images resolve (R2), YouTube plays, table of contents navigates, related articles show.
7. **Article editing:** From reader, click "Editar". Modify and save. Changes persist.
8. **Context links:** Admin maps an article to `/clientes`. Navigate to `/clientes`. Contextual help link appears and navigates to the article.
9. **Non-admin guards:** Regular user navigates to `/ajuda/novo` directly — redirected with toast.
10. **Navigation:** "Ajuda" appears in sidebar for all roles.
11. **Dark mode:** All components render correctly.
12. **Mobile:** List page, reader page, and editor responsive.
13. **Typecheck:** `npm run build` — no errors.
14. **Tests:** `npm run test` — no regressions.
