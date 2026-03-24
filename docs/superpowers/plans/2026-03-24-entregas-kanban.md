# Entregas Kanban Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Entregas page into a full kanban with drag-and-drop and add Chart, Calendar, and List visualization modes.

**Architecture:** Extract the monolithic `EntregasPage.tsx` into a thin shell + 4 view components + shared components/hooks. Add `position` to `workflows` DB table for persistent card ordering. Use `@dnd-kit` for drag-and-drop.

**Tech Stack:** React 19, TypeScript, Vite, Tanstack Query v5, Supabase, `@dnd-kit/core` + `@dnd-kit/sortable`, `react-chartjs-2` + `chart.js ^4`, `date-fns` (already installed), shadcn/ui, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-03-24-entregas-kanban-design.md`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/store.ts` | Add `position` to `Workflow` type; add `updateWorkflowPositions` |
| Create | `supabase/migrations/<timestamp>_add_workflow_position.sql` | DB migration |
| Create | `src/pages/entregas/hooks/useEntregasData.ts` | Data fetching, BoardCard building, `computeDeadlineDate` |
| Create | `src/pages/entregas/components/EntregasFilters.tsx` | Filter bar (client, member, status) |
| Create | `src/pages/entregas/components/WorkflowCard.tsx` | Card UI shared by Kanban + List |
| Create | `src/pages/entregas/components/WorkflowModals.tsx` | NewWorkflowModal, EditWorkflowModal, DeleteWorkflowModal, RecurringWorkflowDialog, TemplatesModal |
| Rewrite | `src/pages/entregas/EntregasPage.tsx` | Thin shell: view switcher, filter state, modal state, sort state |
| Create | `src/pages/entregas/views/KanbanView.tsx` | @dnd-kit drag-and-drop board |
| Create | `src/pages/entregas/views/ChartView.tsx` | Deadline status doughnut chart |
| Create | `src/pages/entregas/views/CalendarView.tsx` | Custom monthly calendar grid |
| Create | `src/pages/entregas/views/ListView.tsx` | Sortable table |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @dnd-kit and react-chartjs-2**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities react-chartjs-2
```

Expected: packages added to `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Verify build still passes**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(entregas): install @dnd-kit and react-chartjs-2 dependencies"
```

---

## Task 2: DB Migration — Add position to workflows

**Files:**
- Create: `supabase/migrations/<timestamp>_add_workflow_position.sql`

> Note: Find the correct migration timestamp format by running `ls supabase/migrations/` and matching the existing naming pattern.

- [ ] **Step 1: Create the migration file**

Check existing migrations for naming format:
```bash
ls supabase/migrations/
```

Create the migration file with the next timestamp (use current UTC datetime in `YYYYMMDDHHmmss` format):

```sql
-- Add position column to workflows for persistent card ordering within kanban columns
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Backfill distinct positions for existing active workflows
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY template_id, etapa_atual
           ORDER BY id
         ) - 1 AS new_position
  FROM workflows
  WHERE status = 'ativo'
)
UPDATE workflows
SET position = ranked.new_position
FROM ranked
WHERE workflows.id = ranked.id;
```

- [ ] **Step 2: Push migration to Supabase**

```bash
npx supabase db push --linked
```

Expected: migration applied successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(entregas): add position column to workflows for kanban card ordering"
```

---

## Task 3: Update Store — Workflow type + updateWorkflowPositions

**Files:**
- Modify: `src/store.ts`

- [ ] **Step 1: Add `position` field to the `Workflow` interface**

Find the `Workflow` interface in `src/store.ts` (around line 576). Add the `position` field:

```ts
export interface Workflow {
  id?: number;
  conta_id?: string;
  user_id?: string;
  cliente_id: number;
  titulo: string;
  template_id?: number | null;
  status: 'ativo' | 'concluido' | 'arquivado';
  etapa_atual: number;
  recorrente: boolean;
  link_notion?: string | null;
  link_drive?: string | null;
  position?: number;  // <-- add this line
  created_at?: string;
}
```

- [ ] **Step 2: Add `updateWorkflowPositions` function to store**

Add after the `updateWorkflow` function (around line 631):

```ts
export async function updateWorkflowPositions(updates: { id: number; position: number }[]): Promise<void> {
  await Promise.all(
    updates.map(({ id, position }) =>
      supabase.from('workflows').update({ position }).eq('id', id).then(({ error }) => {
        if (error) throw error;
      })
    )
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/store.ts
git commit -m "feat(entregas): add position to Workflow type and updateWorkflowPositions store fn"
```

---

## Task 4: Create useEntregasData Hook

**Files:**
- Create: `src/pages/entregas/hooks/useEntregasData.ts`

This hook centralizes all data fetching and derived state that the views need.

- [ ] **Step 1: Create the hooks directory and file**

```bash
mkdir -p src/pages/entregas/hooks
```

- [ ] **Step 2: Write the hook**

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getWorkflows, getClientes, getMembros, getWorkflowTemplates, getWorkflowEtapas,
  getPortalApprovals, getDeadlineInfo,
  type Workflow, type WorkflowEtapa, type Cliente, type Membro,
  type WorkflowTemplate, type PortalApproval,
} from '../../../store';

export interface BoardCard {
  workflow: Workflow;
  etapa: WorkflowEtapa;
  cliente: Cliente | undefined;
  membro: Membro | undefined;
  deadline: ReturnType<typeof getDeadlineInfo>;
  totalEtapas: number;
  etapaIdx: number;
  allEtapas: WorkflowEtapa[];
}

export interface BoardRow {
  key: string;
  label: string;
  stepNames: string[];
  columns: Map<string, BoardCard[]>;
}

export interface BoardFilters {
  filterCliente: number | null;
  filterMembro: number | null;
  filterStatus: 'todos' | 'atrasado' | 'urgente' | 'em_dia';
}

/**
 * Computes the absolute deadline date from an etapa's start time and duration.
 * - corridos: adds prazo_dias calendar days
 * - uteis: advances prazo_dias Mon–Fri days (no public holiday exclusions)
 */
export function computeDeadlineDate(
  iniciado_em: string,
  prazo_dias: number,
  tipo_prazo: 'corridos' | 'uteis'
): Date {
  const start = new Date(iniciado_em);
  if (tipo_prazo === 'corridos') {
    const result = new Date(start);
    result.setDate(result.getDate() + prazo_dias);
    return result;
  }
  // uteis: count only Mon-Fri
  let remaining = prazo_dias;
  const cursor = new Date(start);
  while (remaining > 0) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return cursor;
}

/**
 * Computes the estimated workflow end date by chaining all remaining etapas
 * from the active one through the last, starting from the active etapa's iniciado_em.
 * Returns null if the active etapa has no iniciado_em.
 */
export function computeWorkflowDeadlineDate(
  allEtapas: WorkflowEtapa[],
  activeEtapa: WorkflowEtapa
): Date | null {
  if (!activeEtapa.iniciado_em) return null;
  const sorted = [...allEtapas].sort((a, b) => a.ordem - b.ordem);
  const activeIdx = sorted.findIndex(e => e.id === activeEtapa.id);
  if (activeIdx === -1) return null;
  const remaining = sorted.slice(activeIdx);

  let currentStart = activeEtapa.iniciado_em;
  let deadline: Date = new Date(currentStart);
  for (const etapa of remaining) {
    deadline = computeDeadlineDate(currentStart, etapa.prazo_dias, etapa.tipo_prazo);
    currentStart = deadline.toISOString();
  }
  return deadline;
}

export function useEntregasData() {
  const qc = useQueryClient();

  const { data: workflows = [], isLoading: loadingWf } = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
  });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: membros = [] } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const { data: templates = [] } = useQuery({ queryKey: ['workflow-templates'], queryFn: getWorkflowTemplates });

  const activeWorkflows = workflows.filter(w => w.status === 'ativo');

  const etapasQuery = useQuery({
    queryKey: ['all-active-etapas', activeWorkflows.map(w => w.id).join(',')],
    queryFn: async () => {
      const map = new Map<number, WorkflowEtapa[]>();
      await Promise.all(
        activeWorkflows.map(async w => {
          const etapas = await getWorkflowEtapas(w.id!);
          map.set(w.id!, etapas);
        })
      );
      return map;
    },
    enabled: !loadingWf,
  });

  const etapasMap: Map<number, WorkflowEtapa[]> = etapasQuery.data || new Map();

  // Collect approval etapa IDs for portal approvals query
  const approvalEtapaIds: number[] = [];
  for (const [, etapas] of etapasMap) {
    for (const e of etapas) {
      if (e.tipo === 'aprovacao_cliente' && e.status === 'ativo' && e.id) {
        approvalEtapaIds.push(e.id);
      }
    }
  }

  const { data: portalApprovals = [] } = useQuery<PortalApproval[]>({
    queryKey: ['portal-approvals', approvalEtapaIds.join(',')],
    queryFn: () => getPortalApprovals(approvalEtapaIds),
    enabled: approvalEtapaIds.length > 0,
  });

  // Build BoardCards from active workflows
  const cards: BoardCard[] = [];
  for (const w of activeWorkflows) {
    const etapas = etapasMap.get(w.id!) || [];
    let activeEtapa = etapas.find(e => e.status === 'ativo');
    if (!activeEtapa && etapas.length > 0) {
      activeEtapa = etapas[w.etapa_atual] || etapas[0];
    }
    if (!activeEtapa) continue;
    const cliente = clientes.find(c => c.id === w.cliente_id);
    const membro = activeEtapa.responsavel_id
      ? membros.find(m => m.id === activeEtapa!.responsavel_id)
      : undefined;
    const deadline = getDeadlineInfo(activeEtapa);
    cards.push({
      workflow: w,
      etapa: activeEtapa,
      cliente,
      membro,
      deadline,
      totalEtapas: etapas.length,
      etapaIdx: activeEtapa.ordem,
      allEtapas: etapas,
    });
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ['workflows'] });
    qc.invalidateQueries({ queryKey: ['workflow-templates'] });
    qc.invalidateQueries({ queryKey: ['all-active-etapas'] });
    qc.invalidateQueries({ queryKey: ['portal-approvals'] });
  }

  const isLoading = loadingWf || etapasQuery.isLoading;

  return {
    workflows,
    activeWorkflows,
    clientes,
    membros,
    templates,
    etapasMap,
    cards,
    portalApprovals,
    isLoading,
    refresh,
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/entregas/hooks/useEntregasData.ts
git commit -m "feat(entregas): add useEntregasData hook with BoardCard building and deadline helpers"
```

---

## Task 5: Create EntregasFilters Component

**Files:**
- Create: `src/pages/entregas/components/EntregasFilters.tsx`

- [ ] **Step 1: Create components directory and filter component**

```bash
mkdir -p src/pages/entregas/components
```

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Cliente, Membro } from '../../../store';

export interface FilterState {
  filterCliente: number | null;
  filterMembro: number | null;
  filterStatus: 'todos' | 'atrasado' | 'urgente' | 'em_dia';
}

interface EntregasFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  clientes: Cliente[];
  membros: Membro[];
}

export function EntregasFilters({ filters, onChange, clientes, membros }: EntregasFiltersProps) {
  const activeClientes = clientes.filter(c => c.status === 'ativo');

  return (
    <div className="leads-toolbar animate-up">
      <div className="filter-bar" style={{ margin: 0 }}>
        {(['todos', 'atrasado', 'urgente', 'em_dia'] as const).map(s => (
          <button
            key={s}
            className={`filter-btn${filters.filterStatus === s ? ' active' : ''}`}
            onClick={() => onChange({ ...filters, filterStatus: s })}
          >
            {s === 'todos' ? 'Todos' : s === 'atrasado' ? '🔴 Atrasados' : s === 'urgente' ? '🟡 Urgentes' : '🟢 Em dia'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Select
          value={filters.filterCliente ? String(filters.filterCliente) : '__none__'}
          onValueChange={val => onChange({ ...filters, filterCliente: val === '__none__' ? null : Number(val) })}
        >
          <SelectTrigger style={{ minWidth: 180 }}><SelectValue placeholder="Todos os clientes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Todos os clientes</SelectItem>
            {activeClientes.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={filters.filterMembro ? String(filters.filterMembro) : '__none__'}
          onValueChange={val => onChange({ ...filters, filterMembro: val === '__none__' ? null : Number(val) })}
        >
          <SelectTrigger style={{ minWidth: 180 }}><SelectValue placeholder="Todos os membros" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Todos os membros</SelectItem>
            {membros.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/components/EntregasFilters.tsx
git commit -m "feat(entregas): add EntregasFilters shared component"
```

---

## Task 6: Create WorkflowCard Component

**Files:**
- Create: `src/pages/entregas/components/WorkflowCard.tsx`

This renders a single workflow card. It's used by both KanbanView and ListView.

- [ ] **Step 1: Write the component**

The card HTML/CSS mirrors what's currently inlined in `EntregasPage.tsx` starting around line 865. Extract it into a reusable component:

```tsx
import type { BoardCard } from '../hooks/useEntregasData';

const avatarColors = ['#eab308', '#3ecf8e', '#f5a342', '#f542c8', '#42c8f5', '#8b5cf6', '#ef4444', '#14b8a6'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}
function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

interface WorkflowCardProps {
  card: BoardCard;
  onClick?: () => void;
  /** Set to true when rendering inside DragOverlay — disables pointer events */
  isDragOverlay?: boolean;
  /** Optional drag handle element rendered at the top-right */
  dragHandle?: React.ReactNode;
}

export function WorkflowCard({ card, onClick, isDragOverlay, dragHandle }: WorkflowCardProps) {
  const dl = card.deadline;
  const deadlineClass = dl.estourado
    ? 'deadline-overdue'
    : dl.urgente
    ? 'deadline-warning'
    : dl.diasRestantes <= 3
    ? 'deadline-caution'
    : 'deadline-ok';
  const deadlineText = dl.estourado
    ? `${Math.abs(dl.diasRestantes)}d atrasado`
    : dl.diasRestantes === 0 && dl.horasRestantes === 0
    ? 'Vence agora'
    : dl.diasRestantes === 0
    ? `${dl.horasRestantes}h restantes`
    : dl.horasRestantes > 0
    ? `${dl.diasRestantes}d ${dl.horasRestantes}h restantes`
    : `${dl.diasRestantes}d restantes`;
  const progressPct = card.totalEtapas > 0 ? Math.round((card.etapaIdx / card.totalEtapas) * 100) : 0;
  const iniciadoEm = card.etapa.iniciado_em
    ? new Date(card.etapa.iniciado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    : null;

  return (
    <div
      className={`board-card ${deadlineClass}`}
      style={{ opacity: isDragOverlay ? 0.8 : 1, cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      {dragHandle && (
        <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', cursor: 'grab', color: 'var(--text-muted)' }}>
          {dragHandle}
        </div>
      )}
      <div className="board-card-top">
        <span className="board-card-client" style={{ borderLeft: `3px solid ${card.cliente?.cor || '#888'}`, paddingLeft: '0.5rem' }}>
          {card.cliente?.nome || '—'}
        </span>
        {card.workflow.recorrente && <span title="Recorrente" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>↻</span>}
      </div>
      <div className="board-card-title">{card.workflow.titulo}</div>
      <div className="board-card-meta">
        <span className={`board-card-deadline ${deadlineClass}`}>{deadlineText}</span>
        <span className="board-card-prazo-type">{card.etapa.tipo_prazo === 'uteis' ? 'dias úteis' : 'dias corridos'}</span>
      </div>
      {card.membro ? (
        <div
          className="board-card-assignee"
          style={{ width: 28, height: 28, borderRadius: '50%', background: getAvatarColor(card.membro.nome), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}
        >
          {getInitials(card.membro.nome)}
        </div>
      ) : (
        <div className="board-card-assignee" style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
          ?
        </div>
      )}
      <div className="board-card-footer">
        <div className="board-card-progress-bar">
          <div className="board-card-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="board-card-steps">{card.etapaIdx + 1}/{card.totalEtapas}</span>
        {iniciadoEm && <span className="board-card-started">Início: {iniciadoEm}</span>}
      </div>
    </div>
  );
}
```

Note: The `board-card-assignee--clickable` behavior (assign dropdown) from the original is intentionally omitted here — that interaction lives in KanbanView which passes an `onClick` to open the edit modal.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/components/WorkflowCard.tsx
git commit -m "feat(entregas): add WorkflowCard shared component"
```

---

## Task 7: Extract WorkflowModals Component

**Files:**
- Create: `src/pages/entregas/components/WorkflowModals.tsx`
- Modify: `src/pages/entregas/EntregasPage.tsx` (temporarily, modals removed later in Task 8)

Move these components from `EntregasPage.tsx` into `WorkflowModals.tsx`:
- `EtapaRow` (helper, stays internal to the file)
- `NewWorkflowModal`
- `EditWorkflowModal`
- `TemplatesModal`

They also need `RecurringWorkflowDialog` (currently inlined in the main return of `EntregasPage`) and `RevertConfirmDialog` (new — for kanban backward drag).

- [ ] **Step 1: Create WorkflowModals.tsx**

Copy the `EtapaRow`, `NewWorkflowModal`, `EditWorkflowModal`, and `TemplatesModal` functions verbatim from `EntregasPage.tsx` into `WorkflowModals.tsx`. Add the imports they need at the top. Add two new small components at the bottom:

```tsx
// RecurringWorkflowDialog — shown when a recurring workflow completes
interface RecurringWorkflowDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
export function RecurringWorkflowDialog({ open, onConfirm, onCancel }: RecurringWorkflowDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={open => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Criar novo ciclo?</AlertDialogTitle>
          <AlertDialogDescription>Este fluxo é recorrente. Deseja criar um novo ciclo?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Não</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Criar novo ciclo</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// RevertConfirmDialog — shown when a card is dragged backward in kanban
interface RevertConfirmDialogProps {
  open: boolean;
  workflowTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}
export function RevertConfirmDialog({ open, workflowTitle, onConfirm, onCancel }: RevertConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={open => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reverter etapa?</AlertDialogTitle>
          <AlertDialogDescription>
            Isso vai reverter "{workflowTitle}" para a etapa anterior. Esta ação pode ser refeita arrastando para frente novamente.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Reverter</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Make sure all four modal functions are exported: `export function NewWorkflowModal`, `export function EditWorkflowModal`, `export function TemplatesModal`, `export function RecurringWorkflowDialog`, `export function RevertConfirmDialog`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no errors. At this point both `EntregasPage.tsx` and `WorkflowModals.tsx` define the modals (duplication is fine — it gets cleaned up in Task 8).

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/components/WorkflowModals.tsx
git commit -m "feat(entregas): extract workflow modals into WorkflowModals component"
```

---

## Task 8: Rewrite EntregasPage as Shell

**Files:**
- Rewrite: `src/pages/entregas/EntregasPage.tsx`

Replace the entire file content. The shell owns view state, filter state, sort state, modal state. It renders view switcher tabs + `EntregasFilters` + one of the four views.

- [ ] **Step 1: Write the new shell**

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, LayoutGrid, Info, BarChart2, Calendar, List, Columns } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useEntregasData, type BoardCard } from './hooks/useEntregasData';
import { EntregasFilters, type FilterState } from './components/EntregasFilters';
import {
  NewWorkflowModal, EditWorkflowModal, TemplatesModal,
  RecurringWorkflowDialog,
} from './components/WorkflowModals';
import { KanbanView } from './views/KanbanView';
import { ChartView } from './views/ChartView';
import { CalendarView } from './views/CalendarView';
import { ListView } from './views/ListView';
import { duplicateWorkflow } from '../../store';

type ActiveView = 'kanban' | 'chart' | 'calendar' | 'list';

const VIEW_TABS: { id: ActiveView; label: string; icon: React.ReactNode }[] = [
  { id: 'kanban', label: 'Kanban', icon: <Columns className="h-4 w-4" /> },
  { id: 'chart', label: 'Gráfico', icon: <BarChart2 className="h-4 w-4" /> },
  { id: 'calendar', label: 'Calendário', icon: <Calendar className="h-4 w-4" /> },
  { id: 'list', label: 'Lista', icon: <List className="h-4 w-4" /> },
];

export default function EntregasPage() {
  const qc = useQueryClient();
  const [activeView, setActiveView] = useState<ActiveView>('kanban');
  const [filters, setFilters] = useState<FilterState>({ filterCliente: null, filterMembro: null, filterStatus: 'todos' });
  const [listSort, setListSort] = useState<{ column: string; direction: 'asc' | 'desc' }>({ column: 'titulo', direction: 'asc' });
  const [newWorkflowOpen, setNewWorkflowOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editCard, setEditCard] = useState<BoardCard | null>(null);
  const [recurringWfId, setRecurringWfId] = useState<number | null>(null);

  const { clientes, membros, templates, cards, activeWorkflows, isLoading, refresh } = useEntregasData();

  // Apply filters
  let filteredCards = cards;
  if (filters.filterCliente) filteredCards = filteredCards.filter(c => c.workflow.cliente_id === filters.filterCliente);
  if (filters.filterMembro) filteredCards = filteredCards.filter(c => c.etapa.responsavel_id === filters.filterMembro);
  if (filters.filterStatus === 'atrasado') filteredCards = filteredCards.filter(c => c.deadline.estourado);
  else if (filters.filterStatus === 'urgente') filteredCards = filteredCards.filter(c => c.deadline.urgente && !c.deadline.estourado);
  else if (filters.filterStatus === 'em_dia') filteredCards = filteredCards.filter(c => !c.deadline.estourado && !c.deadline.urgente);

  const overdue = cards.filter(c => c.deadline.estourado).length;
  const urgent = cards.filter(c => c.deadline.urgente && !c.deadline.estourado).length;

  const handleRecurringConfirm = async () => {
    if (!recurringWfId) return;
    try {
      await duplicateWorkflow(recurringWfId);
      toast.success('Novo ciclo criado!');
    } catch { toast.error('Erro ao criar ciclo'); }
    setRecurringWfId(null);
    refresh();
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header className="header animate-up">
        <div className="header-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h1>Entregas</h1>
            <span data-tooltip="Acompanhe o andamento das entregas e fluxos ativos." data-tooltip-dir="right" style={{ display: 'flex' }}>
              <Info className="h-5 w-5 cursor-pointer" style={{ color: 'var(--text-muted)' }} />
            </span>
          </div>
          <p>
            fluxos ativos: {activeWorkflows.length}
            {overdue > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}> • {overdue} atrasado{overdue > 1 ? 's' : ''}</span>}
            {urgent > 0 && <span style={{ color: 'var(--warning)', fontWeight: 600 }}> • {urgent} urgente{urgent > 1 ? 's' : ''}</span>}
          </p>
        </div>
        <div className="header-actions">
          {/* View switcher */}
          <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--surface-2)', padding: '0.25rem', borderRadius: '8px' }}>
            {VIEW_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveView(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.4rem 0.9rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: activeView === tab.id ? 'var(--accent)' : 'transparent',
                  color: activeView === tab.id ? '#fff' : 'var(--text-secondary)',
                  fontSize: '0.8rem', fontWeight: activeView === tab.id ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={() => setTemplatesOpen(true)}><LayoutGrid className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Templates</Button>
          <Button onClick={() => setNewWorkflowOpen(true)}><Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> Novo Fluxo</Button>
        </div>
      </header>

      <EntregasFilters filters={filters} onChange={setFilters} clientes={clientes} membros={membros} />

      {activeView === 'kanban' && (
        <KanbanView
          cards={filteredCards}
          onCardClick={setEditCard}
          onRefresh={refresh}
          onRecurring={setRecurringWfId}
        />
      )}
      {activeView === 'chart' && <ChartView cards={filteredCards} />}
      {activeView === 'calendar' && <CalendarView cards={filteredCards} onCardClick={setEditCard} />}
      {activeView === 'list' && (
        <ListView
          cards={filteredCards}
          sort={listSort}
          onSortChange={setListSort}
          onCardClick={setEditCard}
        />
      )}

      {newWorkflowOpen && (
        <NewWorkflowModal
          open={newWorkflowOpen}
          onClose={() => setNewWorkflowOpen(false)}
          clientes={clientes}
          membros={membros}
          templates={templates}
          onCreated={refresh}
        />
      )}
      {editCard && (
        <EditWorkflowModal
          card={editCard}
          membros={membros}
          clientes={clientes}
          onClose={() => setEditCard(null)}
          onSaved={refresh}
          onDeleted={refresh}
        />
      )}
      {templatesOpen && (
        <TemplatesModal
          open={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
          templates={templates}
          membros={membros}
          onRefresh={refresh}
        />
      )}
      <RecurringWorkflowDialog
        open={!!recurringWfId}
        onConfirm={handleRecurringConfirm}
        onCancel={() => setRecurringWfId(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create stub view files so imports resolve**

Create empty stub exports for the views (they'll be filled in subsequent tasks):

`src/pages/entregas/views/KanbanView.tsx`:
```tsx
import type { BoardCard } from '../hooks/useEntregasData';
import type { Cliente, Membro } from '../../../store';
export function KanbanView(_props: { cards: BoardCard[]; clientes: Cliente[]; membros: Membro[]; onCardClick: (c: BoardCard) => void; onRefresh: () => void; onRecurring: (id: number) => void; }) {
  return <div>Kanban (em breve)</div>;
}
```

`src/pages/entregas/views/ChartView.tsx`:
```tsx
import type { BoardCard } from '../hooks/useEntregasData';
export function ChartView(_props: { cards: BoardCard[] }) {
  return <div>Gráfico (em breve)</div>;
}
```

`src/pages/entregas/views/CalendarView.tsx`:
```tsx
import type { BoardCard } from '../hooks/useEntregasData';
export function CalendarView(_props: { cards: BoardCard[]; onCardClick: (c: BoardCard) => void }) {
  return <div>Calendário (em breve)</div>;
}
```

`src/pages/entregas/views/ListView.tsx`:
```tsx
import type { BoardCard } from '../hooks/useEntregasData';
export function ListView(_props: { cards: BoardCard[]; sort: { column: string; direction: 'asc' | 'desc' }; onSortChange: (s: { column: string; direction: 'asc' | 'desc' }) => void; onCardClick: (c: BoardCard) => void }) {
  return <div>Lista (em breve)</div>;
}
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: no errors. The page should now render with "em breve" stubs for all views.

- [ ] **Step 4: Commit**

```bash
git add src/pages/entregas/EntregasPage.tsx src/pages/entregas/views/
git commit -m "feat(entregas): rewrite EntregasPage as view-switcher shell with stub views"
```

---

## Task 9: Implement KanbanView

**Files:**
- Rewrite: `src/pages/entregas/views/KanbanView.tsx`

- [ ] **Step 1: Write KanbanView with full DnD support**

```tsx
import { useState, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { completeEtapa, revertEtapa, updateWorkflowPositions } from '../../../store';
import type { BoardCard } from '../hooks/useEntregasData';
import { WorkflowCard } from '../components/WorkflowCard';
import { RevertConfirmDialog } from '../components/WorkflowModals';

interface KanbanViewProps {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
  onRefresh: () => void;
  onRecurring: (workflowId: number) => void;
}

interface BoardRow {
  key: string;
  label: string;
  stepNames: string[];
  columns: Map<string, BoardCard[]>;
}

function buildBoardRows(cards: BoardCard[]): BoardRow[] {
  const rowMap = new Map<string, BoardRow>();
  for (const card of cards) {
    const sorted = [...card.allEtapas].sort((a, b) => a.ordem - b.ordem);
    const stepNames = sorted.map(e => e.nome);
    const key = stepNames.join(' → ');
    if (!rowMap.has(key)) {
      const columns = new Map<string, BoardCard[]>();
      for (const name of stepNames) columns.set(name, []);
      rowMap.set(key, { key, label: key, stepNames, columns });
    }
    const row = rowMap.get(key)!;
    const col = row.columns.get(card.etapa.nome);
    if (col) col.push(card);
  }
  // Sort cards within each column by position ascending
  for (const row of rowMap.values()) {
    for (const col of row.columns.values()) {
      col.sort((a, b) => (a.workflow.position ?? 0) - (b.workflow.position ?? 0));
    }
  }
  return [...rowMap.values()].filter(r => [...r.columns.values()].some(col => col.length > 0));
}

// Droppable column body — registers the column as a drop target so empty columns can receive drops
function DroppableColumnBody({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className="board-column-body" style={{ minHeight: 60 }}>
      {children}
    </div>
  );
}

// Draggable card wrapper
function SortableCard({ card, onCardClick }: { card: BoardCard; onCardClick: (c: BoardCard) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(card.workflow.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    position: 'relative' as const,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <WorkflowCard
        card={card}
        onClick={() => onCardClick(card)}
        dragHandle={<GripVertical className="h-4 w-4" {...listeners} />}
      />
    </div>
  );
}

// Column droppable ID prefix — distinguishes column IDs from card IDs in handleDragEnd
const COL_PREFIX = 'col:';

export function KanbanView({ cards, onCardClick, onRefresh, onRecurring }: KanbanViewProps) {
  const [localCards, setLocalCards] = useState<BoardCard[]>(cards);
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  const [revertTarget, setRevertTarget] = useState<{ workflowId: number; title: string } | null>(null);

  // Sync local state when prop cards change (after refresh)
  if (JSON.stringify(cards.map(c => c.workflow.id)) !== JSON.stringify(localCards.map(c => c.workflow.id))) {
    setLocalCards(cards);
  }

  const boardRows = buildBoardRows(localCards);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const findCard = (id: string) => localCards.find(c => String(c.workflow.id) === id);

  const findCardColumn = (cardId: string, rows: BoardRow[]): { row: BoardRow; colName: string } | null => {
    for (const row of rows) {
      for (const [colName, colCards] of row.columns) {
        if (colCards.some(c => String(c.workflow.id) === cardId)) return { row, colName };
      }
    }
    return null;
  };

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const card = findCard(String(event.active.id));
    setActiveCard(card || null);
  }, [localCards]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const draggedCard = findCard(activeId);
    if (!draggedCard) return;

    const rows = buildBoardRows(localCards);
    const activeLocation = findCardColumn(activeId, rows);
    if (!activeLocation) return;

    // Resolve target column name: either from a card hover or a column droppable
    let targetColName: string;
    let targetRow: BoardRow;
    if (overId.startsWith(COL_PREFIX)) {
      // Dropped onto a column droppable (e.g. empty column)
      const colId = overId.slice(COL_PREFIX.length); // "rowKey::colName"
      const [rowKey, colName] = colId.split('::');
      const row = rows.find(r => r.key === rowKey);
      if (!row) return;
      targetRow = row;
      targetColName = colName;
    } else {
      // Dropped onto a card
      const overLocation = findCardColumn(overId, rows);
      if (!overLocation) return;
      targetRow = overLocation.row;
      targetColName = overLocation.colName;
    }

    if (targetColName === activeLocation.colName && targetRow.key === activeLocation.row.key) {
      // Within-column reorder
      const col = activeLocation.row.columns.get(activeLocation.colName) || [];
      const oldIdx = col.findIndex(c => String(c.workflow.id) === activeId);
      const newIdx = overId.startsWith(COL_PREFIX)
        ? col.length - 1
        : col.findIndex(c => String(c.workflow.id) === overId);
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

      const reordered = arrayMove(col, oldIdx, newIdx);
      const prevCards = [...localCards];

      // Optimistic update
      const updatedCards = localCards.map(c => {
        const idx = reordered.findIndex(r => r.workflow.id === c.workflow.id);
        if (idx !== -1) return { ...c, workflow: { ...c.workflow, position: idx } };
        return c;
      });
      setLocalCards(updatedCards);

      try {
        await updateWorkflowPositions(
          reordered.map((c, i) => ({ id: c.workflow.id!, position: i }))
        );
        onRefresh();
      } catch {
        setLocalCards(prevCards);
        toast.error('Erro ao salvar ordem dos cartões');
      }
    } else {
      // Between-column move — check adjacency by ordem
      const activeEtapaOrdem = draggedCard.etapa.ordem;

      // Find target etapa ordem from any card in that column (or from the dragged card's allEtapas)
      const targetColCards = targetRow.columns.get(targetColName) || [];
      const targetOrdem = targetColCards.length > 0
        ? targetColCards[0].allEtapas.find(e => e.nome === targetColName)?.ordem
        : draggedCard.allEtapas.find(e => e.nome === targetColName)?.ordem;

      if (targetOrdem === undefined) return;
      const diff = targetOrdem - activeEtapaOrdem;
      if (Math.abs(diff) !== 1) {
        toast.error('Só é possível mover para a etapa adjacente');
        return;
      }

      if (diff === 1) {
        // Forward — completeEtapa
        try {
          const result = await completeEtapa(draggedCard.workflow.id!, draggedCard.etapa.id!);
          if (result.workflow.status === 'concluido' && draggedCard.workflow.recorrente) {
            onRecurring(draggedCard.workflow.id!);
          } else {
            toast.success('Etapa concluída!');
          }
          onRefresh();
        } catch (err: unknown) {
          toast.error((err as Error).message || 'Erro ao avançar etapa');
        }
      } else {
        // Backward — show confirm dialog
        setRevertTarget({
          workflowId: draggedCard.workflow.id!,
          title: draggedCard.workflow.titulo,
        });
      }
    }
  }, [localCards, onRefresh, onRecurring]);

  const handleRevertConfirm = async () => {
    if (!revertTarget) return;
    try {
      await revertEtapa(revertTarget.workflowId);
      toast.success('Etapa revertida!');
      onRefresh();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao reverter etapa');
    }
    setRevertTarget(null);
  };

  if (localCards.length === 0) {
    return (
      <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <p>Nenhuma entrega encontrada. Ajuste os filtros ou crie um novo fluxo.</p>
      </div>
    );
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="board-rows-wrapper animate-up">
          {boardRows.map((row, rowIdx) => (
            <div key={row.key}>
              {boardRows.length > 1 && <div className="board-row-label" style={{ marginBottom: '1rem' }}>{row.label}</div>}
              <div className="board-container">
                {[...row.columns.entries()].map(([stepName, stepCards]) => (
                  <div key={stepName} className="board-column">
                    <div className="board-column-header">
                      <span className="board-column-title">{stepName}</span>
                      <span className="board-column-count">{stepCards.length}</span>
                    </div>
                    <DroppableColumnBody id={`${COL_PREFIX}${row.key}::${stepName}`}>
                      <SortableContext
                        items={stepCards.map(c => String(c.workflow.id))}
                        strategy={verticalListSortingStrategy}
                      >
                        {stepCards.length === 0
                          ? <div className="board-empty">Nenhuma entrega</div>
                          : stepCards.map(card => (
                            <SortableCard
                              key={card.workflow.id}
                              card={card}
                              onCardClick={onCardClick}
                            />
                          ))
                        }
                      </SortableContext>
                    </DroppableColumnBody>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <DragOverlay>
          {activeCard && <WorkflowCard card={activeCard} isDragOverlay />}
        </DragOverlay>
      </DndContext>
      <RevertConfirmDialog
        open={!!revertTarget}
        workflowTitle={revertTarget?.title || ''}
        onConfirm={handleRevertConfirm}
        onCancel={() => setRevertTarget(null)}
      />
    </>
  );
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

- [ ] **Step 3: Manual smoke test**

Run `npm run dev`, navigate to Entregas, verify:
- Cards render in columns
- Cards can be dragged and reordered within a column
- Dragging to the next column advances the etapa
- Dragging to a previous column shows the confirm dialog

- [ ] **Step 4: Commit**

```bash
git add src/pages/entregas/views/KanbanView.tsx
git commit -m "feat(entregas): implement KanbanView with @dnd-kit drag-and-drop"
```

---

## Task 10: Implement ChartView

**Files:**
- Rewrite: `src/pages/entregas/views/ChartView.tsx`

- [ ] **Step 1: Write ChartView**

```tsx
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import type { BoardCard } from '../hooks/useEntregasData';

ChartJS.register(ArcElement, Tooltip, Legend);

interface ChartViewProps {
  cards: BoardCard[];
}

export function ChartView({ cards }: ChartViewProps) {
  const atrasado = cards.filter(c => c.deadline.estourado).length;
  const urgente = cards.filter(c => c.deadline.urgente && !c.deadline.estourado).length;
  const emDia = cards.filter(c => !c.deadline.estourado && !c.deadline.urgente).length;

  if (cards.length === 0) {
    return (
      <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
      </div>
    );
  }

  const data = {
    labels: ['Em dia', 'Urgente', 'Atrasado'],
    datasets: [{
      data: [emDia, urgente, atrasado],
      backgroundColor: ['#3ecf8e', '#eab308', '#ef4444'],
      borderWidth: 0,
    }],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { position: 'bottom' as const },
    },
  };

  return (
    <div className="animate-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem' }}>
      <div style={{ maxWidth: 320, width: '100%' }}>
        <Doughnut data={data} options={options} />
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { label: 'Em dia', count: emDia, color: '#3ecf8e' },
          { label: 'Urgente', count: urgente, color: '#eab308' },
          { label: 'Atrasado', count: atrasado, color: '#ef4444' },
        ].map(stat => (
          <div key={stat.label} className="card" style={{ textAlign: 'center', minWidth: 120, padding: '1.5rem 2rem' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: stat.color }}>{stat.count}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/views/ChartView.tsx
git commit -m "feat(entregas): implement ChartView with deadline status doughnut chart"
```

---

## Task 11: Implement CalendarView

**Files:**
- Rewrite: `src/pages/entregas/views/CalendarView.tsx`

- [ ] **Step 1: Write CalendarView**

```tsx
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BoardCard } from '../hooks/useEntregasData';
import { computeDeadlineDate, computeWorkflowDeadlineDate } from '../hooks/useEntregasData';

interface CalendarViewProps {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
}

interface CalendarEvent {
  card: BoardCard;
  type: 'etapa' | 'workflow';
  date: Date;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function CalendarView({ cards, onCardClick }: CalendarViewProps) {
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  // Build events for this month
  const events: CalendarEvent[] = [];
  for (const card of cards) {
    if (card.etapa.iniciado_em) {
      const etapaDeadline = computeDeadlineDate(card.etapa.iniciado_em, card.etapa.prazo_dias, card.etapa.tipo_prazo);
      if (etapaDeadline.getFullYear() === year && etapaDeadline.getMonth() === month) {
        events.push({ card, type: 'etapa', date: etapaDeadline });
      }
      const wfDeadline = computeWorkflowDeadlineDate(card.allEtapas, card.etapa);
      if (wfDeadline && wfDeadline.getFullYear() === year && wfDeadline.getMonth() === month) {
        // Only add workflow deadline if different date from etapa deadline
        if (!isSameDay(wfDeadline, etapaDeadline)) {
          events.push({ card, type: 'workflow', date: wfDeadline });
        }
      }
    }
  }

  // Build grid — first day of month, last day, padding days
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  if (cards.length === 0) {
    return (
      <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
      </div>
    );
  }

  return (
    <div className="animate-up" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
        <span style={{ fontWeight: 600, fontSize: '1rem', textTransform: 'capitalize', minWidth: 180, textAlign: 'center' }}>{monthLabel}</span>
        <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.25rem' }}>
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, padding: '0.5rem 0' }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.25rem' }}>
        {cells.map((day, idx) => {
          const dayEvents = day
            ? events.filter(e => e.date.getDate() === day)
            : [];
          const isToday = day !== null && isSameDay(new Date(year, month, day), today);
          return (
            <div
              key={idx}
              style={{
                minHeight: 80,
                padding: '0.4rem',
                background: 'var(--surface-2)',
                borderRadius: 6,
                border: isToday ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                opacity: day === null ? 0 : 1,
              }}
            >
              {day !== null && (
                <>
                  <div style={{ fontSize: '0.75rem', fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--accent)' : 'var(--text-secondary)', marginBottom: '0.25rem' }}>{day}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    {dayEvents.map((ev, i) => (
                      <div
                        key={i}
                        onClick={() => onCardClick(ev.card)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.3rem',
                          padding: '0.15rem 0.3rem',
                          borderRadius: 4,
                          background: 'var(--surface-3)',
                          cursor: 'pointer',
                          fontSize: '0.7rem',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                        }}
                        title={`${ev.card.workflow.titulo} — ${ev.type === 'etapa' ? 'Etapa: ' + ev.card.etapa.nome : 'Conclusão prevista'}`}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: ev.type === 'etapa' ? '#3b82f6' : '#f97316', flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.card.workflow.titulo}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} /> Prazo da etapa</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} /> Conclusão prevista</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/views/CalendarView.tsx
git commit -m "feat(entregas): implement CalendarView with monthly grid and dual deadline badges"
```

---

## Task 12: Implement ListView

**Files:**
- Rewrite: `src/pages/entregas/views/ListView.tsx`

- [ ] **Step 1: Write ListView**

```tsx
import { ChevronUp, ChevronDown } from 'lucide-react';
import { getDeadlineInfo } from '../../../store';
import type { BoardCard } from '../hooks/useEntregasData';

interface ListViewProps {
  cards: BoardCard[];
  sort: { column: string; direction: 'asc' | 'desc' };
  onSortChange: (sort: { column: string; direction: 'asc' | 'desc' }) => void;
  onCardClick: (card: BoardCard) => void;
}

type Column = { key: string; label: string };
const COLUMNS: Column[] = [
  { key: 'titulo', label: 'Título' },
  { key: 'cliente', label: 'Cliente' },
  { key: 'etapa', label: 'Etapa atual' },
  { key: 'responsavel', label: 'Responsável' },
  { key: 'prazo', label: 'Prazo' },
  { key: 'status', label: 'Status' },
];

function getStatusBadge(card: BoardCard) {
  const dl = card.deadline;
  if (dl.estourado) return { label: 'Atrasado', color: '#ef4444' };
  if (dl.urgente) return { label: 'Urgente', color: '#eab308' };
  return { label: 'Em dia', color: '#3ecf8e' };
}

function sortCards(cards: BoardCard[], column: string, direction: 'asc' | 'desc'): BoardCard[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...cards].sort((a, b) => {
    switch (column) {
      case 'titulo': return dir * a.workflow.titulo.localeCompare(b.workflow.titulo);
      case 'cliente': return dir * ((a.cliente?.nome || '').localeCompare(b.cliente?.nome || ''));
      case 'etapa': return dir * a.etapa.nome.localeCompare(b.etapa.nome);
      case 'responsavel': return dir * ((a.membro?.nome || '').localeCompare(b.membro?.nome || ''));
      case 'prazo': return dir * (a.deadline.diasRestantes - b.deadline.diasRestantes);
      case 'status': {
        const order = (c: BoardCard) => c.deadline.estourado ? 0 : c.deadline.urgente ? 1 : 2;
        return dir * (order(a) - order(b));
      }
      default: return 0;
    }
  });
}

export function ListView({ cards, sort, onSortChange, onCardClick }: ListViewProps) {
  if (cards.length === 0) {
    return (
      <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
      </div>
    );
  }

  const sorted = sortCards(cards, sort.column, sort.direction);

  const handleSort = (key: string) => {
    if (sort.column === key) {
      onSortChange({ column: key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ column: key, direction: 'asc' });
    }
  };

  const dl = (card: BoardCard) => {
    const d = card.deadline;
    if (d.estourado) return `${Math.abs(d.diasRestantes)}d atrasado`;
    if (d.diasRestantes === 0) return `${d.horasRestantes}h restantes`;
    return `${d.diasRestantes}d restantes`;
  };

  return (
    <div className="animate-up card" style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr>
            {COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                style={{
                  padding: '0.75rem 1rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  borderBottom: '1px solid var(--border-color)',
                  color: sort.column === col.key ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: 600,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  {col.label}
                  {sort.column === col.key
                    ? sort.direction === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    : null
                  }
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(card => {
            const badge = getStatusBadge(card);
            return (
              <tr
                key={card.workflow.id}
                onClick={() => onCardClick(card)}
                style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '0.75rem 1rem' }}>{card.workflow.titulo}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span style={{ borderLeft: `3px solid ${card.cliente?.cor || '#888'}`, paddingLeft: '0.5rem' }}>
                    {card.cliente?.nome || '—'}
                  </span>
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>{card.etapa.nome}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{card.membro?.nome || '—'}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{dl(card)}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span style={{ padding: '0.2rem 0.6rem', borderRadius: 12, background: badge.color + '22', color: badge.color, fontSize: '0.75rem', fontWeight: 600 }}>
                    {badge.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/entregas/views/ListView.tsx
git commit -m "feat(entregas): implement ListView with sortable table"
```

---

## Task 13: Final Cleanup

**Files:**
- Modify: `src/pages/entregas/EntregasPage.tsx` (remove any leftover duplicate modal code if it was left from Task 7)
- Verify: `src/store.ts` — ensure `updateWorkflowPositions` is exported
- Verify: `.gitignore` — ensure `.superpowers/` is listed

- [ ] **Step 1: Check .gitignore**

```bash
grep -n "superpowers" .gitignore
```

If not present:
```bash
echo ".superpowers/" >> .gitignore
git add .gitignore
```

- [ ] **Step 2: Full build + dev smoke test**

```bash
npm run build
npm run dev
```

Manually verify all four views render and function correctly.

- [ ] **Step 3: Final commit**

```bash
git add src/ supabase/ docs/ .gitignore
git commit -m "feat(entregas): complete Entregas kanban with DnD, chart, calendar, and list views"
```

---

## Summary

| Task | Deliverable |
|---|---|
| 1 | Dependencies installed |
| 2 | DB migration: `position` column on `workflows` |
| 3 | `Workflow.position` type + `updateWorkflowPositions` store fn |
| 4 | `useEntregasData` hook + `computeDeadlineDate` + `computeWorkflowDeadlineDate` |
| 5 | `EntregasFilters` component |
| 6 | `WorkflowCard` component |
| 7 | `WorkflowModals` component (extracted + `RevertConfirmDialog`) |
| 8 | `EntregasPage` rewritten as shell with view switcher |
| 9 | `KanbanView` with full @dnd-kit DnD |
| 10 | `ChartView` with doughnut chart |
| 11 | `CalendarView` with monthly grid + dual deadlines |
| 12 | `ListView` with sortable table |
| 13 | Cleanup + final smoke test |
