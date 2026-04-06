# Post Schedule/Posted Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `agendado` and `postado` statuses to `WorkflowPost`, show them as actionable pipeline chips in the client calendar side panel, and include them in the workflow drawer status dropdown.

**Architecture:** Extend the `WorkflowPost['status']` union type in `store.ts`, update all three UI consumers (`WorkflowDrawer.tsx`, `HistoryDrawer.tsx`, `ClienteDetalhePage.tsx`), and add CSS for the two new chip styles. The calendar side panel gets a new inline `PostPipelineChips` component rendered inside each post card.

**Tech Stack:** TypeScript, React, Supabase (`updateWorkflowPost` from `store.ts`), `sonner` toasts, plain CSS in `style.css`.

---

## File Map

| File | Change |
|---|---|
| `src/store.ts` | Extend `WorkflowPost['status']` union type |
| `src/pages/entregas/components/WorkflowDrawer.tsx` | Add new statuses to `STATUS_LABELS` and `STATUS_CLASS` |
| `src/pages/entregas/components/HistoryDrawer.tsx` | Add new statuses to `STATUS_LABELS` and `STATUS_CLASS` |
| `src/pages/cliente-detalhe/ClienteDetalhePage.tsx` | Add `status` to `PostCalendarEvent`, add pipeline chips to each post card, wire up update handlers |
| `style.css` | Add `.post-status--agendado` and `.post-status--postado` styles |

---

### Task 1: Extend the `WorkflowPost` status type in `store.ts`

**Files:**
- Modify: `src/store.ts:1084-1090`

- [ ] **Step 1: Update the status union type**

In `src/store.ts`, find the `WorkflowPost` interface (around line 1084) and replace the `status` field:

```ts
// Before:
status:
  | 'rascunho'
  | 'revisao_interna'
  | 'aprovado_interno'
  | 'enviado_cliente'
  | 'aprovado_cliente'
  | 'correcao_cliente';

// After:
status:
  | 'rascunho'
  | 'revisao_interna'
  | 'aprovado_interno'
  | 'enviado_cliente'
  | 'aprovado_cliente'
  | 'correcao_cliente'
  | 'agendado'
  | 'postado';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing unrelated errors — zero new errors).

- [ ] **Step 3: Commit**

```bash
git add src/store.ts
git commit -m "feat: extend WorkflowPost status type with agendado and postado"
```

---

### Task 2: Add CSS styles for the two new status chips

**Files:**
- Modify: `style.css` (after line 4577, the existing `.post-status--correcao` rule)

- [ ] **Step 1: Add the new CSS rules**

In `style.css`, find the block of `.post-status--*` rules (around line 4572) and add two new lines immediately after `.post-status--correcao`:

```css
.post-status--agendado        { background: #ccfbf1; color: #0f766e; }
.post-status--postado         { background: #dcfce7; color: #15803d; font-weight: 600; }
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "feat: add CSS styles for agendado and postado status chips"
```

---

### Task 3: Update `WorkflowDrawer.tsx` status maps

**Files:**
- Modify: `src/pages/entregas/components/WorkflowDrawer.tsx:32-48`

- [ ] **Step 1: Add to `STATUS_LABELS`**

Find the `STATUS_LABELS` constant (line 32) and add the two new entries:

```ts
const STATUS_LABELS: Record<WorkflowPost['status'], string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Em revisão',
  aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente',
  aprovado_cliente: 'Aprovado pelo cliente',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  postado: 'Postado',
};
```

- [ ] **Step 2: Add to `STATUS_CLASS`**

Find the `STATUS_CLASS` constant (line 41) and add the two new entries:

```ts
const STATUS_CLASS: Record<WorkflowPost['status'], string> = {
  rascunho: 'post-status--rascunho',
  revisao_interna: 'post-status--revisao',
  aprovado_interno: 'post-status--aprovado-interno',
  enviado_cliente: 'post-status--enviado',
  aprovado_cliente: 'post-status--aprovado-cliente',
  correcao_cliente: 'post-status--correcao',
  agendado: 'post-status--agendado',
  postado: 'post-status--postado',
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat: add agendado/postado to WorkflowDrawer status maps"
```

---

### Task 4: Update `HistoryDrawer.tsx` status maps

**Files:**
- Modify: `src/pages/entregas/components/HistoryDrawer.tsx:20-28`

- [ ] **Step 1: Add to both maps**

Find the `STATUS_LABELS` and `STATUS_CLASS` constants (lines 20-28) and add the two new entries to each:

```ts
const STATUS_LABELS: Record<WorkflowPost['status'], string> = {
  rascunho: 'Rascunho', revisao_interna: 'Em revisão', aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente', aprovado_cliente: 'Aprovado pelo cliente',
  correcao_cliente: 'Correção solicitada', agendado: 'Agendado', postado: 'Postado',
};

const STATUS_CLASS: Record<WorkflowPost['status'], string> = {
  rascunho: 'post-status--rascunho', revisao_interna: 'post-status--revisao',
  aprovado_interno: 'post-status--aprovado-interno', enviado_cliente: 'post-status--enviado',
  aprovado_cliente: 'post-status--aprovado-cliente', correcao_cliente: 'post-status--correcao',
  agendado: 'post-status--agendado', postado: 'post-status--postado',
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/components/HistoryDrawer.tsx
git commit -m "feat: add agendado/postado to HistoryDrawer status maps"
```

---

### Task 5: Add status to `PostCalendarEvent` and fetch it in `ClienteDetalhePage.tsx`

**Files:**
- Modify: `src/pages/cliente-detalhe/ClienteDetalhePage.tsx`

The `PostCalendarEvent` interface (line 191) and the `useEffect` that builds events (line 203) currently don't track `status`. We need to add it so the pipeline chips can react to the current post status.

- [ ] **Step 1: Add `status` to `PostCalendarEvent` interface**

Find the `PostCalendarEvent` interface (around line 191) and add the `status` field:

```ts
interface PostCalendarEvent {
  postId: number;
  postTitle: string;
  workflowId: number;
  workflowTitle: string;
  date: Date;
  tipo: WorkflowPost['tipo'];
  status: WorkflowPost['status'];
}
```

- [ ] **Step 2: Include `status` when building events in the `useEffect`**

In the `useEffect` that pushes to `events` (around line 223), add `status` to the pushed object:

```ts
events.push({
  postId: post.id!,
  postTitle: post.titulo || 'Sem título',
  workflowId: post._wfId,
  workflowTitle: post._wfTitle,
  date: parsed,
  tipo: post.tipo,
  status: post.status,
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/cliente-detalhe/ClienteDetalhePage.tsx
git commit -m "feat: include post status in PostCalendarEvent"
```

---

### Task 6: Add pipeline chips to post cards in `ClienteDetalhePage.tsx`

**Files:**
- Modify: `src/pages/cliente-detalhe/ClienteDetalhePage.tsx`

This task adds the state handlers and the pipeline chip UI to each post card in the `scheduled-panel`.

- [ ] **Step 1: Add a `postUpdating` state tracker**

Near the top of the `ClienteDetalhePage` component, after the existing `useState` declarations (around line 200), add:

```ts
const [postUpdating, setPostUpdating] = useState<number | null>(null);
```

This tracks which post is currently being updated so we can show a loading state on the chip button.

- [ ] **Step 2: Add a `refreshPostCalendar` helper**

Add a function that re-runs the post calendar fetch. Place it after the `useEffect` that builds `postCalendarEvents` (around line 239):

```ts
const refreshPostCalendar = () => {
  const activeWfs = (clienteWorkflowsRaw ?? []).filter(w => w.status === 'ativo');
  if (activeWfs.length === 0) { setPostCalendarEvents([]); return; }
  Promise.all(activeWfs.map(async wf => {
    const posts = await getWorkflowPostsWithProperties(wf.id!);
    return posts.map(p => ({ ...p, _wfId: wf.id!, _wfTitle: wf.titulo }));
  }))
    .then(results => {
      const events: PostCalendarEvent[] = [];
      for (const posts of results) {
        for (const post of posts) {
          const dateProp = post.property_values.find(
            pv => pv.definition?.name?.toLowerCase() === 'data de postagem' && pv.definition?.type === 'date'
          );
          if (dateProp?.value) {
            const dateStr = typeof dateProp.value === 'string' ? dateProp.value : String(dateProp.value);
            const parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) {
              events.push({
                postId: post.id!,
                postTitle: post.titulo || 'Sem título',
                workflowId: post._wfId,
                workflowTitle: post._wfTitle,
                date: parsed,
                tipo: post.tipo,
                status: post.status,
              });
            }
          }
        }
      }
      setPostCalendarEvents(events);
    })
    .catch(() => {});
};
```

- [ ] **Step 3: Add the `handlePostStatusUpdate` handler**

Add this function right after `refreshPostCalendar`:

```ts
const handlePostStatusUpdate = async (postId: number, newStatus: 'agendado' | 'postado') => {
  setPostUpdating(postId);
  try {
    await updateWorkflowPost(postId, { status: newStatus });
    toast.success(newStatus === 'agendado' ? 'Post agendado.' : 'Post marcado como postado.');
    refreshPostCalendar();
  } catch {
    toast.error('Erro ao atualizar status do post.');
  } finally {
    setPostUpdating(null);
  }
};
```

Make sure `updateWorkflowPost` is already imported from `../../store` — check the import at line ~43. It should already be there.

- [ ] **Step 4: Add the pipeline chips to each post card**

Find the post card render inside `selectedEvents.map(...)` (around line 665). Currently the card ends with:

```tsx
<div className="item-meta">
  {ev.date.toLocaleDateString('pt-BR')}
</div>
```

Add the pipeline chips immediately after `item-meta`, still inside the same card `<div>`:

```tsx
<div className="item-meta">
  {ev.date.toLocaleDateString('pt-BR')}
</div>
<div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
  {/* Chip 1: Aprovado (read-only) */}
  {(ev.status === 'aprovado_interno' || ev.status === 'aprovado_cliente' || ev.status === 'agendado' || ev.status === 'postado') ? (
    <span style={{ fontSize: '0.68rem', background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd44', padding: '2px 8px', borderRadius: '4px' }}>
      ✓ Aprovado
    </span>
  ) : (
    <span style={{ fontSize: '0.68rem', background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', padding: '2px 8px', borderRadius: '4px' }}>
      {ev.status === 'rascunho' ? 'Rascunho' : ev.status === 'revisao_interna' ? 'Em revisão' : ev.status === 'enviado_cliente' ? 'Enviado' : ev.status === 'correcao_cliente' ? 'Correção' : ev.status}
    </span>
  )}

  {/* Separator */}
  {(ev.status === 'aprovado_interno' || ev.status === 'aprovado_cliente' || ev.status === 'agendado' || ev.status === 'postado') && (
    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>→</span>
  )}

  {/* Chip 2: Agendar */}
  {(ev.status === 'aprovado_interno' || ev.status === 'aprovado_cliente') && (
    <button
      onClick={e => { e.stopPropagation(); handlePostStatusUpdate(ev.postId, 'agendado'); }}
      disabled={postUpdating === ev.postId}
      style={{ fontSize: '0.68rem', background: '#eff6ff', color: '#2563eb', border: '1px solid #3b82f6', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
    >
      {postUpdating === ev.postId ? '...' : '○ Agendar'}
    </button>
  )}
  {(ev.status === 'agendado' || ev.status === 'postado') && (
    <span style={{ fontSize: '0.68rem', background: '#ccfbf1', color: '#0f766e', border: '1px solid #5eead444', padding: '2px 8px', borderRadius: '4px' }}>
      ✓ Agendado
    </span>
  )}

  {/* Separator */}
  {(ev.status === 'agendado' || ev.status === 'postado') && (
    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>→</span>
  )}

  {/* Chip 3: Postado */}
  {ev.status === 'agendado' && (
    <button
      onClick={e => { e.stopPropagation(); handlePostStatusUpdate(ev.postId, 'postado'); }}
      disabled={postUpdating === ev.postId}
      style={{ fontSize: '0.68rem', background: '#f0fdf4', color: '#15803d', border: '1px solid #22c55e', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
    >
      {postUpdating === ev.postId ? '...' : '○ Marcar Postado'}
    </button>
  )}
  {ev.status === 'postado' && (
    <span style={{ fontSize: '0.68rem', background: '#dcfce7', color: '#15803d', border: '1px solid #22c55e', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
      ✓ Postado
    </span>
  )}
</div>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 6: Smoke test in the browser**

```bash
cd /Users/eduardosouza/Projects/sm-crm && npm run dev
```

1. Open a client detail page that has posts with a "Data de postagem" property value.
2. In the calendar side panel, find a post with status `aprovado_cliente` or `aprovado_interno` — you should see `[✓ Aprovado] → [○ Agendar]`.
3. Click **Agendar** — the chip should change to `[✓ Aprovado] → [✓ Agendado] → [○ Marcar Postado]` after refresh.
4. Click **Marcar Postado** — the chip should change to `[✓ Aprovado] → [✓ Agendado] → [✓ Postado]`.
5. Open the Entregas page and open the same post's workflow drawer — verify the status dropdown shows "Agendado" / "Postado" as options.

- [ ] **Step 7: Commit**

```bash
git add src/pages/cliente-detalhe/ClienteDetalhePage.tsx
git commit -m "feat: add schedule/posted pipeline chips to client calendar post cards"
```
