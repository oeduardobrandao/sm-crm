# Mensagens Split-Pane Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the CRM's single-pane `/mensagens` page into a WhatsApp-style split-pane inbox — a fixed-width conversation list on the left, the open thread on the right — with the selected conversation reflected in the URL (`/mensagens/:clienteId`), collapsing back to today's single-pane behavior below 768px.

**Architecture:** `MensagensPage.tsx` becomes a thin route-driven shell that calls `useMensagensData` once and renders two new components — `ConversationList` (list pane, owns search/sort) and `ConversationThread` (thread pane, owns per-conversation state, remounted via `key={clienteId}` so switching conversations resets it). A new `ThreadStatus.tsx` supplies the four non-thread states the shell can put in the thread slot (placeholder, loading, error+retry, not-found). Layout uses the existing `.page-full-bleed` CSS contract instead of a hand-rolled viewport `calc()`.

**Tech Stack:** React 19, TanStack Query, React Router v7, Tailwind + the CRM's CSS-variable tokens, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-16-mensagens-split-pane-design.md`

## Global Constraints

- Breakpoint is **768px** (`min-width: 768px`), matching `apps/crm/src/hooks/useIsDesktop.ts`'s default and Tailwind's `md`. Reuse that hook — do not add a new media-query hook.
- List pane is a **fixed 340px** on desktop; full width on mobile when it's the only visible pane.
- URL param parsing follows repo convention: `parseInt(param, 10)` + `isNaN` guard, never bare `Number()`.
- No backend/RPC changes. No `apps/hub` changes. No `vercel.json` changes (already covered — verified in the spec).
- Before considering any task done: the touched packages must pass `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npm run lint`, and the relevant `vitest run` command.
- Full pre-push gate (final task): `npm run lint`, `npm run format:check`, all four `tsc` projects, `npm run test`, `npm run test:functions`.

---

## Task 1: Route + feed-query gating groundwork

**Files:**
- Modify: `apps/crm/src/App.tsx:230`
- Modify: `apps/crm/src/pages/mensagens/hooks/useMensagensData.ts:18-32`

**Interfaces:**
- Produces: a second route `/mensagens/:clienteId` resolving to the same `MensagensPage` component as `/mensagens`. Produces: `useMensagensData(clienteId)`'s `feed` query now only fetches once `conversas` has resolved **and confirmed** `clienteId` is a real conversation — not merely `clienteId != null`. A merely-numeric-but-unknown id (e.g. `/mensagens/999`) must never trigger a feed fetch: Task 6's `'/mensagens/999 (unknown id)...'` test asserts `getMensagensFeed` is never called for it, and Task 5's not-found precedence never renders `ConversationThread` for such an id anyway — the fetch would be pure waste (and, depending on RLS, could error) if it fired.

This task doesn't get its own new test file — the existing `MensagensPage.tsx` still ignores the URL entirely (it derives everything from `selecionado` state), so there is no new observable behavior to assert yet. It's verified by (a) typecheck and (b) the *existing* test suite staying green, which is real proof: in every current "list view" test `clienteId` is already `null`, so gating the feed query changes nothing they assert.

- [ ] **Step 1: Add the second route**

In `apps/crm/src/App.tsx`, change:

```tsx
                <Route path="/mensagens" element={<MensagensPage />} />
```

to:

```tsx
                <Route path="/mensagens" element={<MensagensPage />} />
                <Route path="/mensagens/:clienteId" element={<MensagensPage />} />
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Gate the feed query on a confirmed conversation, not just a non-null id**

`clienteId` alone isn't enough to gate on — a syntactically valid but unknown id (e.g. `/mensagens/999`, no matching row in `conversas`) must never trigger a fetch. `conversas` is the thing that confirms an id is real, so `feed`'s `enabled` has to read `conversas.data`. That means `conversas` needs to be declared before `feed` in this file.

In `apps/crm/src/pages/mensagens/hooks/useMensagensData.ts`, change:

```ts
  const feed = useInfiniteQuery({
    queryKey: ['mensagens-feed', clienteId],
    queryFn: ({ pageParam }) =>
      getMensagensFeed({ clienteId: clienteId ?? undefined, cursor: pageParam }),
    initialPageParam: undefined as MensagensCursor | undefined,
    getNextPageParam: (last) => {
      if (last.length !== PAGE_SIZE) return undefined;
      const oldest = last[last.length - 1];
      return {
        before: oldest.created_at,
        beforeSource: oldest.source,
        beforeItemId: oldest.item_id,
      };
    },
  });

  const conversas = useQuery({
    queryKey: ['mensagens-conversas'],
    queryFn: getMensagensConversas,
  });
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
```

to:

```ts
  const conversas = useQuery({
    queryKey: ['mensagens-conversas'],
    queryFn: getMensagensConversas,
  });
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  // A merely-numeric clienteId isn't enough — confirm it's a real conversation
  // before fetching its feed. Stays false (no fetch) while conversas is still
  // loading too, same as an unconfirmed id; the shell's precedence (Task 5)
  // is what decides what to show meanwhile, this just avoids the wasted call.
  const conversaExists =
    clienteId != null && (conversas.data?.some((c) => c.cliente_id === clienteId) ?? false);

  const feed = useInfiniteQuery({
    queryKey: ['mensagens-feed', clienteId],
    queryFn: ({ pageParam }) =>
      getMensagensFeed({ clienteId: clienteId ?? undefined, cursor: pageParam }),
    initialPageParam: undefined as MensagensCursor | undefined,
    getNextPageParam: (last) => {
      if (last.length !== PAGE_SIZE) return undefined;
      const oldest = last[last.length - 1];
      return {
        before: oldest.created_at,
        beforeSource: oldest.source,
        beforeItemId: oldest.item_id,
      };
    },
    enabled: conversaExists,
  });
```

- [ ] **Step 4: Run the existing suite to confirm nothing broke**

Run: `npx vitest run apps/crm/src/pages/mensagens/__tests__/MensagensPage.test.tsx`
Expected: all 12 existing tests still PASS (unchanged — `MensagensPage.tsx` hasn't been touched yet, so behavior is identical; this only proves the `enabled` gate doesn't regress anything the current suite already checks).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/App.tsx apps/crm/src/pages/mensagens/hooks/useMensagensData.ts
git commit -m "feat(mensagens): add /mensagens/:clienteId route and gate feed fetch on clienteId"
```

---

## Task 2: `ThreadStatus.tsx` — non-thread states for the thread pane

**Files:**
- Create: `apps/crm/src/pages/mensagens/components/ThreadStatus.tsx`
- Test: `apps/crm/src/pages/mensagens/components/__tests__/ThreadStatus.test.tsx`

**Interfaces:**
- Produces: `ThreadPlaceholder()`, `ThreadNotFound({ onBack?: () => void })`, `ThreadLoading({ onBack?: () => void })`, `ThreadLoadError({ onRetry: () => void; onBack?: () => void })`. All four are self-contained, no other props. `onBack`, when provided, renders a "Voltar para as conversas" affordance (mobile only — Task 5 passes it as `undefined` on desktop).
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/mensagens/components/__tests__/ThreadStatus.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ThreadLoadError, ThreadLoading, ThreadNotFound, ThreadPlaceholder } from '../ThreadStatus';

describe('ThreadStatus', () => {
  it('ThreadPlaceholder shows the select-a-conversation hint', () => {
    render(<ThreadPlaceholder />);
    expect(screen.getByText('Selecione uma conversa')).toBeInTheDocument();
  });

  it('ThreadNotFound links back to the conversation list', () => {
    render(
      <MemoryRouter>
        <ThreadNotFound />
      </MemoryRouter>,
    );
    expect(screen.getByText('Conversa não encontrada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para as conversas' })).toHaveAttribute(
      'href',
      '/mensagens',
    );
  });

  it('ThreadNotFound shows a back button instead when onBack is provided', () => {
    const onBack = vi.fn();
    render(
      <MemoryRouter>
        <ThreadNotFound onBack={onBack} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('ThreadLoading shows a loading message with no back affordance by default', () => {
    render(<ThreadLoading />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar para as conversas' })).not.toBeInTheDocument();
  });

  it('ThreadLoading shows a back button when onBack is provided', () => {
    const onBack = vi.fn();
    render(<ThreadLoading onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('ThreadLoadError calls onRetry when clicked, and supports onBack', () => {
    const onRetry = vi.fn();
    const onBack = vi.fn();
    render(<ThreadLoadError onRetry={onRetry} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/mensagens/components/__tests__/ThreadStatus.test.tsx`
Expected: FAIL — `Cannot find module '../ThreadStatus'`.

- [ ] **Step 3: Implement the component**

Create `apps/crm/src/pages/mensagens/components/ThreadStatus.tsx`:

```tsx
import { AlertTriangle, ArrowLeft, MessageCircle, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';

const WRAPPER =
  'flex-1 min-w-0 relative flex flex-col items-center justify-center gap-2 py-16 text-center';

function BackButton({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null;
  return (
    <button
      onClick={onBack}
      aria-label="Voltar para as conversas"
      className="absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
    >
      <ArrowLeft size={17} />
    </button>
  );
}

/** Desktop only — nothing selected yet. Never reachable on mobile, where the
 * list itself is the whole screen until a conversation is picked. */
export function ThreadPlaceholder() {
  return (
    <div className={WRAPPER}>
      <MessageCircle className="h-8 w-8" style={{ color: 'var(--text-light)' }} />
      <p className="text-sm text-[var(--text-muted)]">Selecione uma conversa</p>
    </div>
  );
}

export function ThreadNotFound({ onBack }: { onBack?: () => void }) {
  return (
    <div className={WRAPPER}>
      <BackButton onBack={onBack} />
      <SearchX className="h-8 w-8" style={{ color: 'var(--text-light)' }} />
      <p className="text-sm text-[var(--text-muted)]">Conversa não encontrada.</p>
      {!onBack && (
        <Link
          to="/mensagens"
          className="text-sm font-semibold text-[var(--text-main)] hover:underline"
        >
          Voltar para as conversas
        </Link>
      )}
    </div>
  );
}

export function ThreadLoading({ onBack }: { onBack?: () => void }) {
  return (
    <div className={WRAPPER}>
      <BackButton onBack={onBack} />
      <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
    </div>
  );
}

export function ThreadLoadError({
  onRetry,
  onBack,
}: {
  onRetry: () => void;
  onBack?: () => void;
}) {
  return (
    <div className={WRAPPER}>
      <BackButton onBack={onBack} />
      <AlertTriangle className="h-8 w-8" style={{ color: 'var(--text-light)' }} />
      <p className="text-sm text-[var(--text-muted)]">Não foi possível carregar as conversas.</p>
      <button
        onClick={onRetry}
        className="text-sm font-semibold text-[var(--text-main)] hover:underline"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        Tentar novamente
      </button>
    </div>
  );
}
```

Note: `ThreadNotFound` renders the static `Link` only when `onBack` is *not* passed (desktop — clicking it changes the URL back to `/mensagens`); when `onBack` is passed (mobile), the `BackButton` is the affordance and the static link is skipped so there's exactly one "Voltar para as conversas" control either way.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/crm/src/pages/mensagens/components/__tests__/ThreadStatus.test.tsx`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/mensagens/components/ThreadStatus.tsx apps/crm/src/pages/mensagens/components/__tests__/ThreadStatus.test.tsx
git commit -m "feat(mensagens): add ThreadStatus components for the split-pane thread slot"
```

---

## Task 3: `ConversationList.tsx` — the list pane

**Files:**
- Modify: `apps/crm/src/pages/mensagens/mensagensLogic.ts` (add `formatTime`)
- Create: `apps/crm/src/pages/mensagens/components/ConversationList.tsx`
- Test: `apps/crm/src/pages/mensagens/components/__tests__/ConversationList.test.tsx`

**Interfaces:**
- Consumes: `conversaPreview`, `sortConversas`, `ConversasSort` from `../mensagensLogic` (existing); `ClienteAvatar` from `./Avatars` (existing).
- Produces: `formatTime(iso: string): string` — new pure export on `mensagensLogic.ts`, moved verbatim out of `MensagensPage.tsx` (Task 5 and Task 4 both import it from here instead of redefining it). Produces: `<ConversationList conversas isLoading isError selectedClienteId clientesById onSelect className? />` — a pure, router-agnostic component. Owns its own `busca`/`sort` state internally (not lifted to the shell, since it never unmounts on conversation switches).

- [ ] **Step 1: Add `formatTime` to `mensagensLogic.ts`**

Append to `apps/crm/src/pages/mensagens/mensagensLogic.ts`:

```ts
/** "10 de ago., 17:35" — pt-BR day + abbreviated month + time, used by both
 * the conversation list row and the thread's message timestamps. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/crm/src/pages/mensagens/components/__tests__/ConversationList.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ConversationList } from '../ConversationList';
import type { MensagemConversa } from '@/store';

const CONVERSAS: MensagemConversa[] = [
  {
    cliente_id: 14,
    cliente_nome: 'ACME',
    cliente_foto_url: null,
    last_source: 'mensagem',
    last_action: null,
    last_content: 'Obrigado!',
    last_is_workspace_user: false,
    last_author_name: null,
    last_created_at: '2026-07-30T12:00:00.000Z',
    unread_count: 2,
  },
  {
    cliente_id: 15,
    cliente_nome: 'Beta Corp',
    cliente_foto_url: 'https://cdn.example.com/beta.png',
    last_source: 'post_feedback',
    last_action: 'mensagem',
    last_content: 'Segue o ajuste combinado.',
    last_is_workspace_user: true,
    last_author_name: 'Ana',
    last_created_at: '2026-07-31T09:00:00.000Z',
    unread_count: 0,
  },
];

function renderList(overrides: Partial<ComponentProps<typeof ConversationList>> = {}) {
  const onSelect = vi.fn();
  render(
    <ConversationList
      conversas={CONVERSAS}
      isLoading={false}
      isError={false}
      selectedClienteId={null}
      clientesById={new Map()}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onSelect };
}

describe('ConversationList', () => {
  it('renders rows with preview, unread badge and agency prefix', () => {
    renderList();
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('Obrigado!')).toBeInTheDocument();
    expect(screen.getByText('Ana: Segue o ajuste combinado.')).toBeInTheDocument();
    expect(screen.getByTestId('conversa-14')).toHaveTextContent('2');
  });

  it('marks the selected conversation as active and others as not', () => {
    renderList({ selectedClienteId: 15 });
    expect(screen.getByTestId('conversa-15').style.boxShadow).toContain('var(--primary-color)');
    expect(screen.getByTestId('conversa-14').style.boxShadow).toBe('');
  });

  it('calls onSelect with the clicked cliente_id', () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByTestId('conversa-14'));
    expect(onSelect).toHaveBeenCalledWith(14);
  });

  it('sorts by recency by default and flips to oldest', () => {
    renderList();
    expect(
      screen.getByTestId('conversa-15').compareDocumentPosition(screen.getByTestId('conversa-14')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy(); // Beta Corp (jul 31) renders before ACME (jul 30)
    fireEvent.click(screen.getByRole('button', { name: /Mais recentes/ }));
    expect(
      screen.getByTestId('conversa-14').compareDocumentPosition(screen.getByTestId('conversa-15')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('filters by client name', () => {
    renderList();
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'acm' } });
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.queryByText('Beta Corp')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nenhum cliente encontrado.')).toBeInTheDocument();
  });

  it('uses the Instagram profile picture as the client avatar when available', () => {
    renderList();
    expect(screen.getByTestId('cliente-avatar-foto')).toHaveAttribute(
      'src',
      'https://cdn.example.com/beta.png',
    );
  });

  it('shows loading and error copy', () => {
    const { unmount } = renderList({ isLoading: true });
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    unmount();
    renderList({ isError: true });
    expect(screen.getByText('Não foi possível carregar as conversas.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/mensagens/components/__tests__/ConversationList.test.tsx`
Expected: FAIL — `Cannot find module '../ConversationList'`.

- [ ] **Step 4: Implement `ConversationList.tsx`**

Create `apps/crm/src/pages/mensagens/components/ConversationList.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { ArrowDownUp, Info, Search } from 'lucide-react';
import type { Cliente, MensagemConversa } from '@/store';
import { ClienteAvatar } from './Avatars';
import { conversaPreview, formatTime, sortConversas, type ConversasSort } from '../mensagensLogic';

interface ConversationListProps {
  conversas: MensagemConversa[];
  isLoading: boolean;
  isError: boolean;
  selectedClienteId: number | null;
  clientesById: Map<number, Cliente>;
  onSelect: (clienteId: number) => void;
  className?: string;
}

export function ConversationList({
  conversas,
  isLoading,
  isError,
  selectedClienteId,
  clientesById,
  onSelect,
  className = '',
}: ConversationListProps) {
  const [sort, setSort] = useState<ConversasSort>('recentes');
  const [busca, setBusca] = useState('');

  const conversasOrdenadas = useMemo(() => sortConversas(conversas, sort), [conversas, sort]);

  const conversasVisiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return conversasOrdenadas;
    return conversasOrdenadas.filter((c) => c.cliente_nome.toLowerCase().includes(q));
  }, [conversasOrdenadas, busca]);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="border-b border-[var(--border-color)] px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-[var(--text-main)]">Mensagens</h1>
          <span
            data-tooltip="Toda a comunicação com os clientes, agrupada por conversa. Cada item leva ao post de origem."
            data-tooltip-dir="right"
            style={{ display: 'flex' }}
          >
            <Info className="h-4 w-4 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
          </span>
        </div>
        <div className="mt-3" style={{ position: 'relative' }}>
          <Search
            className="h-4 w-4"
            style={{
              position: 'absolute',
              left: '0.625rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente..."
            aria-label="Buscar cliente"
            className="w-full rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] py-2 pr-3 text-sm outline-none"
            style={{ paddingLeft: '2rem' }}
          />
        </div>
        <button
          onClick={() => setSort((s) => (s === 'recentes' ? 'antigas' : 'recentes'))}
          className="mt-2 flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
          style={{ background: 'var(--card-bg)', cursor: 'pointer' }}
        >
          <ArrowDownUp size={13} />
          {sort === 'recentes' ? 'Mais recentes' : 'Mais antigas'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">Carregando…</p>
        )}
        {isError && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            Não foi possível carregar as conversas.
          </p>
        )}
        {!isLoading && !isError && conversasVisiveis.length === 0 && (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            {busca.trim()
              ? 'Nenhum cliente encontrado.'
              : 'Nenhuma conversa ainda. As mensagens dos clientes aparecem aqui.'}
          </p>
        )}
        {conversasVisiveis.map((c) => {
          const isActive = c.cliente_id === selectedClienteId;
          return (
            <button
              key={c.cliente_id}
              onClick={() => onSelect(c.cliente_id)}
              data-testid={`conversa-${c.cliente_id}`}
              className="flex w-full items-center gap-3 border-b border-[var(--border-color)] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]"
              style={{
                border: 'none',
                cursor: 'pointer',
                ...(isActive
                  ? { background: 'rgba(255,191,48,0.12)', boxShadow: 'inset 3px 0 0 var(--primary-color)' }
                  : { background: 'transparent' }),
              }}
            >
              <ClienteAvatar
                nome={c.cliente_nome}
                fotoUrl={c.cliente_foto_url}
                cliente={clientesById.get(c.cliente_id)}
                size="lg"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{c.cliente_nome}</span>
                  {c.last_created_at != null && (
                    <span className="shrink-0 text-xs text-[var(--text-light)]">
                      {formatTime(c.last_created_at)}
                    </span>
                  )}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-[var(--text-muted)]">
                    {conversaPreview(c)}
                  </span>
                  {c.unread_count > 0 && (
                    <span className="nav-badge nav-badge--count shrink-0">
                      {c.unread_count > 99 ? '99+' : c.unread_count}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run apps/crm/src/pages/mensagens/components/__tests__/ConversationList.test.tsx`
Expected: all 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/mensagens/mensagensLogic.ts apps/crm/src/pages/mensagens/components/ConversationList.tsx apps/crm/src/pages/mensagens/components/__tests__/ConversationList.test.tsx
git commit -m "feat(mensagens): add ConversationList component for the split-pane list"
```

---

## Task 4: `ConversationThread.tsx` — the thread pane

**Files:**
- Create: `apps/crm/src/pages/mensagens/components/ConversationThread.tsx`
- Test: `apps/crm/src/pages/mensagens/components/__tests__/ConversationThread.test.tsx`

**Interfaces:**
- Consumes: `formatTime` from `../mensagensLogic` (Task 3); `AutorAvatar`, `ClienteAvatar` from `./Avatars` (existing); `PostChip` from `./PostChip` (existing); `eventLabel`, `feedItemKey`, `isEventRow`, `matchesTipo`, `TIPO_FILTERS`, `MensagensTipoFilter` from `../mensagensLogic` (existing).
- Produces: `<ConversationThread conversa feed sendGeneral replyToPost clientesById onBack? />`, typed against `ReturnType<typeof useMensagensData>` so its prop types can never drift from the hook. Must be rendered with `key={clienteId}` by its parent (Task 5) — it owns `tipo`/`draft`/`replyTo`/scroll state internally and relies on being remounted to reset that state; it does **not** reset on prop changes alone.

This component owns the *message-list* error state — `feed.isError` — distinct from the shell's `conversas.isError` state (Task 2/5): a valid, confirmed conversation whose *message* fetch fails gets its own "Não foi possível carregar as mensagens." + "Tentar novamente" (`feed.refetch()`) inline in the scroll area, so it never gets misread as "Nenhuma mensagem nesta conversa ainda." (the empty-but-successful state). The pre-refactor code had no such state at all — this is a real gap this task closes, not a behavior carried over unchanged.

This component's own test file covers static/synchronous behavior with hand-built mutation-shaped props (`{ mutateAsync, isPending }`) plus the real `PostChip` hover-preview wiring (needs a real `QueryClientProvider`, since `PostChip` calls `useQuery` internally regardless of whether the tooltip is open). Timing-sensitive behavior that depends on a *real* `useMutation` state machine — the double-Enter guard and "keep the draft on a rejected send" — stays in the Task 6 integration suite, where it's exercised through the real `useMensagensData` hook exactly as today.

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/mensagens/components/__tests__/ConversationThread.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationThread } from '../ConversationThread';
import type { MensagemConversa, MensagemFeedItem } from '@/store';

const { mockPreview, mockMedia } = vi.hoisted(() => ({
  mockPreview: vi.fn(),
  mockMedia: vi.fn(),
}));

vi.mock('@/store', () => ({ getPostChipPreview: mockPreview }));
vi.mock('@/services/postMedia', () => ({ listPostMedia: mockMedia }));

// The repo's global afterEach calls vi.restoreAllMocks(), which strips a
// mockResolvedValue set only once at module scope — re-arm every test so a
// later test doesn't see these resolve to bare undefined (PostChip's
// useQuery flags that as an error, and it's order-dependent: only breaks
// when this file runs after another test already triggered the reset).
beforeEach(() => {
  mockPreview.mockResolvedValue(null);
  mockMedia.mockResolvedValue([]);
});

const CONVERSA: MensagemConversa = {
  cliente_id: 14,
  cliente_nome: 'ACME',
  cliente_foto_url: null,
  last_source: 'mensagem',
  last_action: null,
  last_content: 'Obrigado!',
  last_is_workspace_user: false,
  last_author_name: null,
  last_created_at: '2026-07-30T12:00:00.000Z',
  unread_count: 0,
};

const ITEMS: MensagemFeedItem[] = [
  {
    source: 'post_feedback',
    item_id: 1,
    cliente_id: 14,
    cliente_nome: 'ACME',
    post_id: 7,
    workflow_id: 3,
    post_titulo: 'Post de julho',
    action: 'correcao',
    content: 'Trocar a foto',
    is_workspace_user: false,
    author_user_id: null,
    author_name: null,
    author_avatar_url: null,
    created_at: '2026-07-30T10:00:00.000Z',
  },
  {
    source: 'mensagem',
    item_id: 2,
    cliente_id: 14,
    cliente_nome: 'ACME',
    post_id: null,
    workflow_id: null,
    post_titulo: null,
    action: null,
    content: 'Obrigado!',
    is_workspace_user: false,
    author_user_id: null,
    author_name: null,
    author_avatar_url: null,
    created_at: '2026-07-30T12:00:00.000Z',
  },
];

function makeFeed(overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [ITEMS] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ComponentProps<typeof ConversationThread>['feed'];
}

function makeMutation(overrides: Record<string, unknown> = {}) {
  return {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    ...overrides,
  } as unknown as ComponentProps<typeof ConversationThread>['sendGeneral'];
}

function renderThread(overrides: Partial<ComponentProps<typeof ConversationThread>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sendGeneral = makeMutation();
  const replyToPost = makeMutation();
  const utils = render(
    <QueryClientProvider client={qc}>
      <ConversationThread
        conversa={CONVERSA}
        feed={makeFeed()}
        sendGeneral={sendGeneral}
        replyToPost={replyToPost}
        clientesById={new Map()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { ...utils, sendGeneral, replyToPost };
}

describe('ConversationThread', () => {
  it('renders the header and messages in chronological order', () => {
    renderThread();
    expect(screen.getByText('ACME')).toBeInTheDocument();
    const bolhas = screen.getAllByText(/Trocar a foto|Obrigado!/);
    expect(bolhas[0]).toHaveTextContent('Trocar a foto');
  });

  it('shows a back button only when onBack is provided', () => {
    renderThread();
    expect(
      screen.queryByRole('button', { name: 'Voltar para as conversas' }),
    ).not.toBeInTheDocument();
    const onBack = vi.fn();
    renderThread({ onBack });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('filters visible items by tipo', () => {
    renderThread();
    fireEvent.click(screen.getByRole('button', { name: 'Aprovações' }));
    expect(screen.queryByText('Obrigado!')).not.toBeInTheDocument();
    expect(screen.getByText('Trocar a foto')).toBeInTheDocument();
  });

  it('sends a general message from the composer', async () => {
    const { sendGeneral } = renderThread();
    const input = screen.getByPlaceholderText('Enviar mensagem…');
    fireEvent.change(input, { target: { value: 'Olá' } });
    // enviar() is async (awaits mutateAsync before its own setState calls) —
    // wrap the triggering event in act() so those updates settle inside the
    // test instead of firing after it returns (that's what an un-awaited
    // fireEvent.keyDown here produces: a real "not wrapped in act(...)"
    // warning, not just theoretical noise).
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(sendGeneral.mutateAsync).toHaveBeenCalledWith({ cliente: 14, content: 'Olá' });
  });

  it('switches to the reply composer via Responder', () => {
    renderThread();
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    expect(screen.getByPlaceholderText('Responder sobre o post…')).toBeInTheDocument();
  });

  it('sends a reply with the post context via the composer', async () => {
    const { replyToPost, sendGeneral } = renderThread();
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    const input = screen.getByPlaceholderText('Responder sobre o post…');
    fireEvent.change(input, { target: { value: 'Feito' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(replyToPost.mutateAsync).toHaveBeenCalledWith({
      postId: 7,
      workflowId: 3,
      content: 'Feito',
    });
    expect(sendGeneral.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows a retriable error, not "no messages", when the feed fails to load', () => {
    const feed = makeFeed({ isError: true, data: undefined });
    renderThread({ feed });
    expect(screen.getByText('Não foi possível carregar as mensagens.')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma mensagem nesta conversa ainda.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(feed.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the hover preview with tipo, status and fluxo on the post chip', async () => {
    mockPreview.mockResolvedValueOnce({
      id: 7,
      titulo: 'Post de julho',
      tipo: 'feed',
      status: 'aprovado_cliente',
      scheduled_at: null,
      workflow_id: 3,
      workflow_titulo: 'Fluxo de agosto',
    });
    renderThread();
    const chip = screen.getByRole('link', { name: 'Post de julho' });
    fireEvent.mouseEnter(chip.parentElement!);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const card = await screen.findByTestId('post-hover-preview');
    expect(card).toHaveTextContent('Feed');
    expect(card).toHaveTextContent('Fluxo de agosto');
    fireEvent.mouseLeave(chip.parentElement!);
    await waitFor(() => expect(screen.queryByTestId('post-hover-preview')).not.toBeInTheDocument());
  });

  it('links the post chip to the post inside its fluxo, not just the fluxo', () => {
    renderThread();
    const chip = screen.getByRole('link', { name: 'Post de julho' });
    expect(chip).toHaveAttribute('href', '/entregas?drawer=3&post=7');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/mensagens/components/__tests__/ConversationThread.test.tsx`
Expected: FAIL — `Cannot find module '../ConversationThread'`.

- [ ] **Step 3: Implement `ConversationThread.tsx`**

Create `apps/crm/src/pages/mensagens/components/ConversationThread.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, FilePen, Send, X } from 'lucide-react';
import type { Cliente, MensagemConversa } from '@/store';
import type { useMensagensData } from '../hooks/useMensagensData';
import { AutorAvatar, ClienteAvatar } from './Avatars';
import { PostChip } from './PostChip';
import {
  eventLabel,
  feedItemKey,
  formatTime,
  isEventRow,
  matchesTipo,
  TIPO_FILTERS,
  type MensagensTipoFilter,
} from '../mensagensLogic';

type MensagensData = ReturnType<typeof useMensagensData>;

interface ConversationThreadProps {
  conversa: MensagemConversa;
  feed: MensagensData['feed'];
  sendGeneral: MensagensData['sendGeneral'];
  replyToPost: MensagensData['replyToPost'];
  clientesById: Map<number, Cliente>;
  /** Provided on mobile only — shows the back arrow and returns to /mensagens. */
  onBack?: () => void;
}

export function ConversationThread({
  conversa,
  feed,
  sendGeneral,
  replyToPost,
  clientesById,
  onBack,
}: ConversationThreadProps) {
  const [tipo, setTipo] = useState<MensagensTipoFilter>('todas');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{
    postId: number;
    workflowId: number;
    titulo: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Starts true so the very first settled render (including a cold deep
  // link) snaps to the newest message; sending sets it again. "Carregar
  // mensagens anteriores" never sets it, so that fetch doesn't force a
  // snap-to-bottom — it does NOT compensate scrollTop for the newly
  // prepended content's height either, so on a large older batch the
  // previously-topmost message can still end up below the fold. Same gap
  // as the pre-refactor code; real compensation is a follow-up, not part
  // of this task.
  const scrollPending = useRef(true);

  const itens = useMemo(() => {
    const all = (feed.data?.pages ?? []).flat().filter((i) => matchesTipo(i, tipo));
    return [...all].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [feed.data, tipo]);

  useEffect(() => {
    if (!scrollPending.current || feed.isLoading) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      scrollPending.current = false;
    }
  }, [feed.isLoading, itens.length]);

  async function enviar() {
    const text = draft.trim();
    if (!text || sendGeneral.isPending || replyToPost.isPending) return;
    try {
      if (replyTo) {
        await replyToPost.mutateAsync({
          postId: replyTo.postId,
          workflowId: replyTo.workflowId,
          content: text,
        });
      } else {
        await sendGeneral.mutateAsync({ cliente: conversa.cliente_id, content: text });
      }
      setDraft('');
      setReplyTo(null);
      scrollPending.current = true;
    } catch {
      toast.error('Não foi possível enviar a mensagem.');
    }
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Voltar para as conversas"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-main)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <ArrowLeft size={17} />
          </button>
        )}
        <ClienteAvatar
          nome={conversa.cliente_nome}
          fotoUrl={conversa.cliente_foto_url}
          cliente={clientesById.get(conversa.cliente_id)}
        />
        <span className="flex-1 truncate text-sm font-semibold">{conversa.cliente_nome}</span>
        <span className="flex gap-1">
          {TIPO_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setTipo(f.id)}
              className="rounded-full px-3 py-1.5 text-xs whitespace-nowrap"
              style={{
                border: 'none',
                cursor: 'pointer',
                background: tipo === f.id ? 'var(--text-main)' : 'transparent',
                color: tipo === f.id ? 'var(--card-bg)' : 'var(--text-muted)',
                fontWeight: tipo === f.id ? 600 : 400,
              }}
            >
              {f.label}
            </button>
          ))}
        </span>
      </div>

      <div
        ref={scrollRef}
        data-testid="thread-scroll"
        className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto p-4"
        style={{ background: 'var(--bg-color)' }}
      >
        {feed.hasNextPage && (
          <button
            onClick={() => feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
            className="self-center text-xs font-semibold text-[var(--text-muted)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            {feed.isFetchingNextPage ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </button>
        )}
        {feed.isError && (
          <div className="flex flex-col items-center gap-2 self-center py-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">Não foi possível carregar as mensagens.</p>
            <button
              onClick={() => feed.refetch()}
              className="text-sm font-semibold text-[var(--text-main)] hover:underline"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              Tentar novamente
            </button>
          </div>
        )}
        {!feed.isError && feed.isLoading && (
          <p className="self-center py-8 text-sm text-[var(--text-muted)]">Carregando…</p>
        )}
        {!feed.isError && !feed.isLoading && itens.length === 0 && (
          <p className="self-center py-8 text-sm text-[var(--text-muted)]">
            Nenhuma mensagem nesta conversa ainda.
          </p>
        )}
        {itens.map((m) => {
          const daEquipe = m.is_workspace_user;
          if (isEventRow(m)) {
            return (
              <div
                key={feedItemKey(m)}
                className="flex items-center gap-2 self-center text-xs text-[var(--text-muted)]"
              >
                {m.source === 'edit_suggestion' ? (
                  <FilePen size={13} />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                <span>{eventLabel(m)}</span>
                {m.post_id != null && m.workflow_id != null && (
                  <PostChip postId={m.post_id} workflowId={m.workflow_id} titulo={m.post_titulo} />
                )}
                <span>· {formatTime(m.created_at)}</span>
              </div>
            );
          }
          return (
            <div
              key={feedItemKey(m)}
              className={`flex max-w-[78%] items-end gap-2 ${daEquipe ? 'flex-row-reverse self-end' : 'self-start'}`}
            >
              <AutorAvatar
                item={m}
                cliente={clientesById.get(m.cliente_id)}
                clienteFotoUrl={conversa.cliente_foto_url}
              />
              <div className={`flex flex-col gap-1 ${daEquipe ? 'items-end' : 'items-start'}`}>
                <div
                  className="rounded-2xl px-3.5 py-2.5 text-sm"
                  style={{
                    background: daEquipe ? 'var(--surface-hover)' : 'var(--card-bg)',
                    boxShadow: 'inset 0 0 0 1px var(--border-color)',
                  }}
                >
                  {daEquipe && (
                    <div className="mb-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                      {m.author_name ?? 'Equipe'}
                    </div>
                  )}
                  {m.action === 'correcao' && (
                    <div className="mb-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                      Pediu correção
                    </div>
                  )}
                  {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
                  {m.post_id != null && m.workflow_id != null && (
                    <div className="mt-2 text-xs">
                      <PostChip postId={m.post_id} workflowId={m.workflow_id} titulo={m.post_titulo} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-light)]">
                  <span>{formatTime(m.created_at)}</span>
                  {m.post_id != null && m.workflow_id != null && (
                    <button
                      onClick={() =>
                        setReplyTo({
                          postId: m.post_id!,
                          workflowId: m.workflow_id!,
                          titulo: m.post_titulo ?? 'Post',
                        })
                      }
                      className="font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                      Responder
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--border-color)] p-3.5">
        {replyTo && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>
              Respondendo sobre: <strong>{replyTo.titulo}</strong>
            </span>
            <button
              onClick={() => setReplyTo(null)}
              aria-label="Cancelar resposta"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') enviar();
            }}
            placeholder={replyTo ? 'Responder sobre o post…' : 'Enviar mensagem…'}
            className="flex-1 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2.5 text-sm outline-none"
          />
          <button
            onClick={enviar}
            disabled={sendGeneral.isPending || replyToPost.isPending || !draft.trim()}
            aria-label="Enviar mensagem"
            className="rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50 bg-[var(--primary-color)]"
            style={{ border: 'none', cursor: 'pointer' }}
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

Three intentional differences from the JSX this was moved from: `scrollPending` now starts `true` (was `false` — deep links need the same snap-to-bottom that opening from a click always got); the scroll effect's dependency array drops `clienteId` (it can no longer change within one mounted instance — the parent remounts this component via `key={clienteId}` instead); and a `feed.isError` state was added (the original code had none — a failed message fetch silently rendered as an empty conversation).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/crm/src/pages/mensagens/components/__tests__/ConversationThread.test.tsx`
Expected: all 9 tests PASS, with clean console output (no `act(...)` warnings, no React Query errors) — the send/reply tests are wrapped in `act()` specifically to keep this clean.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/mensagens/components/ConversationThread.tsx apps/crm/src/pages/mensagens/components/__tests__/ConversationThread.test.tsx
git commit -m "feat(mensagens): add ConversationThread component for the split-pane thread"
```

---

## Task 5: Rewrite `MensagensPage.tsx` as the routing shell

**Files:**
- Modify: `apps/crm/src/pages/mensagens/MensagensPage.tsx` (full rewrite)

**Interfaces:**
- Consumes: `useIsDesktop` from `@/hooks/useIsDesktop` (existing); `useMensagensData` from `./hooks/useMensagensData` (Task 1); `ConversationList` (Task 3); `ConversationThread` (Task 4); `ThreadPlaceholder`/`ThreadNotFound`/`ThreadLoading`/`ThreadLoadError` (Task 2).
- Produces: the default-exported `MensagensPage` component, unchanged export signature (`export default function MensagensPage()`), so `App.tsx`'s lazy import needs no change.

This task has no dedicated test file — `MensagensPage.tsx` is exactly what Task 6 rewrites the integration suite against. Verify it manually against Task 6 in the next task; don't run the (currently stale) old `MensagensPage.test.tsx` against this new shell, it will fail across the board until Task 6 replaces it.

- [ ] **Step 1: Replace the file**

Replace the full contents of `apps/crm/src/pages/mensagens/MensagensPage.tsx`:

```tsx
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Cliente } from '@/store';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useMensagensData } from './hooks/useMensagensData';
import { ConversationList } from './components/ConversationList';
import { ConversationThread } from './components/ConversationThread';
import {
  ThreadLoadError,
  ThreadLoading,
  ThreadNotFound,
  ThreadPlaceholder,
} from './components/ThreadStatus';

export default function MensagensPage() {
  const { clienteId: clienteIdParam } = useParams();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();

  const hasParam = clienteIdParam != null;
  const parsedId = hasParam ? parseInt(clienteIdParam, 10) : NaN;
  const invalidId = hasParam && isNaN(parsedId);
  const clienteId = hasParam && !invalidId ? parsedId : null;

  const { feed, conversas, clientes, sendGeneral, replyToPost } = useMensagensData(clienteId);

  const clientesById = useMemo(() => {
    const map = new Map<number, Cliente>();
    for (const c of clientes.data ?? []) if (c.id != null) map.set(c.id, c);
    return map;
  }, [clientes.data]);

  function goToConversa(id: number) {
    navigate(`/mensagens/${id}`);
  }

  const onBack = !isDesktop ? () => navigate('/mensagens') : undefined;

  function renderThreadSlot() {
    if (invalidId) return <ThreadNotFound onBack={onBack} />;
    // Only reachable when isDesktop: on mobile with no id, showThread below
    // is false and the list fills the screen instead.
    if (clienteId == null) return <ThreadPlaceholder />;
    if (conversas.isLoading) return <ThreadLoading onBack={onBack} />;
    if (conversas.isError) {
      return <ThreadLoadError onRetry={() => conversas.refetch()} onBack={onBack} />;
    }
    const conversa = conversas.data?.find((c) => c.cliente_id === clienteId);
    if (!conversa) return <ThreadNotFound onBack={onBack} />;
    return (
      <ConversationThread
        key={clienteId}
        conversa={conversa}
        feed={feed}
        sendGeneral={sendGeneral}
        replyToPost={replyToPost}
        clientesById={clientesById}
        onBack={onBack}
      />
    );
  }

  const showList = isDesktop || (clienteId == null && !invalidId);
  const showThread = isDesktop || clienteId != null || invalidId;

  return (
    <div className="page-full-bleed flex min-h-0">
      {showList && (
        <ConversationList
          className={
            isDesktop ? 'w-[340px] shrink-0 border-r border-[var(--border-color)]' : 'flex-1'
          }
          conversas={conversas.data ?? []}
          isLoading={conversas.isLoading}
          isError={conversas.isError}
          selectedClienteId={clienteId}
          clientesById={clientesById}
          onSelect={goToConversa}
        />
      )}
      {showThread && renderThreadSlot()}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors. (The old `MensagensPage.test.tsx` will fail to *run* correctly against this — that's expected and fixed in Task 6, not this step; typecheck only checks the source, not the stale test file's assumptions about UI structure.)

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/mensagens/MensagensPage.tsx
git commit -m "refactor(mensagens): rewrite MensagensPage as a route-driven split-pane shell"
```

---

## Task 6: Rewrite `MensagensPage.test.tsx` as the shell integration suite

**Files:**
- Modify: `apps/crm/src/pages/mensagens/__tests__/MensagensPage.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: the real `MensagensPage` (Task 5), which pulls in the real `ConversationList` (Task 3) and `ConversationThread` (Task 4) — this suite is a true integration test through real routes, real `useMensagensData`, and mocked `@/store`.

Cases already covered by Task 3/4's own test files are **not** re-asserted here (list row rendering/sort/search/avatar; thread rendering/tipo-filter/Responder/hover-preview/chip-href). This file covers what only exists once the shell wires everything together: routing, desktop-vs-mobile pane visibility, the not-found/error precedence, state reset across a real navigation, and the mutation-timing-sensitive cases that need a real `useMutation`.

- [ ] **Step 1: Write the new test file**

Replace the full contents of `apps/crm/src/pages/mensagens/__tests__/MensagensPage.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockFeed, mockConversas, mockClientes, mockSend, mockReply, mockSeen } = vi.hoisted(() => ({
  mockFeed: vi.fn(),
  mockConversas: vi.fn(),
  mockClientes: vi.fn(),
  mockSend: vi.fn().mockResolvedValue(undefined),
  mockReply: vi.fn().mockResolvedValue(undefined),
  mockSeen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store', () => ({
  getMensagensFeed: mockFeed,
  getMensagensConversas: mockConversas,
  getClientes: mockClientes,
  sendMensagem: mockSend,
  replyToPostApproval: mockReply,
  markMensagensSeen: mockSeen,
}));

// PostChip's own hover-preview queries are covered by ConversationThread.test.tsx.
// Mocked here only so the real (Supabase-touching) module never loads.
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn() }));

import MensagensPage from '../MensagensPage';

const CONVERSAS = [
  {
    cliente_id: 14,
    cliente_nome: 'ACME',
    cliente_foto_url: null,
    last_source: 'mensagem',
    last_action: null,
    last_content: 'Obrigado!',
    last_is_workspace_user: false,
    last_author_name: null,
    last_created_at: '2026-07-30T12:00:00.000Z',
    unread_count: 2,
  },
  {
    cliente_id: 15,
    cliente_nome: 'Beta Corp',
    cliente_foto_url: 'https://cdn.example.com/beta.png',
    last_source: 'post_feedback',
    last_action: 'mensagem',
    last_content: 'Segue o ajuste combinado.',
    last_is_workspace_user: true,
    last_author_name: 'Ana',
    last_created_at: '2026-07-31T09:00:00.000Z',
    unread_count: 0,
  },
];

const ITEMS_14 = [
  {
    source: 'post_feedback',
    item_id: 1,
    cliente_id: 14,
    cliente_nome: 'ACME',
    post_id: 7,
    workflow_id: 3,
    post_titulo: 'Post de julho',
    action: 'correcao',
    content: 'Trocar a foto',
    is_workspace_user: false,
    author_user_id: null,
    author_name: null,
    author_avatar_url: null,
    created_at: '2026-07-30T10:00:00.000Z',
  },
  {
    source: 'mensagem',
    item_id: 2,
    cliente_id: 14,
    cliente_nome: 'ACME',
    post_id: null,
    workflow_id: null,
    post_titulo: null,
    action: null,
    content: 'Obrigado!',
    is_workspace_user: false,
    author_user_id: null,
    author_name: null,
    author_avatar_url: null,
    created_at: '2026-07-30T12:00:00.000Z',
  },
];

function PathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderPage(initialPath = '/mensagens') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/mensagens"
            element={
              <>
                <MensagensPage />
                <PathProbe />
              </>
            }
          />
          <Route
            path="/mensagens/:clienteId"
            element={
              <>
                <MensagensPage />
                <PathProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MensagensPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeed.mockImplementation(({ clienteId }: { clienteId?: number }) =>
      Promise.resolve(clienteId === 14 ? ITEMS_14 : []),
    );
    mockConversas.mockResolvedValue(CONVERSAS);
    mockClientes.mockResolvedValue([
      { id: 14, nome: 'ACME', sigla: 'AC', cor: '#3ecf8e' },
      { id: 15, nome: 'Beta Corp', sigla: 'BC', cor: '#42c8f5' },
    ]);
    mockSend.mockResolvedValue(undefined);
    mockReply.mockResolvedValue(undefined);
    mockSeen.mockResolvedValue(undefined);
  });

  it('mobile (default): shows only the list, opens a thread by URL, and returns via back', async () => {
    renderPage();
    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enviar mensagem…')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('conversa-14'));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/mensagens/14');
    await screen.findByText('Trocar a foto');
    expect(mockFeed).toHaveBeenCalledWith(expect.objectContaining({ clienteId: 14 }));
    expect(screen.queryByTestId('conversa-15')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/mensagens');
    expect(await screen.findByTestId('conversa-15')).toBeInTheDocument();
  });

  it('desktop: renders the list and the thread at the same time, with a placeholder until one is picked', async () => {
    mockMatchMedia(true);
    renderPage();
    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('Selecione uma conversa')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('conversa-14'));
    await screen.findByText('Trocar a foto');
    expect(screen.getByTestId('conversa-15')).toBeInTheDocument();
    expect(screen.queryByText('Selecione uma conversa')).not.toBeInTheDocument();
  });

  it('/mensagens/999 (unknown id) shows the not-found state with a link back', async () => {
    // On mobile (the default stub) onBack is defined, so ThreadNotFound
    // renders its BackButton instead of the static Link — force desktop so
    // the assertion below is checking the mode that actually has a link.
    mockMatchMedia(true);
    renderPage('/mensagens/999');
    expect(await screen.findByText('Conversa não encontrada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para as conversas' })).toHaveAttribute(
      'href',
      '/mensagens',
    );
    expect(mockFeed).not.toHaveBeenCalled();
  });

  it('/mensagens/abc (non-numeric id) shows not-found immediately without fetching', async () => {
    renderPage('/mensagens/abc');
    expect(await screen.findByText('Conversa não encontrada.')).toBeInTheDocument();
    expect(mockFeed).not.toHaveBeenCalled();
  });

  it('shows a retriable error, not "not found", when the conversation list fails to load', async () => {
    mockConversas.mockRejectedValueOnce(new Error('network'));
    renderPage('/mensagens/14');
    expect(await screen.findByText('Não foi possível carregar as conversas.')).toBeInTheDocument();
    expect(screen.queryByText('Conversa não encontrada.')).not.toBeInTheDocument();

    mockConversas.mockResolvedValueOnce(CONVERSAS);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Trocar a foto');
  });

  it('resets thread-scoped state (reply target, draft) when switching conversations', async () => {
    mockMatchMedia(true);
    renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    expect(screen.getByPlaceholderText('Responder sobre o post…')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('conversa-15'));
    await waitFor(() => expect(screen.getByPlaceholderText('Enviar mensagem…')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Enviar mensagem…'), { target: { value: 'Olá' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Enviar mensagem…'), { key: 'Enter' });
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(15, 'Olá'));
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('does not disturb an open thread when the list is filtered to a different client', async () => {
    mockMatchMedia(true);
    renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');

    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'beta' } });
    expect(screen.queryByTestId('conversa-14')).not.toBeInTheDocument();
    expect(screen.getByText('Trocar a foto')).toBeInTheDocument();
  });

  it('marks the feed seen on mount', async () => {
    renderPage();
    await waitFor(() => expect(mockSeen).toHaveBeenCalledTimes(1));
  });

  it('does not fetch the feed when no conversation is selected', async () => {
    renderPage();
    await screen.findByText('ACME');
    expect(mockFeed).not.toHaveBeenCalled();
  });

  it('fetches the feed for a deep-linked conversation and scrolls to the newest message', async () => {
    let resolveFeed!: (items: typeof ITEMS_14) => void;
    mockFeed.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFeed = resolve;
        }),
    );

    renderPage('/mensagens/14');
    const scrollEl = await screen.findByTestId('thread-scroll');
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 999, configurable: true });
    const scrollTopSpy = vi.fn();
    Object.defineProperty(scrollEl, 'scrollTop', {
      get: () => 0,
      set: scrollTopSpy,
      configurable: true,
    });

    await act(async () => {
      resolveFeed(ITEMS_14);
      await Promise.resolve();
    });
    await screen.findByText('Trocar a foto');

    expect(scrollTopSpy).toHaveBeenCalledWith(999);
  });

  it('replies to a post via the Responder flow', async () => {
    renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    const input = screen.getByPlaceholderText('Responder sobre o post…');
    fireEvent.change(input, { target: { value: 'Feito' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockReply).toHaveBeenCalledWith(7, 3, 'Feito'));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not send twice on a rapid double Enter', async () => {
    let resolveSend!: () => void;
    mockSend.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');
    const input = screen.getByPlaceholderText('Enviar mensagem…');
    fireEvent.change(input, { target: { value: 'Olá' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled(),
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    resolveSend();
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('keeps the reply draft when the send fails', async () => {
    mockReply.mockRejectedValueOnce(new Error('network error'));
    renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    const input = screen.getByPlaceholderText('Responder sobre o post…');
    fireEvent.change(input, { target: { value: 'Feito' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockReply).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByPlaceholderText('Responder sobre o post…')).toHaveValue('Feito');
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run apps/crm/src/pages/mensagens/__tests__/MensagensPage.test.tsx`
Expected: all 13 tests PASS.

- [ ] **Step 3: Run the whole `mensagens` directory**

Run: `npx vitest run apps/crm/src/pages/mensagens`
Expected: `MensagensPage.test.tsx` (13), `ConversationList.test.tsx` (7), `ConversationThread.test.tsx` (9), `ThreadStatus.test.tsx` (6), `mensagensLogic.test.ts` (pre-existing, unchanged) all PASS.

- [ ] **Step 4: Full typecheck + lint**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/mensagens/__tests__/MensagensPage.test.tsx
git commit -m "test(mensagens): rewrite MensagensPage suite for the split-pane shell"
```

---

## Task 7: Manual browser verification + full pre-push check

**Files:** none (verification only, plus the spec status line)

- [ ] **Step 1: Start the CRM dev server and open Mensagens**

Start the dev server (`npm run dev` or the project's preview tooling) and navigate to `/mensagens`, logged in as a user whose workspace has at least two conversations with feed activity (matches the CLAUDE.md rule: UI changes get verified in a real browser, not just jsdom — flex widths, the full-bleed height fill, and the 768px collapse are exactly the kind of thing jsdom cannot evaluate).

- [ ] **Step 2: Verify desktop (≥768px)**

- List pane is a fixed ~340px column on the left with its own scrollbar when the list is long; thread pane fills the rest.
- With nothing selected, the right pane shows the "Selecione uma conversa" placeholder.
- Clicking a conversation opens it on the right while the list stays visible and the selected row is visibly highlighted.
- The whole thing fills the viewport below the topbar with no page-level scrollbar (only the list and the thread body scroll internally).
- Resize the window down through 768px and confirm the layout switches to single-pane at the same point `useIsDesktop`'s default targets.

- [ ] **Step 3: Verify mobile (<768px)**

- Only the list shows initially; opening a conversation shows only the thread with a working back button; URL reflects `/mensagens` and `/mensagens/<id>` respectively.

- [ ] **Step 4: Verify deep-linking**

- Copy a conversation's URL (e.g. `/mensagens/14`), reload the page cold, and confirm it opens directly into that thread instead of the list.

- [ ] **Step 5: Full pre-push suite**

Run, in order:

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

Expected: all green. `npm run test:functions` is part of CLAUDE.md's standing pre-push checklist unconditionally — run it even though this change touches no edge function.

- [ ] **Step 6: Update the spec status**

In `docs/superpowers/specs/2026-08-16-mensagens-split-pane-design.md`, change:

```
**Status:** design approved, awaiting implementation plan
```

to:

```
**Status:** implemented
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-16-mensagens-split-pane-design.md
git commit -m "docs(mensagens): mark split-pane spec as implemented"
```
