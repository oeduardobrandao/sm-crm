# Hub Single-Post Deep-Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shareable, token-gated deep-link (`/{workspace}/hub/{token}/postagens/{postId}`) that opens one focused post in the client Hub with live approve/correção controls, plus copy-link affordances in the CRM and Hub.

**Architecture:** A new hub drill-in route renders a focused page that reuses the already-cached `['hub-posts', token]` query and the existing post cards — **zero new backend**. A shared `buildHubPostLink` helper produces the URL. The CRM reuses the per-card `card.hubUrl` (tightened to exclude expired tokens) threaded to the calendar/drawer post views. A client-visible-status allow-list guards what may render.

**Tech Stack:** React 19 + React Router v7 (hub uses `createBrowserRouter`), TanStack Query, Vitest + React Testing Library, Tailwind, lucide-react, sonner (CRM toasts only).

## Global Constraints

- **Typecheck** with `npm run build` (CRM) and `npm run build:hub` (Hub) — there is no standalone `tsc` script; the build runs `tsc` then `vite build`. Run **`npm run test`** (root Vitest, covers both apps) after changes.
- CI also enforces **eslint + prettier `format:check`** and a coverage ratchet — run `npm run lint` and `npm run format` (or `format:check`) before pushing. No `deno` suite needed (no edge-function changes).
- **ES modules** only. Path alias `@/` maps to `apps/crm/src` — **in Vitest the `@` alias resolves to CRM**, so **hub tests must use relative imports**, never `@/…`.
- Icons: **lucide-react** only, rendered as JSX with a `size` prop (e.g. `<Copy size={14} />`).
- Toasts: **sonner** `toast.success(...)` in the **CRM**. The **Hub has no toast system** — hub copy feedback is inline component state ("Copiado!"), do NOT add sonner to the hub.
- Route param parsing: **`parseInt(param, 10)` + `isNaN` guard**, never bare `Number()`.
- UI copy is **Portuguese**.
- Follow existing patterns; keep new files small and single-responsibility. DRY within an app; a tiny helper is intentionally duplicated across apps (no shared runtime package exists).
- Real post statuses (DB/`apps/crm/src/store/posts.ts:15`): `rascunho, revisao_interna, aprovado_interno, enviado_cliente, aprovado_cliente, correcao_cliente, agendado, postado, falha_publicacao`. Client-visible = `enviado_cliente, aprovado_cliente, correcao_cliente, agendado, postado, falha_publicacao`.

---

### Task 1: `buildHubPostLink` helper (Hub + CRM)

**Files:**
- Create: `apps/hub/src/lib/hubLinks.ts`
- Create: `apps/hub/src/lib/__tests__/hubLinks.test.ts`
- Create: `apps/crm/src/lib/hubLinks.ts`
- Create: `apps/crm/src/lib/__tests__/hubLinks.test.ts`

**Interfaces:**
- Produces: `buildHubPostLink(base: string, postId: number): string` — appends `/postagens/{postId}` to a hub base URL, trimming a single trailing slash. Identical implementation in both apps.

- [ ] **Step 1: Write the failing hub test**

`apps/hub/src/lib/__tests__/hubLinks.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildHubPostLink } from '../hubLinks';

describe('buildHubPostLink', () => {
  it('appends the postagens path to a relative base', () => {
    expect(buildHubPostLink('/mesaas/hub/tok', 42)).toBe('/mesaas/hub/tok/postagens/42');
  });
  it('works with an absolute base', () => {
    expect(buildHubPostLink('https://app.mesaas.com.br/mesaas/hub/tok', 7)).toBe(
      'https://app.mesaas.com.br/mesaas/hub/tok/postagens/7',
    );
  });
  it('trims a single trailing slash on the base', () => {
    expect(buildHubPostLink('/mesaas/hub/tok/', 9)).toBe('/mesaas/hub/tok/postagens/9');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test -- hubLinks`
Expected: FAIL — `Cannot find module '../hubLinks'`.

- [ ] **Step 3: Implement the hub helper**

`apps/hub/src/lib/hubLinks.ts`:
```ts
/** Append the focused-post path to a hub base URL (relative or absolute). */
export function buildHubPostLink(base: string, postId: number): string {
  return `${base.replace(/\/$/, '')}/postagens/${postId}`;
}
```

- [ ] **Step 4: Create the CRM copy + its test**

`apps/crm/src/lib/hubLinks.ts` — identical body:
```ts
/** Append the focused-post path to a hub base URL (relative or absolute). */
export function buildHubPostLink(base: string, postId: number): string {
  return `${base.replace(/\/$/, '')}/postagens/${postId}`;
}
```

`apps/crm/src/lib/__tests__/hubLinks.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildHubPostLink } from '@/lib/hubLinks';

describe('buildHubPostLink (crm)', () => {
  it('appends the postagens path', () => {
    expect(buildHubPostLink('https://app.mesaas.com.br/acme/hub/tok', 12)).toBe(
      'https://app.mesaas.com.br/acme/hub/tok/postagens/12',
    );
  });
  it('trims a trailing slash', () => {
    expect(buildHubPostLink('https://x/acme/hub/tok/', 3)).toBe('https://x/acme/hub/tok/postagens/3');
  });
});
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm run test -- hubLinks`
Expected: PASS (5 assertions across both files).

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/lib/hubLinks.ts apps/hub/src/lib/__tests__/hubLinks.test.ts apps/crm/src/lib/hubLinks.ts apps/crm/src/lib/__tests__/hubLinks.test.ts
git commit -m "feat(hub): add buildHubPostLink helper for post deep-links"
```

---

### Task 2: Correct the `HubPost.status` model (Hub) — review finding P2

The hub type lists a non-existent `em_producao` and omits the real `revisao_interna`/`aprovado_interno`, while `hub-posts` returns raw DB statuses. Fix the union and the 4 source + 3 test references found by grep.

**Files:**
- Modify: `apps/hub/src/types.ts:33-41` (the `HubPost.status` union)
- Modify: `apps/hub/src/components/PostCard.tsx:24` (status→label map)
- Modify: `apps/hub/src/components/PostCalendar.tsx:38` (status→label map)
- Modify: `apps/hub/src/pages/__tests__/postApprovalBrandPages.test.tsx:179,357`
- Modify: `apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx:919,933`

- [ ] **Step 1: Update the type union**

In `apps/hub/src/types.ts`, replace the `status` union in `HubPost` (currently lines 33-41) with the real model:
```ts
  status:
    | 'rascunho'
    | 'revisao_interna'
    | 'aprovado_interno'
    | 'enviado_cliente'
    | 'aprovado_cliente'
    | 'correcao_cliente'
    | 'agendado'
    | 'postado'
    | 'falha_publicacao';
```

- [ ] **Step 2: Update the two label maps**

In `apps/hub/src/components/PostCard.tsx` (line ~24) replace the `em_producao: 'Em produção',` entry with:
```tsx
  revisao_interna: 'Revisão interna',
  aprovado_interno: 'Aprovado interno',
```
Do the same in `apps/hub/src/components/PostCalendar.tsx` (line ~38). (These maps are keyed by status; internal statuses are filtered out of the client view, so these labels are defensive.)

- [ ] **Step 3: Update the 3 test references**

In `apps/hub/src/pages/__tests__/postApprovalBrandPages.test.tsx`: line ~179 change the local `| 'em_producao'` union member to `| 'revisao_interna'`; line ~357 change `status: 'em_producao'` to `status: 'revisao_interna'`.
In `apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx`: line ~919 rename the test title to `'filters out rascunho and revisao_interna statuses'`; line ~933 change `status: 'em_producao'` to `status: 'revisao_interna'`.

- [ ] **Step 4: Typecheck + test**

Run: `npm run build:hub && npm run test -- postApproval aprovacoesPostagens`
Expected: typecheck passes (no remaining `em_producao` references) and the two updated suites pass.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/components/PostCard.tsx apps/hub/src/components/PostCalendar.tsx apps/hub/src/pages/__tests__/postApprovalBrandPages.test.tsx apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx
git commit -m "fix(hub): correct HubPost.status to real DB model (drop em_producao)"
```

---

### Task 3: `postView.ts` — visible-status allow-list + card-kind picker (Hub)

Single-source the client-visible-status set (currently a local const in `PostagensPage`) and the media-first card selection, so the focused page and the guard share exactly the list's rules.

**Files:**
- Create: `apps/hub/src/lib/postView.ts`
- Create: `apps/hub/src/lib/__tests__/postView.test.ts`
- Modify: `apps/hub/src/pages/PostagensPage.tsx` (import `VISIBLE_STATUSES` instead of its local `const`)

**Interfaces:**
- Produces:
  - `VISIBLE_STATUSES: Set<HubPost['status']>` — the 6 client-visible statuses.
  - `isClientVisible(status: HubPost['status']): boolean`
  - `pickPostCardKind(post: HubPost): 'instagram' | 'story' | 'text'` — **media-first**: no media → `'text'`; else stories → `'story'`; else `'instagram'`.

- [ ] **Step 1: Write the failing test**

`apps/hub/src/lib/__tests__/postView.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isClientVisible, pickPostCardKind, VISIBLE_STATUSES } from '../postView';
import type { HubPost } from '../../types';

const base = { id: 1, titulo: 't', ordem: 0, conteudo: null, conteudo_plain: '', scheduled_at: null, ig_caption: null, instagram_permalink: null, media: [] } as unknown as HubPost;

describe('isClientVisible', () => {
  it('accepts client-visible statuses', () => {
    expect(isClientVisible('enviado_cliente')).toBe(true);
    expect(isClientVisible('postado')).toBe(true);
  });
  it('rejects internal statuses', () => {
    expect(isClientVisible('rascunho')).toBe(false);
    expect(isClientVisible('revisao_interna')).toBe(false);
    expect(isClientVisible('aprovado_interno')).toBe(false);
  });
  it('has exactly 6 members', () => {
    expect(VISIBLE_STATUSES.size).toBe(6);
  });
});

describe('pickPostCardKind (media-first)', () => {
  it('media-less stories render as text, not story', () => {
    expect(pickPostCardKind({ ...base, tipo: 'stories', media: [] })).toBe('text');
  });
  it('stories with media render as story', () => {
    expect(pickPostCardKind({ ...base, tipo: 'stories', media: [{}] } as unknown as HubPost)).toBe('story');
  });
  it('feed/carrossel with media render as instagram', () => {
    expect(pickPostCardKind({ ...base, tipo: 'feed', media: [{}] } as unknown as HubPost)).toBe('instagram');
    expect(pickPostCardKind({ ...base, tipo: 'carrossel', media: [{}] } as unknown as HubPost)).toBe('instagram');
  });
  it('media-less feed renders as text', () => {
    expect(pickPostCardKind({ ...base, tipo: 'feed', media: [] })).toBe('text');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test -- postView`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `postView.ts`**

`apps/hub/src/lib/postView.ts`:
```ts
import type { HubPost } from '../types';

/** Statuses a client is allowed to see in the Hub (mirrors PostagensPage). */
export const VISIBLE_STATUSES = new Set<HubPost['status']>([
  'enviado_cliente',
  'aprovado_cliente',
  'correcao_cliente',
  'agendado',
  'postado',
  'falha_publicacao',
]);

export function isClientVisible(status: HubPost['status']): boolean {
  return VISIBLE_STATUSES.has(status);
}

/** Media-first card selection, identical to the Postagens/Aprovações lists. */
export function pickPostCardKind(post: HubPost): 'instagram' | 'story' | 'text' {
  if ((post.media?.length ?? 0) === 0) return 'text';
  return post.tipo === 'stories' ? 'story' : 'instagram';
}
```

- [ ] **Step 4: Point `PostagensPage` at the shared const**

In `apps/hub/src/pages/PostagensPage.tsx`, delete the local `const VISIBLE_STATUSES = new Set<…>([...])` (lines ~11-18) and add to the imports:
```tsx
import { VISIBLE_STATUSES } from '../lib/postView';
```
Leave the rest of the file (which already references `VISIBLE_STATUSES`) unchanged.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- postView && npm run build:hub`
Expected: PASS + typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/lib/postView.ts apps/hub/src/lib/__tests__/postView.test.ts apps/hub/src/pages/PostagensPage.tsx
git commit -m "refactor(hub): extract VISIBLE_STATUSES + pickPostCardKind to postView"
```

---

### Task 4: `PostagemFocoPage` + route (Hub) — the focused view with 4 states

**Files:**
- Create: `apps/hub/src/pages/PostagemFocoPage.tsx`
- Modify: `apps/hub/src/router.tsx` (add child route + import)
- Create: `apps/hub/src/pages/__tests__/postagemFocoPage.test.tsx`

**Interfaces:**
- Consumes: `buildHubPostLink` (Task 1), `isClientVisible`/`pickPostCardKind` (Task 3), `fetchPosts` (`api.ts`), `useHub()` → `{ token, workspace, bootstrap }`.
- Produces: exported `PostagemFocoPage` React component; route `postagens/:postId`.

- [ ] **Step 1: Write the failing page test**

`apps/hub/src/pages/__tests__/postagemFocoPage.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';
import { PostagemFocoPage } from '../PostagemFocoPage';

vi.mock('../../api', () => ({ fetchPosts: vi.fn() }));
import { fetchPosts } from '../../api';
const mockedFetchPosts = vi.mocked(fetchPosts);

const hubValue = {
  bootstrap: {
    workspace: { name: 'Mesaas', logo_url: '', brand_color: '#0f766e' },
    cliente_nome: 'Clínica Aurora',
    is_active: true,
    cliente_id: 14,
  },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;

function makePost(over: Record<string, unknown> = {}) {
  return {
    id: 42, titulo: 'Post de teste', tipo: 'feed', status: 'enviado_cliente', ordem: 0,
    conteudo: null, conteudo_plain: 'Corpo do post', scheduled_at: null, ig_caption: null,
    instagram_permalink: null, media: [], ...over,
  };
}

function renderAt(postId: string, resp: unknown, reject = false) {
  if (reject) mockedFetchPosts.mockRejectedValue(new Error('boom'));
  else mockedFetchPosts.mockResolvedValue(resp as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter initialEntries={[`/mesaas/hub/token-publico/postagens/${postId}`]}>
          <Routes>
            <Route path="/:workspace/hub/:token/postagens/:postId" element={<PostagemFocoPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('PostagemFocoPage', () => {
  it('renders the focused post when present and client-visible', async () => {
    renderAt('42', { posts: [makePost()], postApprovals: [], propertyValues: [], workflowSelectOptions: [], instagramProfile: null });
    expect(await screen.findByText('Post de teste')).toBeInTheDocument();
  });

  it('shows not-available for an internal-status post', async () => {
    renderAt('42', { posts: [makePost({ status: 'revisao_interna' })], postApprovals: [], propertyValues: [], workflowSelectOptions: [], instagramProfile: null });
    expect(await screen.findByText(/não está disponível/i)).toBeInTheDocument();
  });

  it('shows not-available for a missing id', async () => {
    renderAt('999', { posts: [makePost()], postApprovals: [], propertyValues: [], workflowSelectOptions: [], instagramProfile: null });
    expect(await screen.findByText(/não está disponível/i)).toBeInTheDocument();
  });

  it('shows an error state with retry when the query fails', async () => {
    renderAt('42', null, true);
    expect(await screen.findByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test -- postagemFocoPage`
Expected: FAIL — `Cannot find module '../PostagemFocoPage'`.

- [ ] **Step 3: Implement `PostagemFocoPage`**

`apps/hub/src/pages/PostagemFocoPage.tsx`:
```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { isClientVisible, pickPostCardKind } from '../lib/postView';
import { InstagramPostCard } from '../components/InstagramPostCard';
import { StoryPostCard } from '../components/StoryPostCard';
import { TextPostCard } from '../components/TextPostCard';

export function PostagemFocoPage() {
  const { token, workspace, bootstrap } = useHub();
  const { postId } = useParams<{ postId: string }>();
  const base = `/${workspace}/hub/${token}`;
  const id = parseInt(postId ?? '', 10);
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const backLink = (
    <Link
      to={`${base}/postagens`}
      className="inline-flex items-center gap-1.5 text-[13px] text-stone-500 hover:text-stone-900 mb-8 group transition-colors"
    >
      <ArrowLeft size={15} className="group-hover:-translate-x-0.5 transition-transform" /> Ver todas as postagens
    </Link>
  );

  if (isLoading)
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
      </div>
    );

  if (isError)
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <p className="text-sm text-stone-500 mb-4">Não foi possível carregar esta postagem.</p>
        <button
          onClick={() => refetch()}
          className="text-[13px] font-medium text-stone-900 underline decoration-[#FFBF30] decoration-2 underline-offset-4"
        >
          Tentar novamente
        </button>
      </div>
    );

  const post = !isNaN(id) ? data?.posts.find((p) => p.id === id) : undefined;

  if (!post || !isClientVisible(post.status))
    return (
      <div className="max-w-3xl mx-auto hub-fade-up">
        {backLink}
        <div className="py-8 text-stone-500">Esta postagem não está disponível.</div>
      </div>
    );

  const approvals = data?.postApprovals ?? [];
  const onApprovalSubmitted = () => qc.invalidateQueries({ queryKey: ['hub-posts', token] });
  const kind = pickPostCardKind(post);

  return (
    <div className="max-w-3xl mx-auto hub-fade-up">
      {backLink}
      <div className="flex flex-col gap-1.5">
        {kind === 'instagram' && (
          <InstagramPostCard
            post={post}
            token={token}
            approvals={approvals}
            instagramProfile={data?.instagramProfile ?? null}
            workspaceName={bootstrap.workspace.name}
            onApprovalSubmitted={onApprovalSubmitted}
            autoPublishOnApproval={data?.autoPublishOnApproval ?? false}
          />
        )}
        {kind === 'story' && (
          <StoryPostCard
            post={post}
            token={token}
            approvals={approvals}
            instagramProfile={data?.instagramProfile ?? null}
            workspaceName={bootstrap.workspace.name}
            onApprovalSubmitted={onApprovalSubmitted}
          />
        )}
        {kind === 'text' && (
          <TextPostCard post={post} token={token} approvals={approvals} onApprovalSubmitted={onApprovalSubmitted} />
        )}
      </div>
    </div>
  );
}
```

> Note: props mirror `AprovacoesPage`'s **interactive** usage (no `readOnly`, with `onApprovalSubmitted`). If `InstagramPostCard`/`StoryPostCard` require additional props at typecheck time, copy them verbatim from `AprovacoesPage.tsx:110-121` / `:142-149`.

- [ ] **Step 4: Add the route**

In `apps/hub/src/router.tsx`, add the import after line 9:
```tsx
import { PostagemFocoPage } from './pages/PostagemFocoPage';
```
And add the child route immediately after the `postagens` route (line 21):
```tsx
      { path: 'postagens/:postId', element: <PostagemFocoPage /> },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- postagemFocoPage && npm run build:hub`
Expected: 4 tests PASS, typecheck clean. If a card requires more props, add them (Step 3 note) and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/pages/PostagemFocoPage.tsx apps/hub/src/router.tsx apps/hub/src/pages/__tests__/postagemFocoPage.test.tsx
git commit -m "feat(hub): focused single-post page + postagens/:postId route"
```

---

### Task 5: `SharePostButton` (Hub) + wire into lists and focused page

Self-contained copy button with inline "Copiado!" feedback (hub has no toast). Reads `useHub()` for the base URL, so callers pass only `postId`.

**Files:**
- Create: `apps/hub/src/components/SharePostButton.tsx`
- Create: `apps/hub/src/components/__tests__/sharePostButton.test.tsx`
- Modify: `apps/hub/src/pages/PostagensPage.tsx` (3 card wrappers)
- Modify: `apps/hub/src/pages/AprovacoesPage.tsx` (3 card wrappers)
- Modify: `apps/hub/src/pages/PostagemFocoPage.tsx` (header, next to back-link)

**Interfaces:**
- Consumes: `buildHubPostLink` (Task 1), `useHub()`.
- Produces: `SharePostButton({ postId, className? }: { postId: number; className?: string })`.

- [ ] **Step 1: Write the failing test**

`apps/hub/src/components/__tests__/sharePostButton.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubContext } from '../../HubContext';
import { SharePostButton } from '../SharePostButton';

const hubValue = { bootstrap: { workspace: { name: 'Mesaas' } }, token: 'token-publico', workspace: 'mesaas' } as never;
const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });

afterEach(() => vi.clearAllMocks());

describe('SharePostButton', () => {
  it('copies the absolute focused-post URL and shows confirmation', async () => {
    render(
      <HubContext.Provider value={hubValue}>
        <SharePostButton postId={42} />
      </HubContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /compartilhar|copiar link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('/mesaas/hub/token-publico/postagens/42');
    expect(await screen.findByText(/copiado/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test -- sharePostButton`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SharePostButton`**

`apps/hub/src/components/SharePostButton.tsx`:
```tsx
import { useState } from 'react';
import { Check, Link as LinkIcon } from 'lucide-react';
import { useHub } from '../HubContext';
import { buildHubPostLink } from '../lib/hubLinks';

export function SharePostButton({ postId, className }: { postId: number; className?: string }) {
  const { token, workspace } = useHub();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = buildHubPostLink(`${origin}/${workspace}/hub/${token}`, postId);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copiar link da postagem"
      className={`inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-900 transition-colors ${className ?? ''}`}
    >
      {copied ? <Check size={13} /> : <LinkIcon size={13} />}
      {copied ? 'Copiado!' : 'Compartilhar'}
    </button>
  );
}
```

- [ ] **Step 4: Wire into the focused page header**

In `apps/hub/src/pages/PostagemFocoPage.tsx`, import it (`import { SharePostButton } from '../components/SharePostButton';`) and place it on the successful-render header row, right after `{backLink}` inside the final return's outer `<div>`:
```tsx
      <div className="flex items-center justify-between mb-2">
        <SharePostButton postId={post.id} />
      </div>
```

- [ ] **Step 5: Wire into the two list pages**

Import `SharePostButton` in both `PostagensPage.tsx` and `AprovacoesPage.tsx`. In each of the 6 per-card wrappers (`<div key={post.id} …>`), add the button on the existing top row:
- **PostagensPage** — in each wrapper the first child is `<StatusTag …/>`. Wrap that row so the button sits opposite it:
```tsx
                        <div className="flex items-center justify-between gap-2">
                          <StatusTag status={getPostPublishState(post)} />
                          <SharePostButton postId={post.id} />
                        </div>
```
  Apply to the `withMedia` (line ~206), `stories` (line ~227), and `withoutMedia` (line ~247) wrappers.
- **AprovacoesPage** — in each wrapper the first child is the `<p>{formatDate(...)}</p>` date line. Put the button beside it:
```tsx
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-[11px] text-stone-400 pl-0.5">{formatDate(post.scheduled_at)}</p>
                  <SharePostButton postId={post.id} />
                </div>
```
  Apply to the `withMedia` (line ~106), `stories` (line ~138), and `withoutMedia` (line ~170) wrappers (replacing the standalone date `<p>`).

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run test -- sharePostButton && npm run build:hub`
Expected: PASS + typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/components/SharePostButton.tsx apps/hub/src/components/__tests__/sharePostButton.test.tsx apps/hub/src/pages/PostagensPage.tsx apps/hub/src/pages/AprovacoesPage.tsx apps/hub/src/pages/PostagemFocoPage.tsx
git commit -m "feat(hub): share-post copy button on cards and focused page"
```

---

### Task 6: Usable-token gate (CRM) — review finding P1

Tighten the Entregas batch token map so `card.hubUrl` is only built from a **usable** token (`is_active` AND `expires_at > now`). Extract the map builder to a pure, testable function.

**Files:**
- Create: `apps/crm/src/lib/hubTokenMap.ts`
- Create: `apps/crm/src/lib/__tests__/hubTokenMap.test.ts`
- Modify: `apps/crm/src/pages/entregas/hooks/useEntregasData.ts:289-303` (select `expires_at`, use the helper)

**Interfaces:**
- Produces: `buildUsableTokenMap(rows: Array<{ cliente_id: number | null; token: string | null; expires_at: string | null }>, nowIso: string): Map<number, string>` — includes a client only when `token` is set and `expires_at > nowIso`.

- [ ] **Step 1: Write the failing test**

`apps/crm/src/lib/__tests__/hubTokenMap.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildUsableTokenMap } from '@/lib/hubTokenMap';

const now = '2026-07-01T00:00:00.000Z';

describe('buildUsableTokenMap', () => {
  it('includes unexpired tokens', () => {
    const m = buildUsableTokenMap([{ cliente_id: 1, token: 'a', expires_at: '2026-08-01T00:00:00Z' }], now);
    expect(m.get(1)).toBe('a');
  });
  it('excludes expired tokens', () => {
    const m = buildUsableTokenMap([{ cliente_id: 2, token: 'b', expires_at: '2026-06-01T00:00:00Z' }], now);
    expect(m.has(2)).toBe(false);
  });
  it('excludes rows with missing token or client id', () => {
    const m = buildUsableTokenMap(
      [{ cliente_id: null, token: 'c', expires_at: '2026-08-01T00:00:00Z' }, { cliente_id: 3, token: null, expires_at: '2026-08-01T00:00:00Z' }],
      now,
    );
    expect(m.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test -- hubTokenMap`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`apps/crm/src/lib/hubTokenMap.ts`:
```ts
export function buildUsableTokenMap(
  rows: Array<{ cliente_id: number | null; token: string | null; expires_at: string | null }>,
  nowIso: string,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of rows) {
    if (row.cliente_id && row.token && row.expires_at && row.expires_at > nowIso) {
      map.set(row.cliente_id, row.token);
    }
  }
  return map;
}
```

- [ ] **Step 4: Use it in the batch query**

In `apps/crm/src/pages/entregas/hooks/useEntregasData.ts`, add the import near the top:
```ts
import { buildUsableTokenMap } from '@/lib/hubTokenMap';
```
Replace the `hub-tokens-batch` `queryFn` body (lines ~292-300) so it selects `expires_at` and delegates to the helper:
```ts
    queryFn: async () => {
      const { data } = await supabase
        .from('client_hub_tokens')
        .select('cliente_id, token, expires_at, is_active')
        .in('cliente_id', clienteIds)
        .eq('is_active', true);
      return buildUsableTokenMap(data ?? [], new Date().toISOString());
    },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- hubTokenMap && npm run build`
Expected: PASS + typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/lib/hubTokenMap.ts apps/crm/src/lib/__tests__/hubTokenMap.test.ts apps/crm/src/pages/entregas/hooks/useEntregasData.ts
git commit -m "fix(crm): only build card.hubUrl from usable (unexpired) hub tokens"
```

---

### Task 7: `CopyPostLinkButton` (CRM)

Reusable CRM copy button (sonner toast) that renders only when a usable base `hubUrl` is present.

**Files:**
- Create: `apps/crm/src/components/CopyPostLinkButton.tsx`
- Create: `apps/crm/src/components/__tests__/copyPostLinkButton.test.tsx`

**Interfaces:**
- Consumes: `buildHubPostLink` (Task 1), `toast` from `sonner`.
- Produces: `CopyPostLinkButton({ hubUrl, postId }: { hubUrl?: string; postId: number })` — renders `null` when `hubUrl` is falsy.

- [ ] **Step 1: Write the failing test**

`apps/crm/src/components/__tests__/copyPostLinkButton.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyPostLinkButton } from '../CopyPostLinkButton';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';

const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });
afterEach(() => vi.clearAllMocks());

describe('CopyPostLinkButton', () => {
  it('renders nothing without a hubUrl', () => {
    const { container } = render(<CopyPostLinkButton postId={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('copies the per-post link and toasts on success', async () => {
    render(<CopyPostLinkButton hubUrl="https://app.mesaas.com.br/acme/hub/tok" postId={5} />);
    fireEvent.click(screen.getByRole('button', { name: /copiar link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.mesaas.com.br/acme/hub/tok/postagens/5'));
    expect(toast.success).toHaveBeenCalledWith('Link copiado!');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test -- copyPostLinkButton`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CopyPostLinkButton`**

`apps/crm/src/components/CopyPostLinkButton.tsx`:
```tsx
import { Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { buildHubPostLink } from '@/lib/hubLinks';

export function CopyPostLinkButton({ hubUrl, postId }: { hubUrl?: string; postId: number }) {
  if (!hubUrl) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(buildHubPostLink(hubUrl!, postId));
      toast.success('Link copiado!');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copiar link da postagem"
      aria-label="Copiar link da postagem"
      className="drawer-delete-btn"
    >
      <LinkIcon className="h-3.5 w-3.5" />
    </button>
  );
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test -- copyPostLinkButton && npm run build`
Expected: PASS + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/CopyPostLinkButton.tsx apps/crm/src/components/__tests__/copyPostLinkButton.test.tsx
git commit -m "feat(crm): CopyPostLinkButton for sharing a specific hub post"
```

---

### Task 8: Wire `CopyPostLinkButton` into the CRM post views

Thread `card.hubUrl` (now usable-only) into the calendar detail panel and the drawer's per-post row. No new tests needed — the copy logic is covered by Task 7; this is wiring verified by typecheck + the existing Entregas suites.

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx` (add `hubUrl?` prop + render button)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx` (add `hubUrl?` prop + forward to panel)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (pass `card.hubUrl` to the calendar view; thread to `SortablePostItem` + render button in `drawer-post-trigger-right`)

- [ ] **Step 1: Panel — accept and render**

In `CalendarPostDetailPanel.tsx`: add `hubUrl?: string;` to `CalendarPostDetailPanelProps` (after `post`), destructure `hubUrl`, import `CopyPostLinkButton` (`import { CopyPostLinkButton } from '@/components/CopyPostLinkButton';`), and render it in the panel's action area:
```tsx
        <CopyPostLinkButton hubUrl={hubUrl} postId={post.id} />
```

- [ ] **Step 2: Calendar view — forward**

In `WorkflowCalendarView.tsx`: add `hubUrl?: string;` to `WorkflowCalendarViewProps`, destructure it, and pass `hubUrl={hubUrl}` where `<CalendarPostDetailPanel … />` is rendered (line ~234-247).

- [ ] **Step 3: Drawer — supply the base URL**

In `WorkflowDrawer.tsx`:
- Where `<WorkflowCalendarView … />` is rendered (line ~608), add `hubUrl={card.hubUrl}`.
- Add `hubUrl?: string;` to `SortablePostItemProps` (line ~801-836); pass `hubUrl={card.hubUrl}` where `SortablePostItem` is rendered (line ~653-696).
- Import `CopyPostLinkButton`, and in `SortablePostItem`'s `drawer-post-trigger-right` block (line ~1022-1046), add the button next to the delete button:
```tsx
          <CopyPostLinkButton hubUrl={hubUrl} postId={post.id} />
```

- [ ] **Step 4: Typecheck + full Entregas suite**

Run: `npm run build && npm run test -- entregas Entregas WorkflowDrawer`
Expected: typecheck clean; existing Entregas tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat(crm): copy per-post hub link from calendar panel and drawer rows"
```

---

### Task 9: Full verification + manual smoke

- [ ] **Step 1: Typecheck both apps**

Run: `npm run build && npm run build:hub`
Expected: both succeed (tsc + vite build), no type errors.

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: all suites green, including the new hubLinks / postView / postagemFocoPage / sharePostButton / hubTokenMap / copyPostLinkButton tests.

- [ ] **Step 3: Lint + format (CI gates)**

Run: `npm run lint && npm run format`
Expected: no eslint errors; prettier writes/【confirms】formatting. Re-run `npm run test` if format changed files.

- [ ] **Step 4: Manual smoke (staging)**

Run the hub against staging (`npm run dev:hub:staging`) and the CRM (`npm run dev:staging`), then verify:
1. In the Hub Postagens/Aprovações, each card shows a "Compartilhar" button; clicking copies a URL ending `/postagens/{id}` and flips to "Copiado!".
2. Opening that URL fresh (new tab) lands on the focused single-post page — only that post, with a "Ver todas as postagens" back-link, and (for a pending post) working approve/correção controls.
3. Editing the id to a non-owned or internal-status post shows "Esta postagem não está disponível." — never another client's post.
4. In the CRM Entregas → open a workflow → calendar post detail and drawer post rows show a copy-link icon; it is **absent** when the client's hub token is inactive/expired; when present it copies the same `/postagens/{id}` URL and toasts "Link copiado!".

- [ ] **Step 5: Finalize**

Confirm all boxes checked, then hand off (PR) per the finishing-a-development-branch skill.

---

## Self-Review

**Spec coverage:**
- Route `postagens/:postId` → Task 4. ✓
- Focused page reusing `['hub-posts', token]`, media-first card, interactive approval, back-link, 4 states (loading/error/not-available/loaded) → Task 4. ✓
- Visible-status allow-list guard → Task 3 (`isClientVisible`) used in Task 4. ✓
- Corrected internal statuses + `HubPost.status` type fix → Task 2. ✓
- CRM copy affordance + usable-token rule (P1) → Tasks 6, 7, 8. ✓
- Hub share icon on cards (P-share) → Task 5. ✓
- `buildHubPostLink` shared shape → Task 1. ✓
- Calendar client-scoping caveat → **resolved** (single-client, confirmed) → reuse `card.hubUrl`, Task 8. ✓
- No backend changes → confirmed (no edge-function tasks). ✓
- Tests: helper units, focused-page RTL (incl. media-less-stories via `pickPostCardKind` unit + error state), CRM component RTL, usable-token unit → Tasks 1-7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Line numbers are marked "~" where they may drift; exact anchors (function names, prop names, class names) are given.

**Type consistency:** `buildHubPostLink(base, postId)`, `buildUsableTokenMap(rows, nowIso)`, `pickPostCardKind(post)`, `isClientVisible(status)`, `SharePostButton({postId, className})`, `CopyPostLinkButton({hubUrl, postId})` — names/signatures are used consistently across the tasks that produce and consume them.
