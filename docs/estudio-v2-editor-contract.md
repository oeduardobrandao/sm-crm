# Estúdio v2 — Editor contracts (frozen, slice 1 deliverable)

The forked OpenPencil editor (`github.com/oeduardobrandao/open-pencil`, branch `mesaas`) is
backend-agnostic: it talks to whatever `docUrl` it is given over the **HTTP document
contract**, and to its host window over the **bridge protocol**. The endpoint slice
(post-design-manage) implements the former; the CRM-shell slice implements the latter.
Change either only by versioning (bridge `v` field) and updating both sides.

Editor URL shape:

```
{EDITOR_ORIGIN}/?embed=1&docUrl=<url-encoded endpoint>&parentOrigin=<url-encoded host origin>
```

- Without `parentOrigin` the bridge is disabled and no auth header is sent (standalone dev).
- Deployed (dark, SSO-protected): https://mesaas-estudio-rmsz5df8v-oeduardobrandaos-projects.vercel.app
- Dev: `bun --bun run dev` in the fork → http://localhost:1420

## HTTP document contract

**Status: IMPLEMENTED** by `supabase/functions/post-design-manage` (slice 2). Real shape:
`docUrl = {SUPABASE_URL}/functions/v1/post-design-manage/blob?post_id={id}`. Notes beyond
the frozen core: the post-status guard maps to **403** (`post_not_editable`); blobs live at
rev-scoped R2 keys (`designs/{conta}/{post}-r{rev}.fig`) so save races can't clobber; first
GET mints a starter `.fig` for the post's tipo (feed/carrossel 1080×1350, reels cover
1080×1920); PUT accepts an optional `x-editor-version` header (recorded on the row).

```
GET  {docUrl}
  headers: authorization: Bearer <supabase access token>
  → 200, body: .fig bytes (their NATIVE document format — NOT .pen), headers: x-rev: <int>
  → 401 (bad/expired token) | 403 (not owner) | 404 (no design)

PUT  {docUrl}
  headers: authorization: Bearer <token>, x-expected-rev: <int>,
           content-type: application/octet-stream
  body: .fig bytes
  → 200, headers: x-rev: <new int>
  → 409 (stale rev) | 401 | 403 | 413 (too large) | 422 (invalid doc)

CORS: allow headers authorization, x-expected-rev, content-type; expose header x-rev.
```

Editor behavior on responses: 409 → toast + `save:conflict` + **all further saves
suspended client-side** until the document is reloaded (host decides: reload iframe).
401 → `auth:needed` (host should re-send `auth`). Other errors → toast + `save:error`.
Autosave: 3s debounce on scene changes; a `save` bridge message forces an immediate save.

## Bridge protocol v1 (postMessage)

Every message is `{ v: 1, type, ...payload }`. The editor accepts messages ONLY from
`parentOrigin` and posts ONLY to it.

```
editor → host:  ready                         // boot; host must reply with auth
                doc:loaded    { rev }
                save:ok       { rev, bytes }
                save:conflict { rev }         // autosave suspended until reload
                save:error    { message }
                auth:needed                   // seen 401; re-send auth
                dirty         { dirty: boolean }
host → editor:  auth          { accessToken } // first one unblocks boot (5s timeout);
                                              // later ones refresh the token (kept in memory only)
                save                          // force immediate save
```

Boot sequence: iframe loads → editor posts `ready` → host posts `auth` → editor GETs
doc → opens it → focuses the first page with content → posts `doc:loaded`.

## Reference host implementation

`spike/openpencil/embed.html` + `spike/openpencil/stub-server.mjs` (auth-checking stub,
409 on stale rev) — the CRM-shell slice reimplements the host side; the stub is the
executable spec for the endpoint slice.

## Embed-mode behavior (what the fork changes)

- Hidden: File/Edit/View menubar, tab/title bar, Share/collab, Code + AI chat tabs
  (Design tab only), PWA/service worker, local MCP/automation bridge.
- `yieldToUI` hardened (rAF raced with 100ms timeout) — document open no longer stalls
  in render-throttled iframes/background tabs. Upstream PR candidate.
- Full diff surface documented in the fork's `UPSTREAM.md`; every upstream-file change
  is marked `// MESAAS:` and gated on `embedConfig`.
