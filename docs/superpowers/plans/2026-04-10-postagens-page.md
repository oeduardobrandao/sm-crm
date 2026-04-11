# Postagens Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/postagens` hub page that lists all client posts (grouped by workflow/campaign) with full content, properties, comment thread, and inline approval actions.

**Architecture:** The existing `PostCard` component in `AprovacoesPage.tsx` is extracted to a shared `apps/hub/src/components/PostCard.tsx`. The edge function gains a `workflow_titulo` join. `PostagensPage` reuses `PostCard` and groups posts by workflow. `AprovacoesPage` is slimmed down to just use the shared component.

**Tech Stack:** React, React Router v6, TanStack Query, Tailwind CSS, Lucide icons, Supabase Edge Functions (Deno)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/functions/hub-posts/index.ts` | Modify | Add `workflow_titulo` join to post select |
| `apps/hub/src/types.ts` | Modify | Add `workflow_titulo: string` to `HubPost` |
| `apps/hub/src/components/PostCard.tsx` | Create | Shared expandable post card with approval actions |
| `apps/hub/src/pages/AprovacoesPage.tsx` | Modify | Remove inline `PostCard`/`PropertyRow`, import shared component |
| `apps/hub/src/pages/PostagensPage.tsx` | Create | Grouped list page using shared `PostCard` |
| `apps/hub/src/router.tsx` | Modify | Add `postagens` route |
| `apps/hub/src/shell/HubNav.tsx` | Modify | Add "Postagens" nav item |

---

## Task 1: Add `workflow_titulo` to edge function

**Files:**
- Modify: `supabase/functions/hub-posts/index.ts`

- [ ] **Step 1: Update the select query to join workflows**

In `supabase/functions/hub-posts/index.ts`, replace the posts select (lines ~50-54) with:

```typescript
  const { data: posts } = await db
    .from("workflow_posts")
    .select("id, titulo, tipo, status, ordem, conteudo_plain, scheduled_at, workflow_id, workflows(titulo)")
    .in("workflow_id", workflowIds)
    .order("scheduled_at", { ascending: true });
```

- [ ] **Step 2: Flatten `workflow_titulo` onto each post row**

After the select, replace the `postIds` line and add a mapping step:

```typescript
  const flatPosts = (posts ?? []).map((p: any) => {
    const { workflows, ...rest } = p;
    return { ...rest, workflow_titulo: workflows?.titulo ?? '' };
  });

  const postIds = flatPosts.map((p: { id: number }) => p.id);
```

Then update the two places that reference `posts ?? []` to use `flatPosts`:
- The `postIds` derivation (already done above)
- The final `return json(...)` line — change `posts: posts ?? []` to `posts: flatPosts`

The final return should be:
```typescript
  return json({ posts: flatPosts, postApprovals: postApprovals ?? [], propertyValues: propertyValues ?? [], workflowSelectOptions: workflowSelectOptions ?? [] });
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/hub-posts/index.ts
git commit -m "feat(hub-posts): add workflow_titulo to post response"
```

---

## Task 2: Update `HubPost` type

**Files:**
- Modify: `apps/hub/src/types.ts`

- [ ] **Step 1: Add `workflow_titulo` field**

In `apps/hub/src/types.ts`, update the `HubPost` interface (currently ends at `scheduled_at: string | null`) to add:

```typescript
export interface HubPost {
  id: number;
  titulo: string;
  tipo: 'feed' | 'reels' | 'stories' | 'carrossel';
  status: 'rascunho' | 'em_producao' | 'enviado_cliente' | 'aprovado_cliente' | 'correcao_cliente' | 'agendado' | 'publicado';
  ordem: number;
  conteudo_plain: string;
  scheduled_at: string | null;
  workflow_id: number;
  workflow_titulo: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub/src/types.ts
git commit -m "feat(hub): add workflow_titulo to HubPost type"
```

---

## Task 3: Extract shared `PostCard` component

**Files:**
- Create: `apps/hub/src/components/PostCard.tsx`

The existing `PostCard` in `AprovacoesPage.tsx` takes `token` directly. We change the interface to use `onApprovalSubmitted` callback (the page owns query invalidation), which makes the component reusable without coupling it to the token.

- [ ] **Step 1: Create `apps/hub/src/components/PostCard.tsx`**

```typescript
import { useState } from 'react';
import { CheckCircle, AlertCircle, ChevronDown, ChevronUp, MessageSquare, Send } from 'lucide-react';
import { submitApproval } from '../api';
import type { HubPost, PostApproval, HubPostProperty, HubSelectOption } from '../types';

export const TIPO_LABEL: Record<string, string> = {
  feed: 'Feed', reels: 'Reels', stories: 'Stories', carrossel: 'Carrossel',
};

export const STATUS_LABEL: Record<string, string> = {
  enviado_cliente: 'Aguardando aprovação',
  aprovado_cliente: 'Aprovado',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  publicado: 'Publicado',
  rascunho: 'Rascunho',
  em_producao: 'Em produção',
};

export function formatDate(d: string | null) {
  if (!d) return '—';
  const raw = d.includes('T') ? d : `${d}T00:00:00`;
  return new Date(raw).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sanitizeUrl(url: string) {
  return url.startsWith('http') ? url : `https://${url}`;
}

type PropDef = HubPostProperty['template_property_definitions'];
type SelectOpt = { id: string; label: string; color: string };

function resolveOptions(def: PropDef, workflowSelectOptions: HubSelectOption[], workflowId?: number): SelectOpt[] {
  const templateOpts: SelectOpt[] = (def.config?.options ?? []).map(o => ({ id: o.id, label: o.label, color: o.color }));
  const workflowOpts: SelectOpt[] = workflowSelectOptions
    .filter(o => workflowId == null || o.workflow_id === workflowId)
    .map(o => ({ id: o.option_id, label: o.label, color: o.color }));
  return [...templateOpts, ...workflowOpts];
}

function PropertyRow({ prop, workflowSelectOptions, workflowId }: { prop: HubPostProperty; workflowSelectOptions: HubSelectOption[]; workflowId: number }) {
  const def = prop.template_property_definitions;
  const value = prop.value;

  const renderValue = () => {
    if (value === null || value === undefined || value === '') {
      return <span className="text-muted-foreground italic text-sm">—</span>;
    }
    if (def.type === 'url') {
      const safe = sanitizeUrl(String(value));
      return (
        <a href={safe} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      );
    }
    if (def.type === 'date') {
      return <span className="text-sm">{new Date(String(value)).toLocaleDateString('pt-BR')}</span>;
    }
    if (def.type === 'checkbox') {
      return <span className="text-sm">{value ? 'Sim' : 'Não'}</span>;
    }
    if (def.type === 'select' || def.type === 'status') {
      const options = resolveOptions(def, workflowSelectOptions, workflowId);
      const opt = options.find(o => o.id === value);
      if (!opt) return <span className="text-sm text-muted-foreground italic">—</span>;
      return (
        <span className="text-xs px-2 py-0.5 rounded-full border" style={{ background: opt.color + '22', color: opt.color, borderColor: opt.color + '55' }}>
          {opt.label}
        </span>
      );
    }
    if (def.type === 'multiselect') {
      const options = resolveOptions(def, workflowSelectOptions, workflowId);
      const selected = (value as string[]).map(id => options.find(o => o.id === id)).filter(Boolean) as SelectOpt[];
      if (selected.length === 0) return <span className="text-sm text-muted-foreground italic">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {selected.map(opt => (
            <span key={opt.id} className="text-xs px-2 py-0.5 rounded-full border" style={{ background: opt.color + '22', color: opt.color, borderColor: opt.color + '55' }}>
              {opt.label}
            </span>
          ))}
        </div>
      );
    }
    return <span className="text-sm">{String(value)}</span>;
  };

  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0">
      <span className="text-sm text-muted-foreground w-36 shrink-0 pt-0.5">{def.name}</span>
      <div className="flex-1 min-w-0">{renderValue()}</div>
    </div>
  );
}

export interface PostCardProps {
  post: HubPost;
  token: string;
  approvals: PostApproval[];
  propertyValues: HubPostProperty[];
  workflowSelectOptions: HubSelectOption[];
  onApprovalSubmitted: () => void;
}

export function PostCard({ post, token, approvals, propertyValues, workflowSelectOptions, onApprovalSubmitted }: PostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const isPending = post.status === 'enviado_cliente';
  const postApprovals = approvals.filter(a => a.post_id === post.id);
  const postProperties = propertyValues.filter(p => p.post_id === post.id);

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

  async function handleReply() {
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      await submitApproval(token, post.id, 'mensagem', replyText.trim());
      setReplyText('');
      onApprovalSubmitted();
    } catch {
      // silent
    } finally {
      setSendingReply(false);
    }
  }

  const statusColor = post.status === 'correcao_cliente'
    ? 'bg-red-50 text-red-700'
    : isPending
    ? 'bg-yellow-100 text-yellow-800'
    : 'bg-green-100 text-green-800';

  return (
    <div className="border rounded-xl bg-white overflow-hidden">
      <button
        className="w-full flex items-start justify-between gap-2 p-4 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs bg-muted px-2 py-0.5 rounded-full font-medium">{TIPO_LABEL[post.tipo] ?? post.tipo}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
              {STATUS_LABEL[post.status] ?? post.status}
            </span>
          </div>
          <p className="font-semibold text-sm">{post.titulo}</p>
          {post.scheduled_at && <p className="text-xs text-muted-foreground mt-1">{formatDate(post.scheduled_at)}</p>}
        </div>
        <span className="text-muted-foreground mt-0.5 shrink-0">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-4">
          {post.conteudo_plain && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{post.conteudo_plain}</p>
          )}

          {postProperties.length > 0 && (
            <div className="rounded-lg border bg-muted/40 px-3 py-1">
              <p className="text-[0.65rem] font-bold uppercase tracking-wider text-muted-foreground pt-2 pb-1">Propriedades</p>
              {postProperties.map((p, i) => (
                <PropertyRow key={i} prop={p} workflowSelectOptions={workflowSelectOptions} workflowId={post.workflow_id} />
              ))}
            </div>
          )}

          {postApprovals.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
                <MessageSquare size={12} /> Comentários
              </div>
              {postApprovals.map(a => {
                const isTeam = a.is_workspace_user;
                const label = isTeam
                  ? 'Equipe'
                  : a.action === 'correcao' ? 'Correção solicitada'
                  : a.action === 'aprovado' ? 'Aprovado'
                  : 'Você';
                const date = new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={a.id} className={`rounded-xl px-3 py-2.5 text-sm ${isTeam ? 'bg-amber-50 ml-8' : 'bg-muted mr-8'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-semibold text-xs ${isTeam ? 'text-amber-800' : ''}`}>{label}</span>
                      <span className="text-xs text-muted-foreground">{date}</span>
                    </div>
                    {a.comentario && <p className="text-sm">{a.comentario}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {!isPending && (
            <div className="flex items-center gap-2">
              <input
                className="flex-1 border rounded-xl px-3 py-2 text-sm bg-muted/30 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Enviar mensagem…"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
              />
              <button
                className="shrink-0 rounded-xl p-2 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                disabled={sendingReply || !replyText.trim()}
                onClick={handleReply}
              >
                <Send size={15} />
              </button>
            </div>
          )}

          {isPending && !result && (
            <div className="space-y-2">
              <textarea
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Comentário (opcional)…"
                className="w-full border rounded-xl p-3 text-sm resize-none min-h-[64px] bg-muted/30 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction('aprovado')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle size={15} /> Aprovar
                </button>
                <button
                  onClick={() => handleAction('correcao')}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 border text-destructive rounded-xl py-2.5 text-sm font-semibold hover:bg-destructive/5 disabled:opacity-50 transition-colors"
                >
                  <AlertCircle size={15} /> Solicitar correção
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className={`rounded-xl p-3 text-sm font-medium ${result.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub/src/components/PostCard.tsx
git commit -m "feat(hub): extract shared PostCard component"
```

---

## Task 4: Refactor `AprovacoesPage` to use shared `PostCard`

**Files:**
- Modify: `apps/hub/src/pages/AprovacoesPage.tsx`

- [ ] **Step 1: Replace file contents**

The entire file becomes:

```typescript
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCard } from '../components/PostCard';

export function AprovacoesPage() {
  const { token } = useHub();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const approvals = data?.postApprovals ?? [];
  const propertyValues = data?.propertyValues ?? [];
  const workflowSelectOptions = data?.workflowSelectOptions ?? [];
  const pending = (data?.posts ?? [])
    .filter(p => p.status === 'enviado_cliente')
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-1">Aprovações</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {pending.length === 0
          ? 'Nenhum post aguardando aprovação.'
          : `${pending.length} post${pending.length > 1 ? 's' : ''} aguardando sua aprovação.`}
      </p>
      <div className="space-y-3">
        {pending.map(post => (
          <PostCard
            key={post.id}
            post={post}
            token={token}
            approvals={approvals}
            propertyValues={propertyValues}
            workflowSelectOptions={workflowSelectOptions}
            onApprovalSubmitted={() => qc.invalidateQueries({ queryKey: ['hub-posts', token] })}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub/src/pages/AprovacoesPage.tsx
git commit -m "refactor(hub): use shared PostCard in AprovacoesPage"
```

---

## Task 5: Create `PostagensPage`

**Files:**
- Create: `apps/hub/src/pages/PostagensPage.tsx`

- [ ] **Step 1: Create the file**

```typescript
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useHub } from '../HubContext';
import { fetchPosts } from '../api';
import { PostCard } from '../components/PostCard';
import type { HubPost } from '../types';

const VISIBLE_STATUSES = new Set<HubPost['status']>([
  'enviado_cliente', 'aprovado_cliente', 'correcao_cliente', 'agendado', 'publicado',
]);

export function PostagensPage() {
  const { token } = useHub();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-posts', token],
    queryFn: () => fetchPosts(token),
  });

  const allPosts = (data?.posts ?? []).filter(p => VISIBLE_STATUSES.has(p.status));
  const approvals = data?.postApprovals ?? [];
  const propertyValues = data?.propertyValues ?? [];
  const workflowSelectOptions = data?.workflowSelectOptions ?? [];

  // Group by workflow_id, sorted by workflow_titulo alphabetically
  const groups = Object.values(
    allPosts.reduce<Record<number, { titulo: string; posts: HubPost[] }>>((acc, post) => {
      if (!acc[post.workflow_id]) {
        acc[post.workflow_id] = { titulo: post.workflow_titulo, posts: [] };
      }
      acc[post.workflow_id].posts.push(post);
      return acc;
    }, {})
  ).sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));

  // Within each group: sort by scheduled_at asc (nulls last), then by ordem
  groups.forEach(g => {
    g.posts.sort((a, b) => {
      if (!a.scheduled_at && !b.scheduled_at) return a.ordem - b.ordem;
      if (!a.scheduled_at) return 1;
      if (!b.scheduled_at) return -1;
      const diff = a.scheduled_at.localeCompare(b.scheduled_at);
      return diff !== 0 ? diff : a.ordem - b.ordem;
    });
  });

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  if (isError) return (
    <div className="max-w-2xl mx-auto py-20 text-center text-sm text-muted-foreground">
      Erro ao carregar postagens.
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Postagens</h2>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma postagem disponível ainda.</p>
      ) : (
        <div className="space-y-10">
          {groups.map(group => (
            <section key={group.titulo}>
              <h3 className="text-base font-semibold mb-3 text-foreground">{group.titulo}</h3>
              <div className="space-y-3">
                {group.posts.map(post => (
                  <PostCard
                    key={post.id}
                    post={post}
                    token={token}
                    approvals={approvals}
                    propertyValues={propertyValues}
                    workflowSelectOptions={workflowSelectOptions}
                    onApprovalSubmitted={() => qc.invalidateQueries({ queryKey: ['hub-posts', token] })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/hub/src/pages/PostagensPage.tsx
git commit -m "feat(hub): add PostagensPage grouped by workflow"
```

---

## Task 6: Add route and nav item

**Files:**
- Modify: `apps/hub/src/router.tsx`
- Modify: `apps/hub/src/shell/HubNav.tsx`

- [ ] **Step 1: Add route to `router.tsx`**

```typescript
import { createBrowserRouter } from 'react-router-dom';
import { HubShell } from './shell/HubShell';
import { HomePage } from './pages/HomePage';
import { AprovacoesPage } from './pages/AprovacoesPage';
import { MarcaPage } from './pages/MarcaPage';
import { PaginasPage } from './pages/PaginasPage';
import { PaginaPage } from './pages/PaginaPage';
import { BriefingPage } from './pages/BriefingPage';
import { PostagensPage } from './pages/PostagensPage';

export const router = createBrowserRouter([
  {
    path: '/:workspace/hub/:token',
    element: <HubShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'aprovacoes', element: <AprovacoesPage /> },
      { path: 'postagens', element: <PostagensPage /> },
      { path: 'marca', element: <MarcaPage /> },
      { path: 'paginas', element: <PaginasPage /> },
      { path: 'paginas/:pageId', element: <PaginaPage /> },
      { path: 'briefing', element: <BriefingPage /> },
    ],
  },
  { path: '*', element: <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}><p style={{ fontFamily: 'sans-serif', color: '#666' }}>Link inválido.</p></div> },
]);
```

- [ ] **Step 2: Add nav item to `HubNav.tsx`**

```typescript
import { Link, useLocation, useParams } from 'react-router-dom';
import { Home, CheckSquare, Palette, FileText, BookOpen, LayoutList } from 'lucide-react';
import { useHub } from '../HubContext';

const NAV_ITEMS = [
  { label: 'Home', icon: Home, path: '' },
  { label: 'Aprovações', icon: CheckSquare, path: '/aprovacoes' },
  { label: 'Postagens', icon: LayoutList, path: '/postagens' },
  { label: 'Marca', icon: Palette, path: '/marca' },
  { label: 'Páginas', icon: FileText, path: '/paginas' },
  { label: 'Briefing', icon: BookOpen, path: '/briefing' },
];

export function HubNav() {
  const { bootstrap } = useHub();
  const { workspace, token } = useParams<{ workspace: string; token: string }>();
  const { pathname } = useLocation();
  const base = `/${workspace}/hub/${token}`;

  return (
    <>
      {/* Desktop top bar */}
      <header className="hidden md:flex items-center gap-6 px-6 py-3 border-b border-zinc-800 bg-black text-white sticky top-0 z-10">
        <div className="flex items-center gap-2 mr-4">
          {bootstrap.workspace.logo_url && (
            <img src={bootstrap.workspace.logo_url} alt={bootstrap.workspace.name} className="h-7 w-auto object-contain" />
          )}
          <span className="font-semibold text-sm">{bootstrap.workspace.name}</span>
        </div>
        {NAV_ITEMS.map(({ label, path }) => {
          const href = `${base}${path}`;
          const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
          return (
            <Link key={path} to={href} className={`text-sm transition-colors ${active ? 'font-semibold text-white' : 'text-zinc-400 hover:text-white'}`}>
              {label}
            </Link>
          );
        })}
        <span className="ml-auto text-sm text-zinc-400">{bootstrap.cliente_nome}</span>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-black border-t border-zinc-800 z-10 flex">
        {NAV_ITEMS.map(({ label, icon: Icon, path }) => {
          const href = `${base}${path}`;
          const active = path === '' ? pathname === base : pathname.startsWith(`${base}${path}`);
          return (
            <Link key={path} to={href} className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${active ? 'text-white font-medium' : 'text-zinc-400'}`}>
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/hub/src/router.tsx apps/hub/src/shell/HubNav.tsx
git commit -m "feat(hub): add Postagens route and nav item"
```
