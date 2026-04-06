# Workflow History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to view concluded workflow history — etapa timelines with deadline compliance, posts with content/properties/approvals — from both the Entregas page and Client Detail page.

**Architecture:** Two new store functions fetch concluded workflows. A new `HistoryDrawer` component renders the read-only detail view. A new `ConcludedView` tab is added to the Entregas page. The Client Detail page gets a "Histórico de Entregas" section. `PropertyPanel` and `PropertyValue` gain a `readOnly` prop.

**Tech Stack:** React, TypeScript, TanStack Query, Supabase, existing CSS patterns from `style.css`.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/store.ts` | Add `getConcludedWorkflows()` and `getConcludedWorkflowsByCliente()` |
| Modify | `src/pages/entregas/components/PropertyPanel.tsx` | Add `readOnly` prop |
| Modify | `src/pages/entregas/components/PropertyValue.tsx` | Add `readOnly` prop — skip edit mode, hide "Adicionar propriedade" |
| Create | `src/pages/entregas/components/HistoryDrawer.tsx` | Read-only drawer: etapa timeline + posts with expand |
| Modify | `style.css` | Add `history-timeline`, `history-step`, etc. CSS classes |
| Create | `src/pages/entregas/views/ConcludedView.tsx` | "Concluídas" tab — grouped by client |
| Modify | `src/pages/entregas/EntregasPage.tsx` | Add "Concluídas" tab + HistoryDrawer state |
| Modify | `src/pages/cliente-detalhe/ClienteDetalhePage.tsx` | Add "Histórico de Entregas" section + HistoryDrawer |

---

### Task 1: Store functions for concluded workflows

**Files:**
- Modify: `src/store.ts:750-767` (after existing `getWorkflowsByCliente`)

- [ ] **Step 1: Add `getConcludedWorkflows` to store.ts**

Add after the `getWorkflowsByCliente` function (around line 767):

```typescript
export async function getConcludedWorkflows(): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('status', 'concluido')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getConcludedWorkflowsByCliente(clienteId: number): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('status', 'concluido')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 2: Verify the app still compiles**

Run: `npx tsc --noEmit`
Expected: no errors (new functions are unused but exported)

- [ ] **Step 3: Commit**

```bash
git add src/store.ts
git commit -m "feat: add store functions for concluded workflows"
```

---

### Task 2: Add `readOnly` prop to PropertyValue

**Files:**
- Modify: `src/pages/entregas/components/PropertyValue.tsx:10-15` (Props interface)
- Modify: `src/pages/entregas/components/PropertyValue.tsx:41` (component signature)
- Modify: `src/pages/entregas/components/PropertyValue.tsx:309-335` (render logic)

- [ ] **Step 1: Add `readOnly` to the Props interface**

In `PropertyValue.tsx`, change the Props interface:

```typescript
interface Props {
  definition: TemplatePropertyDefinition;
  value: unknown;
  postId: number;
  workflowId: number;
  membros: Membro[];
  readOnly?: boolean;
}
```

- [ ] **Step 2: Destructure `readOnly` in component signature**

Change line 41:

```typescript
export function PropertyValue({ definition, value: initialValue, postId, workflowId, membros, readOnly }: Props) {
```

- [ ] **Step 3: Make `isEditable` respect `readOnly`**

Change line 309:

```typescript
  const isEditable = definition.type !== 'created_time' && !readOnly;
```

This single change prevents clicking into edit mode when `readOnly` is true, because `isEditable` gates the `onClick` handler and the `editing` conditional in the render section (lines 321-334). No other changes needed — the display path (`renderDisplay`) already renders all value types as read-only text.

- [ ] **Step 4: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/pages/entregas/components/PropertyValue.tsx
git commit -m "feat: add readOnly prop to PropertyValue"
```

---

### Task 3: Add `readOnly` prop to PropertyPanel

**Files:**
- Modify: `src/pages/entregas/components/PropertyPanel.tsx:8-14` (Props interface)
- Modify: `src/pages/entregas/components/PropertyPanel.tsx:16` (component signature)

- [ ] **Step 1: Add `readOnly` to Props and pass through**

In `PropertyPanel.tsx`, update the Props interface:

```typescript
interface Props {
  templateId: number;
  postId: number;
  workflowId: number;
  propertyValues: PostPropertyValue[];
  membros: Membro[];
  readOnly?: boolean;
}
```

- [ ] **Step 2: Update component signature and logic**

Change the component to destructure and use `readOnly`:

```typescript
export function PropertyPanel({ templateId, postId, workflowId, propertyValues, membros, readOnly }: Props) {
```

- [ ] **Step 3: Hide "Adicionar propriedade" button in readOnly mode**

In readOnly mode, when there are no definitions, show nothing instead of the "Adicionar propriedade" button. Replace the early return block (lines 25-39):

```typescript
  if (definitions.length === 0 && !showPanel) {
    if (readOnly) return null;
    return (
      <div style={{ marginBottom: '0.75rem' }}>
        <button
          onClick={() => setShowPanel(true)}
          style={{
            background: 'none', border: '1px dashed var(--border-color, #e2e8f0)',
            borderRadius: 6, padding: '4px 10px', fontSize: '0.78rem',
            color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <Plus className="h-3 w-3" /> Adicionar propriedade
        </button>
      </div>
    );
  }
```

- [ ] **Step 4: Pass `readOnly` to PropertyValue and hide add button in the properties block**

Update the `PropertyValue` usage to pass `readOnly`, and conditionally hide the "Adicionar propriedade" button at the bottom of the properties block. Replace the return block (lines 42-88):

```typescript
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{
        background: 'var(--card-bg-secondary, #f8fafc)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: 8, padding: '10px 12px', marginBottom: 4,
      }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Propriedades
        </div>
        {definitions.map(def => {
          const pv = propertyValues.find(v => v.property_definition_id === def.id);
          return (
            <PropertyValue
              key={def.id}
              definition={def}
              value={pv?.value ?? null}
              postId={postId}
              workflowId={workflowId}
              membros={membros}
              readOnly={readOnly}
            />
          );
        })}
        {!readOnly && (
          <button
            onClick={() => setShowPanel(true)}
            style={{
              background: 'none', border: 'none', padding: '5px 0 0', fontSize: '0.78rem',
              color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2,
            }}
          >
            <Plus className="h-3 w-3" /> Adicionar propriedade
          </button>
        )}
      </div>

      {showPanel && !readOnly && (
        <PropertyDefinitionPanel
          templateId={templateId}
          onSave={() => {
            setShowPanel(false);
            qc.invalidateQueries({ queryKey: ['property-definitions', templateId] });
            qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', workflowId] });
          }}
          onClose={() => setShowPanel(false)}
        />
      )}
    </div>
  );
```

- [ ] **Step 5: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/pages/entregas/components/PropertyPanel.tsx
git commit -m "feat: add readOnly prop to PropertyPanel"
```

---

### Task 4: Add history timeline CSS

**Files:**
- Modify: `style.css` (append after the existing workflow drawer section, around line 4580)

- [ ] **Step 1: Add CSS classes for the history drawer**

Append after the `post-status--correcao` rule (around line 4577) in `style.css`:

```css
/* ============================================================
   HISTORY DRAWER — Etapa Timeline & Read-only Posts
   ============================================================ */
.history-timeline {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
}

.history-step {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
}

.history-step-track {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.history-step-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  color: #fff;
  flex-shrink: 0;
}

.history-step-icon--ok { background: #3ecf8e; }
.history-step-icon--late { background: #ef4444; }

.history-step-line {
  width: 2px;
  height: 24px;
}

.history-step-line--ok { background: #3ecf8e; }
.history-step-line--late { background: #ef4444; }

.history-step-body {
  flex: 1;
  margin-bottom: 0.6rem;
}

.history-step-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.history-step-name {
  font-weight: 600;
  font-size: 0.85rem;
}

.history-step-badge {
  font-size: 0.7rem;
  font-weight: 500;
}

.history-step-badge--ok { color: #3ecf8e; }
.history-step-badge--late { color: #ef4444; }

.history-step-detail {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.history-final-node {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.history-final-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  flex-shrink: 0;
}

.history-section-title {
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 0.8rem;
}

.history-duration {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 2px;
}

/* Approval bubbles (shared between WorkflowDrawer and HistoryDrawer) */
.history-approval-thread {
  margin-top: 0.4rem;
}

.history-thread-label {
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 0.3rem;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

/* Concluded workflow row (used in both ConcludedView and ClienteDetalhePage) */
.concluded-wf-row {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  transition: background 0.15s;
}

.concluded-wf-row:hover {
  background: var(--surface-1, #fafafa);
}

.concluded-wf-title {
  font-weight: 500;
  font-size: 0.85rem;
}

.concluded-wf-meta {
  font-size: 0.7rem;
  color: var(--text-muted);
}

/* Client group in ConcludedView */
.concluded-client-group {
  margin-bottom: 1rem;
}

.concluded-client-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  cursor: pointer;
  user-select: none;
}

.concluded-client-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.concluded-client-name {
  font-weight: 600;
  font-size: 0.85rem;
}

.concluded-client-count {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.concluded-client-workflows {
  margin-left: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
```

- [ ] **Step 2: Verify the app loads correctly**

Run: `npx tsc --noEmit`
Expected: no errors (CSS only)

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: add CSS classes for workflow history UI"
```

---

### Task 5: Create HistoryDrawer component

**Files:**
- Create: `src/pages/entregas/components/HistoryDrawer.tsx`

- [ ] **Step 1: Create HistoryDrawer.tsx**

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, ChevronDown, ChevronRight, MessageSquare, Check, Flag } from 'lucide-react';
import {
  getWorkflowEtapas, getWorkflowPostsWithProperties, getPostApprovals,
  getMembros,
  type Workflow, type WorkflowEtapa, type WorkflowPost, type PostApproval, type PostPropertyValue,
} from '../../../store';
import { computeDeadlineDate } from '../hooks/useEntregasData';
import { PostEditor } from './PostEditor';
import { PropertyPanel } from './PropertyPanel';

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<WorkflowPost['tipo'], string> = {
  feed: 'Feed', reels: 'Reels', stories: 'Stories', carrossel: 'Carrossel',
};

const STATUS_LABELS: Record<WorkflowPost['status'], string> = {
  rascunho: 'Rascunho', revisao_interna: 'Em revisão', aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente', aprovado_cliente: 'Aprovado pelo cliente', correcao_cliente: 'Correção solicitada',
};

const STATUS_CLASS: Record<WorkflowPost['status'], string> = {
  rascunho: 'post-status--rascunho', revisao_interna: 'post-status--revisao',
  aprovado_interno: 'post-status--aprovado-interno', enviado_cliente: 'post-status--enviado',
  aprovado_cliente: 'post-status--aprovado-cliente', correcao_cliente: 'post-status--correcao',
};

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

interface EtapaCompliance {
  etapa: WorkflowEtapa;
  daysUsed: number;
  deadline: Date;
  daysOverdue: number; // 0 = on time, >0 = late
  assigneeName: string;
}

function computeCompliance(etapas: WorkflowEtapa[], membros: { id: number; nome: string }[]): EtapaCompliance[] {
  return etapas
    .filter(e => e.status === 'concluido' && e.iniciado_em && e.concluido_em)
    .map(e => {
      const deadline = computeDeadlineDate(e.iniciado_em!, e.prazo_dias, e.tipo_prazo);
      const daysUsed = daysBetween(e.iniciado_em!, e.concluido_em!);
      const concludedDate = new Date(e.concluido_em!);
      const daysOverdue = concludedDate > deadline
        ? Math.ceil((concludedDate.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const membro = e.responsavel_id ? membros.find(m => m.id === e.responsavel_id) : undefined;
      return { etapa: e, daysUsed, deadline, daysOverdue, assigneeName: membro?.nome ?? '—' };
    });
}

// ── Props ────────────────────────────────────────────────────────────────────

interface HistoryDrawerProps {
  workflow: Workflow;
  clienteName?: string;
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function HistoryDrawer({ workflow, clienteName, onClose }: HistoryDrawerProps) {
  const workflowId = workflow.id!;
  const [expandedPostId, setExpandedPostId] = useState<number | null>(null);

  const { data: etapas = [] } = useQuery({
    queryKey: ['history-etapas', workflowId],
    queryFn: () => getWorkflowEtapas(workflowId),
  });

  const { data: posts = [] } = useQuery({
    queryKey: ['history-posts', workflowId],
    queryFn: () => getWorkflowPostsWithProperties(workflowId),
  });

  const { data: membros = [] } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });

  const postIds = posts.map(p => p.id).filter(Boolean) as number[];
  const { data: approvals = [] } = useQuery({
    queryKey: ['history-approvals', postIds.join(',')],
    queryFn: () => getPostApprovals(postIds),
    enabled: postIds.length > 0,
  });

  const compliance = computeCompliance(etapas, membros);

  // Total duration: first etapa start → last etapa end
  const firstStart = etapas.find(e => e.iniciado_em)?.iniciado_em;
  const concludedEtapas = etapas.filter(e => e.concluido_em);
  const lastEnd = concludedEtapas.length > 0
    ? concludedEtapas[concludedEtapas.length - 1].concluido_em
    : null;
  const totalDays = firstStart && lastEnd ? daysBetween(firstStart, lastEnd) : null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel">
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-header-info">
            <div className="drawer-header-title">{workflow.titulo}</div>
            <div className="drawer-header-subtitle">
              {clienteName || '—'}
              {lastEnd && <> &bull; Concluído em {formatDateFull(lastEnd)}</>}
            </div>
            {totalDays !== null && (
              <div className="history-duration">Duração total: {totalDays} dia{totalDays !== 1 ? 's' : ''}</div>
            )}
          </div>
          <button className="drawer-close-btn" onClick={onClose} title="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="drawer-body">
          {/* Etapa Timeline */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div className="history-section-title">Etapas</div>
            <div className="history-timeline">
              {compliance.map((c, i) => {
                const isLate = c.daysOverdue > 0;
                const mod = isLate ? 'late' : 'ok';
                return (
                  <div key={c.etapa.id} className="history-step">
                    <div className="history-step-track">
                      <div className={`history-step-icon history-step-icon--${mod}`}>
                        <Check className="h-3 w-3" />
                      </div>
                      {i < compliance.length - 1 && (
                        <div className={`history-step-line history-step-line--${mod}`} />
                      )}
                    </div>
                    <div className="history-step-body">
                      <div className="history-step-header">
                        <span className="history-step-name">{c.etapa.nome}</span>
                        <span className={`history-step-badge history-step-badge--${mod}`}>
                          {isLate ? `${c.daysOverdue}d de atraso` : '✓ No prazo'}
                        </span>
                      </div>
                      <div className="history-step-detail">
                        {c.assigneeName} &bull; {formatDateShort(c.etapa.iniciado_em!)} → {formatDateShort(c.etapa.concluido_em!)} &bull; {c.daysUsed} dia{c.daysUsed !== 1 ? 's' : ''} (prazo: {c.etapa.prazo_dias}d {c.etapa.tipo_prazo === 'uteis' ? 'úteis' : 'corridos'})
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Final node */}
              <div className="history-final-node">
                <div className="history-final-icon"><Flag className="h-3 w-3" /></div>
                <span>Fluxo concluído</span>
              </div>
            </div>
          </div>

          {/* Posts */}
          <div>
            <div className="history-section-title">Posts ({posts.length})</div>
            <div className="drawer-posts-list">
              {posts.map(post => {
                const isExpanded = expandedPostId === post.id;
                const postApprovals = approvals.filter(a => a.post_id === post.id);
                return (
                  <div key={post.id} className={`drawer-post-item${isExpanded ? ' expanded' : ''}`}>
                    {/* Trigger row */}
                    <div className="drawer-post-trigger" onClick={() => setExpandedPostId(isExpanded ? null : post.id!)}>
                      <div className="drawer-post-trigger-left">
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4 drawer-post-chevron" />
                          : <ChevronRight className="h-4 w-4 drawer-post-chevron" />
                        }
                        <span className="post-tipo-badge">{TIPO_LABELS[post.tipo]}</span>
                        <span className="drawer-post-titulo">{post.titulo || 'Post sem título'}</span>
                      </div>
                      <div className="drawer-post-trigger-right">
                        <span className={`post-status-chip ${STATUS_CLASS[post.status]}`}>
                          {STATUS_LABELS[post.status]}
                        </span>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="drawer-post-content">
                        {/* Properties */}
                        {workflow.template_id != null && workflow.template_id !== 0 && (
                          <PropertyPanel
                            templateId={workflow.template_id}
                            postId={post.id!}
                            workflowId={workflowId}
                            propertyValues={(post as WorkflowPost & { property_values?: PostPropertyValue[] }).property_values ?? []}
                            membros={membros}
                            readOnly
                          />
                        )}

                        {/* Content */}
                        <PostEditor
                          key={post.id}
                          initialContent={post.conteudo}
                          disabled
                          onUpdate={() => {}}
                        />

                        {/* Approval thread */}
                        {postApprovals.length > 0 && (
                          <div className="history-approval-thread">
                            <div className="history-thread-label">
                              <MessageSquare className="h-3.5 w-3.5" /> Comentários ({postApprovals.length})
                            </div>
                            {postApprovals.map(a => (
                              <ApprovalBubble key={a.id} approval={a} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Approval Bubble ──────────────────────────────────────────────────────────

function ApprovalBubble({ approval }: { approval: PostApproval }) {
  const isTeam = approval.is_workspace_user;
  const actionLabel = isTeam
    ? 'Equipe'
    : approval.action === 'correcao'
    ? 'Correção solicitada'
    : approval.action === 'aprovado'
    ? 'Aprovado'
    : 'Cliente';

  return (
    <div className={`approval-bubble${isTeam ? ' approval-bubble--team' : ' approval-bubble--client'}`}>
      <div className="approval-bubble-meta">
        <span className="approval-bubble-author">{actionLabel}</span>
        <span className="approval-bubble-date">
          {new Date(approval.created_at).toLocaleDateString('pt-BR', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
        </span>
      </div>
      {approval.comentario && (
        <p className="approval-bubble-text">{approval.comentario}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/components/HistoryDrawer.tsx
git commit -m "feat: add HistoryDrawer component for concluded workflows"
```

---

### Task 6: Create ConcludedView for Entregas page

**Files:**
- Create: `src/pages/entregas/views/ConcludedView.tsx`

- [ ] **Step 1: Create ConcludedView.tsx**

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getConcludedWorkflows, getWorkflowEtapas, getWorkflowPosts, getClientes, type Workflow, type Cliente, type WorkflowEtapa } from '../../../store';
import { HistoryDrawer } from '../components/HistoryDrawer';

interface ConcludedWorkflowSummary {
  workflow: Workflow;
  postCount: number;
  totalDays: number | null;
  completedAt: string | null;
}

interface ClientGroup {
  cliente: Cliente;
  workflows: ConcludedWorkflowSummary[];
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function ConcludedView() {
  const [expandedClients, setExpandedClients] = useState<Set<number>>(new Set());
  const [selectedWorkflow, setSelectedWorkflow] = useState<{ workflow: Workflow; clienteName: string } | null>(null);

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  const { data: concludedWorkflows = [], isLoading } = useQuery({
    queryKey: ['concluded-workflows'],
    queryFn: getConcludedWorkflows,
  });

  // Fetch etapas and post counts for all concluded workflows
  const { data: summaries = [] } = useQuery({
    queryKey: ['concluded-summaries', concludedWorkflows.map(w => w.id).join(',')],
    queryFn: async (): Promise<ConcludedWorkflowSummary[]> => {
      return Promise.all(concludedWorkflows.map(async (workflow): Promise<ConcludedWorkflowSummary> => {
        const [etapas, posts] = await Promise.all([
          getWorkflowEtapas(workflow.id!),
          getWorkflowPosts(workflow.id!),
        ]);
        const firstStart = etapas.find(e => e.iniciado_em)?.iniciado_em;
        const concludedEtapas = etapas.filter(e => e.concluido_em);
        const lastEnd = concludedEtapas.length > 0 ? concludedEtapas[concludedEtapas.length - 1].concluido_em : null;
        const totalDays = firstStart && lastEnd
          ? Math.round((new Date(lastEnd).getTime() - new Date(firstStart).getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return { workflow, postCount: posts.length, totalDays, completedAt: lastEnd ?? null };
      }));
    },
    enabled: concludedWorkflows.length > 0,
  });

  // Group by client
  const groups: ClientGroup[] = [];
  const clientMap = new Map<number, ConcludedWorkflowSummary[]>();
  for (const s of summaries) {
    const list = clientMap.get(s.workflow.cliente_id) ?? [];
    list.push(s);
    clientMap.set(s.workflow.cliente_id, list);
  }
  for (const [clienteId, workflows] of clientMap) {
    const cliente = clientes.find(c => c.id === clienteId);
    if (cliente) groups.push({ cliente, workflows });
  }
  groups.sort((a, b) => a.cliente.nome.localeCompare(b.cliente.nome));

  const toggleClient = (id: number) => {
    setExpandedClients(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return <div className="drawer-empty">Carregando...</div>;
  }

  if (summaries.length === 0) {
    return <div className="drawer-empty" style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>Nenhum fluxo concluído ainda.</div>;
  }

  return (
    <>
      <div className="animate-up">
        {groups.map(group => {
          const isOpen = expandedClients.has(group.cliente.id!);
          return (
            <div key={group.cliente.id} className="concluded-client-group">
              <div className="concluded-client-header" onClick={() => toggleClient(group.cliente.id!)}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
                <div className="concluded-client-dot" style={{ background: group.cliente.cor || '#888' }} />
                <span className="concluded-client-name">{group.cliente.nome}</span>
                <span className="concluded-client-count">({group.workflows.length} fluxo{group.workflows.length > 1 ? 's' : ''})</span>
              </div>
              {isOpen && (
                <div className="concluded-client-workflows">
                  {group.workflows.map(s => (
                    <div
                      key={s.workflow.id}
                      className="concluded-wf-row"
                      onClick={() => setSelectedWorkflow({ workflow: s.workflow, clienteName: group.cliente.nome })}
                    >
                      <div>
                        <div className="concluded-wf-title">{s.workflow.titulo}</div>
                        <div className="concluded-wf-meta">
                          {s.postCount} post{s.postCount !== 1 ? 's' : ''}
                          {s.totalDays !== null && <> &bull; {s.totalDays} dia{s.totalDays !== 1 ? 's' : ''}</>}
                          {s.completedAt && <> &bull; Concluído {formatDateShort(s.completedAt)}</>}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>→</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedWorkflow && (
        <HistoryDrawer
          workflow={selectedWorkflow.workflow}
          clienteName={selectedWorkflow.clienteName}
          onClose={() => setSelectedWorkflow(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/views/ConcludedView.tsx
git commit -m "feat: add ConcludedView for concluded workflows tab"
```

---

### Task 7: Add "Concluídas" tab to EntregasPage

**Files:**
- Modify: `src/pages/entregas/EntregasPage.tsx`

- [ ] **Step 1: Import ConcludedView and History icon**

Add to the imports at the top of `EntregasPage.tsx`:

```typescript
import { ConcludedView } from './views/ConcludedView';
import { Plus, LayoutGrid, Info, BarChart2, Calendar, List, Columns, Archive } from 'lucide-react';
```

Remove the old `lucide-react` import line that doesn't include `Archive`.

- [ ] **Step 2: Extend the ActiveView type and VIEW_TABS**

Replace the type and tabs constant:

```typescript
type ActiveView = 'kanban' | 'chart' | 'calendar' | 'list' | 'concluded';

const VIEW_TABS: { id: ActiveView; label: string; icon: React.ReactNode }[] = [
  { id: 'kanban', label: 'Kanban', icon: <Columns className="h-4 w-4" /> },
  { id: 'chart', label: 'Gráfico', icon: <BarChart2 className="h-4 w-4" /> },
  { id: 'calendar', label: 'Calendário', icon: <Calendar className="h-4 w-4" /> },
  { id: 'list', label: 'Lista', icon: <List className="h-4 w-4" /> },
  { id: 'concluded', label: 'Concluídas', icon: <Archive className="h-4 w-4" /> },
];
```

- [ ] **Step 3: Add the ConcludedView rendering**

After the `{activeView === 'list' && (` block (around line 155), add:

```typescript
      {activeView === 'concluded' && <ConcludedView />}
```

- [ ] **Step 4: Hide filters when on the Concluídas tab**

Wrap the EntregasFilters in a conditional. Change line 133:

```typescript
      {activeView !== 'concluded' && (
        <EntregasFilters filters={filters} onChange={setFilters} clientes={clientes} membros={membros} />
      )}
```

- [ ] **Step 5: Verify compile and test in browser**

Run: `npx tsc --noEmit`
Expected: no errors

Open the app, navigate to Entregas, click "Concluídas" tab — it should show grouped concluded workflows (or an empty state if none exist).

- [ ] **Step 6: Commit**

```bash
git add src/pages/entregas/EntregasPage.tsx
git commit -m "feat: add Concluídas tab to Entregas page"
```

---

### Task 8: Add "Histórico de Entregas" to ClienteDetalhePage

**Files:**
- Modify: `src/pages/cliente-detalhe/ClienteDetalhePage.tsx`

- [ ] **Step 1: Import HistoryDrawer and new store functions**

Add to the existing imports from `../../store`:

```typescript
  getConcludedWorkflowsByCliente,
  getWorkflowPosts,
```

Add the component import:

```typescript
import { HistoryDrawer } from '../entregas/components/HistoryDrawer';
```

- [ ] **Step 2: Add state for history drawer and concluded workflows data**

Inside the `ClienteDetalhePage` component, after the existing `recurringWfId` state (around line 72), add:

```typescript
  const [historyWorkflow, setHistoryWorkflow] = useState<Workflow | null>(null);
```

- [ ] **Step 3: Add query for concluded workflows and their summaries**

After the `clienteWorkflowsRaw` query (around line 134), add:

```typescript
  const { data: concludedWfs = [] } = useQuery({
    queryKey: ['concluded-by-cliente', clienteId],
    queryFn: () => getConcludedWorkflowsByCliente(clienteId),
    enabled: !isNaN(clienteId),
  });

  const { data: concludedSummaries = [] } = useQuery({
    queryKey: ['concluded-summaries-cliente', concludedWfs.map(w => w.id).join(',')],
    queryFn: async () => {
      return Promise.all(concludedWfs.map(async (workflow) => {
        const [etapas, posts] = await Promise.all([
          getWorkflowEtapas(workflow.id!),
          getWorkflowPosts(workflow.id!),
        ]);
        const firstStart = etapas.find(e => e.iniciado_em)?.iniciado_em;
        const concludedEtapas = etapas.filter(e => e.concluido_em);
        const lastEnd = concludedEtapas.length > 0 ? concludedEtapas[concludedEtapas.length - 1].concluido_em : null;
        const totalDays = firstStart && lastEnd
          ? Math.round((new Date(lastEnd).getTime() - new Date(firstStart).getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return { workflow, postCount: posts.length, totalDays, completedAt: lastEnd ?? null };
      }));
    },
    enabled: concludedWfs.length > 0,
  });
```

- [ ] **Step 4: Add the "Histórico de Entregas" section in the JSX**

After the "Entregas Ativas + Post Calendar" section closing `</div>` and `)}` (find the closing of `{workflowsWithEtapas.length > 0 && (` block), add:

```typescript
      {/* Histórico de Entregas */}
      {concludedSummaries.length > 0 && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">Histórico de Entregas</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {concludedSummaries.map(s => (
              <div
                key={s.workflow.id}
                className="concluded-wf-row"
                onClick={() => setHistoryWorkflow(s.workflow)}
              >
                <div>
                  <div className="concluded-wf-title">{s.workflow.titulo}</div>
                  <div className="concluded-wf-meta">
                    {s.postCount} post{s.postCount !== 1 ? 's' : ''}
                    {s.totalDays !== null && <> &bull; {s.totalDays} dia{s.totalDays !== 1 ? 's' : ''}</>}
                    {s.completedAt && <> &bull; Concluído {new Date(s.completedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</>}
                  </div>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>→</span>
              </div>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Add the HistoryDrawer render at the bottom of the component**

Before the final closing `</div>` of the return statement, add:

```typescript
      {historyWorkflow && (
        <HistoryDrawer
          workflow={historyWorkflow}
          clienteName={cliente?.nome}
          onClose={() => setHistoryWorkflow(null)}
        />
      )}
```

- [ ] **Step 6: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/pages/cliente-detalhe/ClienteDetalhePage.tsx
git commit -m "feat: add Histórico de Entregas section to client detail page"
```

---

### Task 9: Manual verification

- [ ] **Step 1: Verify Entregas page "Concluídas" tab**

Open the app → Entregas → click "Concluídas" tab:
- Concluded workflows should appear grouped by client
- Clicking a client header toggles expand/collapse
- Clicking a workflow row opens the HistoryDrawer
- HistoryDrawer shows: header with title/client/date/duration, etapa timeline with compliance badges, posts list
- Clicking a post expands to show content, properties (read-only), and approval thread
- Closing the drawer returns to the list

- [ ] **Step 2: Verify Client Detail page history section**

Open the app → Clientes → click a client that has concluded workflows:
- "Histórico de Entregas" section should appear below "Entregas Ativas"
- Clicking a workflow row opens the HistoryDrawer with correct client name
- All drawer functionality works the same as from the Entregas page

- [ ] **Step 3: Verify read-only behavior**

In the HistoryDrawer:
- PostEditor content should be visible but not editable
- Property values should display but not respond to clicks
- No "Adicionar propriedade" buttons should appear
- No edit, delete, or status change controls visible

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```
