# Calendar Post Detail Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a post pill in the `WorkflowDrawer` calendar opens a right-side detail panel showing the post's full context (title, type, status, date, workflow, responsável, body excerpt, media thumbnail) plus reschedule / remove-date / open-post actions.

**Architecture:** A new presentational `CalendarPostDetailPanel` is rendered by `WorkflowCalendarView` as a docked third column (overlay on narrow viewports). The pill's identifying metadata renders instantly from the already-loaded `ClientePost`; the body excerpt, media thumbnail, and responsável id are lazy-fetched on click via a new `getPostPreview` store fn + the existing `listPostMedia`. Pills become keyboard-operable buttons with drag moved to the grip handle; overflow (`+N mais`) becomes a selectable popover.

**Tech Stack:** React 19, TanStack Query, @dnd-kit/core ^6.3.1, Radix Popover (`@/components/ui/popover`), `@/components/ui/date-time-picker`, date-fns, Vitest + Testing Library, plain CSS in `apps/crm/style.css`.

## Global Constraints

- TypeScript strict — always `npm run build` (runs `tsc` then `vite build`) after changes; it must pass.
- Run `npm run test` after changes; no regressions. CI also gates `format` (prettier) + `lint` (eslint) — run them before pushing.
- Portuguese-language UI copy.
- `href` from external/user data MUST go through `sanitizeUrl` (`@/utils/security`). (`instagram_permalink`.)
- Icons from `lucide-react` only. Dates: `date-fns` (locale `ptBR` from `date-fns/locale`).
- `clientId`/ids are numbers; `ClientePost.id` is `number` (non-optional).
- Branch already created: `feat/calendar-post-detail-panel`. Commit per task.

---

## File Structure

- **Create** `apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx` — the detail panel (presentational + 2 lazy queries). [Task 2]
- **Create** `apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx` — panel unit tests. [Task 2]
- **Create** `apps/crm/src/pages/entregas/components/__tests__/CalendarGrid.test.tsx` — grid pill/overflow tests. [Task 3]
- **Modify** `apps/crm/src/store/posts.ts` — add `PostPreview` + `getPostPreview`. [Task 1]
- **Modify** `apps/crm/src/__tests__/store.posts.test.ts` — test `getPostPreview`. [Task 1]
- **Modify** `apps/crm/src/pages/entregas/components/CalendarGrid.tsx` — selectable keyboard-button pills, handle-based drag, overflow popover, export lock consts. [Task 3]
- **Modify** `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx` — selection state, derive from `scheduledPosts`, reschedule/remove handlers, render panel, thread `membros`/`onOpenPost`. [Task 4]
- **Modify** `apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx` — integration tests. [Task 4]
- **Modify** `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` — pass `membros` + `onOpenPost`. [Task 5]
- **Modify** `apps/crm/style.css` — panel/popover/selected-pill/responsive styles. [Task 6]

---

## Task 1: `getPostPreview` store function

**Files:**
- Modify: `apps/crm/src/store/posts.ts` (add after `getClientePosts`, ~line 70)
- Test: `apps/crm/src/__tests__/store.posts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PostPreview {
    conteudo_plain: string;
    responsavel_id: number | null;
    ig_caption: string | null;
    published_at: string | null;
    instagram_permalink: string | null;
  }
  export async function getPostPreview(postId: number): Promise<PostPreview>;
  ```
  Exported transitively via `apps/crm/src/store/index.ts` (`export * from './posts'`), so consumers import from `@/store`.

- [ ] **Step 1: Write the failing test**

Add inside the `describe('store workflow posts', …)` block in `apps/crm/src/__tests__/store.posts.test.ts`:

```ts
it('getPostPreview selects detail fields by id', async () => {
  mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
    data: {
      conteudo_plain: 'Texto do post',
      responsavel_id: 9,
      ig_caption: 'Legenda IG',
      published_at: null,
      instagram_permalink: null,
    },
    error: null,
  });

  const preview = await store.getPostPreview(100);

  expect(preview).toEqual({
    conteudo_plain: 'Texto do post',
    responsavel_id: 9,
    ig_caption: 'Legenda IG',
    published_at: null,
    instagram_permalink: null,
  });
  const call = getCalls('workflow_posts', 'select').at(-1)!;
  expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 100] });
});

it('getPostPreview coerces nulls to safe defaults', async () => {
  mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
    data: {
      conteudo_plain: null,
      responsavel_id: null,
      ig_caption: null,
      published_at: null,
      instagram_permalink: null,
    },
    error: null,
  });

  const preview = await store.getPostPreview(7);
  expect(preview.conteudo_plain).toBe('');
  expect(preview.responsavel_id).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- store.posts`
Expected: FAIL — `store.getPostPreview is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `apps/crm/src/store/posts.ts`, add immediately after the `getClientePosts` function (after its closing `}` near line 70):

```ts
export interface PostPreview {
  conteudo_plain: string;
  responsavel_id: number | null;
  ig_caption: string | null;
  published_at: string | null;
  instagram_permalink: string | null;
}

/**
 * Detail fields for a single post, lazy-loaded by the calendar detail panel.
 * RLS scopes by conta_id; no explicit conta filter needed (mirrors updateWorkflowPost).
 */
export async function getPostPreview(postId: number): Promise<PostPreview> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('conteudo_plain, responsavel_id, ig_caption, published_at, instagram_permalink')
    .eq('id', postId)
    .single();
  if (error) throw error;
  return {
    conteudo_plain: data.conteudo_plain ?? '',
    responsavel_id: data.responsavel_id ?? null,
    ig_caption: data.ig_caption ?? null,
    published_at: data.published_at ?? null,
    instagram_permalink: data.instagram_permalink ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- store.posts`
Expected: PASS (both new tests + existing).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/posts.ts apps/crm/src/__tests__/store.posts.test.ts
git commit -m "feat(calendar): add getPostPreview store fn for post detail panel"
```

---

## Task 2: `CalendarPostDetailPanel` component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `getPostPreview` (Task 1); `listPostMedia` from `@/services/postMedia`; `ClientePost`, `Membro` from `@/store`; `DateTimePicker`; postLabels helpers.
- Produces:
  ```ts
  export interface CalendarPostDetailPanelProps {
    post: ClientePost;
    membros: Membro[];
    isCurrentWorkflow: boolean;
    isLocked: boolean;
    lockReason?: string;
    onClose: () => void;
    onReschedule: (date: Date) => void;
    onRemoveDate: () => void;
    onOpenPost: () => void;
  }
  export function CalendarPostDetailPanel(props: CalendarPostDetailPanelProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarPostDetailPanel } from '../CalendarPostDetailPanel';
import type { ClientePost } from '@/store';

// Full mock (NOT partial) so the real @/store → supabase client is never loaded
// in jsdom. ClientePost is a type-only import below, so it's erased at runtime
// and doesn't need to be provided by the mock.
vi.mock('@/store', () => ({ getPostPreview: vi.fn() }));
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn() }));

import { getPostPreview } from '@/store';
import { listPostMedia } from '@/services/postMedia';

const mockPreview = vi.mocked(getPostPreview);
const mockMedia = vi.mocked(listPostMedia);

beforeAll(() => {
  // Radix Popover (used by DateTimePicker) needs these in jsdom
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const post: ClientePost = {
  id: 1,
  workflow_id: 10,
  titulo: 'Bastidores do consultório',
  tipo: 'reels',
  status: 'aprovado_cliente',
  scheduled_at: '2026-07-26T23:00:00.000Z',
  ordem: 0,
  workflow_titulo: 'Posts Julho - Marina',
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof CalendarPostDetailPanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CalendarPostDetailPanel
        post={post}
        membros={[{ id: 9, nome: 'Débora Kristin' } as never]}
        isCurrentWorkflow
        isLocked={false}
        onClose={vi.fn()}
        onReschedule={vi.fn()}
        onRemoveDate={vi.fn()}
        onOpenPost={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe('CalendarPostDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreview.mockResolvedValue({
      conteudo_plain: 'Olá! Hoje vamos falar sobre a rotina.',
      responsavel_id: 9,
      ig_caption: null,
      published_at: null,
      instagram_permalink: null,
    });
    mockMedia.mockResolvedValue([]);
  });

  it('renders the title and metadata instantly from the post prop', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Bastidores do consultório' })).toBeTruthy();
    expect(screen.getByText('Posts Julho - Marina')).toBeTruthy();
  });

  it('shows reschedule + actions for current-workflow unlocked posts', async () => {
    renderPanel();
    expect(screen.getByText('Reagendar')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Abrir post completo/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Remover data/ })).toBeTruthy();
    expect(await screen.findByText('Débora Kristin')).toBeTruthy();
  });

  it('is read-only with a workflow note for other-workflow posts', () => {
    renderPanel({ isCurrentWorkflow: false });
    expect(screen.getByText(/Pertence ao workflow/)).toBeTruthy();
    expect(screen.queryByText('Reagendar')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remover data/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Abrir post completo/ })).toBeNull();
  });

  it('hides reschedule/remove and shows the lock reason for locked posts', () => {
    renderPanel({ isLocked: true, lockReason: 'Post já agendado no Instagram' });
    expect(screen.queryByText('Reagendar')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remover data/ })).toBeNull();
    expect(screen.getByText(/Post já agendado no Instagram/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- CalendarPostDetailPanel`
Expected: FAIL — cannot find module `../CalendarPostDetailPanel`.

- [ ] **Step 3: Write the component**

Create `apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { parseISO, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  X,
  Calendar as CalendarIcon,
  Folder,
  User,
  ExternalLink,
  Trash2,
  Lock,
  Film,
  Image as ImageIcon,
} from 'lucide-react';
import { getPostPreview, type ClientePost, type Membro } from '@/store';
import { listPostMedia } from '@/services/postMedia';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { sanitizeUrl } from '@/utils/security';
import {
  TIPO_LABELS,
  getPostPublishState,
  PUBLISH_STATE_LABELS,
  PUBLISH_STATE_CLASS,
} from '../postLabels';

const TIPO_COLORS: Record<ClientePost['tipo'], string> = {
  feed: '#eab308',
  reels: '#E1306C',
  stories: '#42c8f5',
  carrossel: '#3ecf8e',
};

export interface CalendarPostDetailPanelProps {
  post: ClientePost;
  membros: Membro[];
  isCurrentWorkflow: boolean;
  isLocked: boolean;
  lockReason?: string;
  onClose: () => void;
  onReschedule: (date: Date) => void;
  onRemoveDate: () => void;
  onOpenPost: () => void;
}

export function CalendarPostDetailPanel({
  post,
  membros,
  isCurrentWorkflow,
  isLocked,
  lockReason,
  onClose,
  onReschedule,
  onRemoveDate,
  onOpenPost,
}: CalendarPostDetailPanelProps) {
  const { data: preview } = useQuery({
    queryKey: ['post-preview', post.id],
    queryFn: () => getPostPreview(post.id),
  });

  const { data: media = [] } = useQuery({
    queryKey: ['post-media', post.id],
    queryFn: () => listPostMedia(post.id),
  });

  const cover = media.find((m) => m.is_cover) ?? media[0] ?? null;
  const thumbUrl = cover?.thumbnail_url ?? cover?.url ?? null;

  const responsavel =
    preview?.responsavel_id != null
      ? (membros.find((m) => m.id === preview.responsavel_id)?.nome ?? null)
      : null;

  const pubState = getPostPublishState(post);
  const scheduled = post.scheduled_at ? parseISO(post.scheduled_at) : null;
  const excerpt = (preview?.conteudo_plain ?? '').trim();
  const canEdit = isCurrentWorkflow && !isLocked;
  const permalink =
    post.status === 'postado' && preview?.instagram_permalink
      ? sanitizeUrl(preview.instagram_permalink)
      : null;

  return (
    <aside className="calendar-detail-panel" role="dialog" aria-label="Detalhes do post">
      <div className="calendar-detail-head">
        <div className="calendar-detail-head-info">
          <span className="calendar-detail-eyebrow">Detalhes do post</span>
          <span className="post-tipo-badge">{TIPO_LABELS[post.tipo]}</span>
          <h3 className="calendar-detail-title">{post.titulo || 'Post sem título'}</h3>
        </div>
        <button
          className="calendar-detail-close"
          onClick={onClose}
          title="Fechar"
          aria-label="Fechar painel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="calendar-detail-body">
        <span className={`post-status-chip ${PUBLISH_STATE_CLASS[pubState]}`}>
          {PUBLISH_STATE_LABELS[pubState]}
        </span>

        <div className="calendar-detail-meta">
          <div className="calendar-detail-meta-row">
            <CalendarIcon className="h-4 w-4" />
            <span className="calendar-detail-mono">
              {scheduled
                ? format(scheduled, "dd MMM yyyy '·' HH:mm", { locale: ptBR })
                : 'A definir'}
            </span>
          </div>
          <div className="calendar-detail-meta-row">
            <Folder className="h-4 w-4" />
            <span>{post.workflow_titulo}</span>
          </div>
          <div className="calendar-detail-meta-row">
            <User className="h-4 w-4" />
            <span>{responsavel ?? 'Sem responsável'}</span>
          </div>
        </div>

        <div className="calendar-detail-section">
          <div className="calendar-detail-section-label">Conteúdo</div>
          <div className="calendar-detail-preview">
            {thumbUrl ? (
              <img className="calendar-detail-thumb" src={thumbUrl} alt="" />
            ) : (
              <div
                className="calendar-detail-thumb calendar-detail-thumb--empty"
                style={{ background: TIPO_COLORS[post.tipo] }}
              >
                {post.tipo === 'reels' ? (
                  <Film className="h-5 w-5" />
                ) : (
                  <ImageIcon className="h-5 w-5" />
                )}
              </div>
            )}
            <p className="calendar-detail-excerpt">{excerpt || 'Sem conteúdo ainda.'}</p>
          </div>
          {preview?.ig_caption ? (
            <div className="calendar-detail-caption">
              <div className="calendar-detail-section-label">Legenda</div>
              <p>{preview.ig_caption}</p>
            </div>
          ) : null}
        </div>

        {!isCurrentWorkflow && (
          <div className="calendar-detail-note">Pertence ao workflow «{post.workflow_titulo}»</div>
        )}

        {canEdit && (
          <div className="calendar-detail-section">
            <div className="calendar-detail-section-label">Reagendar</div>
            <DateTimePicker
              value={scheduled ?? undefined}
              onChange={(date) => date && onReschedule(date)}
              futureOnly
              className="w-full"
            />
          </div>
        )}

        {isCurrentWorkflow && isLocked && lockReason && (
          <div className="calendar-detail-note calendar-detail-note--lock">
            <Lock className="h-3.5 w-3.5" /> {lockReason}
          </div>
        )}
      </div>

      <div className="calendar-detail-foot">
        {permalink && (
          <a
            className="calendar-detail-btn calendar-detail-btn--primary"
            href={permalink}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4" /> Ver no Instagram
          </a>
        )}
        {isCurrentWorkflow && (
          <button className="calendar-detail-btn calendar-detail-btn--primary" onClick={onOpenPost}>
            <ExternalLink className="h-4 w-4" /> Abrir post completo
          </button>
        )}
        {canEdit && (
          <button className="calendar-detail-btn calendar-detail-btn--danger" onClick={onRemoveDate}>
            <Trash2 className="h-4 w-4" /> Remover data
          </button>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- CalendarPostDetailPanel`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx apps/crm/src/pages/entregas/components/__tests__/CalendarPostDetailPanel.test.tsx
git commit -m "feat(calendar): add CalendarPostDetailPanel component"
```

---

## Task 3: Selectable, keyboard-accessible pills + overflow popover

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/CalendarGrid.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/CalendarGrid.test.tsx`

**Interfaces:**
- Consumes: `ClientePost` from `@/store/posts`; Radix `Popover`/`PopoverTrigger`/`PopoverContent`; `TIPO_LABELS` already local.
- Produces (new/changed exports + props):
  ```ts
  export const LOCKED_STATUSES: Set<string>;          // {'agendado','postado','falha_publicacao'}
  export const LOCKED_TOOLTIPS: Record<string, string>;
  interface CalendarGridProps {                        // adds:
    selectedPostId: number | null;
    onSelectPost: (post: ClientePost) => void;
    // existing: currentMonth, scheduledPosts, currentWorkflowId, onMonthChange
  }
  ```
  Behavior: each pill is `role="button"`, focusable, Enter/Space + click → `onSelectPost(post)`; drag is on the grip handle only; `+N mais` opens a Radix popover listing every post that day, each row → `onSelectPost(post)`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/CalendarGrid.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { CalendarGrid } from '../CalendarGrid';
import type { ClientePost } from '@/store/posts';

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    setActivatorNodeRef: () => {},
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const month = new Date(2026, 5, 1); // June 2026

function mkPost(over: Partial<ClientePost> & Pick<ClientePost, 'id' | 'titulo'>): ClientePost {
  return {
    workflow_id: 10,
    tipo: 'reels',
    status: 'rascunho',
    scheduled_at: '2026-06-15T13:00:00.000Z',
    ordem: 0,
    workflow_titulo: 'WF',
    ...over,
  };
}

describe('CalendarGrid pills', () => {
  it('renders pills as buttons and selects on click', () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 1, titulo: 'Post B' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={onSelect}
        onMonthChange={() => {}}
      />,
    );
    const pill = screen.getByRole('button', { name: /Post B/ });
    fireEvent.click(pill);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('selects on Enter keydown', () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[mkPost({ id: 1, titulo: 'Post B' })]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={onSelect}
        onMonthChange={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: /Post B/ }), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('exposes overflow posts via a selectable +N mais popover', async () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        currentMonth={month}
        scheduledPosts={[
          mkPost({ id: 1, titulo: 'Visible 1' }),
          mkPost({ id: 2, titulo: 'Visible 2' }),
          mkPost({ id: 3, titulo: 'Hidden Three' }),
        ]}
        currentWorkflowId={10}
        selectedPostId={null}
        onSelectPost={onSelect}
        onMonthChange={() => {}}
      />,
    );
    const moreBtn = screen.getByRole('button', { name: /\+1 mais/ });
    fireEvent.click(moreBtn);
    const row = await screen.findByRole('button', { name: /Hidden Three/ });
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- CalendarGrid`
Expected: FAIL — `CalendarGrid` requires `selectedPostId`/`onSelectPost` (type error) and pills are not buttons / `+N mais` is not a button.

- [ ] **Step 3: Rewrite `CalendarGrid.tsx`**

Replace the entire contents of `apps/crm/src/pages/entregas/components/CalendarGrid.tsx` with:

```tsx
import type { KeyboardEvent } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { parseISO, format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { GripVertical, Lock } from 'lucide-react';
import { MonthGrid } from '@/components/ui/month-grid';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { ClientePost } from '@/store/posts';

const TIPO_COLORS: Record<string, string> = {
  feed: '#eab308',
  reels: '#E1306C',
  stories: '#42c8f5',
  carrossel: '#3ecf8e',
};
const TIPO_LABELS: Record<string, string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};
export const LOCKED_STATUSES = new Set(['agendado', 'postado', 'falha_publicacao']);
export const LOCKED_TOOLTIPS: Record<string, string> = {
  agendado: 'Post já agendado no Instagram — cancele o agendamento para mover',
  postado: 'Post já publicado',
  falha_publicacao: 'Post com falha de publicação — resolva o erro antes de reagendar',
};

interface CalendarGridProps {
  currentMonth: Date;
  scheduledPosts: ClientePost[];
  currentWorkflowId: number;
  selectedPostId: number | null;
  onSelectPost: (post: ClientePost) => void;
  onMonthChange: (date: Date) => void;
}

function PostPill({
  post,
  currentWorkflowId,
  isSelected,
  onSelect,
}: {
  post: ClientePost;
  currentWorkflowId: number;
  isSelected: boolean;
  onSelect: (post: ClientePost) => void;
}) {
  const isCurrentWorkflow = post.workflow_id === currentWorkflowId;
  const isLocked = LOCKED_STATUSES.has(post.status);
  const canDrag = isCurrentWorkflow && !isLocked;

  // We deliberately omit dnd's `attributes` (role/aria/tabIndex): the pill body owns
  // button semantics; only the handle carries the drag `listeners` (incl. the keyboard
  // sensor), so keyboard-select (pill) and keyboard-drag (handle) never collide.
  const { listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `post-${post.id}`,
    data: { post },
    disabled: !canDrag,
  });

  const time = post.scheduled_at ? format(parseISO(post.scheduled_at), 'HH:mm') : '';
  const color = isCurrentWorkflow ? '#eab308' : '#3ecf8e';
  const tooltip = isLocked
    ? LOCKED_TOOLTIPS[post.status] || ''
    : `${TIPO_LABELS[post.tipo]} · ${time} · ${post.workflow_titulo}${!isCurrentWorkflow ? ' (outro workflow)' : ''}`;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(post);
    }
  };

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${TIPO_LABELS[post.tipo]} — ${post.titulo || 'Post sem título'}${time ? ` — ${time}` : ''}`}
      className={`calendar-post-pill${isSelected ? ' selected' : ''}`}
      style={{
        background: color,
        opacity: isDragging ? 0.4 : isLocked ? 0.6 : isCurrentWorkflow ? 1 : 0.8,
        cursor: 'pointer',
      }}
      title={tooltip}
      onClick={() => onSelect(post)}
      onKeyDown={handleKeyDown}
    >
      {isLocked && <Lock className="h-2.5 w-2.5" style={{ flexShrink: 0 }} />}
      {canDrag && (
        <span
          ref={setActivatorNodeRef}
          className="calendar-pill-handle"
          tabIndex={0}
          aria-label="Mover post (arraste, ou foque e use as setas)"
          style={{ display: 'inline-flex', cursor: 'grab' }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          {...listeners}
        >
          <GripVertical className="h-2.5 w-2.5" style={{ flexShrink: 0, opacity: 0.7 }} />
        </span>
      )}
      <span className="pill-text">
        {TIPO_LABELS[post.tipo]} · {time}
      </span>
    </div>
  );
}

function DayPostsPopover({
  date,
  posts,
  overflow,
  currentWorkflowId,
  onSelectPost,
}: {
  date: Date;
  posts: ClientePost[];
  overflow: number;
  currentWorkflowId: number;
  onSelectPost: (post: ClientePost) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="cell-overflow" onClick={(e) => e.stopPropagation()}>
          +{overflow} mais
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="calendar-day-popover">
        <div className="calendar-day-popover-title">
          {format(date, "dd 'de' MMMM", { locale: ptBR })}
        </div>
        <div className="calendar-day-popover-list">
          {posts.map((post) => {
            const time = post.scheduled_at ? format(parseISO(post.scheduled_at), 'HH:mm') : '';
            const dot = post.workflow_id === currentWorkflowId ? '#eab308' : '#3ecf8e';
            return (
              <button
                key={post.id}
                type="button"
                className="calendar-day-popover-row"
                onClick={() => onSelectPost(post)}
              >
                <span className="calendar-day-popover-dot" style={{ background: dot }} />
                <span className="calendar-day-popover-tipo">{TIPO_LABELS[post.tipo]}</span>
                <span className="calendar-day-popover-row-title">
                  {post.titulo || 'Post sem título'}
                </span>
                <span className="calendar-day-popover-time">{time}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DroppableCell({
  date,
  isCurrentMonth,
  posts,
  currentWorkflowId,
  selectedPostId,
  onSelectPost,
}: {
  date: Date;
  isCurrentMonth: boolean;
  posts: ClientePost[];
  currentWorkflowId: number;
  selectedPostId: number | null;
  onSelectPost: (post: ClientePost) => void;
}) {
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const { setNodeRef, isOver } = useDroppable({ id: `date-${dateStr}` });

  const today = new Date();
  const isToday = isSameDay(date, today);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const maxVisible = 2;
  const visiblePosts = posts.slice(0, maxVisible);
  const overflow = posts.length - maxVisible;

  return (
    <div
      ref={setNodeRef}
      className={`calendar-cell ${!isCurrentMonth ? 'out-of-month' : ''} ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''}`}
      style={{
        border: isOver ? '2px dashed rgba(234, 179, 8, 0.4)' : undefined,
        boxShadow: isOver ? '0 0 12px rgba(234, 179, 8, 0.12)' : undefined,
      }}
    >
      <div
        className="cell-day-number"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right' }}
      >
        {date.getDate()}
      </div>
      <div className="cell-posts">
        {visiblePosts.map((post) => (
          <PostPill
            key={post.id}
            post={post}
            currentWorkflowId={currentWorkflowId}
            isSelected={selectedPostId === post.id}
            onSelect={onSelectPost}
          />
        ))}
        {overflow > 0 && (
          <DayPostsPopover
            date={date}
            posts={posts}
            overflow={overflow}
            currentWorkflowId={currentWorkflowId}
            onSelectPost={onSelectPost}
          />
        )}
      </div>
      {isOver && <div className="cell-drop-hint">Soltar aqui</div>}
    </div>
  );
}

export function CalendarGrid({
  currentMonth,
  scheduledPosts,
  currentWorkflowId,
  selectedPostId,
  onSelectPost,
  onMonthChange,
}: CalendarGridProps) {
  return (
    <MonthGrid
      currentMonth={currentMonth}
      onMonthChange={onMonthChange}
      renderCell={(date, isCurrentMonth) => {
        const dayPosts = scheduledPosts.filter((p) => {
          if (!p.scheduled_at) return false;
          const postDate = parseISO(p.scheduled_at);
          return isSameDay(postDate, date);
        });
        return (
          <DroppableCell
            date={date}
            isCurrentMonth={isCurrentMonth}
            posts={dayPosts}
            currentWorkflowId={currentWorkflowId}
            selectedPostId={selectedPostId}
            onSelectPost={onSelectPost}
          />
        );
      }}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- CalendarGrid`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/CalendarGrid.tsx apps/crm/src/pages/entregas/components/__tests__/CalendarGrid.test.tsx
git commit -m "feat(calendar): selectable keyboard-accessible pills + overflow popover"
```

---

## Task 4: Wire selection + panel into `WorkflowCalendarView`

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx`

**Interfaces:**
- Consumes: `CalendarPostDetailPanel` (Task 2); `LOCKED_STATUSES`, `LOCKED_TOOLTIPS`, `CalendarGrid` (Task 3); `Membro` from `@/store`.
- Produces (new optional props on `WorkflowCalendarViewProps`):
  ```ts
  membros?: Membro[];
  onOpenPost?: (postId: number) => void;
  ```

- [ ] **Step 1: Write the failing tests**

In `apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx`:

1. Extend the `@dnd-kit/core` mock's `useDraggable` to include `setActivatorNodeRef`:

```tsx
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    setActivatorNodeRef: () => {},
    isDragging: false,
  }),
```

2. Extend the `@/store` mock and add a `@/services/postMedia` mock + Radix jsdom shims. Replace the existing `vi.mock('@/store', …)` block and imports with:

```tsx
vi.mock('@/store', () => ({
  getClientePosts: vi.fn(),
  updateWorkflowPost: vi.fn(),
  getPostPreview: vi.fn(),
}));
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn() }));

import { getClientePosts, updateWorkflowPost, getPostPreview } from '@/store';
import { listPostMedia } from '@/services/postMedia';
const mockGetClientePosts = vi.mocked(getClientePosts);
const mockUpdate = vi.mocked(updateWorkflowPost);
const mockPreview = vi.mocked(getPostPreview);
const mockMedia = vi.mocked(listPostMedia);

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});
```

Add `beforeAll` to the vitest import. In the existing `beforeEach`, add default resolves:

```tsx
    mockPreview.mockResolvedValue({
      conteudo_plain: 'Conteúdo',
      responsavel_id: null,
      ig_caption: null,
      published_at: null,
      instagram_permalink: null,
    });
    mockMedia.mockResolvedValue([]);
    mockUpdate.mockResolvedValue({} as never);
```

3. Append these tests inside the `describe`:

```tsx
it('opens the detail panel with the post title when a pill is clicked', async () => {
  mockGetClientePosts.mockResolvedValue([
    {
      id: 2,
      workflow_id: 10,
      titulo: 'Post Agendado B',
      tipo: 'reels',
      status: 'aprovado_cliente',
      scheduled_at: '2026-06-15T13:00:00.000Z',
      ordem: 0,
      workflow_titulo: 'Campanha Junho',
    },
  ]);
  renderWithQuery(<WorkflowCalendarView {...baseProps} />);
  const pill = await screen.findByRole('button', { name: /Post Agendado B/ });
  fireEvent.click(pill);
  expect(await screen.findByRole('heading', { name: 'Post Agendado B' })).toBeTruthy();
});

it('shows a read-only note for other-workflow posts', async () => {
  mockGetClientePosts.mockResolvedValue([
    {
      id: 3,
      workflow_id: 99,
      titulo: 'Outro WF',
      tipo: 'feed',
      status: 'aprovado_cliente',
      scheduled_at: '2026-06-15T13:00:00.000Z',
      ordem: 0,
      workflow_titulo: 'Outra Campanha',
    },
  ]);
  renderWithQuery(<WorkflowCalendarView {...baseProps} />);
  fireEvent.click(await screen.findByRole('button', { name: /Outro WF/ }));
  expect(await screen.findByText(/Pertence ao workflow/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Remover data/ })).toBeNull();
});

it('closes the panel after removing the date', async () => {
  mockGetClientePosts.mockResolvedValue([
    {
      id: 2,
      workflow_id: 10,
      titulo: 'Post Agendado B',
      tipo: 'reels',
      status: 'aprovado_cliente',
      scheduled_at: '2026-06-15T13:00:00.000Z',
      ordem: 0,
      workflow_titulo: 'Campanha Junho',
    },
  ]);
  renderWithQuery(<WorkflowCalendarView {...baseProps} />);
  fireEvent.click(await screen.findByRole('button', { name: /Post Agendado B/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Remover data/ }));
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Post Agendado B' })).toBeNull(),
  );
  expect(mockUpdate).toHaveBeenCalledWith(2, { scheduled_at: null });
});

it('closes the panel when the selected post is unscheduled externally', async () => {
  const scheduled = {
    id: 2,
    workflow_id: 10,
    titulo: 'Post Agendado B',
    tipo: 'reels' as const,
    status: 'aprovado_cliente' as const,
    scheduled_at: '2026-06-15T13:00:00.000Z',
    ordem: 0,
    workflow_titulo: 'Campanha Junho',
  };
  mockGetClientePosts.mockResolvedValue([scheduled]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <WorkflowCalendarView {...baseProps} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Post Agendado B/ }));
  expect(await screen.findByRole('heading', { name: 'Post Agendado B' })).toBeTruthy();

  // Simulate a refetch where the post lost its date (now in the "Sem data" sidebar)
  qc.setQueryData(
    ['clientePosts', baseProps.clienteId],
    [{ ...scheduled, scheduled_at: null }],
  );
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Post Agendado B' })).toBeNull(),
  );
});

it('calls onOpenPost from the panel "Abrir post completo" button', async () => {
  const onOpenPost = vi.fn();
  mockGetClientePosts.mockResolvedValue([
    {
      id: 2,
      workflow_id: 10,
      titulo: 'Post Agendado B',
      tipo: 'reels',
      status: 'aprovado_cliente',
      scheduled_at: '2026-06-15T13:00:00.000Z',
      ordem: 0,
      workflow_titulo: 'Campanha Junho',
    },
  ]);
  renderWithQuery(<WorkflowCalendarView {...baseProps} onOpenPost={onOpenPost} />);
  fireEvent.click(await screen.findByRole('button', { name: /Post Agendado B/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Abrir post completo/ }));
  expect(onOpenPost).toHaveBeenCalledWith(2);
});
```

4. Ensure the test file imports `fireEvent`, `waitFor`, `render`, `QueryClient`, `QueryClientProvider` (most already present; add `fireEvent`, `waitFor` to the `@testing-library/react` import).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- WorkflowCalendarView`
Expected: FAIL — pills aren't found as buttons / panel heading not rendered (view not wired yet).

- [ ] **Step 3: Wire the view**

Edit `apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx`:

(a) Update imports. Change the store import line and add new imports:

```tsx
import { getClientePosts, updateWorkflowPost, type ClientePost, type Membro } from '@/store';
import { CalendarGrid, LOCKED_STATUSES, LOCKED_TOOLTIPS } from './CalendarGrid';
import { CalendarPostDetailPanel } from './CalendarPostDetailPanel';
```

(b) Extend the props interface:

```tsx
interface WorkflowCalendarViewProps {
  clienteId: number;
  clienteNome: string;
  currentWorkflowId: number;
  currentWorkflowTitulo: string;
  onBack: () => void;
  membros?: Membro[];
  onOpenPost?: (postId: number) => void;
}
```

and the destructured params:

```tsx
export function WorkflowCalendarView({
  clienteId,
  clienteNome,
  currentWorkflowId,
  currentWorkflowTitulo,
  onBack,
  membros = [],
  onOpenPost,
}: WorkflowCalendarViewProps) {
```

(c) Add selection state next to the other `useState`s (after `activePost`):

```tsx
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
```

(d) After `const scheduledPosts = …` / `const unscheduledPosts = …`, derive the selected post **from `scheduledPosts`** (P1 — so unscheduling auto-closes the panel):

```tsx
  const selectedPost = scheduledPosts.find((p) => p.id === selectedPostId) ?? null;
  const selectedIsCurrentWorkflow = selectedPost?.workflow_id === currentWorkflowId;
  const selectedIsLocked = selectedPost ? LOCKED_STATUSES.has(selectedPost.status) : false;
```

(e) Add reschedule/remove handlers near the other `useCallback`s (after `handleTimeCancel`):

```tsx
  const handlePanelReschedule = useCallback(
    async (datetime: Date) => {
      if (!selectedPostId) return;
      try {
        await updateWorkflowPost(selectedPostId, { scheduled_at: datetime.toISOString() });
        invalidateQueries();
        toast.success(
          `Post reagendado para ${datetime.toLocaleDateString('pt-BR')} às ${String(datetime.getHours()).padStart(2, '0')}:${String(datetime.getMinutes()).padStart(2, '0')}`,
        );
      } catch {
        toast.error('Erro ao reagendar post');
      }
    },
    [selectedPostId, invalidateQueries],
  );

  const handlePanelRemoveDate = useCallback(async () => {
    if (!selectedPostId) return;
    const id = selectedPostId;
    setSelectedPostId(null);
    try {
      await updateWorkflowPost(id, { scheduled_at: null });
      invalidateQueries();
      toast.success('Data removida do post');
    } catch {
      toast.error('Erro ao remover data do post');
    }
  }, [selectedPostId, invalidateQueries]);
```

(f) Replace the existing `.calendar-content` block (the `<div className="calendar-content">` that wraps `UnscheduledPostsSidebar` + `.calendar-grid-container`) with the version below: it adds the `--with-panel` modifier, passes the new `CalendarGrid` props, and renders the panel as a third sibling.

```tsx
        <div className={`calendar-content${selectedPost ? ' calendar-content--with-panel' : ''}`}>
          <UnscheduledPostsSidebar posts={unscheduledPosts} currentWorkflowId={currentWorkflowId} />
          <div className="calendar-grid-container">
            <CalendarGrid
              currentMonth={currentMonth}
              scheduledPosts={scheduledPosts}
              currentWorkflowId={currentWorkflowId}
              selectedPostId={selectedPostId}
              onSelectPost={(post) => setSelectedPostId(post.id)}
              onMonthChange={setCurrentMonth}
            />
          </div>
          {selectedPost && (
            <CalendarPostDetailPanel
              key={selectedPost.id}
              post={selectedPost}
              membros={membros}
              isCurrentWorkflow={selectedIsCurrentWorkflow}
              isLocked={selectedIsLocked}
              lockReason={selectedIsLocked ? LOCKED_TOOLTIPS[selectedPost.status] : undefined}
              onClose={() => setSelectedPostId(null)}
              onReschedule={handlePanelReschedule}
              onRemoveDate={handlePanelRemoveDate}
              onOpenPost={() => onOpenPost?.(selectedPost.id)}
            />
          )}
        </div>
```

(Leave the existing `DragOverlay` and `TimePickerPopover` blocks unchanged. `clienteNome`/`currentWorkflowTitulo` remain referenced as today.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- WorkflowCalendarView`
Expected: PASS (existing + 5 new tests).

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: `tsc` + `vite build` succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowCalendarView.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowCalendarView.test.tsx
git commit -m "feat(calendar): wire post detail panel into WorkflowCalendarView"
```

---

## Task 5: Pass `membros` + `onOpenPost` from `WorkflowDrawer`

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (the `WorkflowCalendarView` render, ~lines 607-614)

**Interfaces:**
- Consumes: `WorkflowCalendarView` optional props `membros` + `onOpenPost` (Task 4). `membros`, `setShowCalendar`, `setExpandedId` already exist in `WorkflowDrawer`.

- [ ] **Step 1: Add the props**

In `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`, replace the `<WorkflowCalendarView … />` element with:

```tsx
            <WorkflowCalendarView
              clienteId={clienteId}
              clienteNome={card.cliente?.nome || '—'}
              currentWorkflowId={workflowId}
              currentWorkflowTitulo={card.workflow.titulo}
              membros={membros}
              onOpenPost={(postId) => {
                setShowCalendar(false);
                setExpandedId(postId);
              }}
              onBack={() => setShowCalendar(false)}
            />
```

- [ ] **Step 2: Typecheck + full test run**

Run: `npm run build && npm run test`
Expected: both pass. (No new dedicated test: `onOpenPost`'s call path is covered by Task 4's spy test; the drawer-side wiring is pure prop passing verified by `tsc`. `EntregasPage.test.tsx` mocks `WorkflowDrawer`, so it's unaffected.)

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open a workflow → Calendário → click a scheduled post of the current workflow → "Abrir post completo" returns to the Posts list with that post expanded.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat(calendar): pass membros + onOpenPost to WorkflowCalendarView"
```

---

## Task 6: Styles (panel, popover, selected pill, responsive)

**Files:**
- Modify: `apps/crm/style.css` (append after the calendar block, e.g. after the `.cell-drop-hint` rule ~line 6720)

**Interfaces:**
- Consumes: class names emitted by Tasks 2-4 (`calendar-detail-*`, `calendar-day-popover-*`, `calendar-post-pill.selected`, `calendar-pill-handle`, `calendar-content--with-panel`).

- [ ] **Step 1: Append the CSS**

Add to `apps/crm/style.css`:

```css
/* ── Calendar detail panel ─────────────────────────────────────── */
.calendar-content { position: relative; }

.calendar-detail-panel {
  width: 330px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-color);
  background: var(--surface-main);
  display: flex;
  flex-direction: column;
  animation: calendarDetailSlideIn 0.22s ease;
}
@keyframes calendarDetailSlideIn {
  from { transform: translateX(14px); opacity: 0; }
  to   { transform: none; opacity: 1; }
}

.calendar-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}
.calendar-detail-eyebrow {
  display: block;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  font-size: 0.6rem;
  font-weight: 700;
  color: var(--text-muted);
}
.calendar-detail-head .post-tipo-badge { margin-top: 6px; }
.calendar-detail-title {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.3;
  margin-top: 8px;
  color: var(--text-main);
}
.calendar-detail-close {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  background: var(--surface-light);
  border-radius: 7px;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.calendar-detail-close:hover { background: var(--surface-hover); }

.calendar-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.calendar-detail-meta { display: flex; flex-direction: column; gap: 9px; }
.calendar-detail-meta-row {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 0.8rem;
  color: var(--text-main);
}
.calendar-detail-meta-row svg { color: var(--text-muted); flex-shrink: 0; }
.calendar-detail-mono { font-family: var(--font-mono); font-size: 0.76rem; }

.calendar-detail-section-label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.58rem;
  font-weight: 700;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.calendar-detail-preview { display: flex; gap: 11px; }
.calendar-detail-thumb {
  width: 74px;
  height: 74px;
  border-radius: 9px;
  flex-shrink: 0;
  object-fit: cover;
}
.calendar-detail-thumb--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.calendar-detail-excerpt {
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.calendar-detail-caption { margin-top: 10px; }
.calendar-detail-caption p {
  font-size: 0.76rem;
  line-height: 1.5;
  color: var(--text-muted);
  white-space: pre-wrap;
}

.calendar-detail-note {
  font-size: 0.74rem;
  color: var(--text-muted);
  background: var(--surface-hover);
  border-radius: 8px;
  padding: 9px 11px;
}
.calendar-detail-note--lock {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--warning);
  background: rgba(245, 163, 66, 0.1);
}

.calendar-detail-foot {
  border-top: 1px solid var(--border-color);
  padding: 13px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.calendar-detail-btn {
  width: 100%;
  border-radius: 8px;
  padding: 9px 12px;
  font-family: var(--font-main);
  font-weight: 600;
  font-size: 0.78rem;
  cursor: pointer;
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  text-decoration: none;
}
.calendar-detail-btn--primary { background: var(--primary-color); color: #1a1505; }
.calendar-detail-btn--primary:hover { background: var(--primary-hover); }
.calendar-detail-btn--danger {
  background: var(--surface-light);
  border-color: rgba(245, 90, 66, 0.4);
  color: var(--danger);
}
.calendar-detail-btn--danger:hover { background: rgba(245, 90, 66, 0.08); }

/* Selected pill + keyboard focus ring */
.calendar-post-pill.selected,
.calendar-post-pill:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
  box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.18);
}
.calendar-pill-handle { border: none; background: transparent; padding: 0; }
.calendar-pill-handle:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
}

/* Overflow "+N mais" day popover */
.cell-overflow {
  border: none;
  background: transparent;
  width: 100%;
  cursor: pointer;
}
.cell-overflow:hover { color: var(--primary-color); }
.calendar-day-popover { width: 260px; padding: 8px; }
.calendar-day-popover-title {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 4px 6px 8px;
}
.calendar-day-popover-list { display: flex; flex-direction: column; gap: 2px; }
.calendar-day-popover-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 7px 8px;
  cursor: pointer;
  text-align: left;
}
.calendar-day-popover-row:hover { background: var(--surface-hover); }
.calendar-day-popover-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.calendar-day-popover-tipo {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  flex-shrink: 0;
}
.calendar-day-popover-row-title {
  font-size: 0.74rem;
  color: var(--text-main);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calendar-day-popover-time {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* Responsive: below 1024px the detail panel overlays the grid (grid keeps width) */
@media (max-width: 1024px) {
  .calendar-detail-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(360px, 90%);
    border-left: 1px solid var(--border-color);
    box-shadow: -12px 0 32px -16px rgba(0, 0, 0, 0.35);
    z-index: 5;
  }
}
```

- [ ] **Step 2: Verify build + visual**

Run: `npm run build`
Expected: success.
Manual: `npm run dev` → open a workflow → Calendário → click pills (wide window = docked column; narrow window <1024px = right overlay); confirm selected ring, popover, reschedule, remove-date, read-only note for green pills.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/style.css
git commit -m "feat(calendar): styles for post detail panel, popover, responsive overlay"
```

---

## Final verification

- [ ] `npm run build` — passes.
- [ ] `npm run test` — all green (Tasks 1-4 suites + existing).
- [ ] Prettier + eslint clean (CI gates): `npx prettier --check .` (or the repo's `format:check`) and the lint script.
- [ ] Manual smoke (per Task 5/6): click pill → panel; reschedule; remove date closes panel; overflow popover selects; green pill read-only; "Abrir post completo" returns to expanded post.

---

## Notes on key decisions (for the implementer)

- **P1 (panel auto-close):** `selectedPost` is derived from `scheduledPosts`, NOT `allPosts`. `getClientePosts` returns unscheduled rows too; deriving from `allPosts` would keep the panel open after an unschedule. The Task 4 "unscheduled externally" test guards this.
- **P3 (a11y / drag-vs-select collision):** dnd's `KeyboardSensor` binds Enter/Space on the draggable node. The pill body is the `role="button"` selector (Enter/Space → select); only the `GripVertical` handle (`setActivatorNodeRef`) carries the drag `listeners`, so the two never collide. We intentionally do NOT spread dnd `attributes` on the handle (avoids a nested `role="button"`); the handle gets its own `tabIndex`/`aria-label`.
- **Security:** `instagram_permalink` is external data → wrapped in `sanitizeUrl` before use as `href`.
- **No new list payload:** `getClientePosts` and the `ClientePost` type are unchanged; only the panel lazy-fetches extras.
