# Post Schedule/Posted Status in Client Calendar

**Date:** 2026-04-06  
**Status:** Approved

## Overview

Add two new statuses — `agendado` (scheduled) and `postado` (posted) — to the `WorkflowPost` status pipeline. Expose these as actionable pipeline chips on each post card in the client detail page calendar side panel, and add them to the status dropdown in the workflow drawer.

## Data Model

### `WorkflowPost['status']` — `store.ts`

Extend the union type with two new values at the end of the pipeline:

```ts
status:
  | 'rascunho'
  | 'revisao_interna'
  | 'aprovado_interno'
  | 'enviado_cliente'
  | 'aprovado_cliente'
  | 'correcao_cliente'
  | 'agendado'
  | 'postado'
```

No new database columns needed — these values are stored in the existing `status` column.

**Transition rules:**
- `agendado` is only reachable from `aprovado_cliente` or `aprovado_interno`
- `postado` is only reachable from `agendado`
- Both are terminal states (no reverse transition in the UI)

## UI: Client Calendar Side Panel (`ClienteDetalhePage.tsx`)

Each post card in the `scheduled-panel` gets a pipeline chip row at the bottom, showing a simplified 3-step progression: **Aprovado → Agendado → Postado**.

### Chip states per post status

| Post `status` | "Aprovado" chip | "Agendar" chip | "Postado" chip |
|---|---|---|---|
| rascunho, revisao_interna, enviado_cliente, correcao_cliente | neutral (current label) | disabled, muted | hidden/disabled |
| aprovado_interno, aprovado_cliente | ✓ blue filled | **clickable** (blue outline) | disabled, muted |
| agendado | ✓ blue filled | ✓ green filled | **clickable** (green outline) |
| postado | ✓ blue filled | ✓ green filled | ✓ green filled (final) |

### Interactions

- Clicking **"Agendar"** (when enabled): calls `updateWorkflowPost(id, { status: 'agendado' })`, then invalidates the post calendar query to refresh the panel.
- Clicking **"Marcar Postado"** (when enabled): calls `updateWorkflowPost(id, { status: 'postado' })`, then invalidates the query.
- Both actions show a toast on success/failure.
- Disabled chips are non-interactive (no cursor, muted color).

### Layout

Chips are rendered inline below the post date:

```
[✓ Aprovado] → [○ Agendar] → [Postado]   ← approved state
[✓ Aprovado] → [✓ Agendado] → [○ Marcar Postado]  ← scheduled state
```

Arrows (`→`) between chips are decorative separators.

## UI: Workflow Drawer (`WorkflowDrawer.tsx`)

Add the two new statuses to the existing maps:

```ts
STATUS_LABELS:
  agendado: 'Agendado',
  postado: 'Postado',

STATUS_CLASS:
  agendado: 'post-status--agendado',
  postado: 'post-status--postado',
```

The `<select>` dropdown already iterates `Object.keys(STATUS_LABELS)`, so no further changes needed there beyond adding to the map.

## UI: History Drawer (`HistoryDrawer.tsx`)

Add the same two entries to its local `STATUS_CLASS` map (same keys and values as above).

## CSS

Add two new chip styles to the existing post-status stylesheet:

- `.post-status--agendado` — amber/teal tone to distinguish "scheduled but not yet live"
- `.post-status--postado` — solid green, matches the confirmed/done visual language already used in the app

## Out of Scope

- No reverse transitions (un-schedule, un-post) in this iteration
- No timestamp recorded for when a post was scheduled or posted
- No filtering/grouping of calendar by schedule status
