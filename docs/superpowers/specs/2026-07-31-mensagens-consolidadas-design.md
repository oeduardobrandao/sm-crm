# Mensagens consolidadas — Hub + CRM communication feed

## Context

Clients leave feedback on posts in the Hub (approve / request correction / comment), and the agency sees it inside the post drawer in the CRM. But the communication is fragmented and one-eyed:

- The Hub **never renders the thread** — post cards receive the approval history and drop it, so clients never see agency replies (the CRM's "Responder ao cliente…" box writes into the void).
- There is no consolidated view on either side; the agency must open each post's drawer to find feedback.
- No read/unread state exists anywhere (only the CRM bell for per-event notifications).
- A Hub "Mensagens" page already exists as a **client-side mock** behind the `feature_mensagens` plan flag (route, nav, i18n, tests in place; `SEED_MESSAGES` only). The CRM has no messages surface at all.

Goal: a **Mensagens page in each app** showing a single chronological feed of all client↔agency communication, with each post-anchored item linking to its post, plus a general (non-post) channel per client, unread badges on both sides, and agency author identity (name + avatar).

Decisions made with the user (brainstorming):
- Scope: post-anchored feed **+ general channel** per client (not full chat).
- Layout: **single chronological feed** with post chips, inline reply — not a two-pane thread inbox.
- Feed content: plain messages, approval/correction comments, **commentless approval events**, and **edit suggestions** (as link-out cards).
- Read state: unread nav badges on **both** sides; opening the page marks seen.
- Identity: agency replies show **member name + avatar** (old rows fall back to "Equipe").
- Gating: keep `feature_mensagens`, **ship dark**.
- Architecture: **federated feed** — existing tables stay source of truth; one union RPC serves both apps. (Rejected: unified mirror table with backfill + triggers; nullable `post_id` on `post_approvals`.)

## Existing infrastructure to reuse (do not rebuild)

- `post_approvals` table (`action ∈ aprovado|correcao|mensagem`, `is_workspace_user`, `comentario`) — both write paths live: Hub → `hub-approve` edge fn; CRM → `replyToPostApproval()` in `apps/crm/src/store/posts.ts:746`.
- `post_edit_suggestions` + accept/reject workflow in the CRM WorkflowDrawer.
- `resolveHubToken()` in `supabase/functions/_shared/hub-token.ts` (token → `{cliente_id, conta_id}` + `feature_hub_portal` check).
- Hub feature flag plumbing: `plans.feature_mensagens` (migration `20260721000001`), resolved fail-closed in `hub-bootstrap/handler.ts:85`, listed in `_shared/entitlements.ts`.
- Hub page scaffolding: `apps/hub/src/pages/MensagensPage.tsx` (replace mock), route in `router.tsx:59`, nav item in `shell/navItems.ts:30`, tests, i18n `nav.mensagens`.
- Hub deep link: `buildHubPostLink()` in `apps/hub/src/lib/hubLinks.ts` → `/postagens/:postId` (guard with `isClientVisible(post.status)`).
- CRM deep link: `/entregas?drawer=<workflow_id>` (used by existing notifications).
- CRM notifications: `insert_notification_batch` / `resolve_notification_targets` RPCs, `notifications` table CHECK constraint, `apps/crm/src/lib/notification-config.ts`, bell UI.
- Testable-handler edge fn pattern: `supabase/functions/hub-ideias/` (`index.ts` thin, `handler.ts` DI, Deno tests in `supabase/functions/__tests__/`).
- CRM page pattern: `apps/crm/src/pages/tarefas/` (page + logic file + `hooks/useXData` + components + `__tests__`); data access in `apps/crm/src/store/*.ts` only.

## Design

### 1. Schema (one migration file; main's tail is `20260731000002`, so start at `20260731000003` and re-verify the prefix is still above `origin/main`'s tail at PR-open time)

**`mensagens`** (general channel only):
`id bigserial PK, conta_id uuid NOT NULL → workspaces, cliente_id bigint NOT NULL → clientes ON DELETE CASCADE, content text NOT NULL, is_workspace_user boolean NOT NULL DEFAULT false, author_user_id uuid NULL → auth.users, created_at timestamptz DEFAULT now()`.
Index `(conta_id, cliente_id, created_at)`. RLS: workspace members ALL via `conta_id IN get_my_conta_id()` + service_role bypass (hub writes come through the edge fn with ownership check).

**`post_approvals` + `author_user_id uuid NULL`** — populated by new agency replies; nothing else changes.

**`mensagens_last_seen`**:
`conta_id uuid NOT NULL, cliente_id bigint NOT NULL, user_id uuid NULL, last_seen_at timestamptz NOT NULL`.
`user_id NULL` = the client side (one reader per cliente); non-null = a CRM user. Uniqueness via two partial unique indexes (`WHERE user_id IS NULL` / `IS NOT NULL`). RLS scoped by `conta_id` for CRM upserts; hub side written by edge fn.

**RPC `get_mensagens_feed(p_cliente_id bigint DEFAULT NULL, p_before timestamptz DEFAULT NULL, p_limit int DEFAULT 50)`**
UNION ALL over:
- `post_approvals` (all actions) joined `workflow_posts` (title, workflow_id, status) — includes commentless aprovado/correcao as event rows
- `post_edit_suggestions` (status + created_at; content = short label)
- `mensagens`
Joined with author profile (name, foto) for `author_user_id`, and `clientes` (nome, foto) for client identity. Returns unified rows: `source, id, cliente_id, cliente_nome, post_id, workflow_id, post_titulo, action, content, is_workspace_user, author_user_id, author_name, author_foto, created_at`. Ordered `created_at DESC`, cursor = `p_before`. Auth: `SECURITY DEFINER`; when caller is an authenticated CRM user, scope to `get_my_conta_id()`; service role (hub fn) passes explicit conta/cliente. NOTE: read client name/foto via the granted columns / `clientes_v` (column-grant allowlist gotcha).

**RPC `get_mensagens_unread(p_side, p_cliente_id DEFAULT NULL)`** — count of items authored by the *other* side newer than the caller's `last_seen_at` (CRM: across all clients + per-client breakdown for filter chips; Hub: single count).

**Notification type**: add `client_message` to the `notifications` type CHECK; general client messages call `insert_notification_batch` targeting owners/admins with link `/mensagens`.

### 2. Hub

**New edge fn `supabase/functions/hub-mensagens/`** (testable-handler pattern, service role, deploy `--no-verify-jwt`):
- `GET ?token=…&before=…` → `resolveHubToken` → feed page via `get_mensagens_feed` + unread count.
- `POST {token, content}` → insert general `mensagens` row (`is_workspace_user=false`) + fire `client_message` notification.
- `POST /seen {token}` → upsert `mensagens_last_seen` (user_id NULL).
Post-anchored replies from the feed reuse **existing `hub-approve`** with `action='mensagem'` — no new path.

**`MensagensPage.tsx`**: replace mock with react-query feed (`['hub-mensagens', token]`, `fetchNextPage` on scroll). Rendering:
- client bubbles right; agency bubbles left with author name/avatar (fallback "Equipe");
- post items carry a chip (post title) → `buildHubPostLink` (only when `isClientVisible`);
- commentless approvals = compact event rows ("Post aprovado"); edit suggestions = "Sugestão de edição enviada" cards;
- inline reply on post items → `submitApproval(token, post_id, 'mensagem', text)`;
- bottom composer → general channel POST;
- on mount → `POST /seen`, invalidate count.
API wrappers in `apps/hub/src/api.ts` following existing helpers (token in query for GET, body for POST).

**Nav badge**: generalize the hardcoded `path === '/aprovacoes'` badge ternary in `HubSidebar.tsx` / `HubMobileNav.tsx` into a badge resolver in `navItems.ts`; Mensagens badge = unread count (new hook, query `['hub-mensagens-count', token]`, ~60s poll). Update `navItems` tests for the new signature.

### 3. CRM

**New page `/mensagens`** — `apps/crm/src/pages/mensagens/` (follow tarefas structure):
- `MensagensPage.tsx` (default export), `mensagensLogic.ts`, `hooks/useMensagensData.ts`, `components/` (FeedItem, ClientFilterChips, TypeFilter, Composer), `__tests__/`.
- Feed across all clients; client filter chips (with per-client unread), type filter (mensagens / aprovações / sugestões).
- Post items link `/entregas?drawer=<workflow_id>`; suggestion items link there too (accept/reject stays in the drawer).
- Inline reply on post items → existing `replyToPostApproval` (extend to write `author_user_id = auth.uid()`).
- General composer enabled only when filtered to one client → `store/mensagens.ts: sendMensagem(clienteId, content)` (direct insert, `is_workspace_user=true`, `author_user_id`).
- Opening page / selecting client filter upserts `mensagens_last_seen`.

**`store/mensagens.ts`**: `getMensagensFeed` (rpc), `getMensagensUnread` (rpc), `sendMensagem`, `markMensagensSeen`. Re-export from `store/index.ts`.

**Routing/nav (4 spots + i18n; `vercel-routing.test.ts` guards):**
1. `App.tsx`: lazy import + `<Route path="/mensagens">` in protected block.
2. `nav-data.ts`: NavItem (Phosphor icon, e.g. `ph-chat-circle`) + `NAV_FEATURE: mensagens → 'feature_mensagens'`; wire CRM-side flag resolution the same way existing NAV_FEATURE flags are resolved.
3. `site-meta.ts`: add `'mensagens'` to `APP_ROUTE_PREFIXES`.
4. `vercel.json`: add `mensagens` to **both** alternation regexes (noindex header + `/app.html` rewrite).
5. i18n: `nav.mensagens` already exists in pt/en (verify).

**Nav unread badge (new CRM pattern)**: small count pill in `Sidebar.tsx` / `MobileNav.tsx` (distinct from static "Em breve" `nav-badge`), driven by `get_mensagens_unread` polled ~60s via a hook.

**Bell**: add `client_message` entry to `notification-config.ts` (icon `MessageCircle`, link `/mensagens`). Existing `post_message` notifications unchanged.

### 4. Out of scope (explicit)

- Rendering threads inline on Hub Aprovações post cards (Mensagens page is the thread surface).
- Realtime (polling only, consistent with the app).
- Threading/replies-to-replies, attachments in messages, editing/deleting messages.
- Flipping `feature_mensagens` on any plan (separate pricing decision).

## Verification

1. `npm run test` (Vitest: nav badge resolver, feed logic, routing guard test) and `npm run test:functions` (Deno: hub-mensagens handler — token 404, cross-client 403, general send, seen upsert, feed pagination).
2. All four typechecks (`tsc -p apps/crm|hub|admin/tsconfig.json`, `tsconfig.scripts.json`), `npm run lint`, `npm run format:check`.
3. Browser (staging, `npm run dev:staging` + `npm run dev:hub:staging` on an ALLOWED_ORIGINS port — hub needs 5174 per memory):
   - Enable `feature_mensagens` on the test workspace's plan (staging SQL).
   - Hub: send correction comment on a post → CRM `/mensagens` shows it with post chip; reply from CRM feed → appears in Hub Mensagens with member name/avatar; general message both directions; unread badges appear and clear on open; post chip deep-links both sides.
   - Verify old approval history renders in both feeds without backfill.
4. Migration: verify version prefix is above `origin/main` tail at PR-open time (`git ls-tree origin/main:supabase/migrations | tail`).
