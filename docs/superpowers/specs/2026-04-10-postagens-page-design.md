# Postagens Page — Design Spec

**Date:** 2026-04-10

## Overview

A new hub page at `/postagens` that gives clients a complete, organized view of all their posts from the moment they are sent for approval onward. Posts are grouped by workflow (campaign), fully expandable, and allow approval actions inline.

---

## Route & Navigation

- Path: `/:workspace/hub/:token/postagens`
- Nav label: **Postagens** with `LayoutList` icon
- Added to `HubNav` desktop top bar and mobile bottom tab bar alongside existing items

---

## Data

### Edge function change (`hub-posts`)

Add `workflow_titulo` to the posts select:

```sql
workflow_posts.select("id, titulo, tipo, status, ordem, conteudo_plain, scheduled_at, workflow_id, workflows(titulo)")
```

Map the joined `workflows.titulo` to a flat `workflow_titulo: string` field on each post row.

### Type change (`HubPost`)

Add `workflow_titulo: string` to the `HubPost` interface in `apps/hub/src/types.ts`.

### Status filter

Show posts with statuses: `enviado_cliente`, `aprovado_cliente`, `correcao_cliente`, `agendado`, `publicado`.

---

## Shared `PostCard` Component

Currently `AprovacoesPage` contains all card + approval logic inline. Extract a shared `PostCard` component at `apps/hub/src/components/PostCard.tsx` that both `AprovacoesPage` and `PostagensPage` use.

**Props:**
```ts
interface PostCardProps {
  post: HubPost;
  approvals: PostApproval[];
  propertyValues: HubPostProperty[];
  workflowSelectOptions: HubSelectOption[];
  onApprovalSubmitted: () => void;
}
```

**Collapsed state:** title, tipo badge, status badge, scheduled_at date.

**Expanded state:** full caption text (`conteudo_plain`), all portal-visible properties (same `PropertyRow` rendering as current `AprovacoesPage`), approval thread (comments), approval action buttons — shown only when `status === 'enviado_cliente'`.

The component manages its own `isExpanded` toggle state internally.

---

## `PostagensPage`

File: `apps/hub/src/pages/PostagensPage.tsx`

- Uses the existing `fetchPosts` query (same `['hub-posts', token]` query key — shared cache with `AprovacoesPage` and `HomePage`).
- Filters posts to the 5 statuses above.
- Groups posts by `workflow_id`, sorted by `workflow_titulo` alphabetically (or insertion order as fallback).
- Within each group, posts sorted by `scheduled_at` ascending (nulls last), then by `ordem`.
- Each group renders as a labeled section (`<h2>workflow_titulo</h2>`) followed by a list of `PostCard` components.
- Empty state: "Nenhuma postagem disponível ainda."

---

## `AprovacoesPage` refactor

Replace its inline card rendering with the new shared `PostCard`. The page itself keeps its existing filter (only `enviado_cliente` posts) and header copy. No behavior change for the client — just code reuse.

---

## Error & Loading States

- Loading: spinner (same pattern as `HomePage`)
- Error: inline message "Erro ao carregar postagens."

---

## Out of Scope

- Pagination (post counts are expected to be manageable per client)
- Filtering/search within the page
- Any CRM-side changes beyond the edge function column addition
