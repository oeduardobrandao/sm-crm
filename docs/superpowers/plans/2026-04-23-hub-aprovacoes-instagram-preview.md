# Hub Aprovações Instagram Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Hub Aprovações page so posts with media render as Instagram-style previews, posts without media render as compact expandable text cards, and clients can preview selected posts in a full-screen Instagram profile grid with drag-to-reorder.

**Architecture:** Three frontend components (InstagramPostCard, TextPostCard, InstagramGridPreview) replace the existing PostCard on the Aprovações page. The backend is extended with an Instagram profile query in the existing hub-posts handler and a new hub-instagram-feed edge function for lazy-loading the profile grid data. Selection state and grid preview are managed locally in AprovacoesPage — no persistence.

**Tech Stack:** React 19, TypeScript, TailwindCSS, TanStack Query, Supabase Edge Functions (Deno), HTML5 Drag and Drop API

**Spec:** `docs/superpowers/specs/2026-04-23-hub-aprovacoes-instagram-preview-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `apps/hub/src/types.ts` | Modify | Add `InstagramProfile`, `InstagramFeedProfile`, `InstagramFeedPost`, `InstagramFeedData`, `HubPostsResponse` |
| `apps/hub/src/api.ts` | Modify | Extract `fetchPosts` return type, add `fetchInstagramFeed()` |
| `supabase/functions/hub-posts/handler.ts` | Modify | Add Instagram profile query, fix early-return shape |
| `supabase/config.toml` | Modify | Add `hub-instagram-feed` with `verify_jwt = false` |
| `supabase/functions/hub-instagram-feed/handler.ts` | Create | Edge function handler for Instagram grid data |
| `supabase/functions/hub-instagram-feed/index.ts` | Create | Edge function entry point |
| `apps/hub/src/components/TextPostCard.tsx` | Create | Compact expandable card for text-only posts |
| `apps/hub/src/components/InstagramPostCard.tsx` | Create | Instagram-style post preview card |
| `apps/hub/src/components/FeedPreviewButton.tsx` | Create | Button to open grid preview when posts selected |
| `apps/hub/src/components/InstagramGridPreview.tsx` | Create | Full-screen modal with Instagram profile grid |
| `apps/hub/src/pages/AprovacoesPage.tsx` | Modify | Split posts by media, selection state, new components |
| `apps/hub/src/components/__tests__/TextPostCard.test.tsx` | Create | Tests for TextPostCard |
| `apps/hub/src/components/__tests__/InstagramPostCard.test.tsx` | Create | Tests for InstagramPostCard |
| `apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx` | Create | Tests for InstagramGridPreview |
| `supabase/functions/__tests__/hub-functions_test.ts` | Modify | Tests for hub-posts changes and hub-instagram-feed |

---

### Task 1: Add Types and Update API Layer

**Files:**
- Modify: `apps/hub/src/types.ts`
- Modify: `apps/hub/src/api.ts`

- [ ] **Step 1: Add Instagram types to `types.ts`**

Add these interfaces at the end of `apps/hub/src/types.ts`, before the closing of the file (after the `HubIdeia` interface):

```typescript
export interface InstagramProfile {
  username: string | null;
  profilePictureUrl: string | null;
}

export interface InstagramFeedProfile extends InstagramProfile {
  followerCount: number;
  followingCount: number;
  mediaCount: number;
}

export interface InstagramFeedPost {
  id: string;
  thumbnailUrl: string | null;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  permalink: string;
  postedAt: string;
  impressions: number;
}

export interface InstagramFeedData {
  profile: InstagramFeedProfile;
  recentPosts: InstagramFeedPost[];
}

export interface HubPostsResponse {
  posts: HubPost[];
  postApprovals: PostApproval[];
  propertyValues: HubPostProperty[];
  workflowSelectOptions: HubSelectOption[];
  instagramProfile: InstagramProfile | null;
}
```

- [ ] **Step 2: Update `api.ts` to use `HubPostsResponse` and add `fetchInstagramFeed`**

In `apps/hub/src/api.ts`:

1. Add `InstagramFeedData` and `HubPostsResponse` to the type import:
```typescript
import type {
  HubBootstrap, HubPost, PostApproval, HubPostProperty, HubSelectOption, HubBrand, HubBrandFile,
  HubPage, HubPageFull, BriefingQuestion, HubIdeia, IdeiaReaction,
  InstagramFeedData, HubPostsResponse
} from './types';
```

2. Replace the `fetchPosts` function (line 43-44) with:
```typescript
export function fetchPosts(token: string) {
  return get<HubPostsResponse>('hub-posts', { token });
}
```

3. Add `fetchInstagramFeed` after `submitApproval` (after line 49):
```typescript
export function fetchInstagramFeed(token: string) {
  return get<InstagramFeedData>('hub-instagram-feed', { token });
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit --project apps/hub/tsconfig.json 2>&1 | head -30`

Expected: No errors (the new `HubPostsResponse` type includes `instagramProfile` which the backend doesn't return yet — but the frontend doesn't consume it yet either, so the generic `get<T>` cast passes).

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/api.ts
git commit -m "feat(hub): add Instagram types and fetchInstagramFeed API function"
```

---

### Task 2: Extend hub-posts Backend with Instagram Profile

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts`
- Modify: `supabase/functions/__tests__/hub-functions_test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to `supabase/functions/__tests__/hub-functions_test.ts` after the existing hub-posts tests (after line 539):

```typescript
Deno.test("hub-posts includes instagramProfile when the client has a linked account", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", {
    data: { username: "studio_marca", profile_picture_url: "https://cdn.ig/pic.jpg" },
    error: null,
  });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.instagramProfile.username, "studio_marca");
  assertEquals(body.instagramProfile.profilePictureUrl, "https://cdn.ig/pic.jpg");
  assertEquals(body.propertyValues, []);
  assertEquals(body.workflowSelectOptions, []);
});

Deno.test("hub-posts returns instagramProfile as null when no account is linked", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", {
    data: null,
    error: null,
  });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.instagramProfile, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eduardosouza/Projects/sm-crm && deno test supabase/functions/__tests__/hub-functions_test.ts --filter "instagramProfile" 2>&1 | tail -20`

Expected: FAIL — `body.instagramProfile` is `undefined` because the handler doesn't return it yet.

- [ ] **Step 3: Implement the changes in handler.ts**

In `supabase/functions/hub-posts/handler.ts`, make two changes:

**Change 1:** Replace the early return on line 47:
```typescript
    if (workflowIds.length === 0) return json({ posts: [], postApprovals: [] });
```
with:
```typescript
    if (workflowIds.length === 0) {
      const { data: igAccount } = await db
        .from("instagram_accounts")
        .select("username, profile_picture_url")
        .eq("client_id", hubToken.cliente_id)
        .maybeSingle();

      return json({
        posts: [],
        postApprovals: [],
        propertyValues: [],
        workflowSelectOptions: [],
        instagramProfile: igAccount
          ? { username: igAccount.username, profilePictureUrl: igAccount.profile_picture_url }
          : null,
      });
    }
```

**Change 2:** Replace the final return (lines 120-125):
```typescript
    return json({
      posts: flatPostsWithMedia,
      postApprovals: postApprovals ?? [],
      propertyValues: propertyValues ?? [],
      workflowSelectOptions: workflowSelectOptions ?? [],
    });
```
with:
```typescript
    const { data: igAccount } = await db
      .from("instagram_accounts")
      .select("username, profile_picture_url")
      .eq("client_id", hubToken.cliente_id)
      .maybeSingle();

    return json({
      posts: flatPostsWithMedia,
      postApprovals: postApprovals ?? [],
      propertyValues: propertyValues ?? [],
      workflowSelectOptions: workflowSelectOptions ?? [],
      instagramProfile: igAccount
        ? { username: igAccount.username, profilePictureUrl: igAccount.profile_picture_url }
        : null,
    });
```

- [ ] **Step 4: Update the existing "empty collections" test**

The existing test at line 521 (`hub-posts returns empty collections when the client has no workflows`) now needs an `instagram_accounts` queue entry since the handler queries it on the early return path. Update it by adding a queue entry after the `workflows` queue (line 527):

```typescript
  db.queue("instagram_accounts", "select", { data: null, error: null });
```

And update the assertion at line 539 — add:
```typescript
  assertEquals(body.instagramProfile, null);
```

- [ ] **Step 5: Run all hub-posts tests to verify they pass**

Run: `cd /Users/eduardosouza/Projects/sm-crm && deno test supabase/functions/__tests__/hub-functions_test.ts --filter "hub-posts" 2>&1 | tail -20`

Expected: All hub-posts tests PASS.

- [ ] **Step 6: Also update the main hub-posts success test**

The test at line 54 (`hub-posts returns flattened post data with signed media URLs`) also needs the `instagram_accounts` queue entry. Add after the `post_media` queue (after line 96):

```typescript
  db.queue("instagram_accounts", "select", {
    data: { username: "studio_marca", profile_picture_url: "https://cdn.ig/pic.jpg" },
    error: null,
  });
```

- [ ] **Step 7: Run full test suite**

Run: `cd /Users/eduardosouza/Projects/sm-crm && deno test supabase/functions/__tests__/hub-functions_test.ts 2>&1 | tail -20`

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/hub-posts/handler.ts supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat(hub-posts): include instagramProfile in response with consistent shape on early return"
```

---

### Task 3: Create hub-instagram-feed Edge Function

**Files:**
- Create: `supabase/functions/hub-instagram-feed/handler.ts`
- Create: `supabase/functions/hub-instagram-feed/index.ts`
- Modify: `supabase/config.toml`
- Modify: `supabase/functions/__tests__/hub-functions_test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests to `supabase/functions/__tests__/hub-functions_test.ts`. First add the import at the top (after line 9):

```typescript
import { createHubInstagramFeedHandler } from "../hub-instagram-feed/handler.ts";
```

Then add the tests at the end of the file:

```typescript
Deno.test("hub-instagram-feed returns profile and recent posts for a valid token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: {
      id: "ig-acc-1",
      username: "studio_marca",
      profile_picture_url: "https://cdn.ig/pic.jpg",
      follower_count: 15300,
      following_count: 892,
      media_count: 42,
    },
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [
      {
        instagram_post_id: "ig-post-1",
        thumbnail_url: "https://cdn.ig/thumb1.jpg",
        media_type: "IMAGE",
        permalink: "https://instagram.com/p/abc",
        posted_at: "2026-04-20T10:00:00.000Z",
        impressions: 5292,
      },
      {
        instagram_post_id: "ig-post-2",
        thumbnail_url: null,
        media_type: "CAROUSEL_ALBUM",
        permalink: "https://instagram.com/p/def",
        posted_at: "2026-04-18T14:00:00.000Z",
        impressions: 4555,
      },
    ],
    error: null,
  });

  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.profile.username, "studio_marca");
  assertEquals(body.profile.followerCount, 15300);
  assertEquals(body.recentPosts.length, 2);
  assertEquals(body.recentPosts[0].id, "ig-post-1");
  assertEquals(body.recentPosts[1].thumbnailUrl, null);
});

Deno.test("hub-instagram-feed returns 404 when no Instagram account is linked", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: null,
    error: null,
  });

  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed?token=hub-123"));
  assertEquals(response.status, 404);
});

Deno.test("hub-instagram-feed rejects missing tokens with 400", async () => {
  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed"));
  assertEquals(response.status, 400);
});

Deno.test("hub-instagram-feed returns 404 for invalid tokens", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed?token=expired"));
  assertEquals(response.status, 404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eduardosouza/Projects/sm-crm && deno test supabase/functions/__tests__/hub-functions_test.ts --filter "hub-instagram-feed" 2>&1 | tail -20`

Expected: FAIL — module not found.

- [ ] **Step 3: Create handler.ts**

Create `supabase/functions/hub-instagram-feed/handler.ts`:

```typescript
import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
};

interface HubInstagramFeedHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
}

export function createHubInstagramFeedHandler(deps: HubInstagramFeedHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) return json({ error: "token required" }, 400);

    const db = deps.createDb();

    const { data: hubToken } = await db
      .from("client_hub_tokens")
      .select("cliente_id, conta_id, is_active")
      .eq("token", token)
      .gt("expires_at", deps.now())
      .maybeSingle();

    if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

    const { data: igAccount } = await db
      .from("instagram_accounts")
      .select("id, username, profile_picture_url, follower_count, following_count, media_count")
      .eq("client_id", hubToken.cliente_id)
      .maybeSingle();

    if (!igAccount) return json({ error: "Conta Instagram não encontrada." }, 404);

    const { data: posts } = await db
      .from("instagram_posts")
      .select("instagram_post_id, thumbnail_url, media_type, permalink, posted_at, impressions")
      .eq("instagram_account_id", igAccount.id)
      .order("posted_at", { ascending: false })
      .limit(30);

    return json({
      profile: {
        username: igAccount.username,
        profilePictureUrl: igAccount.profile_picture_url,
        followerCount: igAccount.follower_count,
        followingCount: igAccount.following_count,
        mediaCount: igAccount.media_count,
      },
      recentPosts: (posts ?? []).map((p: any) => ({
        id: p.instagram_post_id,
        thumbnailUrl: p.thumbnail_url,
        mediaType: p.media_type,
        permalink: p.permalink,
        postedAt: p.posted_at,
        impressions: p.impressions ?? 0,
      })),
    });
  };
}
```

- [ ] **Step 4: Create index.ts**

Create `supabase/functions/hub-instagram-feed/index.ts`:

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createHubInstagramFeedHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createHubInstagramFeedHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
}));
```

- [ ] **Step 5: Add config.toml entry**

Add to the end of `supabase/config.toml`:

```toml

[functions.hub-instagram-feed]
verify_jwt = false
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/eduardosouza/Projects/sm-crm && deno test supabase/functions/__tests__/hub-functions_test.ts --filter "hub-instagram-feed" 2>&1 | tail -20`

Expected: All 4 tests PASS.

- [ ] **Step 7: Run full edge function test suite**

Run: `cd /Users/eduardosouza/Projects/sm-crm && deno test supabase/functions/__tests__/hub-functions_test.ts 2>&1 | tail -20`

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/hub-instagram-feed/ supabase/config.toml supabase/functions/__tests__/hub-functions_test.ts
git commit -m "feat: add hub-instagram-feed edge function for Instagram grid preview data"
```

---

### Task 4: Create TextPostCard Component

**Files:**
- Create: `apps/hub/src/components/TextPostCard.tsx`
- Create: `apps/hub/src/components/__tests__/TextPostCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/hub/src/components/__tests__/TextPostCard.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TextPostCard } from '../TextPostCard';
import { submitApproval } from '../../api';
import type { HubPost, PostApproval } from '../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
}));

const mockedSubmitApproval = vi.mocked(submitApproval);

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 10,
    titulo: 'Texto motivacional segunda-feira',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo_plain: 'Segunda-feira é dia de começar com tudo! 💪\n\nNada de preguiça.',
    scheduled_at: '2026-04-28T10:00:00.000Z',
    workflow_id: 42,
    workflow_titulo: 'Editorial',
    media: [],
    cover_media: null,
    ...overrides,
  };
}

describe('TextPostCard', () => {
  beforeEach(() => {
    mockedSubmitApproval.mockReset();
  });

  it('renders collapsed by default with title, type badge, and truncated text', () => {
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByText('Texto motivacional segunda-feira')).toBeInTheDocument();
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.queryByText('Nada de preguiça.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aprovar/i })).not.toBeInTheDocument();
  });

  it('expands to show full text and approval buttons when clicked', () => {
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));

    expect(screen.getByText(/Nada de preguiça/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aprovar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Solicitar correção/i })).toBeInTheDocument();
  });

  it('collapses when clicked again', () => {
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    expect(screen.getByText(/Nada de preguiça/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    expect(screen.queryByRole('button', { name: /Aprovar/i })).not.toBeInTheDocument();
  });

  it('submits an approval and calls onApprovalSubmitted', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true } as never);
    const onApprovalSubmitted = vi.fn();

    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={onApprovalSubmitted}
      />,
    );

    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/i }));

    await waitFor(() => {
      expect(mockedSubmitApproval).toHaveBeenCalledWith('token-publico', 10, 'aprovado', undefined);
    });
    expect(onApprovalSubmitted).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npx vitest run apps/hub/src/components/__tests__/TextPostCard.test.tsx 2>&1 | tail -20`

Expected: FAIL — module `../TextPostCard` not found.

- [ ] **Step 3: Implement TextPostCard**

Create `apps/hub/src/components/TextPostCard.tsx`:

```tsx
import { useState } from 'react';
import { CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import { submitApproval } from '../api';
import { TIPO_LABEL, STATUS_LABEL, formatDate } from './PostCard';
import type { HubPost, PostApproval } from '../types';

interface TextPostCardProps {
  post: HubPost;
  token: string;
  approvals: PostApproval[];
  onApprovalSubmitted: () => void;
}

export function TextPostCard({ post, token, approvals, onApprovalSubmitted }: TextPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const isPending = post.status === 'enviado_cliente';

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      await submitApproval(token, post.id, action, comentario || undefined);
      setResult({ type: 'success', message: action === 'aprovado' ? 'Post aprovado!' : 'Correção enviada!' });
      onApprovalSubmitted();
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`bg-white rounded-[10px] border transition-all ${expanded ? 'border-stone-300 shadow-sm' : 'border-stone-200 hover:shadow-sm'}`}>
      <button
        className="w-full text-left px-5 py-4 flex items-start justify-between gap-3"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider bg-stone-900 text-white px-2 py-0.5 rounded">
              {TIPO_LABEL[post.tipo] ?? post.tipo}
            </span>
            <span className="text-[11px] font-semibold text-amber-600">
              {STATUS_LABEL[post.status] ?? post.status}
            </span>
            <span className="text-[12px] text-stone-400 ml-auto">{formatDate(post.scheduled_at)}</span>
          </div>
          <p className="font-semibold text-[14px] text-stone-900 mb-1">{post.titulo}</p>
          {!expanded && post.conteudo_plain && (
            <p className="text-[13px] text-stone-500 truncate">{post.conteudo_plain}</p>
          )}
        </div>
        <span className={`mt-2 shrink-0 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          <ChevronDown size={18} />
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 border-t border-stone-100 space-y-4">
          {post.conteudo_plain && (
            <p className="text-[13px] text-stone-600 leading-relaxed whitespace-pre-wrap">{post.conteudo_plain}</p>
          )}

          {isPending && !result && (
            <div className="space-y-3">
              <textarea
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Comentário (opcional)…"
                className="w-full rounded-lg border border-stone-200 px-4 py-3 text-[13px] resize-none min-h-[70px] bg-white text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-300 focus:ring-4 focus:ring-[#FFBF30]/15 transition-all"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction('aprovado')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-stone-900 text-white rounded-lg py-2.5 text-[13px] font-semibold hover:bg-stone-800 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle size={14} /> Aprovar
                </button>
                <button
                  onClick={() => handleAction('correcao')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 border border-stone-200 bg-white text-stone-800 rounded-lg py-2.5 text-[13px] font-semibold hover:bg-stone-50 disabled:opacity-50 transition-colors"
                >
                  <AlertCircle size={14} /> Solicitar correção
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className={`rounded-lg px-4 py-3 text-[13px] font-medium ${result.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
              {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npx vitest run apps/hub/src/components/__tests__/TextPostCard.test.tsx 2>&1 | tail -20`

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/TextPostCard.tsx apps/hub/src/components/__tests__/TextPostCard.test.tsx
git commit -m "feat(hub): add TextPostCard component for posts without media"
```

---

### Task 5: Create InstagramPostCard Component

**Files:**
- Create: `apps/hub/src/components/InstagramPostCard.tsx`
- Create: `apps/hub/src/components/__tests__/InstagramPostCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/hub/src/components/__tests__/InstagramPostCard.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstagramPostCard } from '../InstagramPostCard';
import { submitApproval } from '../../api';
import type { HubPost, HubPostMedia, InstagramProfile } from '../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
}));

vi.mock('../PostMediaLightbox', () => ({
  PostMediaLightbox: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="post-media-lightbox">
      <button type="button" onClick={onClose}>Fechar lightbox</button>
    </div>
  ),
}));

const mockedSubmitApproval = vi.mocked(submitApproval);

function makeMedia(overrides: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1, post_id: 7, kind: 'image', mime_type: 'image/jpeg',
    url: 'https://cdn.example.com/media-1.jpg', thumbnail_url: null,
    width: 1080, height: 1350, duration_seconds: null, is_cover: false, sort_order: 0,
    ...overrides,
  };
}

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 7, titulo: 'Campanha de Páscoa', tipo: 'feed', status: 'enviado_cliente',
    ordem: 1, conteudo_plain: 'Legenda principal do post.',
    scheduled_at: '2026-04-22T10:00:00.000Z', workflow_id: 42, workflow_titulo: 'Editorial',
    media: [makeMedia()], cover_media: null,
    ...overrides,
  };
}

const profile: InstagramProfile = {
  username: 'studio_marca',
  profilePictureUrl: 'https://cdn.ig/pic.jpg',
};

describe('InstagramPostCard', () => {
  beforeEach(() => {
    mockedSubmitApproval.mockReset();
  });

  it('renders the Instagram-style header with username and profile picture', () => {
    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByText('studio_marca')).toBeInTheDocument();
    expect(screen.getByAltText('studio_marca')).toHaveAttribute('src', 'https://cdn.ig/pic.jpg');
  });

  it('falls back to workspace name when instagramProfile is null', () => {
    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={null}
        workspaceName="Mesaas"
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByText('Mesaas')).toBeInTheDocument();
  });

  it('shows carousel dots when post has multiple media items', () => {
    const media = [
      makeMedia({ id: 1, sort_order: 0 }),
      makeMedia({ id: 2, sort_order: 1, url: 'https://cdn.example.com/media-2.jpg' }),
      makeMedia({ id: 3, sort_order: 2, url: 'https://cdn.example.com/media-3.jpg' }),
    ];

    const { container } = render(
      <InstagramPostCard
        post={makePost({ media })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    const dots = container.querySelectorAll('[data-carousel-dot]');
    expect(dots.length).toBe(3);
  });

  it('calls onToggleSelect when the checkbox is clicked', () => {
    const onToggleSelect = vi.fn();

    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={onToggleSelect}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledWith(7);
  });

  it('submits an approval when Aprovar is clicked', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true } as never);
    const onApprovalSubmitted = vi.fn();

    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={onApprovalSubmitted}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Aprovar/i }));

    await waitFor(() => {
      expect(mockedSubmitApproval).toHaveBeenCalledWith('token-publico', 7, 'aprovado', undefined);
    });
    expect(onApprovalSubmitted).toHaveBeenCalledTimes(1);
  });

  it('opens the lightbox when the image is clicked', () => {
    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    const img = screen.getByAltText('');
    fireEvent.click(img);
    expect(screen.getByTestId('post-media-lightbox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npx vitest run apps/hub/src/components/__tests__/InstagramPostCard.test.tsx 2>&1 | tail -20`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement InstagramPostCard**

Create `apps/hub/src/components/InstagramPostCard.tsx`:

```tsx
import { useState } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { submitApproval } from '../api';
import { formatDate } from './PostCard';
import { PostMediaLightbox } from './PostMediaLightbox';
import type { HubPost, PostApproval, InstagramProfile } from '../types';

interface InstagramPostCardProps {
  post: HubPost;
  token: string;
  approvals: PostApproval[];
  instagramProfile: InstagramProfile | null;
  workspaceName?: string;
  isSelected: boolean;
  onToggleSelect: (postId: number) => void;
  onApprovalSubmitted: () => void;
}

export function InstagramPostCard({
  post, token, approvals, instagramProfile, workspaceName,
  isSelected, onToggleSelect, onApprovalSubmitted,
}: InstagramPostCardProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const isPending = post.status === 'enviado_cliente';
  const media = post.media ?? [];
  const isCarousel = media.length > 1;
  const displayName = instagramProfile?.username ?? workspaceName ?? '';
  const profilePic = instagramProfile?.profilePictureUrl;
  const caption = post.conteudo_plain ?? '';
  const truncatedCaption = caption.length > 125 ? caption.slice(0, 125) + '...' : caption;

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      await submitApproval(token, post.id, action, comentario || undefined);
      setResult({ type: 'success', message: action === 'aprovado' ? 'Post aprovado!' : 'Correção enviada!' });
      onApprovalSubmitted();
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  function prevSlide() { setCurrentSlide(i => Math.max(0, i - 1)); }
  function nextSlide() { setCurrentSlide(i => Math.min(media.length - 1, i + 1)); }

  const currentMedia = media[currentSlide];

  return (
    <div className={`bg-white rounded-xl overflow-hidden border-[1.5px] transition-all ${isSelected ? 'border-[#0095f6] shadow-[0_0_0_2px_rgba(0,149,246,0.2)]' : 'border-[#dbdbdb]'}`}
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}
    >
      {/* Selection checkbox */}
      <div className="absolute top-3 right-3 z-10">
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(post.id); }}
          className={`w-[22px] h-[22px] rounded-full flex items-center justify-center cursor-pointer shadow-md ${isSelected ? 'bg-[#0095f6]' : 'bg-black/30 border-2 border-white'}`}
        >
          <svg width="12" height="12" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
        </button>
      </div>

      {/* Profile header */}
      <div className="flex items-center px-3.5 py-2.5 gap-2.5 relative">
        {profilePic ? (
          <img src={profilePic} alt={displayName} className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-[11px] font-bold text-stone-500">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-[13px] font-semibold text-[#262626]">{displayName}</span>
        <span className="ml-auto text-[#262626] text-base">•••</span>
      </div>

      {/* Image area */}
      <div className="relative aspect-[4/5] bg-stone-100">
        {currentMedia && (
          <button type="button" onClick={() => setLightboxIdx(currentSlide)} className="w-full h-full">
            {currentMedia.kind === 'image' ? (
              <img src={currentMedia.url} alt="" className="w-full h-full object-cover" />
            ) : (
              <img src={currentMedia.thumbnail_url ?? ''} alt="" className="w-full h-full object-cover" />
            )}
          </button>
        )}

        {isCarousel && currentSlide > 0 && (
          <button onClick={prevSlide} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 flex items-center justify-center shadow-sm text-[#262626]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        )}
        {isCarousel && currentSlide < media.length - 1 && (
          <button onClick={nextSlide} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 flex items-center justify-center shadow-sm text-[#262626]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        )}
      </div>

      {/* Carousel dots */}
      {isCarousel && (
        <div className="flex justify-center gap-1 py-2">
          {media.map((_, i) => (
            <div key={i} data-carousel-dot className={`w-1.5 h-1.5 rounded-full ${i === currentSlide ? 'bg-[#0095f6]' : 'bg-[#c7c7c7]'}`} />
          ))}
        </div>
      )}

      {/* Action icons */}
      <div className={`px-3.5 ${isCarousel ? 'pt-0' : 'pt-2.5'} pb-1`}>
        <div className="flex items-center gap-3.5">
          <svg width="24" height="24" fill="none" stroke="#262626" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <svg width="24" height="24" fill="none" stroke="#262626" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <svg width="24" height="24" fill="none" stroke="#262626" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          <svg className="ml-auto" width="24" height="24" fill="none" stroke="#262626" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </div>
      </div>

      {/* Caption */}
      <div className="px-3.5 py-1.5">
        <p className="text-[13px] text-[#262626] leading-[1.4]">
          <span className="font-semibold">{displayName}</span>{' '}
          {captionExpanded ? caption : truncatedCaption}
          {caption.length > 125 && !captionExpanded && (
            <button onClick={() => setCaptionExpanded(true)} className="text-[#737373] ml-1">mais</button>
          )}
        </p>
        <p className="text-[11px] text-[#737373] mt-1.5">Agendado: {formatDate(post.scheduled_at)}</p>
      </div>

      {/* Approval buttons */}
      {isPending && !result && (
        <div className="border-t border-[#efefef] px-3.5 py-2.5 space-y-2">
          <textarea
            value={comentario}
            onChange={e => setComentario(e.target.value)}
            placeholder="Comentário (opcional)…"
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-[12px] resize-none min-h-[60px] bg-white text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-300 transition-all"
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleAction('aprovado')}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500 text-white text-[13px] font-semibold hover:bg-emerald-600 disabled:opacity-50 transition-colors"
            >
              <CheckCircle size={14} /> Aprovar
            </button>
            <button
              onClick={() => handleAction('correcao')}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-[#dbdbdb] bg-white text-[#262626] text-[13px] font-medium hover:bg-stone-50 disabled:opacity-50 transition-colors"
            >
              <AlertCircle size={14} /> Solicitar correção
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`mx-3.5 mb-3 rounded-lg px-4 py-3 text-[13px] font-medium ${result.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {result.message}
        </div>
      )}

      {lightboxIdx !== null && media.length > 0 && (
        <PostMediaLightbox
          media={media}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onStaleUrl={onApprovalSubmitted}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npx vitest run apps/hub/src/components/__tests__/InstagramPostCard.test.tsx 2>&1 | tail -20`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/InstagramPostCard.tsx apps/hub/src/components/__tests__/InstagramPostCard.test.tsx
git commit -m "feat(hub): add InstagramPostCard component for media posts"
```

---

### Task 6: Create FeedPreviewButton Component

**Files:**
- Create: `apps/hub/src/components/FeedPreviewButton.tsx`

- [ ] **Step 1: Create FeedPreviewButton**

Create `apps/hub/src/components/FeedPreviewButton.tsx`:

```tsx
interface FeedPreviewButtonProps {
  selectedCount: number;
  onClick: () => void;
}

export function FeedPreviewButton({ selectedCount, onClick }: FeedPreviewButtonProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex justify-center py-5">
      <button
        onClick={onClick}
        className="inline-flex items-center gap-2 px-7 py-3 rounded-[10px] bg-[#0095f6] text-white text-[14px] font-semibold hover:bg-[#0081d6] transition-colors shadow-sm"
      >
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
        Visualizar no Feed ({selectedCount} selecionado{selectedCount > 1 ? 's' : ''})
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub/src/components/FeedPreviewButton.tsx
git commit -m "feat(hub): add FeedPreviewButton component"
```

---

### Task 7: Create InstagramGridPreview Component

**Files:**
- Create: `apps/hub/src/components/InstagramGridPreview.tsx`
- Create: `apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InstagramGridPreview } from '../InstagramGridPreview';
import type { HubPost, HubPostMedia, InstagramFeedProfile, InstagramFeedPost } from '../../types';

vi.mock('../../api', () => ({
  fetchInstagramFeed: vi.fn(),
}));

function makeMedia(overrides: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1, post_id: 7, kind: 'image', mime_type: 'image/jpeg',
    url: 'https://cdn.example.com/media-1.jpg', thumbnail_url: 'https://cdn.example.com/thumb-1.jpg',
    width: 1080, height: 1350, duration_seconds: null, is_cover: false, sort_order: 0,
    ...overrides,
  };
}

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 7, titulo: 'Post Teste', tipo: 'feed', status: 'enviado_cliente',
    ordem: 1, conteudo_plain: 'Legenda', scheduled_at: '2026-04-22T10:00:00.000Z',
    workflow_id: 42, workflow_titulo: 'Editorial',
    media: [makeMedia()], cover_media: null,
    ...overrides,
  };
}

const profile: InstagramFeedProfile = {
  username: 'studio_marca',
  profilePictureUrl: 'https://cdn.ig/pic.jpg',
  followerCount: 15300,
  followingCount: 892,
  mediaCount: 42,
};

const livePosts: InstagramFeedPost[] = [
  { id: 'ig-1', thumbnailUrl: 'https://cdn.ig/t1.jpg', mediaType: 'IMAGE', permalink: 'https://ig/p/1', postedAt: '2026-04-20T10:00:00Z', impressions: 5292 },
  { id: 'ig-2', thumbnailUrl: 'https://cdn.ig/t2.jpg', mediaType: 'CAROUSEL_ALBUM', permalink: 'https://ig/p/2', postedAt: '2026-04-18T10:00:00Z', impressions: 4555 },
  { id: 'ig-3', thumbnailUrl: null, mediaType: 'VIDEO', permalink: 'https://ig/p/3', postedAt: '2026-04-16T10:00:00Z', impressions: 1768 },
];

describe('InstagramGridPreview', () => {
  it('renders the profile header with username and stats', () => {
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('studio_marca')).toBeInTheDocument();
    expect(screen.getByText('15.3k')).toBeInTheDocument();
    expect(screen.getByText('892')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders pending posts with Novo badge', () => {
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Novo')).toBeInTheDocument();
  });

  it('renders live posts with view counts', () => {
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('5.292')).toBeInTheDocument();
    expect(screen.getByText('4.555')).toBeInTheDocument();
  });

  it('closes when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByLabelText('Fechar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows gray placeholder for live posts with null thumbnail', () => {
    const { container } = render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={vi.fn()}
      />,
    );

    const placeholders = container.querySelectorAll('[data-grid-placeholder]');
    expect(placeholders.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npx vitest run apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx 2>&1 | tail -20`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement InstagramGridPreview**

Create `apps/hub/src/components/InstagramGridPreview.tsx`. This is the largest component — it renders the full Instagram profile grid modal with drag-and-drop.

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { HubPost, InstagramFeedProfile, InstagramFeedPost } from '../types';

interface GridItem {
  type: 'pending' | 'live';
  id: string;
  thumbnailUrl: string | null;
  mediaType: string;
  impressions: number;
  isCarousel: boolean;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n >= 1_000) return n.toLocaleString('pt-BR');
  return String(n);
}

function formatImpressions(n: number): string {
  return n.toLocaleString('pt-BR');
}

interface InstagramGridPreviewProps {
  selectedPosts: HubPost[];
  feedProfile: InstagramFeedProfile;
  livePosts: InstagramFeedPost[];
  onClose: () => void;
}

export function InstagramGridPreview({ selectedPosts, feedProfile, livePosts, onClose }: InstagramGridPreviewProps) {
  const [gridItems, setGridItems] = useState<GridItem[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const touchRef = useRef<{ startX: number; startY: number; idx: number } | null>(null);

  useEffect(() => {
    const pending: GridItem[] = selectedPosts.map(p => ({
      type: 'pending' as const,
      id: `pending-${p.id}`,
      thumbnailUrl: p.cover_media?.url ?? p.media?.[0]?.url ?? null,
      mediaType: p.tipo === 'carrossel' || (p.media?.length ?? 0) > 1 ? 'CAROUSEL_ALBUM' : p.tipo === 'reels' ? 'VIDEO' : 'IMAGE',
      impressions: 0,
      isCarousel: (p.media?.length ?? 0) > 1,
    }));

    const live: GridItem[] = livePosts.map(p => ({
      type: 'live' as const,
      id: `live-${p.id}`,
      thumbnailUrl: p.thumbnailUrl,
      mediaType: p.mediaType,
      impressions: p.impressions,
      isCarousel: p.mediaType === 'CAROUSEL_ALBUM',
    }));

    setGridItems([...pending, ...live]);
  }, [selectedPosts, livePosts]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleDragStart = useCallback((idx: number) => {
    if (gridItems[idx].type !== 'pending') return;
    setDragIdx(idx);
  }, [gridItems]);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  }, []);

  const handleDrop = useCallback((targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    setGridItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx]);

  const handleTouchStart = useCallback((e: React.TouchEvent, idx: number) => {
    if (gridItems[idx].type !== 'pending') return;
    const touch = e.touches[0];
    touchRef.current = { startX: touch.clientX, startY: touch.clientY, idx };
  }, [gridItems]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const touch = e.changedTouches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const gridCell = el?.closest('[data-grid-idx]');
    if (gridCell) {
      const targetIdx = parseInt(gridCell.getAttribute('data-grid-idx')!, 10);
      const sourceIdx = touchRef.current.idx;
      if (sourceIdx !== targetIdx) {
        setGridItems(prev => {
          const next = [...prev];
          const [moved] = next.splice(sourceIdx, 1);
          next.splice(targetIdx, 0, moved);
          return next;
        });
      }
    }
    touchRef.current = null;
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  const displayName = feedProfile.username ?? '';

  const eyeIcon = (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" stroke="white" strokeWidth="1.8"/>
      <circle cx="12" cy="12" r="3" stroke="white" strokeWidth="1.8"/>
    </svg>
  );

  const carouselIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="4" width="14" height="14" rx="2.5" stroke="white" strokeWidth="2" fill="rgba(0,0,0,0.15)"/>
      <rect x="8" y="6" width="14" height="14" rx="2.5" stroke="white" strokeWidth="2" fill="rgba(0,0,0,0.15)"/>
    </svg>
  );

  const reelsIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="white" strokeWidth="1.8" fill="rgba(0,0,0,0.15)"/>
      <path d="M10 8.5v7l5.5-3.5L10 8.5z" fill="white"/>
    </svg>
  );

  return createPortal(
    <div className="fixed inset-0 z-[9010] bg-black/70 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[420px] max-h-[92vh] overflow-y-auto relative"
        style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-[#262626] text-base transition-colors"
        >
          ✕
        </button>

        {/* Top bar */}
        <div className="flex items-center justify-center pt-4 pb-2">
          <span className="text-[20px] font-bold text-[#262626] flex items-center gap-1">
            {displayName}
            <svg width="16" height="16" fill="#262626" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
          </span>
        </div>

        {/* Profile header */}
        <div className="flex items-start gap-5 px-5 py-3">
          <div className="shrink-0 relative">
            {feedProfile.profilePictureUrl ? (
              <img src={feedProfile.profilePictureUrl} alt={displayName} className="w-[86px] h-[86px] rounded-full object-cover" />
            ) : (
              <div className="w-[86px] h-[86px] rounded-full bg-stone-200 flex items-center justify-center text-2xl font-bold text-stone-500">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-[#0095f6] border-[2.5px] border-white flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>
            </div>
          </div>
          <div className="flex-1 pt-2">
            <div className="flex justify-between">
              <div className="text-center">
                <span className="block text-base font-bold text-[#262626]">{formatCount(feedProfile.mediaCount)}</span>
                <span className="text-[13px] text-[#262626]">posts</span>
              </div>
              <div className="text-center">
                <span className="block text-base font-bold text-[#262626]">{formatCount(feedProfile.followerCount)}</span>
                <span className="text-[13px] text-[#262626]">seguidores</span>
              </div>
              <div className="text-center">
                <span className="block text-base font-bold text-[#262626]">{formatCount(feedProfile.followingCount)}</span>
                <span className="text-[13px] text-[#262626]">seguindo</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons (decorative) */}
        <div className="flex gap-1.5 px-4 pb-3">
          <div className="flex-1 py-[7px] rounded-lg bg-[#efefef] text-center text-[13px] font-semibold text-[#262626]">Seguir</div>
          <div className="flex-1 py-[7px] rounded-lg bg-[#efefef] text-center text-[13px] font-semibold text-[#262626]">Mensagem</div>
          <div className="flex-1 py-[7px] rounded-lg bg-[#efefef] text-center text-[13px] font-semibold text-[#262626]">Contato</div>
        </div>

        {/* Tab bar */}
        <div className="flex border-t border-[#dbdbdb]">
          <div className="flex-1 py-2.5 flex justify-center border-t border-[#262626] -mt-px">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7.5" height="7.5" rx="1" fill="#262626"/>
              <rect x="13.5" y="3" width="7.5" height="7.5" rx="1" fill="#262626"/>
              <rect x="3" y="13.5" width="7.5" height="7.5" rx="1" fill="#262626"/>
              <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" fill="#262626"/>
            </svg>
          </div>
          <div className="flex-1 py-2.5 flex justify-center text-[#8e8e8e]">
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <path d="M9.5 15.5V8.5l7 3.5-7 3.5z" fill="currentColor" stroke="none"/>
            </svg>
          </div>
          <div className="flex-1 py-2.5 flex justify-center text-[#8e8e8e]">
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
          </div>
          <div className="flex-1 py-2.5 flex justify-center text-[#8e8e8e]">
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <circle cx="12" cy="10" r="3"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
            </svg>
          </div>
        </div>

        {/* Drag hint */}
        <div className="flex items-center justify-center gap-1.5 py-2 bg-[#f0f7ff] text-[#0095f6] text-[11px] font-medium">
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3"/>
          </svg>
          Arraste os posts novos para reordenar
        </div>

        {/* Grid */}
        <div className="grid grid-cols-3 gap-[1.5px]">
          {gridItems.map((item, idx) => (
            <div
              key={item.id}
              data-grid-idx={idx}
              draggable={item.type === 'pending'}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
              onTouchStart={(e) => handleTouchStart(e, idx)}
              onTouchEnd={handleTouchEnd}
              className={`aspect-[4/5] relative overflow-hidden bg-[#efefef] ${
                item.type === 'pending' ? 'cursor-grab active:cursor-grabbing shadow-[inset_0_0_0_2.5px_#0095f6]' : ''
              } ${dragIdx === idx ? 'opacity-50 scale-95' : ''} ${dragOverIdx === idx && dragIdx !== idx ? 'outline outline-2 outline-[#0095f6] -outline-offset-2' : ''}`}
            >
              {item.thumbnailUrl ? (
                <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div data-grid-placeholder className="w-full h-full bg-[#efefef]" />
              )}

              {item.type === 'pending' && (
                <span className="absolute top-1.5 left-1.5 bg-[#0095f6] text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">Novo</span>
              )}

              {item.isCarousel && (
                <span className="absolute top-1.5 right-1.5 drop-shadow-md">{carouselIcon}</span>
              )}
              {item.mediaType === 'VIDEO' && !item.isCarousel && (
                <span className="absolute top-1.5 right-1.5 drop-shadow-md">{reelsIcon}</span>
              )}

              <div className="absolute bottom-1.5 left-2 flex items-center gap-1 text-white text-[12px] font-semibold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                {eyeIcon}
                {item.type === 'pending' ? '—' : formatImpressions(item.impressions)}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-4 justify-center py-3 text-[11px] text-[#8e8e8e]">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm bg-[#0095f6]" />
            Posts para aprovar
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm bg-[#dbdbdb]" />
            Posts publicados
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npx vitest run apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx 2>&1 | tail -20`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/InstagramGridPreview.tsx apps/hub/src/components/__tests__/InstagramGridPreview.test.tsx
git commit -m "feat(hub): add InstagramGridPreview modal with drag-to-reorder"
```

---

### Task 8: Rewire AprovacoesPage

**Files:**
- Modify: `apps/hub/src/pages/AprovacoesPage.tsx`

- [ ] **Step 1: Rewrite AprovacoesPage**

Replace the entire contents of `apps/hub/src/pages/AprovacoesPage.tsx`:

```tsx
import { useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts, fetchInstagramFeed } from '../api';
import { InstagramPostCard } from '../components/InstagramPostCard';
import { TextPostCard } from '../components/TextPostCard';
import { FeedPreviewButton } from '../components/FeedPreviewButton';
import { InstagramGridPreview } from '../components/InstagramGridPreview';

export function AprovacoesPage() {
  const { token, bootstrap } = useHub();
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showGrid, setShowGrid] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const { data: feedData } = useQuery({
    queryKey: ['hub-instagram-feed', token],
    queryFn: () => fetchInstagramFeed(token),
    enabled: showGrid && data?.instagramProfile != null,
  });

  const approvals = data?.postApprovals ?? [];
  const instagramProfile = data?.instagramProfile ?? null;
  const pending = (data?.posts ?? [])
    .filter(p => p.status === 'enviado_cliente')
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));

  const withMedia = pending.filter(p => p.media.length > 0);
  const withoutMedia = pending.filter(p => p.media.length === 0);

  function handleToggleSelect(postId: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  function handleInvalidate() {
    qc.invalidateQueries({ queryKey: ['hub-posts', token] });
  }

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
    </div>
  );

  const selectedPosts = withMedia.filter(p => selectedIds.has(p.id));

  return (
    <div className="max-w-5xl mx-auto hub-fade-up">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          <span className="accent-bar" />Sua revisão
        </p>
        <h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight text-stone-900 mb-2">Aprovações</h2>
        <p className="text-[14px] text-stone-500">
          {pending.length === 0
            ? 'Tudo em dia. Nenhum post aguardando aprovação.'
            : `${pending.length} post${pending.length > 1 ? 's' : ''} aguardando sua aprovação.`}
        </p>
      </header>

      {withMedia.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {withMedia.map(post => (
              <InstagramPostCard
                key={post.id}
                post={post}
                token={token}
                approvals={approvals}
                instagramProfile={instagramProfile}
                workspaceName={bootstrap.workspace.name}
                isSelected={selectedIds.has(post.id)}
                onToggleSelect={handleToggleSelect}
                onApprovalSubmitted={handleInvalidate}
              />
            ))}
          </div>
          {instagramProfile && (
            <FeedPreviewButton
              selectedCount={selectedIds.size}
              onClick={() => setShowGrid(true)}
            />
          )}
        </>
      )}

      {withoutMedia.length > 0 && (
        <div className={withMedia.length > 0 ? 'mt-10 pt-8 border-t border-stone-200' : ''}>
          {withMedia.length > 0 && (
            <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-4">
              <span className="accent-bar" />Posts sem mídia
            </p>
          )}
          <div className="max-w-[640px] space-y-3">
            {withoutMedia.map(post => (
              <TextPostCard
                key={post.id}
                post={post}
                token={token}
                approvals={approvals}
                onApprovalSubmitted={handleInvalidate}
              />
            ))}
          </div>
        </div>
      )}

      {showGrid && feedData && (
        <InstagramGridPreview
          selectedPosts={selectedPosts}
          feedProfile={feedData.profile}
          livePosts={feedData.recentPosts}
          onClose={() => setShowGrid(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npm run build 2>&1 | tail -30`

Expected: No type errors. Build succeeds.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npm run test 2>&1 | tail -30`

Expected: All tests PASS. Note: the existing `PostCard.test.tsx` should still pass since `PostCard` component was not deleted — it's just no longer imported by `AprovacoesPage`.

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/pages/AprovacoesPage.tsx
git commit -m "feat(hub): rewire AprovacoesPage with InstagramPostCard, TextPostCard, and grid preview"
```

---

### Task 9: Visual Testing and Polish

**Files:** All new components may need small tweaks

- [ ] **Step 1: Start the Hub dev server**

Run: `cd /Users/eduardosouza/Projects/sm-crm && npm run dev:hub`

Open the Hub in a browser at `http://localhost:5175` and navigate to an active client's Aprovações page.

- [ ] **Step 2: Verify Instagram post cards render correctly**

Check:
- Posts with media render as Instagram-style cards (profile header, 4:5 image, action icons, caption)
- Carousel posts show dot indicators and navigation arrows on hover
- Caption truncation with "mais" toggle works
- Selection checkbox appears on each card and toggles blue border
- Approval buttons work (approve, request correction)

- [ ] **Step 3: Verify text post cards render correctly**

Check:
- Posts without media render as compact cards with type badge, title, truncated text
- Clicking expands to show full text + approval buttons
- Clicking again collapses
- Approval flow works

- [ ] **Step 4: Verify the grid preview**

Check:
- "Visualizar no Feed" button appears when 1+ posts selected
- Button is hidden when no Instagram account is linked
- Clicking opens the full-screen modal with profile header and grid
- Pending posts appear at top with "Novo" badge and blue border
- Live posts show real thumbnails and view counts
- Drag-and-drop reordering works (desktop)
- Escape key closes the modal
- Clicking overlay closes the modal

- [ ] **Step 5: Fix any visual issues**

Address spacing, font sizes, colors, or layout issues found during testing. The Instagram preview should closely match the reference screenshot.

- [ ] **Step 6: Run the full build and test suite**

Run:
```bash
cd /Users/eduardosouza/Projects/sm-crm && npm run build && npm run build:hub && npm run test && deno test supabase/functions/__tests__/hub-functions_test.ts
```

Expected: All builds pass, all tests pass.

- [ ] **Step 7: Fix the InstagramPostCard positioning context**

The checkbox uses `absolute` positioning but the parent card needs `relative`. Check that the outer `div` in `InstagramPostCard` has `relative` in its className. If not, add it.

- [ ] **Step 8: Commit any fixes**

```bash
git add -u
git commit -m "fix(hub): polish Instagram preview components after visual testing"
```
