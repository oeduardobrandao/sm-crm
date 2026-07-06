# Estúdio v2 — Editor contracts (frozen, slice 1 deliverable)

The forked OpenPencil editor (`github.com/oeduardobrandao/open-pencil`, branch `mesaas`) is
backend-agnostic: it talks to whatever `docUrl` it is given over the **HTTP document
contract**, and to its host window over the **bridge protocol**. The endpoint slice
(design-manage) implements the former; the CRM-shell slice implements the latter.
Change either only by versioning (bridge `v` field) and updating both sides.

Editor URL shape:

```
{EDITOR_ORIGIN}/?embed=1&docUrl=<url-encoded endpoint>&parentOrigin=<url-encoded host origin>[&readOnly=1]
```

- Without `parentOrigin` the bridge is disabled and no auth header is sent (standalone dev).
- `readOnly=1` (slice A2 — designs attached to locked posts): view-only mode. The editor
  locks the HAND tool after doc load (pan/zoom only), hides the toolbar, binds no keyboard
  shortcuts, neutralizes dblclick/contextmenu, never autosaves, ignores the `save` bridge
  message and never emits `dirty`. The host hides the save UI and shows a read-only banner
  with a "Duplicar" CTA. Degraded mode (a fork build WITHOUT readOnly support ignores the
  param): local edits become possible but every PUT gets the backend's 403 `read_only`,
  surfacing as the editor's save-error toast — nothing can ever be written either way.
- Production: https://estudio.mesaas.com.br (public; CSP `frame-ancestors` restricts
  embedding to the CRM origins mesaas.com.br / www.mesaas.com.br / sm-crm.vercel.app;
  the CRM reads it from `VITE_ESTUDIO_EDITOR_ORIGIN`). The editor's direct
  `functions/v1` calls require this origin in the edge functions' `ALLOWED_ORIGINS`.
- Dev: `bun --bun run dev` in the fork → http://localhost:1420

## HTTP document contract

**Status: IMPLEMENTED** by `supabase/functions/design-manage` (design-first core, slice A1
— replaced post-design-manage). Real shape:
`docUrl = {SUPABASE_URL}/functions/v1/design-manage/blob?design_id={id}`. Designs are
first-class: creation is explicit (`POST /designs` mints the starter `.fig` per format —
feed/carrossel 1080×1350, reels cover 1080×1920, livre = free canvas) and GET is a plain
fetch (404 when the design does not exist; mint-on-GET is gone). Notes beyond the frozen
core: a save against a design attached to a locked post maps to **403** (`read_only`);
blobs live at uuid-keyed, rev-scoped R2 keys (`designs/{conta}/{uuid}-r{rev}.fig`) so save
races can't clobber; PUT accepts an optional `x-editor-version` header (recorded on the
row).

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

## Host implementation

**Status: IMPLEMENTED** by the CRM shell (slice 4): `apps/crm/src/pages/estudio/embedHost.ts`
(pure bridge host: origin check, auth handshake incl. forced refresh on `auth:needed`,
force-save, URL builders) + `EstudioPage.tsx` (iframe, save pill, conflict banner → iframe
remount, dirty guards via `useBlocker` + `beforeunload`, 8s boot-timeout hint). Editor origin
comes from `VITE_ESTUDIO_EDITOR_ORIGIN` (dev default `http://localhost:1420`). Dev CORS: the
editor origin is not in prod `ALLOWED_ORIGINS`, so in dev `docUrl` routes through the CRM
Vite proxy (`/estudio-fn/*` → `{SUPABASE_URL}/functions/v1/*`) which echoes localhost origins
in `access-control-allow-origin`; prod uses the direct Supabase URL (editor origin gets
allowlisted at cutover).

Historical reference rig: `spike/openpencil/embed.html` + `stub-server.mjs` (deleted at
cutover).

## Embed-mode behavior (what the fork changes)

- Hidden: File/Edit/View menubar, tab/title bar, Share/collab, Code + AI chat tabs
  (Design tab only), PWA/service worker, local MCP/automation bridge.
- `yieldToUI` hardened (rAF raced with 100ms timeout) — document open no longer stalls
  in render-throttled iframes/background tabs. Upstream PR candidate.
- Full diff surface documented in the fork's `UPSTREAM.md`; every upstream-file change
  is marked `// MESAAS:` and gated on `embedConfig`.
