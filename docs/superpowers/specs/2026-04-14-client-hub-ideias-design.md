# Client Hub — Ideias Page Design

**Date:** 2026-04-14
**Status:** Draft

## Overview

A new page in the client hub where clients submit ideas for content/campaigns and agency users react, triage, and respond. Ideas are structured entries (title + description + optional reference links), not free-form notes. Agency surfaces them both inside the client detail page and in a new top-level "Ideias" page that lists ideas across all clients.

## Goals

- Give clients a low-friction channel to capture ideas between sync meetings.
- Give agency users a clear surface to acknowledge, triage, and respond to ideas.
- Preserve an auditable history of ideas once engagement has started.

## Non-Goals

- Threaded comments / chat.
- Converting ideas directly into scheduled posts (v1 leaves this manual).
- Image/file attachments on ideas (links only for v1).
- Client-side notifications beyond what the hub already offers.

## Data Model

### Table `ideias`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | fk → workspaces | required, for RLS scoping |
| `cliente_id` | fk → clientes | required |
| `titulo` | text not null | required |
| `descricao` | text not null | required |
| `links` | text[] default `{}` | optional reference URLs |
| `status` | text not null default `'nova'` | enum: `nova` \| `em_analise` \| `aprovada` \| `descartada` |
| `comentario_agencia` | text | nullable — single agency response |
| `comentario_autor_id` | fk → membros | nullable |
| `comentario_at` | timestamptz | nullable |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | trigger-maintained |

Check constraint enforces the four valid status values.

### Table `ideia_reactions`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `ideia_id` | fk → ideias on delete cascade |
| `membro_id` | fk → membros |
| `emoji` | text |
| `created_at` | timestamptz default now() |

Unique constraint on `(ideia_id, membro_id, emoji)` — a user can toggle a given emoji on/off, not duplicate it. Allowed emoji set defined as a frontend constant: 👍 ❤️ 🔥 💡 🎯.

### Client-side mutability rule

Hub clients may `UPDATE` or `DELETE` an idea **only** when all of:
- `status = 'nova'`
- `comentario_agencia IS NULL`
- No rows exist in `ideia_reactions` for that `ideia_id`

Enforced server-side in the edge function (primary gate) and mirrored in the hub UI to hide edit/delete buttons when locked.

## Client Hub — `IdeiasPage`

**Route:** `/:workspace/hub/:token/ideias`.

Add a new card to `apps/hub/src/pages/HomePage.tsx`'s `SECTIONS` array:
```
{ label: 'Ideias', icon: Lightbulb, path: '/ideias', description: 'Compartilhe ideias com sua agência' }
```

### Layout

- **Hero:** "Ideias" title and subtitle ("Compartilhe ideias com sua agência").
- **Primary action:** "Nova ideia" button that opens a modal/drawer with:
  - `titulo` — single-line input, required
  - `descricao` — textarea, required
  - `links` — repeatable text input list, each URL validated/sanitized
- **Ideas list:** Cards, newest first. Each card shows:
  - Title, description, link list (each href passed through existing `sanitizeUrl()` helper from the router).
  - Status badge (Nova / Em análise / Aprovada / Descartada) with distinct color treatment.
  - Emoji reaction row — read-only for clients, displays each emoji with count and total reactors.
  - Agency comment block, if present: author name, relative timestamp, text.
  - Edit / Delete buttons — rendered only when the client-side mutability rule is satisfied.
- **Empty state:** headline + CTA encouraging the client to add their first idea.

### Data layer

New functions in `apps/hub/src/api.ts`:
- `fetchIdeias(token)` → `GET /hub-ideias`
- `createIdeia(token, payload)` → `POST /hub-ideias`
- `updateIdeia(token, id, payload)` → `PATCH /hub-ideias/:id`
- `deleteIdeia(token, id)` → `DELETE /hub-ideias/:id`

All hit a new edge function `hub-ideias` authenticated by hub token, following the existing hub-* endpoint pattern.

State managed via TanStack Query (same as `fetchPosts` on the hub HomePage), with optimistic invalidation on mutations.

## CRM — Client Detail Tab

**Location:** new tab "Ideias" inside `apps/crm/src/pages/cliente-detalhe/` alongside existing tabs.

### Layout

- Filter bar: status multi-select.
- List of that client's ideas, newest first. Each row/card shows: title, description, links, created date, status badge, existing reactions summary, existing agency comment preview.
- Clicking a row opens the **Idea Detail Drawer** (shared component, see below).

### Idea Detail Drawer

Shared component used by both the client detail tab and the top-level Ideias page.

Sections:
- **Header:** title, client name, created date, status badge.
- **Body:** description, link list.
- **Status dropdown:** agency picks between `nova` / `em_analise` / `aprovada` / `descartada`. Saves on change.
- **Reaction bar:** 5 fixed emoji buttons (👍 ❤️ 🔥 💡 🎯). Tapping toggles the current user's reaction. Hover shows reactor names.
- **Agency comment:** single textarea bound to `comentario_agencia`. Save button overwrites the field and stamps `comentario_autor_id` + `comentario_at`. Editable afterward; shows last-edited timestamp.

## CRM — Top-Level "Ideias" Page

**Route:** `/ideias`, added to main CRM nav.

### Layout

- Filter bar: client searchable select, status multi-select, date range.
- Table of ideas across all clients in the workspace. Columns: client, title, status, reaction count, has-comment indicator, created_at.
- Row click → opens the same Idea Detail Drawer used in the client detail tab.

## Backend

### Edge function `hub-ideias`

Path: `supabase/functions/hub-ideias/index.ts`.

- Authenticates via hub token, reusing the existing hub token verification helper used by other `hub-*` functions.
- Resolves `cliente_id` + `workspace_id` from the token; all queries scope to that client.
- Endpoints:
  - `GET /hub-ideias` — list ideas for the token's client, including their reactions and agency comment fields.
  - `POST /hub-ideias` — create a new idea. Validates non-empty `titulo` and `descricao`. Ignores any status sent from the client (always `nova`).
  - `PATCH /hub-ideias/:id` — update `titulo`/`descricao`/`links`. Server re-checks the mutability rule (status = `nova`, no comment, no reactions). Returns 409 if locked.
  - `DELETE /hub-ideias/:id` — same mutability rule. Returns 409 if locked.
- Deploy with `--no-verify-jwt` (required for hub-token auth, matching project convention).

### CRM backend access

CRM queries and mutations (status changes, comments, reactions) go directly through the Supabase client using the authenticated agency session + RLS — same pattern as other CRM tables. No new edge function needed for the agency side.

### RLS policies

`ideias`:
- Agency members can `SELECT`, `INSERT`, `UPDATE` rows where `workspace_id` matches their membership.
- `DELETE` allowed for agency roles (owner/admin/agent) within workspace.
- Hub-token access bypasses RLS via service role inside the `hub-ideias` edge function, which applies its own scoping.

`ideia_reactions`:
- Agency members can `SELECT`/`INSERT`/`DELETE` within their workspace (joined via `ideias.workspace_id`).
- Hub clients do not access this table directly; they read reactions through the `hub-ideias` edge function which inlines them into the idea response.

## Error Handling & Edge Cases

- Empty `titulo` or `descricao` on create/update: hub form validation blocks submission; edge function returns 400 as a second gate.
- Locked-idea edit/delete attempt: edge function returns 409; hub shows toast "Esta ideia não pode mais ser editada".
- Link sanitization: all URLs rendered via existing `sanitizeUrl()` helper before being placed in `href`. User-supplied text rendered via React (no `innerHTML`).
- Reaction race (two users tapping same emoji): unique constraint prevents duplicates; UI treats conflict as a no-op.
- Status change by agency while client has a stale view: next refetch surfaces the new status; no locking needed.

## Testing

- **Edge function (`hub-ideias`):** unit tests for token auth failure, validation failures, the mutability rule (all three lock conditions), and happy-path CRUD.
- **CRM components:** tests for status dropdown change, emoji reaction toggle (add + remove), comment save, and drawer data binding.
- **Hub components:** tests for create flow, edit/delete visibility gated on status/comment/reactions, and form validation.

## Open Questions

None — all scope decisions confirmed during brainstorming.
