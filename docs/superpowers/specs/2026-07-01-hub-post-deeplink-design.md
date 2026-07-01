# Hub Single-Post Deep-Link — Design

**Date:** 2026-07-01
**Branch:** `feat/hub-post-deeplink`
**Status:** Approved (design), revised after spec review, pending implementation plan

## Problem

Today the client Hub link (`/{workspace}/hub/{token}`) only opens whole *pages* (Postagens, Aprovações, etc.). When a manager wants a client to look at (and approve) **one specific post** without being distracted by every other post, there's no way to link straight to it. We want a shareable URL that lands the client on a single, focused post.

## Goal

A shareable deep-link that opens **one post** in the Hub, distraction-free, with the client able to approve / request corrections right there — reusing the existing token-based auth so nothing new is exposed.

Non-goals (YAGNI): standalone tokenless public links, per-post share tokens/table, a dedicated single-post edge function, a chrome-less full-screen mode. Revisit later if needed.

## Key facts (from codebase exploration)

- **Auth:** the Hub has no login; the `:token` in the URL (a `client_hub_tokens.token` uuid) *is* the credential. `HubShell` bootstraps via `hub-bootstrap` and exposes `{ bootstrap, token, workspace }` through `useHub()`. Every hub edge function is `verify_jwt = false`, uses the service-role client, and re-verifies the token + ownership in code. The backend `resolveHubToken` (`supabase/functions/_shared/hub-token.ts:20`) requires **`is_active` AND `expires_at > now`** AND the `feature_hub_portal` entitlement.
- **Posts:** table `workflow_posts`, PK `id bigserial` (a **sequential integer**, not a secret). Scoped via `conta_id` and `workflow_id → workflows(conta_id, cliente_id)`. There is **no** per-post slug/uuid/share token, and none is needed.
- **List fetch:** both `PostagensPage` and `AprovacoesPage` share one cached TanStack query `['hub-posts', token]` → `fetchPosts(token)` (`apps/hub/src/api.ts`) → `hub-posts` edge fn, which returns the client's posts (`HubPostsResponse`). `hub-posts/handler.ts:142` selects **raw** `workflow_posts.status` (no remapping). A focused page can reuse this exact cache and `.find()` the post — **no new backend**.
- **Cards:** `InstagramPostCard`, `TextPostCard`, `StoryPostCard`, `PostCard` (`apps/hub/src/components/`) each take a `HubPost` + `token` + `approvals` and a `readOnly` flag. Approval submits via `submitApproval(token, post.id, action, comentario)` → `hub-approve`; caption/edit suggestions via `useEditSuggestion` → `hub-edit-suggestion`.
- **Statuses (real model, per `apps/crm/src/store/posts.ts:15`):** `rascunho`, `revisao_interna`, `aprovado_interno`, `enviado_cliente`, `aprovado_cliente`, `correcao_cliente`, `agendado`, `postado`, `falha_publicacao`. Client-visible = `VISIBLE_STATUSES` in `PostagensPage.tsx` (`enviado_cliente`, `aprovado_cliente`, `correcao_cliente`, `agendado`, `postado`, `falha_publicacao`). Internal-only = `rascunho`, `revisao_interna`, `aprovado_interno`. **The Hub's `HubPost.status` union (`apps/hub/src/types.ts:33`) is stale** — it lists a non-existent `em_producao` and omits `revisao_interna`/`aprovado_interno`, even though `hub-posts` returns raw DB statuses. Fixed as part of this work (see §6).
- **CRM already builds hub links:** `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` constructs `${origin}/${workspaceSlug}/hub/${token}` from `getWorkspaceSlug()` (nullable) + `getHubToken(clienteId)`. **Gap:** `getHubToken` (`apps/crm/src/store/hub.ts:72`) and the Entregas batch query (`useEntregasData.ts:289`) both select only `is_active` — **neither checks `expires_at`** — so they can yield a link the backend rejects (P1). In Entregas, `useEntregasData.ts:320` already builds a per-card `hubUrl` (guarded on `hubToken && workspaceSlug`); `card.hubUrl` is the reuse point for the calendar path. `ClientePost` (`store/posts.ts:39`) has **no `cliente_id`**, and `CalendarPostDetailPanel` (`.tsx:33`) receives no token/URL — so the link data must be threaded in via props.

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
- **Card selection must mirror the list exactly** (`PostagensPage.tsx:167-169` / `AprovacoesPage`): decide by media **first**, so a media-less post always renders as text even if its `tipo` is `stories`:
  - `post.media.length === 0` → `TextPostCard`
  - else `post.tipo === 'stories'` → `StoryPostCard`
  - else → `InstagramPostCard`
- Render **read/write** (`readOnly={false}`) so approve + "correção" controls are live. Wire `onApprovalSubmitted` → `queryClient.invalidateQueries({ queryKey: ['hub-posts', token] })` (same as Aprovações).
- A small "← Ver todas as postagens" link back to `../postagens`. **No list of other posts.** Renders inside the normal hub shell (sidebar nav stays — the only thing removed is the *other posts*).
- **Four explicit states** (an errored query must NOT be reported as "not available"):
  - **Loading** (`isLoading`) → skeleton (reuse the hub's existing skeleton pattern).
  - **Error** (`isError`) → "Não foi possível carregar esta postagem." + a **retry** button (`refetch`) + link back. Distinct from not-available.
  - **Not available** — query succeeded but the post is missing from the response **or** its status ∉ `VISIBLE_STATUSES` → friendly "Esta postagem não está disponível." + link back. This allow-list guard keeps internal statuses (`rascunho`, `revisao_interna`, `aprovado_interno`) and non-owned ids from ever rendering, and is robust even though the `HubPost.status` type is being corrected separately.
  - **Loaded** → the single card.

### 3. Security

- **No new secret and no new endpoint.** The link only works for a holder of the client's hub token — the same gate as the rest of the Hub.
- Ownership is enforced structurally: the post must appear in *that client's* `hub-posts` response to be found. The additional `VISIBLE_STATUSES` allow-list ensures internal statuses never render even if a manager pastes their id.
- The sequential `workflow_posts.id` is a locator, not a credential — safe **only** because the token gate + membership-in-response + visible-status checks authorize it. We are deliberately **not** adding a single-post fetch endpoint; if one is ever added, it MUST replicate the `cliente_id`/`conta_id` ownership check (mirroring `hub-approve`).

### 4. CRM — "Copiar link da postagem"

**Usable-token rule (P1).** A shareable link must be built only from a **usable** token: `is_active === true` AND `expires_at > now`, AND a non-null workspace slug. Where we surface the copy action:

- Extend the token selects that feed the copy affordance to include `expires_at`, and treat inactive/expired/absent as **"no shareable link"** → the action simply does not render (the button is `null`) for a client with no usable token; regenerating the token in the *Acesso* tab (`HubTab`) restores it. **Delivered scope:** only the share path was tightened — the Entregas batch query (`useEntregasData`) now builds `card.hubUrl` from usable (active + unexpired) tokens only, so every new copy affordance inherits the gate. `HubTab`/`getHubToken` (the token **management** surface) is intentionally left as-is: an expired link there sits next to the reactivate/regenerate controls, so surfacing it is useful rather than a bug. Tightening those management-tab builders is a separate, optional follow-up, not part of this feature.
- Prefer **reusing the already-built base URL** rather than re-deriving it: append `/postagens/${post.id}` to the client's base hub URL.

**Where the action lives / data path (P2):**

- **`WorkflowDrawer`** — per-post row action. The drawer is opened for a single workflow (one client), so the client's base hub URL is available in that scope (via the same `getWorkspaceSlug` + usable-token lookup, or threaded from the card).
- **Calendar detail (`CalendarPostDetailPanel`)** — it currently has **no** token/URL and `ClientePost` has no `cliente_id`, so we must **thread a `hubPostLinkBase` (or full builder) down through `WorkflowCalendarView` → `CalendarPostDetailPanel`** as a new prop, reusing `card.hubUrl` from `useEntregasData:320`. The panel then appends `/postagens/${post.id}`.
  - **Caveat to verify in the plan:** `card.hubUrl` is the *open workflow's* client token. `CalendarPostDetailPanel` exposes `isCurrentWorkflow`, implying it can show posts from other workflows. Confirm the Entregas calendar is scoped to a **single client** (all its workflows share one client → one token). If it can mix clients, resolve the token by the **post's** client instead (via the `hubTokens` `Map<cliente_id, token>` already in `useEntregasData`), which requires surfacing the post's `cliente_id`. Do not ship a link built from the wrong client's token.
- On click: `navigator.clipboard.writeText(link)` + `toast.success('Link copiado!')` (match `HubTab`'s pattern).
- Factor a shared `buildHubPostLink({ origin, workspaceSlug, token, postId })` helper (returns `null` when slug/token missing) so CRM and Hub produce one identical URL shape.

### 5. Hub — share icon on each card

- Add a small share/copy icon to each post card shown in `PostagensPage` and `AprovacoesPage`. Copies the focused-post URL built from `workspace` + `token` (from `useHub()`) + `post.id` via the same `buildHubPostLink` helper, then `navigator.clipboard` + a `sonner` toast.
- **No expiry concern here:** the hub visitor is already authenticated with a valid, unexpired token (they got in), so the token is inherently usable. The P1 usable-token rule applies only to the CRM side.

## 6. Components / files touched

**Hub (`apps/hub/src/`)**
- `router.tsx` — add `postagens/:postId` child route.
- `pages/PostagemFocoPage.tsx` — **new** focused page (4 states, list-mirroring card selection).
- `types.ts` — **fix `HubPost.status`** to the real model: remove `em_producao`, add `revisao_interna`, `aprovado_interno`. First `grep` the hub app for `em_producao` references and update/remove them (must be none-left before changing the union).
- `components/*PostCard.tsx` (or a small shared `SharePostButton`) — add share icon.
- `lib/hubLinks.ts` (new) — `buildHubPostLink()` helper.

**CRM (`apps/crm/src/`)**
- `pages/entregas/components/WorkflowDrawer.tsx` — per-post "Copiar link da postagem".
- `pages/entregas/components/CalendarPostDetailPanel.tsx` — add prop for the base hub link + copy action.
- `pages/entregas/views/WorkflowCalendarView.tsx` — thread the base hub link prop through to the detail panel.
- `store/hub.ts` — extend `getHubToken` select to include `expires_at`; add/derive a usable-token check; reuse `buildHubPostLink`.
- `pages/entregas/hooks/useEntregasData.ts` — batch token query already filters `is_active`; add `expires_at` to make `card.hubUrl` reflect only usable tokens.
- (optional) share the `buildHubPostLink` helper across apps or duplicate the small function.

**Backend:** none.

## Testing

- **Unit:** `buildHubPostLink()` output + `null` when slug/token missing; route-param parsing (`parseInt`/`isNaN`); usable-token predicate (`is_active` + `expires_at`).
- **Hub RTL:** focused page renders the correct card **per the media-first selection** (explicitly cover a **media-less `stories` post → `TextPostCard`**); approve invalidates `['hub-posts', token]`; **error state** shows retry (distinct from not-available); not-available renders for a `revisao_interna`/`aprovado_interno` post and for a missing id.
- **CRM RTL:** copy-link builds the correct URL; action **disabled** when token inactive/expired/absent or slug null; calendar panel builds the link from the correct client's token.
- Run `npm run test` (frontend). No `deno` suite needed (no edge-function changes), but run `npm run build` to typecheck the `HubPost.status` union change.

## Review revisions (2026-07-01)

Applied after spec review; all five findings verified against source and accepted:
- **P1** — usable-token rule (`is_active` + `expires_at > now`) + nullable-slug handling; disabled copy affordance when unusable (§4). Hub side exempt (§5).
- **P2 calendar** — threaded base link through `WorkflowCalendarView` → `CalendarPostDetailPanel` reusing `card.hubUrl`; files added to §6; cross-client caveat noted.
- **P2 statuses** — corrected internal-status names; `HubPost.status` type fix added (§6); allow-list guard confirmed robust.
- **P2 error state** — added explicit Error/retry state, separate from Not-available (§2) + test.
- **P3 card selection** — corrected to media-first (media-less stories → `TextPostCard`) to match the lists (§2) + edge-case test.

## Open questions

None blocking. Naming (`PostagemFocoPage`, `buildHubPostLink`) can be finalized during implementation. The one item to resolve *in the plan* is the calendar client-scoping caveat in §4.
