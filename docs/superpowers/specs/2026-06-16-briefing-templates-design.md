---
title: Briefing Templates & Multiple Briefings per Client
date: 2026-06-16
status: approved
---

## Overview

Two related capabilities for the client Hub briefing feature:

1. **Multiple titled briefings per client.** Today a client has a single flat list of
   `hub_briefing_questions` grouped only by an optional `section`. We introduce a titled
   **briefing** container so a client can have several briefings (e.g. "Onboarding",
   "Campanha Natal"), each identified by its title. A briefing *wraps* sections — the
   existing `section` grouping is preserved as sub-tabs inside a briefing.

2. **Reusable briefing templates.** Agency users can create named question templates once
   and reuse them across clients — mirroring the existing Fluxos (`workflow_templates`)
   pattern. Templates can be applied:
   - **Manually**, via a "Usar template" picker in the client's Briefing tab (creates a new
     briefing from the template).
   - **Automatically** on new-client creation, from a single workspace **default** template.

   Applying a template **copies** its questions into a new briefing (independent copies — no
   propagation back from later template edits). The user then **edits inline** to adapt the
   questions to that client.

## Motivation

The only ways to populate a client briefing today are typing every question manually or
uploading a CSV — repetitive for agencies that ask the same discovery questions for every
new client. Templates remove that repetition and the default-template auto-seed means a new
client arrives with a briefing already in place. Multiple titled briefings let an agency run
distinct questionnaires per client (onboarding vs. per-campaign) without cramming everything
into one list.

This mirrors the proven Fluxos template pattern (`workflow_templates` → copied into
`workflow_etapas` per client, then edited), keeping the codebase consistent.

## Decisions (from brainstorming)

- **Apply flow:** Both — manual picker in the Briefing tab **and** auto-apply a default
  template on new-client creation.
- **Manage UI:** A "Templates" modal opened from the Briefing tab (mirrors the Fluxos
  `TemplatesModal`).
- **Override:** Edit inline after applying — applying copies questions into the new briefing,
  then the existing inline editor is reused to adapt them.
- **Propagation:** None. Applied questions are independent copies; editing a template never
  touches existing clients' briefings.
- **Default template:** One template per workspace marked default (a ⭐ toggle in the
  Templates modal). New clients seed from it; if none is marked, nothing auto-applies.
- **Structure:** Briefing **wraps** sections. Three levels: Briefing (titled) → Section
  (optional, sub-tabs) → Question.
- **Hub navigation:** Briefing tabs across the top of the Briefing page; sections render
  inside the selected briefing.
- **Auto-apply mechanism:** Approach A — app-level seed inside `addCliente()` (single
  chokepoint covering the new-client modal, CSV import, and lead conversion; testable in the
  Vitest suite). Not a Postgres trigger.

## Data Model

### 1. New table `briefings`

The titled container. One client → many briefings.

```sql
CREATE TABLE briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- Workspace-scoped RLS, same SELECT/INSERT/UPDATE/DELETE policy shape as
  `hub_briefing_questions` (access restricted by `conta_id`).
- `display_order` controls tab order; set sequentially on insert (no drag UI in v1).

### 2. Add `briefing_id` to `hub_briefing_questions`

```sql
ALTER TABLE hub_briefing_questions
  ADD COLUMN briefing_id uuid REFERENCES briefings(id) ON DELETE CASCADE;
```

**Backfill (same migration):** for each `cliente_id` that already has questions, create one
briefing titled **"Briefing"** (inheriting the client's `conta_id`) and set `briefing_id` on
all that client's existing questions. After backfill, set the column `NOT NULL`.

The existing `section` column is **kept** — it remains the optional sub-grouping inside a
briefing. `display_order` continues to order questions within a briefing.

### 3. New table `briefing_templates`

Mirrors `workflow_templates` (name + JSON array of items), with uuid PKs to match the
hub/briefing domain.

```sql
CREATE TABLE briefing_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,                            -- suggested briefing title
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ question: string, section: string|null }]
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one default template per workspace
CREATE UNIQUE INDEX briefing_templates_one_default
  ON briefing_templates (conta_id) WHERE is_default;
```

- Workspace-scoped RLS, same policy shape as `hub_briefing_questions`.
- `questions` is an ordered JSON array; each item is `{ question, section }` so a template can
  pre-define sectioned questions.

## Architecture

### CRM store layer (`apps/crm/src/store/hub.ts`)

New types:

```ts
export interface BriefingRow {
  id: string;
  cliente_id: number;
  conta_id: string;
  title: string;
  display_order: number;
  created_at: string;
}

export interface BriefingTemplateQuestion {
  question: string;
  section: string | null;
}

export interface BriefingTemplateRow {
  id: string;
  conta_id: string;
  user_id: string;
  title: string;
  questions: BriefingTemplateQuestion[];
  is_default: boolean;
  created_at: string;
}
```

`HubBriefingQuestionRow` gains `briefing_id: string`.

New / changed functions:

- **Briefings:** `getBriefings(clienteId)`, `addBriefing(clienteId, contaId, title)`,
  `updateBriefingTitle(id, title)`, `deleteBriefing(id)`.
- **Templates:** `getBriefingTemplates()`, `addBriefingTemplate(t)`,
  `updateBriefingTemplate(id, t)`, `removeBriefingTemplate(id)`,
  `setDefaultBriefingTemplate(id)` — clears `is_default` on the workspace's other templates,
  then sets it on this one.
- **Apply:** `applyTemplateToClient(clienteId, contaId, templateId, titleOverride?)` — creates
  a briefing (title = `titleOverride ?? template.title`) and inserts the template's questions
  (preserving `section` and order) into `hub_briefing_questions` under it. Independent copies.
  Returns the new `BriefingRow`.
- **Question CRUD:** `addHubBriefingQuestion` gains a `briefingId` argument. Existing
  `updateHubBriefingQuestion`, `updateHubBriefingQuestionSection`, `deleteHubBriefingQuestion`
  unchanged. `getHubBriefingQuestions(clienteId)` continues to return all of a client's
  questions (the editor groups them by `briefing_id` client-side).

### Auto-apply on new client (`apps/crm/src/store/clients.ts`)

`addCliente()` gains a post-insert step: after the client row is returned, look up the
workspace's default `briefing_templates` row; if one exists, call
`applyTemplateToClient(newClient.id, conta_id, defaultTemplate.id)`. Wrapped in `try/catch`
so a template failure logs but never blocks client creation. This single hook covers the
new-client modal, CSV import, and lead conversion (all route through `addCliente`).

### CRM UI — `BriefingEditor` in `HubTab.tsx`

Becomes briefing-aware:

- A row of **briefing tabs/pills** (the client's briefings, ordered by `display_order`).
  Selecting one scopes the existing section + question editor to that briefing.
- Header actions:
  - **Novo briefing** — creates a blank titled briefing.
  - **Usar template ▾** — dropdown of the workspace's templates; selecting one calls
    `applyTemplateToClient` (title defaults to the template title, editable), then selects the
    new briefing.
  - **Templates** — opens the new `TemplatesModal`.
  - **Importar CSV** — unchanged behavior, but imports into the **currently selected** briefing.
- Rename / delete the selected briefing inline.
- The current section + question inline-editing UI (add/edit/delete question, add section) is
  reused unchanged, scoped to the selected briefing — this is "edit inline after applying".
- Empty state when a client has no briefings yet (prompt to create one or use a template).

**New `TemplatesModal`** (new component, mirrors
`apps/crm/src/pages/entregas/components/WorkflowModals.tsx` `TemplatesModal`):

- Lists templates: title, question count, default ⭐ toggle, edit, delete.
- Create / edit a template: a `title` field + an editable, ordered list of questions, each
  with an optional `section`. Reuses the same inline question-row UI idiom as the briefing
  editor. (Optional, low-cost: a "Importar CSV" affordance to seed a template's questions,
  reusing `openCSVSelector` — include only if it falls out cleanly.)
- ⭐ toggle calls `setDefaultBriefingTemplate`.

### Hub side (`apps/hub/`)

Edge function `supabase/functions/hub-briefing/`:

- **GET `?token=`** now returns `{ briefings: Array<{ id, title, display_order,
  questions: Array<{ id, question, answer, section, display_order }> }> }`, ordered by
  briefing `display_order` then question `display_order`. Still scoped by the token's
  `cliente_id`.
- **POST** (submit answer) unchanged — keyed by `question_id`, validates the question belongs
  to the token's client.

Hub types (`apps/hub/src/types.ts`): add

```ts
export interface Briefing {
  id: string;
  title: string;
  display_order: number;
  questions: BriefingQuestion[];
}
```

`BriefingQuestion` already carries `section` + `display_order`.

Hub API (`apps/hub/src/api.ts`): `fetchBriefing(token)` return type becomes
`{ briefings: Briefing[] }`.

`BriefingPage.tsx`:
- **Briefing tabs across the top** (one per briefing). Empty state if the client has no
  briefings.
- Inside the selected briefing, group questions by `section` (the existing section-tab/group
  rendering). A briefing with only unsectioned questions shows no redundant section sub-tab bar.
- Debounced auto-save (800ms) per answer is unchanged.

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/<ts>_briefings_table.sql` | New `briefings` table + RLS |
| `supabase/migrations/<ts>_briefing_questions_briefing_id.sql` | Add `briefing_id`, backfill default briefing per client, set NOT NULL |
| `supabase/migrations/<ts>_briefing_templates.sql` | New `briefing_templates` table + RLS + one-default index |
| `apps/crm/src/store/hub.ts` | New types + briefings/templates CRUD + `applyTemplateToClient`; `briefing_id` on question type/insert |
| `apps/crm/src/store/clients.ts` | `addCliente` seeds default template post-insert |
| `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` | `BriefingEditor` becomes briefing-aware (tabs, Novo briefing, Usar template, Templates, scoped CSV import) |
| `apps/crm/src/pages/cliente-detalhe/` (new file) | `TemplatesModal` component |
| `supabase/functions/hub-briefing/handler.ts` | GET returns briefings grouped with their questions |
| `apps/hub/src/types.ts` | Add `Briefing` type |
| `apps/hub/src/api.ts` | `fetchBriefing` returns `{ briefings }` |
| `apps/hub/src/pages/BriefingPage.tsx` | Briefing tabs across the top; sections inside |
| `apps/crm/src/__tests__/store.hub.test.ts` | Briefings CRUD, templates CRUD + single-default, `applyTemplateToClient`, `addCliente` auto-seed |
| `supabase/functions/hub-briefing/handler_test.ts` | `hub-briefing` GET returns grouped briefings (new or extends existing) |

## Testing

- **Vitest (`store.hub.test.ts`):** briefings CRUD; templates CRUD; `setDefaultBriefingTemplate`
  enforces a single default per workspace; `applyTemplateToClient` creates a briefing and copies
  questions (with sections/order) as independent rows; `addCliente` auto-seeds when a default
  template exists and is a no-op when none does.
- **Deno (edge function):** `hub-briefing` GET returns briefings grouped with their questions,
  ordered correctly, scoped to the token's client; answer POST still works by `question_id`.
- **Typecheck:** `npm run build` (tsc + vite) after changes.

## Migration / Rollout Notes

- Migrations are additive and ordered: (1) `briefings` table, (2) `briefing_id` column +
  backfill + NOT NULL, (3) `briefing_templates`. The backfill must run before NOT NULL.
- Edge function `hub-briefing` and the Hub `BriefingPage` change the GET contract together;
  deploy the function and ship the Hub build in the same release.
- `db push` applies all pending migrations — dry-run first, staging before prod.
- Existing clients: their current questions land in one auto-created "Briefing"; no data loss.

## Out of Scope (YAGNI)

- No propagation of template edits to existing briefings.
- No template versioning, categories, or folders.
- No new question *types* — briefing answers remain free-text.
- No drag-to-reorder for briefings (column exists; order is sequential on insert).
- No real-time updates, notifications, or file attachments to answers (unchanged from today).
