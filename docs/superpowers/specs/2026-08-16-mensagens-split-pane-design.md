# Mensagens split-pane layout

**Date:** 2026-08-16
**Scope:** `apps/crm/src/pages/mensagens/` + one route addition in `apps/crm/src/App.tsx`
**Status:** design approved, awaiting implementation plan

## Problem

The CRM Mensagens page (`/mensagens`) is single-pane: the conversation list and
an open thread occupy the same slot, toggled by local `selecionado` state. Opening
a thread hides the list; going back re-renders it. On the wide desktop viewports
the CRM is used on, this wastes horizontal space and forces a list → thread →
back → list round-trip for every conversation. Refreshing the page always drops
the user back to the list, and there is no way to link a teammate to a
specific client's thread.

## Goal

A WhatsApp-style inbox: the conversation list stays visible on the left (fixed
~340px, with avatar / name / timestamp / preview / unread badge exactly as today)
while the selected thread renders in a larger pane on the right. The selected
conversation is reflected in the URL so refresh, back-button and shared links
keep their place. Below a mobile breakpoint the page falls back to the current
single-pane behaviour, driven by the same URL.

## Decisions (agreed with the user)

| Question | Decision |
|---|---|
| Deep-linking | Yes: `/mensagens/:clienteId`. |
| Nothing selected on desktop | WhatsApp-style placeholder in the right pane. No auto-open of the most recent thread. |
| Breakpoint for single-pane fallback | Below **768px** (Tailwind `md`). |
| List pane width | Fixed **340px**. |
| Page height | Full-bleed: the split shell fills the whole content area via the existing `.page-full-bleed` contract; list and thread scroll independently. No page-level scroll. Page title lives inside the list pane. |
| Search + sort placement | Scoped to the **list column** (inside the list pane's header), not a full-width toolbar above both panes. |
| Routing shape | Two sibling routes rendering the same page component (not a nested `<Outlet>` layout). |

## Architecture

### Routing

`App.tsx` gains one route next to the existing one:

```tsx
<Route path="/mensagens" element={<MensagensPage />} />
<Route path="/mensagens/:clienteId" element={<MensagensPage />} />
```

`MensagensPage` reads `clienteId` via `useParams()`, parsed with
`parseInt(param, 10)` + `isNaN` guard (repo convention). Selecting a row calls
`navigate('/mensagens/<id>')`; the mobile back button calls
`navigate('/mensagens')`. The `selecionado` state is removed entirely.

No `vercel.json` change is needed: the CRM route pattern is
`/(…|mensagens|…)(/.*)?`, so `/mensagens/14` already rewrites to `app.html` in
production. `APP_ROUTE_PREFIXES` in `apps/crm/src/content/site-meta.ts` is
prefix-based and likewise already covers the sub-path.

### Components

New files under `apps/crm/src/pages/mensagens/`:

- **`components/ConversationList.tsx`**: search input, sort toggle, and the
  scrolling list of rows. Row markup and `conversaPreview()` usage are moved
  from today's page as-is, plus a new selected-row highlight
  (`isActive = c.cliente_id === clienteId`: amber left bar + tinted background,
  reusing `--primary-color`).
- **`components/ConversationThread.tsx`**: thread header (avatar, client
  name, tipo-filter pills, mobile-only back button), the scrolling bubble list,
  and the composer with the reply-to banner. Today's thread JSX moved with
  minimal change. **Owns all thread-scoped state**: `tipo`, `draft`, `replyTo`,
  and the `scrollPending` ref. It is rendered with `key={clienteId}` so every
  change of conversation (row click, deep link, browser back/forward) remounts
  it and that state resets. This replaces today's `abrirConversa()` reset and
  closes the hole where a `replyTo` chosen in client A could survive into
  client B's thread and send the reply to A's post.
- Breakpoint detection reuses the existing **`hooks/useIsDesktop.ts`**
  (`useIsDesktop()` defaults to `min-width: 768px`, already used by Clientes,
  Equipe and EntregasFilters). No new hook.

`MensagensPage.tsx` becomes a thin shell:

1. Resolves `clienteId` from the route.
2. Calls `useMensagensData(clienteId)` **once** and passes results down as
   props (avoids double-invoking the hook from two panes).
3. `const isSplit = useIsDesktop()`.
4. Renders the shell:
   - `isSplit`: list pane + (thread pane if `clienteId != null`, else the
     placeholder) side by side.
   - `!isSplit`: only the list when `clienteId == null`, only the thread when
     it is set (today's behaviour, URL-driven).

### Layout

- **The page uses the existing `.page-full-bleed` contract** in
  `apps/crm/style.css` (the same one `ArquivosPage` uses for its tree + content
  split). The page root is `<div className="page-full-bleed flex min-h-0">`.
  `.main-content:has(> .page-full-bleed)` switches the shell to a column flex
  with zero padding and `overflow: hidden`, and `.page-full-bleed` takes
  `flex: 1 1 0; min-height: 0`, so the page fills exactly the space left below
  in-flow shell elements (the context-help bar, the top bar when present). No
  viewport `calc()`; that would clip the bottom strip whenever the context-help
  bar renders, and would wrongly subtract `--topbar-height` on mobile where the
  top bar is hidden.
- **Page title placement changes from the mockup**: because full-bleed removes
  the content padding, the "Mensagens" `<h1>` (with its info tooltip) moves
  **inside the list pane's header, above the search box**, WhatsApp "Chats"
  style and matching how Arquivos puts its title inside the tree aside. On
  desktop the thread pane already has its own client header, so a page-wide
  title above both panes would be redundant. On mobile the list view shows the
  same header; the thread view shows the back arrow + client name.
- Shell: the page root itself is the `flex` row; no additional card wrapper.
  Panes are separated by a `border-r`.
- List pane: `w-[340px] shrink-0 border-r flex flex-col`; its rows container is
  `flex-1 overflow-y-auto`.
- Thread pane: `flex-1 min-w-0 flex flex-col`; its bubble container is
  `flex-1 overflow-y-auto` (replaces today's `maxHeight: 60vh`).
- Placeholder (desktop, no selection): centered `MessageCircle` icon +
  "Selecione uma conversa" in `--text-muted`.
- The message-preview `max-w-[calc(100%-130px)]` cap added earlier this session
  is dropped; the row is now a fixed 340px wide so plain `min-w-0 truncate`
  suffices and the timestamp column stays aligned.

### Data flow

`useMensagensData` is unchanged in shape. One addition: the `feed` infinite
query gets `enabled: clienteId != null` so the desktop "nothing selected"
placeholder does not fire a combined-feed fetch that nothing renders (today it
does, harmlessly, but that idle state is now one the user can sit in).
`markMensagensSeen()` still fires once on mount regardless of route.

`conversas` and `clientes` are fetched independently of `clienteId`, so
switching threads never refetches the list.

**Scroll-to-bottom.** `ConversationThread` initialises `scrollPending` to
`true`, so every mount (row click, initial deep link at `/mensagens/14`,
browser back/forward) snaps the thread to the newest message once the first
feed page settles. Sending a message sets it again. "Carregar mensagens
anteriores" never sets it, so loading older pages preserves scroll position, as
today.

### Edge cases

- **Thread pane state precedence** for a given `clienteId`, evaluated in
  order:
  1. Route param is not a valid integer (`parseInt` NaN): "Conversa não
     encontrada" + link to `/mensagens`, immediately, no query wait.
  2. `conversas.isLoading`: normal loading state.
  3. `conversas.isError`: "Não foi possível carregar as conversas." with a
     "Tentar novamente" button that calls `conversas.refetch()`. A failed list
     query must never be mistaken for a missing conversation.
  4. `conversas` resolved and the id is absent from it: "Conversa não
     encontrada" + link to `/mensagens`.
  5. Otherwise: the thread.
  The list pane shows its own loading/error/empty copy independently, as
  today.
- **Search does not affect the open thread**: filtering the list only
  hides/shows rows. An open thread stays open even if its row is filtered out.
- **Selecting a row on mobile** navigates to the thread route; the sidebar
  drawer behaviour is unaffected because the page never touches it.
- **Sort toggle** keeps its current semantics (recentes ↔ antigas), now inside
  the list header.

### Out of scope

- Keyboard navigation between conversations (↑/↓).
- Resizable list pane.
- Auto-selecting the most recent thread on load (explicitly declined).
- Any Hub-side (`apps/hub`) change: the client portal keeps its single-thread
  page.
- Backend / RPC changes: `get_mensagens_conversas` and `get_mensagens_feed`
  already provide everything needed.

## Testing

`apps/crm/src/pages/mensagens/__tests__/MensagensPage.test.tsx` is rewritten to
render through real routes:

```tsx
<MemoryRouter initialEntries={[initialPath]}>
  <Routes>
    <Route path="/mensagens" element={<MensagensPage />} />
    <Route path="/mensagens/:clienteId" element={<MensagensPage />} />
  </Routes>
</MemoryRouter>
```

with a `PathProbe` (as `Sidebar.test.tsx` does) to assert URL changes.

Existing cases carry over with the "open a thread" helper now asserting the
URL becomes `/mensagens/14` and the back button (mobile mode) returns to
`/mensagens`. New cases:

The global `test/vitest.setup.ts` `matchMedia` stub always reports
`matches: false`, so **the default test branch is mobile**. Desktop cases stub
`matchMedia` to return `matches: true` for `(min-width: 768px)` (same
`vi.stubGlobal` pattern as `AppLayout.test.tsx`).

- Desktop: list and thread render **simultaneously**; the selected row carries
  the active class; the placeholder shows when there is no `clienteId`.
- Mobile (default stub): only one pane renders at a time, back button
  navigates to `/mensagens`.
- `/mensagens/999` (unknown id): "Conversa não encontrada" + link back.
- `/mensagens/abc` (non-numeric): same not-found state, and `getMensagensFeed`
  is never called.
- `conversas` rejects while at `/mensagens/14`: the error + "Tentar novamente"
  state renders, **not** "Conversa não encontrada"; clicking retry refetches.
- Thread state resets on conversation change: choose "Responder" in client 14,
  navigate to client 15, the composer placeholder is back to
  "Enviar mensagem…" and a send calls `sendMensagem(15, …)`, not
  `replyToPostApproval`.
- Searching for a name that excludes the open conversation leaves the thread
  rendered.
- Deep-link entry at `/mensagens/14` fetches the feed for 14 on first render
  and snaps to the bottom: the scroll container gets a `data-testid`, the test
  defines `scrollHeight` on it via `Object.defineProperty` (jsdom reports 0)
  and a `scrollTop` setter spy, and asserts the setter was called with that
  height once the feed settles.
- `feed` is **not** fetched when no `clienteId` is present.

`useIsDesktop` already has its own coverage; no new hook test.

Flex widths, the full-height fill and the 768px collapse are not jsdom-testable
and are verified manually in the browser after implementation, per the repo's
standing rule for responsive CSS.

## Rollout

Pure frontend change; ships in a single PR after `lint`, `format:check`, the
four `tsc` projects, `npm run test`, plus a browser check at ≥768px and <768px.
No migration, no edge-function deploy, no feature flag.
