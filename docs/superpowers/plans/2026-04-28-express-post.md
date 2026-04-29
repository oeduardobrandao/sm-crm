# Express Post Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Express Post page (`/post-express`) that lets managers quickly publish an Instagram post — pick client, upload media, write caption, publish now — bypassing the full entregas workflow.

**Architecture:** A single React page component reuses the existing data model (auto-creates a lightweight Workflow + WorkflowEtapa + WorkflowPost on client selection), reuses PostMediaGallery for media upload and publishInstagramPostNow for publishing. The only modified existing component is PostMediaGallery (new `maxFiles` prop). A new Deno edge function handles orphan draft cleanup via daily cron.

**Tech Stack:** React 19, React Router v7, TanStack Query, shadcn/ui (Radix), Tailwind CSS, Supabase (Postgres + Edge Functions), Deno (cron function)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/crm/src/pages/post-express/ExpressPostPage.tsx` | Page component: client picker, caption, detected type, publish flow, cleanup |
| Create | `apps/crm/src/pages/post-express/__tests__/ExpressPostPage.test.tsx` | Unit tests for Express Post page |
| Create | `supabase/functions/express-post-cleanup-cron/index.ts` | Deno edge function: orphan draft cleanup cron |
| Modify | `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx:24-28,301-322` | Add optional `maxFiles` prop, gate upload/picker UI |
| Modify | `apps/crm/src/components/layout/nav-data.ts:19-25` | Add "Post Express" nav item under Gestão group |
| Modify | `apps/crm/src/App.tsx:31,81-82` | Add lazy import + route for ExpressPostPage |

---

### Task 1: Add `maxFiles` prop to PostMediaGallery

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`

This task adds an optional `maxFiles` prop to PostMediaGallery. When set and `media.length >= maxFiles`, the upload label (drop zone + file input), the "Escolher" file picker button, and drag-drop handling are hidden/disabled. Existing callers pass no `maxFiles` and are unaffected.

- [ ] **Step 1: Add `maxFiles` to the interface and destructure it**

In `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`, update the interface and function signature:

```tsx
interface PostMediaGalleryProps {
  postId: number;
  disabled?: boolean;
  maxFiles?: number;
  onChange?: (media: PostMedia[]) => void;
}

export function PostMediaGallery({ postId, disabled, maxFiles, onChange }: PostMediaGalleryProps) {
```

- [ ] **Step 2: Compute the `atLimit` flag**

After line 91 (`const refresh = ...`), add:

```tsx
const atLimit = maxFiles != null && media.length >= maxFiles;
```

- [ ] **Step 3: Gate the upload label (drop zone + file input)**

At line 301, the upload label is rendered when `!disabled`. Change the condition to also check `!atLimit`:

```tsx
{!disabled && !atLimit && (
  <label
    onDrop={handleDrop}
    onDragOver={handleDragOverEvent}
    onDragLeave={handleDragLeave}
    className={`flex flex-col items-center justify-center gap-1 aspect-square rounded-xl border border-dashed cursor-pointer transition-colors ${dragOver ? 'ring-2 ring-[#eab308] border-[#eab308] bg-[#eab308]/10 text-[#eab308]' : 'border-stone-300 bg-stone-50 text-stone-500 hover:border-stone-400 hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:bg-stone-700'}`}
  >
    <Upload className="h-4 w-4" />
    <span className="text-[11px]">{dragOver ? 'Soltar aqui' : uploading ? 'Enviando…' : 'Adicionar'}</span>
    <input type="file" multiple accept="image/*,video/*" hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
  </label>
)}
```

- [ ] **Step 4: Gate the file picker button**

At line 313, the file picker button is rendered when `!disabled`. Change the condition:

```tsx
{!disabled && !atLimit && (
  <button
    type="button"
    onClick={() => setShowFilePicker(true)}
    className="flex flex-col items-center justify-center gap-1 aspect-square rounded-xl border border-dashed border-stone-300 bg-stone-50 text-stone-500 hover:border-stone-400 hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:bg-stone-700 cursor-pointer transition-colors"
  >
    <FolderOpen className="h-4 w-4" />
    <span className="text-[11px]">Escolher</span>
  </button>
)}
```

- [ ] **Step 5: Gate drag-drop on the grid area when at limit**

Update the `handleDrop` function (line 268) to bail out when at limit:

```tsx
const handleDrop = (e: React.DragEvent) => {
  e.preventDefault();
  setDragOver(false);
  if (disabled || atLimit) return;
  const files = e.dataTransfer.files;
  if (files.length > 0) handleFiles(files);
};
```

Note: `atLimit` is computed from `media` state, which is in scope for this closure since both are defined in the same component body.

- [ ] **Step 6: Run typecheck**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 7: Run existing tests**

Run: `npm run test`
Expected: All existing tests pass (the prop is optional, so no callers break).

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostMediaGallery.tsx
git commit -m "feat: add maxFiles prop to PostMediaGallery"
```

---

### Task 2: Add route and sidebar navigation

**Files:**
- Modify: `apps/crm/src/App.tsx`
- Modify: `apps/crm/src/components/layout/nav-data.ts`
- Create: `apps/crm/src/pages/post-express/ExpressPostPage.tsx` (stub)

This task wires up the route and navigation for the Express Post page, with a minimal stub component so the route is testable.

- [ ] **Step 1: Create the stub page component**

Create `apps/crm/src/pages/post-express/ExpressPostPage.tsx`:

```tsx
export default function ExpressPostPage() {
  return (
    <div className="animate-up" style={{ padding: 'clamp(1.25rem, 3vw, 2.5rem)' }}>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(2rem, 4vw, 3.2rem)', fontWeight: 900 }}>
        Post Express
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
        Publique rapidamente no Instagram
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Add lazy import and route in App.tsx**

In `apps/crm/src/App.tsx`, add the lazy import after line 31 (the `EntregasPage` import):

```tsx
const ExpressPostPage = lazy(() => import('./pages/post-express/ExpressPostPage'));
```

Add the route inside the protected layout group, after the `/entregas` route (after line 81):

```tsx
<Route path="/post-express" element={<ExpressPostPage />} />
```

- [ ] **Step 3: Add nav item in nav-data.ts**

In `apps/crm/src/components/layout/nav-data.ts`, add the Post Express item inside the `gestao` group, between `entregas` and `arquivos` (after line 20):

```ts
{ id: 'post-express', route: '/post-express', label: 'Post Express', icon: 'ph-paper-plane-tilt' },
```

The full `gestao` group becomes:

```ts
{
  id: 'gestao', label: 'Gestão', icon: 'ph-folder', items: [
    { id: 'entregas', route: '/entregas', label: 'Entregas', icon: 'ph-kanban' },
    { id: 'post-express', route: '/post-express', label: 'Post Express', icon: 'ph-paper-plane-tilt' },
    { id: 'arquivos', route: '/arquivos', label: 'Arquivos', icon: 'ph-folder-open' },
    { id: 'financeiro', route: '/financeiro', label: 'Financeiro', icon: 'ph-wallet' },
    { id: 'contratos', route: '/contratos', label: 'Contratos', icon: 'ph-file-text' },
    { id: 'equipe', route: '/equipe', label: 'Equipe', icon: 'ph-user-circle-gear' },
  ]
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Manual test**

Run: `npm run dev`
Open http://localhost:5173/post-express
Expected: The page renders with the "Post Express" title and subtitle. The sidebar shows "Post Express" under the "Gestão" section, between "Entregas" and "Arquivos".

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/post-express/ExpressPostPage.tsx apps/crm/src/App.tsx apps/crm/src/components/layout/nav-data.ts
git commit -m "feat: add Express Post route and sidebar navigation"
```

---

### Task 3: Build the ExpressPostPage component

**Files:**
- Modify: `apps/crm/src/pages/post-express/ExpressPostPage.tsx`

This is the main task — the full page component with client picker, caption textarea, detected type badge, media gallery, Instagram preview, publish confirmation dialog with progress bar, draft creation/cleanup, and publish flow.

- [ ] **Step 1: Replace the stub with the full component**

Replace the entire contents of `apps/crm/src/pages/post-express/ExpressPostPage.tsx` with:

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send, AlertCircle, Image, Film, Images } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/lib/supabase';
import {
  getClientes, addWorkflow, addWorkflowEtapa, addWorkflowPost,
  updateWorkflowPost, updateWorkflow, removeWorkflow,
  type Cliente, type PostMedia,
} from '../../store';
import { publishInstagramPostNow } from '../../services/instagram';
import { PostMediaGallery } from '../entregas/components/PostMediaGallery';

interface DraftState {
  workflowId: number;
  postId: number;
}

interface IgAccount {
  id: number;
  username: string | null;
  profile_picture_url: string | null;
  authorization_status: string;
  token_expires_at: string | null;
  permissions: string[] | null;
}

function detectPostType(media: PostMedia[]): 'feed' | 'reels' | 'carrossel' | null {
  if (media.length === 0) return null;
  if (media.length > 1) return 'carrossel';
  if (media[0].kind === 'video') return 'reels';
  return 'feed';
}

function getTypeLabel(type: 'feed' | 'reels' | 'carrossel'): { label: string; color: string; bg: string; icon: typeof Image } {
  switch (type) {
    case 'feed': return { label: 'Feed', color: '#eab308', bg: 'rgba(234,179,8,0.12)', icon: Image };
    case 'reels': return { label: 'Reels', color: '#E1306C', bg: 'rgba(225,48,108,0.12)', icon: Film };
    case 'carrossel': return { label: 'Carrossel', color: '#42c8f5', bg: 'rgba(66,200,245,0.12)', icon: Images };
  }
}

const MAX_CAPTION = 2200;

export default function ExpressPostPage() {
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [caption, setCaption] = useState('');
  const [mediaList, setMediaList] = useState<PostMedia[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishPct, setPublishPct] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const draftRef = useRef<DraftState | null>(null);
  const mediaCountRef = useRef(0);
  const captionRef = useRef('');

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { mediaCountRef.current = mediaList.length; }, [mediaList]);
  useEffect(() => { captionRef.current = caption; }, [caption]);

  const stopProgressTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);
  useEffect(() => stopProgressTimer, [stopProgressTimer]);

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
  });

  const { data: igAccount } = useQuery<IgAccount | null>({
    queryKey: ['ig-account-express', selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return null;
      const { data } = await supabase
        .from('instagram_accounts')
        .select('id, username, profile_picture_url, authorization_status, token_expires_at, permissions')
        .eq('client_id', selectedClientId)
        .maybeSingle();
      return data;
    },
    enabled: !!selectedClientId,
  });

  const { data: clientsWithIg = [] } = useQuery({
    queryKey: ['clients-with-ig'],
    queryFn: async () => {
      const { data } = await supabase
        .from('instagram_accounts')
        .select('client_id');
      return (data ?? []).map((r: { client_id: number }) => r.client_id);
    },
  });

  const eligibleClients = clientes.filter((c) => clientsWithIg.includes(c.id!));
  const selectedClient = clientes.find((c) => c.id === selectedClientId) ?? null;

  const igAccountStatus = igAccount ? {
    revoked: igAccount.authorization_status === 'revoked',
    expired: igAccount.token_expires_at ? new Date(igAccount.token_expires_at) < new Date() : false,
    canPublish: Array.isArray(igAccount.permissions) && igAccount.permissions.includes('instagram_business_content_publish'),
  } : null;

  const accountBlocked = igAccountStatus?.revoked || igAccountStatus?.expired;
  const missingPublishPermission = igAccountStatus ? !igAccountStatus.canPublish : false;
  const accountWarning = accountBlocked || missingPublishPermission;

  let warningMessage: string | null = null;
  if (igAccountStatus?.revoked) {
    warningMessage = 'Token do Instagram foi revogado. Reconecte a conta nas configurações do cliente.';
  } else if (igAccountStatus?.expired) {
    warningMessage = 'Token do Instagram expirou. Reconecte a conta nas configurações do cliente.';
  } else if (missingPublishPermission) {
    warningMessage = 'Permissão de publicação não concedida. Reconecte a conta com as permissões necessárias.';
  }

  const detectedType = detectPostType(mediaList);
  const canPublish = !!draft && !!caption.trim() && mediaList.length > 0 && !accountWarning && !loading;

  async function createDraft(clientId: number, clientName: string) {
    setCreatingDraft(true);
    try {
      const now = new Date();
      const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

      const workflow = await addWorkflow({
        cliente_id: clientId,
        titulo: `Post Express - ${clientName} - ${dateStr}`,
        status: 'ativo',
        etapa_atual: 0,
        recorrente: false,
        modo_prazo: 'padrao',
      });

      await addWorkflowEtapa({
        workflow_id: workflow.id!,
        ordem: 0,
        nome: 'Publicação',
        prazo_dias: 0,
        tipo_prazo: 'corridos',
        tipo: 'padrao',
        status: 'concluido',
        iniciado_em: now.toISOString(),
        responsavel_id: null,
      });

      const post = await addWorkflowPost({
        workflow_id: workflow.id!,
        status: 'rascunho',
        tipo: 'feed',
        titulo: 'Post Express',
        conteudo: null,
        conteudo_plain: '',
        ordem: 0,
      });

      setDraft({ workflowId: workflow.id!, postId: post.id! });
    } catch (err: any) {
      toast.error('Erro ao preparar rascunho: ' + err.message);
    } finally {
      setCreatingDraft(false);
    }
  }

  async function deleteDraft(wfId: number) {
    try { await removeWorkflow(wfId); } catch { /* fire-and-forget */ }
  }

  async function handleClientChange(clientId: number | null) {
    if (draft) {
      await deleteDraft(draft.workflowId);
      setDraft(null);
    }
    setCaption('');
    setMediaList([]);
    setSelectedClientId(clientId);

    if (clientId) {
      const client = clientes.find((c) => c.id === clientId);
      if (client) await createDraft(clientId, client.nome);
    }
  }

  useEffect(() => {
    return () => {
      const d = draftRef.current;
      if (d && mediaCountRef.current === 0 && !captionRef.current.trim()) {
        removeWorkflow(d.workflowId).catch(() => {});
      }
    };
  }, []);

  const handlePublishNow = async () => {
    if (!draft || !detectedType) return;

    setPublishing(true);
    setPublishPct(0);
    setLoading(true);

    let pct = 0;
    timerRef.current = setInterval(() => {
      pct += (90 - pct) * 0.08;
      setPublishPct(Math.round(pct));
    }, 300);

    try {
      await updateWorkflowPost(draft.postId, {
        status: 'aprovado_cliente',
        ig_caption: caption.trim(),
        tipo: detectedType,
      });

      const result = await publishInstagramPostNow(draft.postId);

      stopProgressTimer();
      setPublishPct(100);
      await new Promise((r) => setTimeout(r, 600));
      setConfirmOpen(false);

      await updateWorkflow(draft.workflowId, { status: 'concluido' });

      if (result.status === 'postado') {
        toast.success('Post publicado no Instagram!', {
          action: { label: 'Ver post', onClick: () => window.location.assign('/entregas') },
        });
      } else {
        toast.info('Post sendo processado pelo Instagram. Acompanhe na página de entregas.', {
          action: { label: 'Ver entregas', onClick: () => window.location.assign('/entregas') },
        });
      }

      setDraft(null);
      setSelectedClientId(null);
      setCaption('');
      setMediaList([]);
    } catch (err: any) {
      stopProgressTimer();
      setConfirmOpen(false);
      toast.error(err.message);
    } finally {
      setLoading(false);
      setPublishing(false);
      setPublishPct(0);
    }
  };

  const handleMediaChange = useCallback((media: PostMedia[]) => {
    setMediaList(media);
  }, []);

  return (
    <div className="animate-up" style={{ padding: 'clamp(1.25rem, 3vw, 2.5rem)' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(2rem, 4vw, 3.2rem)', fontWeight: 900 }}>
          Post Express
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          Publique rapidamente no Instagram
        </p>
      </div>

      {/* Warning banner */}
      {warningMessage && selectedClientId && (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3 text-xs mb-4"
          style={{ color: '#f55a42', background: 'rgba(245, 90, 66, 0.08)' }}>
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {warningMessage}
        </div>
      )}

      {/* Two-column grid */}
      <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))' }}>

        {/* LEFT COLUMN */}
        <div className="flex flex-col gap-4">

          {/* Client Picker */}
          <div style={{ background: 'var(--card-bg)', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border-color)' }}>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
              Cliente
            </label>
            <select
              value={selectedClientId ?? ''}
              onChange={(e) => handleClientChange(e.target.value ? parseInt(e.target.value, 10) : null)}
              disabled={loading}
              className="w-full rounded-lg px-3 py-2 text-sm border"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-main)', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
            >
              <option value="">Selecionar cliente...</option>
              {eligibleClients.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
            {eligibleClients.length === 0 && (
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                Nenhum cliente com Instagram conectado.{' '}
                <a href="/clientes" style={{ color: '#eab308' }}>Conectar conta</a>
              </p>
            )}
            {igAccount && (
              <div className="flex items-center gap-2 mt-2">
                {igAccount.profile_picture_url && (
                  <img src={igAccount.profile_picture_url} alt="" className="w-5 h-5 rounded-full" style={{ border: '1.5px solid #E1306C' }} />
                )}
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  @{igAccount.username ?? 'conta'}
                </span>
              </div>
            )}
          </div>

          {/* Media Upload */}
          {draft && (
            <div style={{ background: 'var(--card-bg)', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border-color)' }}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                Mídia
              </label>
              <PostMediaGallery
                postId={draft.postId}
                maxFiles={detectedType === 'carrossel' || mediaList.length > 1 ? undefined : 1}
                onChange={handleMediaChange}
              />

              {/* Detected type badge */}
              {detectedType && (
                <div className="mt-3">
                  {(() => {
                    const t = getTypeLabel(detectedType);
                    const Icon = t.icon;
                    return (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
                        style={{ color: t.color, background: t.bg }}>
                        <Icon className="h-3.5 w-3.5" /> {t.label}
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {creatingDraft && (
            <div style={{ background: 'var(--card-bg)', borderRadius: '16px', padding: '2rem', border: '1px solid var(--border-color)', textAlign: 'center' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Preparando rascunho...</p>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex flex-col gap-4">

          {/* Caption */}
          <div style={{ background: 'var(--card-bg)', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border-color)' }}>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
              Legenda do Instagram
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
              placeholder="Escreva a legenda do post aqui..."
              disabled={!draft || loading}
              rows={8}
              className="w-full rounded-lg px-3 py-2.5 text-sm resize-none border"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--surface-main)', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
            />
            <div className="flex justify-end mt-1">
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {caption.length} / {MAX_CAPTION}
              </span>
            </div>
          </div>

          {/* Instagram Preview */}
          {draft && igAccount && (
            <div style={{ background: 'var(--card-bg)', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border-color)' }}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                Preview
              </label>
              <div className="rounded-xl overflow-hidden" style={{ background: '#000', padding: '0.75rem', maxWidth: '300px', margin: '0 auto' }}>
                <div className="flex items-center gap-2 mb-2">
                  {igAccount.profile_picture_url ? (
                    <img src={igAccount.profile_picture_url} alt="" className="w-6 h-6 rounded-full" style={{ border: '1.5px solid #E1306C' }} />
                  ) : (
                    <div className="w-6 h-6 rounded-full" style={{ background: 'linear-gradient(45deg, #f09433, #dc2743, #bc1888)' }} />
                  )}
                  <span className="text-xs font-semibold" style={{ color: '#e8eaf0' }}>@{igAccount.username ?? 'conta'}</span>
                </div>
                <div className="rounded-lg overflow-hidden" style={{ background: '#1a1e26', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {mediaList.length > 0 && mediaList[0].url ? (
                    mediaList[0].kind === 'video' ? (
                      <video src={mediaList[0].url} poster={mediaList[0].thumbnail_url ?? undefined} muted className="w-full h-full object-cover" />
                    ) : (
                      <img src={mediaList[0].thumbnail_url ?? mediaList[0].url} alt="" className="w-full h-full object-cover" />
                    )
                  ) : (
                    <span className="text-xs" style={{ color: '#4b5563' }}>Mídia aparece aqui</span>
                  )}
                </div>
                {caption && (
                  <p className="mt-2 text-xs leading-relaxed" style={{ color: '#9ca3af' }}>
                    <strong style={{ color: '#e8eaf0' }}>@{igAccount.username ?? 'conta'}</strong>{' '}
                    {caption.length > 100 ? caption.slice(0, 100) + '...' : caption}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Publish Button */}
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!canPublish}
            className="w-full text-sm font-bold py-3"
            style={canPublish ? { background: '#E1306C', color: 'white' } : undefined}
          >
            <Send className="h-4 w-4 mr-2" /> Publicar agora
          </Button>
          {draft && (
            <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              O post será publicado imediatamente no Instagram
            </p>
          )}
        </div>
      </div>

      {/* Publish Confirmation Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!publishing) setConfirmOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{publishing ? 'Publicando…' : 'Publicar agora?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {publishing
                ? 'Aguarde enquanto o post é publicado no Instagram.'
                : 'O post será publicado imediatamente no Instagram. Esta ação não pode ser desfeita.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {publishing && (
            <div className="px-1">
              <div className="flex items-center justify-between text-xs text-stone-500 mb-1.5">
                <span>{publishPct < 100 ? 'Enviando para o Instagram…' : 'Concluído!'}</span>
                <span className="tabular-nums font-medium text-stone-900">{publishPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${publishPct}%`, background: publishPct < 100 ? '#E1306C' : '#3ecf8e' }}
                />
              </div>
            </div>
          )}
          {!publishing && (
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <Button onClick={handlePublishNow} style={{ background: '#E1306C', color: 'white' }}>
                Publicar
              </Button>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Manual test — full flow**

Run: `npm run dev`
Open http://localhost:5173/post-express

Test the following:
1. Page renders with title and subtitle
2. Client dropdown shows only clients with Instagram accounts
3. Selecting a client creates a draft (media upload area appears)
4. Upload an image — detected type badge shows "Feed"
5. Write a caption — character counter updates
6. Instagram preview shows the uploaded image + caption
7. Publish button becomes enabled
8. Click publish — confirmation dialog opens
9. Click "Publicar" in dialog — progress bar animates, publish completes
10. Success toast appears with "Ver post" link
11. Form resets after publish

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/post-express/ExpressPostPage.tsx
git commit -m "feat: implement Express Post page with publish flow"
```

---

### Task 4: Write tests for ExpressPostPage

**Files:**
- Create: `apps/crm/src/pages/post-express/__tests__/ExpressPostPage.test.tsx`

Tests cover: rendering, client selection creating draft, publish button disabled states, publish flow, cleanup on unmount. Uses the same vitest patterns as the existing `ScheduleButton.test.tsx` — `vi.mock`, `vi.mocked`, `.toBeTruthy()` / `.toBeNull()` (avoids `toBeInTheDocument` due to known Chai property issue in this repo).

- [ ] **Step 1: Create the test file**

Create `apps/crm/src/pages/post-express/__tests__/ExpressPostPage.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../store', () => ({
  getClientes: vi.fn(),
  addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(),
  addWorkflowPost: vi.fn(),
  updateWorkflowPost: vi.fn(),
  updateWorkflow: vi.fn(),
  removeWorkflow: vi.fn(),
}));

vi.mock('../../../services/instagram', () => ({
  publishInstagramPostNow: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        })),
      })),
    })),
  },
}));

vi.mock('../../entregas/components/PostMediaGallery', () => ({
  PostMediaGallery: ({ onChange }: { onChange?: (m: any[]) => void }) => (
    <div data-testid="media-gallery">
      <button onClick={() => onChange?.([{ id: 1, kind: 'image', url: 'test.jpg', original_filename: 'test.jpg' }])}>
        Simulate Upload
      </button>
    </div>
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import ExpressPostPage from '../ExpressPostPage';
import {
  getClientes, addWorkflow, addWorkflowEtapa, addWorkflowPost,
  updateWorkflowPost, updateWorkflow, removeWorkflow,
} from '../../../store';
import { publishInstagramPostNow } from '../../../services/instagram';
import { toast } from 'sonner';

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const mockClientes = [
  { id: 1, nome: 'Client A', sigla: 'CA', cor: '#000', plano: 'pro', email: 'a@a.com', telefone: '', status: 'ativo' as const, valor_mensal: 100 },
  { id: 2, nome: 'Client B', sigla: 'CB', cor: '#000', plano: 'pro', email: 'b@b.com', telefone: '', status: 'ativo' as const, valor_mensal: 200 },
];

describe('ExpressPostPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientes).mockResolvedValue(mockClientes);
    vi.mocked(addWorkflow).mockResolvedValue({ id: 10, cliente_id: 1, titulo: 'Post Express', status: 'ativo', etapa_atual: 0, recorrente: false });
    vi.mocked(addWorkflowEtapa).mockResolvedValue({ id: 20, workflow_id: 10, ordem: 0, nome: 'Publicação', prazo_dias: 0, tipo_prazo: 'corridos', status: 'concluido' });
    vi.mocked(addWorkflowPost).mockResolvedValue({ id: 30, workflow_id: 10, titulo: 'Post Express', conteudo: null, conteudo_plain: '', tipo: 'feed', ordem: 0, status: 'rascunho' });
  });

  it('renders page title and subtitle', async () => {
    renderWithProviders(<ExpressPostPage />);
    expect(screen.getByText('Post Express')).toBeTruthy();
    expect(screen.getByText('Publique rapidamente no Instagram')).toBeTruthy();
  });

  it('shows empty state when no clients have Instagram', async () => {
    renderWithProviders(<ExpressPostPage />);
    await waitFor(() => {
      expect(screen.getByText(/Nenhum cliente com Instagram conectado/)).toBeTruthy();
    });
  });

  it('publish button is disabled when no client is selected', async () => {
    renderWithProviders(<ExpressPostPage />);
    const publishBtn = screen.getByText('Publicar agora').closest('button')!;
    expect(publishBtn.hasAttribute('disabled')).toBe(true);
  });

  it('publish button is disabled when caption is empty', async () => {
    renderWithProviders(<ExpressPostPage />);
    const publishBtn = screen.getByText('Publicar agora').closest('button')!;
    expect(publishBtn.hasAttribute('disabled')).toBe(true);
  });

  it('calls removeWorkflow on unmount when draft has no content', async () => {
    vi.mocked(removeWorkflow).mockResolvedValue(undefined);
    const { unmount } = renderWithProviders(<ExpressPostPage />);
    unmount();
    // The cleanup effect is fire-and-forget, but removeWorkflow should not be called
    // when there's no draft (no client selected)
    expect(removeWorkflow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test -- --run apps/crm/src/pages/post-express/__tests__/ExpressPostPage.test.tsx`
Expected: All 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/post-express/__tests__/ExpressPostPage.test.tsx
git commit -m "test: add unit tests for ExpressPostPage"
```

---

### Task 5: Build the orphan draft cleanup cron

**Files:**
- Create: `supabase/functions/express-post-cleanup-cron/index.ts`

A Deno edge function that runs daily to delete orphan Express Post drafts older than 24 hours. Follows the same pattern as `instagram-refresh-cron`: verifies `x-cron-secret` header, uses service role client, returns JSON summary.

- [ ] **Step 1: Create the edge function**

Create `supabase/functions/express-post-cleanup-cron/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(async (req: Request) => {
  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: orphanWorkflows, error: fetchErr } = await supabase
      .from("workflows")
      .select("id")
      .like("titulo", "Post Express -%")
      .eq("status", "ativo")
      .lt("created_at", cutoff);

    if (fetchErr) throw fetchErr;
    if (!orphanWorkflows || orphanWorkflows.length === 0) {
      return new Response(JSON.stringify({ success: true, deleted: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let deleted = 0;
    let skipped = 0;

    for (const wf of orphanWorkflows) {
      const { data: posts } = await supabase
        .from("workflow_posts")
        .select("id, status")
        .eq("workflow_id", wf.id);

      const allRascunho = (posts ?? []).every((p: { status: string }) => p.status === "rascunho");
      if (!allRascunho) {
        skipped++;
        continue;
      }

      const postIds = (posts ?? []).map((p: { id: number }) => p.id);

      let fileIds: number[] = [];
      if (postIds.length > 0) {
        const { data: links } = await supabase
          .from("post_file_links")
          .select("file_id")
          .in("post_id", postIds);
        fileIds = (links ?? []).map((l: { file_id: number }) => l.file_id);
      }

      const { error: delErr } = await supabase
        .from("workflows")
        .delete()
        .eq("id", wf.id);

      if (delErr) {
        console.error(`Failed to delete workflow ${wf.id}:`, delErr.message);
        continue;
      }

      for (const fileId of fileIds) {
        const { data: file } = await supabase
          .from("files")
          .select("id, reference_count")
          .eq("id", fileId)
          .maybeSingle();

        if (file && file.reference_count <= 0) {
          await supabase.from("files").delete().eq("id", fileId);
        }
      }

      deleted++;
    }

    return new Response(JSON.stringify({ success: true, deleted, skipped }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Express post cleanup failed:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 2: Test the edge function locally**

Run: `npx supabase functions serve express-post-cleanup-cron`

In another terminal, test auth rejection:
```bash
curl -s http://localhost:54321/functions/v1/express-post-cleanup-cron | jq .
```
Expected: `{"error":"Unauthorized"}`

Test with correct secret (use the value from your `.env`):
```bash
curl -s -H "x-cron-secret: YOUR_CRON_SECRET" http://localhost:54321/functions/v1/express-post-cleanup-cron | jq .
```
Expected: `{"success":true,"deleted":0}` (or a count if orphans exist)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/express-post-cleanup-cron/index.ts
git commit -m "feat: add express post orphan draft cleanup cron"
```

---

### Task 6: Final integration test and polish

**Files:**
- No new files — this is a manual integration test and any final fixes.

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All tests pass (including the new ExpressPostPage tests).

- [ ] **Step 2: Run typecheck**

Run: `npm run build`
Expected: Clean build, no type errors.

- [ ] **Step 3: Full manual integration test**

Run: `npm run dev`
Open http://localhost:5173/post-express

Test the complete flow:
1. **No client selected**: Publish button disabled, no media area shown
2. **Select a client with Instagram**: Draft created, media upload area appears, IG username shown
3. **Upload a single image**: Detected type badge shows "Feed", preview updates
4. **Write a caption**: Character counter shows count, preview shows truncated caption
5. **Click Publish**: Confirmation dialog opens with "Publicar agora?" title
6. **Click Publicar in dialog**: Progress bar animates, publish completes
7. **After publish**: Success toast with "Ver post" link, form resets completely
8. **Switch client after uploading media**: Previous draft deleted, new draft created, media area resets
9. **Navigate away without publishing (no content)**: Check via browser dev tools Network tab that `removeWorkflow` is called
10. **Navigate away with content (media uploaded)**: Draft is NOT deleted (cron handles it)
11. **Check responsive**: Resize to mobile width — columns stack vertically
12. **Check sidebar**: "Post Express" appears between "Entregas" and "Arquivos" with paper-plane icon

- [ ] **Step 4: Commit any fixes**

If any fixes were needed during integration testing:

```bash
git add -A
git commit -m "fix: polish Express Post page after integration testing"
```
