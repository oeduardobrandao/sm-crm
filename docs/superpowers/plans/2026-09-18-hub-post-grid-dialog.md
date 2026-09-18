# Hub Post Grid + Detail Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three inline Hub post cards on Aprovações and Postagens with a media-first 4:5 tile grid and one detail dialog (split pane, prev/next, thumbnail strip, staged-edit + correction panel, auto-advance), keeping `postagens/:postId` deep links working.

**Architecture:** New components under `apps/hub/src/components/posts/`: `PostTile`, `StoriesRail`, `PostGrid`, `PostMediaPane`, `CorrectionPanel`, `PostDetailDialog`, plus `HubDialog` (Radix wrapper) and the pure `usePostNavigation` hook. The staged-edit/correction flow is extracted once from the three cards into `CorrectionPanel`; media viewing is extracted into `PostMediaPane`. Both list pages render `PostGrid` + `PostDetailDialog` and sync the dialog with a `:postId` route param. `InstagramPostCard`, `StoryPostCard`, `TextPostCard`, `PostagemFocoPage` and their tests are deleted at the end.

**Tech Stack:** React 19, React Router v7 (`useParams`/`useNavigate`), TanStack Query, `@radix-ui/react-dialog` (root dependency already installed), Tailwind + `hub-*` classes, `react-i18next` (`hubPosts` and `hubPostCard` namespaces), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-18-hub-post-grid-dialog-design.md`

## Global Constraints

- **Step 0 (before Task 1):** the correction-flow rework on `claude/post-approval-history-5938fa` is still **uncommitted** (15 modified files: `CorrectionReasonChips.tsx`, the three cards and their tests, `useEditSuggestion.ts`, `hubPostsLocale.test.ts`, both `hubPosts.json`, spec 2026-09-17, `hub-functions_test.ts`, `hub-approve/handler.ts`). Commit them on that branch first (`git add -A && git commit`), then create the stacked branch for this plan from it. This plan depends on `useEditSuggestion.dirty`, the optional-motivo `CorrectionReasonChips` and the `shared.salvarEdicao` / `shared.enviarCorrecao` / `shared.fechar` / `shared.discardCorrectionConfirm` / `shared.saveFailedRetry` i18n keys that exist there.
- Successful Aprovar / Enviar correção shows a flash banner (`shared.postApproved`, `instagramCard.postApprovedAndScheduled` when `res.scheduled`, `shared.correctionSent`: the existing keys the cards use today) at the top of the next post's panel for 3 s; the Hub has no toast library, so the outer `PostDetailDialog` owns this state (it survives the `key` change). Those three keys stay in the JSON (Task 11 must not delete them).
- `PostMediaLightbox` opens on top of a **modal** Radix dialog: Radix sets `body { pointer-events: none }` and would close the dialog on Esc / outside pointerdown. So: the lightbox root gets `pointer-events-auto`, and the dialog's `close()` returns early while `lightboxIdx !== null` (both Esc paths and the scrim then only close the lightbox).
- `Dialog.Content` is `fixed inset-0`, so the scrim is Content, not Overlay: overlay-click-to-close is a `onClick={(e) => e.target === e.currentTarget && close()}` on the wrapper inside Content, not `onPointerDownOutside`.
- Prev/next arrows render **once** (one pair; CSS repositions them on `md:`), the header X is labelled `posts.closeDialog` ("Fechar postagem"), and `StatusTag` is rendered once in the dialog (header only): jsdom ignores responsive classes, so duplicated controls make `getByRole` throw.
- Closing the dialog navigates with `{ replace: true }` (both open and close replace), so browser Back from the list leaves the page instead of reopening the post.
- No em-dashes in any user-facing string (i18n JSON, fallbacks, aria labels). Use a period, colon or "·".
- `←`/`→` inside the dialog always mean previous/next **post**, never slides.
- Aprovar gate: `submitting || approvalBlocked || dirty || panelDirty` (where `panelDirty` = staged content differs, or comentário typed, or motivo chosen). Fechar/Esc/prev/next/strip: disabled while `dirty` (save in flight or failed); otherwise ask `shared.discardCorrectionConfirm` when `panelDirty`.
- Auto-advance target is computed from the `posts` array **before** `onApprovalSubmitted()` invalidates the query.
- `HubDialog` portals into `.hub-root` (never `document.body`): `index.html` scopes every `.hub-*` rule as `.hub-root .hub-*` and `hooks/useTheme.ts` sets `data-theme="dark"` on `.hub-root`, so a body portal loses all Hub styling and dark mode. `z-[9000]`; `PostMediaLightbox` stays at `z-[9005]`.
- Routes are one `RouteObject` per page with an optional segment (`postagens/:postId?`, `aprovacoes/:postId?`) so opening/closing the dialog never remounts the page.
- The dialog's `←`/`→` handler ignores events targeting `input`/`textarea`/`contenteditable` and is inactive while the lightbox is open.
- Tile image source: `post.cover_media ?? post.media[0]`; videos use `thumbnail_url`; `object-fit: cover`.
- Selectable for feed preview: `media.length > 0 && tipo !== 'stories'` (unchanged).
- `postagens/:postId` stays the deep-link shape emitted by `buildHubPostLink` (`apps/hub/src/lib/hubLinks.ts`), rendered by `PostagensPage` with the dialog open. New `aprovacoes/:postId` renders `AprovacoesPage` the same way.
- `PostagensPage` keeps polling `['hub-posts', token]` every 15 s while any post is `publicando`.
- Deno runs pollute `node_modules` (project gotcha): if `tsc` reports duplicate `@tiptap/core` versions, run `npm ci` and retry. Revert any stray `deno.lock` diff with `git checkout -- deno.lock`.
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`.
- Commit after every task; commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `packages/i18n/locales/{pt,en}/hubPosts.json` | new `posts.*` and `postagens.filter.fluxo*` keys; removed dead card keys (Task 11) |
| `apps/hub/src/lib/postView.ts` | adds `STATUS_COLORS`, `getPostPublishState`, `getPostCover`, `deriveCaption`, `sortPostsChronologically` |
| `apps/hub/src/hooks/usePostNavigation.ts` | pure prev/next/nextPending over a post array |
| `apps/hub/src/components/ui/HubDialog.tsx` | Radix Dialog wrapper: portal into `.hub-root`, overlay, guarded close |
| `apps/hub/src/components/PostMediaLightbox.tsx` | gains `pointer-events-auto` on its root so it works above the modal dialog (Task 8) |
| `apps/hub/src/components/posts/StatusTag.tsx` | status pill moved out of `PostagensPage` |
| `apps/hub/src/components/posts/PostTile.tsx` | one 4:5 tile (media / text / autocleaned / lost) |
| `apps/hub/src/components/posts/StoriesRail.tsx` | ring avatars for stories |
| `apps/hub/src/components/posts/PostGrid.tsx` | rail + tile grid, browse/select modes |
| `apps/hub/src/components/posts/PostMediaPane.tsx` | carousel + story viewer extracted from the cards |
| `apps/hub/src/components/posts/CorrectionPanel.tsx` | staged edit + correction request, extracted once |
| `apps/hub/src/components/posts/PostDetailDialog.tsx` | the dialog: header, tabs, body, strip, footer, keys, auto-advance |
| `apps/hub/src/components/FluxoFilterChips.tsx` | fluxo chips for Postagens |
| `apps/hub/src/pages/PostagensPage.tsx` | flattened grid + dialog + `:postId` sync |
| `apps/hub/src/pages/AprovacoesPage.tsx` | pending grid + dialog + `:postId` sync |
| `apps/hub/src/router.tsx` | `aprovacoes/:postId?`, `postagens/:postId?` (optional segment, one route object each) |
| Deleted (Task 11) | `InstagramPostCard.tsx`, `StoryPostCard.tsx`, `TextPostCard.tsx`, `PostagemFocoPage.tsx`, `OpenPostLink.tsx`, their tests, `aprovacoesPostagensFeatures.test.tsx`, `postagemFocoPage.test.tsx` |

---

### Task 1: i18n keys and `postView` helpers

**Files:**
- Modify: `packages/i18n/locales/pt/hubPosts.json`
- Modify: `packages/i18n/locales/en/hubPosts.json`
- Modify: `apps/hub/src/lib/postView.ts`
- Modify: `apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`
- Test: `apps/hub/src/lib/__tests__/postView.test.ts` (create)

**Interfaces:**
- Produces: `STATUS_COLORS: Record<string,string>`, `getPostPublishState(p): string`, `getPostCover(post): HubPostMedia | null`, `deriveCaption(post, igCaption: string | null): string`, `sortPostsChronologically(posts): HubPost[]`, i18n keys listed below.

- [ ] **Step 1: Add the pt keys**

In `packages/i18n/locales/pt/hubPosts.json`, add a top-level `"posts"` object after `"textCard"` and two keys under `postagens.filter`:

```json
  "posts": {
    "select": "Selecionar",
    "done": "Concluir",
    "previous": "Post anterior",
    "next": "Próximo post",
    "counter": "{{current}} de {{total}}",
    "closeDialog": "Fechar postagem",
    "openTile": "Abrir {{title}}",
    "openStory": "Ver story {{title}}",
    "tabCaption": "Legenda",
    "tabText": "Texto",
    "tabHistory": "Histórico e comentários",
    "editCaption": "Editar legenda",
    "editText": "Editar texto",
    "requestCorrection": "Solicitar correção",
    "mediaRemoved": "Mídia removida",
    "noMedia": "Sem mídia",
    "slides": "{{count}} slides",
    "storyFrames": "Story · {{count}}",
    "storiesRailLabel": "Stories",
    "stripLabel": "Outros posts",
    "goToPost": "Ir para {{title}}",
    "notAvailable": "Esta postagem não está disponível.",
    "submitError": "Não foi possível enviar. Tente novamente."
  },
```

```json
    "filter": {
      "label": "Filtrar por status",
      "all": "Todos",
      "fluxoLabel": "Filtrar por fluxo",
      "avulsas": "Avulsas"
    },
```

- [ ] **Step 2: Add the en keys**

Same shape in `packages/i18n/locales/en/hubPosts.json`:

```json
  "posts": {
    "select": "Select",
    "done": "Done",
    "previous": "Previous post",
    "next": "Next post",
    "counter": "{{current}} of {{total}}",
    "closeDialog": "Close post",
    "openTile": "Open {{title}}",
    "openStory": "View story {{title}}",
    "tabCaption": "Caption",
    "tabText": "Text",
    "tabHistory": "History and comments",
    "editCaption": "Edit caption",
    "editText": "Edit text",
    "requestCorrection": "Request a correction",
    "mediaRemoved": "Media removed",
    "noMedia": "No media",
    "slides": "{{count}} slides",
    "storyFrames": "Story · {{count}}",
    "storiesRailLabel": "Stories",
    "stripLabel": "Other posts",
    "goToPost": "Go to {{title}}",
    "notAvailable": "This post is not available.",
    "submitError": "Could not send. Try again."
  },
```

```json
    "filter": {
      "label": "Filter by status",
      "all": "All",
      "fluxoLabel": "Filter by workflow",
      "avulsas": "Standalone"
    },
```

- [ ] **Step 3: Extend the locale test**

In `apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`, add to the key list inside the `for (const key of [...])`:

```ts
      'posts.select',
      'posts.done',
      'posts.previous',
      'posts.next',
      'posts.counter',
      'posts.closeDialog',
      'posts.tabCaption',
      'posts.tabText',
      'posts.tabHistory',
      'posts.editCaption',
      'posts.editText',
      'posts.requestCorrection',
      'posts.mediaRemoved',
      'posts.notAvailable',
      'postagens.filter.fluxoLabel',
      'postagens.filter.avulsas',
```

and change the em-dash test to cover the new block:

```ts
  it('has no em-dash in any user-facing string', () => {
    expect(
      JSON.stringify(pt.history) + JSON.stringify(pt.correctionReason) + JSON.stringify(pt.posts),
    ).not.toMatch(/—/);
  });
```

- [ ] **Step 4: Write the failing postView tests**

Create `apps/hub/src/lib/__tests__/postView.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  deriveCaption,
  getPostCover,
  getPostPublishState,
  sortPostsChronologically,
} from '../postView';
import type { HubPost, HubPostMedia } from '../../types';

function media(over: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 1,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn/a.jpg',
    thumbnail_url: null,
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    ...over,
  };
}

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'P',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

describe('getPostCover', () => {
  it('prefers cover_media, then media[0], then null', () => {
    const cover = media({ id: 9 });
    expect(getPostCover(post({ cover_media: cover, media: [media({ id: 2 })] }))?.id).toBe(9);
    expect(getPostCover(post({ media: [media({ id: 2 })] }))?.id).toBe(2);
    expect(getPostCover(post())).toBeNull();
  });
});

describe('deriveCaption', () => {
  it('returns the explicit caption when present', () => {
    expect(deriveCaption(post({ conteudo_plain: 'x' }), 'Legenda explícita')).toBe(
      'Legenda explícita',
    );
  });
  it('extracts the text after LEGENDA from conteudo_plain', () => {
    expect(deriveCaption(post({ conteudo_plain: 'Roteiro\nLEGENDA: bora!' }), null)).toBe('bora!');
  });
  it('falls back to the whole conteudo_plain', () => {
    expect(deriveCaption(post({ conteudo_plain: 'só texto' }), '')).toBe('só texto');
  });
});

describe('getPostPublishState', () => {
  it('reports publicando for an agendado post whose time passed', () => {
    expect(
      getPostPublishState({ status: 'agendado', scheduled_at: '2000-01-01T00:00:00.000Z' }),
    ).toBe('publicando');
    expect(
      getPostPublishState({ status: 'agendado', scheduled_at: '2999-01-01T00:00:00.000Z' }),
    ).toBe('agendado');
  });
});

describe('sortPostsChronologically', () => {
  it('sorts by scheduled_at asc, nulls last, ordem as tiebreaker, without mutating', () => {
    const input = [
      post({ id: 1, scheduled_at: null, ordem: 2 }),
      post({ id: 2, scheduled_at: '2026-04-02T00:00:00.000Z', ordem: 1 }),
      post({ id: 3, scheduled_at: '2026-04-01T00:00:00.000Z', ordem: 5 }),
      post({ id: 4, scheduled_at: '2026-04-01T00:00:00.000Z', ordem: 1 }),
      post({ id: 5, scheduled_at: null, ordem: 1 }),
    ];
    const out = sortPostsChronologically(input);
    expect(out.map((p) => p.id)).toEqual([4, 3, 2, 5, 1]);
    expect(input[0].id).toBe(1);
  });
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `npx vitest run apps/hub/src/lib/__tests__/postView.test.ts`
Expected: FAIL, `deriveCaption`/`getPostCover`/... are not exported.

- [ ] **Step 6: Implement the helpers**

Append to `apps/hub/src/lib/postView.ts`:

```ts
import type { HubPostMedia } from '../types';

/** Status colours shared by the tile pill and the dialog header (moved from PostagensPage). */
export const STATUS_COLORS: Record<string, string> = {
  enviado_cliente: '#f5a342',
  aprovado_cliente: '#3ecf8e',
  correcao_cliente: '#f55a42',
  agendado: '#42c8f5',
  publicando: '#E1306C',
  postado: '#525252',
  falha_publicacao: '#f55a42',
};

/**
 * Presentational-only state (not a DB status): an `agendado` post whose scheduled
 * time already passed is being published right now.
 */
export function getPostPublishState(p: {
  status: HubPost['status'];
  scheduled_at: string | null;
}): string {
  return p.status === 'agendado' && !!p.scheduled_at && new Date(p.scheduled_at) <= new Date()
    ? 'publicando'
    : p.status;
}

/** Tile/strip image: the flagged cover, else the first media item. */
export function getPostCover(post: HubPost): HubPostMedia | null {
  return post.cover_media ?? post.media?.[0] ?? null;
}

/**
 * The caption the client actually sees: the explicit caption when non-empty,
 * otherwise the text after "LEGENDA" in `conteudo_plain`, otherwise the whole
 * `conteudo_plain`. Same rule the old cards used, kept in one place.
 */
export function deriveCaption(post: HubPost, igCaption: string | null): string {
  if (igCaption) return igCaption;
  const rawText = post.conteudo_plain ?? '';
  const legendaIdx = rawText.toUpperCase().indexOf('LEGENDA');
  return legendaIdx !== -1
    ? rawText
        .slice(legendaIdx + 'LEGENDA'.length)
        .replace(/^[:\s\n]+/, '')
        .trim()
    : rawText;
}

/** scheduled_at ascending, unscheduled last, `ordem` as the tiebreaker. Returns a copy. */
export function sortPostsChronologically(posts: HubPost[]): HubPost[] {
  return [...posts].sort((a, b) => {
    if (!a.scheduled_at && !b.scheduled_at) return a.ordem - b.ordem;
    if (!a.scheduled_at) return 1;
    if (!b.scheduled_at) return -1;
    const diff = a.scheduled_at.localeCompare(b.scheduled_at);
    return diff !== 0 ? diff : a.ordem - b.ordem;
  });
}
```

Move the `import type { HubPostMedia }` line up next to the existing `import type { HubPost }` (one import: `import type { HubPost, HubPostMedia } from '../types';`).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run apps/hub/src/lib/__tests__/`
Expected: PASS (postView + hubPostsLocale).

- [ ] **Step 8: Commit**

```bash
git add packages/i18n/locales/pt/hubPosts.json packages/i18n/locales/en/hubPosts.json apps/hub/src/lib/postView.ts apps/hub/src/lib/__tests__/postView.test.ts apps/hub/src/lib/__tests__/hubPostsLocale.test.ts
git commit -m "feat(hub): i18n keys and postView helpers for the post grid + dialog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `usePostNavigation`

**Files:**
- Create: `apps/hub/src/hooks/usePostNavigation.ts`
- Test: `apps/hub/src/hooks/__tests__/usePostNavigation.test.ts`

**Interfaces:**
- Produces: `usePostNavigation(posts: HubPost[], currentId: number | null) => { index: number; current: HubPost | null; prev: HubPost | null; next: HubPost | null; nextPending: HubPost | null }` and the pure `computePostNavigation` with the same signature (the hook only wraps it in `useMemo`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { computePostNavigation } from '../usePostNavigation';
import type { HubPost } from '../../types';

function p(id: number, status: HubPost['status'] = 'enviado_cliente'): HubPost {
  return {
    id,
    titulo: `P${id}`,
    tipo: 'feed',
    status,
    ordem: id,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
  };
}

describe('computePostNavigation', () => {
  const posts = [p(1), p(2, 'aprovado_cliente'), p(3), p(4, 'postado')];

  it('finds prev/next by array order, null at the ends', () => {
    expect(computePostNavigation(posts, 1)).toMatchObject({ index: 0, prev: null, next: posts[1] });
    expect(computePostNavigation(posts, 4)).toMatchObject({ index: 3, prev: posts[2], next: null });
  });

  it('nextPending skips non-pending posts and wraps around', () => {
    expect(computePostNavigation(posts, 1).nextPending?.id).toBe(3);
    expect(computePostNavigation(posts, 3).nextPending?.id).toBe(1);
  });

  it('nextPending is null when the current post is the only pending one', () => {
    expect(computePostNavigation([p(1), p(2, 'postado')], 1).nextPending).toBeNull();
  });

  it('returns index -1 and nulls for an unknown id', () => {
    expect(computePostNavigation(posts, 99)).toEqual({
      index: -1,
      current: null,
      prev: null,
      next: null,
      nextPending: null,
    });
    expect(computePostNavigation(posts, null).index).toBe(-1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/hub/src/hooks/__tests__/usePostNavigation.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/hub/src/hooks/usePostNavigation.ts`:

```ts
import { useMemo } from 'react';
import type { HubPost } from '../types';

export interface PostNavigation {
  index: number;
  current: HubPost | null;
  prev: HubPost | null;
  next: HubPost | null;
  /** First post after the current one (wrapping) still awaiting approval; null if none. */
  nextPending: HubPost | null;
}

const EMPTY: PostNavigation = { index: -1, current: null, prev: null, next: null, nextPending: null };

export function computePostNavigation(posts: HubPost[], currentId: number | null): PostNavigation {
  if (currentId === null) return EMPTY;
  const index = posts.findIndex((p) => p.id === currentId);
  if (index === -1) return EMPTY;
  let nextPending: HubPost | null = null;
  for (let step = 1; step < posts.length; step++) {
    const candidate = posts[(index + step) % posts.length];
    if (candidate.status === 'enviado_cliente') {
      nextPending = candidate;
      break;
    }
  }
  return {
    index,
    current: posts[index],
    prev: index > 0 ? posts[index - 1] : null,
    next: index < posts.length - 1 ? posts[index + 1] : null,
    nextPending,
  };
}

export function usePostNavigation(posts: HubPost[], currentId: number | null): PostNavigation {
  return useMemo(() => computePostNavigation(posts, currentId), [posts, currentId]);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run apps/hub/src/hooks/__tests__/usePostNavigation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/hooks/usePostNavigation.ts apps/hub/src/hooks/__tests__/usePostNavigation.test.ts
git commit -m "feat(hub): usePostNavigation for prev/next/nextPending over the visible posts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `HubDialog` primitive

**Files:**
- Create: `apps/hub/src/components/ui/HubDialog.tsx`
- Test: `apps/hub/src/components/__tests__/HubDialog.test.tsx`

**Interfaces:**
- Produces: `HubDialog({ open, onRequestClose, title, children, className?, overlayClassName? })`. `onRequestClose(reason: 'escape' | 'outside' | 'button')` is called for Esc, overlay click and the close button; the caller decides whether to actually close (it controls `open`). Focus trap, scroll lock and focus restore come from Radix. Portals into `.hub-root` (fallback `document.body` when absent, e.g. in a bare test).

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubDialog } from '../ui/HubDialog';

afterEach(() => {
  document.querySelector('.hub-root')?.remove();
});

describe('HubDialog', () => {
  it('portals into .hub-root when it exists, with an sr-only title', () => {
    const root = document.createElement('div');
    root.className = 'hub-root';
    document.body.appendChild(root);
    render(
      <HubDialog open onRequestClose={vi.fn()} title="Título do post">
        <p>Conteúdo</p>
      </HubDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Título do post' });
    expect(root.contains(dialog)).toBe(true);
    expect(screen.getByText('Conteúdo')).toBeInTheDocument();
  });

  it('falls back to document.body without a .hub-root', () => {
    render(
      <HubDialog open onRequestClose={vi.fn()} title="T">
        <p>x</p>
      </HubDialog>,
    );
    expect(document.body.contains(screen.getByRole('dialog'))).toBe(true);
  });

  it('reports escape and does not close by itself', () => {
    const onRequestClose = vi.fn();
    render(
      <HubDialog open onRequestClose={onRequestClose} title="T">
        <p>x</p>
      </HubDialog>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onRequestClose).toHaveBeenCalledWith('escape');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('reports outside for a click on the scrim but not on content', () => {
    const onRequestClose = vi.fn();
    render(
      <HubDialog open onRequestClose={onRequestClose} title="T">
        <p>x</p>
      </HubDialog>,
    );
    fireEvent.click(screen.getByText('x'));
    expect(onRequestClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-dialog-scrim'));
    expect(onRequestClose).toHaveBeenCalledWith('outside');
  });

  it('renders nothing when closed', () => {
    render(
      <HubDialog open={false} onRequestClose={vi.fn()} title="T">
        <p>x</p>
      </HubDialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/hub/src/components/__tests__/HubDialog.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/hub/src/components/ui/HubDialog.tsx`:

```tsx
import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

export type HubDialogCloseReason = 'escape' | 'outside' | 'button';

interface HubDialogProps {
  open: boolean;
  /** The caller owns `open`; this only reports intent so it can guard with a confirm. */
  onRequestClose: (reason: HubDialogCloseReason) => void;
  /** Accessible name (rendered sr-only). */
  title: string;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
}

/**
 * The Hub's one modal primitive: Radix Dialog with focus trap, scroll lock and
 * focus restore. It portals INTO `.hub-root`, not document.body: index.html scopes
 * every hub-* rule as `.hub-root .hub-*` and useTheme sets data-theme="dark" on
 * `.hub-root`, so a body portal would render unstyled and always light (same
 * reason IdeiasPage's modal portals there). `.hub-root` has no transform, so
 * position:fixed inside it is viewport-relative. `z-[9000]` keeps it under
 * PostMediaLightbox (`z-[9005]`) so the lightbox can open on top of it.
 */
export function HubDialog({
  open,
  onRequestClose,
  title,
  children,
  className = '',
  overlayClassName = '',
}: HubDialogProps) {
  const container =
    typeof document !== 'undefined'
      ? (document.querySelector<HTMLElement>('.hub-root') ?? document.body)
      : undefined;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onRequestClose('button')}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay
          className={`fixed inset-0 z-[9000] bg-black/70 backdrop-blur-sm ${overlayClassName}`}
        />
        <Dialog.Content
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onRequestClose('escape');
          }}
          // Content is fixed inset-0, so it IS the scrim: Radix's "outside" events
          // never fire. Swallow them and detect scrim clicks on the wrapper below.
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className={`fixed inset-0 z-[9000] focus:outline-none ${className}`}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <div
            data-testid="hub-dialog-scrim"
            className="w-full h-full flex items-center justify-center p-0 md:p-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) onRequestClose('outside');
            }}
          >
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run apps/hub/src/components/__tests__/HubDialog.test.tsx`
Expected: PASS. If Radix logs a "Missing `Description`" warning, the `Dialog.Description` above silences it.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/ui/HubDialog.tsx apps/hub/src/components/__tests__/HubDialog.test.tsx
git commit -m "feat(hub): HubDialog primitive on Radix Dialog with guarded close

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `StatusTag` and `PostTile`

**Files:**
- Create: `apps/hub/src/components/posts/StatusTag.tsx`
- Create: `apps/hub/src/components/posts/PostTile.tsx`
- Test: `apps/hub/src/components/posts/__tests__/PostTile.test.tsx`

**Interfaces:**
- Produces: `StatusTag({ status: string; size?: 'sm' | 'md' })`; `PostTile({ post, mode, selected, onOpen, onToggle, priority? })` where `mode: 'browse' | 'select'`.
- Consumes: `getPostCover`, `getPostPublishState`, `STATUS_COLORS` (Task 1); `formatDate` from `../PostCard`; `MediaUnavailable`; `OptimizedImage`.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostTile } from '../PostTile';
import type { HubPost, HubPostMedia } from '../../../types';

function media(over: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 1,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn/a.jpg',
    thumbnail_url: null,
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    ...over,
  };
}

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Coleção de inverno',
    tipo: 'carrossel',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Segunda-feira é dia de começar com tudo!',
    scheduled_at: '2026-04-28T10:00:00.000Z',
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [media({ id: 1 }), media({ id: 2 })],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

const noop = vi.fn();

describe('PostTile', () => {
  it('uses cover_media over media[0] and opens on click', () => {
    const onOpen = vi.fn();
    render(
      <PostTile
        post={post({ cover_media: media({ id: 9, url: 'https://cdn/cover.jpg' }) })}
        mode="browse"
        selected={false}
        onOpen={onOpen}
        onToggle={noop}
      />,
    );
    const img = screen.getByRole('img', { hidden: true });
    expect(img).toHaveAttribute('src', 'https://cdn/cover.jpg');
    fireEvent.click(screen.getByRole('button', { name: /Abrir Coleção de inverno/ }));
    expect(onOpen).toHaveBeenCalledWith(7);
    expect(screen.getByText('Aguardando aprovação')).toBeInTheDocument();
  });

  it('uses thumbnail_url for a video cover', () => {
    render(
      <PostTile
        post={post({
          tipo: 'reels',
          media: [media({ kind: 'video', url: 'https://cdn/v.mp4', thumbnail_url: 'https://cdn/t.jpg' })],
        })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(screen.getByRole('img', { hidden: true })).toHaveAttribute('src', 'https://cdn/t.jpg');
  });

  it('renders a text tile with title and excerpt when there is no media', () => {
    render(
      <PostTile post={post({ media: [] })} mode="browse" selected={false} onOpen={noop} onToggle={noop} />,
    );
    expect(screen.getByText('Coleção de inverno')).toBeInTheDocument();
    expect(screen.getByText(/Segunda-feira é dia/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { hidden: true })).not.toBeInTheDocument();
  });

  it('renders the "Mídia removida" tile for an autocleaned post', () => {
    render(
      <PostTile
        post={post({ media: [], status: 'postado', media_autocleaned_at: '2026-08-05T05:30:00Z' })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(screen.getByText('Mídia removida')).toBeInTheDocument();
  });

  it('renders MediaUnavailable when the cover was lost', () => {
    render(
      <PostTile
        post={post({ media: [media({ media_lost_at: '2026-08-01T00:00:00Z' })] })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });

  it('in select mode a media tile is a checkbox that toggles', () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      <PostTile post={post()} mode="select" selected={false} onOpen={onOpen} onToggle={onToggle} />,
    );
    const cb = screen.getByRole('checkbox');
    expect(cb).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(cb);
    expect(onToggle).toHaveBeenCalledWith(7);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('in select mode a text tile is inert', () => {
    const onToggle = vi.fn();
    render(
      <PostTile post={post({ media: [] })} mode="select" selected={false} onOpen={noop} onToggle={onToggle} />,
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Abrir/ });
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostTile.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `StatusTag`**

`apps/hub/src/components/posts/StatusTag.tsx` (the pill formerly inline in `PostagensPage`):

```tsx
import { useTranslation } from 'react-i18next';
import { STATUS_COLORS, getClientStatusLabel } from '../../lib/postView';

export function StatusTag({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('hubPosts');
  const color = STATUS_COLORS[status] ?? '#94a3b8';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md font-semibold tracking-[0.02em] whitespace-nowrap"
      style={{
        fontSize: size === 'md' ? '0.72rem' : '0.65rem',
        color,
        background: `${color}1f`,
        border: `1px solid ${color}40`,
        padding: size === 'md' ? '0.25rem 0.6rem' : '0.2rem 0.5rem',
        backdropFilter: 'blur(6px)',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {getClientStatusLabel(t, status)}
    </span>
  );
}
```

- [ ] **Step 4: Implement `PostTile`**

`apps/hub/src/components/posts/PostTile.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Images, Play, Circle, ImageOff, ExternalLink } from 'lucide-react';
import type { HubPost } from '../../types';
import { getPostCover, getPostPublishState, getTipoLabel } from '../../lib/postView';
import { formatDate } from '../PostCard';
import { OptimizedImage } from '../OptimizedImage';
import { MediaUnavailable } from '../MediaUnavailable';
import { sanitizeExternalUrl } from '../../lib/security';
import { StatusTag } from './StatusTag';

export type TileMode = 'browse' | 'select';

interface PostTileProps {
  post: HubPost;
  mode: TileMode;
  selected: boolean;
  onOpen: (postId: number) => void;
  onToggle: (postId: number) => void;
  /** Eager-load the image (first row). */
  priority?: boolean;
}

export function isFeedSelectable(post: HubPost): boolean {
  return (post.media?.length ?? 0) > 0 && post.tipo !== 'stories';
}

function TypeGlyph({ post }: { post: HubPost }) {
  if (post.tipo === 'carrossel' || (post.media?.length ?? 0) > 1)
    return <Images size={13} aria-hidden="true" />;
  if (post.tipo === 'reels' || post.media?.[0]?.kind === 'video')
    return <Play size={13} aria-hidden="true" />;
  if (post.tipo === 'stories') return <Circle size={13} aria-hidden="true" />;
  return null;
}

export function PostTile({ post, mode, selected, onOpen, onToggle, priority }: PostTileProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const dateLang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const cover = getPostCover(post);
  const selectable = isFeedSelectable(post);
  const selecting = mode === 'select';
  const inert = selecting && !selectable;
  const status = getPostPublishState(post);
  const openLabel = t('posts.openTile', 'Abrir {{title}}', { title: post.titulo });

  const autocleanedLink = post.media_autocleaned_at
    ? post.instagram_permalink
      ? { href: post.instagram_permalink, label: t('shared.viewOnInstagram', 'Ver no Instagram') }
      : post.tiktok_post_url
        ? { href: post.tiktok_post_url, label: t('shared.viewOnTikTok', 'Ver no TikTok') }
        : null
    : null;

  const glyph = <TypeGlyph post={post} />;

  const overlays = (
    <>
      <span className="absolute top-2 left-2 z-10">
        <StatusTag status={status} />
      </span>
      {glyph && (
        <span className="absolute top-2 right-2 z-10 w-6 h-6 rounded-md bg-black/45 text-white flex items-center justify-center">
          {glyph}
        </span>
      )}
    </>
  );

  let body: React.ReactNode;
  if (cover) {
    body = (
      <>
        {cover.media_lost_at ? (
          <MediaUnavailable size="full" />
        ) : cover.kind === 'image' ? (
          <OptimizedImage
            src={cover.url ?? ''}
            alt=""
            width={cover.width ?? undefined}
            height={cover.height ?? undefined}
            blurDataURL={cover.blur_data_url ?? undefined}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            priority={priority}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <img
            src={cover.thumbnail_url ?? ''}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {overlays}
        <span className="absolute inset-x-0 bottom-0 z-10 px-2.5 pt-8 pb-2 bg-gradient-to-t from-black/65 to-transparent text-white text-[12px] font-medium truncate">
          {post.titulo}
        </span>
      </>
    );
  } else if (post.media_autocleaned_at) {
    body = (
      <div className="absolute inset-0 hub-bg-soft flex flex-col items-center justify-center gap-2 px-3 text-center">
        {overlays}
        <ImageOff size={22} className="hub-tx3 opacity-60" aria-hidden="true" />
        <span className="text-[12px] font-medium hub-tx2">
          {t('posts.mediaRemoved', 'Mídia removida')}
        </span>
        <span className="text-[12px] hub-txt font-display line-clamp-2">{post.titulo}</span>
        {autocleanedLink && (
          <a
            href={sanitizeExternalUrl(autocleanedLink.href)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[11px] font-semibold"
            style={{ color: 'var(--hub-acc)' }}
          >
            {autocleanedLink.label}
            <ExternalLink size={10} aria-hidden="true" />
          </a>
        )}
      </div>
    );
  } else {
    body = (
      <div className="absolute inset-0 hub-card flex flex-col gap-1.5 p-3 text-left">
        <span className="self-start">
          <StatusTag status={status} />
        </span>
        <span className="font-display text-[15px] leading-[1.2] hub-txt line-clamp-2 mt-1">
          {post.titulo}
        </span>
        <span className="text-[12px] leading-[1.4] hub-tx2 line-clamp-4">
          {post.ig_caption || post.conteudo_plain}
        </span>
        <span className="mt-auto text-[11px] hub-tx3">
          {getTipoLabel(t, post.tipo)} · {formatDate(post.scheduled_at, dateLang)}
        </span>
      </div>
    );
  }

  const base =
    'relative block w-full aspect-[4/5] rounded-xl overflow-hidden text-left transition-[transform,box-shadow,opacity] hub-focus-accent focus:outline-none';

  if (selecting && selectable) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={t('instagramCard.selectAriaLabel', 'Selecionar publicação')}
        onClick={() => onToggle(post.id)}
        className={`${base} ${selected ? 'ring-[3px] ring-[#0095f6]' : 'ring-1 ring-black/5'}`}
      >
        {body}
        <span
          className={`absolute bottom-2 right-2 z-20 w-7 h-7 rounded-full flex items-center justify-center shadow-md ${selected ? 'bg-[#0095f6]' : 'bg-black/35 border-2 border-white'}`}
        >
          <svg width="14" height="14" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={openLabel}
      disabled={inert}
      onClick={() => onOpen(post.id)}
      className={`${base} ${inert ? 'opacity-50 cursor-default' : 'hover:-translate-y-0.5 hover:shadow-lg'} ring-1 ring-black/5`}
    >
      {body}
    </button>
  );
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostTile.test.tsx`
Expected: PASS. If `getByRole('img', { hidden: true })` finds two images (OptimizedImage may render a blur placeholder `<img>`), change the assertions to `screen.getAllByRole('img', { hidden: true }).at(-1)`.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/components/posts/StatusTag.tsx apps/hub/src/components/posts/PostTile.tsx apps/hub/src/components/posts/__tests__/PostTile.test.tsx
git commit -m "feat(hub): PostTile with media, text, autocleaned and lost variants

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `StoriesRail` and `PostGrid`

**Files:**
- Create: `apps/hub/src/components/posts/StoriesRail.tsx`
- Create: `apps/hub/src/components/posts/PostGrid.tsx`
- Test: `apps/hub/src/components/posts/__tests__/PostGrid.test.tsx`

**Interfaces:**
- Produces: `StoriesRail({ posts, onOpen, dimmed })`, `PostGrid({ posts, mode, selectedIds, onOpen, onToggle })`.
- Consumes: `PostTile`, `pickPostCardKind`, `getPostCover`.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostGrid } from '../PostGrid';
import type { HubPost, HubPostMedia } from '../../../types';

const MEDIA: HubPostMedia = {
  id: 1,
  post_id: 1,
  kind: 'image',
  mime_type: 'image/jpeg',
  url: 'https://cdn/a.jpg',
  thumbnail_url: null,
  width: 1080,
  height: 1350,
  duration_seconds: null,
  is_cover: false,
  sort_order: 0,
};

function post(over: Partial<HubPost>): HubPost {
  return {
    id: 1,
    titulo: 'Post',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'texto',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [MEDIA],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

describe('PostGrid', () => {
  const posts = [
    post({ id: 1, titulo: 'Feed A' }),
    post({ id: 2, titulo: 'Story B', tipo: 'stories' }),
    post({ id: 3, titulo: 'Texto C', media: [] }),
  ];

  it('puts stories in the rail and everything else in the grid, in order', () => {
    render(
      <PostGrid posts={posts} mode="browse" selectedIds={new Set()} onOpen={vi.fn()} onToggle={vi.fn()} />,
    );
    const rail = screen.getByRole('list', { name: 'Stories' });
    expect(rail).toHaveTextContent('Story B');
    const tiles = screen.getAllByRole('button', { name: /^Abrir / });
    expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual(['Abrir Feed A', 'Abrir Texto C']);
  });

  it('omits the rail when there are no stories', () => {
    render(
      <PostGrid posts={[posts[0]]} mode="browse" selectedIds={new Set()} onOpen={vi.fn()} onToggle={vi.fn()} />,
    );
    expect(screen.queryByRole('list', { name: 'Stories' })).not.toBeInTheDocument();
  });

  it('opens a story from the rail', () => {
    const onOpen = vi.fn();
    render(
      <PostGrid posts={posts} mode="browse" selectedIds={new Set()} onOpen={onOpen} onToggle={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver story Story B' }));
    expect(onOpen).toHaveBeenCalledWith(2);
  });

  it('in select mode only the media tile is a checkbox and the rail is inert', () => {
    render(
      <PostGrid posts={posts} mode="select" selectedIds={new Set([1])} onOpen={vi.fn()} onToggle={vi.fn()} />,
    );
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Ver story Story B' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostGrid.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `StoriesRail`**

`apps/hub/src/components/posts/StoriesRail.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { HubPost } from '../../types';
import { getPostCover, getPostPublishState, STATUS_COLORS } from '../../lib/postView';
import { MediaUnavailable } from '../MediaUnavailable';

interface StoriesRailProps {
  posts: HubPost[];
  onOpen: (postId: number) => void;
  /** Select mode: dim and disable (stories are not feed-selectable). */
  dimmed?: boolean;
}

export function StoriesRail({ posts, onOpen, dimmed }: StoriesRailProps) {
  const { t } = useTranslation('hubPosts');
  if (posts.length === 0) return null;
  return (
    <ul
      aria-label={t('posts.storiesRailLabel', 'Stories')}
      className={`flex gap-4 overflow-x-auto pb-2 mb-4 -mx-1 px-1 ${dimmed ? 'opacity-50' : ''}`}
    >
      {posts.map((post) => {
        const cover = getPostCover(post);
        const color = STATUS_COLORS[getPostPublishState(post)] ?? '#94a3b8';
        const src = cover?.kind === 'video' ? cover.thumbnail_url : cover?.url;
        return (
          <li key={post.id} className="shrink-0 w-[72px] flex flex-col items-center gap-1.5">
            <button
              type="button"
              disabled={dimmed}
              aria-label={t('posts.openStory', 'Ver story {{title}}', { title: post.titulo })}
              onClick={() => onOpen(post.id)}
              className="relative w-16 h-16 rounded-full p-[3px] bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] hub-focus-accent focus:outline-none disabled:cursor-default"
            >
              <span className="block w-full h-full rounded-full overflow-hidden ring-2 ring-[var(--hub-card)] bg-[#111]">
                {cover?.media_lost_at || !src ? (
                  <MediaUnavailable size="compact" />
                ) : (
                  <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                )}
              </span>
              <span
                className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full ring-2 ring-[var(--hub-card)]"
                style={{ background: color }}
                aria-hidden="true"
              />
            </button>
            <span className="text-[11px] hub-tx2 truncate w-full text-center">{post.titulo}</span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Implement `PostGrid`**

`apps/hub/src/components/posts/PostGrid.tsx`:

```tsx
import type { HubPost } from '../../types';
import { pickPostCardKind } from '../../lib/postView';
import { PostTile, type TileMode } from './PostTile';
import { StoriesRail } from './StoriesRail';

interface PostGridProps {
  posts: HubPost[];
  mode: TileMode;
  selectedIds: Set<number>;
  onOpen: (postId: number) => void;
  onToggle: (postId: number) => void;
}

/** Stories rail on top, then one chronological 4:5 grid of media and text tiles. */
export function PostGrid({ posts, mode, selectedIds, onOpen, onToggle }: PostGridProps) {
  const stories = posts.filter((p) => pickPostCardKind(p) === 'story');
  const tiles = posts.filter((p) => pickPostCardKind(p) !== 'story');
  return (
    <div>
      <StoriesRail posts={stories} onOpen={onOpen} dimmed={mode === 'select'} />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map((post, i) => (
          <PostTile
            key={post.id}
            post={post}
            mode={mode}
            selected={selectedIds.has(post.id)}
            onOpen={onOpen}
            onToggle={onToggle}
            priority={i < 4}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostGrid.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/components/posts/StoriesRail.tsx apps/hub/src/components/posts/PostGrid.tsx apps/hub/src/components/posts/__tests__/PostGrid.test.tsx
git commit -m "feat(hub): PostGrid with stories rail and browse/select modes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `CorrectionPanel` (extracted from the cards)

**Files:**
- Create: `apps/hub/src/components/posts/CorrectionPanel.tsx`
- Test: `apps/hub/src/components/posts/__tests__/CorrectionPanel.test.tsx`

**Interfaces:**
- Consumes: `useEditSuggestion` return value passed in as `edit` (the dialog owns the hook so the footer can read `approvalBlocked`/`dirty`); `deriveCaption` (Task 1); `RichTextContent`; `CorrectionReasonChips`.
- Produces:

```ts
type EditSuggestion = ReturnType<typeof useEditSuggestion>;
interface CorrectionPanelProps {
  post: HubPost;
  edit: EditSuggestion;
  submitting: boolean;
  onSubmitCorrection: (comentario: string, motivo: CorrectionReason | null) => void;
  /** true whenever anything unsent exists: staged content differs, comentário typed or motivo chosen. */
  onDirtyChange: (dirty: boolean) => void;
}
```

The panel resets to a clean state when the parent remounts it (the dialog gives it `key={post.id}` and unmounts it on Fechar), so there is no in-component post-id reset.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionPanel } from '../CorrectionPanel';
import type { HubPost } from '../../../types';
import type { useEditSuggestion } from '../../../hooks/useEditSuggestion';

type Edit = ReturnType<typeof useEditSuggestion>;

function makeEdit(over: Partial<Edit> = {}): Edit {
  return {
    isEditable: true,
    hasPendingSuggestion: false,
    wasRejected: false,
    saveSuggestion: vi.fn(),
    saveState: 'idle',
    approvalBlocked: false,
    dirty: false,
    draftConteudo: null,
    draftConteudoPlain: 'Corpo do post',
    draftIgCaption: 'Legenda original',
    ...over,
  };
}

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 10,
    titulo: 'Post',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Corpo do post',
    scheduled_at: null,
    ig_caption: 'Legenda original',
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [
      {
        id: 1, post_id: 10, kind: 'image', mime_type: 'image/jpeg', url: 'https://cdn/a.jpg',
        thumbnail_url: null, width: 1, height: 1, duration_seconds: null, is_cover: false, sort_order: 0,
      },
    ],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

describe('CorrectionPanel', () => {
  const onDirtyChange = vi.fn();
  const onSubmitCorrection = vi.fn();
  beforeEach(() => {
    onDirtyChange.mockReset();
    onSubmitCorrection.mockReset();
  });

  it('sends a correction with no motivo and no comentário', () => {
    render(
      <CorrectionPanel post={post()} edit={makeEdit()} submitting={false} onSubmitCorrection={onSubmitCorrection} onDirtyChange={onDirtyChange} />,
    );
    const btn = screen.getByRole('button', { name: /Enviar correção/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onSubmitCorrection).toHaveBeenCalledWith('', null);
  });

  it('sends comentário and motivo when given', () => {
    render(
      <CorrectionPanel post={post()} edit={makeEdit()} submitting={false} onSubmitCorrection={onSubmitCorrection} onDirtyChange={onDirtyChange} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), { target: { value: ' Trocar a data ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Texto' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    expect(onSubmitCorrection).toHaveBeenCalledWith('Trocar a data', 'texto');
  });

  it('hides the Mídia chip on a post without media', () => {
    render(
      <CorrectionPanel post={post({ media: [] })} edit={makeEdit()} submitting={false} onSubmitCorrection={onSubmitCorrection} onDirtyChange={onDirtyChange} />,
    );
    expect(screen.queryByRole('button', { name: 'Mídia' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Texto' })).toBeInTheDocument();
  });

  it('stages a caption edit, reports dirty, and saves through edit.saveSuggestion', () => {
    const edit = makeEdit();
    render(
      <CorrectionPanel post={post()} edit={edit} submitting={false} onSubmitCorrection={onSubmitCorrection} onDirtyChange={onDirtyChange} />,
    );
    const save = screen.getByRole('button', { name: /Salvar edição/ });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByDisplayValue('Legenda original'), { target: { value: 'Legenda editada' } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(save).toBeEnabled();
    expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeDisabled();
    fireEvent.click(save);
    expect(edit.saveSuggestion).toHaveBeenCalledWith(null, 'Corpo do post', 'Legenda editada');
  });

  it('seeds the caption from conteudo_plain LEGENDA when there is no ig_caption', () => {
    render(
      <CorrectionPanel
        post={post({ ig_caption: null, conteudo_plain: 'Roteiro\nLEGENDA: texto da legenda' })}
        edit={makeEdit({ draftIgCaption: null, draftConteudoPlain: 'Roteiro\nLEGENDA: texto da legenda' })}
        submitting={false}
        onSubmitCorrection={onSubmitCorrection}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByDisplayValue('texto da legenda')).toBeInTheDocument();
  });

  it('shows the retry message after a failed save', () => {
    render(
      <CorrectionPanel post={post()} edit={makeEdit({ dirty: true, saveState: 'idle' })} submitting={false} onSubmitCorrection={onSubmitCorrection} onDirtyChange={onDirtyChange} />,
    );
    expect(screen.getByText('Não foi possível salvar. Tente novamente.')).toBeInTheDocument();
  });

  it('collapses to the pending message when a suggestion is pending', () => {
    render(
      <CorrectionPanel post={post()} edit={makeEdit({ hasPendingSuggestion: true, approvalBlocked: true })} submitting={false} onSubmitCorrection={onSubmitCorrection} onDirtyChange={onDirtyChange} />,
    );
    expect(screen.getByText('Sugestão enviada para revisão da equipe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar correção/ })).not.toBeInTheDocument();
  });

  it('shows the rejected warning when the previous suggestion was rejected', () => {
    render(
      <CorrectionPanel post={post({ suggestion_rejected_at: '2026-01-01T00:00:00Z' })} edit={makeEdit({ wasRejected: true })} submitting={false} onSubmitCorrection={onSubmitCorrection} onDirtyChange={onDirtyChange} />,
    );
    expect(screen.getByText(/rejeitada pela equipe/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/CorrectionPanel.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/hub/src/components/posts/CorrectionPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import type { CorrectionReason, HubPost } from '../../types';
import type { useEditSuggestion } from '../../hooks/useEditSuggestion';
import { deriveCaption, pickPostCardKind } from '../../lib/postView';
import { RichTextContent } from '../RichTextContent';
import { CorrectionReasonChips } from '../CorrectionReasonChips';

export type EditSuggestion = ReturnType<typeof useEditSuggestion>;

interface CorrectionPanelProps {
  post: HubPost;
  edit: EditSuggestion;
  submitting: boolean;
  onSubmitCorrection: (comentario: string, motivo: CorrectionReason | null) => void;
  /** True whenever something unsent exists: staged content differs, comentário typed or motivo chosen. */
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * The staged-edit + correction-request flow (spec 2026-09-17), once, for every
 * post kind. Section 1 edits the text/caption and saves it as a suggestion;
 * section 2 sends the correction request. Both are optional and independent.
 * Remounted by the dialog per post (key={post.id}), so all state starts clean.
 */
export function CorrectionPanel({
  post,
  edit,
  submitting,
  onSubmitCorrection,
  onDirtyChange,
}: CorrectionPanelProps) {
  const { t } = useTranslation('hubPosts');
  const isText = pickPostCardKind(post) === 'text';
  const {
    hasPendingSuggestion,
    wasRejected,
    saveSuggestion,
    saveState,
    approvalBlocked,
    dirty,
    draftConteudo,
    draftConteudoPlain,
    draftIgCaption,
  } = edit;

  // Baselines: the caption the client actually sees (LEGENDA fallback included).
  const captionBaseline = deriveCaption(post, draftIgCaption);
  const [stagedConteudo, setStagedConteudo] = useState(draftConteudo);
  const [stagedConteudoPlain, setStagedConteudoPlain] = useState(draftConteudoPlain);
  const [stagedCaption, setStagedCaption] = useState(captionBaseline);
  const [comentario, setComentario] = useState('');
  const [motivo, setMotivo] = useState<CorrectionReason | null>(null);

  const contentDirty =
    (isText && stagedConteudoPlain !== draftConteudoPlain) || stagedCaption !== captionBaseline;
  const panelDirty = contentDirty || comentario.trim() !== '' || motivo !== null;

  useEffect(() => {
    onDirtyChange(panelDirty);
  }, [panelDirty, onDirtyChange]);

  // A successful save makes the staged values the new baseline (draft* update via
  // pending_suggestion on refetch); until then the fields keep what was typed.
  useEffect(() => {
    if (saveState === 'saved') {
      setStagedConteudo(draftConteudo);
      setStagedConteudoPlain(draftConteudoPlain);
      setStagedCaption(captionBaseline);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState]);

  if (hasPendingSuggestion) {
    return (
      <div className="rounded-lg px-4 py-3 text-[13px] font-medium bg-amber-50 text-amber-800 ring-1 ring-amber-200/60 text-center">
        {t('shared.suggestionPendingReviewFull', 'Sugestão enviada para revisão da equipe')}
      </div>
    );
  }

  const reasons: CorrectionReason[] = isText
    ? ['texto', 'legenda', 'outro']
    : ['midia', 'texto', 'legenda', 'outro'];

  return (
    <div className="space-y-3">
      <section className="rounded-xl border hub-border hub-bg-soft p-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] hub-tx3">
          {isText ? t('posts.editText', 'Editar texto') : t('posts.editCaption', 'Editar legenda')}
        </p>
        {isText && stagedConteudo && (
          <RichTextContent
            content={stagedConteudo}
            className="text-[13px] hub-tx2 leading-relaxed rounded-lg border border-dashed hub-border-strong px-3 py-2 hub-bg-card"
            editable
            onUpdate={(json, plain) => {
              setStagedConteudo(json);
              setStagedConteudoPlain(plain);
            }}
            fallbackText={post.conteudo_plain}
          />
        )}
        {isText && !stagedConteudo && (
          <textarea
            value={stagedConteudoPlain}
            onChange={(e) => {
              setStagedConteudo(null);
              setStagedConteudoPlain(e.target.value);
            }}
            className="hub-focus-accent w-full text-[13px] hub-tx2 leading-relaxed border border-dashed hub-border-strong rounded-lg px-3 py-2 resize-none min-h-[100px] hub-bg-card focus:outline-none focus:border-solid"
          />
        )}
        {(!isText || draftIgCaption !== null || post.ig_caption) && (
          <>
            {isText && (
              <p className="text-[11px] hub-tx3 font-medium">
                {t('textCard.instagramCaptionLabel', 'Legenda do Instagram')}
              </p>
            )}
            <textarea
              aria-label={t('instagramCard.captionAriaLabel', 'Legenda do post')}
              value={stagedCaption}
              onChange={(e) => setStagedCaption(e.target.value)}
              className="hub-focus-accent w-full text-[13px] hub-tx2 leading-relaxed border border-dashed hub-border-strong rounded-lg px-3 py-2 resize-none min-h-[72px] hub-bg-card focus:outline-none focus:border-solid"
            />
          </>
        )}
        <p className={`text-[11px] ${wasRejected ? 'text-amber-800' : 'hub-tx3'}`}>
          {wasRejected
            ? t(
                'shared.rejectedSuggestionWarning',
                '⚠️ Sua sugestão anterior foi rejeitada pela equipe. Edite novamente para enviar uma nova.',
              )
            : t('shared.suggestionInfoNote', 'ℹ️ Suas edições serão enviadas como sugestão para a equipe revisar')}
        </p>
        <div className="flex items-center justify-end gap-2">
          {saveState === 'saving' && (
            <span className="text-[11px] hub-tx3">{t('shared.savingSuggestion', 'Salvando sugestão...')}</span>
          )}
          {saveState === 'saved' && (
            <span className="text-[11px] text-emerald-600 font-medium">{t('shared.suggestionSaved', 'Sugestão salva')}</span>
          )}
          {dirty && saveState === 'idle' && !contentDirty && (
            <span className="text-[11px] text-rose-600">{t('shared.saveFailedRetry', 'Não foi possível salvar. Tente novamente.')}</span>
          )}
          <button
            type="button"
            onClick={() =>
              saveSuggestion(
                isText ? stagedConteudo : draftConteudo,
                isText ? stagedConteudoPlain : (post.conteudo_plain ?? ''),
                stagedCaption,
              )
            }
            disabled={!contentDirty || saveState === 'saving'}
            className="hub-btn-primary rounded-[var(--hub-r-ctl)] py-2 px-3 text-[12px] font-semibold disabled:opacity-50 transition-colors"
          >
            {saveState === 'saving' ? t('shared.saving', 'Salvando...') : t('shared.salvarEdicao', 'Salvar edição')}
          </button>
        </div>
      </section>

      <section className="rounded-xl border hub-border hub-bg-soft p-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] hub-tx3">
          {t('posts.requestCorrection', 'Solicitar correção')}
        </p>
        <CorrectionReasonChips
          value={motivo}
          onChange={setMotivo}
          disabled={submitting || approvalBlocked}
          reasons={reasons}
        />
        <textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder={t('shared.commentPlaceholder', 'Descreva o que precisa mudar')}
          className="hub-focus-accent w-full rounded-lg border hub-border px-3 py-2.5 text-[13px] resize-none min-h-[70px] hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] focus:outline-none focus:border-[var(--hub-bd2)] transition-all"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onSubmitCorrection(comentario.trim(), motivo)}
            disabled={submitting || approvalBlocked || dirty || contentDirty}
            className="flex items-center gap-1.5 hub-btn-secondary rounded-[var(--hub-r-ctl)] py-2 px-3 text-[12px] font-semibold disabled:opacity-50 transition-colors"
          >
            <AlertCircle size={14} /> {t('shared.enviarCorrecao', 'Enviar correção')}
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add the `reasons` prop to `CorrectionReasonChips`**

In `apps/hub/src/components/CorrectionReasonChips.tsx`, extend the props and the map:

```tsx
interface CorrectionReasonChipsProps {
  value: CorrectionReason | null;
  onChange: (value: CorrectionReason | null) => void;
  disabled?: boolean;
  /** Subset to show; defaults to all four. */
  reasons?: readonly CorrectionReason[];
}

export function CorrectionReasonChips({
  value,
  onChange,
  disabled,
  reasons = CORRECTION_REASONS,
}: CorrectionReasonChipsProps) {
```

and replace `{CORRECTION_REASONS.map((reason) => {` with `{reasons.map((reason) => {`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/CorrectionPanel.test.tsx apps/hub/src/components/__tests__/CorrectionReasonChips.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/components/posts/CorrectionPanel.tsx apps/hub/src/components/posts/__tests__/CorrectionPanel.test.tsx apps/hub/src/components/CorrectionReasonChips.tsx
git commit -m "feat(hub): CorrectionPanel extracted from the post cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `PostMediaPane`

**Files:**
- Create: `apps/hub/src/components/posts/PostMediaPane.tsx`
- Test: `apps/hub/src/components/posts/__tests__/PostMediaPane.test.tsx`

**Interfaces:**
- Produces: `PostMediaPane({ post, onOpenLightbox(index), priority? })`. Carousel (swipe + dots + on-media arrows) for feed/reels/carrossel; story frames (progress segments + tap zones) for `tipo === 'stories'`. No keyboard handling.
- Consumes: `lib/carouselGesture`, `OptimizedImage`, `VideoPrewarm`, `MediaUnavailable`.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostMediaPane } from '../PostMediaPane';
import type { HubPost, HubPostMedia } from '../../../types';

function m(id: number, over: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id, post_id: 1, kind: 'image', mime_type: 'image/jpeg', url: `https://cdn/${id}.jpg`,
    thumbnail_url: null, width: 1080, height: 1350, duration_seconds: null, is_cover: false, sort_order: id, ...over,
  };
}

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1, titulo: 'P', tipo: 'carrossel', status: 'enviado_cliente', ordem: 1, conteudo: null,
    conteudo_plain: '', scheduled_at: null, ig_caption: null, instagram_permalink: null, published_at: null,
    publish_error: null, workflow_id: null, workflow_titulo: null, workflow_created_at: null,
    media: [m(1), m(2), m(3)], cover_media: null, pending_suggestion: null, suggestion_rejected_at: null, ...over,
  };
}

describe('PostMediaPane', () => {
  it('renders every slide and advances with the on-media arrow', () => {
    render(<PostMediaPane post={post()} onOpenLightbox={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /Abrir mídia/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Slide anterior' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próximo slide' }));
    expect(screen.getByRole('button', { name: 'Slide anterior' })).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('opens the lightbox at the clicked slide', () => {
    const onOpenLightbox = vi.fn();
    render(<PostMediaPane post={post()} onOpenLightbox={onOpenLightbox} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mídia 2' }));
    expect(onOpenLightbox).toHaveBeenCalledWith(1);
  });

  it('renders story frames with tap zones', () => {
    render(<PostMediaPane post={post({ tipo: 'stories', media: [m(1), m(2)] })} onOpenLightbox={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('shows MediaUnavailable for a lost file', () => {
    render(<PostMediaPane post={post({ media: [m(1, { media_lost_at: '2026-08-01T00:00:00Z' })] })} onOpenLightbox={vi.fn()} />);
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostMediaPane.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/hub/src/components/posts/PostMediaPane.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HubPost } from '../../types';
import { OptimizedImage } from '../OptimizedImage';
import { VideoPrewarm } from '../VideoPrewarm';
import { MediaUnavailable } from '../MediaUnavailable';
import { resolveTarget, applyEdgeResistance, crossedDragThreshold } from '../../lib/carouselGesture';

const SNAP_MS = 260;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

interface PostMediaPaneProps {
  post: HubPost;
  onOpenLightbox: (index: number) => void;
  priority?: boolean;
}

/**
 * The media half of the detail dialog: a finger-following carousel for
 * feed/reels/carrossel, story frames with tap zones for stories. Keyboard
 * arrows are deliberately NOT bound here: in the dialog they move between posts.
 */
export function PostMediaPane({ post, onOpenLightbox, priority }: PostMediaPaneProps) {
  const { t } = useTranslation('hubPosts');
  const media = post.media ?? [];
  const isStory = post.tipo === 'stories';
  const [current, setCurrent] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    pointerId: -1, startX: 0, startY: 0, lastX: 0, lastT: 0, width: 0, velocity: 0, active: false, decided: false,
  });
  const suppressClickRef = useRef(false);
  const prewarmVideoUrl = media.find((m) => m.kind === 'video')?.url ?? null;
  const reduceMotion = prefersReducedMotion();

  function goTo(target: number) {
    setCurrent(Math.max(0, Math.min(media.length - 1, target)));
    setDragOffset(0);
    setIsDragging(false);
  }

  function onPointerDown(e: React.PointerEvent) {
    suppressClickRef.current = false;
    if (media.length <= 1) return;
    dragRef.current = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastT: e.timeStamp,
      width: viewportRef.current?.clientWidth ?? 0, velocity: 0, active: true, decided: false,
    };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.decided) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        d.active = false;
        return;
      }
      if (!crossedDragThreshold(dx, dy)) return;
      d.decided = true;
      setIsDragging(true);
      viewportRef.current?.setPointerCapture?.(e.pointerId);
    }
    d.velocity = (e.clientX - d.lastX) / Math.max(1, e.timeStamp - d.lastT);
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    setDragOffset(applyEdgeResistance(dx, current, media.length));
  }
  function endPointer(e: React.PointerEvent, cancelled: boolean) {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    d.active = false;
    if (!d.decided) {
      setDragOffset(0);
      setIsDragging(false);
      return;
    }
    suppressClickRef.current = true;
    if (cancelled) return goTo(current);
    goTo(resolveTarget({ currentIndex: current, count: media.length, deltaX: e.clientX - d.startX, width: d.width, velocity: d.velocity }));
  }
  function openAt(index: number) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpenLightbox(index);
  }

  const counter = media.length > 1 && (
    <span className="absolute top-3 right-3 z-20 rounded-full bg-black/45 text-white text-[11px] px-2 py-0.5 tabular-nums">
      {current + 1} / {media.length}
    </span>
  );

  const renderItem = (m: HubPost['media'][number], i: number, sizes: string) =>
    m.media_lost_at ? (
      <MediaUnavailable size="full" />
    ) : m.kind === 'image' ? (
      <OptimizedImage
        src={m.url ?? ''}
        alt=""
        width={m.width ?? undefined}
        height={m.height ?? undefined}
        blurDataURL={m.blur_data_url ?? undefined}
        sizes={sizes}
        priority={priority && i === 0}
        className="w-full h-full object-contain pointer-events-none"
      />
    ) : (
      <>
        <img src={m.thumbnail_url ?? ''} alt="" loading="lazy" decoding="async" draggable={false} className="w-full h-full object-contain pointer-events-none" />
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-14 h-14 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </span>
      </>
    );

  if (isStory) {
    const m = media[current];
    return (
      <div className="relative w-full h-full bg-[#111] flex items-center justify-center">
        <VideoPrewarm src={prewarmVideoUrl} />
        <div className="relative h-full max-h-full aspect-[9/16] overflow-hidden">
          {m && (
            <button type="button" onClick={() => openAt(current)} aria-label={t('instagramCard.openMediaAriaLabel', 'Abrir mídia {{index}}', { index: current + 1 })} className="absolute inset-0 w-full h-full">
              {renderItem(m, current, '(min-width: 768px) 40vw, 100vw')}
            </button>
          )}
          <div className="absolute top-2 left-2 right-2 z-20 flex gap-[3px]">
            {media.map((_, i) => (
              <div key={i} className="flex-1 h-[2px] rounded-full bg-white/30 overflow-hidden">
                <div className={`h-full rounded-full bg-white ${i <= current ? 'w-full' : 'w-0'}`} />
              </div>
            ))}
          </div>
          {media.length > 1 && (
            <>
              <button type="button" onClick={() => goTo(current - 1)} className="absolute left-0 top-0 w-1/3 h-full z-10" aria-label={t('storyCard.prevAriaLabel', 'Anterior')} />
              <button type="button" onClick={() => goTo(current + 1)} className="absolute right-0 top-0 w-1/3 h-full z-10" aria-label={t('storyCard.nextAriaLabel', 'Próximo')} />
            </>
          )}
          {counter}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className="relative w-full h-full bg-[#111] overflow-hidden group/pane"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
    >
      <VideoPrewarm src={prewarmVideoUrl} />
      <div
        className="flex h-full"
        style={{
          transform: `translateX(calc(${-current * 100}% + ${dragOffset}px))`,
          transition: isDragging || reduceMotion ? 'none' : `transform ${SNAP_MS}ms ease-out`,
        }}
      >
        {media.map((m, i) => (
          <button
            key={m.id}
            type="button"
            aria-label={t('instagramCard.openMediaAriaLabel', 'Abrir mídia {{index}}', { index: i + 1 })}
            onClick={() => openAt(i)}
            draggable={false}
            className="relative flex-none w-full h-full flex items-center justify-center"
          >
            {renderItem(m, i, '(min-width: 768px) 55vw, 100vw')}
          </button>
        ))}
      </div>
      {media.length > 1 && current > 0 && (
        <button type="button" onClick={() => goTo(current - 1)} aria-label={t('instagramCard.prevSlideAriaLabel', 'Slide anterior')} className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/85 text-[#222] flex items-center justify-center shadow">
          <ChevronLeft size={18} />
        </button>
      )}
      {media.length > 1 && current < media.length - 1 && (
        <button type="button" onClick={() => goTo(current + 1)} aria-label={t('instagramCard.nextSlideAriaLabel', 'Próximo slide')} className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/85 text-[#222] flex items-center justify-center shadow">
          <ChevronRight size={18} />
        </button>
      )}
      {media.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 z-20 flex justify-center gap-1.5">
          {media.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === current ? 'w-4 bg-white' : 'w-1.5 bg-white/45'}`} />
          ))}
        </div>
      )}
      {counter}
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostMediaPane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/posts/PostMediaPane.tsx apps/hub/src/components/posts/__tests__/PostMediaPane.test.tsx
git commit -m "feat(hub): PostMediaPane carousel and story viewer for the detail dialog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `PostDetailDialog`

**Files:**
- Create: `apps/hub/src/components/posts/PostDetailDialog.tsx`
- Modify: `apps/hub/src/components/PostHistoryPanel.tsx` (`defaultOpen` prop)
- Modify: `apps/hub/src/components/PostMediaLightbox.tsx:90` (`pointer-events-auto`)
- Test: `apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`

**Interfaces:**
- Produces:

```ts
interface PostDetailDialogProps {
  posts: HubPost[];                 // visible order; drives strip, prev/next, nextPending
  currentId: number | null;         // null = closed
  token: string;
  approvals: PostApproval[];
  instagramProfile: InstagramProfile | null;
  workspaceName?: string;
  isAutoPublish: (post: HubPost) => boolean;
  onNavigate: (postId: number | null) => void;   // null = close
  onApprovalSubmitted: () => void;               // query invalidation
}
```

- Consumes: `HubDialog` (Task 3), `usePostNavigation` (Task 2), `PostMediaPane` (Task 7), `CorrectionPanel` (Task 6), `useEditSuggestion`, `submitApproval`, `PostHistoryPanel`, `PostMediaLightbox`, `SharePostButton`, `StatusTag`, `PlatformBadge`, `getTipoLabel`, `getPostCover`, `deriveCaption`, `RichTextContent`.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubContext } from '../../../HubContext';
import { PostDetailDialog } from '../PostDetailDialog';
import type { HubPost, HubPostMedia } from '../../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({
  submitApproval: submitApprovalMock,
  submitEditSuggestion: vi.fn(),
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));

const hubValue = {
  bootstrap: { workspace: { name: 'Mesaas', logo_url: '', brand_color: '#0f766e' }, cliente_nome: 'C', is_active: true, cliente_id: 1 },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;

const MEDIA: HubPostMedia = {
  id: 1, post_id: 1, kind: 'image', mime_type: 'image/jpeg', url: 'https://cdn/a.jpg', thumbnail_url: null,
  width: 1080, height: 1350, duration_seconds: null, is_cover: false, sort_order: 0,
};

function post(over: Partial<HubPost>): HubPost {
  return {
    id: 1, titulo: 'Post', tipo: 'feed', status: 'enviado_cliente', ordem: 1, conteudo: null,
    conteudo_plain: 'Corpo', scheduled_at: '2026-04-28T10:00:00.000Z', ig_caption: 'Legenda um',
    instagram_permalink: null, published_at: null, publish_error: null, workflow_id: 1,
    workflow_titulo: 'Editorial', workflow_created_at: null, media: [MEDIA], cover_media: null,
    pending_suggestion: null, suggestion_rejected_at: null, ...over,
  };
}

const posts = [
  post({ id: 1, titulo: 'Primeiro', ig_caption: 'Legenda um' }),
  post({ id: 2, titulo: 'Segundo', status: 'aprovado_cliente', ig_caption: 'Legenda dois' }),
  post({ id: 3, titulo: 'Terceiro', media: [], ig_caption: null, conteudo_plain: 'Texto do terceiro' }),
];

function renderDialog(currentId: number | null, over: Partial<React.ComponentProps<typeof PostDetailDialog>> = {}) {
  const onNavigate = vi.fn();
  const onApprovalSubmitted = vi.fn();
  render(
    <HubContext.Provider value={hubValue}>
      <MemoryRouter>
        <PostDetailDialog
          posts={posts}
          currentId={currentId}
          token="token-publico"
          approvals={[]}
          instagramProfile={null}
          isAutoPublish={() => false}
          onNavigate={onNavigate}
          onApprovalSubmitted={onApprovalSubmitted}
          {...over}
        />
      </MemoryRouter>
    </HubContext.Provider>,
  );
  return { onNavigate, onApprovalSubmitted };
}

describe('PostDetailDialog', () => {
  beforeEach(() => {
    submitApprovalMock.mockReset();
    vi.restoreAllMocks();
  });

  it('is closed when currentId is null', () => {
    renderDialog(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the post with caption, chips, footer actions and the strip', () => {
    renderDialog(1);
    expect(screen.getByRole('dialog', { name: 'Primeiro' })).toBeInTheDocument();
    expect(screen.getByText('Legenda um')).toBeInTheDocument();
    expect(screen.getByText('Aguardando aprovação')).toBeInTheDocument();
    expect(screen.getByText('Editorial')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aprovar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Corrigir/ })).toBeInTheDocument();
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Outros posts' })).toBeInTheDocument();
  });

  it('hides Aprovar/Corrigir for a non-pending post and shows the status once', () => {
    renderDialog(2);
    expect(screen.queryByRole('button', { name: /Aprovar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Corrigir/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Aprovado')).toHaveLength(1);
  });

  it('renders exactly one prev and one next control', () => {
    renderDialog(2);
    expect(screen.getAllByRole('button', { name: 'Post anterior' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Próximo post' })).toHaveLength(1);
  });

  it('navigates with arrows, keys and the strip', () => {
    const { onNavigate } = renderDialog(2);
    fireEvent.click(screen.getByRole('button', { name: 'Post anterior' }));
    expect(onNavigate).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigate).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Ir para Terceiro' }));
    expect(onNavigate).toHaveBeenLastCalledWith(3);
  });

  it('disables prev at the start and next at the end', () => {
    renderDialog(1);
    expect(screen.getByRole('button', { name: 'Post anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próximo post' })).toBeEnabled();
  });

  it('renders a text post in reading mode with the rich body', () => {
    renderDialog(3);
    expect(screen.getByText('Texto do terceiro')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Texto' })).toBeInTheDocument();
  });

  it('Corrigir opens the panel; Fechar with a typed comentário asks to discard', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onNavigate } = renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), { target: { value: 'x' } });
    expect(screen.getByRole('button', { name: /Aprovar/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('Fechar without changes returns to the reading mode and re-enables Aprovar', () => {
    renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('button', { name: /Enviar correção/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aprovar/ })).toBeEnabled();
  });

  it('Aprovar submits, then auto-advances to the next pending post before invalidating', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true, scheduled: false });
    const calls: string[] = [];
    const { onNavigate, onApprovalSubmitted } = renderDialog(3, {
      posts: [post({ id: 3, titulo: 'A' }), post({ id: 4, titulo: 'B', status: 'postado' }), post({ id: 5, titulo: 'C' })],
    });
    onNavigate.mockImplementation(() => calls.push('navigate'));
    onApprovalSubmitted.mockImplementation(() => calls.push('invalidate'));
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
    await waitFor(() => expect(submitApprovalMock).toHaveBeenCalledWith('token-publico', 3, 'aprovado', undefined));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(5));
    expect(calls).toEqual(['navigate', 'invalidate']);
    expect(screen.getByText('Post aprovado!')).toBeInTheDocument();
  });

  it('shows the scheduled flash when the approval auto-scheduled the post', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true, scheduled: true });
    renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
    expect(await screen.findByText('Post aprovado e agendado para publicação!')).toBeInTheDocument();
  });

  it('Esc with the lightbox open closes only the lightbox', () => {
    const { onNavigate } = renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mídia 1' }));
    // PostMediaLightbox is its own role="dialog" (unnamed) portalled into body.
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Primeiro' }), { key: 'Escape' });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Primeiro' })).toBeInTheDocument();
  });

  it('closes after the action when no other pending post remains', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true });
    const { onNavigate } = renderDialog(1, { posts: [post({ id: 1 }), post({ id: 2, status: 'postado' })] });
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    await waitFor(() => expect(submitApprovalMock).toHaveBeenCalledWith('token-publico', 1, 'correcao', '', undefined));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(null));
  });

  it('shows the correction flash on the next post', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true });
    renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    expect(await screen.findByText('Correção enviada!')).toBeInTheDocument();
  });

  it('shows the error and stays when submit fails', async () => {
    submitApprovalMock.mockRejectedValue(new Error('boom'));
    const { onNavigate } = renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
    expect(await screen.findByText('Não foi possível enviar. Tente novamente.')).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Aprovar/ })).toBeEnabled();
  });

  it('renders the notAvailable state for an unknown id', () => {
    const { onNavigate } = renderDialog(99);
    expect(screen.getByText('Esta postagem não está disponível.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('Esc closes when nothing is dirty', () => {
    const { onNavigate } = renderDialog(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onNavigate).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/hub/src/components/posts/PostDetailDialog.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import type { CorrectionReason, HubPost, InstagramProfile, PostApproval } from '../../types';
import { submitApproval } from '../../api';
import { useEditSuggestion } from '../../hooks/useEditSuggestion';
import { usePostNavigation } from '../../hooks/usePostNavigation';
import { deriveCaption, getPostCover, getPostPublishState, getTipoLabel, pickPostCardKind } from '../../lib/postView';
import { sanitizeExternalUrl } from '../../lib/security';
import { HubDialog } from '../ui/HubDialog';
import { formatDate, PlatformBadge } from '../PostCard';
import { PostHistoryPanel } from '../PostHistoryPanel';
import { PostMediaLightbox } from '../PostMediaLightbox';
import { RichTextContent } from '../RichTextContent';
import { SharePostButton } from '../SharePostButton';
import { MediaUnavailable } from '../MediaUnavailable';
import { StatusTag } from './StatusTag';
import { PostMediaPane } from './PostMediaPane';
import { CorrectionPanel } from './CorrectionPanel';

interface PostDetailDialogProps {
  posts: HubPost[];
  currentId: number | null;
  token: string;
  approvals: PostApproval[];
  instagramProfile: InstagramProfile | null;
  workspaceName?: string;
  isAutoPublish: (post: HubPost) => boolean;
  onNavigate: (postId: number | null) => void;
  onApprovalSubmitted: () => void;
}

type Flash = 'approved' | 'approvedScheduled' | 'correctionSent';

export function PostDetailDialog(props: PostDetailDialogProps) {
  const { posts, currentId, onNavigate } = props;
  const { t } = useTranslation('hubPosts');
  const nav = usePostNavigation(posts, currentId);
  const open = currentId !== null;
  // The flash outlives the per-post content (which remounts via key on auto-advance):
  // the Hub has no toast library, so the confirmation rides along to the next post.
  const [flash, setFlash] = useState<Flash | null>(null);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 3000);
    return () => window.clearTimeout(id);
  }, [flash]);
  useEffect(() => {
    if (!open) setFlash(null);
  }, [open]);

  if (open && !nav.current) {
    return (
      <HubDialog open onRequestClose={() => onNavigate(null)} title={t('posts.notAvailable', 'Esta postagem não está disponível.')}>
        <div className="hub-bg-card rounded-2xl w-[min(420px,calc(100vw-2rem))] p-6 text-center space-y-4">
          <p className="text-[14px] hub-tx2">{t('posts.notAvailable', 'Esta postagem não está disponível.')}</p>
          <button type="button" onClick={() => onNavigate(null)} className="hub-btn-secondary rounded-[var(--hub-r-ctl)] px-4 py-2 text-[13px] font-semibold">
            {t('shared.fechar', 'Fechar')}
          </button>
        </div>
      </HubDialog>
    );
  }

  if (!nav.current) return null;
  // key={post.id}: every piece of per-post state (edit hook, panel, tabs, lightbox) resets on navigation.
  return <PostDetailContent key={nav.current.id} {...props} post={nav.current} nav={nav} flash={flash} onFlash={setFlash} />;
}

type ContentProps = PostDetailDialogProps & {
  post: HubPost;
  nav: ReturnType<typeof usePostNavigation>;
  flash: Flash | null;
  onFlash: (f: Flash) => void;
};

function PostDetailContent({
  posts, post, nav, token, approvals, isAutoPublish, onNavigate, onApprovalSubmitted, flash, onFlash,
}: ContentProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const dateLang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const kind = pickPostCardKind(post);
  const isPending = post.status === 'enviado_cliente';
  const [tab, setTab] = useState<'content' | 'history'>('content');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelDirty, setPanelDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const stripRef = useRef<HTMLUListElement>(null);

  const edit = useEditSuggestion({ token, post, onSaved: onApprovalSubmitted });
  const { dirty, approvalBlocked, saveState, draftConteudo, draftIgCaption } = edit;
  const caption = deriveCaption(post, edit.isEditable ? draftIgCaption : post.ig_caption);
  const showPanel = panelOpen && isPending;

  useUnsavedWork(panelDirty || submitting);

  const handleDirtyChange = useCallback((d: boolean) => setPanelDirty(d), []);

  // Navigation/close guard: blocked while a save is in flight or failed; confirm when unsent input exists.
  const guard = useCallback((): boolean => {
    if (dirty) return false;
    if (!panelDirty) return true;
    return window.confirm(t('shared.discardCorrectionConfirm', 'Descartar as alterações não enviadas?'));
  }, [dirty, panelDirty, t]);

  const go = useCallback(
    (target: HubPost | null) => {
      if (!target || !guard()) return;
      onNavigate(target.id);
    },
    [guard, onNavigate],
  );
  const close = useCallback(() => {
    // Radix reports Esc / scrim clicks even when the lightbox (portalled to body,
    // above us) is what the user is dismissing: let the lightbox handle those.
    if (lightboxIdx !== null) return;
    if (guard()) onNavigate(null);
  }, [guard, onNavigate, lightboxIdx]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return;
      if (lightboxIdx !== null) return;
      if (e.key === 'ArrowLeft') go(nav.prev);
      if (e.key === 'ArrowRight') go(nav.next);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, nav.prev, nav.next, lightboxIdx]);

  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[data-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [post.id]);

  async function submit(action: 'aprovado' | 'correcao', comentario = '', motivo: CorrectionReason | null = null) {
    setSubmitting(true);
    setError(null);
    try {
      let res: { scheduled?: boolean } | undefined;
      if (action === 'correcao') res = await submitApproval(token, post.id, 'correcao', comentario, motivo ?? undefined);
      else res = await submitApproval(token, post.id, 'aprovado', undefined);
      // Snapshot BEFORE invalidation: on Aprovações the post leaves the list and indices shift.
      const next = nav.nextPending;
      setPanelDirty(false);
      onFlash(action === 'correcao' ? 'correctionSent' : res?.scheduled ? 'approvedScheduled' : 'approved');
      onNavigate(next?.id ?? null);
      onApprovalSubmitted();
    } catch {
      setError(t('posts.submitError', 'Não foi possível enviar. Tente novamente.'));
    } finally {
      setSubmitting(false);
    }
  }

  function closePanel() {
    if (!guard()) return;
    setPanelOpen(false);
    setPanelDirty(false);
  }

  const chips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusTag status={getPostPublishState(post)} size="md" />
      <span className="rounded-full hub-bg-soft hub-tx2 text-[11px] px-2 py-0.5">
        {kind === 'story'
          ? t('posts.storyFrames', 'Story · {{count}}', { count: post.media.length })
          : kind === 'text'
            ? `${getTipoLabel(t, post.tipo)} · ${t('posts.noMedia', 'Sem mídia')}`
            : post.media.length > 1
              ? `${getTipoLabel(t, post.tipo)} · ${t('posts.slides', '{{count}} slides', { count: post.media.length })}`
              : getTipoLabel(t, post.tipo)}
      </span>
      <PlatformBadge platform={post.platform} />
      {post.ig_trial_strategy && (
        <span className="rounded-full border text-[11px] px-2 py-0.5" style={{ color: 'var(--hub-acc)', borderColor: 'var(--hub-acc)' }}>
          {t('shared.reelDeTeste', 'Reel de teste')}
        </span>
      )}
      <span className="rounded-full hub-bg-soft hub-tx2 text-[11px] px-2 py-0.5">{formatDate(post.scheduled_at, dateLang)}</span>
      {post.workflow_titulo && (
        <span className="rounded-full hub-bg-soft hub-tx2 text-[11px] px-2 py-0.5">{post.workflow_titulo}</span>
      )}
    </div>
  );

  const autocleanedLink = post.media_autocleaned_at
    ? post.instagram_permalink
      ? { href: post.instagram_permalink, label: t('shared.viewOnInstagram', 'Ver no Instagram') }
      : post.tiktok_post_url
        ? { href: post.tiktok_post_url, label: t('shared.viewOnTikTok', 'Ver no TikTok') }
        : null
    : null;

  const readingBody =
    kind === 'text' ? (
      <div className="space-y-4">
        {post.media_autocleaned_at && (
          <div className="hub-bg-soft rounded-xl px-4 py-5 flex flex-col items-center gap-2 text-center">
            <ImageOff size={20} className="hub-tx3 opacity-60" aria-hidden="true" />
            <span className="text-[12.5px] font-medium hub-tx2">{t('textCard.mediaRemoved', 'Mídia removida para liberar espaço')}</span>
            {autocleanedLink && (
              <a href={sanitizeExternalUrl(autocleanedLink.href)} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold" style={{ color: 'var(--hub-acc)' }}>
                {autocleanedLink.label}
              </a>
            )}
          </div>
        )}
        {draftConteudo ? (
          <RichTextContent content={draftConteudo} className="font-display text-[16px] leading-[1.55] hub-txt" editable={false} fallbackText={post.conteudo_plain} />
        ) : (
          <p className="font-display text-[16px] leading-[1.55] hub-txt whitespace-pre-wrap">{post.conteudo_plain}</p>
        )}
        {(draftIgCaption || post.ig_caption) && (
          <div className="border-t hub-border pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.06em] hub-tx3 mb-1">{t('textCard.instagramCaptionLabel', 'Legenda do Instagram')}</p>
            <p className="text-[13px] hub-tx2 leading-relaxed whitespace-pre-wrap">{draftIgCaption ?? post.ig_caption}</p>
          </div>
        )}
      </div>
    ) : (
      <p className="text-[14px] hub-txt leading-[1.55] whitespace-pre-wrap">{caption}</p>
    );

  const autoPublishNote = isPending && isAutoPublish(post) && (
    <p className="text-[12px] hub-tx3 mt-4">
      {post.scheduled_at
        ? t('instagramCard.autoPublishScheduled', 'Ao aprovar, este post será publicado automaticamente no Instagram em {{date}}.', {
            date: new Date(post.scheduled_at).toLocaleDateString(dateLang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
          })
        : t('instagramCard.autoPublishUnscheduled', 'Ao aprovar, este post será agendado para publicação automática no Instagram.')}
    </p>
  );

  // One pair only (jsdom ignores responsive classes, so a mobile + desktop pair
  // would double every getByRole). Absolute inside the relative wrapper: on the
  // dialog's edges at mid-height on phones, outside the card on md+.
  const navButton = (dir: 'prev' | 'next') => {
    const target = dir === 'prev' ? nav.prev : nav.next;
    return (
      <button
        type="button"
        aria-label={dir === 'prev' ? t('posts.previous', 'Post anterior') : t('posts.next', 'Próximo post')}
        disabled={!target || dirty}
        onClick={() => go(target)}
        className={`absolute z-30 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-[#222] flex items-center justify-center shadow disabled:opacity-30 disabled:cursor-default ${
          dir === 'prev' ? 'left-2 md:-left-14' : 'right-2 md:-right-14'
        }`}
      >
        {dir === 'prev' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>
    );
  };

  const singleColumn = kind === 'text';

  const flashText =
    flash === 'approved'
      ? t('shared.postApproved', 'Post aprovado!')
      : flash === 'approvedScheduled'
        ? t('instagramCard.postApprovedAndScheduled', 'Post aprovado e agendado para publicação!')
        : flash === 'correctionSent'
          ? t('shared.correctionSent', 'Correção enviada!')
          : null;

  return (
    <HubDialog open onRequestClose={close} title={post.titulo}>
      <div className="relative w-full h-full md:h-auto md:w-auto flex items-center justify-center">
        {navButton('prev')}
        {navButton('next')}
        <div
          className={`hub-bg-card md:rounded-2xl overflow-hidden flex flex-col md:grid w-full h-full md:h-[min(92vh,820px)] ${
            singleColumn ? 'md:w-[min(560px,calc(100vw-7rem))]' : 'md:w-[min(1040px,calc(100vw-7rem))] md:grid-cols-[1.15fr_1fr]'
          }`}
        >
          {!singleColumn && (
            <div className="relative h-[55vh] md:h-full min-h-0">
              <span className="absolute top-3 left-3 z-20 rounded-full bg-black/45 text-white text-[11px] px-2 py-0.5">
                {t('posts.counter', '{{current}} de {{total}}', { current: nav.index + 1, total: posts.length })}
              </span>
              <PostMediaPane post={post} onOpenLightbox={setLightboxIdx} priority />
            </div>
          )}

          <div className="flex flex-col min-h-0 flex-1">
            {flashText && (
              <p role="status" className="flex items-center gap-2 px-4 py-2 text-[12.5px] font-semibold bg-emerald-50 text-emerald-800 border-b border-emerald-200/60">
                <CheckCircle size={14} aria-hidden="true" /> {flashText}
              </p>
            )}
            <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b hub-border">
              <div className="flex-1 min-w-0 space-y-2">
                <h3 className="font-display text-[18px] leading-[1.15] hub-txt">{post.titulo}</h3>
                {chips}
                {singleColumn && (
                  <span className="text-[11px] hub-tx3">
                    {t('posts.counter', '{{current}} de {{total}}', { current: nav.index + 1, total: posts.length })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <SharePostButton postId={post.id} />
                <button type="button" onClick={close} aria-label={t('posts.closeDialog', 'Fechar postagem')} className="w-8 h-8 rounded-full hub-bg-soft hub-tx2 flex items-center justify-center">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div role="tablist" className="flex gap-5 px-4 border-b hub-border">
              {(['content', 'history'] as const).map((key) => (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`py-2.5 text-[12px] font-semibold border-b-2 -mb-px transition-colors ${tab === key ? 'hub-txt border-[var(--hub-txt)]' : 'hub-tx3 border-transparent'}`}
                >
                  {key === 'history'
                    ? t('posts.tabHistory', 'Histórico e comentários')
                    : kind === 'text'
                      ? t('posts.tabText', 'Texto')
                      : t('posts.tabCaption', 'Legenda')}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              {tab === 'history' ? (
                <PostHistoryPanel post={post} token={token} approvals={approvals} onCommentSent={onApprovalSubmitted} defaultOpen />
              ) : showPanel ? (
                <CorrectionPanel
                  key={post.id}
                  post={post}
                  edit={edit}
                  submitting={submitting}
                  onSubmitCorrection={(c, m) => submit('correcao', c, m)}
                  onDirtyChange={handleDirtyChange}
                />
              ) : (
                <>
                  {readingBody}
                  {autoPublishNote}
                </>
              )}
            </div>

            <ul ref={stripRef} aria-label={t('posts.stripLabel', 'Outros posts')} className="flex gap-1.5 px-4 py-2 border-t hub-border overflow-x-auto shrink-0">
              {posts.map((p) => {
                const cover = getPostCover(p);
                const src = cover?.kind === 'video' ? cover.thumbnail_url : cover?.url;
                const isCurrent = p.id === post.id;
                return (
                  <li key={p.id} data-current={isCurrent ? 'true' : undefined} className="shrink-0">
                    <button
                      type="button"
                      aria-label={t('posts.goToPost', 'Ir para {{title}}', { title: p.titulo })}
                      aria-current={isCurrent ? 'true' : undefined}
                      disabled={dirty}
                      onClick={() => (isCurrent ? undefined : go(p))}
                      className={`block w-[30px] h-[38px] rounded-md overflow-hidden ${isCurrent ? 'ring-2 ring-[var(--hub-txt)] ring-offset-1 ring-offset-[var(--hub-card)]' : 'opacity-60 hover:opacity-100'}`}
                    >
                      {cover && !cover.media_lost_at && src ? (
                        <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      ) : cover ? (
                        <MediaUnavailable size="compact" />
                      ) : (
                        <span className="block w-full h-full hub-bg-soft border hub-border" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {(isPending || (post.status === 'postado' && post.instagram_permalink)) && (
            <div className="px-4 py-3 border-t hub-border hub-bg-soft shrink-0 space-y-2">
              {error && <p className="text-[12px] text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{error}</p>}
              {isPending ? (
                <div className="flex gap-2">
                  {showPanel ? (
                    <button type="button" onClick={closePanel} disabled={dirty} className="flex-1 rounded-[var(--hub-r-ctl)] border hub-border py-2.5 min-h-[44px] text-[13px] font-semibold hub-tx2 disabled:opacity-50">
                      {t('shared.fechar', 'Fechar')}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setPanelOpen(true)} disabled={submitting || edit.hasPendingSuggestion} className="flex-1 flex items-center justify-center gap-1.5 hub-btn-secondary rounded-[var(--hub-r-ctl)] py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50">
                      <AlertCircle size={15} /> {t('posts.correct', 'Corrigir')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => submit('aprovado')}
                    disabled={submitting || approvalBlocked || dirty || panelDirty}
                    className="flex-1 flex items-center justify-center gap-1.5 hub-btn-primary rounded-[var(--hub-r-ctl)] py-2.5 min-h-[44px] text-[13px] font-semibold disabled:opacity-50"
                  >
                    <CheckCircle size={15} /> {saveState === 'saving' ? t('shared.saving', 'Salvando...') : t('shared.aprovar', 'Aprovar')}
                  </button>
                </div>
              ) : post.status === 'postado' && post.instagram_permalink ? (
                // The status already sits in the header chips; only the permalink lives here.
                <div className="flex items-center justify-end">
                  <a href={sanitizeExternalUrl(post.instagram_permalink)} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold" style={{ color: 'var(--hub-acc)' }}>
                    {t('shared.viewOnInstagram', 'Ver no Instagram')}
                  </a>
                </div>
              ) : null}
            </div>
            )}
          </div>
        </div>
      </div>

      {lightboxIdx !== null && post.media.length > 0 && (
        <PostMediaLightbox media={post.media} initialIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} onStaleUrl={onApprovalSubmitted} />
      )}
    </HubDialog>
  );
}
```

Add the missing key `posts.correct` to both locale files (`"correct": "Corrigir"` / `"correct": "Correct"`) and to the key list in `hubPostsLocale.test.ts`.

`PostHistoryPanel` currently renders collapsed behind its own toggle. Add an optional `defaultOpen?: boolean` prop to `apps/hub/src/components/PostHistoryPanel.tsx` that seeds its `open` state: the toggle is the single `const [open, setOpen] = useState(false);` at line 55; change it to `useState(!!defaultOpen)`, so the Histórico tab shows the content immediately. Its toggle button text is "Histórico e comentários" (line 209), the same as the dialog's tab: the tests above query the tab with `getByRole('tab', ...)` and never `getByRole('button', { name: 'Histórico e comentários' })`; keep it that way.

`workspaceName` stays in `PostDetailDialogProps` (the pages pass it) but is intentionally NOT destructured in `PostDetailContent`: an unused destructured binding fails `npm run lint`.

`PostMediaLightbox` portals into `document.body`, and Radix sets `pointer-events: none` on `body` while the modal dialog is open, which would make every click in the lightbox dead. In `apps/hub/src/components/PostMediaLightbox.tsx` add `pointer-events-auto` to the root div's className (line 90: `"fixed inset-0 z-[9005] pointer-events-auto flex items-center justify-center bg-black/90"`). The dialog's `close()` early-returns while the lightbox is open, so Esc and scrim clicks only dismiss the lightbox.

- [ ] **Step 4: Run the test**

Run: `npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx apps/hub/src/components/__tests__/PostHistoryPanel.test.tsx`
Expected: PASS. Radix renders `role="dialog"` with `aria-labelledby` pointing at the sr-only title, so `getByRole('dialog', { name: 'Primeiro' })` resolves.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: clean. If duplicate `@tiptap/core` errors appear, run `npm ci` and retry.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/components/posts/PostDetailDialog.tsx apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx apps/hub/src/components/PostHistoryPanel.tsx apps/hub/src/components/PostMediaLightbox.tsx packages/i18n/locales/pt/hubPosts.json packages/i18n/locales/en/hubPosts.json apps/hub/src/lib/__tests__/hubPostsLocale.test.ts
git commit -m "feat(hub): PostDetailDialog with split pane, strip, correction panel and auto-advance

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `FluxoFilterChips`, `PostagensPage` rewrite, router

**Files:**
- Create: `apps/hub/src/components/FluxoFilterChips.tsx`
- Modify: `apps/hub/src/pages/PostagensPage.tsx` (rewrite)
- Modify: `apps/hub/src/router.tsx`
- Test: `apps/hub/src/pages/__tests__/postagensPage.test.tsx` (create)

**Interfaces:**
- Produces: `FluxoFilterChips({ value: FluxoFilter; options: { key: FluxoFilter; label: string; count: number }[]; onChange })` where `FluxoFilter = 'all' | 'avulso' | \`wf-${number}\``.
- Consumes: `PostGrid`, `PostDetailDialog`, `StatusFilterChips`, `FeedPreviewButton`, `InstagramGridPreview`, `sortPostsChronologically`, `getPostPublishState`, `isFeedSelectable` (from `PostTile`), `isAutoPublishActive`.

- [ ] **Step 1: Write the failing page test**

`apps/hub/src/pages/__tests__/postagensPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HubContext } from '../../HubContext';
import type { HubPost, HubPostMedia, HubPostsResponse } from '../../types';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchInstagramFeed: vi.fn(),
  submitApproval: vi.fn(),
  submitEditSuggestion: vi.fn(),
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));
vi.mock('../../components/InstagramGridPreview', () => ({
  InstagramGridPreview: ({ selectedPosts, onClose }: { selectedPosts: { id: number }[]; onClose: () => void }) => (
    <div data-testid="instagram-grid-preview">
      <span data-testid="grid-selected-count">{selectedPosts.length}</span>
      <button type="button" onClick={onClose}>Close grid</button>
    </div>
  ),
}));

import { fetchPosts } from '../../api';
import { PostagensPage } from '../PostagensPage';
const mockedFetchPosts = vi.mocked(fetchPosts);

const hubValue = {
  bootstrap: { workspace: { name: 'Mesaas', logo_url: '', brand_color: '#0f766e' }, cliente_nome: 'C', is_active: true, cliente_id: 14 },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;

const MEDIA: HubPostMedia = {
  id: 100, post_id: 1, kind: 'image', mime_type: 'image/jpeg', url: 'https://cdn/img.jpg', thumbnail_url: null,
  width: 1080, height: 1350, duration_seconds: null, is_cover: false, sort_order: 0,
};

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1, titulo: 'Post padrão', tipo: 'feed', status: 'enviado_cliente', ordem: 1, conteudo: null, conteudo_plain: 'Conteúdo',
    scheduled_at: '2026-04-20T10:00:00.000Z', ig_caption: null, instagram_permalink: null, published_at: null, publish_error: null,
    workflow_id: 1, workflow_titulo: 'Editorial', workflow_created_at: null, media: [{ ...MEDIA, post_id: over.id ?? 1 }],
    cover_media: null, pending_suggestion: null, suggestion_rejected_at: null, ...over,
  };
}

function response(over: Partial<HubPostsResponse> = {}): HubPostsResponse {
  return { posts: [], postApprovals: [], propertyValues: [], workflowSelectOptions: [], instagramProfile: null, ...over };
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="location">{loc.pathname}</span>;
}

function renderPage(path: string, resp?: HubPostsResponse) {
  if (resp) mockedFetchPosts.mockResolvedValue(resp);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route path="/:workspace/hub/:token/postagens/:postId?" element={<PostagensPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, qc };
}

const BASE = '/mesaas/hub/token-publico/postagens';

describe('PostagensPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one flattened chronological grid with fluxo and status chips', async () => {
    renderPage(BASE, response({
      posts: [
        post({ id: 1, titulo: 'Segundo', scheduled_at: '2026-04-22T10:00:00.000Z', workflow_id: 2, workflow_titulo: 'Campanha' }),
        post({ id: 2, titulo: 'Primeiro', scheduled_at: '2026-04-20T10:00:00.000Z' }),
        post({ id: 3, titulo: 'Avulso', scheduled_at: null, workflow_id: null, workflow_titulo: null }),
        post({ id: 4, titulo: 'Rascunho', status: 'rascunho' }),
      ],
    }));
    const tiles = await screen.findAllByRole('button', { name: /^Abrir / });
    expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual(['Abrir Primeiro', 'Abrir Segundo', 'Abrir Avulso']);
    expect(screen.getByRole('group', { name: 'Filtrar por fluxo' })).toHaveTextContent('Editorial');
    expect(screen.getByRole('group', { name: 'Filtrar por fluxo' })).toHaveTextContent('Campanha');
    expect(screen.getByRole('group', { name: 'Filtrar por fluxo' })).toHaveTextContent('Avulsas');
    expect(screen.getByRole('group', { name: 'Filtrar por status' })).toBeInTheDocument();
  });

  it('filters by fluxo and status together', async () => {
    renderPage(BASE, response({
      posts: [
        post({ id: 1, titulo: 'A', workflow_id: 1 }),
        post({ id: 2, titulo: 'B', workflow_id: 2, workflow_titulo: 'Campanha', status: 'aprovado_cliente' }),
        post({ id: 3, titulo: 'C', workflow_id: 2, workflow_titulo: 'Campanha' }),
      ],
    }));
    await screen.findByRole('button', { name: 'Abrir A' });
    fireEvent.click(screen.getByRole('button', { name: /Campanha/ }));
    expect(screen.queryByRole('button', { name: 'Abrir A' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Aprovado \(/ }));
    expect(screen.getByRole('button', { name: 'Abrir B' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir C' })).not.toBeInTheDocument();
  });

  it('opens the dialog on tile click and updates the URL; close returns to the list', async () => {
    renderPage(BASE, response({ posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B' })] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir A' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`${BASE}/1`);
    expect(screen.getByRole('dialog', { name: 'A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próximo post' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`${BASE}/2`);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent(BASE);
  });

  it('deep link opens the dialog with Aprovar for a pending post', async () => {
    renderPage(`${BASE}/2`, response({ posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B' })] }));
    expect(await screen.findByRole('dialog', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aprovar/ })).toBeInTheDocument();
  });

  it('deep link to an unknown or internal post shows notAvailable', async () => {
    renderPage(`${BASE}/99`, response({ posts: [post({ id: 1 })] }));
    expect(await screen.findByText('Esta postagem não está disponível.')).toBeInTheDocument();
  });

  it('a background refetch that moves the open post out of the active filter resets the filters', async () => {
    const pending = [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B' })];
    const afterApproval = [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B', status: 'aprovado_cliente' })];
    mockedFetchPosts.mockResolvedValueOnce(response({ posts: pending })).mockResolvedValue(response({ posts: afterApproval }));
    const { qc } = renderPage(BASE);
    await screen.findByRole('button', { name: 'Abrir B' });
    fireEvent.click(screen.getByRole('button', { name: /Aguardando aprovação \(/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir B' }));
    expect(screen.getByRole('dialog', { name: 'B' })).toBeInTheDocument();
    // The agency approves B elsewhere; the next refetch drops it out of the "Aguardando" filter.
    await act(() => qc.invalidateQueries({ queryKey: ['hub-posts', 'token-publico'] }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Todos \(/, hidden: true })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('dialog', { name: 'B' })).toBeInTheDocument();
  });

  it('select mode toggles checkboxes and opens the feed preview', async () => {
    renderPage(BASE, response({
      posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'S', tipo: 'stories' })],
      instagramProfile: { username: 'clinica', profilePictureUrl: null },
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar' }));
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /Visualizar no Feed \(1\)/ }));
    expect(screen.getByTestId('grid-selected-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByText('Close grid'));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('hides Selecionar without an instagramProfile', async () => {
    renderPage(BASE, response({ posts: [post({ id: 1 })] }));
    await screen.findByRole('button', { name: /Abrir/ });
    expect(screen.queryByRole('button', { name: 'Selecionar' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/hub/src/pages/__tests__/postagensPage.test.tsx`
Expected: FAIL (old page renders groups and cards).

- [ ] **Step 3: Implement `FluxoFilterChips`**

`apps/hub/src/components/FluxoFilterChips.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

export type FluxoFilter = 'all' | 'avulso' | `wf-${number}`;

export interface FluxoFilterOption {
  key: FluxoFilter;
  label: string;
  count: number;
}

interface FluxoFilterChipsProps {
  value: FluxoFilter;
  options: FluxoFilterOption[];
  onChange: (value: FluxoFilter) => void;
}

/** Postagens-only fluxo filter; rendered only when there is more than one fluxo (incl. avulsas). */
export function FluxoFilterChips({ value, options, onChange }: FluxoFilterChipsProps) {
  const { t } = useTranslation('hubPosts');
  if (options.length <= 1) return null;
  const all: FluxoFilterOption = {
    key: 'all',
    label: t('postagens.filter.all', 'Todos'),
    count: options.reduce((n, o) => n + o.count, 0),
  };
  return (
    <div role="group" aria-label={t('postagens.filter.fluxoLabel', 'Filtrar por fluxo')} className="flex flex-wrap gap-1.5 mb-3">
      {[all, ...options].map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt.key)}
            className="rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors"
            style={selected ? { background: 'var(--hub-txt)', color: 'var(--hub-card)', borderColor: 'var(--hub-txt)' } : { color: 'var(--hub-tx2)', borderColor: 'var(--hub-bd)' }}
          >
            {opt.label} ({opt.count})
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `PostagensPage`**

Replace `apps/hub/src/pages/PostagensPage.tsx` entirely:

```tsx
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useHub } from '../HubContext';
import { fetchPosts, fetchInstagramFeed } from '../api';
import { FeedPreviewButton } from '../components/FeedPreviewButton';
import { PageHeader } from '../components/PageHeader';
import { InstagramGridPreview } from '../components/InstagramGridPreview';
import { StatusFilterChips, type StatusFilter } from '../components/StatusFilterChips';
import { FluxoFilterChips, type FluxoFilter, type FluxoFilterOption } from '../components/FluxoFilterChips';
import { PostGrid } from '../components/posts/PostGrid';
import { PostDetailDialog } from '../components/posts/PostDetailDialog';
import { isFeedSelectable, type TileMode } from '../components/posts/PostTile';
import { VISIBLE_STATUSES, getPostPublishState, sortPostsChronologically } from '../lib/postView';
import { isAutoPublishActive } from '../lib/autoPublish';

export function PostagensPage() {
  const { t } = useTranslation('hubPosts');
  const { token, workspace, bootstrap } = useHub();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { postId } = useParams<{ postId: string }>();
  const base = `/${workspace}/hub/${token}/postagens`;
  const currentId = postId !== undefined && !isNaN(parseInt(postId, 10)) ? parseInt(postId, 10) : postId !== undefined ? -1 : null;

  const [mode, setMode] = useState<TileMode>('browse');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showGrid, setShowGrid] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [fluxoFilter, setFluxoFilter] = useState<FluxoFilter>('all');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
    // Poll while a post is mid-publishing so the client sees it flip to "Publicado".
    refetchInterval: (query) =>
      (query.state.data?.posts ?? []).some((p) => getPostPublishState(p) === 'publicando') ? 15000 : false,
  });

  const allVisible = useMemo(
    () => sortPostsChronologically((data?.posts ?? []).filter((p) => VISIBLE_STATUSES.has(p.status))),
    [data?.posts],
  );
  const filterCounts: Record<StatusFilter, number> = {
    all: allVisible.length,
    enviado_cliente: allVisible.filter((p) => p.status === 'enviado_cliente').length,
    correcao_cliente: allVisible.filter((p) => p.status === 'correcao_cliente').length,
    aprovado_cliente: allVisible.filter((p) => p.status === 'aprovado_cliente').length,
  };
  const fluxoOptions = useMemo<FluxoFilterOption[]>(() => {
    const map = new Map<FluxoFilter, FluxoFilterOption>();
    for (const p of allVisible) {
      const key: FluxoFilter = p.workflow_id != null ? `wf-${p.workflow_id}` : 'avulso';
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else
        map.set(key, {
          key,
          label: key === 'avulso' ? t('postagens.filter.avulsas', 'Avulsas') : (p.workflow_titulo ?? ''),
          count: 1,
        });
    }
    return [...map.values()];
  }, [allVisible, t]);

  const visiblePosts = useMemo(
    () =>
      allVisible.filter(
        (p) =>
          (statusFilter === 'all' || p.status === statusFilter) &&
          (fluxoFilter === 'all' || (fluxoFilter === 'avulso' ? p.workflow_id == null : `wf-${p.workflow_id}` === fluxoFilter)),
      ),
    [allVisible, statusFilter, fluxoFilter],
  );

  // Filters start at "Todos", so a deep link never lands on a hidden post. What can:
  // a background refetch moving the OPEN post out of the active status filter
  // (the agency approved it meanwhile). Reset so the strip and prev/next match the grid.
  useEffect(() => {
    if (currentId === null || currentId === -1) return;
    if (!allVisible.some((p) => p.id === currentId)) return;
    if (visiblePosts.some((p) => p.id === currentId)) return;
    setStatusFilter('all');
    setFluxoFilter('all');
  }, [currentId, allVisible, visiblePosts]);

  const approvals = data?.postApprovals ?? [];
  const instagramProfile = data?.instagramProfile ?? null;

  const { data: feedData } = useQuery({
    queryKey: ['hub-instagram-feed', token],
    queryFn: () => fetchInstagramFeed(token),
    enabled: showGrid && instagramProfile != null,
  });

  // Memoized on the query data + selection so the preview modal isn't handed a fresh
  // array reference (which would reset an in-progress reorder) on every background refetch.
  const selectedPosts = useMemo(
    () => (data?.posts ?? []).filter((p) => VISIBLE_STATUSES.has(p.status) && isFeedSelectable(p) && selectedIds.has(p.id)),
    [data?.posts, selectedIds],
  );

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleInvalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['hub-posts', token] }), [qc, token]);
  const handleCloseGrid = useCallback(() => setShowGrid(false), []);
  const handleOpen = useCallback((id: number) => navigate(`${base}/${id}`), [navigate, base]);
  const handleNavigate = useCallback(
    (id: number | null) => (id === null ? navigate(base, { replace: true }) : navigate(`${base}/${id}`, { replace: true })),
    [navigate, base],
  );

  return (
    <div className="max-w-5xl mx-auto hub-fade-up">
      <PageHeader
        title={t('postagens.title', 'Postagens')}
        description={
          mode === 'select'
            ? t('postagens.selectHint', 'Selecione posts para visualizar e reordenar como ficarão no feed do Instagram.')
            : t('postagens.defaultDescription', 'Todos os posts do seu calendário de conteúdo.')
        }
        action={
          instagramProfile && (
            <span className="flex items-center gap-2">
              {mode === 'select' && <FeedPreviewButton selectedCount={selectedPosts.length} onClick={() => setShowGrid(true)} />}
              <button
                type="button"
                onClick={() => setMode((m) => (m === 'select' ? 'browse' : 'select'))}
                className="rounded-[var(--hub-r-ctl)] border hub-border px-3 py-2 text-[13px] font-semibold hub-tx2"
              >
                {mode === 'select' ? t('posts.done', 'Concluir') : t('posts.select', 'Selecionar')}
              </button>
            </span>
          )
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : isError ? (
        <div className="py-20 text-center text-sm hub-tx2">{t('postagens.loadError', 'Erro ao carregar postagens.')}</div>
      ) : allVisible.length === 0 ? (
        <p className="text-sm hub-tx2">{t('postagens.empty', 'Nenhuma postagem disponível ainda.')}</p>
      ) : (
        <>
          <FluxoFilterChips value={fluxoFilter} options={fluxoOptions} onChange={setFluxoFilter} />
          <StatusFilterChips value={statusFilter} counts={filterCounts} onChange={setStatusFilter} />
          <PostGrid posts={visiblePosts} mode={mode} selectedIds={selectedIds} onOpen={handleOpen} onToggle={handleToggleSelect} />
        </>
      )}

      {!isLoading && !isError && (
        <PostDetailDialog
          posts={visiblePosts}
          currentId={currentId}
          token={token}
          approvals={approvals}
          instagramProfile={instagramProfile}
          workspaceName={bootstrap.workspace.name}
          isAutoPublish={(p) => isAutoPublishActive(data, p.workflow_id, p.id)}
          onNavigate={handleNavigate}
          onApprovalSubmitted={handleInvalidate}
        />
      )}

      {showGrid && feedData && (
        <InstagramGridPreview selectedPosts={selectedPosts} feedProfile={feedData.profile} livePosts={feedData.recentPosts} token={token} onClose={handleCloseGrid} onScheduleUpdated={handleInvalidate} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update the router**

In `apps/hub/src/router.tsx`, replace the `aprovacoes`, `postagens` and `postagens/:postId` entries with ONE route object per page using an optional segment. One object means React Router keeps the same element mounted when the URL gains or loses the id, so page state (`selectedIds`, filters, select mode, scroll) survives opening and closing the dialog:

```tsx
      {
        path: 'aprovacoes/:postId?',
        lazy: async () => ({ Component: (await import('./pages/AprovacoesPage')).AprovacoesPage }),
      },
      {
        path: 'postagens/:postId?',
        lazy: async () => ({ Component: (await import('./pages/PostagensPage')).PostagensPage }),
      },
```

Also add a route-shape test to `postagensPage.test.tsx`:

```tsx
  it('keeps page state when the dialog opens (same route object, no remount)', async () => {
    renderPage(BASE, response({
      posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B', status: 'aprovado_cliente' })],
    }));
    await screen.findByRole('button', { name: 'Abrir A' });
    fireEvent.click(screen.getByRole('button', { name: /Aprovado \(/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Aprovado \(/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Abrir A' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run apps/hub/src/pages/__tests__/postagensPage.test.tsx`
Expected: PASS. Filters are page-local state that starts at "Todos", so a deep link can never land on a filtered-out post; the only real trigger for the filter-reset effect is a background refetch changing the open post's status while a filter is active, which is what the refetch test exercises via `qc.invalidateQueries`.

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/components/FluxoFilterChips.tsx apps/hub/src/pages/PostagensPage.tsx apps/hub/src/router.tsx apps/hub/src/pages/__tests__/postagensPage.test.tsx
git commit -m "feat(hub): Postagens as a flattened tile grid with the detail dialog and :postId routing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `AprovacoesPage` rewrite

**Files:**
- Modify: `apps/hub/src/pages/AprovacoesPage.tsx` (rewrite)
- Test: `apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx` (create)

**Interfaces:**
- Consumes the same components as Task 9. Pending-only, no filters, `aprovacoes/:postId`.

- [ ] **Step 1: Write the failing test**

`apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx` (same mocks, helpers and `hubValue` as Task 9's test; copy them, importing `AprovacoesPage` instead and using the single route `/:workspace/hub/:token/aprovacoes/:postId?`; `BASE = '/mesaas/hub/token-publico/aprovacoes'`):

```tsx
describe('AprovacoesPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows only pending posts, sorted by scheduled_at, with the count description', async () => {
    renderPage(BASE, response({
      posts: [
        post({ id: 1, titulo: 'Tarde', scheduled_at: '2026-04-22T10:00:00.000Z' }),
        post({ id: 2, titulo: 'Cedo', scheduled_at: '2026-04-20T10:00:00.000Z' }),
        post({ id: 3, titulo: 'Aprovado', status: 'aprovado_cliente' }),
      ],
    }));
    const tiles = await screen.findAllByRole('button', { name: /^Abrir / });
    expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual(['Abrir Cedo', 'Abrir Tarde']);
    expect(screen.getByText('2 posts aguardando sua aprovação.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filtrar por status' })).not.toBeInTheDocument();
  });

  it('shows the empty description when nothing is pending', async () => {
    renderPage(BASE, response({ posts: [post({ id: 3, status: 'postado' })] }));
    expect(await screen.findByText('Tudo em dia. Nenhum post aguardando aprovação.')).toBeInTheDocument();
  });

  it('opens the dialog at aprovacoes/:postId and approving advances to the next pending post', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true });
    renderPage(BASE, response({ posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'B' })] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir A' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`${BASE}/1`);
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`${BASE}/2`));
    expect(screen.getByRole('dialog', { name: 'B' })).toBeInTheDocument();
  });

  it('select mode only offers media tiles and feeds the preview', async () => {
    renderPage(BASE, response({
      posts: [post({ id: 1, titulo: 'A' }), post({ id: 2, titulo: 'S', tipo: 'stories' }), post({ id: 3, titulo: 'T', media: [] })],
      instagramProfile: { username: 'clinica', profilePictureUrl: null },
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Selecionar' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Visualizar no Feed \(1\)/ }));
    expect(screen.getByTestId('grid-selected-count')).toHaveTextContent('1');
  });
});
```

(`submitApprovalMock` must be a `vi.hoisted` mock as in Task 8's test so the `vi.mock('../../api')` factory can reference it.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite `AprovacoesPage`**

Replace `apps/hub/src/pages/AprovacoesPage.tsx` entirely:

```tsx
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useHub } from '../HubContext';
import { fetchPosts, fetchInstagramFeed } from '../api';
import { FeedPreviewButton } from '../components/FeedPreviewButton';
import { PageHeader } from '../components/PageHeader';
import { InstagramGridPreview } from '../components/InstagramGridPreview';
import { PostGrid } from '../components/posts/PostGrid';
import { PostDetailDialog } from '../components/posts/PostDetailDialog';
import { isFeedSelectable, type TileMode } from '../components/posts/PostTile';
import { isAutoPublishActive } from '../lib/autoPublish';
import { sortPostsChronologically } from '../lib/postView';

export function AprovacoesPage() {
  const { t } = useTranslation('hubPosts');
  const { token, workspace, bootstrap } = useHub();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { postId } = useParams<{ postId: string }>();
  const base = `/${workspace}/hub/${token}/aprovacoes`;
  const currentId = postId !== undefined && !isNaN(parseInt(postId, 10)) ? parseInt(postId, 10) : postId !== undefined ? -1 : null;

  const [mode, setMode] = useState<TileMode>('browse');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showGrid, setShowGrid] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['hub-posts', token], queryFn: () => fetchPosts(token) });
  const { data: feedData } = useQuery({
    queryKey: ['hub-instagram-feed', token],
    queryFn: () => fetchInstagramFeed(token),
    enabled: showGrid && data?.instagramProfile != null,
  });

  const approvals = data?.postApprovals ?? [];
  const instagramProfile = data?.instagramProfile ?? null;
  const pending = useMemo(
    () => sortPostsChronologically((data?.posts ?? []).filter((p) => p.status === 'enviado_cliente')),
    [data?.posts],
  );
  const selectedPosts = useMemo(
    () => pending.filter((p) => isFeedSelectable(p) && selectedIds.has(p.id)),
    [pending, selectedIds],
  );

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleInvalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['hub-posts', token] }), [qc, token]);
  const handleCloseGrid = useCallback(() => setShowGrid(false), []);
  const handleOpen = useCallback((id: number) => navigate(`${base}/${id}`), [navigate, base]);
  const handleNavigate = useCallback(
    (id: number | null) => (id === null ? navigate(base, { replace: true }) : navigate(`${base}/${id}`, { replace: true })),
    [navigate, base],
  );

  return (
    <div className="max-w-5xl mx-auto hub-fade-up">
      <PageHeader
        title={t('aprovacoes.title', 'Aprovações')}
        description={
          mode === 'select'
            ? t('aprovacoes.selectHint', 'Selecione posts para visualizar como ficarão no feed do Instagram.')
            : pending.length === 0
              ? t('aprovacoes.emptyDescription', 'Tudo em dia. Nenhum post aguardando aprovação.')
              : t('aprovacoes.pendingDescription', '{{count}} post{{plural}} aguardando sua aprovação.', {
                  count: pending.length,
                  plural: pending.length > 1 ? 's' : '',
                })
        }
        action={
          instagramProfile && pending.length > 0 && (
            <span className="flex items-center gap-2">
              {mode === 'select' && <FeedPreviewButton selectedCount={selectedPosts.length} onClick={() => setShowGrid(true)} />}
              <button
                type="button"
                onClick={() => setMode((m) => (m === 'select' ? 'browse' : 'select'))}
                className="rounded-[var(--hub-r-ctl)] border hub-border px-3 py-2 text-[13px] font-semibold hub-tx2"
              >
                {mode === 'select' ? t('posts.done', 'Concluir') : t('posts.select', 'Selecionar')}
              </button>
            </span>
          )
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : (
        <>
          <PostGrid posts={pending} mode={mode} selectedIds={selectedIds} onOpen={handleOpen} onToggle={handleToggleSelect} />
          <PostDetailDialog
            posts={pending}
            currentId={currentId}
            token={token}
            approvals={approvals}
            instagramProfile={instagramProfile}
            workspaceName={bootstrap.workspace.name}
            isAutoPublish={(p) => isAutoPublishActive(data, p.workflow_id, p.id)}
            onNavigate={handleNavigate}
            onApprovalSubmitted={handleInvalidate}
          />
          {showGrid && feedData && (
            <InstagramGridPreview selectedPosts={selectedPosts} feedProfile={feedData.profile} livePosts={feedData.recentPosts} token={token} onClose={handleCloseGrid} onScheduleUpdated={handleInvalidate} />
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx apps/hub/src/pages/__tests__/postagensPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/pages/AprovacoesPage.tsx apps/hub/src/pages/__tests__/aprovacoesPage.test.tsx
git commit -m "feat(hub): Aprovações as a tile grid with the detail dialog and :postId routing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Remove the old cards, focus page and dead keys; full verification

**Files:**
- Delete: `apps/hub/src/components/InstagramPostCard.tsx`, `StoryPostCard.tsx`, `TextPostCard.tsx`, `OpenPostLink.tsx`, `apps/hub/src/pages/PostagemFocoPage.tsx`
- Delete tests: `apps/hub/src/components/__tests__/InstagramPostCard.test.tsx`, `StoryPostCard.test.tsx`, `TextPostCard.test.tsx`, `openPostLink.test.tsx`, `apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx`, `apps/hub/src/pages/__tests__/postagemFocoPage.test.tsx`
- Modify: `packages/i18n/locales/{pt,en}/hubPosts.json`, `apps/hub/src/lib/__tests__/hubPostsLocale.test.ts`
- Modify: any other file that still imports the deleted modules (find with grep)

- [ ] **Step 1: Delete the files**

```bash
git rm apps/hub/src/components/InstagramPostCard.tsx apps/hub/src/components/StoryPostCard.tsx apps/hub/src/components/TextPostCard.tsx apps/hub/src/components/OpenPostLink.tsx apps/hub/src/pages/PostagemFocoPage.tsx apps/hub/src/components/__tests__/InstagramPostCard.test.tsx apps/hub/src/components/__tests__/StoryPostCard.test.tsx apps/hub/src/components/__tests__/TextPostCard.test.tsx apps/hub/src/components/__tests__/openPostLink.test.tsx apps/hub/src/pages/__tests__/aprovacoesPostagensFeatures.test.tsx apps/hub/src/pages/__tests__/postagemFocoPage.test.tsx
```

- [ ] **Step 2: Find remaining references**

Run: `grep -rn "InstagramPostCard\|StoryPostCard\|TextPostCard\|PostagemFocoPage\|OpenPostLink" apps/hub/src packages e2e docs/superpowers/specs/2026-09-17-hub-correction-flow-rework-design.md`
Expected: only the two spec docs mention them (leave the docs). Fix any code hit by pointing it at the new components. `apps/hub/src/pages/__tests__/postApprovalBrandPages.test.tsx` may mock or reference the cards: update the mocks to `../../components/posts/PostGrid` / `PostDetailDialog` or remove the mock if the test no longer needs it, and make sure it still passes. Keep `packages/i18n` `hubPostCard.openPost.*` keys only if something still reads them (`grep -rn "openPost\." apps/hub/src`); otherwise delete them from both locales.

- [ ] **Step 3: Remove dead i18n keys**

From both `hubPosts.json` files delete: `aprovacoes.storiesHeader`, `aprovacoes.noMediaHeader`, `postagens.clickToExpand`, `postagens.postCount`, `postagens.avulsoGroupTitle`, `instagramCard.editCaptionHint`, `instagramCard.likeAriaLabel`, `instagramCard.suggestionRejected`, `instagramCard.verMenos`, `instagramCard.verMais`, `instagramCard.scheduledPrefix`, `instagramCard.scheduledBannerTitle`, `instagramCard.publishedBannerTitle`, `storyCard.replyPlaceholder`, `shared.suggestionPendingReviewShort`, `shared.correcaoShort`, `postagemFoco.backLink`, `postagemFoco.loadError`, `postagemFoco.retry`, `postagemFoco.notAvailable` (the whole `postagemFoco` object).

Before deleting each key, confirm with `grep -rn "<key>" apps/hub/src packages/ui` that nothing else reads it; keep any key that is still referenced (e.g. by the Mensagens hover preview). Update the key list in `hubPostsLocale.test.ts` if it named a removed key.

- [ ] **Step 4: Run the full verification**

```bash
npm run lint
npm run format
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: all clean/green. If `tsc` reports duplicate `@tiptap/core` versions: `npm ci`, then rerun. `git status` must not show `deno.lock`; if it does, `git checkout -- deno.lock`.

- [ ] **Step 5: Browser check**

Start the Hub preview (`preview_start` with the `hub` launch config), open a workspace token URL the user provides at `/postagens`, and verify: tiles render (media, text), a tile click opens the dialog with the URL updated, `←`/`→` move between posts, Corrigir shows the panel, Fechar with a typed comentário asks to discard, mobile preset (`resize_window` mobile) shows the stacked sheet, dark mode keeps the whitelabel accent inside the dialog, and clicking the media opens the lightbox above the dialog. Fix anything that is off and re-run the affected tests.

- [ ] **Step 6: Commit**

```bash
git add -A apps/hub/src packages/i18n/locales
git commit -m "refactor(hub): remove the inline post cards and PostagemFocoPage, drop dead i18n keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: grid (T4, T5), dialog layout/tabs/strip/footer/keys/auto-advance (T8), correction panel (T6), media pane (T7), routing incl. deep links, filter reset, `aprovacoes/:postId` (T9, T10), select mode (T4, T5, T9, T10), removals + i18n (T1, T11), testing (every task), browser check (T11).
- Aprovar gate uses `panelDirty` (any unsent input) which is a superset of the spec's `contentDirty`; documented in Global Constraints.
- `PostDetailDialog` owns `useEditSuggestion` and remounts per post via `key`, so the old per-card `postIdRef` reset pattern is not needed; `CorrectionPanel` is also keyed and unmounted on Fechar, which resets staged state (the Critical bug class from the previous review cannot recur).
- Type names are consistent across tasks: `TileMode`, `FluxoFilter`, `EditSuggestion`, `PostNavigation`.
