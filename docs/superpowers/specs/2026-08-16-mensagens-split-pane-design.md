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
| Page height | Split shell fills the viewport below the page header; list and thread scroll independently. No page-level scroll. |
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
  minimal change.
- **`hooks/useMediaQuery.ts`**: tiny `(query: string) => boolean` hook over
  `window.matchMedia` with a `change` listener. No existing equivalent in the
  repo.

`MensagensPage.tsx` becomes a thin shell:

1. Resolves `clienteId` from the route.
2. Calls `useMensagensData(clienteId)` **once** and passes results down as
   props (avoids double-invoking the hook from two panes).
3. `const isSplit = useMediaQuery('(min-width: 768px)')`.
4. Renders the page header, then the shell:
   - `isSplit`: list pane + (thread pane if `clienteId != null`, else the
     placeholder) side by side.
   - `!isSplit`: only the list when `clienteId == null`, only the thread when
     it is set (today's behaviour, URL-driven).

### Layout

- Page wrapper: `flex flex-col` with
  `height: calc(100dvh - var(--topbar-height) - var(--banner-height, 0px) - <content block padding>)`,
  where the padding term is the `.main-content` vertical padding
  (`clamp(1.25rem, 3vw, 2.5rem)` × 2). The page header keeps its natural height;
  the shell below it is `flex-1 min-h-0`. This avoids hard-coding the header's
  pixel height: the shell simply takes whatever is left.
- Shell: `flex` container, `overflow-hidden`, rounded card border as today.
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

### Edge cases

- **Invalid `clienteId` in the URL** (hand-typed, or a client no longer in the
  list): once `conversas` has resolved and the id is not present, the thread
  pane renders "Conversa não encontrada" with a link to `/mensagens`. Until
  `conversas` resolves it shows the normal loading state, never an infinite
  spinner.
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

- Desktop (`matchMedia` mocked wide): list and thread render **simultaneously**;
  the selected row carries the active class; the placeholder shows when there
  is no `clienteId`.
- Mobile (`matchMedia` mocked narrow): only one pane renders at a time, back
  button navigates to `/mensagens`.
- `/mensagens/999` (unknown id): "Conversa não encontrada" + link back.
- Searching for a name that excludes the open conversation leaves the thread
  rendered.
- Deep-link entry at `/mensagens/14` fetches the feed for 14 on first render.
- `feed` is **not** fetched when no `clienteId` is present.

`useMediaQuery` gets its own unit test (initial value, `change` event updates,
listener cleanup).

Flex widths, the full-height fill and the 768px collapse are not jsdom-testable
and are verified manually in the browser after implementation, per the repo's
standing rule for responsive CSS.

## Rollout

Pure frontend change; ships in a single PR after `lint`, `format:check`, the
four `tsc` projects, `npm run test`, plus a browser check at ≥768px and <768px.
No migration, no edge-function deploy, no feature flag.
