# Custom Properties for Sub-tasks (Posts)

**Date:** 2026-04-02
**Status:** Approved — ready for implementation
**Scope:** Phase 1 (Formula, Rollup, Relation, Files & media deferred to Phase 2)

---

## Overview

Agencies need to attach structured, typed metadata to individual posts (sub-tasks) inside a workflow — things like "Plataforma", "Data de Publicação", "Designer Responsável". These properties are defined at the workflow template level so every workflow created from that template shares the same schema, and they appear as editable fields in the post drawer above the rich text editor. A per-property toggle controls which fields are visible to clients in the portal.

---

## Phase 1 Property Types

| Type | Description |
|---|---|
| `text` | Single-line free text |
| `number` | Numeric value (integer, decimal, percentage, currency) |
| `select` | Single-choice dropdown with colored options |
| `multiselect` | Multi-choice tag picker |
| `status` | Custom status with user-defined labels and colors (independent from post workflow status) |
| `date` | Date picker |
| `person` | Team member from `membros` table OR free-text external name |
| `checkbox` | Boolean true/false |
| `url` | URL string with link rendering |
| `email` | Email string |
| `phone` | Phone number string |
| `created_time` | Auto-populated from `workflow_posts.created_at` — computed, never stored in values table |

**Deferred to Phase 2:** Formula, Rollup, Relation, Files & media

---

## Database Schema

### `template_property_definitions`

One row per property field, linked to a workflow template.

```sql
CREATE TABLE template_property_definitions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      uuid NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  name             text NOT NULL,
  type             text NOT NULL CHECK (type IN (
                     'text','number','select','multiselect','status',
                     'date','person','checkbox','url','email','phone','created_time'
                   )),
  config           jsonb NOT NULL DEFAULT '{}',
  portal_visible   boolean NOT NULL DEFAULT false,
  display_order    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
```

**`config` JSONB shape by type:**

- `select` / `multiselect`:
  ```json
  { "options": [{ "id": "uuid", "label": "Instagram", "color": "#E1306C" }] }
  ```
- `status`:
  ```json
  { "options": [{ "id": "uuid", "label": "Não iniciado", "color": "#94a3b8" }, { "id": "uuid", "label": "Em andamento", "color": "#3b82f6" }, { "id": "uuid", "label": "Concluído", "color": "#22c55e" }] }
  ```
- `number`:
  ```json
  { "format": "integer" | "decimal" | "percentage" | "currency" }
  ```
- `person`:
  ```json
  { "allow_multiple": false }
  ```
- All others: `{}`

---

### `post_property_values`

One row per (post × property definition). Stores the value as JSONB.

```sql
CREATE TABLE post_property_values (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id                uuid NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  property_definition_id uuid NOT NULL REFERENCES template_property_definitions(id) ON DELETE CASCADE,
  value                  jsonb,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, property_definition_id)
);

CREATE INDEX idx_post_property_values_post_id ON post_property_values(post_id);
CREATE INDEX idx_post_property_values_definition_id ON post_property_values(property_definition_id);
CREATE INDEX idx_post_property_values_value ON post_property_values USING GIN (value);
```

**`value` JSONB shape by type:**

| Type | Value shape | Example |
|---|---|---|
| `text` | string | `"Precisa de legenda chamativa"` |
| `number` | number | `42` |
| `select` | string (option id) | `"abc-uuid"` |
| `multiselect` | string[] (option ids) | `["abc-uuid", "def-uuid"]` |
| `status` | string (option id) | `"abc-uuid"` |
| `date` | string (ISO date) | `"2026-04-15"` |
| `person` | object | `{ "membro_id": "uuid" }` or `{ "name": "João Externo" }` |
| `checkbox` | boolean | `true` |
| `url` / `email` / `phone` | string | `"https://example.com"` |
| `created_time` | — | Never stored — computed from `workflow_posts.created_at` |

---

### `workflow_select_options`

Per-workflow additions to `select` and `multiselect` options. Merges with template-level options at read time.

```sql
CREATE TABLE workflow_select_options (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id            uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  property_definition_id uuid NOT NULL REFERENCES template_property_definitions(id) ON DELETE CASCADE,
  option_id              uuid NOT NULL DEFAULT gen_random_uuid(),
  label                  text NOT NULL,
  color                  text NOT NULL DEFAULT '#94a3b8',
  created_at             timestamptz NOT NULL DEFAULT now()
);
```

When rendering a Select dropdown, the frontend merges:
1. Options from `template_property_definitions.config.options` (template-level)
2. Options from `workflow_select_options` for the current workflow (per-workflow additions)

---

## TypeScript Types

```ts
type PropertyType =
  | 'text' | 'number' | 'select' | 'multiselect'
  | 'status' | 'date' | 'person' | 'checkbox'
  | 'url' | 'email' | 'phone' | 'created_time'

interface SelectOption {
  id: string
  label: string
  color: string
}

type PropertyConfig =
  | { type: 'select' | 'multiselect' | 'status'; options: SelectOption[] }
  | { type: 'number'; format: 'integer' | 'decimal' | 'percentage' | 'currency' }
  | { type: 'person'; allow_multiple: boolean }
  | { type: 'text' | 'date' | 'checkbox' | 'url' | 'email' | 'phone' | 'created_time' }

interface TemplatePropertyDefinition {
  id: string
  templateId: string
  name: string
  type: PropertyType
  config: PropertyConfig
  portalVisible: boolean
  displayOrder: number
}

interface PostPropertyValue {
  id: string
  postId: string
  propertyDefinitionId: string
  value: unknown
  definition: TemplatePropertyDefinition
}

interface WorkflowSelectOption {
  id: string
  workflowId: string
  propertyDefinitionId: string
  optionId: string
  label: string
  color: string
}
```

---

## UI Design

### Post Drawer (`WorkflowDrawer`)

Properties appear as a structured panel **above** the TipTap rich text editor:

```
┌─────────────────────────────────────────┐
│ Post title + type badge + status badge  │
├─────────────────────────────────────────┤
│ PROPRIEDADES                            │
│  Plataforma     [Instagram ×]           │
│  Data Pub.      [15 Abr 2026]           │
│  Responsável    [Ana Lima]              │
│  + Adicionar propriedade                │
├─────────────────────────────────────────┤
│ CONTEÚDO                                │
│  [TipTap editor...]                     │
├─────────────────────────────────────────┤
│ [Approval thread...]                    │
└─────────────────────────────────────────┘
```

Clicking "+ Adicionar propriedade" opens the `PropertyDefinitionPanel` slide-in panel.

### Property Creator (`PropertyDefinitionPanel`)

A slide-in side panel with two columns:

- **Left column:** Scrollable list of all 12 property types with icon + label. Clicking selects the type.
- **Right column:** Configuration form for the selected type:
  - Name input (required)
  - Type-specific config (options list for select/status, format picker for number, etc.)
  - "Visível no portal" checkbox
  - "Criar propriedade" / "Salvar alterações" button

Since properties are defined at the template level, creating a property from within a post updates the shared template definition — a confirmation note is shown: *"Esta propriedade será adicionada a todos os posts neste template."*

### Template Editor (`TemplatesModal`)

A new **"Propriedades"** tab is added alongside existing tabs:

- Lists all `template_property_definitions` for the selected template
- Each row: drag handle (reorder) | type icon | property name | "Portal" toggle | edit | delete
- Deleting a property shows a confirmation: *"Isso removerá os valores preenchidos em todos os posts."*
- "+ Adicionar propriedade" button opens `PropertyDefinitionPanel`

### Client Portal (`PortalPage`)

Portal-visible properties are rendered as a **labeled property table** above the post content:

```
┌─────────────────────────────────┐
│ Plataforma    [Instagram]       │
│ Data Pub.     15 Abr 2026       │
│ Status        Pronto p/ revisar │
└─────────────────────────────────┘
[Post content...]
[Approve / Request changes buttons]
```

Only properties with `portal_visible = true` are included — filtered at the `portal-data` edge function level, not the frontend.

---

## Data Layer (store.ts additions)

### Reading

`getWorkflowPosts(workflowId)` is extended to join `post_property_values` → `template_property_definitions` for all posts in the workflow. Returns posts with a `propertyValues: PostPropertyValue[]` array.

### Writing

```ts
// Upsert a property value (debounced, 1500ms, same pattern as TipTap)
upsertPostPropertyValue(postId: string, definitionId: string, value: unknown): Promise<void>

// Create a new property definition on a template
createPropertyDefinition(templateId: string, payload: Omit<TemplatePropertyDefinition, 'id' | 'templateId'>): Promise<TemplatePropertyDefinition>

// Update an existing property definition
updatePropertyDefinition(id: string, payload: Partial<TemplatePropertyDefinition>): Promise<void>

// Delete a property definition (cascades to all post_property_values)
deletePropertyDefinition(id: string): Promise<void>

// Add a per-workflow select option on-the-fly
createWorkflowSelectOption(workflowId: string, definitionId: string, label: string, color: string): Promise<WorkflowSelectOption>
```

React Query cache key: `['workflow-posts', workflowId]` is invalidated after any write. Property definitions are cached under `['template-properties', templateId]`.

---

## Portal Edge Function Changes

`portal-data` is extended to:
1. Fetch `template_property_definitions` for the workflow's template where `portal_visible = true`
2. Fetch `post_property_values` for all posts, filtered to the portal-visible definition IDs
3. Fetch `workflow_select_options` for the workflow (for rendering select labels)

`portal-approve` requires no changes.

---

## Component Breakdown

| Component | Action | Purpose |
|---|---|---|
| `PropertyDefinitionPanel` | Create | Slide-in panel for creating/editing a property definition |
| `PropertyValue` | Create | Single editable property row — renders correct input per type |
| `PropertyPanel` | Create | Properties section in WorkflowDrawer — list of PropertyValue + add button |
| `PortalPropertyTable` | Create | Read-only labeled property table for client portal |
| `TemplatesModal` | Modify | Add "Propriedades" tab with definition list + CRUD |
| `WorkflowDrawer` | Modify | Add PropertyPanel above TipTap editor |
| `PortalPage` | Modify | Add PortalPropertyTable above post content |
| `store.ts` | Modify | Add 5 new data functions |
| `useEntregasData.ts` | Modify | Extend post query to join property values |

---

## Out of Scope (Phase 2)

- Formula properties (expression parsing, dependency resolution)
- Rollup properties (aggregate from related items)
- Relation properties (link posts to other posts or workflows)
- Files & media (Supabase Storage integration)
- Per-workflow property visibility overrides
- Client-editable properties in portal
- Filtering/sorting Kanban by property value
