# Workflow History — Design Spec

## Problem

When a workflow is concluded, it disappears from the UI entirely. Users have no way to reference historical workflow data — etapa timelines, posts, their content, properties, approval threads, or deadline compliance.

## Solution

A read-only **HistoryDrawer** component that shows concluded workflow details (summary first, full detail on demand), accessible from two locations:

1. **Entregas page** — new "Concluídas" tab with workflows grouped by client
2. **Client Detail page** — new "Histórico de Entregas" section below "Entregas Ativas"

## Data Layer

No schema changes required. All data already exists in the DB:

- `workflows.status = 'concluido'` identifies concluded workflows
- `workflow_etapas.iniciado_em` / `concluido_em` provide per-step timing
- `workflow_etapas.prazo_dias` + `tipo_prazo` enable deadline compliance calculation
- `workflow_posts`, `post_property_values`, `portal_approvals` linked by `workflow_id`

### New Store Functions

**`getConcludedWorkflows()`** — fetches all workflows where `status = 'concluido'`, ordered by most recently created (`created_at DESC`). Returns `Workflow[]`.

**`getConcludedWorkflowsByCliente(clienteId: number)`** — same query filtered by `cliente_id`. Returns `Workflow[]`.

Existing functions reused as-is for detail loading:
- `getWorkflowEtapas(workflowId)` — all etapas with timing data
- `getWorkflowPostsWithProperties(workflowId)` — posts with custom property values
- `getPostApprovals(postIds)` — approval/comment threads

### Deadline Compliance Computation

For each concluded etapa, compute whether it was on time:

1. Use existing `computeDeadlineDate(iniciado_em, prazo_dias, tipo_prazo)` from `useEntregasData.ts` to get the expected deadline
2. Compare with `concluido_em` — if `concluido_em <= deadline`, it was on time; otherwise compute days overdue
3. This is a pure client-side calculation, no new DB fields needed

### Total Duration

Computed as the difference between the first etapa's `iniciado_em` and the last etapa's `concluido_em`.

## HistoryDrawer Component

**File:** `src/pages/entregas/components/HistoryDrawer.tsx`

A read-only slide-in drawer (same overlay/panel pattern as `WorkflowDrawer`) with three sections:

### Header
- Workflow title
- Client name
- Completion date (last etapa's `concluido_em`, formatted as "Concluído em DD mmm YYYY")
- Total duration in days

### Etapa Timeline
Vertical timeline showing each etapa in order:
- **Checkpoint icon** — green circle with checkmark (on time) or red circle with checkmark (overdue)
- **Connecting line** between steps, colored to match compliance
- **Etapa name** (bold)
- **Compliance badge** — "No prazo" (green) or "Xd de atraso" (red)
- **Detail line** — assignee name (or "—" if none), date range ("DD mmm → DD mmm"), actual duration, deadline reference ("prazo: Xd úteis/corridos")
- **Final node** — flag icon with "Fluxo concluído"

### Posts Section
Header showing "Posts (N)" with total count.

Each post rendered as a collapsible row:
- **Collapsed state** — chevron, type badge (Feed/Reels/Stories/Carrossel with colored background), post title, final status chip
- **Expanded state** (click to toggle) — shows:
  - **Custom properties** — rendered read-only via `PropertyPanel` with a new `readOnly` prop (to be added — PropertyPanel currently has no read-only mode)
  - **Content** — `PostEditor` rendered in disabled mode (already supports `disabled` prop), showing the rich text content
  - **Approval thread** — reuses the same `PostApprovalBubble` rendering pattern from `WorkflowDrawer`, showing all comments with author, date, and text

### Props

```typescript
interface HistoryDrawerProps {
  workflow: Workflow;
  onClose: () => void;
}
```

The drawer fetches its own data (etapas, posts, approvals) via `useQuery` on mount, same pattern as `WorkflowDrawer`.

## Entregas Page — "Concluídas" Tab

**File:** `src/pages/entregas/views/ConcludedView.tsx`

A new view component added as a tab alongside Kanban, Lista, Calendário, and Gráficos in `EntregasPage.tsx`.

### Layout
- Workflows grouped by client, using the client's `cor` (color dot) and `nome`
- Each client group is collapsible (chevron toggle), showing workflow count
- Within each group, workflow rows sorted by completion date (newest first)
- Each row shows: workflow title, post count, total duration, completion date, and an arrow indicator
- Clicking a row opens `HistoryDrawer`

### Data
- Uses `getConcludedWorkflows()` for the full list
- Groups by `cliente_id`, looks up client info from the existing `clientes` query in `useEntregasData`
- Post counts and durations require loading etapas for each concluded workflow (batch query)

### Hook Extension

Extend `useEntregasData` to also return concluded workflows and their etapas:
- Add `concludedWorkflows` to the return value
- Add a separate `useQuery` for concluded workflow etapas (only fetched when the "Concluídas" tab is active, via `enabled` flag)

## Client Detail Page — "Histórico de Entregas" Section

**File:** `src/pages/cliente-detalhe/ClienteDetalhePage.tsx` (modify existing)

### Changes
- `getWorkflowsByCliente` already returns all workflows (including concluded). The page currently filters to `status === 'ativo'` only.
- Add a second filter for `status === 'concluido'` to get `concludedWorkflows`
- Render a new "Histórico de Entregas" card section below "Entregas Ativas" (only if `concludedWorkflows.length > 0`)
- Same row format as the Entregas tab: title, post count, duration, completion date
- Clicking a row opens `HistoryDrawer`
- Fetch etapas for concluded workflows to compute duration and post counts

## Component Reuse

| Existing Component | Usage in HistoryDrawer |
|---|---|
| `PostEditor` | Rendered with `disabled={true}` for content display |
| `PropertyPanel` | Add `readOnly` prop to disable all inputs; render values as text |
| `PostApprovalBubble` pattern | Copied inline or extracted to shared component for approval thread |
| `computeDeadlineDate` | Used for compliance calculation |

## Styling

Follow existing patterns:
- Drawer uses same `drawer-overlay` / `drawer-panel` CSS classes
- Etapa timeline uses new CSS classes (`history-timeline`, `history-step`, etc.) in existing entregas stylesheet
- Post rows reuse `drawer-post-item` / `drawer-post-trigger` patterns with minor adaptations
- Type badges and status chips reuse existing CSS classes from `WorkflowDrawer`
