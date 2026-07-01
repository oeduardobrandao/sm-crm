# Hub Single-Post Deep-Link — Design

**Date:** 2026-07-01
**Branch:** `feat/hub-post-deeplink`
**Status:** Approved (design), pending implementation plan

## Problem

Today the client Hub link (`/{workspace}/hub/{token}`) only opens whole *pages* (Postagens, Aprovações, etc.). When a manager wants a client to look at (and approve) **one specific post** without being distracted by every other post, there's no way to link straight to it. We want a shareable URL that lands the client on a single, focused post.

## Goal

A shareable deep-link that opens **one post** in the Hub, distraction-free, with the client able to approve / request corrections right there — reusing the existing token-based auth so nothing new is exposed.

Non-goals (YAGNI): standalone tokenless public links, per-post share tokens/table, a dedicated single-post edge function, a chrome-less full-screen mode. Revisit later if needed.

## Key facts (from codebase exploration)

- **Auth:** the Hub has no login; the `:token` in the URL (a `client_hub_tokens.token` uuid) *is* the credential. `HubShell` bootstraps via `hub-bootstrap` and exposes `{ bootstrap, token, workspace }` through `useHub()`. Every hub edge function is `verify_jwt = false`, uses the service-role client, and re-verifies the token + ownership in code.
- **Posts:** table `workflow_posts`, PK `id bigserial` (a **sequential integer**, not a secret). Scoped via `conta_id` and `workflow_id → workflows(conta_id, cliente_id)`. There is **no** per-post slug/uuid/share token, and none is needed.
- **List fetch:** both `PostagensPage` and `AprovacoesPage` share one cached TanStack query `['hub-posts', token]` → `fetchPosts(token)` (`apps/hub/src/api.ts`) → `hub-posts` edge fn, which returns the client's posts (`HubPostsResponse`). A focused page can reuse this exact cache and `.find()` the post — **no new backend**.
- **Cards:** `InstagramPostCard`, `TextPostCard`, `StoryPostCard`, `PostCard` (`apps/hub/src/components/`) each take a `HubPost` + `token` + `approvals` and a `readOnly` flag. Approval submits via `submitApproval(token, post.id, action, comentario)` → `hub-approve`; caption/edit suggestions via `useEditSuggestion` → `hub-edit-suggestion`.
- **Client-visible statuses:** `VISIBLE_STATUSES` in `apps/hub/src/pages/PostagensPage.tsx` = `enviado_cliente`, `aprovado_cliente`, `correcao_cliente`, `agendado`, `postado`, `falha_publicacao`. Internal-only: `rascunho`, `em_producao` (full set in `apps/hub/src/types.ts`).
- **CRM already builds hub links:** `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` constructs `${origin}/${workspaceSlug}/hub/${token}` from `getWorkspaceSlug()` + `getHubToken(clienteId)` (`apps/crm/src/store/hub.ts`, table `client_hub_tokens`). Managers view individual posts in Entregas (`CalendarPostDetailPanel`, `WorkflowDrawer`, `PublicacoesPanel`), where `workspaceSlug` (via `useEntregasData`) and the post's client are in context.

## Design

### 1. Route (Hub)

Add one child route mirroring the existing `paginas/:pageId` drill-in, in `apps/hub/src/router.tsx`:

```tsx
{ path: 'postagens/:postId', element: <PostagemFocoPage /> },
```

- Full link: `/{workspace}/hub/{token}/postagens/{postId}`
- Inherits token/workspace auth and shell chrome via `HubShell`'s `<Outlet />` + `useHub()`; **not** a `NAV_ITEMS` entry (it's a drill-in).
- Parse the param with `parseInt(postId, 10)` + `isNaN` guard (project convention); an unparseable id → the not-available state below.

### 2. Focused page (`PostagemFocoPage`, new)

- Reuse the shared query `['hub-posts', token]` via `fetchPosts(token)`, then `const post = data.posts.find(p => p.id === postId)`. Reuse `postApprovals`, `propertyValues`, `workflowSelectOptions`, `instagramProfile` from the same response.
- Pick the card by type/media (same logic the list uses): stories → `StoryPostCard`; media present → `InstagramPostCard`; otherwise `TextPostCard`. Render **read/write** (`readOnly={false}`) so approve + "correção" controls are live.
- Wire `onApprovalSubmitted` → `queryClient.invalidateQueries({ queryKey: ['hub-posts', token] })` (same as Aprovações).
- A small "← Ver todas as postagens" link back to `../postagens`. **No list of other posts.** Renders inside the normal hub shell (sidebar nav stays — the only thing removed is the *other posts*).
- States:
  - **Loading** → skeleton (reuse the hub's existing skeleton pattern).
  - **Not available** → post missing from the response **or** its status is not in `VISIBLE_STATUSES` → friendly "Esta postagem não está disponível." message + link back to Postagens. This is the guard that keeps internal drafts (`rascunho`, `em_producao`) and non-owned ids from ever rendering.
  - **Loaded** → the single card.

### 3. Security

- **No new secret and no new endpoint.** The link only works for a holder of the client's hub token — the same gate as the rest of the Hub.
- Ownership is enforced structurally: the post must appear in *that client's* `hub-posts` response to be found. The additional `VISIBLE_STATUSES` gate ensures internal statuses never render even if a manager pastes their id.
- The sequential `workflow_posts.id` is a locator, not a credential — safe **only** because the token gate + membership-in-response + visible-status checks authorize it. We are deliberately **not** adding a single-post fetch endpoint; if one is ever added, it MUST replicate the `cliente_id`/`conta_id` ownership check (mirroring `hub-approve`).

### 4. CRM — "Copiar link da postagem"

- Add a copy-link action where managers already see individual posts in Entregas: `CalendarPostDetailPanel` (single-post detail) and each post row in `WorkflowDrawer`.
- Build the URL from existing store functions: `${origin}/${getWorkspaceSlug()}/hub/${getHubToken(cliente_id).token}/postagens/${post.id}`. Factor a small `buildHubPostLink({ origin, workspaceSlug, token, postId })` helper so CRM and Hub share one URL shape.
- **Enabled only for client-visible statuses** (so a manager can't share a link that shows "não disponível"). If the client has no active hub token, disable the action with a hint to generate one in the client's *Acesso* tab (`HubTab`).
- On click: `navigator.clipboard.writeText(link)` + `toast.success('Link copiado!')` (match `HubTab`'s existing pattern).

### 5. Hub — share icon on each card

- Add a small share/copy icon to each post card shown in `PostagensPage` and `AprovacoesPage`. Copies the focused-post URL built from the `workspace` + `token` (from `useHub()`) + `post.id`, via `navigator.clipboard` + a `sonner` toast.
- Uses the same `buildHubPostLink` helper as the CRM.

## Components / files touched

**Hub (`apps/hub/src/`)**
- `router.tsx` — add `postagens/:postId` child route.
- `pages/PostagemFocoPage.tsx` — **new** focused page.
- `components/*PostCard.tsx` — add optional share icon (or a small shared `SharePostButton`).
- a small `lib/hubLinks.ts` (or similar) — `buildHubPostLink()` helper.

**CRM (`apps/crm/src/`)**
- `pages/entregas/components/CalendarPostDetailPanel.tsx` — add "Copiar link da postagem".
- `pages/entregas/components/WorkflowDrawer.tsx` — per-post copy-link action.
- reuse `store/hub.ts` (`getWorkspaceSlug`, `getHubToken`); reuse the same `buildHubPostLink()` helper (shared util or duplicated small function).

**Backend:** none.

## Testing

- **Unit:** `buildHubPostLink()` output; route-param parsing (`parseInt`/`isNaN`); not-available guard (missing id + internal status).
- **Hub RTL:** focused page renders the correct card for each post type; approve invalidates `['hub-posts', token]`; not-available renders the friendly message and back link.
- **CRM RTL:** copy-link builds the correct URL; action disabled when no active token or non-visible status.
- Run `npm run test` (frontend) — no `deno` suite needed (no edge-function changes).

## Open questions

None blocking. Naming (`PostagemFocoPage`, `buildHubPostLink`) can be finalized during implementation.
