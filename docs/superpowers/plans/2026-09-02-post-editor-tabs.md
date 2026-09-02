# Post Editor Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the expanded post editor (PostEditorBody) into five keep-mounted tabs (Conteúdo, Mídia, Propriedades, Publicação, Comentários) and remove the manual cover star, making "first media by sort order" the cover rule.

**Architecture:** A new presentational `PostEditorTabBar` component + hand-written CSS (matching the drawer's existing style.css idiom, NOT Radix Tabs) drives which of five always-mounted panels is visible inside `PostEditorBody`. Panels hide via the `hidden` attribute (with a `[hidden]` CSS override) so the TipTap editor, debounced título saves, and TikTok completeness state survive tab switches. Cover becomes derived: `is_cover` flag if present (legacy/MCP), else first by `sort_order` — the same resolution rule the Hub and post-media-manage backend already use. A migration clears legacy flags.

**Tech Stack:** React 19, TanStack Query, Vitest + Testing Library (jsdom), hand-written CSS in `apps/crm/style.css`, Supabase SQL migration.

**Validated design:** 5-tab model approved by Eduardo via visual mockup on 2026-09-02 (this session). Meta row + warnings stay above the tabs, always visible. Star removal approved in the same session.

## Global Constraints

- UI copy is Portuguese (pt-BR). **Never use em-dashes in user-facing copy** — use period/colon/"·" instead (user feedback: "cara de AI slop").
- Tab labels are hardcoded PT strings, matching the drawer's existing hardcoded labels ("Título", "Tipo", ...). Do not add i18n keys for them.
- Migration filename must use a **unique timestamp version prefix** (digits before the first `_`). Before opening the PR, re-verify against main: `git ls-tree origin/main:supabase/migrations | tail` and renumber above main's tail if needed (CI `migration-version-guard` fails on duplicates).
- Before pushing: `npm run lint`, `npm run format:check`, the four tsc commands (`npx tsc -p apps/crm/tsconfig.json --noEmit`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`, `npm run test:functions`.
- This worktree may lack `node_modules`. If `ls node_modules/.bin/vitest` fails, run `npm ci` INSIDE the worktree first. Never run commands from the main checkout.
- All frontend tests run with `npx vitest run <path>` from the repo worktree root.
- Backend (`post-media-manage` PATCH `is_cover`, Hub, MCP) is intentionally NOT changed. All readers already resolve cover as `is_cover ?? first by sort_order`.

---

### Task 1: PostEditorTabBar component + CSS

**Files:**
- Create: `apps/crm/src/pages/entregas/components/PostEditorTabBar.tsx`
- Modify: `apps/crm/style.css` (insert new block right after `.drawer-post-content` rule, which ends at line 6784)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostEditorTabBar.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (Task 2 relies on these exact names):
  - `export type PostEditorTab = 'conteudo' | 'midia' | 'propriedades' | 'publicacao' | 'comentarios'`
  - `export function PostEditorTabBar(props: { active: PostEditorTab; onChange: (tab: PostEditorTab) => void; mediaCount?: number; commentCount?: number; showProperties: boolean; contentAttention?: boolean; publishAttention?: boolean }): JSX.Element`
  - CSS classes: `.drawer-post-tabs`, `.drawer-post-tab`, `.drawer-post-tab--active`, `.drawer-post-tab-badge`, `.drawer-post-tab-dot`, `.drawer-post-tab-dot--warning`, `.drawer-post-tab-dot--danger`, `.drawer-post-tabpanel`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/PostEditorTabBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostEditorTabBar } from '../PostEditorTabBar';

describe('PostEditorTabBar', () => {
  it('renders the five tabs with the active one selected', () => {
    render(
      <PostEditorTabBar active="conteudo" onChange={vi.fn()} showProperties={true} />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Conteúdo',
      'Mídia',
      'Propriedades',
      'Publicação',
      'Comentários',
    ]);
    expect(screen.getByRole('tab', { name: 'Conteúdo' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Mídia' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('hides the Propriedades tab when showProperties is false', () => {
    render(<PostEditorTabBar active="conteudo" onChange={vi.fn()} showProperties={false} />);
    expect(screen.queryByRole('tab', { name: 'Propriedades' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('shows count badges only when greater than zero', () => {
    render(
      <PostEditorTabBar
        active="conteudo"
        onChange={vi.fn()}
        showProperties={true}
        mediaCount={7}
        commentCount={0}
      />,
    );
    expect(screen.getByRole('tab', { name: /Mídia/ })).toHaveTextContent('7');
    expect(screen.getByRole('tab', { name: 'Comentários' })).not.toHaveTextContent('0');
  });

  it('shows attention dots for content and publish', () => {
    const { container } = render(
      <PostEditorTabBar
        active="conteudo"
        onChange={vi.fn()}
        showProperties={true}
        contentAttention
        publishAttention
      />,
    );
    expect(container.querySelector('.drawer-post-tab-dot--warning')).not.toBeNull();
    expect(container.querySelector('.drawer-post-tab-dot--danger')).not.toBeNull();
  });

  it('calls onChange with the clicked tab key', () => {
    const onChange = vi.fn();
    render(<PostEditorTabBar active="conteudo" onChange={onChange} showProperties={true} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Publicação' }));
    expect(onChange).toHaveBeenCalledWith('publicacao');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostEditorTabBar.test.tsx`
Expected: FAIL — cannot resolve `../PostEditorTabBar`.

- [ ] **Step 3: Write the component**

Create `apps/crm/src/pages/entregas/components/PostEditorTabBar.tsx`:

```tsx
import type { ReactNode } from 'react';
import { FileText, Image as ImageIcon, ListChecks, Send, MessageSquare } from 'lucide-react';

export type PostEditorTab = 'conteudo' | 'midia' | 'propriedades' | 'publicacao' | 'comentarios';

interface PostEditorTabBarProps {
  active: PostEditorTab;
  onChange: (tab: PostEditorTab) => void;
  /** Badge da aba Mídia. Omitido/0 = sem badge. */
  mediaCount?: number;
  /** Badge da aba Comentários (threads abertas). Omitido/0 = sem badge. */
  commentCount?: number;
  /** Post avulso não tem propriedades de template: a aba some inteira. */
  showProperties: boolean;
  /** Ponto âmbar em Conteúdo (sugestão do cliente pendente). */
  contentAttention?: boolean;
  /** Ponto vermelho em Publicação (falha de publicação). */
  publishAttention?: boolean;
}

interface TabDef {
  key: PostEditorTab;
  label: string;
  icon: ReactNode;
  badge?: number;
  dot?: 'warning' | 'danger';
}

export function PostEditorTabBar({
  active,
  onChange,
  mediaCount,
  commentCount,
  showProperties,
  contentAttention,
  publishAttention,
}: PostEditorTabBarProps) {
  const tabs: TabDef[] = [
    {
      key: 'conteudo',
      label: 'Conteúdo',
      icon: <FileText className="h-3.5 w-3.5" />,
      dot: contentAttention ? 'warning' : undefined,
    },
    { key: 'midia', label: 'Mídia', icon: <ImageIcon className="h-3.5 w-3.5" />, badge: mediaCount },
    ...(showProperties
      ? [
          {
            key: 'propriedades',
            label: 'Propriedades',
            icon: <ListChecks className="h-3.5 w-3.5" />,
          } satisfies TabDef,
        ]
      : []),
    {
      key: 'publicacao',
      label: 'Publicação',
      icon: <Send className="h-3.5 w-3.5" />,
      dot: publishAttention ? 'danger' : undefined,
    },
    {
      key: 'comentarios',
      label: 'Comentários',
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      badge: commentCount,
    },
  ];

  return (
    <div className="drawer-post-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`drawer-post-tab${active === t.key ? ' drawer-post-tab--active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.icon}
          {t.label}
          {t.badge != null && t.badge > 0 && (
            <span className="drawer-post-tab-badge">{t.badge}</span>
          )}
          {t.dot && <span className={`drawer-post-tab-dot drawer-post-tab-dot--${t.dot}`} />}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add the CSS**

In `apps/crm/style.css`, insert this block immediately after the `.drawer-post-content { ... }` rule (which ends at line 6784), before `.drawer-post-meta-row`:

```css
.drawer-post-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  border-bottom: 1px solid var(--border-color);
}

.drawer-post-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.6rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  cursor: pointer;
  margin-bottom: -1px;
  transition: color 0.15s;
}

.drawer-post-tab:hover {
  color: var(--text-main);
}

.drawer-post-tab--active {
  color: var(--text-main);
  border-bottom-color: var(--primary-color);
}

.drawer-post-tab-badge {
  font-size: 0.65rem;
  font-weight: 600;
  line-height: 1.5;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
}

.drawer-post-tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.drawer-post-tab-dot--warning {
  background: var(--warning);
}

.drawer-post-tab-dot--danger {
  background: var(--danger);
}

.drawer-post-tabpanel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* Sem esta regra o display:flex acima venceria o atributo hidden no browser
   real e todas as abas apareceriam empilhadas. */
.drawer-post-tabpanel[hidden] {
  display: none;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostEditorTabBar.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
git add apps/crm/src/pages/entregas/components/PostEditorTabBar.tsx apps/crm/src/pages/entregas/components/__tests__/PostEditorTabBar.test.tsx apps/crm/style.css
git commit -m "feat(entregas): barra de abas do editor de post"
```

---

### Task 2: Restructure PostEditorBody into tab panels

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (state near line 178; return block lines 275–606)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.test.tsx` (new)
- Possibly modify: `apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx`, `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx` (see Step 6)

**Interfaces:**
- Consumes from Task 1: `PostEditorTab`, `PostEditorTabBar`, `.drawer-post-tabpanel` CSS class.
- Produces: `PostEditorBodyProps` is UNCHANGED — both drawers (`WorkflowDrawer.tsx:1311`, `StandalonePostDrawer.tsx:485`) keep working without edits.

**Section → tab mapping** (order inside each panel preserved from today's stacking):

| Stays above tabs (always visible) | Conteúdo | Mídia | Propriedades | Publicação | Comentários |
|---|---|---|---|---|---|
| meta row (título/tipo/plataforma/status/responsável/data), `statusAutomationHint`, external-visibility warning | edit-suggestion diff OR `PostEditor`; stories note / `InstagramCaptionField` | `PostMediaGallery` | `PropertyPanel` | `PublishErrorBlock`, `TrialReelPanel`, `TikTokSettingsPanel`, `ScheduleButton`, `PostAutomationSection` | `PostCommentSummary`, approvals thread, reply row |

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.test.tsx`. Follows StandalonePostDrawer.test.tsx's pattern: stub every heavy leaf so only PostEditorBody's own tab logic is exercised.

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostEditorBody, type PostEditorBodyProps } from '../PostEditorBody';
import type { WorkflowPost, PostEditSuggestion } from '../../../../store';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: () => [],
  injectSignedUrls: (c: unknown) => c,
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));

vi.mock('../../../../services/postMedia', () => ({
  listPostMedia: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
}));

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: {}, limits: null, isLoading: false }),
}));

vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return { useStatusRegistry: () => buildStatusRegistry([]) };
});

vi.mock('@/utils/tiptapDiff', () => ({ computeTipTapDiff: vi.fn(() => ({})) }));

vi.mock('../PostEditor', () => ({
  PostEditor: () => <div data-testid="post-editor" />,
}));
vi.mock('../PropertyPanel', () => ({
  PropertyPanel: () => <div data-testid="property-panel" />,
}));
vi.mock('../PostCommentSummary', () => ({
  default: () => <div data-testid="comment-summary" />,
}));
vi.mock('../PostMediaGallery', () => ({
  PostMediaGallery: () => <div data-testid="media-gallery" />,
}));
vi.mock('../InstagramCaptionField', () => ({
  InstagramCaptionField: () => <div data-testid="ig-caption" />,
}));
vi.mock('../PlatformSelector', () => ({
  PlatformSelector: () => <div data-testid="platform-selector" />,
}));
vi.mock('../TikTokSettingsPanel', () => ({
  TikTokSettingsPanel: () => <div data-testid="tiktok-panel" />,
}));
vi.mock('../TrialReelPanel', () => ({
  TrialReelPanel: () => <div data-testid="trial-reel" />,
}));
vi.mock('../ScheduleButton', () => ({
  ScheduleButton: () => <div data-testid="schedule-button" />,
}));
vi.mock('../PostAutomationSection', () => ({
  PostAutomationSection: () => <div data-testid="automation-section" />,
}));
vi.mock('../PublishErrorBlock', () => ({
  PublishErrorBlock: () => <div data-testid="publish-error" />,
}));
vi.mock('../DiffView', () => ({ DiffView: () => <div data-testid="diff-view" /> }));
vi.mock('../ReadOnlyTipTap', () => ({
  ReadOnlyTipTap: () => <div data-testid="readonly-tiptap" />,
}));
vi.mock('@/components/ui/date-time-picker', () => ({
  DateTimePicker: () => <div data-testid="date-picker" />,
}));

const basePost = {
  id: 1,
  titulo: 'Post teste',
  tipo: 'carrossel',
  status: 'rascunho',
  platform: 'instagram',
  conteudo: null,
  ig_caption: '',
  scheduled_at: null,
  responsavel_id: null,
  instagram_media_id: null,
  publish_error: null,
  publish_error_code: null,
  media_autocleaned_at: null,
  instagram_permalink: null,
  tiktok_post_url: null,
  ig_trial_strategy: null,
  custom_status_id: null,
  property_values: [],
} as unknown as PostEditorBodyProps['post'];

function renderBody(overrides: Partial<PostEditorBodyProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: PostEditorBodyProps = {
    post: basePost,
    templateId: 10,
    workflowId: 5,
    clienteId: 3,
    clientePosts: [],
    isExpanded: true,
    approvals: [],
    editSuggestion: null,
    membros: [],
    replyText: '',
    sendingReply: false,
    commentThreads: [],
    currentUserId: 'u1',
    currentUserRole: 'owner',
    workspaceUsers: [],
    hasInstagramAccount: true,
    igAccountStatus: null,
    hasActiveTikTokAccount: false,
    ttAccountStatus: null,
    onFieldChange: vi.fn(),
    onContentUpdate: vi.fn(),
    onReplyChange: vi.fn(),
    onReplySend: vi.fn(),
    onRefresh: vi.fn(),
    onCreateComment: vi.fn(async () => 1),
    onReplyToComment: vi.fn(async () => {}),
    onResolveThread: vi.fn(async () => {}),
    onReopenThread: vi.fn(async () => {}),
    onEditComment: vi.fn(async () => {}),
    onDeleteComment: vi.fn(async () => {}),
    editorVersion: 0,
    onAcceptSuggestion: vi.fn(),
    onRejectSuggestion: vi.fn(),
    ...overrides,
  };
  return render(
    <QueryClientProvider client={qc}>
      <PostEditorBody {...props} />
    </QueryClientProvider>,
  );
}

describe('PostEditorBody tabs', () => {
  it('opens on Conteúdo with all panels mounted but only the active one visible', () => {
    renderBody();
    expect(screen.getByRole('tab', { name: 'Conteúdo' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('post-editor')).toBeVisible();
    expect(screen.getByTestId('schedule-button')).not.toBeVisible();
    expect(screen.getByTestId('media-gallery')).not.toBeVisible();
    expect(screen.getByTestId('comment-summary')).not.toBeVisible();
  });

  it('reveals the Mídia panel when its tab is clicked, keeping the editor mounted', () => {
    renderBody();
    fireEvent.click(screen.getByRole('tab', { name: /Mídia/ }));
    expect(screen.getByTestId('media-gallery')).toBeVisible();
    expect(screen.getByTestId('post-editor')).not.toBeVisible();
    expect(screen.getByTestId('post-editor')).toBeInTheDocument();
  });

  it('shows the media count badge once the media query resolves', async () => {
    renderBody();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Mídia/ })).toHaveTextContent('2'),
    );
  });

  it('defaults to Publicação with a danger dot when the post has a publish error', () => {
    const { container } = renderBody({
      post: {
        ...basePost,
        status: 'falha_publicacao',
        publish_error: 'IG error',
      } as PostEditorBodyProps['post'],
    });
    expect(screen.getByRole('tab', { name: 'Publicação' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('publish-error')).toBeVisible();
    expect(container.querySelector('.drawer-post-tab-dot--danger')).not.toBeNull();
  });

  it('hides the Propriedades tab for a post avulso (no template)', () => {
    renderBody({ templateId: undefined, workflowId: null });
    expect(screen.queryByRole('tab', { name: 'Propriedades' })).toBeNull();
    expect(screen.queryByTestId('property-panel')).toBeNull();
  });

  it('shows the open-thread count on the Comentários tab', () => {
    renderBody({
      commentThreads: [
        { id: 1, status: 'active', comments: [] },
        { id: 2, status: 'resolved', comments: [] },
      ] as unknown as PostEditorBodyProps['commentThreads'],
    });
    expect(screen.getByRole('tab', { name: /Comentários/ })).toHaveTextContent('1');
  });

  it('marks Conteúdo with a warning dot when there is a pending client suggestion', () => {
    const { container } = renderBody({
      editSuggestion: {
        id: 9,
        changed_fields: ['conteudo'],
        suggested_conteudo: null,
        suggested_ig_caption: null,
        updated_at: new Date().toISOString(),
      } as unknown as PostEditSuggestion,
    });
    expect(container.querySelector('.drawer-post-tab-dot--warning')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.test.tsx`
Expected: FAIL — no `role="tab"` elements exist yet (PostEditorBody has no tabs).

- [ ] **Step 3: Restructure PostEditorBody**

In `apps/crm/src/pages/entregas/components/PostEditorBody.tsx`:

3a. Add the import:

```tsx
import { PostEditorTabBar, type PostEditorTab } from './PostEditorTabBar';
```

3b. Add tab state right after the `tiktokTestModeBanner` state block (after the `useEffect` that resets it, near line 185). The initializer runs when the drawer mounts the row, so a post that already failed opens straight on Publicação:

```tsx
  // Aba ativa deste post. Estado local por linha: sobrevive a collapse/expand
  // (o componente continua montado) e cada post lembra sua própria aba.
  const [activeTab, setActiveTab] = useState<PostEditorTab>(() =>
    shouldShowPublishErrorBlock(post) ? 'publicacao' : 'conteudo',
  );
```

3c. After the `const statusAutomationHint = ...` line (line 273), add the derived values:

```tsx
  const publishError = shouldShowPublishErrorBlock(post);
  const showProperties = templateId != null && templateId !== 0 && workflowId != null;
  const openThreadCount = commentThreads.filter((t) => t.status === 'active').length;
```

3d. Rewrite the return so the meta row, `statusAutomationHint` and external warning stay where they are (unchanged), the old inline `{shouldShowPublishErrorBlock(post) && ...}` block is REMOVED from the top, and everything after the warning is wrapped in the tab bar + five panels. The JSX inside each panel is moved verbatim from today's stacking (same props, same conditionals):

```tsx
      <PostEditorTabBar
        active={activeTab}
        onChange={setActiveTab}
        mediaCount={postMedia?.length}
        commentCount={openThreadCount}
        showProperties={showProperties}
        contentAttention={editSuggestion != null}
        publishAttention={publishError}
      />

      <div className="drawer-post-tabpanel" hidden={activeTab !== 'conteudo'}>
        {/* bloco editSuggestion ? <diff> : <PostEditor> — movido sem alteração */}
        {/* bloco isStoryPost ? <p stories> : <InstagramCaptionField> — movido sem alteração */}
      </div>

      <div className="drawer-post-tabpanel" hidden={activeTab !== 'midia'}>
        {/* <PostMediaGallery ... /> — movido sem alteração */}
      </div>

      {showProperties && (
        <div className="drawer-post-tabpanel" hidden={activeTab !== 'propriedades'}>
          {/* <PropertyPanel ... /> — movido; o guard templateId/workflowId virou showProperties */}
        </div>
      )}

      <div className="drawer-post-tabpanel" hidden={activeTab !== 'publicacao'}>
        {publishError && (
          <PublishErrorBlock post={post} clienteId={clienteId} onStatusChange={onRefresh} />
        )}
        {/* <TrialReelPanel>, <TikTokSettingsPanel>, <ScheduleButton>, <PostAutomationSection>
            — movidos sem alteração, mesmos guards de hoje */}
      </div>

      <div className="drawer-post-tabpanel" hidden={activeTab !== 'comentarios'}>
        {/* <PostCommentSummary>, bloco approvals, drawer-reply-row — movidos sem alteração */}
      </div>
```

Notes for the implementer:
- The `PropertyPanel` guard `templateId != null && templateId !== 0 && workflowId != null` becomes the `showProperties` const — inside the panel render `<PropertyPanel templateId={templateId!} ... workflowId={workflowId!} ...>` is now safe because the wrapper guarantees both (the non-null assertions are acceptable here; alternatively narrow with a local `if`).
- `TrialReelPanel` keeps its `hasInstagramAccount &&` guard; `TikTokSettingsPanel` keeps its `platform === 'tiktok' || platform === 'both'` guard; the stories-note/`InstagramCaptionField` ternary moves as-is.
- Do NOT touch the `postMedia` query, título debounce, resolvedContent/resolvedSuggestion effects, or `PostApprovalBubble`.
- All hooks (including the new `useState`) must stay ABOVE the `if (!isExpanded) return null` guard at line 266.

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 6: Run the two drawer suites and repair tab-visibility breakage**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx`

Contract change alert (from user feedback memory): moving sections into hidden panels breaks assertions in two ways — `*ByRole` queries exclude elements inside `[hidden]` ancestors, and `toBeVisible()` fails for them. For each failing assertion about a section that now lives in a non-default tab (schedule button, gallery, TikTok panel, comment reply, properties), add a tab click before the assertion:

```tsx
fireEvent.click(screen.getByRole('tab', { name: 'Publicação' }));
```

(or `/Mídia/`, `'Comentários'`, `'Propriedades'` as appropriate). Do not weaken assertions to `getByTestId`-and-ignore-visibility — clicking the tab is the truthful fix.

Expected after repairs: both suites PASS.

- [ ] **Step 7: Run the full frontend suite**

Run: `npm run test`
Expected: PASS. Any other failing suite that renders PostEditorBody gets the same tab-click treatment.

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostEditorBody.tsx apps/crm/src/pages/entregas/components/__tests__/
git commit -m "feat(entregas): editor de post expandido organizado em abas"
```

---

### Task 3: Remove the cover star — cover is derived from order

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`
- Modify: `apps/crm/src/services/postMedia.ts` (remove `setPostMediaCover`, lines 273–276)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx` (update)
- Test: `apps/crm/src/services/__tests__/postMedia.test.ts` (remove the `setPostMediaCover` import and its test at line ~326)

**Interfaces:**
- Consumes: nothing from Tasks 1–2 (independent; can run in parallel with them).
- Produces: `SortableMediaTile` gains prop `isCover: boolean` and loses prop `onSetCover` (internal to this file). `setPostMediaCover` no longer exists in `apps/crm/src/services/postMedia.ts` — nothing else imports it (verified: only the gallery and its tests).
- NOT touched: backend `post-media-manage` PATCH `is_cover` route, Hub, MCP `attach_image_to_post`. The resolution rule `is_cover ?? first by sort_order` already exists in every reader.

- [ ] **Step 1: Write the failing tests**

In `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`:

1a. Remove `setPostMediaCover: vi.fn(),` from the `vi.mock('.../services/postMedia', ...)` factory (line ~16) — after Step 3 the module no longer exports it, and an over-mocked name would hide that.

1b. Find the media fixture builder (line ~233, `is_cover: i === 0`) and add these tests (adapt `renderGallery`/fixture names to what the file actually uses):

```tsx
  it('marks the first media as capa when no legacy is_cover flag exists', async () => {
    // fixture: three media, all is_cover: false
    renderGallery(mediaFixture(3).map((m) => ({ ...m, is_cover: false })));
    const badges = await screen.findAllByText('capa');
    expect(badges).toHaveLength(1);
    // the badge belongs to the tile of the first media item
  });

  it('still honors a legacy is_cover flag on a non-first media', async () => {
    const media = mediaFixture(3).map((m, i) => ({ ...m, is_cover: i === 1 }));
    renderGallery(media);
    const badges = await screen.findAllByText('capa');
    expect(badges).toHaveLength(1);
    // badge on the second tile, not the first
  });

  it('does not render a set-cover button anymore', async () => {
    renderGallery(mediaFixture(2));
    await screen.findAllByText('capa');
    expect(screen.queryByTitle('Definir como capa')).toBeNull();
  });

  it('invalidates workflow-covers after deleting a media item', async () => {
    // reuse the pattern of the existing "invalidates workflow-covers after uploads"
    // test (line ~208): spy on queryClient.invalidateQueries, click the tile's
    // "Remover" button (title="Remover"), await
    // expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-covers'] })
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`
Expected: the new tests FAIL (star button still renders; no derived badge; delete only invalidates `post-media`).

- [ ] **Step 3: Implement in PostMediaGallery.tsx**

3a. Imports: remove `Star` from the lucide import (line 7) and `setPostMediaCover` from the services import (line 34).

3b. Delete `handleSetCover` (lines 390–397).

3c. Cover derivation — add just before the `return` of the main component (near line 476):

```tsx
  // Capa derivada: flag legada/MCP se existir, senão a primeira por ordem.
  // Mesma regra de resolução do Hub e do post-media-manage.
  const coverId = media.find((m) => m.is_cover)?.id ?? media[0]?.id;
```

3d. In the `media.map(...)` render (line 495), replace `onSetCover={() => handleSetCover(m.id)}` with `isCover={m.id === coverId}`.

3e. In `SortableMediaTileProps` / `SortableMediaTile`: remove `onSetCover`, add `isCover: boolean`. Badge condition `{m.is_cover && (...)}` (line 715) becomes `{isCover && (...)}` and loses the `<Star>` icon (keep the "capa" text pill). Delete the whole `{!m.is_cover && (<button ... title="Definir como capa" ...>)}` block (lines 726–735).

3f. Reorder/delete/link now change which media is first, so they must refresh listing thumbnails too: in `handleDragEnd` (lines 118–126) replace both `refresh()` calls with `refreshWithCovers()`; same in `handleDelete` (line 384) and `handlePickFiles` (line 403).

3g. In `apps/crm/src/services/postMedia.ts`, delete the `setPostMediaCover` function (lines 273–276 and its doc comment if any).

3h. In `apps/crm/src/services/__tests__/postMedia.test.ts`, remove `setPostMediaCover` from the import (line 12) and delete its test block (line ~326).

- [ ] **Step 4: Run the affected suites**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx apps/crm/src/services/__tests__/postMedia.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and full suite**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run test
```

Expected: clean/PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostMediaGallery.tsx apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx apps/crm/src/services/postMedia.ts apps/crm/src/services/__tests__/postMedia.test.ts
git commit -m "feat(entregas): capa derivada da ordem das mídias, sem estrela manual"
```

---

### Task 4: Migration clearing legacy cover flags

**Files:**
- Create: `supabase/migrations/20260902120000_clear_post_file_cover_flags.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: after `db push`, no `post_file_links` row has `is_cover = true`, so every thumbnail reader's fallback ("first by sort_order") takes over — matching the new UI rule. Without this, posts starred on a non-first media would keep a thumbnail the UI can no longer change.

**Why clearing ALL flags is safe:** setting `is_cover = false` never trips the `post_file_links_one_cover` partial unique index (it only indexes `true` rows), so a single UPDATE is fine here — the two-statement demote/promote dance only applies when SETTING a cover. Future MCP `attach_image_to_post` calls may still set a flag deliberately; the gallery badge and all readers honor it (resolution rule kept in Task 3).

- [ ] **Step 1: Verify the version prefix is unique**

Run: `ls supabase/migrations | grep '^20260902'`
Expected: only `20260902000010_story_insights.sql` (plus this new file once created). If another file already uses `20260902120000`, bump to a later unused timestamp.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260902120000_clear_post_file_cover_flags.sql`:

```sql
-- A capa de um post agora é derivada: primeira mídia por sort_order.
-- (A UI de "definir como capa" foi removida; todos os leitores — CRM covers,
-- Hub, MCP — já usam a regra "is_cover se existir, senão a primeira".)
-- Limpa as flags legadas para que nenhum post fique preso a uma capa que a UI
-- não consegue mais alterar. Seguro em um único UPDATE: o índice parcial
-- post_file_links_one_cover só indexa linhas true, e aqui só escrevemos false.
update post_file_links set is_cover = false where is_cover = true;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260902120000_clear_post_file_cover_flags.sql
git commit -m "feat(entregas): migration limpando flags legadas de capa"
```

Deploy note (for rollout, not for this task): `npx supabase db push --linked` — confirm the linked project first via `cat supabase/.temp/project-ref` (link state flips between prod/staging).

---

### Task 5: Full verification + browser check

**Files:** none created — verification only.

- [ ] **Step 1: Full local CI parity**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
```

Expected: all clean. If `format:check` fails, run `npm run format` and re-stage. If `test:functions` dirties `deno.lock`, restore it (`git checkout -- deno.lock`) — known side effect. If deno runs polluted `node_modules` (check `ls node_modules/.deno`), run `npm ci` before re-running vitest.

- [ ] **Step 2: Browser verification (dev server points at PROD — read-mostly discipline)**

Start the CRM dev server via the preview tooling (never Bash), open `/entregas`, open a workflow drawer, expand a post, and verify:
1. Five tabs render below the meta row; Conteúdo active; yellow underline on the active tab in dark mode.
2. Clicking Mídia shows the gallery with the "capa" pill on the first tile and NO star button on hover.
3. Type in the TipTap editor, switch to Mídia and back: the text and cursor state survive.
4. Publicação tab shows Agendar/automação; a post with `falha_publicacao` (if one exists in DK TESTE) opens on Publicação with a red dot.
5. Comentários tab shows approvals + reply field; badge counts open threads.
6. Post avulso drawer (Posts avulsos board): four tabs, no Propriedades.
7. Screenshot the expanded editor on each tab for the PR description.

Do NOT schedule, delete, or reply against real client posts — use the DK TESTE workspace for any write.

- [ ] **Step 3: Commit any verification fixes**

Each fix found in the browser gets its own small commit with a message naming the symptom.

---

## Self-Review (completed at plan time)

- **Spec coverage:** 5-tab model with meta row + warnings above tabs (Task 2); Mídia as its own tab (Task 2 mapping); attention dots + count badges (Tasks 1–2); smart default tab on publish error (Task 2); keep-mounted panels for TipTap state (Tasks 1–2, `[hidden]` CSS + `hidden` attr); star removal with derived cover (Task 3); legacy flag cleanup (Task 4). Plataforma stays in the meta row as approved.
- **Placeholder scan:** the two "// bloco ... movido sem alteração" comments in Task 2 Step 3d are move instructions referencing exact existing code at named line numbers, not TBDs; test skeleton comments in Task 3 Step 1b point at the concrete existing pattern (line ~208) to copy.
- **Type consistency:** `PostEditorTab` union and `PostEditorTabBar` props defined in Task 1 match every usage in Task 2; `isCover` prop introduced and consumed only inside `PostMediaGallery.tsx`; `PostEditorBodyProps` unchanged so drawer call sites compile untouched.

---

### Task 6: workflow_ids cover fallback in post-media-manage

**Added mid-execution.** An external review found a real gap in the plan's premise: the `workflow_ids` branch of `post-media-manage` (GET covers for the delivery board) queries ONLY `is_cover = true` links, with no first-by-sort_order fallback — unlike every other reader. After Task 4's migration clears legacy flags, delivery-board workflow cards would lose their thumbnails. Verified against code: `supabase/functions/post-media-manage/handler.ts:116-119`. The live upload path (`file-upload-finalize`) never sets `is_cover`, so post-migration flags exist only when MCP sets one deliberately — the fallback must therefore carry the default case.

**Files:**
- Modify: `supabase/functions/post-media-manage/handler.ts` (workflow_ids branch, lines 102-147)
- Modify: `supabase/migrations/20260902120000_clear_post_file_cover_flags.sql` (comment only: correct the "all readers" claim and add the deploy-order note)
- Test: `supabase/functions/__tests__/post-media-manage_test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (independent of Tasks 1-3; ordered after Task 4 because it corrects that migration's stated premise).
- Produces: the `workflow_ids` branch resolves one cover per post with the SAME rule as the `post_ids` branch (handler.ts:162-173): all links for the owned posts ordered by `sort_order` asc then `id` asc, then per-post "the `is_cover` link if flagged, else the first". Response shape (`{ covers: [{ workflow_id, media: [...] }] }`) unchanged, still grouped by workflow and ordered by post `ordem`.

- [ ] **Step 1: Write the failing test**

In `supabase/functions/__tests__/post-media-manage_test.ts`, next to the existing workflow_ids tests (line ~98), add a test seeding TWO links for one post, neither flagged (`is_cover: false`), with distinct `sort_order` (e.g. 1 and 0): the response must contain exactly one cover for the workflow, and it must be the link with the LOWER sort_order. Follow the file's existing mock-queue pattern (`db.queue("workflow_posts", ...)`, `db.queue("post_file_links", ...)`) and legacy-shape assertions used by the test at line 98. Keep the existing flagged-cover test passing: when a flagged link exists among the queued links, it wins over a lower-sort_order unflagged one — extend or add a second case asserting that priority.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test:functions -- --filter "post-media-manage"`
(the `--filter` matches TEST NAMES). Expected: new tests FAIL — the current branch queries `.eq("is_cover", true)` so unflagged links produce no cover. If `deno.lock` gets dirtied by the run, restore it with `git checkout -- deno.lock` before committing.

- [ ] **Step 3: Implement the fallback**

In `supabase/functions/post-media-manage/handler.ts` workflow_ids branch, replace the flag-only query (lines 116-119) with the post_ids branch's resolution: fetch all links for `postIds` ordered by `sort_order` asc, `id` asc; build `coverByPost` exactly like lines 169-173 (`if (!existing || (l.is_cover && !existing.is_cover)) coverByPost.set(l.post_id, l)`); then feed `coverByPost.values()` into the existing per-workflow grouping (which sorts by post `ordem` — keep that sort and the response shape untouched). Do not extract a shared helper unless it drops in cleanly — small duplication of the 5-line resolution loop is acceptable and mirrors the file's existing style; if you do extract one, both branches must use it.

- [ ] **Step 4: Correct the migration comment**

In `supabase/migrations/20260902120000_clear_post_file_cover_flags.sql`, the comment claiming all readers already fall back is now accurate ONLY together with this task. Rewrite the comment to say: readers resolve "is_cover se existir, senão a primeira por sort_order"; the workflow_ids branch of post-media-manage gained that fallback in this same branch; and the function MUST be deployed BEFORE `db push` applies this migration, or delivery-board thumbnails blank until the deploy. Keep it pt-BR, no em-dashes.

- [ ] **Step 5: Run the function suite**

Run: `npm run test:functions -- --filter "post-media-manage"` then the full `npm run test:functions`.
Expected: PASS. Restore `deno.lock` if dirtied; if the deno run polluted `node_modules` (check `ls node_modules/.deno`), run `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/post-media-manage/handler.ts supabase/functions/__tests__/post-media-manage_test.ts supabase/migrations/20260902120000_clear_post_file_cover_flags.sql
git commit -m "fix(entregas): fallback de capa por ordem no covers por workflow"
```

---

### Task 7: drop the auto-cover triggers in the same migration

**Added mid-execution.** External review caught that clearing flags is not durable: `trg_post_file_link_auto_cover` (BEFORE INSERT on `post_file_links`, migration `20260425000002`) re-flags the next inserted link whenever a post has no flagged cover. After Task 4's cleanup, appending media to an existing post would flag the APPENDED link — every reader prefers the flag, so the newest media would become the cover and drag-reorder could never change it. Its sibling `trg_post_file_link_reassign_cover` (AFTER DELETE) keeps flags alive by promoting another link when a flagged one is deleted. Both triggers exist to maintain the manual-flag model this branch retires. Verified: no references to either trigger/function outside the defining migration (greps over `supabase/tests`, `supabase/functions`, `apps/`); the Arquivos page never sets `is_cover` (always `false` at link time); deliberate covers via the `post_file_link_set_cover` RPC (file-manage PATCH, MCP attach) remain untouched and honored by every reader's resolution rule.

**Files:**
- Modify: `supabase/migrations/20260902120000_clear_post_file_cover_flags.sql` (replace entire content with the version below)

**Interfaces:**
- Consumes: Task 6's fallback (all readers resolve `is_cover ?? first by sort_order`), which makes the triggers safe to drop.
- Produces: after `db push`, no automatic writer of `is_cover` remains; flags appear only via the explicit `post_file_link_set_cover` RPC.

- [ ] **Step 1: Replace the migration content**

Replace the ENTIRE content of `supabase/migrations/20260902120000_clear_post_file_cover_flags.sql` with:

```sql
-- A capa de um post agora é derivada: a mídia com is_cover se existir (apenas
-- via RPC post_file_link_set_cover, ex.: MCP), senão a primeira por sort_order.
-- Todos os leitores (post-media-manage nos três branches, hub-posts, MCP e a
-- galeria do CRM) aplicam essa resolução.
--
-- 1) Remove os triggers que mantinham o modelo antigo de flag manual:
--    - auto_cover flagava o próximo insert quando o post não tinha capa; depois
--      da limpeza abaixo, ele flagaria a mídia recém-anexada (a última da
--      ordem), e o flag venceria a regra da primeira. Reordenar não corrigiria.
--    - reassign_cover repassava o flag ao deletar a capa flagada, mantendo o
--      flag vivo indefinidamente.
drop trigger if exists trg_post_file_link_auto_cover on post_file_links;
drop function if exists post_file_link_auto_cover();
drop trigger if exists trg_post_file_link_reassign_cover on post_file_links;
drop function if exists post_file_link_reassign_cover();

-- 2) Limpa as flags legadas. Seguro em um único UPDATE: o índice parcial
--    post_file_links_one_cover só indexa linhas true, e aqui só escrevemos false.
--
-- Ordem de deploy: publique a function post-media-manage (fallback por ordem no
-- branch de workflow_ids) ANTES de rodar "supabase db push", senão as thumbnails
-- dos boards ficam em branco até o deploy.
update post_file_links set is_cover = false where is_cover = true;
```

- [ ] **Step 2: Sanity checks**

Run: `ls supabase/migrations | grep '^20260902'` — still exactly two files, prefixes `20260902000010` and `20260902120000`.
Run: `grep -rn "auto_cover\|reassign_cover" supabase/functions supabase/tests apps/ | grep -v migrations` — expected: no matches (nothing else references the dropped triggers/functions).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260902120000_clear_post_file_cover_flags.sql
git commit -m "fix(entregas): derruba triggers de auto-capa junto com a limpeza de flags"
```
